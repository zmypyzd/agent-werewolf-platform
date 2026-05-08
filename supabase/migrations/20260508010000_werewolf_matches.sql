-- ============================================================================
-- Werewolf — match, seat, replay event, and decision-trace tables
-- ============================================================================
-- These tables replace the in-memory state currently held by:
--   - packages/werewolf-orchestrator/src/orchestrator.ts (matches Map)
--   - packages/persistence/src/werewolf-match-artifact-store.ts
--   - packages/persistence/src/werewolf-decision-trace-store.ts
--
-- Design principles:
--   - Append-only event log (werewolf_replay_events) is the source of truth
--     for replay. Match summary is denormalized at game-over for fast reads.
--   - Public read on completed matches; reads on running matches are blocked
--     so spectators only see what already streamed via SSE (no leaking
--     in-flight private state).
--   - Decision traces are public-sanitized at write time (the orchestrator
--     calls sanitize-action.ts before INSERT) — see WerewolfDecisionTrace
--     in packages/shared/src/werewolf-decision-trace.ts.
-- ============================================================================


-- ─── Matches ────────────────────────────────────────────────────────────────
-- One row per werewolf match. Created when the orchestrator boots a match;
-- transitions: lobby → running → completed/aborted.
create table public.werewolf_matches (
  id              uuid        primary key default gen_random_uuid(),
  -- Stable game id used by the orchestrator and replay events. Mirrors
  -- WerewolfReplayEvent.gameId — kept distinct from the surrogate `id` so
  -- existing in-memory code paths don't have to change naming.
  game_id         text        not null unique check (length(game_id) between 1 and 64),
  -- See public.agents.owner_id — text during Phase 1, FK to auth.users
  -- restored in Phase 2.
  owner_id        text,
  status          text        not null default 'lobby'
                                check (status in ('lobby','running','completed','aborted')),
  -- Seed deliberately stored server-side only and never returned to public
  -- routes (mirrors the redaction rule in
  -- WerewolfMatchPublicSummary — seed is omitted from the public artifact).
  seed            text        not null,
  -- Final outcome — set when status flips to 'completed'. Mirrors the
  -- WerewolfSide union in packages/shared/src/werewolf-types.ts.
  winner          text        check (winner is null or winner in ('werewolf','good')),
  night_count     int,
  day_count       int,
  step_count      int,
  replay_event_count int,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.werewolf_matches enable row level security;

-- Public read for completed/aborted matches only — running matches expose
-- only the events that already streamed via SSE; raw row access is blocked
-- so the spectator UI cannot poll private RNG / seed.
create policy "match-public-read-completed"
  on public.werewolf_matches for select
  using ( status in ('completed','aborted') );
create policy "match-owner-read"
  on public.werewolf_matches for select
  using ( auth.uid()::text = owner_id );

create trigger werewolf_matches_set_updated_at
  before update on public.werewolf_matches
  for each row execute function public.set_updated_at();

create index werewolf_matches_status_idx     on public.werewolf_matches (status);
create index werewolf_matches_started_at_idx on public.werewolf_matches (started_at desc);
create index werewolf_matches_owner_id_idx   on public.werewolf_matches (owner_id);

-- Public-safe view: hides the seed even on completed matches (the public
-- artifact never includes seed — see WerewolfMatchPublicSummary).
create or replace view public.werewolf_matches_public
  with (security_invoker = true) as
  select id, game_id, status, winner, night_count, day_count, step_count,
         replay_event_count, started_at, completed_at
    from public.werewolf_matches
   where status in ('completed','aborted');
grant select on public.werewolf_matches_public to anon, authenticated;


-- ─── Seats ─────────────────────────────────────────────────────────────────
-- Seat-to-agent assignment for each match. player_id is the in-game string
-- (e.g. 'p0'..'p8'); seat_index is the 0-based seat number. Role and side
-- are NULL while running and only filled in once the match completes (so
-- raw queries cannot leak roles mid-match — RLS additionally restricts).
create table public.werewolf_seats (
  match_id    uuid        not null references public.werewolf_matches(id) on delete cascade,
  seat_index  smallint    not null check (seat_index between 0 and 8),
  player_id   text        not null check (length(player_id) between 1 and 32),
  agent_id    uuid        references public.agents(id) on delete set null,
  display_name text       not null check (length(display_name) between 1 and 64),
  -- Set at game-over only. NULL while running.
  role        text        check (role is null
                                 or role in ('werewolf','villager','seer','witch','hunter')),
  side        text        check (side is null or side in ('werewolf','good')),
  alive       boolean,
  primary key (match_id, seat_index),
  unique (match_id, player_id)
);
alter table public.werewolf_seats enable row level security;

-- Seats only readable for completed matches (mirrors match policy).
create policy "seat-public-read-completed"
  on public.werewolf_seats for select
  using (
    exists (
      select 1 from public.werewolf_matches m
       where m.id = match_id and m.status in ('completed','aborted')
    )
  );

create index werewolf_seats_agent_id_idx on public.werewolf_seats (agent_id);


-- ─── Replay events (append-only public event log) ──────────────────────────
-- Exact mirror of WerewolfReplayEvent in
-- packages/shared/src/werewolf-replay-event.ts.  Written by the orchestrator
-- (service-role) as the match progresses; never updated.
--
-- IMPORTANT: events here are the public-sanitized stream — private night
-- actions are filtered before INSERT (see sanitize-action.ts and
-- toPublicWerewolfHistory).  Raw private state never lands in this table.
create table public.werewolf_replay_events (
  event_id    uuid        primary key default gen_random_uuid(),
  match_id    uuid        not null references public.werewolf_matches(id) on delete cascade,
  game_id     text        not null,
  sequence    int         not null,
  event_type  text        not null check (event_type in (
    'match.started',
    'agent.action_requested',
    'agent.action_received',
    'agent.timeout',
    'agent.invalid_action',
    'engine.action_applied',
    'phase.changed',
    'match.completed'
  )),
  -- Event-specific payload. Schema is enforced at the Zod boundary in
  -- packages/agent-protocol; the DB only checks the discriminator.
  data        jsonb       not null,
  -- timestamp is the canonical event time (from the orchestrator clock);
  -- created_at is the DB write time (kept for ops debugging only).
  timestamp   bigint      not null,
  created_at  timestamptz not null default now(),
  unique (match_id, sequence)
);
alter table public.werewolf_replay_events enable row level security;

create policy "replay-event-public-read-completed"
  on public.werewolf_replay_events for select
  using (
    exists (
      select 1 from public.werewolf_matches m
       where m.id = match_id and m.status in ('completed','aborted')
    )
  );

create index werewolf_replay_events_match_seq_idx
  on public.werewolf_replay_events (match_id, sequence);


-- ─── Decision traces (audit log for agent decisions) ───────────────────────
-- Exact mirror of WerewolfDecisionTrace in
-- packages/shared/src/werewolf-decision-trace.ts. Action payload is already
-- redacted before INSERT (private night-action targets dropped).
create table public.werewolf_decision_traces (
  trace_id            uuid        primary key default gen_random_uuid(),
  match_id            uuid        not null references public.werewolf_matches(id) on delete cascade,
  -- Per-match monotonically increasing sequence (canonical ordering key).
  sequence            int         not null,
  request_id          uuid        not null,
  agent_id            uuid        references public.agents(id) on delete set null,
  player_id           text        not null,
  phase               text        not null,
  night_number        int         not null,
  day_number          int         not null,
  public_state_hash   text        not null,
  private_state_hash  text        not null,
  valid_action_types  text[]      not null,
  -- Fully redacted action payload (private night targets removed). NULL
  -- when the agent timed out or returned an invalid action.
  response_action     jsonb,
  applied_action      jsonb       not null,
  latency_ms          int         not null check (latency_ms >= 0),
  timed_out           boolean     not null default false,
  invalid_reason      text,
  fallback_reason     text        check (fallback_reason is null
                                          or fallback_reason in ('timeout','invalid_action','missing_agent')),
  -- reasoningSummary is bounded server-side per ReasoningSummary caps; we
  -- additionally cap the JSON column at 16KB to prevent prompt-spam.
  reasoning_summary   jsonb       check (reasoning_summary is null
                                          or octet_length(reasoning_summary::text) <= 16384),
  created_at          timestamptz not null default now(),
  unique (match_id, sequence)
);
alter table public.werewolf_decision_traces enable row level security;

-- Owners of the agent that produced the trace can always read it (for
-- post-match analysis). Public reads only on completed matches.
create policy "decision-trace-public-read-completed"
  on public.werewolf_decision_traces for select
  using (
    exists (
      select 1 from public.werewolf_matches m
       where m.id = match_id and m.status in ('completed','aborted')
    )
  );
create policy "decision-trace-agent-owner-read"
  on public.werewolf_decision_traces for select
  using (
    exists (
      select 1 from public.agents a
       where a.id = agent_id and a.owner_id = auth.uid()::text
    )
  );

create index werewolf_decision_traces_match_seq_idx
  on public.werewolf_decision_traces (match_id, sequence);
create index werewolf_decision_traces_agent_id_idx
  on public.werewolf_decision_traces (agent_id);


-- ─── Match summary (denormalized, written at game-over) ────────────────────
-- Drop-in replacement for WerewolfMatchPublicSummary delivered by
-- /api/v1/matches/:id. Reading from this single row is cheaper than joining
-- the events + seats tables on every request.
create table public.werewolf_match_summaries (
  match_id          uuid        primary key references public.werewolf_matches(id) on delete cascade,
  -- Whole WerewolfMatchPublicSummary serialized as JSONB. The shape is
  -- enforced by werewolf-match-artifact-serialization.ts before INSERT.
  summary           jsonb       not null,
  created_at        timestamptz not null default now()
);
alter table public.werewolf_match_summaries enable row level security;

create policy "match-summary-public-read"
  on public.werewolf_match_summaries for select
  using ( true );  -- summaries only get inserted at game-over, so they are
                   -- by definition public.
