-- ============================================================================
-- Werewolf — defensive re-grant on public view
-- ============================================================================
-- Production symptom (overnight QA, 2026-05-10):
--   GET /api/v1/werewolf-matches → 500
--   {"error":{"code":"INTERNAL_ERROR",
--             "message":"listMatchArtifacts: permission denied for view
--                        werewolf_matches_public", "statusCode":500}}
--
-- Root cause: the SELECT grant on public.werewolf_matches_public to the anon
-- role was either never applied to the production Supabase database, or was
-- reverted at some point. The original GRANT lives in
-- 20260508010000_werewolf_matches.sql:79 and is repeated defensively in
-- 20260508030000_werewolf_service_role_grants.sql:48; both should already be
-- in place on a freshly-pushed environment.
--
-- This migration is purely additive and idempotent. Running it on top of a
-- working environment is a no-op (GRANT on an already-granted privilege is
-- silently accepted by Postgres).
--
-- The companion application-level fix (rewrapPostgresError in
-- postgres-werewolf-match-artifact-store.ts) ensures that even if this
-- migration is *not* applied, the route returns a 503 SERVICE_UNAVAILABLE
-- with an actionable message instead of a generic 500.
--
-- Apply with:  supabase db push  (or via the Supabase dashboard SQL editor).
-- ============================================================================

-- The public view is security_invoker, so RLS policies on the underlying
-- werewolf_matches table still gate which rows each role sees. Granting
-- SELECT on the view itself only allows the role to issue the SELECT
-- statement; it does not bypass RLS.
grant select on public.werewolf_matches_public to anon, authenticated;

-- The summary table is read by the public matches route (GET /werewolf-matches
-- joins werewolf_matches_public with werewolf_match_summaries). The original
-- migration relies on the table-default privileges; restate explicitly so
-- both halves of the join are reachable from the API role.
grant select on public.werewolf_match_summaries to anon, authenticated;

-- Replay events backing GET /werewolf-matches/:id/replay. RLS still enforces
-- the "only completed matches" filter (see replay-event-public-read-completed
-- policy in 20260508010000_werewolf_matches.sql).
grant select on public.werewolf_replay_events to anon, authenticated;

-- Decision traces backing GET /werewolf-matches/:id/decision-trace. RLS
-- enforces the same completed-match filter.
grant select on public.werewolf_decision_traces to anon, authenticated;

-- Public-safe seat reveal (role/side become non-NULL only at game-over).
-- Mirrors the seat-public-read-completed policy.
grant select on public.werewolf_seats to anon, authenticated;
