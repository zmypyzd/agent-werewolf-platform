-- ============================================================================
-- Agent tables — explicit service_role + authenticated grants
-- ============================================================================
-- The init migration (20260508000000_init.sql) created public.agents,
-- public.agent_invites, and public.profiles relying on Supabase's default
-- ALTER DEFAULT PRIVILEGES to auto-grant DML to service_role and
-- authenticated.  That default does NOT hold reliably when:
--   - Migrations are applied as a non-postgres role (supabase db push with
--     a non-default db owner, some self-hosted setups).
--   - The project's default privileges were reset or not re-run after a
--     schema reset.
--
-- Symptom: agent-invites routes return "permission denied for table
-- agent_invites" (or agents / profiles) even when called with a valid JWT
-- (user-scoped client) or the service-role key.
--
-- This migration is idempotent: re-running the GRANTs costs nothing.
-- ============================================================================

-- Ensure service_role can reach the schema at all.
grant usage on schema public to service_role;
grant usage on schema public to authenticated;

-- service_role needs full DML to create/update agents and invites on
-- behalf of users (e.g. the register-external-agent endpoint bypasses RLS
-- intentionally using the service-role client).
grant select, insert, update, delete on public.agents         to service_role;
grant select, insert, update, delete on public.agent_invites  to service_role;
grant select, insert, update, delete on public.profiles       to service_role;

-- authenticated role needs DML so RLS-gated queries work for logged-in
-- users (user-scoped Supabase client passes the JWT which sets role =
-- 'authenticated' at the Postgres level; without this GRANT the row-level
-- policies can't even evaluate).
grant select, insert, update, delete on public.agents         to authenticated;
grant select, insert, update, delete on public.agent_invites  to authenticated;
grant select, insert, update         on public.profiles       to authenticated;
