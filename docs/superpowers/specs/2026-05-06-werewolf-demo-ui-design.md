# Werewolf Demo UI — Design

**Status:** approved (brainstorm), ready for plan
**Date:** 2026-05-06
**Owner:** zmy
**Scope:** demo-level frontend + thin lifecycle API for the existing 9-player werewolf platform

## Goal

Add a minimal end-to-end UI flow that lets a user:

1. Open the web app, navigate to a new "Werewolf" section.
2. Create a werewolf game (no login required).
3. Invite NPC agents to the 9 seats — either one-by-one or "fill all".
4. Start the match.
5. Watch the match unfold live in a spectator view (seats, phase, public event timeline).
6. See a final banner with the winner and revealed roles when the match ends.

The orchestrator, engine, persistence, realtime hub, and artifact-read routes
already exist (see `docs/agent-poker-werewolf-platform-overview.md`). This work
adds **only the lifecycle API + the spectator UI**; nothing in
`packages/werewolf-*` or `packages/realtime` changes.

## Non-goals

- Human-as-player seats. NPCs only.
- A "god mode" view that bypasses the hub's public projection.
- A separate `/werewolf-matches/:id` replay UI for the persisted artifact. The
  artifact is still written, but viewing it is out of scope. The user stays on
  the live spectator page after the match completes.
- Persisting lobby (pre-start) state across API restarts.
- Multi-user coordination beyond what natural fan-out via the existing WS hub
  provides. Multiple browsers can spectate the same game; nobody needs to
  "claim" a seat in the lobby.
- Authentication, account ownership of games, "kick player" / "leave seat".
- Playwright e2e. Manual run-through is the acceptance test.

## Architecture

All new code lands in two layers; no package internals change.

```
apps/api/src/routes/werewolf-games.ts          NEW  lifecycle routes + in-memory lobby registry
apps/api/src/server.ts                         EDIT register the new plugin (uses existing werewolfOrch)

apps/web/src/pages/WerewolfLobbyPage.tsx       NEW  list + create
apps/web/src/pages/WerewolfRoomPage.tsx        NEW  pre-start invite panel ↔ live spectator (status-driven)
apps/web/src/werewolf-room/                    NEW  reducer + view-models + presentational components
   werewolfRoomTypes.ts
   werewolfRoomReducer.ts
   normalizeWerewolfReplayEvent.ts
   WerewolfTableSurface.tsx
   WerewolfEventTimeline.tsx
   WerewolfPhaseIndicator.tsx
   __tests__/
apps/web/src/router.tsx                        EDIT add /werewolf and /werewolf/:gameId
apps/web/src/components/AppShell.tsx           EDIT add "Werewolf" nav entry
```

`WerewolfOrchestrator`, `attachWerewolfHub`, `werewolfMatchTopic`,
`WerewolfRandomMockAgent`, the existing `/werewolf-matches` artifact routes,
and the WS plugin are reused as-is.

## Server: lifecycle API

A new Fastify plugin under `/api/v1`. **Public — no `requireAuth`.** Mutating
routes still require CSRF (`X-Requested-With: fetch`), consistent with the rest
of the API.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/werewolf-games` | `{ name?: string, seed?: string }` | `LobbyEntry` (see shape below; `seed` never echoed) |
| `GET`  | `/werewolf-games` | — | `{ data: GameSummary[] }` where `GameSummary = Omit<LobbyEntry, 'seats'> & { seatedCount: number }`; sorted recent-first, capped at 50. |
| `GET`  | `/werewolf-games/:gameId` | — | `LobbyEntry` |
| `POST` | `/werewolf-games/:gameId/seats/:seatIndex/invite-npc` | `{ displayName?: string }` | updated state |
| `POST` | `/werewolf-games/:gameId/fill-with-npcs` | — | updated state |
| `POST` | `/werewolf-games/:gameId/start` | — | `202`, body `{ status: 'running' }`. Returns immediately; events flow over WS. |

### Game status state machine

```
waiting   →  ready    →  running   →  completed
   │           │            │
   └─ invite/fill─┘         └─ failed (catastrophic orchestrator error)
