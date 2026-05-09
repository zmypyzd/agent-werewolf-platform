# Overnight QA Backlog — Werewolf Module

**Start:** 2026-05-09T17:25Z
**Plan:** `/Users/zmy/.claude/plans/werewolf-bug-structured-fern.md`
**Mode:** Autonomous, no human in the loop. Each candidate goes through fix workflow → PR on `overnight-qa/<slug>` branch.
**Severity ladder:** info-leak > rule-violation > state-mismatch > visual/contract > copy

---

## Inbox (raw candidates)

### CAND-001 — `GET /api/v1/werewolf-matches` returns 500 in production [P1, severity: state-mismatch/availability]
- **Repro**: `curl https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches`
- **Response**: `{"error":{"code":"INTERNAL_ERROR","message":"listMatchArtifacts: permission denied for view werewolf_matches_public","statusCode":500}}`
- **RCA hypothesis**: Migration `supabase/migrations/20260508010000_werewolf_matches.sql` (lines 73–79) creates the view and grants SELECT to anon/authenticated. The follow-up migration `20260508030000_werewolf_service_role_grants.sql` (line 48) reasserts the grant idempotently. One of these has not been applied to production Supabase, OR the grant was reverted.
- **Code fix path**:
  1. Add a new idempotent migration `supabase/migrations/<ts>_werewolf_public_view_regrant.sql` that re-grants SELECT (defensive).
  2. Improve the route handler `apps/api/src/routes/werewolf-matches.ts` to catch the postgres permission-denied error and return a structured 503 SERVICE_UNAVAILABLE instead of generic 500. This produces actionable error code for users and avoids leaking internal error text.
- **User action required**: Apply migration to prod via `supabase db push` (cannot do automatically — prod DB write is in safety guardrail).

### CAND-002 — match.started broadcasts every player's role/side at t=0 [QUESTION not bug]
- Documented as intentional in `packages/werewolf-orchestrator/src/match-runner.ts:98-104` (ISSUE-005 reference).
- For human spectators of a *running* game, this means roles are visible from the start. Standard werewolf UX has the role reveal only at game-over for non-player viewers.
- **Action**: Flag for user decision. Do not modify — design intent is explicit.

