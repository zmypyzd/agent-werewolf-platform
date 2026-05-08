-- ============================================================================
-- Werewolf — explicit service_role grants on werewolf_* tables
-- ============================================================================
-- The earlier werewolf migrations (20260508010000_werewolf_matches.sql,
-- 20260508020000_werewolf_decision_mailbox.sql) rely on Supabase's default
-- privileges to auto-grant DML on new public-schema tables to service_role.
-- That default holds in fresh Supabase Cloud projects created via the
-- standard onboarding flow, but it does NOT hold reliably when:
--   - Migrations are applied as a non-postgres role (some self-hosted setups,
--     or `supabase db push` with a non-default db owner).
--   - The project's ALTER DEFAULT PRIVILEGES were reset / not re-run after
--     a schema reset.
--
-- Symptom in production: orchestrator boots, user clicks "start match",
-- the API throws "resolveMatchPk failed: permission denied for table
-- werewolf_matches" (PostgREST surfaces the underlying Postgres
-- "permission denied" — this is a GRANT-level error, not RLS, and it
-- fires even though service_role bypasses RLS).
--
-- This migration is idempotent: re-running grants the same privileges.
-- Safe to apply on top of a working environment.
-- ============================================================================

-- Ensure service_role can reach the schema at all. Default Supabase grants
-- this; restating it costs nothing and protects self-hosted deploys.
grant usage on schema public to service_role;

-- Tables created in 20260508010000_werewolf_matches.sql.
grant select, insert, update, delete on public.werewolf_matches            to service_role;
grant select, insert, update, delete on public.werewolf_seats              to service_role;
grant select, insert, update, delete on public.werewolf_replay_events      to service_role;
grant select, insert, update, delete on public.werewolf_decision_traces    to service_role;
grant select, insert, update, delete on public.werewolf_match_summaries    to service_role;

-- Tables created in 20260508020000_werewolf_decision_mailbox.sql.
grant select, insert, update, delete on public.werewolf_decision_requests  to service_role;
grant select, insert, update, delete on public.werewolf_decision_actions   to service_role;

-- RPC helpers — service_role calls these directly. The earlier migrations
-- explicitly REVOKE these from anon / authenticated; we only need to
-- restate the service_role privilege defensively.
grant execute on function public.expire_old_werewolf_decision_requests()                to service_role;
grant execute on function public.claim_next_werewolf_decision_request(uuid, int)        to service_role;

-- Belt-and-braces: also re-apply the public-view grants from the original
-- migration in case those defaults drifted too. The view is security_invoker
-- so RLS on the underlying table still applies.
grant select on public.werewolf_matches_public to anon, authenticated;
