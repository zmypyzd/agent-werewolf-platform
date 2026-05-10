# HANDOFF — Overnight QA on `werewolf` module

> ## ✅ CLOSED 2026-05-10
>
> All 25 PRs (#4–#27 from the original two QA rounds, plus #28 + #29
> hotfixes discovered during deploy) merged to `main`; #22 closed as
> superseded by #23. Production deploy verified live. See
> [`README.md`](./README.md) for the campaign post-mortem.
>
> The text below is preserved verbatim as written *during* the run; references
> to "PRs in flight" and "bug-hunt loop continuing" are no longer current.

---

> **Audience**: a fresh Claude Code session (or a human) picking up this work.
> **Status as of 2026-05-10 03:10Z**: 20 PRs shipped on `overnight-qa/*` branches, `main` untouched, all 1071+ tests pass per branch.
> **Mode**: autonomous overnight bug-hunt + fix loop. Each finding → small PR for human review.

---

## 1. The original task (verbatim user request, paraphrased)

> "我的项目 werewolf 部分已经上线，但是它还有很多未知 bug 和问题。请你给出一个优化产品的计划，包括如何去发现问题，再如何去解决问题。计划执行后，能达到你一晚上都在优化产品，明早我起来看 GitHub，能看到很多问题被你发现且解决。"

Translation: production `werewolf` module is live but has unknown bugs. Run autonomously overnight; wake up to many fix PRs on GitHub. Don't stop to ask questions.

User then said the planned mode was correct and instructed continuing without asking. After ~17 PRs, user opened a new chat — that's why this handoff exists.

---

## 2. Repo + environment

- **Working dir**: `/Users/zmy/intership/5/5-4-claude`
- **Git remote**: `https://github.com/zmypyzd/agent-werewolf-platform.git`
- **Production**: `https://werewolf-api-ttsb.onrender.com` (Render, Singapore region, free tier — ~30s cold start)
- **Render service ID**: `srv-d7uo61lb910c73epl1d0`
- **Render API token**: `~/.config/render/api-key`
- **Stack** (per `CLAUDE.md`): TS 5.5 strict, Node 20, pnpm 10.33.2 workspaces, Vitest 2, Fastify 4 + Zod, React 18 + Vite 5
- **Current host Node** is v25.9 — engines warning is benign, build/test work fine
- **`main` branch** is clean and equal to `origin/main`. None of the 20 PRs are merged yet.

---

## 3. The plan file (source of truth for the overnight loop)

**Path**: `/Users/zmy/.claude/plans/werewolf-bug-structured-fern.md`

The plan defines six discovery pipelines (F: typecheck/lint/test gate; B: replay invariant scanner; C: frontend↔backend contract scan; D: production health probe; E: design review — not run, no live browser session; A: live `/qa` browser flow — not run for the same reason). The plan also enumerates the autonomous decision rules (small fixes, never `--no-verify`, never touch prod data, max 3 attempts before deferring, etc.).

**Re-read the plan first when resuming** — it captures the operating principles that kept the loop autonomous.

---

## 4. The 20 PRs (full list, in dependency order)

Run `gh pr list --search "[overnight-qa]"` for the live view. Snapshot:

