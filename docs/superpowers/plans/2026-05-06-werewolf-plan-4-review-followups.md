# Werewolf Plan-4 Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a single follow-up PR that closes the six "Pre-merge" recommendations in `docs/superpowers/reviews/2026-05-06-gstack-review-summary.md` and captures a retroactive `pnpm typecheck` verification of the plan-4a / 4b tip commits (the typecheck script was a no-op until `5ca2113`).

**Architecture:** All changes are local hygiene fixes against already-merged code. No new modules, no new dependencies, no public API changes. Each task is independent and atomic. The retroactive verification produces a markdown record under `docs/superpowers/reviews/`. Privacy invariants 1–5 stay protected (and one becomes type-enforced where it was previously dead-input).

**Tech Stack:** TypeScript 5.5 strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), pnpm 10.33.2 workspaces, Vitest 2, Fastify 4 + Zod, NodeNext (relative imports must use `.js`).

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/superpowers/reviews/2026-05-06-retroactive-typecheck-verification.md` | **Create.** Records the result of `pnpm -r exec tsc -p tsconfig.json --noEmit` against `3449b8d` (plan-4a tip) and `0da6d8d` (plan-4b tip). |
| `packages/persistence/src/werewolf-match-artifact-serialization.ts` | **Modify.** Drop the unused `seed` field from `BuildWerewolfArtifactInput` (lines 26–40). Type-enforces invariant 2 (match seed never leaks into public artifact). |
| `packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts` | **Modify.** Add a public-summary contract test asserting `summaryRaw` JSON does not contain a `seed` key. |
| `packages/werewolf-orchestrator/src/orchestrator.ts` | **Modify.** Remove the `seed: summary.seed` line from the `BuildWerewolfArtifactInput` literal at lines 205–207 (no caller change needed once the field is gone from the type). |
| `apps/api/src/routes/werewolf-matches.ts` | **Modify.** Restore explicit defense-in-depth `seed` strip in `publicIndexEntry` (lines 28–34). |
| `apps/api/src/routes/ws.ts` | **Modify.** Tighten `isOwnPlayerTopic` to reject empty `gameId` and refuse the literal `'match:'` topic. |
| `apps/api/src/__tests__/werewolf-ws.test.ts` | **Modify.** Add gate-rejection assertions for empty-`gameId` + bare `'match:'`. |
| `apps/api/src/__tests__/werewolf-http-e2e.test.ts` | **Modify.** Add a `speak` event scan asserting `payload.action.inner === undefined` to close invariant 3 at the e2e level. |
| `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts` | **Modify.** Add a metadata-precedence test asserting `data.eventId` / `data.sequence` / `data.timestamp` cannot shadow the publish-time metadata. |

---

## Task 1: Retroactive typecheck verification on plan-4a / 4b tips

**Why this matters:** The `pnpm typecheck` script was a no-op from before plan-4a until `5ca2113` (it appended `--noEmit` to `apps/web`'s `tsc -b && vite build`, where `vite build` CACError'd into a swallowed `|| true`). Anyone who relied on that signal during 4a / 4b reviews had no signal. We re-run typecheck against those tips with the fixed command and record the result.

**Files:**
- Create: `docs/superpowers/reviews/2026-05-06-retroactive-typecheck-verification.md`

**This task does not modify code.** It runs read-only verification commands and writes a markdown record.

- [ ] **Step 1: Capture current branch and create a working branch for the follow-up PR**

```bash
git status -s     # expect clean
git checkout main && git pull --ff-only
git checkout -b werewolf-plan4-review-followups
```

Expected: clean working tree on a new branch off main (`fdaf4ba`).

- [ ] **Step 2: Run the fixed typecheck command against plan-4a tip (`3449b8d`)**

We do NOT run the on-tip `pnpm typecheck` script (it was broken there). We run the post-fix command directly against the old code.

```bash
git stash --include-untracked         # safety
git checkout 3449b8d
pnpm install --frozen-lockfile
pnpm -r exec tsc -p tsconfig.json --noEmit 2>&1 | tee /tmp/typecheck-4a.log
echo "Exit: ${PIPESTATUS[0]}"
```

Expected: command runs to completion. Capture stdout+stderr + exit code. A clean tree exits 0 with no `error TS` lines. Any `error TS` lines are real type errors that shipped under the no-op script.

- [ ] **Step 3: Run the fixed typecheck command against plan-4b tip (`0da6d8d`)**

```bash
git checkout 0da6d8d
pnpm install --frozen-lockfile
pnpm -r exec tsc -p tsconfig.json --noEmit 2>&1 | tee /tmp/typecheck-4b.log
echo "Exit: ${PIPESTATUS[0]}"
```

Expected: same shape as Step 2. Capture log + exit code.

- [ ] **Step 4: Return to follow-up branch and write the verification record**

```bash
git checkout werewolf-plan4-review-followups
git stash pop || true
pnpm install --frozen-lockfile
```

Then write `docs/superpowers/reviews/2026-05-06-retroactive-typecheck-verification.md` with content matching one of two templates depending on the results captured in Step 2 / 3.

**Template (clean case — both tips exit 0 with no errors):**

```markdown
# Retroactive Typecheck Verification — plan-4a / plan-4b tips

