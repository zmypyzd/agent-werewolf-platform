-- ============================================================================
-- Werewolf — decision mailbox (cross-instance agent dispatch)
-- ============================================================================
-- The orchestrator runs as a long-lived process on Render; the API tier
-- runs in stateless serverless functions on Vercel. They cannot share
-- memory, so this pair of tables is the durable mailbox that ties them
-- together:
--
--   1. Orchestrator (Render) needs an agent decision → INSERTs a row into
--      werewolf_decision_requests with the full sanitized request payload.
--   2. External agent runner polls GET /api/v1/wait?agent_id=… → the
--      route SELECTs the oldest pending request for that agent and
--      returns it.
--   3. Agent runner POSTs to /api/v1/action with its decision → the route
--      INSERTs into werewolf_decision_actions.
--   4. Orchestrator polls werewolf_decision_actions for the matching
--      request_id (or uses Postgres LISTEN/NOTIFY — see below).
--
-- This decouples orchestrator pacing from agent response time. Agents that
-- never respond simply hit the request expires_at and the orchestrator
-- falls back to werewolf-fallback.ts.
--
-- Both tables are written exclusively by the service-role client. End
-- users never query them directly, so RLS denies all access by default
-- (no policies = denied for anon / authenticated, service-role bypasses).
-- ============================================================================


-- ─── Decision requests ─────────────────────────────────────────────────────
-- One row per agent decision the orchestrator is waiting on. Keyed on
-- (match_id, sequence) for idempotency: the orchestrator can safely retry
-- INSERT if its first attempt's response was lost.
create table public.werewolf_decision_requests (
  request_id   uuid        primary key default gen_random_uuid(),
  match_id     uuid        not null references public.werewolf_matches(id) on delete cascade,
  -- Per-match monotonic sequence — pairs with werewolf_decision_traces.sequence.
  sequence     int         not null,
  -- The seat that owes a decision. agent_id may be NULL for inproc/house
  -- bots; in that case the orchestrator decides synchronously and never
  -- writes to this table — but the column allows for future hybrid setups.
  player_id    text        not null,
  agent_id     uuid        references public.agents(id) on delete cascade,
  phase        text        not null,
  -- Full sanitized AgentDecisionRequest payload (publicState, privateState
  -- for this player only, validActions). Validated against the Zod schema
  -- in packages/agent-protocol before INSERT.
  state_json   jsonb       not null,
  -- Hard cap on payload size. Werewolf request envelopes are typically
  -- 4-32KB; 256KB leaves headroom for verbose history without enabling
  -- prompt-stuffing attacks against the agent runner.
  constraint  state_json_size_cap
    check (octet_length(state_json::text) <= 262144),
  enqueued_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text        not null default 'pending'
                              check (status in ('pending','fulfilled','expired','aborted')),
  fulfilled_at timestamptz,
  unique (match_id, sequence)
);
alter table public.werewolf_decision_requests enable row level security;
-- No policies → only the service-role client can read/write.

-- The hot read path is "next pending request for this agent". A partial
-- index keyed only on pending rows keeps it small even after months of
-- traffic, since fulfilled/expired rows are excluded.
create index werewolf_decision_requests_pending_by_agent_idx
  on public.werewolf_decision_requests (agent_id, enqueued_at)
  where status = 'pending';

-- The orchestrator looks up its own pending request by (match_id, sequence)
-- when polling. Covered by the unique constraint, no additional index.


