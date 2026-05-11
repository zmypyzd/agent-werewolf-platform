-- ============================================================================
-- Agent WebSocket transport — extend protocol CHECK to allow 'ws'
-- ============================================================================
-- P0 of the reverse-WebSocket transport for external werewolf agents.
-- See docs/agent-ws-transport-design.md.
--
-- This migration is purely data-layer prep. No application code path emits
-- protocol='ws' yet — that arrives in P1 (the WS connect route + adapter).
-- Changes:
--   1. Allow protocol='ws' in the agents.protocol CHECK constraint.
--   2. Extend the existing token-required CHECK so that 'ws' agents must
--      also have a token_hash. WS connections authenticate the upgrade
--      with a Bearer token using the same sha256(token) lookup path that
--      longpoll agents already use, so we reuse the existing token_hash
--      column and agents_token_hash_idx index — no new column needed.
--
-- No data migration: zero existing 'ws' rows. Re-runnable / idempotent
-- because each step uses IF EXISTS or a DO-block existence check.
-- ============================================================================

-- 1. Replace the protocol CHECK constraint.
--    The original constraint was created inline on the column in
--    20260508000000_init.sql:107, so Postgres auto-named it. The auto
--    name follows `<table>_<column>_check` for column-scoped inline
--    CHECKs, but we look it up defensively in case a future supabase
--    diff renames it.
do $$
declare
  protocol_check_name text;
begin
  select conname into protocol_check_name
  from pg_constraint
  where conrelid = 'public.agents'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%protocol%'
    and pg_get_constraintdef(oid) not ilike '%token_hash%';
  if protocol_check_name is not null then
    execute format('alter table public.agents drop constraint %I', protocol_check_name);
  end if;
end
$$;

alter table public.agents
  add constraint agents_protocol_check
  check (protocol in ('http', 'longpoll', 'inproc', 'ws'));

-- 2. Replace the token-required CHECK to also cover 'ws'.
--    Renamed because the old name no longer describes the predicate.
alter table public.agents
  drop constraint if exists agent_token_required_for_longpoll;

alter table public.agents
  add constraint agent_token_required_for_longpoll_or_ws
  check (
    protocol not in ('longpoll', 'ws')
    or token_hash is not null
  );