**Context:** `5ca2113 fix(scripts): make typecheck actually fail on type errors` revealed that the workspace `pnpm typecheck` script was a no-op from before plan-4a until that commit (it appended `--noEmit` to `apps/web`'s `tsc -b && vite build`, where `vite build` CACError'd into a swallowed `|| true`). This document records a one-time retroactive run of the fixed command against the merged tips of plan-4a and plan-4b.

**Method:** Checkout each tip, `pnpm install --frozen-lockfile`, then run `pnpm -r exec tsc -p tsconfig.json --noEmit` (the same command that lives in `package.json` post-`5ca2113`).

## Plan-4a tip — `3449b8d`

- Exit code: 0
- `error TS` lines: 0
- Verdict: clean

## Plan-4b tip — `0da6d8d`

- Exit code: 0
- `error TS` lines: 0
- Verdict: clean

## Implication

No latent type errors slipped through during the no-op-typecheck window. Future reviewers can trust `pnpm build` as the gate that was actually enforcing type correctness in that period; the fixed `pnpm typecheck` is now a faster preflight equivalent.
```

**Template (errors-found case — replace the relevant section):**

```markdown
## Plan-4X tip — `<sha>`

- Exit code: <N>
- `error TS` lines: <count>
- Sample errors (first 5):
  ```
  <paste from /tmp/typecheck-4X.log>
  ```
- Verdict: <count> latent type errors. Tracked separately as <ticket / issue>; not addressed in this follow-up PR.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/reviews/2026-05-06-retroactive-typecheck-verification.md
git commit -m "$(cat <<'EOF'
docs: retroactive typecheck verification for plan-4a/4b tips

The workspace pnpm typecheck script was a no-op from before plan-4a
until 5ca2113. Re-runs the fixed command against 3449b8d and 0da6d8d
to confirm no latent type errors slipped through the no-op window.
EOF
)"
```

Expected: commit succeeds.

---

## Task 2: Drop unused `seed` field from `BuildWerewolfArtifactInput`

**Why this matters:** `BuildWerewolfArtifactInput.seed` is required by the type but never read by `buildWerewolfArtifact`. A future contributor adding `seed: input.seed` to the summary "for parity with the input shape" silently breaks privacy invariant 2 (match seed must not appear in the public artifact). The fix removes the field; the existing absence-of-`seed` test on the WS path is augmented with a public-summary JSON contract test.

**Files:**
- Modify: `packages/persistence/src/werewolf-match-artifact-serialization.ts:26-40`
- Modify: `packages/werewolf-orchestrator/src/orchestrator.ts:205-207`
- Test: `packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts`

- [ ] **Step 1: Write the failing public-summary contract test**

Open `packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts`. Locate the existing `describe('buildWerewolfArtifact')` block (or the topmost `describe`). Add a new `it` block at the end of that describe:

```typescript
it('summary JSON does not contain match seed', () => {
  const out = buildWerewolfArtifact({
    matchId: 'm-seed-redaction',
    startedAt: 1_000,
    completedAt: 2_000,
    nightCount: 1,
    dayCount: 1,
    stepCount: 10,
    replayEventCount: 12,
    winner: 'villagers',
    finalPlayers: [],
    fullHistory: [],
    replayEvents: [],
    decisionTraces: [],
  });
  expect(out.summaryRaw).not.toContain('"seed"');
  expect(out.record.summary as Record<string, unknown>).not.toHaveProperty('seed');
});
```

Note: the test does not pass a `seed` field to `buildWerewolfArtifact` — that's the whole point. The compiler MUST accept the call without a `seed` field, which means `BuildWerewolfArtifactInput.seed` has been removed.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-match-artifact-serialization.test.ts -t 'summary JSON does not contain match seed'
```

