# Werewolf Plan-4c — Pre-Landing Review

**Range:** `7419fb9..fdaf4ba` (first-parent), 13 commits including merge `694599a`.
**Plan:** `docs/superpowers/plans/2026-05-06-werewolf-plan-4c-demo-and-adapters.md`
**Reviewer scope:** real HTTP adapter, WS placeholder, 9-AI in-process demo, in-process E2E test, post-merge cycle fix `37b3f4f`, typecheck-script fix `5ca2113`.
**Verification:** cold-build + cold-typecheck both pass on the merge tip.

```
$ rm -rf packages/*/dist apps/*/dist examples/*/dist *.tsbuildinfo
$ pnpm build       # 15/15 workspace projects: Done
$ pnpm typecheck   # 0 errors
```

---

## Strengths

1. **Cycle-fix is structural, not cosmetic.** `37b3f4f` removes the
   `werewolf-orchestrator` devDep from `agent-runtime/package.json` and
   inlines a 4-line synthetic `werewolfFallback` in
   `werewolf-http-agent-adapter.test.ts`. After the change,
   `grep -r "from '@agent-poker/werewolf-orchestrator'" packages/agent-runtime/`
   returns empty — agent-runtime is genuinely upstream of
   werewolf-orchestrator again. This is the right fix; a `import type`
   workaround would have masked a real compile-time cycle in tsc -b's
   project-reference graph (`__tests__` lives inside agent-runtime's
   include set, so its imports are part of agent-runtime's input
   closure). The commit message captures the diagnosis precisely.
   (`packages/agent-runtime/package.json`,
   `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts:10-20`)

2. **Adapter mirrors poker adapter's contract faithfully.** The HTTP
   adapter at `packages/agent-runtime/src/werewolf-http-agent-adapter.ts`
   throws on every failure (non-2xx, malformed JSON, schema violation,
   abort, network) instead of synthesizing a fallback — exactly the
   contract the runner's `TimeoutHandler<…>(adapter, timeoutMs,
   werewolfFallback)` expects. The `reasoningSummary` passthrough copies
   `keyObservations` rather than aliasing, which avoids accidentally
   sharing a Zod-parsed array with the trace recorder.

3. **Demo path exercises the real network.** Both
   `examples/werewolf-local-simulation/index.ts:55-63` and
   `apps/api/src/__tests__/werewolf-http-e2e.test.ts:57-66` actually
   `app.listen({ host: '127.0.0.1', port: 0 })` 9 Fastify instances and
   POST against ephemeral ports. The orchestrator → HTTP adapter →
   real Zod-validated handler → `WerewolfRandomMockAgent` → response
   path is end-to-end. The `as unknown as` seam at `index.ts:50` and
   `werewolf-http-e2e.test.ts:53` is the only structural concession —
   needed because Zod-inferred and domain types are nominally distinct.

4. **Demo cleanup is robust to mid-startup failures.** `index.ts:90-130`
   builds the `servers` array incrementally inside a `try` block; the
   `finally` closes whatever was already started. A `listen` failure on
   server N still tears down servers 1..N-1.

5. **Privacy invariants 1, 2, 4, 5 are verified at e2e level.** The
   E2E test at `apps/api/src/__tests__/werewolf-http-e2e.test.ts:191-263`
   asserts:
   - night-phase `agent.action_*` frames have no `playerId`/`agentId`
     across multiple events (filter, not single-shot — `for (const f of
     nightActionFrames)`),
   - persisted `match.started` event has no `seed`,
   - persisted decision-trace strips `privateStateHash` and
     `reasoningSummary` (substring assertions on the raw text — robust
     against any nesting),
   - public summary strips `seed` and `files`,
   - hub routing isolation: spectator never received frames on
     `player:` topic.

6. **Replay-count equality is intentional and annotated.** `121c45a`
   added a comment at lines 236-242 explaining that
   `replayBody.data.length === liveEvents.length` is a
   contract-tightness assertion: it will break by design if
   `werewolfReplayEventToPublic` ever starts returning `null`. Good
   forward-pinning.

7. **Auth-omit case pinned.** `d4eb5ef` adds the missing
   "no auth header when not configured" test
   (`werewolf-http-agent-adapter.test.ts:177-191`), matching the poker
   adapter's coverage. Adapter only sets `authorization` when **both**
   `authHeaderName` and `authHeaderValue` are truthy
   (`werewolf-http-agent-adapter.ts:47-49`) — defensive and tested.

8. **No `any`, no `// @ts-ignore`, no `@ts-expect-error`** anywhere in
   the new code. Conditional optional-prop spread (`...(reasoningSummary
   !== undefined ? { reasoningSummary: ... } : {})`) is used correctly
   at `werewolf-http-agent-adapter.ts:93-95` — required under
   `exactOptionalPropertyTypes`.

