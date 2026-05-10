-- ============================================================================
-- Werewolf — service_role re-grant on public read-paths
-- ============================================================================
-- Follow-up to 20260510000000_werewolf_public_view_regrant.sql, which only
-- granted SELECT to `anon, authenticated`. The Render-deployed werewolf-api
-- connects to PostgREST with the service_role key (the standard server-side
-- bypass-RLS pattern), so the previous re-grant did not unblock the prod
-- 503 — GET /api/v1/werewolf-matches kept hitting `permission denied for
-- view werewolf_matches_public` because service_role itself lacked SELECT.
--
-- Discovered during overnight QA on 2026-05-10 while applying the previous
-- migration: it ran cleanly, but the route stayed 503. `has_table_privilege`
-- confirmed service_role had SELECT on werewolf_match_summaries (granted in
-- 20260508030000_werewolf_service_role_grants.sql) but NOT on the other four
-- read-paths. The hotfix below was applied manually via `supabase db query`;
-- this file codifies it so a fresh `supabase db reset` or new environment
-- starts in a working state.
--
-- Idempotent — re-running on a healthy DB is a no-op (Postgres silently
-- accepts a GRANT on an already-granted privilege). The original
-- 20260508030000_werewolf_service_role_grants.sql:48 was supposed to cover
-- service_role for these tables; the gap was that it predated some of the
-- views/tables added by 20260508010000_werewolf_matches.sql ordering
-- (those tables hadn't been created yet when the service_role grants ran).
-- ============================================================================

grant select on public.werewolf_matches_public  to service_role;
grant select on public.werewolf_replay_events   to service_role;
grant select on public.werewolf_decision_traces to service_role;
grant select on public.werewolf_seats           to service_role;
