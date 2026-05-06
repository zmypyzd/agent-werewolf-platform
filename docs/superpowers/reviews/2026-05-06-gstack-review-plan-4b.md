# Pre-landing review — Werewolf Plan 4b (API + Realtime Hub)

**SHA range:** `3449b8d..0da6d8d` (18 commits)
**Reviewer:** independent pre-landing reviewer
**Spec:** `docs/superpowers/plans/2026-05-05-werewolf-plan-4b-api-and-realtime.md`
**Date:** 2026-05-06

## Strengths

- **Privacy invariants are layered, not single-point.** The five protected
  points each have at least two independent defenses:
  1. Night actor identity is stripped both in `werewolfReplayEventToPublic`
     (called by `attachWerewolfHub` *and* by `toPublicWerewolfReplayEvents`
     during persistence) and asserted negatively in two distinct tests
     (`werewolf-matches.test.ts:89-98` against persisted JSON, and
     `werewolf-ws.test.ts:115-124` against live WS frames).
  2. `match.started.seed` is dropped in the same filter, asserted on both
     the live WS path (`werewolf-ws.test.ts` and `werewolf-matches.integration.test.ts:155`)
     and the persisted artifact path.
  3. `speak.inner` stripping is recursive in `werewolf-filter.ts:62-85`,
     keyed on the structural shape `{ type: 'speak' }` rather than a fixed
     field path — robust against the inner being nested under
     `agent.action_received.action`, `engine.action_applied.action`, etc.
  4. `WerewolfDecisionTrace` publicization in
     `apps/api/src/routes/werewolf-matches.ts:36-47` uses the canonical
     destructure-and-spread pattern *and* a typed `Omit<…>` so a future
     contributor adding a new private field gets a TypeScript error if
     they forget to extend the route's projection logic.
  5. The `player:<userId>:<gameId>` gate is duplicated: subscribe-time
     check in `apps/api/src/routes/ws.ts:13-22` (`isOwnPlayerTopic`) and
     publish-time check via the per-player ownership map in
     `packages/werewolf-orchestrator/src/hub-integration.ts:76-85`. Even
     if a future bug let an unauthorised subscribe through, the publish
     side won't emit anything for a player that user does not own.

- **`isOwnPlayerTopic` is spoof-resistant.** It uses `slice` + `indexOf`
  rather than `split(':')`, so a `gameId` that contains `:` (legal per
  the Zod schema `topic: z.string().min(1).max(80)`) cannot trick the
  parser into reading the `userId` segment from a different position.
  An empty-userId topic (`player::g-1`) returns false because `colon === 0`.
  Cookie-derived `userId` originates from the auth `onRequest` hook
  (`packages/auth/src/fastify-plugin.ts:43-62`); `req.user.userId` cannot
  be supplied by the client, so spoofing via subprotocol or query string
  is structurally impossible.

- **Hub publish path doesn't invent a parallel filter.**
  `attachWerewolfHub` calls `werewolfReplayEventToPublic` (the same one
  persistence calls). One filter, two consumers.

- **DAG is acyclic after the new `realtime` dep.**
  `packages/realtime/package.json` lists only `shared` + `agent-protocol`.
  `werewolf-orchestrator/package.json` adds `realtime` (downward), so the
  arrow direction `shared ← realtime ← werewolf-orchestrator` is preserved.
  Verified by clean `pnpm --filter @agent-poker/werewolf-orchestrator run build`
  and `--filter @agent-poker/realtime run build` — no `error TS6202`.

- **`detachAll` is idempotent and self-clearing.** The lifecycle commit
  `0da6d8d` registers the `onClose` hook unconditionally; the previous
  comment-only contract was easy to miss. `hub-integration.ts:98-100`
  iterates a copied snapshot of `[...handles.keys()]`, so re-attach after
  `detachAll` is safe and tested
  (`hub-integration.test.ts:152-154`).

- **Match-runner private-state ordering is structurally pinned.** The
  test `match-runner-private-state-channel.test.ts:30-47` asserts that
  every `private-state` is followed by *exactly one* `agent.action_requested`
  for the same player — `log.length % 2 === 0` and same `playerId` on each
  pair. Strong enough that a future contributor inserting unrelated
  emits between them would break the test.

