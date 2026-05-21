-- ============================================================================
-- DRAFT — not yet written to the original project's supabase/seed.sql.
-- Review and approve before landing.
-- ============================================================================
-- Local Supabase seed — minimal werewolf demo data for eval / local dev.
-- Applied by `supabase db reset` (config.toml [db.seed] sql_paths=["./seed.sql"]).
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING with deterministic
-- ids so repeated db-reset passes converge.
--
-- This seed targets LOCAL Supabase only. Do not run on production. The
-- chain auth.users → handle_new_user trigger → public.profiles takes care
-- of profile creation automatically; we only insert auth.users.
--
-- Contents:
--   1 demo user (auth.users + profile via trigger)
--   1 longpoll agent owned by demo user (token = 'demo-token')
--   1 completed werewolf match (modelled after audit-r1-001):
--     - 9 seats with revealed role/side/alive
--     - 7 replay events covering every event_type
--     - 1 match_summaries row (real summary shape lifted from examples/)
-- ============================================================================

-- ─── 1. Demo user (Supabase Auth) ─────────────────────────────────────────
-- Fields are the minimum set accepted by recent Supabase Auth schemas.
-- The on_auth_user_created trigger (init migration) inserts the matching
-- public.profiles row using raw_user_meta_data.display_name.
insert into auth.users (
  instance_id, id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'demo@example.com',
  crypt('demo-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Demo User"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;


-- ─── 2. Agent owned by demo user ──────────────────────────────────────────
-- token_hash = sha256('demo-token')
--            = 7c43ef5ae21d43ce2743f770c68e24def1a43ee2f416d2438410c8af7af2ff2c
-- The raw token 'demo-token' is what an external runner would Bearer-auth with.
insert into public.agents (
  id, owner_id, name, description, protocol, token_hash, status
)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',  -- text comparison vs auth.uid()::text
  'demo-villager-bot',
  'Reference agent embedded by eval seed.',
  'longpoll',
  '7c43ef5ae21d43ce2743f770c68e24def1a43ee2f416d2438410c8af7af2ff2c',
  'active'
)
on conflict (id) do nothing;


-- ─── 3. One completed werewolf match ──────────────────────────────────────
-- Shape modelled after examples/werewolf-local-simulation/output/matches/
-- audit-r1-001. Note replay_event_count is set to 7 to match the rows
-- inserted below (not the 284 from the original audit), so the spectator
-- replay endpoint returns a coherent count.
insert into public.werewolf_matches (
  id, game_id, owner_id, status, seed, winner,
  night_count, day_count, step_count, replay_event_count,
  started_at, completed_at
)
values (
  '00000000-0000-0000-0000-000000000100',
  'demo-r1-001',
  '00000000-0000-0000-0000-000000000001',
  'completed',
  'eval-seed-deterministic',
  'good',
  4, 4, 79, 7,
  to_timestamp(1778524558.744),
  to_timestamp(1778524558.807)
)
on conflict (id) do nothing;

-- 9 seats with revealed roles (allowed because status='completed' —
-- seat-public-read-completed policy lets anon read them).
insert into public.werewolf_seats
  (match_id, seat_index, player_id, agent_id, display_name, role, side, alive)
values
  ('00000000-0000-0000-0000-000000000100', 0, 'p1', '00000000-0000-0000-0000-000000000010', '先知', 'villager', 'good',     true),
  ('00000000-0000-0000-0000-000000000100', 1, 'p2', null,                                    '星辰', 'witch',    'good',     true),
  ('00000000-0000-0000-0000-000000000100', 2, 'p3', null,                                    '灵巫', 'werewolf', 'werewolf', false),
  ('00000000-0000-0000-0000-000000000100', 3, 'p4', null,                                    '猎手', 'werewolf', 'werewolf', false),
  ('00000000-0000-0000-0000-000000000100', 4, 'p5', null,                                    '流水', 'werewolf', 'werewolf', false),
  ('00000000-0000-0000-0000-000000000100', 5, 'p6', null,                                    '天狼', 'villager', 'good',     true),
  ('00000000-0000-0000-0000-000000000100', 6, 'p7', null,                                    '清风', 'hunter',   'good',     false),
  ('00000000-0000-0000-0000-000000000100', 7, 'p8', null,                                    '青山', 'seer',     'good',     true),
  ('00000000-0000-0000-0000-000000000100', 8, 'p9', null,                                    '明月', 'villager', 'good',     true)
on conflict (match_id, seat_index) do nothing;

-- 7 replay events covering every event_type, ordered by sequence.
insert into public.werewolf_replay_events
  (match_id, game_id, sequence, event_type, data, timestamp)
values
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 0, 'match.started',
    '{"gameId":"demo-r1-001","players":[{"id":"p1","seatIndex":0,"name":"先知","role":"villager","side":"good"},{"id":"p2","seatIndex":1,"name":"星辰","role":"witch","side":"good"},{"id":"p3","seatIndex":2,"name":"灵巫","role":"werewolf","side":"werewolf"},{"id":"p4","seatIndex":3,"name":"猎手","role":"werewolf","side":"werewolf"},{"id":"p5","seatIndex":4,"name":"流水","role":"werewolf","side":"werewolf"},{"id":"p6","seatIndex":5,"name":"天狼","role":"villager","side":"good"},{"id":"p7","seatIndex":6,"name":"清风","role":"hunter","side":"good"},{"id":"p8","seatIndex":7,"name":"青山","role":"seer","side":"good"},{"id":"p9","seatIndex":8,"name":"明月","role":"villager","side":"good"}]}'::jsonb,
    1778524558744),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 1, 'phase.changed',
    '{"phase":"night-werewolf-vote","nightNumber":1,"dayNumber":0}'::jsonb,
    1778524558750),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 2, 'agent.action_requested',
    '{"requestId":"11111111-1111-1111-1111-111111111111","phase":"night-werewolf-vote","validActionCount":6}'::jsonb,
    1778524558760),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 3, 'agent.action_received',
    '{"requestId":"11111111-1111-1111-1111-111111111111","phase":"night-werewolf-vote","action":{"type":"werewolf-vote"},"usedFallback":false,"timedOut":false,"elapsedMs":23}'::jsonb,
    1778524558770),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 4, 'engine.action_applied',
    '{"phase":"night-werewolf-vote","actor":"p3","action":{"type":"werewolf-vote"}}'::jsonb,
    1778524558780),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 5, 'agent.invalid_action',
    '{"requestId":"22222222-2222-2222-2222-222222222222","phase":"day-vote","reason":"unknown_action_type"}'::jsonb,
    1778524558790),
  ('00000000-0000-0000-0000-000000000100', 'demo-r1-001', 6, 'match.completed',
    '{"gameId":"demo-r1-001","winner":"good","durationMs":63,"stepCount":79}'::jsonb,
    1778524558807)