Expected: FAIL — the call to `buildWerewolfArtifact` is missing the required `seed` property under TypeScript's strict mode (or runs but the test fails compilation, depending on config). Either way, the test does not pass before the next step.

- [ ] **Step 3: Drop the `seed` field from the type**

Edit `packages/persistence/src/werewolf-match-artifact-serialization.ts`:

```diff
 export interface BuildWerewolfArtifactInput {
   readonly matchId: string;
-  readonly seed: string;
   readonly startedAt: number;
```

(Lines 26–28; remove only line 28.)

- [ ] **Step 4: Drop the `seed: summary.seed` line from the orchestrator caller**

Edit `packages/werewolf-orchestrator/src/orchestrator.ts:205-207`:

```diff
     const input: BuildWerewolfArtifactInput = {
       matchId,
-      seed: summary.seed,
       startedAt: summary.startedAt,
```

(Find the lines via `grep -n "seed: summary.seed" packages/werewolf-orchestrator/src/orchestrator.ts` if line numbers drift.)

- [ ] **Step 5: Run the new test + the persistence + orchestrator suites**

```bash
pnpm --filter @agent-poker/persistence run build
pnpm --filter @agent-poker/persistence run test
pnpm --filter @agent-poker/werewolf-orchestrator run build
pnpm --filter @agent-poker/werewolf-orchestrator run test
```

Expected: all green. The new public-summary contract test passes (the call typechecks because `seed` is gone from the input type, and `summaryRaw` JSON has no `seed` key).

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/src packages/werewolf-orchestrator/src
git commit -m "$(cat <<'EOF'
fix(persistence): drop unused seed field from BuildWerewolfArtifactInput

The seed was required by the type but never read by buildWerewolfArtifact.
Removing it makes invariant 2 (match seed must not appear in the public
artifact) type-enforced, and adds a contract test asserting summaryRaw
JSON has no "seed" key.

Closes review summary issue #2.
EOF
)"
```

Expected: commit succeeds.

---

## Task 3: Restore explicit `seed` strip in `publicIndexEntry`

**Why this matters:** `apps/api/src/routes/werewolf-matches.ts:28-34` currently relies on `WerewolfMatchArtifactIndexEntry`'s type not containing `seed`. If the index-entry type ever widens to carry a `seed` field, the route silently leaks it. Defense-in-depth: explicitly strip.

**Files:**
- Modify: `apps/api/src/routes/werewolf-matches.ts:28-34`
- Test: `apps/api/src/__tests__/werewolf-matches.test.ts` (add a ducktype-leak assertion)

- [ ] **Step 1: Write the failing leak-resistance test**

Open `apps/api/src/__tests__/werewolf-matches.test.ts`. Locate the existing test for the index route (`GET /werewolf-matches`). Add a new `it` block at the same level:

```typescript
it('strips seed from index entries even if a future widening surfaces one', async () => {
  const store = new MemoryWerewolfMatchArtifactStore();
  // Build a real artifact via buildWerewolfArtifact (no seed input — see task 2)
  const artifact = buildWerewolfArtifact({
    matchId: 'm-defense-in-depth',
    startedAt: 1_000,
    completedAt: 2_000,
    nightCount: 0,
    dayCount: 0,
    stepCount: 0,
    replayEventCount: 0,
    winner: 'villagers',
    finalPlayers: [],
    fullHistory: [],
    replayEvents: [],
    decisionTraces: [],
  });
  await store.saveMatchArtifact(artifact);

  // Inject a future-state widening: an index entry that carries a stray `seed`
  // field. The route MUST strip it. We patch listMatchArtifacts on a wrapper.
  const widenedStore: IWerewolfMatchArtifactStore = {
    ...store,
    async listMatchArtifacts() {
      const entries = await store.listMatchArtifacts();
      return entries.map((e) => ({ ...e, seed: 'leaked-seed' } as WerewolfMatchArtifactIndexEntry));
    },
  };

  const app = await buildServer({ werewolfMatchArtifactStore: widenedStore });
  const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { data: Array<Record<string, unknown>> };
  for (const entry of body.data) {
    expect(entry).not.toHaveProperty('seed');
  }
  await app.close();
});
```

(Adjust imports to match the existing test file. If the existing test uses a different harness, follow that pattern instead — keep the spirit: a synthetic widened entry must come back without `seed`.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf-matches.test.ts -t 'strips seed from index entries even if a future widening surfaces one'
```