- **E2E count-equality has a defensive guard.**
  `werewolf-matches.integration.test.ts:136` explicitly asserts
  `liveEventTypes.every((e) => e.sequence >= 0)`. Without this, a wire
  shape change moving `sequence` out of `payload` would silently make
  the monotonicity loop pass vacuously. This is exactly the
  predicate-then-forEach footgun.

- **`runOnce` is scheduler-free.** `WerewolfMatchTtlCleaner` exposes
  `runOnce(now?)` only — callers wrap in `setInterval` if they want a
  daemon. No background timer landed in this plan, so there's no need
  to use `vi.useFakeTimers()`. The injected `now` argument is exercised
  in two of three tests; the third test pins the default-`Date.now()`
  branch.

## Issues

### Critical

*None found.* The privacy invariants are correctly layered, the WS gate
is structurally sound, and no test pattern obscures a bug.

### Important

#### I1. `subscribePrivate` listener identity vs. external unsubscribe

**File:** `packages/werewolf-orchestrator/src/orchestrator.ts:110-117`

The current implementation registers `listener` directly:
```typescript
entry.emitter.on('private-state', listener);
return () => entry.emitter.off('private-state', listener);
```

This is fine, but earlier docs in the plan (Task 2 step 3) showed a
`wrapped` indirection:
```typescript
const wrapped = (e: WerewolfPrivateStateEvent) => listener(e);
entry.emitter.on('private-state', wrapped);
return () => entry.emitter.off('private-state', wrapped);
```

The implemented form (no wrap) is functionally equivalent but means a
caller that registers the *same listener function reference* twice and
calls only one of the returned unsubscribers will leave the other
attached. EventEmitter dedups by `(event, listener)` pair only at
removal time. This is technically correct but the `subscribePrivate`
test does not pin "two registrations of the same listener function are
independently disposable." Low-likelihood footgun; mention only because
`attachWerewolfHub` calls `subscribePrivate` exactly once per attach
and uses a fresh closure each time, so the production path is safe.

**Suggestion:** add a 4th `it` block to `orchestrator-subscribe-private.test.ts`
asserting two listener registrations of the same function reference can
be independently unsubscribed. Or accept that this is a non-issue and
leave the existing tests.

#### I2. Hub-integration payload spread can shadow event metadata

**File:** `packages/werewolf-orchestrator/src/hub-integration.ts:59-64`

```typescript
payload: {
  ...publicEvent.data,
  eventId: publicEvent.eventId,
  sequence: publicEvent.sequence,
  timestamp: publicEvent.timestamp,
},
```

Field order means `data.eventId` (if present) is silently overridden by
`publicEvent.eventId`. This is the safer order — metadata wins — but
nothing tests it, and the inverse choice would break sequence-based
ordering downstream. The current order is correct; pin it.

**Suggestion:** add a one-line test in `hub-integration.test.ts`
asserting that even if a synthetic event has `data.sequence` set to a
sentinel, the published `payload.sequence` carries the
`publicEvent.sequence` value, not the data value.

#### I3. `werewolf-matches.ts` `replay` route includes decision-traces in record

**File:** `apps/api/src/routes/werewolf-matches.ts:90-98`

The route fetches the record without setting `includeDecisionTraces: false`:

```typescript
app.get<{ Params: { matchId: string } }>(
  '/werewolf-matches/:matchId/replay',
  async (req, reply) => {
    const record = await getRecordOrThrow(store, req.params.matchId, {
      includeDecisionTraces: false,
    });
    reply.send({ data: record.replayEvents });
  },
);
```