-- ─── Decision actions ──────────────────────────────────────────────────────
-- One row per agent submission. Key is request_id so a second submission
-- for the same request fails with a unique-violation — the orchestrator
-- treats that as "agent already responded, ignore duplicate".
create table public.werewolf_decision_actions (
  request_id   uuid        primary key references public.werewolf_decision_requests(request_id) on delete cascade,
  match_id     uuid        not null references public.werewolf_matches(id) on delete cascade,
  agent_id     uuid        references public.agents(id) on delete cascade,
  -- The full WerewolfAction payload as the agent submitted it. Validated
  -- against the Zod schema before INSERT; redacted/sanitized variant lands
  -- in werewolf_decision_traces after the orchestrator applies it.
  action_json  jsonb       not null,
  constraint action_json_size_cap
    check (octet_length(action_json::text) <= 32768),
  -- Optional: agent's reasoning summary (capped). Persisted into the trace
  -- so it can be redacted and stored under per-match byte caps.
  reasoning_summary jsonb  check (reasoning_summary is null
                                   or octet_length(reasoning_summary::text) <= 16384),
  submitted_at timestamptz not null default now()
);
alter table public.werewolf_decision_actions enable row level security;
-- No policies → service-role only.

create index werewolf_decision_actions_match_id_idx
  on public.werewolf_decision_actions (match_id);


-- ─── Sweep helper: mark expired requests ───────────────────────────────────
-- Called by the cron job at /api/cron/expire-werewolf-decisions on a
-- minute-or-so cadence. Keeps the partial index above tight.
create or replace function public.expire_old_werewolf_decision_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.werewolf_decision_requests
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.expire_old_werewolf_decision_requests() from anon, authenticated;


-- ─── Atomic claim helper for /v1/wait ──────────────────────────────────────
-- Returns the oldest pending request for an agent and atomically marks it
-- so concurrent /wait calls from a duplicated runner don't both claim the
-- same row. We use FOR UPDATE SKIP LOCKED, which Postgres exposes natively
-- and is the canonical mailbox-claim pattern.
--
-- Returns the full request row, or NULL if no pending requests exist.
-- The orchestrator does NOT call this — it polls werewolf_decision_actions
-- by request_id directly. This RPC is for the agent-facing /v1/wait route.
create or replace function public.claim_next_werewolf_decision_request(
  p_agent_id uuid,
  p_lease_seconds int default 30
)
returns public.werewolf_decision_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.werewolf_decision_requests;
begin
  with next_req as (
    select request_id
      from public.werewolf_decision_requests
     where agent_id = p_agent_id
       and status   = 'pending'
       and expires_at > now()
     order by enqueued_at
     limit 1
     for update skip locked
  )
  update public.werewolf_decision_requests r
     set fulfilled_at = now()
    -- NB: status stays 'pending' until /v1/action submits. fulfilled_at
    -- here only marks "claimed by an agent runner" so we can tell the
    -- difference between "no agent connected" and "agent took it but
    -- never replied" in metrics.
    from next_req
   where r.request_id = next_req.request_id
   returning r.* into claimed;

  -- p_lease_seconds is reserved for a future "extend expiration after
  -- claim" feature; today we trust the caller's per-request expires_at.
  perform p_lease_seconds;

  return claimed;
end;
$$;
revoke all on function public.claim_next_werewolf_decision_request(uuid, int) from anon, authenticated;


-- ─── Optional: LISTEN/NOTIFY plumbing for orchestrator wake-up ─────────────
-- Polling werewolf_decision_actions every 300ms-2s works, but Postgres
-- LISTEN/NOTIFY lets the orchestrator block in pg_notify channel until
-- an action lands — zero-latency, zero-poll. Trigger fires on every
-- INSERT into werewolf_decision_actions and notifies the channel
-- 'werewolf_action:<match_id>'.
--
-- Wire this in only after measuring poll cost; LISTEN holds a session
-- open which is fine for one orchestrator process but is not free.
create or replace function public.notify_werewolf_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_notify(
    'werewolf_action:' || new.match_id::text,
    json_build_object(
      'request_id', new.request_id,
      'match_id',   new.match_id,
      'agent_id',   new.agent_id
    )::text
  );
  return new;
end;
$$;

create trigger werewolf_decision_actions_notify
  after insert on public.werewolf_decision_actions
  for each row execute function public.notify_werewolf_action();