9. **Cycle invariant verified by grep + cold build.** No file under
   `packages/` imports from `examples/`. The DAG `shared ←
   agent-protocol/poker-engine/realtime/persistence ←
   table-orchestrator/werewolf-orchestrator ← apps/api ← apps/web`
   holds, with `agent-runtime` strictly upstream of
   `werewolf-orchestrator` (verified in
   `packages/werewolf-orchestrator/package.json` deps).

---

## Issues

### Critical

None. The cycle fix is correct, the demo runs end-to-end, privacy
invariants are pinned across the new code path, and a cold rebuild
plus cold typecheck both pass.

### Important

**I1. Plan-4a/4b shipped under a no-op `pnpm typecheck`.**
`5ca21132` (`fix(scripts): make typecheck actually fail on type
errors`) is honest about what it does — but the implication is
significant. Before this commit, the workspace `typecheck` script was

```
pnpm -r run build --noEmit 2>&1 | grep -v 'warning\\|info' || true
```

The `--noEmit` flag was appended to every package's `build` script,
and `apps/web`'s build is `tsc -b && vite build`, so `--noEmit` landed
on `vite build` — which CACError'd. The trailing `|| true` swallowed
that exit code. Net effect: **`pnpm typecheck` always exited 0,
regardless of TS errors anywhere in the workspace.** The commit body
calls this out with `Verified: clean tree exits 0; an injected TS2322
exits 1.`

**Implication:** any plan-4a or plan-4b review that relied on `pnpm
typecheck` as a gate had no signal. `pnpm build` (used in this
review) was always the real gate, but if anyone relied on `typecheck`
as a faster preflight, they were getting false greens for an
unbounded period. Worth a paragraph in the plan-4c shipping notes
("Retroactive typecheck verification of 4a/4b after 5ca2113 was a
one-time validation; future runs are gated"). Recommend a brief grep
of CI history or a `pnpm typecheck` rerun against 4a/4b's tip commits
to confirm no latent type errors slipped through.

**Side effect, low impact:** `lint` and `typecheck` are now identical
strings. That's fine, but documenting the redundancy (or removing one
in favor of the other in `package.json:14-15`) avoids future
confusion. Recommend keeping `typecheck` and adding `"lint":
"pnpm typecheck"` so the alias is explicit.

**I2. Privacy invariant 3 (`speak.inner` strip) is not pinned in the
new e2e.** The platform overview (`docs/agent-poker-werewolf-platform-overview.md:50-52`)
lists this as one of five invariants defended by ≥2 layers and pinned
by tests. The new e2e test does not assert anything about
`speak`/`inner`. Reasoning:
- `WerewolfRandomMockAgent` (`packages/agent-runtime/src/werewolf-random-mock-agent.ts:35-41`)
  picks a valid action verbatim. The engine's valid-actions for
  `day-speeches` produces `{ type: 'speak', ..., inner: '' }` (empty
  string), so the round-trip technically does include a `speak` action
  — but with empty `inner`, the assertion `inner === undefined` after
  filter would not distinguish "filter ran" from "input was empty".
- `werewolf-filter.test.ts:145-159` covers the strip at unit level
  (with non-empty `SECRET` inner), so the regression *is* pinned.

**Recommendation (Important, not Critical):** add a single assertion
in `werewolf-http-e2e.test.ts` that scans the public replay for
`engine.action_applied` events of type `speak` and asserts
`payload.action.inner === undefined`. The existing demo path produces
these events with empty inner, so the assertion is meaningful only
under defense-in-depth (catching a regression where a future agent
implementation sets `inner` to a non-empty value but the strip
breaks). This is cheap insurance and closes the matrix. Without it,
plan-4c's e2e covers 4 of 5 invariants end-to-end — invariant 3 only
at unit level.

**I3. Persistence cap (`maxTraceBytes` / `maxMatchTraceBytes` /
`maxTracesPerMatch`) is not pinned in the new e2e.** The defaults at
`packages/persistence/src/werewolf-decision-trace-store.ts:21-25` are
8KB / 512KB / 1000 traces. The e2e runs a 9-AI match through the
demo path. With `WerewolfRandomMockAgent` (no `reasoningSummary`),
each trace is small and the match completes in ~50-150 traces — far
below caps. So the caps are passed through structurally but not
exercised. Plan-4a presumably has unit tests for the cap, but the
plan-4c integration test does not verify "real demo path respects
caps" beyond "the artifact persisted successfully". This is fine for
4c's scope (caps were established in 4a) but worth a one-line comment
at `werewolf-http-e2e.test.ts:135` indicating the demo path stays
well within caps and the cap-violation test lives in
`packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts`.

