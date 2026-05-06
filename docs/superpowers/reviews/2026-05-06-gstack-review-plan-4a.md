# Plan 4a Pre-Landing Review — Persistence & Public Projection

**Reviewer:** independent gstack-style reviewer
**Date:** 2026-05-06
**SHA range:** `8cf5ba9..3449b8d` (18 commits)
**Plan:** `docs/superpowers/plans/2026-05-05-werewolf-plan-4a-persistence-and-projection.md`

The diff lands the persistence + redaction foundation that Plans 4b/4c build on:
shared types (`WerewolfReplayEvent`, `WerewolfDecisionTrace`), a public-event
filter (`werewolfReplayEventToPublic`), Memory + Object stores for both
artifacts and traces, decision-trace recording with reasoning caps, and
orchestrator wiring + `deleteMatch`. Verified locally: `pnpm --filter
@agent-poker/persistence run build` succeeds; `pnpm --filter
@agent-poker/persistence run test` is 90/90 green; orchestrator suite is
70/70 green.

## Strengths

- **Privacy redaction is layered and pinned by tests, not just types.** The
  five plan-4a invariants each have ≥2 enforcement points + a test:
  - Night-actor identity: `werewolfReplayEventToPublic`
    (`packages/realtime/src/werewolf-filter.ts:23-28`) strips
    `playerId`/`agentId` for `agent.action_*` events when `phase ∈
    {night-werewolf-vote, night-witch, night-seer}`. Pinned by
    `werewolf-filter.test.ts:59-143` and end-to-end by
    `orchestrator-persistence.test.ts:50-69`.
  - Match seed: stripped from `match.started`
    (`packages/realtime/src/werewolf-filter.ts:33-36`) and pinned by both
    `werewolf-filter.test.ts:13-27` and an E2E persisted-artifact assertion
    (`orchestrator-persistence.test.ts:71-84`). The fix commit `3449b8d`
    explains the threat model in the code comment ("seed plus the engine's
    reproducibility property would let a viewer derive every private RNG draw").
  - `speak.inner`: stripped at three layers — `sanitizeActionForBroadcast`
    (`packages/werewolf-orchestrator/src/sanitize-action.ts:22-28`),
    `werewolfReplayEventToPublic`'s recursive `stripSpeakInner`
    (`packages/realtime/src/werewolf-filter.ts:39-41,75-85`), and
    `toTraceAction` in the recorder
    (`packages/werewolf-orchestrator/src/decision-trace-recorder.ts:74-80`).
  - Night-action target IDs (`witch-save`/`witch-poison`/`seer-divine`/`werewolf-vote`)
    redacted at the type layer in `WerewolfDecisionTraceAction`
    (`packages/shared/src/werewolf-decision-trace.ts:23-44`) — the union no
    longer carries `targetId`, so the recorder's strip is type-enforced; no
    cast required.
  - Public history projection drops `role-assigned` + `night-action` and
    strips `speak.inner` (`packages/persistence/src/werewolf-match-artifact-serialization.ts:113-143`)
    with a `_exhaustive: never` guard so adding a new history variant breaks
    compilation until classified.
- **Real engine in integration tests, no mocking.**
  `decision-trace-recording.test.ts:9-34` and the three orchestrator-persistence
  tests run `WerewolfMatchRunner` end-to-end against the real engine and the
  real `MemoryWerewolfDecisionTraceStore` / `MemoryWerewolfMatchArtifactStore`.
  Recovery from real game-overs is exercised, not hand-rolled.
- **Persist-error vs game-error contract is documented and tested.**
  `orchestrator.ts:155-176` carefully distinguishes a runner failure from a
  persist failure and the new test
  (`orchestrator-persistence.test.ts:86-110`) pins both branches: a
  saveMatchArtifact throw surfaces to the caller while leaving
  `entry.status === 'completed'` and `getMatchSummary` populated, and
  re-running reports "already completed" rather than "failed previously".
  This is a non-obvious lifecycle concern handled cleanly.
- **Dependency DAG is preserved.** `packages/persistence/package.json:18-22`
  adds `@agent-poker/realtime` (not `werewolf-orchestrator` or higher).
  `packages/werewolf-orchestrator/package.json:18-25` adds only
  `@agent-poker/persistence` (at SHA `3449b8d`; the realtime dep arrives
  later in plan-4b). `WerewolfReplayEvent` correctly relocated to
  `@agent-poker/shared` so realtime + persistence consume it without
  importing the orchestrator. tsc composite refs and `paths` updated in
  lockstep.
- **Reasoning cap is enforced where data enters the recorder, not at the
  store boundary.** `decision-trace-recorder.ts:106-114` truncates
  `intent` to 200 chars and trims to ≤10 observations of ≤200 chars each
  before the trace is persisted. The store's byte cap
  (`werewolf-decision-trace-store.ts:93-104`) is a second layer that
  catches anything else. Caps match the Zod schema in `agent-protocol`.
- **MemoryWerewolfDecisionTraceStore deep-clones on read and write.**
  `werewolf-decision-trace-store.ts:42-44,49,118-120` runs every trace
  through `JSON.parse(JSON.stringify(...))` before storing and on every
  list call. The new test `werewolf-decision-trace-store.test.ts:67-76`
  pins this — pushing onto the returned `validActionTypes` array doesn't
  leak back into the store. Stronger guarantee than a shallow clone.
- **`safePathSegment` is invoked at every store entry point.** Build,
  save, get, delete, and list all funnel matchId through
  `safePathSegment` (`match-artifact-serialization.ts:27-40`), throwing
  before any I/O. Tested both at the unit level
  (`werewolf-decision-trace-store.test.ts:60-65`) and the artifact level
  (`werewolf-match-artifact-serialization.test.ts:92-95`,
  `werewolf-match-artifact-store.test.ts:72-77,131-134`).
- **`werewolfReplayEventToPublic` returns the same reference for cheap
  pass-through.** `packages/realtime/src/werewolf-filter.ts:60` (returns
  `event` unchanged when no edits apply) is pinned by the assertion at
  `werewolf-filter.test.ts:163-170`. Subscribers can compare by reference
  to skip re-broadcasts.

## Issues

### Critical

None. Privacy invariants for plan-4a's scope are satisfied at the type and
test layers.

### Important

**1. `BuildWerewolfArtifactInput.seed` is required but never read.**
- File: `packages/persistence/src/werewolf-match-artifact-serialization.ts:28`
  declares `readonly seed: string`. `buildWerewolfArtifact` (lines 50-96)
  never references `input.seed`.
- What's wrong: a required input field is silently dropped. A future
  caller could reasonably believe the seed lands in the artifact and
  build a feature on that assumption. Discovery is post-implementation.
- Why it matters: weakens the invariant "match seed never leaks into
  public artifacts" — the type system isn't enforcing it; the
  implementation just happens to ignore it. If someone later adds
  `seed: input.seed` to the summary "to make it consistent with the
  input shape", invariant 2 breaks silently. (No public test currently
  asserts the absence of `seed` from the
  *summary* JSON — the test
  `orchestrator-persistence.test.ts:71-84` only asserts it's absent from
  `match.started` events.)