Wait — the implementation *does* pass `includeDecisionTraces: false`.
Good. But it does *not* pass `includeReplayEvents: true` — the option
default is presumably true. Quick check: this differs from the spec
text in commit `8bd6e9c` ("suppress trace loading on /replay; refresh
hash literals"). The current code matches the spec. No issue. Marking
**resolved during review**.

#### I4. WS connection has no per-connection subscription rate-limit

**File:** `apps/api/src/routes/ws.ts:53-66`

An authenticated user can issue unbounded `subscribe` messages to
`match:<arbitrary>` topics. Each call grows
`hub.topics.get('match:X').size` by 1; `hub.connectionTopics.get(conn)`
also grows. A malicious client could subscribe to thousands of unique
match topics in a single connection — small per-entry, but not bounded.
The poker side has the same issue, so this is pre-existing, not new in
4b. Worth flagging for a follow-up but not a blocker.

**Suggestion (follow-up plan):** cap per-connection subscriptions
(e.g. 64 topics) inside `RealtimeHub.subscribe` and disconnect on
overflow.

### Minor

#### M1. `match:<empty>` and `player:<userId>:<empty>` are silently allowed

**File:** `apps/api/src/routes/ws.ts:60-64`

`msg.topic.startsWith('match:')` returns `true` for the literal
`'match:'` (empty gameId), and `isOwnPlayerTopic('player:userId:', 'userId')`
returns `true` (rest = `'userId:'`, colon at len-1, `slice(0,len-1) === userId`).
Both subscribe successfully but produce no traffic because the hub never
publishes to those exact topics. Low-impact, but the gate could be
slightly tighter:

```typescript
function isOwnPlayerTopic(topic: string, userId: string): boolean {
  if (!topic.startsWith(PLAYER_TOPIC_PREFIX)) return false;
  const rest = topic.slice(PLAYER_TOPIC_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return false;
  if (colon === rest.length - 1) return false; // empty gameId
  return rest.slice(0, colon) === userId;
}
```

And similarly for `match:` (`if (msg.topic === 'match:') return;`).

Not a security issue — just hygiene.

#### M2. `WerewolfMatchTtlCleaner` does not remove the persisted artifact

**File:** `packages/werewolf-orchestrator/src/match-ttl-cleaner.ts:22-34`

The doc comment is explicit: "Persisted artifacts are NOT removed —
that lives in the store's `deleteMatchArtifact` and is policy-distinct
from in-memory cleanup." That's a reasonable design choice (artifacts
have their own retention policy). But after `runOnce` removes the
in-memory entry, the artifact store's `listMatchArtifacts()` will
*still* return that match on the next call, and `runOnce` will try to
`deleteMatch(matchId)` again, which returns `false` and is a no-op.
This means the cleaner does the same store walk repeatedly forever.

Fine for low match counts; could matter for very high traffic. Not a
blocker.

**Suggestion:** allow callers to pass an optional
`onlyMatchIds?: ReadonlyArray<string>` filter, or have the cleaner
skip entries whose orchestrator entry has already been removed (by
tracking previously-cleaned ids in-memory). Either is post-4b.

#### M3. `match.completed` payload includes `winner` — confirm spectators may see this

**File:** `packages/werewolf-orchestrator/src/match-runner.ts:127-134`

`match.completed` carries `{ gameId, winner, durationMs, stepCount }`.
The winner side is publicly revealed at game-over (the engine's
reveal phase). Confirmed safe by `WerewolfMatchPublicSummary.winner`
also being public.

#### M4. Decision-trace size cap is at recorder level, not at HTTP serve level

**File:** `packages/werewolf-orchestrator/src/decision-trace-recorder.ts:15-17`

`INTENT_MAX = 200`, `OBSERVATION_MAX = 200`, `OBSERVATIONS_MAX = 10`.
There is no top-level "max bytes per decision-trace JSON line" or
"max traces per match" cap. Plan 4b doesn't introduce regressions
here, but the `/decision-trace` route streams the entire array in one
shot — for a 9-player match running 200+ decisions this is fine, for a
runaway match it could be large. Pre-existing.

#### M5. `WerewolfMatchArtifactIndexEntry` does not carry `seed` in the type

**File:** `packages/persistence/src/werewolf-match-artifact-types.ts:68-75`

`publicIndexEntry` in the route does `{ ...entry }` with a comment:
"The persisted index entry already lacks `seed` by design — no
stripping needed." That's true at the type layer. The earlier version
of this function (per the plan doc) had a `delete cloned['seed']`
defense-in-depth strip. The current code dropped that. The risk: if
a future PR adds `seed` to the index type without thinking about the
public route, the route would happily serve it.

**Suggestion:** restore the explicit defense-in-depth pattern:
```typescript
function publicIndexEntry(entry: WerewolfMatchArtifactIndexEntry): WerewolfMatchArtifactIndexEntry {
  const { ...rest } = entry as WerewolfMatchArtifactIndexEntry & { seed?: string };
  // 'seed' is intentionally absent from WerewolfMatchArtifactIndexEntry; this
  // strip is defense-in-depth in case the type ever widens.
  if ('seed' in rest) delete (rest as Record<string, unknown>)['seed'];
  return rest;
}
```