on conflict (match_id, sequence) do nothing;

-- Denormalized summary — the JSONB shape lifted directly from
-- examples/werewolf-local-simulation/output/matches/audit-r1-001/summary.json,
-- with matchId/replayEventCount/history adapted to this seeded match.
insert into public.werewolf_match_summaries (match_id, summary)
values (
  '00000000-0000-0000-0000-000000000100',
  '{
    "matchId": "demo-r1-001",
    "winner": "good",
    "startedAt": 1778524558744,
    "completedAt": 1778524558807,
    "durationMs": 63,
    "nightCount": 4,
    "dayCount": 4,
    "stepCount": 79,
    "replayEventCount": 7,
    "finalPlayers": [
      {"id":"p1","seatIndex":0,"name":"先知","role":"villager","side":"good","alive":true},
      {"id":"p2","seatIndex":1,"name":"星辰","role":"witch","side":"good","alive":true},
      {"id":"p3","seatIndex":2,"name":"灵巫","role":"werewolf","side":"werewolf","alive":false},
      {"id":"p4","seatIndex":3,"name":"猎手","role":"werewolf","side":"werewolf","alive":false},
      {"id":"p5","seatIndex":4,"name":"流水","role":"werewolf","side":"werewolf","alive":false},
      {"id":"p6","seatIndex":5,"name":"天狼","role":"villager","side":"good","alive":true},
      {"id":"p7","seatIndex":6,"name":"清风","role":"hunter","side":"good","alive":false},
      {"id":"p8","seatIndex":7,"name":"青山","role":"seer","side":"good","alive":true},
      {"id":"p9","seatIndex":8,"name":"明月","role":"villager","side":"good","alive":true}
    ],
    "history": [
      {"type":"death","day":1,"playerId":"p7","cause":"witch-poison"},
      {"type":"vote-result","day":2,"eliminated":"p3"},
      {"type":"death","day":3,"playerId":"p5","cause":"day-vote"},
      {"type":"vote-result","day":4,"eliminated":"p4"}
    ]
  }'::jsonb
)
on conflict (match_id) do nothing;