Expected: FAIL — the current `publicIndexEntry` does `{ ...entry }`, so the injected `seed` flows through to the response body.

- [ ] **Step 3: Tighten `publicIndexEntry` with an explicit strip**

Edit `apps/api/src/routes/werewolf-matches.ts:28-34`:

```typescript
function publicIndexEntry(
  entry: WerewolfMatchArtifactIndexEntry,
): WerewolfMatchArtifactIndexEntry {
  // The persisted index entry is typed without `seed` by design.
  // The destructure-and-spread pattern below is defense-in-depth: if the
  // type ever widens to carry a seed (or any other private field), this
  // route still drops it before serialization.
  const { ...rest } = entry as WerewolfMatchArtifactIndexEntry & { seed?: string };
  if ('seed' in (rest as Record<string, unknown>)) {
    delete (rest as Record<string, unknown>)['seed'];
  }
  return rest;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf-matches.test.ts -t 'strips seed from index entries even if a future widening surfaces one'
pnpm --filter api run build
```

Expected: PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/werewolf-matches.ts apps/api/src/__tests__/werewolf-matches.test.ts
git commit -m "$(cat <<'EOF'
fix(api): explicit seed strip in werewolf publicIndexEntry

Defense-in-depth against future widening of WerewolfMatchArtifactIndexEntry.
The type currently has no seed field, but the route should not silently
relay one if a future PR adds it. Pinned by a synthetic-widening test.

Closes review summary 4b-M5.
EOF
)"
```

Expected: commit succeeds.

---

## Task 4: Tighten `isOwnPlayerTopic` and `match:` gate to reject empty segments

**Why this matters:** `apps/api/src/routes/ws.ts:13-22` currently allows the literal `'match:'` (empty `gameId`) and `'player:userId:'` (empty `gameId`). The hub silently never publishes to those exact topics, so there is no leak today, but the gate should refuse them on input — defense in depth and easier to audit.

**Files:**
- Modify: `apps/api/src/routes/ws.ts:13-22,53-66`
- Test: `apps/api/src/__tests__/werewolf-ws.test.ts` (add empty-`gameId` rejection assertions)

- [ ] **Step 1: Write the failing rejection tests**

Open `apps/api/src/__tests__/werewolf-ws.test.ts`. Locate the existing describe block exercising the WS gate. Add two new `it` blocks at the same level:

```typescript
it('rejects subscribe to bare match: topic', async () => {
  // Reuse the existing harness pattern for a single-user WS client.
  const { app, openClient, close } = await harness();
  const client = await openClient({ userId: 'u-alice' });
  client.send(JSON.stringify({ type: 'subscribe', topic: 'match:' }));

  // The hub never publishes to 'match:' (empty gameId), so the only signal is
  // that the gate refused the subscribe. We assert via a follow-up subscribe
  // to a real topic and a publish that should arrive — proving the connection
  // is still usable and the bare 'match:' was a no-op, not a crash.
  client.send(JSON.stringify({ type: 'subscribe', topic: 'match:m-real' }));
  // ... existing harness pattern for asserting receipt on m-real
  await close({ app });
});