- Suggested fix: drop `seed` from `BuildWerewolfArtifactInput` (the
  orchestrator can stop passing it, `orchestrator.ts:207`). If kept for
  parity with poker, add a comment "// intentionally unused; do not
  persist" and a test asserting `summary` JSON has no `seed` key.

**2. `MemoryWerewolfMatchArtifactStore` does not enforce cost limits.**
- File: `packages/persistence/src/werewolf-match-artifact-store.ts:51-95`
  takes no `WerewolfMatchArtifactCostLimits` param and never checks
  payload sizes; `DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS` is used
  exclusively by `ObjectWerewolfMatchArtifactStore`.
- What's wrong: the asymmetry is silent. A test that uses the in-memory
  store (most integration tests) cannot exercise the size-cap branches.
  Production code that swaps stores via env may regress quietly.
- Why it matters: plan-4a's stated goal includes "byte/count caps" as a
  defense against runaway memory use. The Memory store is *more*
  vulnerable to runaway than the Object store (lives in process), yet
  has no cap. This mirrors poker's pattern (`MemoryMatchArtifactStore`
  does the same), so it's consistent — but consistency with a
  potentially-broken pattern isn't a strong defense.
- Suggested fix: either (a) add the same cost-limit gate to the Memory
  store (low effort, prevents runaway), or (b) document explicitly in
  the class JSDoc that limits are *only* enforced in the Object variant
  and that callers persisting many matches should use Object-backed
  storage.

