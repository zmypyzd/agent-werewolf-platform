# Werewolf NPC Thinking-Time Design

**Date:** 2026-05-06
**Status:** Approved

## Problem

The werewolf NPC agents (`WerewolfMockAgent`, `WerewolfRandomMockAgent`) currently:
- Return decisions instantly with zero perceptible delay
- Return empty `inner`, `performance`, and `speech` strings for speak actions
- Never populate `reasoningSummary`
- Leave the frontend unable to show any meaningful "thought content" in the event timeline

The spectator experience is consequently lifeless — all nine NPCs snap through decisions with no observable reasoning or narrative weight.

## Goal

1. **Backend:** Introduce a `WerewolfNpcAgent` wrapper that adds a configurable thinking delay, generates role-aware speech content (`inner`, `performance`, `speech`), and produces a meaningful `reasoningSummary` (intent + keyObservations).
2. **Frontend:** Show a distinct "thinking…" state on the seat card while the NPC deliberates, transition to "speaking…" when a speak action arrives, and render the speech quote + reasoning intent as a two-line timeline entry.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| `inner` visibility | Broadcast on public match topic | Single-spectator demo; simplest path |
| Seat card states | thinking → speaking → waiting (three states) | Matches the actual event lifecycle |
| Timeline speech format | Speech quote + indented reasoning intent line | Readable without being overwhelming |
| Personality axis | `cautious` / `aggressive` / `balanced` | Enough variation without combinatorial explosion |

## Architecture

### Approach

Wrapper agent + minimal patches to existing event pipeline. No new `WerewolfReplayEventType` values needed — the existing `agent.action_requested` / `agent.action_received` pair already encodes the thinking start/end boundary.

### Backend

#### `packages/agent-runtime/src/werewolf-npc-agent.ts` (new)

```
WerewolfNpcPersonality = 'cautious' | 'aggressive' | 'balanced'

WerewolfNpcConfig {
  thinkingDelayRange: [min: number, max: number]   // default [1500, 3500] ms
  personality: WerewolfNpcPersonality               // default 'balanced'
  seed?: string                                     // passed to createSeededRng for reproducibility
}
```

`requestDecision(req: WerewolfDecisionRequest)` flow:

1. Delegate to inner agent → get raw decision (near-instant for `WerewolfRandomMockAgent`)
2. Sleep `rand(min, max)` ms (observable thinking delay)
3. If `action.type === 'speak'`:
   - Overwrite `action.inner` with a role-aware private monologue
   - Overwrite `action.performance` with a non-verbal descriptor
   - Overwrite `action.speech` with a public statement shaped by role + personality
4. Set `response.reasoningSummary` for all action types
5. Return enriched response

**Content generation:**

| Field | Source |
|---|---|
| `inner` | `privateState.selfRole` + current threat/knowledge — reveals actual intent |
| `speech` | Role strategy × personality — cautious hedges, aggressive accuses, balanced analyzes |
| `performance` | Short non-verbal descriptor picked from per-personality pool |
| `reasoningSummary.intent` | 1-line strategic summary (≤ 200 chars) |
| `reasoningSummary.keyObservations` | 2–4 strings derived from live game state (night count, deaths, vote history, seer knowledge) |
| `reasoningSummary.confidence` | 0.55–0.95; aggressive skews high, cautious skews mid |

All RNG uses `createSeededRng(seed + agentId)` from `werewolf-prng.ts` so content is reproducible for a given seed.

**Role × personality speech strategy matrix (representative):**

| Role | cautious | aggressive | balanced |
|---|---|---|---|
| werewolf | deflect with questions, avoid naming wolf teammates | confidently accuse a non-wolf | mild misdirection toward a safe target |
| villager | express uncertainty, invite others to speak | accuse based on behavioral reads | analyze vote history and night deaths |
| seer | hint at knowledge without committing | directly announce findings | present findings with logical reasoning |
| witch | play dumb, say little | hint at having special information | neutral commentary |
| hunter | vague warning about their ability | explicit threat to take someone down | measured statement about who seems suspicious |

#### `packages/agent-runtime/src/sanitize-action.ts` (patch)

Remove `inner` stripping from the `speak` branch — `inner` is now intentionally public:

```ts
case 'speak':
  return {
    type: 'speak',
    playerId: action.playerId,
    inner: action.inner,          // was omitted previously
    performance: action.performance,
    speech: action.speech,
  };
```

#### `packages/realtime/src/werewolf-filter.ts` (patch)

Delete the `containsSpeakInner` / `stripSpeakInner` functions and the block in `werewolfReplayEventToPublic` that calls them. `inner` is now intentionally broadcast on the public match topic. Also remove the corresponding test assertions in `packages/realtime/src/__tests__/werewolf-filter.test.ts` that verify stripping behaviour.

#### `packages/werewolf-orchestrator/src/match-runner.ts` (patch)

