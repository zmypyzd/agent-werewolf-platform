# Overnight QA Bug Hunt — Closed 2026-05-10

This directory archives the artifacts from a multi-session autonomous bug-hunt loop that ran against the production werewolf module on 2026-05-09 → 2026-05-10. Kept as a reference for similar campaigns in the future.

## What it was

The user said roughly: *"Production werewolf is live but has unknown bugs. Run autonomously overnight; wake up to many fix PRs on GitHub. Don't stop to ask questions."*

Two parallel Claude Code sessions (CC-1 + CC-2) worked the loop. Each found and fixed bugs as small `overnight-qa/<slug>` PRs against `main`, never touching `main` directly. A third CC session reviewed the resulting PRs, executed the merge runbook, applied two hotfix migrations, and verified the deploy live.

## What shipped

**25 PRs merged + 1 closed-as-superseded.** PR numbers `#4`–`#29`, with `#22` closed as structurally superseded by `#23`.

By severity:

| Tier | PRs | Notes |
|---|---|---|
| **P1 prod fix** | #4, #9, #19, #28 | Postgres permission denied → 503; Dockerfile missing docs file; lobby keeps `completed` status when persist fails; service_role grant gap (the second hotfix migration) |
| **P1 security** | #14, #15, #20 | Host-only authz on lobby endpoints; invite-agent race; validator reason no longer leaks night-action IDs |
| **P2 fixes** | #6, #8, #12, #16, #27 | Night-fold "夜 0"; engine unknown action.type; trace store resilience; phase indicator failed/round-zero; trace-store concurrency mutex |
| **Security hardening** | #10, #11, #21 | Cache-Control: no-store on token responses (werewolf + poker); RFC 7230 header validation |
| **Structural / a11y** | #23, #24 | publicEntry inverted to allowlist projection; seat aria-label + phase live region |
| **Test / infra** | #5, #7, #13, #17, #18, #25, #26 | Replay invariant scanner; fill-with-NPCs button; backlog doc; engine property fuzz; double-death dedup test; witch saves-self test; concurrent seat mutation pin |
| **Hotfix during deploy** | #28, #29 | Surfaced during merge runbook execution — see "Lessons" below |

## Files in this directory

- **`HANDOFF.md`** — the original handoff written by CC-1 partway through the loop, when the user opened a fresh chat. Captures the working state at that moment: which PRs existed, what was deferred, the operating principles. Read this to understand the *autonomous loop pattern.*
- **`HANDOFF-merge-runbook.md`** — the per-phase merge runbook produced by CC-3 when the user came back. Captures the merge order, supabase ops, Render deploy sequencing, and the two hotfixes (#28, #29) that were inserted mid-run when bugs were discovered. Read this to understand *executing a 25-PR landing.*

## Lessons captured here for future campaigns

1. **Two PRs that are each green individually can break the build when both land.** PR #12 added a test that imported `WerewolfDecisionTrace` from `@agent-poker/persistence`; PR #27 (independent fix) tightened persistence's exports. Each PR's Vercel preview build was green; main HEAD failed `tsc -b`. Fix was a one-line import path change (#29). Standing followup: add a workspace-level `pnpm install && pnpm build` smoke step to CI on every PR merge to main.
2. **Supabase migration completeness ≠ permission completeness.** PR #4's regrant migration covered `anon` and `authenticated` but not `service_role`, which is what the Render API uses. The migration ran cleanly and prod stayed 503 — discoverable only via `has_table_privilege('service_role', ..., 'SELECT')`. Hotfix migration: #28. Standing recommendation: any future "regrant" migration must explicitly include all three roles (`anon`, `authenticated`, `service_role`).
3. **A11y and host-only-authz invariants need to be in the onboarding docs**, not just in PR-level test files. Captured in `CLAUDE.md`, `AGENTS.md`, and `docs/agent-poker-werewolf-platform-overview.md` in a follow-up doc PR.
4. **The auth-state SQLite-`:memory:` posture in production is documented but worth re-evaluating.** `apps/api/src/server.ts` defaults to `:memory:` SQLite for users/sessions/agent-configs, meaning every Render restart wipes them. CLAUDE.md is honest about this; whether it's the right choice for production traffic is a Phase 2 decision (see `TODOS.md`). Not a bug, but flagged here for the next person who wonders why their test users disappear.

## Why archived rather than deleted

Future overnight QA campaigns will follow the same pattern. Reading the operating principles + execution runbook from a real campaign that worked is faster than re-deriving them from PR history.

If a future runbook diverges materially (different domain, different deploy stack, different review cadence), copy this directory as a starting point and modify; don't try to reuse it inline.
