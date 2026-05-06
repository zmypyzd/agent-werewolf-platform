# Werewolf Plans 4a / 4b / 4c — Cross-Plan Executive Summary

**Date:** 2026-05-06
**Reviewer:** independent gstack-style pre-landing review
**Scope:** the three werewolf plans already merged to `main`
- plan-4a (persistence + projection): `8cf5ba9..3449b8d`, 18 commits
- plan-4b (API + realtime hub): `3449b8d..0da6d8d`, 18 commits
- plan-4c (demo + adapters): `7419fb9..fdaf4ba` (first-parent), 13 commits including merge `694999a` and post-merge fixes `37b3f4f` + `5ca2113`

**Per-plan reports:**
- `docs/superpowers/reviews/2026-05-06-gstack-review-plan-4a.md`
- `docs/superpowers/reviews/2026-05-06-gstack-review-plan-4b.md`
- `docs/superpowers/reviews/2026-05-06-gstack-review-plan-4c.md`

---

## Headline assessment

**Land all three. No critical blockers anywhere.**

All three reports converge on the same verdict: the architecture, layering, and information-isolation discipline are clean. Cold-build + cold-typecheck pass on the merged tip. The five werewolf privacy invariants are layered at ≥2 enforcement points each, with non-vacuous negative-space tests pinning the most security-relevant frames. The DAG holds — `agent-runtime` is genuinely upstream of `werewolf-orchestrator` after the post-merge cycle fix.

| | Critical | Important | Minor |
|---|---|---|---|
| plan-4a | 0 | 3 | 6 |
| plan-4b | 0 | 3 | 7 |
| plan-4c | 0 | 4 | 8 |
| **Total** | **0** | **10** | **21** |