| PR  | Branch                                                      | Severity   | Notes |
|-----|-------------------------------------------------------------|------------|-------|
| #4  | `overnight-qa/werewolf-matches-503-on-db-permission`        | **P1**     | Prod fix + idempotent regrant migration. **Operator must run `supabase db push` after merge.** |
| #5  | `overnight-qa/replay-invariant-scanner`                     | infra      | `scripts/overnight-replay-audit.mjs` + `scripts/overnight-batch-sim.sh`. Standalone QA tool. |
| #6  | `overnight-qa/night-fold-undefined-number`                  | P2 visual  | "夜 0" cosmetic in timeline reducer. |
| #7  | `overnight-qa/lobby-fill-with-npcs-button`                  | feature    | One-click fill 9 NPCs in waiting lobby. |
| #8  | `overnight-qa/engine-invalid-action-fuzz`                   | P2 fix     | Engine `default` arm rejects unknown action.type. |
| #9  | `overnight-qa/dockerfile-include-docs`                      | **P1**     | Dockerfile + `.dockerignore` include `werewolf-http-agent-guide.md`. **Next Render deploy fixes the prod 404.** |
| #10 | `overnight-qa/werewolf-agents-token-no-cache`               | security   | `Cache-Control: no-store` on werewolf token responses. |
| #11 | `overnight-qa/agent-invites-token-no-cache`                 | security   | Same defense for poker `agent-invites`. |
| #12 | `overnight-qa/match-runner-trace-resilience`                | P2 fix     | Trace store failure no longer crashes match. |
| #13 | `overnight-qa/backlog-and-rounds-report`                    | docs       | `docs/overnight-qa-backlog.md` — full audit trail of all 4 rounds. |
| #14 | `overnight-qa/lobby-creator-only-start`                     | **P1 sec** | Authorization bypass: any logged-in user could `/start` any lobby. Adds `creatorUserId` + `assertCreatorOnly`. |
| #15 | `overnight-qa/invite-agent-race-recheck`                    | **P1 fix** | `inviteAgent` race: post-await re-check on seat occupancy. |
| #16 | `overnight-qa/phase-indicator-failed-and-night-0`           | P2 visual  | Failed-pre-match contradictory subtitle + sentinel-zero phase number. |
| #17 | `overnight-qa/engine-property-fuzz`                         | infra      | 8-seed engine fuzz with 7 invariant gates. |
| #18 | `overnight-qa/engine-double-death-dedup-test`               | test       | Pin `phases.ts:49` wolf+witch-same-target dedup. |
| #19 | `overnight-qa/registry-distinguish-persist-fail`            | P2 fix     | Lobby keeps `status=completed` when post-game persist throws. |
| #20 | `overnight-qa/validator-reason-no-id-leak`                  | **P1 sec** | Validator reason embedded JSON of action → leaked night-action IDs via SSE. |
| #21 | `overnight-qa/auth-header-name-validation`                  | hardening  | RFC 7230 regex on `authHeader{Name,Value}` — blocks CR/LF injection at the API edge. |
| #22 | `overnight-qa/lobby-creator-no-public-leak`                 | privacy    | Adds `creatorUserId` to omit list (depends on #14). **Superseded by #23 structurally**, kept for git-history breadcrumb. |
| #23 | `overnight-qa/public-entry-allowlist-projection`            | structural | Inverts `publicEntry` to allowlist + compile-time guard. Replaces the destructure-and-omit pattern entirely. |

### Suggested merge order

1. **#4** first (P1 prod fix + needs `supabase db push` follow-up).
2. **#9** next (P1 deploy fix — next Render deploy includes the doc).
3. **#14** before **#22**/**#23** (those depend on `creatorUserId` field).
4. Remaining order is flexible; small independent diffs.

The merge graph is mostly independent — only #22 and #23 depend on #14. If user prefers the structural fix, merge #14 then #23 and close #22 as superseded.

---

## 5. Items deliberately not done

These are documented as design-intent or out-of-scope, **not bugs**:

- **CAND-002**: `match.started` broadcasts every player's role at t=0. Documented intent in `match-runner.ts:98-104` (ISSUE-005 ref). Spectator UX choice; do not "fix" without user direction.
- **CAND-003**: No web UI for werewolf match replay/history. API endpoints exist, page doesn't. >200 LOC feature build.
- **CAND-004**: No web UI for werewolf agent config management. Same shape.
- **`speak.inner` field is publicly broadcast** — codified as intentional in `sanitize-action.ts:6` AND has an explicit integration test (`g-int-inner-public`) asserting it appears in broadcast events. Don't strip without explicit user direction.
- **Object-store decision-trace concurrent write race** flagged by Explore agent — needs concurrency primitive, not a tactical fix.

---

## 6. How to resume in a new session

### First moves (in order)

```bash
# 1. Pull latest, confirm main is clean
cd /Users/zmy/intership/5/5-4-claude
git status                           # should be clean on main
git pull origin main                 # in case user merged anything

# 2. See what merged while away
gh pr list --search "[overnight-qa]" --state all --json number,title,state \
  --template '{{range .}}#{{.number}} {{.state}}\t{{.title}}{{"\n"}}{{end}}'

# 3. Re-read the plan + backlog
cat /Users/zmy/.claude/plans/werewolf-bug-structured-fern.md
cat docs/overnight-qa-backlog.md       # only on the PR #13 branch — `git show origin/overnight-qa/backlog-and-rounds-report:docs/overnight-qa-backlog.md`

# 4. Check production health
curl -s https://werewolf-api-ttsb.onrender.com/health
curl -s https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches  # was P1 in CAND-001
curl -s -o /dev/null -w '%{http_code}\n' https://werewolf-api-ttsb.onrender.com/api/v1/docs/werewolf-agent-guide  # was P1 in CAND-008
```

### Then continue the loop

The same 4-round structure can run indefinitely. After resuming:

1. **Review what merged**. If user merged #4 + ran `supabase db push`, the prod `werewolf-matches` 500 is fixed — re-curl to confirm.
2. **Pull in any new findings** the user discovered after waking up. They might have feedback on PR review.
3. **Re-run the discovery pipelines** (especially Pipeline F gate + Pipeline D production probe). New bugs surface as PRs land and prod state changes.
4. **Pick the next bug**. The plan's principles still apply: small PRs, host-only branches `overnight-qa/<slug>`, never touch `main` directly.