Or rely on the type system + the existing assertion in
`werewolf-matches.test.ts:64`
(`expect(entry).not.toHaveProperty('seed')`) — that test would fail
loudly the moment a `seed` field appeared. Acceptable either way; the
test is the actual safety net.

#### M6. `attachMatch` race window is not pinned by a test

If a caller calls `attachMatch(matchId, ownership)` *after* `runMatch`
has already started, the EventEmitter listener attaches mid-run and
misses earlier events. Production path (test or future API) always
attaches before runMatch, so this is fine. No test asserts the
ordering. Low-priority.

#### M7. `hub.publish` sends to a SET that is mutated during iteration on send-failure

**File:** `packages/realtime/src/hub.ts:58-70`

```typescript
publish(topic: string, message: WsServerMessage): void {
  const set = this.topics.get(topic);
  if (!set) return;
  const json = JSON.stringify(message);
  for (const conn of set) {
    try {
      conn.send(json);
    } catch {
      this.unsubscribeAll(conn);  // mutates `set`!
      try { conn.close?.(); } catch { /* swallow */ }
    }
  }
}
```

`unsubscribeAll(conn)` mutates `this.topics.get(topic)` (the same `set`)
during the `for…of`. JavaScript iteration over `Set` is well-defined
when adding / deleting during iteration — deleting an already-yielded
element is fine, but deleting a not-yet-yielded element skips it.
Skipping the delivery to a connection that was about to be unsubscribed
anyway is the desired outcome. Pre-existing, not introduced by 4b.

## Recommendations

1. **Add tests pinning the publish-payload metadata precedence** (I2 above).
   One line each in `hub-integration.test.ts`. Low cost, catches a class
   of accidental regressions.

2. **Tighten the `isOwnPlayerTopic` and `match:` gates** to reject
   empty `gameId` (M1). Even though the hub silently ignores them,
   the gate should refuse them on input — defense in depth and easier
   to audit.

3. **Restore explicit `seed` strip in `publicIndexEntry`** (M5). Or
   make the type `Readonly<WerewolfMatchArtifactIndexEntry>` to make
   accidental widening harder. The existing test catches it but the
   intent of "defense in depth at the route" is worth preserving.

4. **Document the attach-before-run invariant** in
   `attachWerewolfHub`'s JSDoc (M6). One sentence:
   "Call `attachMatch(matchId, …)` after `orchestrator.createMatch`
   and *before* `orchestrator.runMatch`; events fired during runMatch
   are not buffered."

5. **Consider follow-up**: per-connection topic-subscription cap in
   `RealtimeHub.subscribe` (I4). Out of scope for 4b but worth a
   tracking issue.

6. **No required test changes for the privacy invariants.** The
   negative-space assertions in `werewolf-matches.test.ts:80-99`,
   `werewolf-ws.test.ts:101-189`, and
   `werewolf-matches.integration.test.ts:136-163` cover all five
   protected points. They are not vacuous (E2E test has a
   `liveEventTypes.every((e) => e.sequence >= 0)` guard, night-frame
   filters explicitly assert `nightFrames.length > 0` before checking
   negatives).

## Assessment

**Land it.** No Critical or Important findings block the merge. The
privacy invariants are correctly layered and tested with non-vacuous
negative assertions. The WS gate is structurally sound (cookie-derived
userId, slice-not-split, no spoof surface). The DAG stays acyclic.
TypeScript strict + `exactOptionalPropertyTypes` compiles cleanly with
no `any` and no `// @ts-ignore` (verified by clean
`pnpm --filter api run build`). The four Important findings are all
either resolvable in a one-line follow-up or are intentional tradeoffs
that match the spec.

Recommended pre-merge: address the small hygiene items
(M1, M5 — both 1-line changes) and add the metadata-precedence test
(I2). These are cheap and meaningfully harden the public surface.
Everything else can land as a follow-up.

The strongest signal that this plan was implemented carefully: the
test for the WS gate (`werewolf-ws.test.ts:159-188`) asserts the
*negative* — Alice's message buffer contains zero frames on Bob's
topic *after Bob legitimately received frames there*. Without the
positive Bob-receives-frames assertion, an Alice-only check would
pass vacuously even if the gate were entirely broken. The test
authors anticipated this.

---

*Review duration: ~25 minutes. Source: read all 18 commits, all new
route/integration files, the realtime filter, and the four-test
privacy assertion structure end-to-end.*