**I4. WS placeholder's error path is testable but not type-safe at
construction.** `WerewolfWsAgentAdapter` (`packages/agent-runtime/src/werewolf-ws-agent-adapter.ts`)
implements `IAgent` and stores three string fields. There is no
compile-time signal that this is a stub — a caller `new
WerewolfWsAgentAdapter('a', 'A', 'ws://...')` typechecks and
constructs cleanly; the throw only fires at the first
`requestDecision`. For poker the same shape exists, so this is
parity. **Mitigation suggestion** (Minor): export a `__placeholder:
true` brand or a JSDoc `@deprecated WS adapter is a stub — use
WerewolfHttpAgentAdapter` so IDE hints surface the limitation at use
sites. Not a blocker.

### Minor

**M1. `as unknown as Parameters<typeof worker.requestDecision>[0]`
appears in two places** (`examples/werewolf-local-simulation/index.ts:50`
and `apps/api/src/__tests__/werewolf-http-e2e.test.ts:53`). The cast
is necessary because `z.infer<typeof WerewolfDecisionRequestSchema>`
is structurally similar but nominally distinct from the domain
`WerewolfDecisionRequest`. This pattern recurs across the codebase
(poker has the same). Consider a single helper
`fromWire(parsed): WerewolfDecisionRequest` in
`@agent-poker/agent-protocol` that does the cast in one place with a
comment, so the seam is named and the cast can be audited centrally.
Not a blocker; the existing inline comment in
`index.ts:46-48` is sufficient.

**M2. Demo lacks SIGINT/SIGTERM handler.** If the user Ctrl-C's
mid-match, the 9 in-process Fastify instances release their ports on
process exit, so there's no resource leak. However, the artifact
**will not** be persisted (the orchestrator only calls
`saveMatchArtifact` after `runMatch` resolves). Worth a one-line
note in the demo README stating "match must complete; Ctrl-C
abandons the match without persisting." This is purely UX, not a
correctness issue.

**M3. Demo's per-seat `seed` is `${seedBase}-${playerId}` but the
match seed is `seedBase` itself.** This is reproducible and
intentional, but slightly fragile: a refactor that changes the
seeding scheme in `WerewolfRandomMockAgent` (which already
double-seeds with `${options.seed}-${agentId}` at line 25) means
the effective seed is `${seedBase}-${playerId}-${agentId}` — three
levels deep. Reproducibility holds, but the layering is confusing.
Consider documenting or simplifying.

**M4. `await Promise.all(servers.map((s) => s.close()))` in the e2e's
`finally` does not catch individual close failures.** If one Fastify
close throws, the `Promise.all` rejection masks the test's actual
assertion failure. Use `Promise.allSettled` to ensure the test's
real failure mode surfaces. Demo has the same pattern at
`index.ts:130`. Tiny issue; rarely hits in practice.

**M5. `apps/api` integration test starts a Fastify server on a real
port but does not use fake timers.** The CLAUDE.md convention says
"Use `vi.useFakeTimers()` for any test touching `TimeoutHandler`."
The e2e wraps adapters with `TimeoutHandler` indirectly (through
`WerewolfMatchRunner`). Real timers are unavoidable here because the
HTTP path is real and `setTimeout(controller.abort, ms)` interacts
with `fetch`. The test is bounded by `30_000` ms. Worth a comment
acknowledging the deviation from the convention and why (full e2e
needs real network). Not a blocker; the convention is for unit-level
tests.