```

Transitions:
- `waiting → ready`: triggered by the invite/fill route once `seatedCount === 9`.
- `ready → running`: triggered by `POST /start`. Calls `werewolfOrch.runMatch(gameId)` (not awaited). The promise is tracked internally; on resolve, status flips to `completed`; on reject, `failed`.
- Illegal transitions return `409 Conflict` with an `AppError` code (e.g. `WEREWOLF_GAME_NOT_READY`, `WEREWOLF_GAME_ALREADY_STARTED`, `WEREWOLF_SEAT_OCCUPIED`).

### `WerewolfLobbyRegistry` (new, in-memory)

Lives inside the route plugin. **Not** added to any package — it's UI-presentation
metadata that the engine/orchestrator should not know about.

```ts
interface SeatInfo {
  seatIndex: number;       // 0..8
  playerId: string;        // p1..p9, deterministic from seatIndex
  displayName: string;     // user-supplied or default ("Bot 3")
  occupant: 'empty' | { kind: 'npc'; agentKind: 'random' };
}

interface LobbyEntry {
  gameId: string;
  name: string;
  seats: SeatInfo[];          // length 9, ordered by seatIndex
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: 'good' | 'werewolf';     // populated on completion from match summary
}
```

The registry exposes:
- `create(input): LobbyEntry` — also calls `werewolfOrch.createGame({ gameId, seed })`.
- `get(gameId)`, `list()`.
- `inviteNpc(gameId, seatIndex, displayName?)` — constructs a fresh `WerewolfRandomMockAgent` seeded as `<seed>-<playerId>` (where `seed` is the seed passed to `POST /werewolf-games` if provided, else the `gameId`). Calls `werewolfOrch.registerAgent(gameId, playerId, agent, …)`. Errors `WEREWOLF_SEAT_OCCUPIED` (409) if the seat already has an occupant.
- `fillWithNpcs(gameId)` — invites NPCs into every currently empty seat. Idempotent: if all 9 are already filled, returns the current state with 200 (no error).
- `start(gameId)` — calls `werewolfOrch.runMatch(gameId)` without awaiting. Stores the returned promise; `.then(summary)` flips status to `completed` and copies `winner` + per-seat `revealedRole` from the `WerewolfMatchSummary`'s `finalPlayers`. `.catch(err)` flips status to `failed` and records the error message.

The registry is reset whenever the API process restarts. This is acceptable
for a demo: any in-flight match is gone with the process anyway, and the
artifact for completed matches is still in `IWerewolfMatchArtifactStore`.

### Information isolation in lifecycle responses

Even though every game is public, the lifecycle responses must respect the same
invariants the artifact route does:

- **Never echo `seed`** in any response. The seed is accepted on `POST /werewolf-games` but is one-way: it goes into `werewolfOrch.createGame()` and is discarded from the registry's serialization layer. Pinned by an `info-isolation` test.
- **Never include role information** in seat metadata. Seats expose `displayName` and `occupant.kind`; nothing role-derived.

These mirror the defenses already in `apps/api/src/routes/werewolf-matches.ts`.

## Frontend: pages and routing

### Routing

```tsx
// router.tsx — no ProtectedRoute wrapper, AppShell only.
{ path: '/werewolf', element: <AppShellRoute><WerewolfLobbyPage /></AppShellRoute> },
{ path: '/werewolf/:gameId', element: <AppShellRoute><WerewolfRoomPage /></AppShellRoute> },
```

`AppShell` gets a "Werewolf" link alongside the existing nav entries.

### `WerewolfLobbyPage.tsx`

- Top: create form — optional `name`, optional `seed`. Submit → `POST /werewolf-games` → `navigate('/werewolf/' + gameId)`.
- Bottom: list — `GET /werewolf-games` polled every 5s. Each row: `gameId / name / status / seatedCount/9 / createdAt`. Click → navigate to room.
- Errors via existing `ApiError` flow.

### `WerewolfRoomPage.tsx`

A single page that switches its rendering on the game's `status`:

| status | UI |
|---|---|
| `waiting` / `ready` | Invite panel: 9 seats around a circle. Each empty seat has an "邀请 NPC" button. Above: "一键填满 9 个 NPC". When `status === 'ready'`: a primary "开始对局" button appears. |
| `running` | Spectator panel: same 9 seats (now showing alive/dead), top phase indicator, right-side event timeline. |
| `completed` | Spectator panel frozen at the last frame, plus a banner ("好人胜" / "狼人胜"), every seat reveals its true role, and a "返回大厅" button. |
| `failed` | Banner with error reason + "返回大厅". |

Lifecycle:
- On mount: `GET /werewolf-games/:gameId`.
- While `status ∈ {waiting, ready}`: poll `GET /werewolf-games/:gameId` every 2s so concurrent invites from another tab show up.
- On `POST /start` success: optimistically flip local state to `running` and open WS subscription.
- While `status === 'running'`: subscribe to `werewolfMatchTopic(gameId)` via the existing `WsClient`. Each `WerewolfReplayEvent` goes through the reducer. **Also** keep a low-frequency (5s) poll of `GET /werewolf-games/:gameId` as a fallback — if the WS misses the terminal `match.completed` event, the polled status flip still drives the UI to `completed` and pulls the final winner/roles.
- On `status === 'completed'`: stop WS + polling. Pull the final summary from the polled `GET` response (the registry populates `winner` + roles from `werewolfOrch`'s match summary).

### `werewolf-room/` components

Mirror the `live-table/` directory layout but simpler: a single reducer, a single
event-to-line normalizer, and three presentational components.

- **`werewolfRoomTypes.ts`**: `WerewolfRoomState` (full UI state), `SeatVM` (per-seat view-model), `WerewolfTimelineLine` (one row in the timeline).
- **`werewolfRoomReducer.ts`**: pure `(state, WerewolfReplayEvent) → state`. Tracks `currentPhase`, `dayNumber`, `nightNumber`, per-seat `alive`, per-seat `revealedRole?`, `currentActor?` (only set during day phases — see invariant below), `winner?`, and the appended timeline lines.
- **`normalizeWerewolfReplayEvent.ts`**: maps each `WerewolfReplayEvent` to a `WerewolfTimelineLine` plus the state patch. The mapping table:

| ReplayEvent | TimelineLine |
|---|---|
| `match.started` | "对局开始" |
| `phase.changed` to `night-*` | "🌙 夜 N" |
| `phase.changed` to `day-*` | "☀️ 天 N" |
| `agent.action_received` `speak` | `<name> 发言` (random NPC text is placeholder) |
| `agent.action_received` `vote` | `<name> 投 <target>` |
| `engine.action_applied` with eliminated player | "💀 `<name>` 被淘汰（身份：`<role>`）" |
| `match.completed` | "🏁 终局：好人胜 / 狼人胜" |
| Consecutive events in any `night-*` phase | Collapsed into a single rolling line "🌙 夜 N · 狼人/预言家/女巫行动中…" while the phase persists; replaced by the resulting day-open line on phase change. |
| Any other `agent.action_*` / `engine.*` event during the day | Single grey "系统事件" line. |

- **`WerewolfTableSurface.tsx`**: 9-seat circular layout. Props: `seats: SeatVM[9]`, `currentActor?: playerId`, `revealRoles: boolean` (true when game is over). Empty seats render an "邀请 NPC" button (only used in waiting/ready states; in running/completed, all 9 are filled).
- **`WerewolfEventTimeline.tsx`**: scrollable column on the right; props `lines: WerewolfTimelineLine[]`. Auto-scrolls to bottom when a new line lands.
- **`WerewolfPhaseIndicator.tsx`**: top label — emoji + 阶段名 + day/night number.

### Reused infrastructure

- `apps/web/src/lib/api.ts` and `lib/ws.ts` — unchanged.
- `apps/web/src/components/AppShell.tsx` — only edited to add the nav link.
- Styling — same Tailwind/shadcn-style classes already in `live-table/`.

## Information-isolation invariants

The same five invariants from `docs/agent-poker-werewolf-platform-overview.md`
apply, defended by:

1. **Night actor identity** — already redacted by `werewolfReplayEventToPublic` before reaching the WS topic. Defended again in the **frontend reducer**: `currentActor` is **never** populated during a `night-*` phase, even if the (theoretically impossible) public event ever included a `playerId`. Pinned by a reducer test.
2. **Match seed** — never echoed by lifecycle responses (registry-level destructure-and-omit). Pinned by a test.
3. **`speak` action `inner` field** — already stripped by `sanitizeActionForBroadcast`. The frontend never reads `inner`; only `text`.
4. **Decision trace `privateStateHash` + `reasoningSummary`** — out of scope for this UI; spectator view does not show decision-trace data.
5. **`player:<userId>:<gameId>` topic** — out of scope; demo subscribes only to the public `werewolfMatchTopic`.

## Tests

| Layer | File | Coverage |
|---|---|---|
| API | `apps/api/src/__tests__/werewolf-games.test.ts` | Lifecycle: create / invite / fill / start / list / get. Illegal transitions: start before 9/9, double-start, invite into occupied seat (409), invite into running game. |
| API | `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts` | Lobby responses never include `seed`; seat metadata never includes role. |
| Web reducer | `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts` | Phase counter, alive/dead, winner derivation, vote-noise folding, **night-actor invariant** (currentActor empty during night). |
| Web normalizer | `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts` | Each event type → TimelineLine snapshot; speak/vote names look up correctly; eliminated player line includes role. |
| Web smoke | `WerewolfLobbyPage.test.tsx`, `WerewolfRoomPage.test.tsx` | Mock api/ws; render once per status (waiting / ready / running / completed). |
| Manual | README addendum in `examples/werewolf-local-simulation/README.md` or new `apps/web/README` section | `pnpm dev:api` + `pnpm --filter web dev` → create → fill → start → observe → win banner. |

No Playwright e2e for this milestone.

## Risks and accepted limits

- **Random NPC speak text is a placeholder.** Timeline lines show `<name> 发言` without content. The match still progresses mechanically (votes, eliminations) which is what makes the demo readable. When real LLM agents replace the NPC, content fills in automatically — no UI change needed.
- **Lobby state is in-memory.** API restart kills any pre-start games. Acceptable for demo; production would persist via a real store.
- **No "leave seat" / "kick player".** Once a seat is occupied, the only way out is to abandon the game.
- **Concurrent invitations into the same seat** are resolved at the registry level (`WEREWOLF_SEAT_OCCUPIED`, 409). The losing client refreshes via the 2s poll.
- **Frontend WS terminal-event reliability.** Mitigated by the parallel 5s `GET` poll while running — `status === 'completed'` from the poll is sufficient to drive the final UI even if a `match.completed` event is dropped.

## Open follow-ups (not part of this plan)

- A persisted-artifact replay UI at `/werewolf-matches/:id` (the API route already exists).
- A real `WerewolfWsAgentAdapter` so external agents can subscribe + decide.
- A "single human player" mode that subscribes to `player:<userId>:<gameId>`.
- Persisting lobby state across restarts.

## Acceptance

The implementation is done when:

- `pnpm dev:api` + `pnpm --filter web dev` lets a fresh user navigate from the home shell to `/werewolf`, create a game, fill it with NPCs, start it, and watch a match run to completion with a winner banner — without logging in.
- All listed tests pass.
- A repeated `pnpm demo:werewolf` from `examples/werewolf-local-simulation` continues to work unchanged (no regressions in the existing path).
