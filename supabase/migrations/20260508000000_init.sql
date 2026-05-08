-- ============================================================================
-- Werewolf Platform — initial schema
-- ============================================================================
-- Phase 0 of the serverless migration. Replaces the local SQLite tables in
-- packages/persistence/src/sqlite/schema.sql with a Postgres schema that
-- assumes Supabase Auth as the identity provider and a stateless API tier.
--
-- Conventions:
--   - Identity rooted at auth.users(id). public.profiles is the 1:1 mirror
--     for app-specific user data (display_name etc).
--   - All user-owned tables have an owner_id column referencing auth.users(id),
--     RLS enabled, with policies that restrict reads/writes to the owner.
--   - Server-side mutations (orchestrator, decision mailbox writes, replay
--     event ingestion) use the service-role client which bypasses RLS.
--   - Timestamps are timestamptz (UTC). No floats for any score/count field.
--
-- Out of scope for Phase 0: poker tables (this migration is werewolf-only),
-- match artifact object storage (uses Supabase Storage; configured separately).
-- ============================================================================

set check_function_bodies = off;

-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";    -- gen_random_uuid()


-- ─── Shared trigger: bump updated_at on UPDATE ─────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ─── Profiles (1:1 with auth.users) ────────────────────────────────────────
-- Replaces packages/persistence/src/sqlite/schema.sql:users. Email and
-- password_hash live in auth.users; we only mirror app-specific fields.
create table public.profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  display_name text        not null check (length(display_name) between 1 and 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profile-self-read"
  on public.profiles for select
  using ( auth.uid() = id );

create policy "profile-self-update"
  on public.profiles for update
  using ( auth.uid() = id )
  with check ( auth.uid() = id );

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a user signs up. Falls back to email-prefix
-- when no display_name was supplied in raw_user_meta_data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ─── Agents (registered external bots) ─────────────────────────────────────
-- Replaces packages/persistence/src/sqlite/schema.sql:user_agent_configs.
-- Adds protocol discriminator so the orchestrator can route decisions
-- through the right adapter:
--   - 'http'    : direct webhook (low-latency, requires public callback URL)
--   - 'longpoll': mailbox pattern via /v1/wait + /v1/action (default)
--   - 'inproc'  : house bot / server-side fallback agent (no callback)
create table public.agents (
  id                uuid        primary key default gen_random_uuid(),
  -- owner_id is intentionally a plain text field (no FK to auth.users)
  -- during Phase 1. The current auth system runs on a separate SQLite
  -- store (apps/auth) keyed by application-level user IDs, and we want
  -- werewolf onboarding to work before the full Supabase Auth migration.
  -- Phase 2 rebinds this to auth.users(id) once the auth system flips.
  owner_id          text        not null,
  name              text        not null check (length(name) between 1 and 64
                                                and name ~ '^[A-Za-z0-9_\-\.]+$'),
  description       text        check (description is null or length(description) <= 500),
  protocol          text        not null default 'longpoll'
                                  check (protocol in ('http','longpoll','inproc')),
  -- Webhook URL for protocol='http'. Required https in production; the
  -- orchestrator validates the URL again at decision time.
  callback_url      text        check (callback_url is null
                                       or callback_url ~ '^https?://[a-zA-Z0-9.\-]+(:[0-9]+)?(/.*)?$'),
  -- Optional auth header forwarded on every callback. Only the value is
  -- secret; the header name is not.
  auth_header_name  text        check (auth_header_name is null
                                       or length(auth_header_name) between 1 and 64),
  auth_header_value text,
  -- Per-agent timeout. Werewolf decisions are slower than poker; default 30s.
  timeout_ms        int         not null default 30000
                                  check (timeout_ms between 1000 and 120000),
  -- Bearer token used by longpoll agents to authenticate against
  -- /api/v1/werewolf/wait + /action. Stored as sha256-hex of the raw
  -- token; the raw value is shown to the user once at create time. Null
  -- for protocol='http' (orchestrator-initiated, no inbound auth needed)
  -- and protocol='inproc' (no network at all). The CHECK constraint
  -- enforces that longpoll agents always have a token.
  token_hash        text        check (token_hash is null or length(token_hash) = 64),
  status            text        not null default 'active'
                                  check (status in ('active','suspended','retired')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner_id, name),
  constraint agent_token_required_for_longpoll
    check (
      (protocol <> 'longpoll')
      or (protocol = 'longpoll' and token_hash is not null)
    )
);
alter table public.agents enable row level security;

-- Hot path: /wait + /action authenticate by sha256(token). Index on
-- token_hash so the lookup is one btree probe — service-role only, never
-- queried by anon clients.
create index agents_token_hash_idx on public.agents (token_hash)
  where token_hash is not null;

create policy "agent-owner-read"
  on public.agents for select
  using ( auth.uid()::text = owner_id );
create policy "agent-owner-insert"
  on public.agents for insert
  with check ( auth.uid()::text = owner_id );
create policy "agent-owner-update"
  on public.agents for update
  using ( auth.uid()::text = owner_id )
  with check ( auth.uid()::text = owner_id );
create policy "agent-owner-delete"
  on public.agents for delete
  using ( auth.uid()::text = owner_id );

-- Public-safe view used by spectator UI. Excludes auth_header_value and
-- callback_url (PII / shared-secret). Public listing only shows active agents.
create or replace view public.agents_public
  with (security_invoker = true) as
  select id, owner_id, name, description, protocol, status, created_at
    from public.agents
   where status = 'active';
grant select on public.agents_public to anon, authenticated;

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

create index agents_owner_id_idx on public.agents (owner_id);


-- ─── Agent invites (one-shot tokens to register an external agent) ─────────
-- Replaces packages/persistence/src/sqlite/schema.sql:agent_invites.
-- A user creates an invite, hands the token to a teammate / external runner,
-- which redeems it once to attach a row to public.agents under the inviter's
-- ownership. Tokens are stored as sha256-hex; raw token is shown once.
create table public.agent_invites (
  token_hash                  text        primary key,
  -- See public.agents.owner_id — text during Phase 1, FK to auth.users
  -- restored in Phase 2 alongside the Supabase Auth migration.
  owner_id                    text        not null,
  display_name                text        check (display_name is null or length(display_name) <= 64),
  notes                       text        check (notes is null or length(notes) <= 500),
  expires_at                  timestamptz not null,
  used_at                     timestamptz,
  revoked_at                  timestamptz,
  registered_agent_id         uuid        references public.agents(id) on delete set null,
  created_at                  timestamptz not null default now()
  -- "live" (used_at is null and revoked_at is null and expires_at > now())
  -- is computed at read time in postgres-agent-invite-store.ts.
  -- Postgres rejects STORED generated columns referencing volatile now().
);
alter table public.agent_invites enable row level security;

create policy "invite-owner-read"
  on public.agent_invites for select
  using ( auth.uid()::text = owner_id );
create policy "invite-owner-insert"
  on public.agent_invites for insert
  with check ( auth.uid()::text = owner_id );
create policy "invite-owner-update"
  on public.agent_invites for update
  using ( auth.uid()::text = owner_id )
  with check ( auth.uid()::text = owner_id );

create index agent_invites_owner_id_idx on public.agent_invites (owner_id);
-- Liveness is derived (used_at is null and revoked_at is null and
-- expires_at > now()) — a partial index on the underlying nullability
-- columns serves "find live invites" queries without needing a column.
create index agent_invites_live_idx
  on public.agent_invites (owner_id, expires_at)
  where used_at is null and revoked_at is null;