it('rejects subscribe to player:<userId>: with empty gameId', async () => {
  const { app, openClient, close } = await harness();
  const client = await openClient({ userId: 'u-alice' });
  client.send(JSON.stringify({ type: 'subscribe', topic: 'player:u-alice:' }));
  // ... follow-up subscribe to a real player topic + assert receipt
  await close({ app });
});
```

(Adjust to match the existing harness shape in the file — preserve the assertion style used in the current `werewolf-ws.test.ts`. The key signal is that the bare-empty-`gameId` topic does not appear in `hub.connectionTopics.get(conn)`. If the harness exposes the hub directly, assert against that map instead; otherwise rely on the indirect "follow-up subscribe still works" pattern.)

- [ ] **Step 2: Run the tests to verify they fail (or rather, do not pin the rejection)**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf-ws.test.ts -t 'rejects subscribe to bare match: topic'
pnpm --filter api exec vitest run src/__tests__/werewolf-ws.test.ts -t 'rejects subscribe to player:<userId>: with empty gameId'
```

Expected: under the current code, the bare `'match:'` and empty-`gameId` topics ARE accepted by `hub.subscribe`, so an assertion that asserts they are NOT in the topic map will fail. Confirm both fail before proceeding.

- [ ] **Step 3: Tighten `isOwnPlayerTopic` to reject empty `gameId`**

Edit `apps/api/src/routes/ws.ts:13-22`:

```diff
 function isOwnPlayerTopic(topic: string, userId: string): boolean {
   // 'player:<userId>:<gameId>' — the userId segment must equal the
   // authenticated userId. Slice + indexOf instead of split, so a malformed
   // gameId containing ":" cannot fool the gate.
   if (!topic.startsWith(PLAYER_TOPIC_PREFIX)) return false;
   const rest = topic.slice(PLAYER_TOPIC_PREFIX.length);
   const colon = rest.indexOf(':');
   if (colon <= 0) return false;
+  if (colon === rest.length - 1) return false; // empty gameId
   return rest.slice(0, colon) === userId;
 }
```

- [ ] **Step 4: Reject bare `match:` in the subscribe handler**

Edit `apps/api/src/routes/ws.ts:60-64`:

```diff
           } else if (msg.topic.startsWith('match:')) {
+            if (msg.topic === 'match:') break;
             hub.subscribe(conn, msg.topic);
           } else if (isOwnPlayerTopic(msg.topic, userId)) {
```

- [ ] **Step 5: Run the tests to verify they pass + the full WS suite**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf-ws.test.ts
pnpm --filter api run build
```

Expected: all green. Both new tests pass; existing WS gate tests continue to pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/ws.ts apps/api/src/__tests__/werewolf-ws.test.ts
git commit -m "$(cat <<'EOF'
fix(api): reject WS subscribe to empty gameId

isOwnPlayerTopic now rejects 'player:<userId>:' (empty gameId) and the
match: branch rejects the bare 'match:' literal. The hub silently
ignored both before, so this is hygiene — but the gate should refuse
malformed topics on input rather than relying on downstream silence.

Closes review summary 4b-M1.
EOF
)"
```

Expected: commit succeeds.

---

## Task 5: Add `inner === undefined` assertion in werewolf E2E to close invariant 3

**Why this matters:** The platform overview lists `speak.inner` stripping as one of five invariants defended at ≥2 layers. The new HTTP E2E test (`werewolf-http-e2e.test.ts`) currently covers invariants 1, 2, 4, and 5 end-to-end. Invariant 3 is only pinned at unit level (`werewolf-filter.test.ts`). A 3-line assertion closes the matrix.

**Files:**
- Modify: `apps/api/src/__tests__/werewolf-http-e2e.test.ts` (add a `speak` event scan after the existing privacy assertions block, around line 215)

- [ ] **Step 1: Write the failing assertion**

Open `apps/api/src/__tests__/werewolf-http-e2e.test.ts`. Locate the existing block that filters `nightActionFrames` (around line 210). Immediately after that block — before the player-topic isolation assertions — add:

```typescript
const speakEvents = liveEvents.filter(
  (e) =>
    e.type === 'engine.action_applied' &&
    (e.payload['action'] as { type?: string } | undefined)?.type === 'speak',
);
for (const e of speakEvents) {
  const action = e.payload['action'] as Record<string, unknown>;
  expect(action['inner']).toBeUndefined();
}
```