### CAND-003 — No web UI for werewolf match replay/history [missing feature, severity: visual/contract]
- API endpoints `GET /api/v1/werewolf-matches`, `:matchId`, `:matchId/replay`, `:matchId/decision-trace` all exist (and the prod 500 was fixed in PR #4).
- Web router (`apps/web/src/router.tsx`) has `/matches` + `/matches/:matchId` for **poker** only. No werewolf equivalents.
- After a werewolf game ends, players have no UI path to revisit the replay or decision traces.
- **Scope**: Adding `/werewolf-matches` and `/werewolf-matches/:matchId` pages is a substantial feature build (>200 lines, new components, navigation). Out of overnight-QA scope. Flag for product/UX prioritization.

### CAND-004 — No web UI for werewolf agent config management [missing feature, severity: visual/contract]
- API has `GET/POST/DELETE /api/v1/me/werewolf-agents` for users to register/manage their HTTP-longpoll agents.
- Web has no page for this — users must use the API directly or the markdown doc at `/api/v1/docs/werewolf-agent-guide`.
- **Scope**: New page + form. Substantial feature build. Out of overnight-QA scope.

### CAND-005 — `POST /werewolf-games/:gameId/fill-with-npcs` exists but is unused [smell, severity: copy/UX]
- Backend route `apps/api/src/routes/werewolf-games.ts:127-134` would let users one-click-fill empty seats with NPCs.
- Web doesn't expose a button for it; users must hit "邀请 NPC" 9 times.
- **Scope**: Low-effort addition (one button + handler). Defer to a future small PR.

## Working

### CAND-006 — `🌙 夜 0 · 行动中…` displayed before `phase.changed` populates `nightNumber` [P2, severity: visual] [PR #6]
- Reducer's night-fold collapse uses `next.nightNumber`. `emptyRoomState` seeds it to 0. The orchestrator transitions setup→night-werewolf-vote *without* emitting `phase.changed`, so several `agent.action_requested` events fire before the field is populated → fold says "夜 0".
- Secondary bug: once nightNumber later updates to 1, the dedupe text comparison fails (last fold contains "夜 0", new check looks for "夜 1") → second fold appears for the same logical night.
- **Fix**: suppress fold while `nightNumber < 1`. PR #6.

### CAND-007 — Lobby missing one-click "fill empty seats with NPCs" button [feature gap, severity: copy/UX] [PR #7]
- Endpoint `POST /werewolf-games/:gameId/fill-with-npcs` exists since launch but had no UI affordance; users clicked "邀请 NPC" 9 times.
- **Fix**: add button that posts to the existing endpoint, only visible while status='waiting' and there are empty seats. PR #7.

## Fixed (PR opened)

- **CAND-001** — `werewolf-matches` 500 → 503 with sanitized message + idempotent regrant migration → **PR #4** (`overnight-qa/werewolf-matches-503-on-db-permission`). User must run `supabase db push` to fully resolve in prod.
- **CAND-005 → CAND-007** — fill-with-npcs button → **PR #7**.
- **CAND-006** — night-fold "夜 0" → **PR #6**.
- *(QA infrastructure, not a bug fix)* invariant scanner + batch sim → **PR #5**.

## Deferred / Not reproducible

## Health snapshots

| Time (UTC) | /health | /werewolf-games | /werewolf-matches | replay leak check | latency p50 |
|------------|---------|-----------------|-------------------|-------------------|-------------|
| 2026-05-09 17:25 | 200 (cold start, uptimeMs=3316) | 200 (`{"data":[]}`, 1.34s) | 500 INTERNAL_ERROR (CAND-001) | n/a — list 500 | 25.8s cold start; 1.3s warm |

## Round summaries

### Round 1 (17:25Z – 18:55Z)

**Pipelines run:**
- F (typecheck/lint/test gate): 1064/1064 passing on main. ✅
- D (production health probe): /health 200, /werewolf-games 200, /werewolf-matches **500** → CAND-001. /api/v1/docs/werewolf-agent-guide **404** → discovered later in Round 2.
- B (replay invariant scanner): scanner built + 56 random matches scanned, 0 violations.
- C (frontend↔backend contract scan): 5 candidates filed (CAND-001 through CAND-005). No shape mismatches; three of them are missing-feature (not bugs).

**Shipped:**
- **PR #4** — `werewolf-matches` 500 → 503 with sanitized message + idempotent regrant migration. (CAND-001)
- **PR #5** — replay invariant scanner + batch sim runner (QA infra). (CAND-005 supplemental)

### Round 4 (~20:25Z – ~02:35Z next day) — security + race + state-machine

**Targets:**
- Spawn fresh Explore agent against unreviewed surfaces (mailbox, lobby registry, action validator, SSE).
- Property-based fuzz over the engine state machine.
- Engine state-machine corner cases (double-death dedup).

**Shipped:**
- **PR #14** — *P1 authorization bypass*. `start`, `inviteNpc`, `fillWithNpcs` had no host-only check; any logged-in user could start/grief any lobby they discovered via the public list. Adds `creatorUserId` + `assertCreatorOnly` on those three operations. Multi-user `inviteAgent` deliberately stays open (multi-host design intent).
- **PR #15** — *P1 race condition*. `inviteAgent` reads seat, awaits agentConfigStore.get, writes seat — two concurrent invites for the same empty seat both passed the empty check and clobbered each other. Adds a synchronous post-await re-check.
- **PR #16** — *P2 visual*. Phase indicator showed "异常终止" (label) + "WAITING FOR PLAYERS" (subtitle) on a failed pre-start match, and "🌙 夜 0" / "☀️ 天 0" on a phase-prefixed `currentPhase` with sentinel `nightNumber`/`dayNumber=0`. Both fixed; subtitle now driven by status first.
- **PR #17** — *property fuzz*. 8-seed engine fuzz pinning 7 invariants over full random matches.
- **PR #18** — *test pinning*. Pins `phases.ts:49` dedup of wolf-kill+witch-poison-same-target so a future change can't silently re-introduce duplicate death entries.
- **PR #19** — *fault-domain alignment*. Lobby registry was flattening orchestrator's "completed-with-warning" into `failed` whenever `saveMatchArtifact` threw post-game. Now checks `getMatchSummary` post-throw.

### Round 3 (19:55Z – ~20:25Z)

**Targets:**
- Security review of token-emitting endpoints (Explore agent flagged missing no-cache headers).
- Resilience review of orchestrator paths around the decision trace store.

**Shipped:**
- **PR #10** — `Cache-Control: no-store` on `POST /me/werewolf-agents` and rotate-token responses.
- **PR #11** — same defense on `POST /agents/invites` (poker-side parallel).
- **PR #12** — match-runner wraps `recordWerewolfDecisionTrace` in try/catch so a trace store failure (cap exceeded, PG permission-denied, transient hiccup) no longer crashes the match.

### Round 2 (18:55Z – 19:55Z)

**Targets:**
- Suspicious patterns flagged by Explore agent in `werewolfRoomReducer.ts` and `match-runner.ts`.
- Adversarial-input fuzz on engine.
- Deeper production probe.

**Shipped:**
- **PR #6** — fix `🌙 夜 0` night-fold appearing before `phase.changed` populates `nightNumber`. (CAND-006)
- **PR #7** — one-click "fill 9 NPCs" button surfaces the existing fill-with-npcs route. (CAND-007)
- **PR #8** — engine `applyAction` adds `default` arm so unknown action.type → typed `InvalidWerewolfActionError` instead of silent `undefined` → orchestrator crash → 500.
- **PR #9** — Dockerfile + .dockerignore include `werewolf-http-agent-guide.md` so the prod `docs` endpoint stops 404-ing (CAND-008 below).

### CAND-008 — `/api/v1/docs/werewolf-agent-guide` 404 in production [P1, severity: state-mismatch] [PR #9]
- Discovered Round 2.
- `.dockerignore` had flat `docs` exclusion + Dockerfile didn't COPY the file → route's `resolve(HERE, '../../../../docs/...')` resolved to a non-existent path → 404.
- **Fix**: keep `docs/**` excluded but re-include `docs/werewolf-http-agent-guide.md`; add one COPY in the runner stage. PR #9.

## Final stats

- **16 PRs opened** (this doc is #13), all on `overnight-qa/*` branches, none merged (waiting on user review).
- **0 changes to `main`**.
- **0 production data touched**.
- **All local tests still pass** at end of each shipped commit (1064 → 1075 across the branch set).

## PR scorecard

| #   | Title                                                                | Severity   | Touches prod? |
|-----|----------------------------------------------------------------------|------------|---------------|
| #4  | werewolf-matches 503 + idempotent regrant migration                  | P1         | yes — needs `supabase db push` |
| #5  | replay invariant scanner (QA infra)                                  | infra      | no |
| #6  | suppress "夜 0" night-fold cosmetic                                  | P2 visual  | no |
| #7  | one-click "fill 9 NPCs" button                                       | feature    | no |
| #8  | engine rejects unknown action.type → typed 400 not silent crash      | P2 fix     | no |
| #9  | Dockerfile + .dockerignore include werewolf-http-agent-guide.md      | P1 deploy  | yes — next deploy fixes it |
| #10 | no-store on werewolf-agents token responses                          | security   | no |
| #11 | no-store on agent-invites token responses                            | security   | no |
| #12 | match-runner survives decision-trace-store failures                  | P2 fix     | no |
| #14 | host-only authorization on start/fill-with-npcs/invite-npc           | **P1 sec** | no |
| #15 | inviteAgent race condition — re-check seat after await               | **P1 fix** | no |
| #16 | phase indicator subtitle on failed match + 夜 0 / 天 0 cosmetic      | P2 visual  | no |
| #17 | engine property fuzz with 7 invariant gates                          | infra      | no |
| #18 | pin wolf-kill+witch-poison same-target dedup                         | test       | no |
| #19 | lobby registry keeps status=completed when post-game persist fails   | P2 fix     | no |

## Operator action checklist

When you wake up:

1. `gh pr list --search "[overnight-qa]"` — see all 16 PRs.
2. Review them in roughly the listed order (#4 first; that's the only prod-impacting one that needs an action beyond merge).
3. After merging #4: run `supabase db push` against the production Supabase project. The new migration `20260510000000_werewolf_public_view_regrant.sql` re-asserts SELECT grants to anon/authenticated on the public match views. Without that step the API still returns 503 (better than 500, but still broken).
4. After merging #9: the next Render deploy will include the agent-guide markdown so `/api/v1/docs/werewolf-agent-guide` stops 404-ing.
5. Optional features deferred: CAND-003 (no web replay UI), CAND-004 (no agent-config UI). Both are substantial product builds — not bugs.

## Items deliberately not fixed tonight

- **CAND-002** (match.started role broadcast) — documented as intentional design (ISSUE-005 reference). User decision required.
- **CAND-003** + **CAND-004** — feature gaps too big for a per-PR overnight cycle.
- **Object-store decision-trace race condition** flagged by Explore agent — out of scope (would require a real concurrency primitive); filed here as a deferred item.

## What I'd do next round if you ran it again

- Live `/qa` browser run against `https://werewolf-api-ttsb.onrender.com/werewolf` once a real session can be set up (current session has no browser cookies / supabase auth).
- More fuzz scanning with seeds that produce the longest possible matches (the random mock occasionally produces 17-night games — those are the best stress tests for the cap-related code paths).
- Deeper read of `WerewolfTableSurface.tsx` and `WerewolfPhaseIndicator.tsx` for ARIA / state-leak / focus-management issues.
- Review `agent-poker-platform-overview.md` for any documented but un-implemented invariants.