### Suggested next investigation areas (untouched so far)

- **Live `/qa` browser flow** against production once a Supabase auth session can be set up — this would surface UI bugs a static review can't catch. Needs `/setup-browser-cookies` from gstack.
- **Poker engine + orchestrator** — parallel module to werewolf, similar patterns. Likely has parallel bugs that mirror the werewolf ones. Specifically check whether poker's `me-agents` POST has the same no-cache leak as #10.
- **WerewolfTableSurface** for screen-reader / a11y — observed missing `role` attributes on seats but didn't ship a fix.
- **The 17-night marathon match seeds** (output from `pnpm demo:werewolf` with random mock occasionally produces 17+ night games) — best stress test for cap-related code paths the scanner doesn't fully cover yet.
- **Postgres replay event store live ingestion** — fire-and-forget pattern; check whether failures during heavy load could lose events between buffer/flush cycles.
- **Witch state machine** — only basic test coverage. Adversarial tests for: skip-save then poison the wolf-target, save self when targeted, save twice in same night attempt.
- **Hunter shoot edge cases** — what happens if hunter is poisoned by witch (rule says no shoot), then later banished — does engine correctly NOT enter hunter-shoot phase the second time?

### Hard rules (still in force)

- **Never push to `main`**.
- **Never `--no-verify`, never amend committed PRs without user OK**.
- **Never touch prod Supabase data** (the regrant migration in #4 is operator-applied).
- **Never modify `render.yaml`**.
- **Each fix → small PR on `overnight-qa/<slug>` branch**.
- **3-attempt failure budget per bug** before deferring to backlog.
- **All commits must keep `pnpm test` + `pnpm typecheck` green** at HEAD of the branch.

---

## 7. Useful command cheat-sheet

```bash
# Run full test suite
pnpm test                                         # full workspace
pnpm --filter <pkg> run test src/__tests__/x.ts   # single file
pnpm typecheck                                    # tsc --noEmit across workspace

# Local sim (random NPC matches)
pnpm demo:werewolf                                # one match → examples/werewolf-local-simulation/output/

# Replay invariant scanner (only after PR #5 lands or via cherry-pick)
node scripts/overnight-replay-audit.mjs

# Run N random sims for fuzz
bash scripts/overnight-batch-sim.sh 50 audit-rN

# Production probe quickset
curl -s -w '\n%{http_code} time=%{time_total}\n' https://werewolf-api-ttsb.onrender.com/health
curl -s -w '\n%{http_code} time=%{time_total}\n' https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-games
curl -s -w '\n%{http_code} time=%{time_total}\n' https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches

# PR loop helpers
gh pr create --title "..." --body "..."
gh pr list --search "[overnight-qa]"
gh pr view <n>
```

---

## 8. Key files for orientation

- **Plan**: `/Users/zmy/.claude/plans/werewolf-bug-structured-fern.md`
- **Backlog (live audit trail)**: on PR #13 branch as `docs/overnight-qa-backlog.md` — `git show origin/overnight-qa/backlog-and-rounds-report:docs/overnight-qa-backlog.md`
- **Project rules**: `CLAUDE.md` at repo root
- **Design system**: `DESIGN.md` (read before any UI change)
- **Werewolf engine** (pure, no I/O): `packages/werewolf-engine/src/`
- **Orchestrator**: `packages/werewolf-orchestrator/src/match-runner.ts` (the hot path)
- **Lobby registry**: `apps/api/src/werewolf-lobby-registry.ts` (carries auth state, seat ownership)
- **Public broadcast filter**: `packages/realtime/src/werewolf-filter.ts`
- **HTTP routes**: `apps/api/src/routes/werewolf-*.ts`
- **Web room reducer** (regression-bug-prone): `apps/web/src/werewolf-room/werewolfRoomReducer.ts`

---

## 9. Memory + reminders the new session should know

- User email: `mc.verla@mail.com`
- Today's date (frozen at session start): 2026-05-10
- The `m5-bootstrap` hook noise (`需要补齐: { needs_bootstrap: true ... }`) appears on every commit — it is harmless, ignore.
- The `[m5-bootstrap]` text is NOT a hook failure; commits succeeded.
- Telemetry hint: do not invoke `/ultrareview` — that's a billed user-triggered action, not for the agent.

---

## 10. What to tell the user when resuming

Open the new session by:

1. Reading this `HANDOFF.md` first.
2. Running the 4 commands in §6 "First moves" to refresh state.
3. Reporting back: (a) which PRs (if any) the user merged while away, (b) current production health, (c) any new candidate bugs from the next discovery loop.
4. Then ask **once** whether to continue the loop, then proceed without further questions per the plan's autonomy principle.

Do not re-do work already shipped. Do not open duplicate PRs. The 20 existing PRs are the deliverable — keep building on top, not rebuilding from scratch.