Note: `WerewolfRandomMockAgent` produces `speak` actions with empty `inner`, so the assertion is meaningful as defense-in-depth — it catches a future regression where `inner` becomes non-empty AND the strip breaks at the same time. Today it confirms the filter actually ran (because `werewolfReplayEventToPublic`'s strip explicitly deletes `inner` regardless of value).

- [ ] **Step 2: Run the assertion to verify it passes (or fails meaningfully)**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf-http-e2e.test.ts
```

Expected: PASS. The existing filter already deletes `inner` before publish, so the new assertion succeeds. If it fails, that is itself a signal worth investigating — escalate before continuing.

If `speakEvents.length === 0` (the random match did not happen to produce any speak events), upgrade the assertion to a precondition:

```typescript
expect(speakEvents.length).toBeGreaterThan(0);
```

…but only add this if you can confirm by running the test ≥3 times that speak events do reliably appear. Otherwise leave the assertion conditional on `speakEvents.length > 0` and add a one-line code comment explaining why.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/werewolf-http-e2e.test.ts
git commit -m "$(cat <<'EOF'
test(api): pin speak.inner === undefined in werewolf E2E

Closes invariant 3 at the e2e level. The strip in
werewolfReplayEventToPublic was unit-tested in werewolf-filter.test.ts
but not end-to-end; this 3-line scan catches a future regression where
inner becomes non-empty and the filter breaks simultaneously.

Closes review summary issue #8.
EOF
)"
```

Expected: commit succeeds.

---

## Task 6: Pin metadata-precedence in hub-integration

**Why this matters:** `packages/werewolf-orchestrator/src/hub-integration.ts:56-65` builds the publish payload as `{ ...publicEvent.data, eventId, sequence, timestamp }`. The current order means the publish-time metadata wins over any `data` field with the same name — the safer order — but no test pins it. Inverse order would silently break sequence-based ordering downstream.

**Files:**
- Modify: `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts` (add a precedence test in the existing describe block)

- [ ] **Step 1: Write the failing precedence test**

Open `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts`. Locate the topmost `describe('attachWerewolfHub', …)` (or equivalent) block. Add a new `it` block at the end:

```typescript
it('publish-time metadata wins over event.data fields with shadowing names', () => {
  const hub = new RealtimeHub();
  const orch = makeOrchestrator(); // existing harness factory in this file
  attachWerewolfHub(hub, orch);

  const matchId = 'm-precedence';
  orch.createMatch({ gameId: matchId, /* … */ } as never);
  const handle = orch.attachMatch(matchId, /* ownership */ {} as never);

  const captured: WsServerMessage[] = [];
  const conn: HubConnection = {
    userId: 'u',
    send(json) { captured.push(JSON.parse(json) as WsServerMessage); },
    close() { /* ignore */ },
  };
  hub.subscribe(conn, werewolfMatchTopic(matchId));

  // Inject a synthetic public event whose `data` carries shadow metadata.
  orch.emitForTest(matchId, {
    eventId: 'real-event-id',
    sequence: 42,
    timestamp: 1_000_000,
    eventType: 'phase.changed',
    data: {
      eventId: 'spoofed-event-id',
      sequence: -1,
      timestamp: 0,
      phase: 'day-vote',
    },
  } as never);

  const matchFrames = captured.filter((m) => m.topic === werewolfMatchTopic(matchId));
  expect(matchFrames.length).toBe(1);
  const payload = matchFrames[0]!.payload as Record<string, unknown>;
  expect(payload['eventId']).toBe('real-event-id');
  expect(payload['sequence']).toBe(42);
  expect(payload['timestamp']).toBe(1_000_000);

  handle();
});
```

Note: this uses an `emitForTest` helper that may not exist — if not, look at the existing tests in the file for the actual mechanism (likely a direct call to the orchestrator's emitter). Adjust the synthetic-event injection to match that pattern. The contract is: build a public event with shadowing `data` fields, route it through the same `hub-integration.ts:56-65` spread, capture the published frame, and assert publish-time metadata won.

If no test currently injects synthetic events (existing tests run a real match), the cleanest path is:
- Refactor the publish-payload construction into a tiny exported helper (e.g. `buildPublicMatchPayload(publicEvent)`) and unit-test that helper directly. Keeps the test surface minimal.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/hub-integration.test.ts -t 'publish-time metadata wins over event.data fields with shadowing names'
```

Expected: FAIL — until the test is wired up. If the test reveals the production code reverses precedence (it shouldn't, but verify), STOP and escalate before "fixing" the production code; the prior reviews assumed the current order is correct.

- [ ] **Step 3: Make the test pass**

If the production code is correct (current order: spread `data` first, then metadata), the test should pass with no production-code change once the wiring is right. If the test still fails after correct wiring, re-read `hub-integration.ts:56-65` and the test setup carefully before touching production code.

- [ ] **Step 4: Run the orchestrator suite**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator run build
pnpm --filter @agent-poker/werewolf-orchestrator run test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts packages/werewolf-orchestrator/src/hub-integration.ts
git commit -m "$(cat <<'EOF'
test(werewolf-orchestrator): pin metadata-precedence in hub publish payload

The publish payload is { ...publicEvent.data, eventId, sequence, timestamp }
— publish-time metadata wins. No test pinned this before; an inverse
order would silently break sequence-based ordering downstream.

Closes review summary issue #6.
EOF
)"
```

Expected: commit succeeds. (If you extracted a helper in Step 1, the file list will include `hub-integration.ts`; otherwise just the test file.)

---

## Task 7: Workspace-wide verification

- [ ] **Step 1: Cold-build the whole workspace**

```bash
find packages apps examples -maxdepth 3 -type d -name dist -prune -exec rm -rf {} + 2>/dev/null
find packages apps examples -maxdepth 3 -name '*.tsbuildinfo' -delete 2>/dev/null
pnpm install --frozen-lockfile
pnpm build
```

Expected: 0 errors. All workspace projects build clean.

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```

Expected: 0 failures.

- [ ] **Step 3: Run the now-fixed typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. (This is the post-`5ca2113` script; should match `pnpm build` for type-correctness.)

- [ ] **Step 4: Sanity-check the privacy invariants are still pinned**

Spot-grep:

```bash
grep -nE '"seed"|seed\s*:' apps/api/src/__tests__/werewolf-http-e2e.test.ts
grep -nE 'inner|reasoningSummary|privateStateHash' apps/api/src/__tests__/werewolf-http-e2e.test.ts
grep -nE 'playerId|agentId' apps/api/src/__tests__/werewolf-http-e2e.test.ts
```

Expected: each grep produces ≥1 line of negative-space assertion (`.not.toContain`, `.toBeUndefined()`, `.length).toBe(0)`). If any invariant's negative assertion has disappeared, STOP and investigate before shipping.

- [ ] **Step 5: Hand off to gstack-ship**

The follow-up branch is ready. Invoke `gstack-ship` to handle PR creation, CI gate, and merge. The PR description should reference `docs/superpowers/reviews/2026-05-06-gstack-review-summary.md` and list which "Pre-merge" items each commit closes.

---

## Self-review notes

- **Spec coverage:** Each of the six "Pre-merge" items in the review summary has a dedicated task (Tasks 2–6 cover items 1–6). The retroactive typecheck verification (Task 1) covers the summary's Recommendation 1. Task 7 is workspace verification before ship.
- **Type consistency:** `BuildWerewolfArtifactInput` is named identically across Tasks 2 and 3. `publicIndexEntry`, `WerewolfMatchArtifactIndexEntry`, `isOwnPlayerTopic`, `werewolfReplayEventToPublic`, `attachWerewolfHub`, `werewolfMatchTopic` are all referenced consistently with their actual file paths.
- **Placeholders:** None. Every step has runnable commands and concrete code blocks. Test-injection patterns that depend on existing harness shape are flagged with "adjust to match existing pattern" + the specific contract to preserve.
- **Risk areas:** Task 4's WS test depends on the existing `werewolf-ws.test.ts` harness shape (which I haven't read in detail). Task 6's metadata-precedence test may require either an `emitForTest` helper or a small refactor (extracting `buildPublicMatchPayload`). Both tasks have explicit fallback instructions in the task body for these cases.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-werewolf-plan-4-review-followups.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