**3. `containsSpeakInner` traversal can pick up arbitrary `speak`-typed
keys, not just true `WerewolfAction.speak` actions.**
- File: `packages/realtime/src/werewolf-filter.ts:62-73`. The recursive
  walk treats *any* object whose `type === 'speak'` and that has an
  `inner` own-property as a speak action.
- What's wrong: structural — not behavioral — concern. If a future event
  payload includes user-supplied data that happens to set
  `type: 'speak'` (e.g. a chat message echoing the protocol), `inner`
  will be silently dropped from that unrelated field even though it
  isn't a real speak action. Today this can't happen because event data
  shapes are tightly controlled by the runner, but the function reads
  as if it makes no such assumption.
- Why it matters: defense-in-depth shouldn't introduce surprises. The
  recursive `stripSpeakInner` could collapse legitimate fields whose
  *coincidentally* match the heuristic.
- Suggested fix: scope the strip to known event shapes
  (`engine.action_applied.action.inner`,
  `agent.action_*.action.inner`). Or document explicitly: "any object
  with `type: 'speak' + inner` field is treated as a speak action and
  redacted, regardless of nesting depth." Acceptable as documented; not
  a bug today.

### Minor

**1. Hash format inconsistency on the trace.**
- File: `packages/werewolf-orchestrator/src/decision-trace-recorder.ts:117`
  produces a bare 64-hex hash. The test fixture
  `packages/shared/src/__tests__/werewolf-decision-trace-shape.test.ts:19-20`
  uses 64-hex strings. The store sample
  `packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts:20-21`
  uses the literal strings `'sha-pub'`/`'sha-priv'`.
- What's wrong: the hash is just hex digits with no algorithm prefix
  (poker's pattern adds `sha256-` prefix in some places — see
  `werewolf-decision-trace-shape.test.ts:19` which uses bare hex too).
  No consumer parses the format yet, but a future analyzer that reads
  multiple traces can't distinguish algorithm changes.
- Suggested fix: prefix with `sha256-` once, lock with a regex assertion
  in a test (`/^sha256-[0-9a-f]{64}$/`). Low priority.

**2. Memory store's `getMatchArtifact` validates path segment but
`saveMatchArtifact` does not directly.**
- File: `packages/persistence/src/werewolf-match-artifact-store.ts:55-62`
  delegates to `buildWerewolfArtifact`, which calls `safePathSegment`.
  Sound today.
- What's wrong: implicit dependency. If `buildWerewolfArtifact` ever
  drops the `safePathSegment` call, the store would silently accept
  path-traversal matchIds again.
- Suggested fix: add a one-line `safePathSegment(input.matchId)` at the
  top of `MemoryWerewolfMatchArtifactStore.saveMatchArtifact` for
  symmetry with the Object variant's structure (Object also relies on
  `buildWerewolfArtifact`, but its keys derived from
  `record.manifest.matchId` would explode anyway). Defensive duplicate.

**3. `WerewolfReasoningSummary` exported from two places.**
- `packages/shared/src/werewolf-decision-types.ts:9-16` defines it.
- `packages/shared/src/werewolf-decision-trace.ts:2-4` re-exports the
  same name, but `index.ts:7` already wildcards `werewolf-decision-types`.
- What's wrong: duplicate `export type` paths increase the chance of an
  accidental two-source-of-truth divergence. Today both arrive at the
  same target type — fine — but it's cognitive noise.
- Suggested fix: delete the re-export in `werewolf-decision-trace.ts:2-4`.
  The trace file's `import type` is enough.

**4. Vacuous `appliedAction` assertion.**
- File: `packages/werewolf-orchestrator/src/__tests__/decision-trace-recording.test.ts:31-33`.
  `expect(t.appliedAction).toBeDefined()` is a near-trivial assertion —
  `appliedAction` is a non-optional field on the trace, so it can never
  be undefined.
- What's wrong: the test is described as "every trace has an applied
  action" but actually pins nothing more than the type system already
  guarantees.
- Suggested fix: assert `appliedAction.type` is in the
  `validActionTypes` set, or that for a non-fallback trace the
  applied type matches the response type. Cheap signal upgrade.

