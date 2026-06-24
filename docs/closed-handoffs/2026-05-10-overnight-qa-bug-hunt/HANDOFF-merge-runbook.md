# HANDOFF — Merge Runbook for the Overnight-QA PRs

> ## ✅ EXECUTED 2026-05-10
>
> The full sequence in this runbook ran to completion. All listed PRs merged
> (`24 merged + 1 closed` — count includes the runbook-internal #28
> hotfix). The merge surfaced one additional pre-merge build break that
> required a 26th PR (`#29`, the `WerewolfDecisionTrace` import path
> hotfix); that one is also now merged. See [`README.md`](./README.md)
> for the campaign post-mortem.
>
> The body below is preserved as a reference for future similar
> campaigns. Re-reading the phase ordering, the rebase-after-each-merge
> pattern, and the supabase-migration-plus-render-deploy sequencing is
> the value here — the specific PR numbers no longer apply.

---

> **Audience**: operator (you) merging PRs #4–#27 into `main`.
> **Companion to**: `HANDOFF.md` (which describes WHAT was shipped) and the review reports posted on 2026-05-10.
> **Hard rule**: never `git push origin main` directly. Everything goes through `gh pr merge`.

## What's in scope

- **First QA round (#4–#23)**: 20 PRs from the initial overnight loop.
- **Second QA round (#24–#27)**: 4 additional PRs from the parallel CC session — a11y improvements (#24), engine/orchestrator test pins (#25, #26), and a real concurrency-bug fix in the decision-trace store (#27, which resolves HANDOFF.md §5's "needs concurrency primitive" deferred item).
- **Hot-patch (#28)**: opened during Phase 1 execution — codifies a manual GRANT applied to prod after #4's migration was found to miss `service_role` on four read-paths. Merge after #4, before continuing the rest of Phase 1.
- **Final state**: 24 merged, 1 closed (#22 superseded by #23).

---

## 0. Pre-flight

```bash
cd /Users/zmy/intership/5/5-4-claude

# Confirm main is clean and synced
git fetch origin
git log --oneline origin/main..origin/main   # empty
git status                                    # may show your in-progress a11y branch — that's fine
```

**Important**: the parallel CC's a11y work is now PR #24 (the previously-uncommitted local changes were committed and pushed). If you have other in-progress branches locally, **do NOT `git checkout main`** — it would interfere. Run all merges via `gh pr merge` from your current branch; `gh` operates on the GitHub side and doesn't touch your working tree.

## Merge strategy

Use `--squash` for every PR — matches recent repo style (see PRs #2 #3) and gives you one revertable commit per fix.

```
gh pr merge <N> --squash --delete-branch
```

`--delete-branch` deletes the remote `overnight-qa/<slug>` branch after merge. Local copies (if any) stay.

---

## Phase 1 — P1 prod fixes (paired)

### #4 + supabase migration + #28 follow-up

```bash
gh pr merge 4 --squash --delete-branch

# Required follow-up: apply the supabase migration to prod.
# (NB: as discovered during execution, #4's migration only granted to
# anon + authenticated. The Render API uses service_role and stayed 503
# even after this push — see #28 for the codified fix.)
supabase db push

# Verify prod
curl -s -w '\n%{http_code}\n' https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches | tail -3
# Expected (after #28 prod hotfix already applied): 200 with match data.

# Merge the codified service_role re-grant. This is a no-op on prod
# (the GRANT was applied manually via `supabase db query` during Phase 1
# execution); merging records the migration so fresh envs reproduce the
# fix.
gh pr merge 28 --squash --delete-branch
supabase db push   # registers 20260510010000 in supabase_migrations
```

The migration is idempotent — re-running on a healthy DB is a no-op.

### #19 (paired with #4)

```bash
gh pr merge 19 --squash --delete-branch
```

Why paired: #4 makes the artifact store throw `ServiceUnavailableError` instead of generic `Error`; #19 makes the lobby keep `status='completed'` when that error fires post-game. Merging only one of them leaves a half-fixed system.

---

## Phase 2 — P1 deploy fix

### #9

```bash
gh pr merge 9 --squash --delete-branch

# Render auto-deploys from main. Wait ~2-5 min, then verify:
sleep 180
curl -sf -o /dev/null -w '%{http_code}\n' https://werewolf-api-ttsb.onrender.com/api/v1/docs/werewolf-agent-guide
# Expected: 200. Was: 404.
```

If the deploy hasn't finished after the sleep, check Render dashboard.

---

## Phase 3 — Authorization (#14 → #23, close #22)

### #14 first

```bash
gh pr merge 14 --squash --delete-branch
```

### Re-check #23 after #14 lands

#23 changed the same file as #14 (`werewolf-lobby-registry.ts`). Its mergeable state may flip from `CLEAN` to `BEHIND`.

```bash
gh pr view 23 --json mergeable,mergeStateStatus

# If BEHIND:
gh pr update-branch 23

# Wait for Vercel CI to re-run on the rebased branch:
gh pr checks 23 --watch
```

Then merge:

```bash
gh pr merge 23 --squash --delete-branch
```

### Close #22 as superseded

```bash
gh pr close 22 --comment "Superseded by #23 — the structural allowlist fix replaces this tactical patch. Privacy test reproduced in #23's regression-public-allowlist test."

# Optional: delete the remote branch
git push origin --delete overnight-qa/lobby-creator-no-public-leak
```

---

## Phase 4 — Remaining P1 (independent)

```bash
gh pr merge 15 --squash --delete-branch   # invite-agent race
gh pr merge 20 --squash --delete-branch   # validator reason ID leak
```

---

## Phase 5 — Security hardening

```bash
gh pr merge 10 --squash --delete-branch   # werewolf token no-cache
gh pr merge 11 --squash --delete-branch   # poker invite token no-cache
gh pr merge 21 --squash --delete-branch   # RFC 7230 header validation
```

---

## Phase 6 — P2 fixes

```bash
gh pr merge 6  --squash --delete-branch   # night fold "夜 0"
gh pr merge 8  --squash --delete-branch   # engine unknown action.type
gh pr merge 12 --squash --delete-branch   # match-runner trace resilience
gh pr merge 27 --squash --delete-branch   # decision-trace store race fix (paired with #12)
gh pr merge 16 --squash --delete-branch   # ⚠️ see #24 rebase note below
# After #16 lands, rebase #24 (same file conflict):
gh pr view 24 --json mergeable,mergeStateStatus
gh pr update-branch 24
gh pr checks 24 --watch
gh pr merge 24 --squash --delete-branch   # a11y: seat aria-label + phase live region
```

### Why #27 sits with #12

#12 wraps the trace recording call in `try/catch` so a trace failure doesn't abort the match. #27 fixes the trace **store** itself — `appendDecisionTrace` was a read-modify-write across two awaits with no concurrency primitive, so concurrent same-`matchId` writes would silently lose data. Match-runner currently serializes calls per match, so the race isn't observable today, but #27 also closes the explicit deferred item from `HANDOFF.md §5`. They're in the same fault domain — merge them together.

### ⚠️ #24 is the a11y PR — modifies the same file as #16

#24 (`overnight-qa/werewolf-seat-and-phase-a11y`) adds `role` / `aria-label` / `aria-live` attributes to `WerewolfPhaseIndicator.tsx` and `WerewolfTableSurface.tsx`. #16 changes the label/subtitle logic in the same `WerewolfPhaseIndicator.tsx`. Conflict will resolve cleanly because the two PRs touch different lines (logic block vs. JSX return), but the merge state will flip from `CLEAN` to `BEHIND` after #16 lands — that's why the rebase step above runs explicitly.

If #24 still shows `CLEAN` after #16 lands (lucky non-conflict resolution by GitHub), `update-branch` is a no-op and you can skip straight to merge.

---

## Phase 7 — Infra / tests / docs

```bash
gh pr merge 5  --squash --delete-branch   # replay scanner
gh pr merge 7  --squash --delete-branch   # fill-NPCs button
gh pr merge 13 --squash --delete-branch   # backlog doc
gh pr merge 17 --squash --delete-branch   # property fuzz
gh pr merge 18 --squash --delete-branch   # double-death dedup test
gh pr merge 25 --squash --delete-branch   # witch saves-self regression test
gh pr merge 26 --squash --delete-branch   # poker orchestrator concurrent-seat atomicity test
```

#25 and #26 are pure tests — no source changes, no conflict risk. #25 pins existing engine behavior (witch save-self is allowed every night); #26 is forward-looking insurance against future poker orchestrator refactors that might introduce a seat-mutation race.

---

## Final verification

```bash
# Should show 24 merged + 1 closed (25 total: #4–#28, with #22 closed as superseded)
gh pr list --search "[overnight-qa]" --state all --json number,state \
  --jq 'group_by(.state)[] | {(.[0].state): length}'
# Expected: {"MERGED": 24, "CLOSED": 1}

# Production health
curl -s -w '\n%{http_code} time=%{time_total}s\n' https://werewolf-api-ttsb.onrender.com/health
curl -s -w '\n%{http_code}\n' https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches | tail -3
curl -sf -o /dev/null -w '%{http_code}\n' https://werewolf-api-ttsb.onrender.com/api/v1/docs/werewolf-agent-guide

# Local — confirm your a11y branch is untouched
git status                                  # still on overnight-qa/werewolf-seat-and-phase-a11y
git log --oneline -3                        # your local commits, if any
```

---

## Rollback

Every PR is one squash commit on main. Easiest path:

1. Open the squash commit on GitHub
2. Click **Revert** — opens an auto-generated revert PR
3. Merge the revert PR

Do **not** use `git reset --hard` against `main`; main is protected and force-push is forbidden by HANDOFF rules.

If the revert involves DB state (#4 / #19): the regrant migration is additive — reverting the code is fine; the GRANTs in supabase stay (no harm). Don't run a "revoke" migration without thinking through the impact on the other modules.

---

## Health-check between phases

After each phase, a 30-second sanity sweep:

```bash
curl -s -o /dev/null -w 'health=%{http_code} t=%{time_total}\n'   https://werewolf-api-ttsb.onrender.com/health
curl -s -o /dev/null -w 'matches=%{http_code} t=%{time_total}\n'  https://werewolf-api-ttsb.onrender.com/api/v1/werewolf-matches
curl -s -o /dev/null -w 'docs=%{http_code} t=%{time_total}\n'     https://werewolf-api-ttsb.onrender.com/api/v1/docs/werewolf-agent-guide
```

If any goes red mid-merge, stop and investigate before continuing. Most likely cause: Render still re-deploying; cold-start can take ~30s on free tier.

---

## Hard rules (still in force from HANDOFF.md §6)

- Never push to `main` directly — use `gh pr merge`.
- Never `--no-verify`, never amend committed PRs.
- Never touch prod Supabase data outside the migration files.
- Never modify `render.yaml`.
- 3-attempt failure budget per merge issue before deferring.