Include `reasoningSummary` in the `agent.action_received` event payload for day phases only (night identity is already stripped, but intent text could leak role):

```ts
this.emit('agent.action_received', {
  // ... existing fields ...
  ...(parsedReasoningForTrace && !phaseBefore.startsWith('night-')
    ? { reasoningSummary: parsedReasoningForTrace }
    : {}),
});
```

### Frontend

#### `apps/web/src/werewolf-room/werewolfRoomTypes.ts`

- Replace `currentActor?: string` with `thinkingActor?: string` and `speakingActor?: string`
- Add `'reason'` to `WerewolfTimelineLineKind`
- Add optional `sub?: string` to `WerewolfTimelineLine` (carries `performance` descriptor)

#### `apps/web/src/werewolf-room/werewolfRoomReducer.ts`

| Event | State change |
|---|---|
| `agent.action_requested` | `thinkingActor = playerId`, clear `speakingActor` |
| `agent.action_received` (speak) | clear `thinkingActor`, `speakingActor = playerId` |
| `agent.action_received` (other) | clear both |
| `phase.changed` | clear both |

For `agent.action_received` with `action.type === 'speak'`, produce two timeline lines:
1. `kind: 'speak'`, text: `${name}: "${speech}"`, `sub: performance`
2. `kind: 'reason'`, text: `💭 ${reasoningSummary.intent}` (only when `reasoningSummary` is present)

#### `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts`

Update `agent.action_received` handler to:
- Read `action.speech`, `action.performance`, `reasoningSummary` from `event.data`
- Return two lines for speak actions (speak + reason), one line otherwise
- Return type widens to `WerewolfTimelineLine | WerewolfTimelineLine[] | null`

> **Note:** The reducer must handle both single-line and multi-line returns from this function.

#### `apps/web/src/werewolf-room/WerewolfTableSurface.tsx`

`SeatCard` props: replace `speaking: boolean` with `thinking: boolean` and `speaking: boolean`.

Status label logic:

```
thinking → "thinking…"
speaking → "speaking…"
dead     → "✝ 已淘汰" / role label
else     → "waiting"
```

CSS classes: `is-thinking` (dim pulse, subdued) and `is-speaking` (bright, existing animation).

Callers: `thinking={state.thinkingActor === seat.playerId}` and `speaking={state.speakingActor === seat.playerId}`.

#### `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx`

`kind: 'reason'` entries render:
- Indented (left padding ~16px)
- Color: `--text-muted`
- Font: `JetBrains Mono`, italic
- No timestamp (visually subordinate to the speak line above)

`sub` text on speak entries renders below the speech quote in `--text-dim`, smaller font size.

## Data Flow

```
WerewolfNpcAgent.requestDecision()
  └─ inner.requestDecision() → raw action
  └─ sleep(thinkingDelay)
  └─ enrich speak fields + reasoningSummary
  └─ return enriched WerewolfDecisionResponse

match-runner.runOneAction()
  └─ emit agent.action_requested  →  frontend: thinkingActor = playerId
  └─ TimeoutHandler → WerewolfNpcAgent (includes delay)
  └─ sanitizeActionForBroadcast(action)  [inner now passed through]
  └─ emit agent.action_received  →  frontend:
       speak action → speakingActor = playerId + two timeline lines
       other action → both actors cleared + one timeline line
  └─ reasoningSummary attached for day phases

werewolfReplayEventToPublic()
  └─ strips actor fields for night phases (unchanged)
  └─ no longer strips inner from speak actions
```

## Testing

### New: `packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts`

- `vi.useFakeTimers()` — assert `requestDecision` resolves only after minimum delay
- Speak action enrichment: `inner`, `performance`, `speech` all non-empty, within schema length caps
- All action types: `reasoningSummary` has non-empty `intent`, `confidence` in `[0, 1]`, ≥1 `keyObservation`
- Seeded RNG reproducibility: same seed + agentId → identical content on two calls

### Updated: `packages/agent-runtime/src/__tests__/sanitize-action.test.ts` (if it exists) or inline

- Speak branch now passes `inner` through (not stripped)

### Updated: `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts`

- Day-phase `agent.action_received` carries `reasoningSummary` when agent provides one
- Night-phase `agent.action_received` does not carry `reasoningSummary`

### Updated: `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`

- `agent.action_requested` → `thinkingActor` set, `speakingActor` undefined
- `agent.action_received` (speak) → `speakingActor` set, `thinkingActor` cleared
- `agent.action_received` (vote) → both cleared
- `phase.changed` → both cleared
- Speak action produces two timeline lines (speak + reason); missing `reasoningSummary` produces only speak line

## Privacy Note

Removing `inner` stripping is a **deliberate, scoped decision** for this single-spectator demo. If the platform ever adds multi-player or live opponent spectators, `inner` must be restored to the per-player private channel and stripped from public broadcasts. This decision should be reviewed before any multi-player expansion.