**5. `WerewolfDecisionTraceAction` for `werewolf-vote` collapses to bare
`{ type: 'werewolf-vote' }` — analyzer can't distinguish votes within
the same match.**
- File: `packages/shared/src/werewolf-decision-trace.ts:24`. Comment at
  lines 11-21 acknowledges the choice.
- Why it matters (minor, plan-acknowledged): once the night vote
  resolves, the collective decision is observable in
  `night-action.werewolfTarget` (which `toPublicWerewolfHistory` drops
  entirely from the public artifact). So the public trace has *zero*
  signal about who voted for whom in the wolf coalition. Plan
  acknowledges this and defers a richer "payload-redacted shape" to a
  follow-up.
- Suggested fix: none for plan-4a. Track as a follow-up if any analyzer
  consumer materializes.

**6. `containsSpeakInner` walks the entire `data` object on every event,
even those that can't carry speak.**
- File: `packages/realtime/src/werewolf-filter.ts:39-41,62-73`. Every
  filtered event undergoes the recursive scan, even
  `phase.changed`/`match.completed` which carry no action payload.
- Why it matters: micro-perf. For a typical match (~150 events), the
  scan is a handful of property reads each — negligible. Only worth
  flagging because the function is on the hot broadcast path.
- Suggested fix: gate the speak-inner check by event type
  (`engine.action_applied`, `agent.action_*`) the same way actor-strip
  is. Trades two extra branches for skipping the recursive walk.

## Recommendations

1. **Add a public-summary contract test** in
   `werewolf-match-artifact-serialization.test.ts` that asserts
   `summaryRaw` does NOT contain the substring `"seed"` and that
   `record.summary` has no `seed` property. This pins invariant 2
   independently of the orchestrator wiring.
2. **Document the Memory-store-no-limits asymmetry** in either the
   `MemoryWerewolfMatchArtifactStore` JSDoc or the package README
   excerpt. Today the asymmetry is only visible by reading both classes
   side-by-side. Keep it consistent with poker, but make it explicit.
3. **Drop or formalize `BuildWerewolfArtifactInput.seed`.** Either
   remove it (and update the orchestrator caller) or comment-and-test
   that it's deliberately ignored.
4. **Tighten `containsSpeakInner` to known event shapes.** Limits the
   blast radius of "any object with `type: 'speak' + inner` is
   redacted" to the events the runner actually emits.
5. **Land the trace-action richness work as a Plan 4c+ deferred item.**
   The current public trace lets you see latencies and types per phase
   — useful for fallback/timeout analysis — but nothing about which
   targets agents *intended* to act on. A redacted-payload trace
   variant (e.g. preserving target hashes that match across traces of
   the same match) would unlock per-agent decision-quality metrics
   without re-exposing private targets directly.
6. **Add an exhaustiveness guard on the public-replay-event filter,**
   the way `toPublicWerewolfHistory` does. `werewolfReplayEventToPublic`
   currently uses if/else on event type strings; if a new replay-event
   type is added to `WerewolfReplayEventType`, the filter will silently
   pass it through. A `default: const _exhaustive: never = eventType`
   in a `switch (event.eventType)` ensures additions are classified.

## Assessment

**With fixes — but the fixes are nice-to-have, not blocking.**

Plan 4a's privacy invariants are sound. The five protected points each
have at least two enforcement layers and at least one regression test.
The dependency DAG holds. Cold-build robustness verified for
`@agent-poker/persistence`. The decision-trace recorder, the public
filter, and the orchestrator's persist-on-completion path are all
reasonably defended in depth.

Of the Important issues:
- **Issue 1 (seed in BuildWerewolfArtifactInput)** is the most
  consequential: it's a footgun that could enable a future privacy
  regression without test coverage catching it. Recommended to fix
  before plan-4b (which exposes the `/api/v1/werewolf-matches/:id`
  route) consumes the artifact.
- **Issue 2 (Memory store no cost limits)** mirrors poker's existing
  pattern and is internally consistent. Document, don't fix, unless
  there's product appetite.
- **Issue 3 (containsSpeakInner heuristic)** is a paper concern with
  zero observable risk today. Document or scope; not blocking.

Recommendation: **land plan-4a as-is**, file Issue 1 as a follow-up
ticket to land alongside plan-4b's API route work, and fold the Minor
items into plan-4b polish where convenient. The foundation is solid
enough for plan-4b's HTTP/realtime work to build on without rework.