**M6. Cycle-fix's synthetic fallback drifts if real fallback's
contract changes.** The inline `werewolfFallback` at
`werewolf-http-agent-adapter.test.ts:16-20` returns
`req.validActions[0]!` — the current contract. If
`werewolf-orchestrator/src/werewolf-fallback.ts` ever picks
differently (e.g., a deterministic-by-phase selection), this test
will silently keep using the old behavior. The commit message
acknowledges this is by design ("real `werewolfFallback` is still
exercised end-to-end by werewolf-orchestrator's match-runner tests
and the API werewolf-http-e2e test"). Worth adding a `// MUST
mirror werewolfFallback's contract` comment to make the link
explicit.

**M7. `examples/werewolf-local-simulation/tsconfig.json` includes
`composite: true` and `outDir: dist` but the package's `build`
script is `echo 'No build for examples'`.** `composite: true` has
side effects (.tsbuildinfo emission, project-reference rules). The
poker `local-simulation` has the same pattern, so this is parity,
but the unused `composite` and `outDir` could be removed for clarity.
Not a blocker.

**M8. The `pnpm install` step is required after merge** (the demo
package is new). The plan calls this out at line 70 of the plan
doc. Worth restating in the merge PR description (or a CHANGELOG
entry) so other developers don't hit the symlink resolution failure
documented in `CLAUDE.md` ("Failed to load url @agent-poker/<pkg>").

---

## Recommendations

In rough priority order:

1. **(Important) Add an `inner === undefined` assertion to the
   werewolf E2E test** to close invariant 3 at the e2e level. ~3
   lines. Code suggestion:

   ```typescript
   const speakEvents = liveEvents.filter(
     (e) => e.type === 'engine.action_applied' &&
       (e.payload['action'] as { type?: string })?.type === 'speak',
   );
   for (const e of speakEvents) {
     const action = e.payload['action'] as Record<string, unknown>;
     expect(action['inner']).toBeUndefined();
   }
   ```

2. **(Important) Document the typecheck-script fix retroactively.**
   Add a note to `docs/agent-poker-platform-CLAUDE.md` or the next
   shipping notes that says "between (start of plan-4a) and 5ca2113
   the workspace `typecheck` script was a no-op; ship gates relied on
   `pnpm build`." A future reviewer reading the git log should
   immediately understand why retro-typechecking 4a/4b might surface
   issues that "passed" at the time.

3. **(Minor) Centralize the Zod→domain seam cast.** Add
   `agent-protocol`'s `fromWire(parsed): WerewolfDecisionRequest`
   helper. Removes the `as unknown as` from demo + e2e + future
   call sites.

4. **(Minor) Add `Promise.allSettled` for cleanup** in demo and e2e
   so a single Fastify close failure doesn't mask the real test
   failure.

5. **(Minor) JSDoc `WerewolfWsAgentAdapter` as `@deprecated stub`**
   so callers see the IDE warning. Cheap and discoverable.

6. **(Minor) Comment-link the synthetic fallback to the real one** in
   `werewolf-http-agent-adapter.test.ts:16` so future drift is caught.

7. **(Minor) Re-run plan-4a and plan-4b's tip commits with the new
   `pnpm typecheck`** as a one-time post-fix validation, and capture
   the result in the plan-4c CHANGELOG / merge notes.

---

## Assessment

**Land it.** Plan-4c delivers exactly what the plan describes: a
real HTTP adapter, a WS placeholder, a 9-AI in-process demo, and an
E2E test that spans orchestrator → 9 HTTP adapters → 9 Fastify
servers → engine → persisted artifact. Cold-build + cold-typecheck
both pass on the merge tip. Privacy invariants 1, 2, 4, and 5 are
pinned at the e2e level; invariant 3 is pinned at unit level (with
defense-in-depth in two layers) but not surfaced in the new e2e —
the recommended `inner === undefined` assertion (Recommendation 1)
would close that gap and is ~3 lines; adopt before merge if cheap,
or as a follow-up if not.

The cycle fix at `37b3f4f` is the most consequential commit in the
range. It's structurally correct (devDep removed, no `import type`
hack, no project-reference shenanigans) and the diagnosis in the
commit message is precise. Without it, a cold-build merge into main
would have failed TS2307; with it, the dependency DAG is genuinely
acyclic at both runtime and tsc-build-mode levels.

The script fix at `5ca2113` is honest about a real and embarrassing
bug — `pnpm typecheck` was silently a no-op since at least the start
of plan-4a. The fix is correct, but the retroactive implication is
that earlier reviews could not have relied on `typecheck` as
evidence. Plan-4c's reviewer (this review) used `pnpm build` and
`pnpm typecheck` both, against a cold tree, so 4c's gate is intact.
Recommend explicitly re-running typecheck against the 4a/4b tips as
a post-merge sanity check.

No critical issues. Two important nits (e2e coverage of invariant 3;
documenting the retroactive typecheck implication). Eight minor
polish items. The architecture, layering, and contract discipline
are all clean.

**Confidence:** high. The cold-build + cold-typecheck verification,
combined with the structural cycle fix and the privacy-invariant
matrix, makes me confident the merge is safe. Adopt
Recommendation 1 if cheap.
