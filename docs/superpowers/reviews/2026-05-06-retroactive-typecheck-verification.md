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