(Plan-4b's I3 was self-resolved during review and is not counted.)

---

## Cross-plan strengths (what's working across all three)

1. **Privacy invariants are defended at ≥2 layers.** Every protected point has a type-layer guard (`Omit<…>`, narrowed union, exhaustiveness `_exhaustive: never`) plus a runtime guard (filter, destructure-and-spread, sanitize-on-broadcast). Every invariant has at least one negative-space test.
2. **Negative-space tests are non-vacuous.** The two patterns that catch vacuous-forEach footguns both appear:
   - `werewolf-matches.integration.test.ts:136` asserts `liveEventTypes.every((e) => e.sequence >= 0)` before iterating.
   - `werewolf-ws.test.ts:159-188` asserts Bob receives frames *before* asserting Alice does not.
3. **Real engines, not mocks.** Integration tests run the real `werewolf-engine`, real `WerewolfMatchRunner`, real `MemoryWerewolfDecisionTraceStore`, and (in 4c's e2e) real Fastify servers on real ephemeral ports.
4. **Single filter, two consumers.** Both the persistence path (`toPublicWerewolfReplayEvents`) and the WS publish path (`attachWerewolfHub`) call the same `werewolfReplayEventToPublic` — no parallel implementation drift.
5. **WS player-topic gate is structurally spoof-resistant.** `slice` + `indexOf` on `player:<userId>:<gameId>` (not `split(':')`), userId derived from cookie session (not client-supplied), publish-side ownership map as a second wall (`hub-integration.ts:76-85`).
6. **TS strict + `exactOptionalPropertyTypes` clean.** No `any`, no `// @ts-ignore`, no `// @ts-expect-error`. Conditional optional-prop spread used correctly.

---

## Issues by severity, with cross-plan attribution

### Critical
None across any plan.

### Important (10)

| # | Plan | Title | Files | What & why |
|---|---|---|---|---|
| 1 | 4c | **`pnpm typecheck` was a no-op until `5ca2113`** | `package.json:14-15` (workspace root) | The pre-fix script appended `--noEmit` to every package's `build`, including `apps/web`'s `tsc -b && vite build`, where it CACError'd into `\|\| true`. **Retroactive implication: any 4a/4b review that relied on `typecheck` had no signal.** `pnpm build` is the real gate (and it does pass), but this is the most consequential discovery in the whole review. |
| 2 | 4a | **`BuildWerewolfArtifactInput.seed` is required but unread** | `packages/persistence/src/werewolf-match-artifact-serialization.ts:28,50-96` | A required input field the implementation silently ignores. A future contributor adding `seed: input.seed` "for symmetry with the input shape" silently breaks privacy invariant 2 (match-seed redaction). No public-summary contract test asserts `summary` JSON has no `seed` key — the existing tests only assert it's absent from `match.started` events. |
| 3 | 4a | **`MemoryWerewolfMatchArtifactStore` does not enforce cost limits** | `packages/persistence/src/werewolf-match-artifact-store.ts:51-95` | `DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS` is consumed only by the Object variant. Mirrors poker's pattern (consistent), but most integration tests use the Memory store, so cap enforcement isn't exercised at integration level. |
| 4 | 4a | **`containsSpeakInner` recursive heuristic over-broad** | `packages/realtime/src/werewolf-filter.ts:62-73` | Treats *any* nested `{ type: 'speak', inner }` as a speak action. No bug today; structural concern about future event shapes accidentally getting `inner` redacted. Either scope to known event types or document explicitly. |
| 5 | 4b | **`subscribePrivate` listener-identity unsubscribe semantics** | `packages/werewolf-orchestrator/src/orchestrator.ts:110-117` | `entry.emitter.on('private-state', listener)` directly. If a caller registers the same function reference twice and calls only one returned unsubscribe, the other stays attached. Production path uses fresh closures, so safe — just unpinned. |
| 6 | 4b | **Hub-integration payload spread can shadow event metadata** | `packages/werewolf-orchestrator/src/hub-integration.ts:59-64` | The current order (`{ ...publicEvent.data, eventId, sequence, timestamp }`) is correct — metadata wins — but no test pins it. Inverse order would silently break sequence-based ordering. |
| 7 | 4b | **WS connection has no per-connection subscription rate-limit** | `apps/api/src/routes/ws.ts:53-66` | Authenticated client can subscribe to unbounded `match:<arbitrary>` topics. Pre-existing in poker side; not introduced by 4b. Worth a follow-up plan. |
| 8 | 4c | **Privacy invariant 3 (`speak.inner` strip) not pinned in the new e2e** | `apps/api/src/__tests__/werewolf-http-e2e.test.ts:191-263` | Pinned at unit level in `werewolf-filter.test.ts:145-159`, but the e2e covers 4 of 5 invariants — invariant 3 is unit-only end-to-end. ~3 lines of assertion would close it. |
| 9 | 4c | **Persistence cap (maxTraceBytes etc.) not exercised in the new e2e** | `apps/api/src/__tests__/werewolf-http-e2e.test.ts:135` | Demo path stays well within caps; cap-violation pinned only in `packages/persistence`'s unit tests. Worth a comment linking the cap surface to its enforcement test. |
| 10 | 4c | **`WerewolfWsAgentAdapter` placeholder has no compile-time stub signal** | `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts` | Caller can `new` and store the instance; throw fires only at first `requestDecision`. Mirrors poker's WS adapter (parity), but a `@deprecated stub` JSDoc would surface the limitation in IDEs. |

### Minor (21 — abridged)
Each per-plan report has a numbered list. Common categories:
- **Hygiene / type-narrowing:** hash-format prefix (4a-M1), duplicate type re-export (4a-M3), tighten empty-`gameId` rejection (4b-M1), restore explicit `seed` strip in `publicIndexEntry` (4b-M5), centralize Zod→domain seam cast (4c-M1).
- **Test signal upgrades:** vacuous `appliedAction` assertion (4a-M4), pin `attachMatch`-before-`runMatch` ordering (4b-M6), `Promise.allSettled` in demo cleanup (4c-M4).
- **Defense-in-depth duplicates:** `safePathSegment` at every store entry point (4a-M2), per-event-type gating of `containsSpeakInner` (4a-M6).
- **Operational polish:** demo SIGINT note (4c-M2), `composite: true` in unused tsconfig (4c-M7), `pnpm install` required after merge (4c-M8).

---

## Recommendations

**Pre-merge (do these now or as a tiny follow-up PR — all 1–3 lines each):**

1. **Verify retroactively** that plan-4a and plan-4b tip commits typecheck cleanly under the *fixed* `pnpm typecheck`. Document the result in the next CHANGELOG entry. (Issue #1.) This is the only finding that retroactively touches earlier work.
2. **Drop or formalize `BuildWerewolfArtifactInput.seed`.** Either remove it from the input type (and the orchestrator caller in `orchestrator.ts:207`) or add a comment + a public-summary contract test asserting `summary` JSON has no `seed` key. (Issue #2.)
3. **Add `inner === undefined` assertion in `werewolf-http-e2e.test.ts`.** ~3 lines; closes invariant 3 at the e2e level. Suggested code is in the plan-4c report. (Issue #8.)
4. **Tighten `isOwnPlayerTopic` and `match:` gate** to reject empty `gameId`. (4b-M1.)
5. **Restore explicit `seed` strip in `publicIndexEntry`** as defense-in-depth. (4b-M5.)
6. **Pin the metadata-precedence test** in `hub-integration.test.ts`. (Issue #6.)

**Follow-up plan (track as tickets, not pre-merge):**

7. **Per-connection topic-subscription cap** in `RealtimeHub.subscribe`. (Issue #7.) Pre-existing in poker too — fix once.
8. **Document Memory-store-no-cost-limits asymmetry** in JSDoc, or add the gate. (Issue #3.)
9. **Scope `containsSpeakInner` to known event shapes,** or document the broad-strip behavior. (Issue #4.)
10. **Decision-trace richer-action variant** (preserving target hashes that match across traces of the same match) once an analyzer consumer materializes — referenced in plan-4a's report under Recommendation 5.
11. **`@deprecated` JSDoc on `WerewolfWsAgentAdapter`** for IDE-level discoverability. (Issue #10.)

---

## Two issues I'm most worried about

**1. The retroactive typecheck no-op (Issue #1, plan-4c).** Not a bug in any single plan — but it means the `pnpm typecheck` signal that anyone may have relied on during plan-4a / plan-4b reviews was zero. `pnpm build` is the actual gate and does pass cleanly, so the architectural conclusions hold. But the next reviewer of any older branch should know not to trust the "typecheck passed" note from the 4a/4b era. Worth one explicit re-run against `3449b8d` and `0da6d8d` to capture the current state.

**2. The unused `BuildWerewolfArtifactInput.seed` field (Issue #2, plan-4a).** This is the only place I see a footgun aimed directly at the most consequential privacy invariant — match-seed redaction. The implementation correctly drops it, but the type still demands it, and there's no test proving the dropped behavior survives. A future "code-cleanliness" PR could propagate `input.seed` into the artifact summary in three lines and break privacy invariant 2 silently. The fix is two minutes of work; the cost of not fixing is borne by whoever inherits this code under a future deadline.

---

## Confidence

High. The reports are independent reads against the same range; their findings overlap where you'd expect (DAG, privacy filters, test discipline) and disagree on nothing material. Cold-build + cold-typecheck both pass on `fdaf4ba`. The architecture is ready for plan 4d / next-phase work.
