# Poker Arena Design System Plan (2026-05-01)

> Companion to `2026-04-30-poker-arena-ui-upgrade.md`. That plan polishes TablePage internals; this plan fixes the cross-page issues that make the 9 screens feel like three different apps. **No code in this plan — design only.**

## Goal

Make the 9 web screens (login, register, lobby, agents, agent-edit, simulate, matches, match-replay, table) feel like one product, by extracting a shared design-token layer, removing per-page nav redundancy, giving login/register a real shell, and stopping `AppShell` from rendering route-conditional fake chrome.

## Non-goals

- **No changes inside the felt / right rail / action console of TablePage** — that surface is owned by `2026-04-30-poker-arena-ui-upgrade.md` (PokerTableSurface, PlayerActionPanel, the Task 2 "Replace table CSS block"). This plan stops at the AppShell boundary.
- **No new components** (no Storybook, no `<Button>` library, no CSS-in-JS migration). Only token extraction in existing `:root`, route layout adjustments, link removals, and one minimal empty-state CTA per page.
- **No copy / IA changes inside Replay / Analysis dashboards.** The "missing reasoning 28" framing critique stays as a follow-up; this plan is structural.
- **No new visual colors / type ramp invented.** Token *names* may add semantic categories (state, focus, mono, z-index) but token *values* come from hex/sizes already present in `styles.css` today.
- **No changes to `styles.css:1943` `::before { content: "★ POKER ARENA ★" }` felt decoration.** That selector lives inside `.poker-arena-shell .poker-felt::before` — it's owned by 2026-04-30's Task 2 Step 2 ("Replace table CSS block, restyle the table with dark chrome, oval felt..."). Whether to keep it as branded felt decoration or remove it is a felt-design taste call belonging to that plan, not this one.
- **No real telemetry or wallet display added to AppShell.** The `arena-topbar-hud` deletion (Task B) removes a fake placeholder. The real "latency + chip wallet" data lands inside `PokerTableSurface`'s right-rail "Table info" tab — owned by 2026-04-30, not this plan.
- **No CTA on the 4th empty state** at `apps/web/src/pages/TablePage.tsx:456` ("No completed hands yet."). It lives inside the live table page (which this plan does not modify); Task G's empty-state CTA pattern only applies to `/matches` and `/agents` (the cross-app first-impression surfaces). 2026-04-30 owns whether to add a CTA there.
- **No print stylesheet (`@media print`)**. If a user prints a `/matches/:id` replay, arena colors on white paper are not addressed by this plan. Out of scope; flag as a follow-up if reported.
- **No backend / API changes.** Web-only.

## Dependency on 2026-04-30 plan

### PR0 path — independent token scaffold (added by codex challenge #4)

**Codex finding**: Task A's commit 1 (pure `:root` token-definition addition, no call-site changes, no sweep) does not actually conflict with 2026-04-30's arena work at the file level. Plan 2026-04-30 modifies `styles.css` lines 944–2900 (the arena CSS region). Commit 1 modifies `styles.css` lines 2–50 (the `:root` block at the file head). **Line ranges do not overlap → merge conflict surface = 0**. Commit 1 also adds zero call-site changes → **runtime impact = 0**.

**Decision**: ship Task A commit 1 as **PR0**, independent of 2026-04-30. PR0 lands first regardless of 2026-04-30 progress.

**PR0 scope** (locked):
- Add 12 new tokens to `:root` block of `apps/web/src/styles.css`. Source: the first 12 entries of the Task A "Semantic token inventory" — type scale (8) + radius scale (4) — chosen because they're pure scale tokens, value-neutral until call sites adopt them.
- Zero call-site modifications. Zero hex replacements. Zero `[data-theme="arena"]` block (that lands in commit 7 after 04-30 arena CSS exists).
- Zero new files.
- One commit. One short PR.

**PR0 acceptance**:
- `pnpm --filter web test` green (no test should be affected — no call site changed).
- `pnpm --filter web run lint` green.
- `grep -cE "^\s*--" apps/web/src/styles.css` increases by **12** over baseline.
- Visual diff vs baseline = 0 on all 9 pages.

**Stalemate failsafe**: if 2026-04-30 author is unresponsive (no commit, no signal) for ≥ **3 working days** after PR0 merges, PR1 scope auto-shrinks to **token sweep over `styles.css` lines 1–943 only** (pre-arena range). Arena-region tokenization (commit 7 of Task A) defers to a follow-up PR after 2026-04-30 lands. This breaks the deadlock: 2026-05-01 makes progress on the rest of the file without waiting forever on arena ownership.

### Reality check (eng-review correction, 2026-05-01)

The originally-drafted Dependency analysis assumed the uncommitted changes on `try-gstack` were "exploration" to be reverted. That diagnosis was wrong. `git diff --stat` shows **1937 insertions / 76 deletions across 7 files**:

```
apps/web/src/__tests__/app-shell.test.tsx          |   17 +
apps/web/src/__tests__/poker-table-surface.test.tsx |  231 +++-
apps/web/src/components/AppShell.tsx               |   24 +-
apps/web/src/live-table/PlayerActionPanel.tsx      |   92 +-
apps/web/src/live-table/PokerTableSurface.tsx      |  321 ++++-
apps/web/src/pages/TablePage.tsx                   |   32 +-
apps/web/src/styles.css                            | 1296 +++++++++++++++++++-
```

That diff IS 2026-04-30's Task 1 + Task 2 implementation — including the 1296-line `styles.css` arena CSS region rewrite, the 321-line `PokerTableSurface` arena markup, and the 231-line poker-table-surface test. The plan's checkbox state (0 done) is misleading; the work exists, it's just uncommitted and untagged.

**Reverting that diff would destroy 2026-04-30's deliverable.** Wrong move.

### Correct sequencing — 4-step handoff playbook

**Step 1 (owned by 2026-04-30 author)**: formalize the uncommitted work into commits. Recommended: `git add -p` to split into three commits matching 2026-04-30's task structure:
- Commit `arena: markup contract` — `PokerTableSurface.tsx`, `PlayerActionPanel.tsx`, `__tests__/poker-table-surface.test.tsx` (matches Task 1)
- Commit `arena: visual system` — `styles.css` arena region (~1296 lines), `TablePage.tsx`, `AppShell.tsx` (matches Task 2)
- Commit `arena: tests` — `__tests__/app-shell.test.tsx` (matches Task 3)

After these commits exist, mark 2026-04-30's checkboxes done and update its plan file accordingly.

**Step 2 (owned by 2026-04-30 author)**: run `pnpm --filter web test` and `pnpm --filter web run lint`. Record green baseline.

**Step 3 (owned by 2026-04-30 author)**: run Task F's 4 mobile gates against the freshly-committed work:
- Felt height ≤ 60% viewport @ 375×812
- Seat labels single-line (no `Sea\nt N` wrap)
- Right rail below felt
- No horizontal scroll

**Any gate fail blocks 2026-04-30 ship.** Owner: 2026-04-30 (the arena CSS author). 2026-05-01 does not pick up gate failures — see Task F.1 for the contingency contract.

**Step 4 (owned by 2026-05-01)**: rebase onto the post-2026-04-30 main. Start Task A (token extraction) on the merged file.

### File ownership (post-handoff)

| File | 2026-04-30 owns | 2026-05-01 owns |
|---|---|---|
| `styles.css` (arena region, lines ~1787–2900) | All hex/value choices + felt decoration (incl. `::before`) | Token *names* + `:root` block + `[data-theme="arena"]` cascade override |
| `styles.css` (rest of file) | — | Full ownership (token sweep) |
| `AppShell.tsx` | Lines added in arena commit (the 24 lines of brand-mark, isTableRoute branch, arena-topbar-hud) **— scheduled for deletion by 2026-05-01 Task B** | Final form (post-Task B) |
| `__tests__/app-shell.test.tsx` | Lines added in arena commit (17 lines pinning arena-topbar-hud) **— scheduled for deletion by 2026-05-01 Task B** | Rewritten assertions |
| `TablePage.tsx` | All structural arena changes | One small `useEffect` for `data-theme` (added by 2026-05-01 OQ2 — see Task A) |
| `PokerTableSurface.tsx`, `PlayerActionPanel.tsx`, `__tests__/poker-table-surface.test.tsx` | Full ownership | — |

**Token file ownership rule**: `:root` and `[data-theme="arena"]` blocks in `styles.css` are owned by 2026-05-01. 2026-04-30's arena commit may write hex literals freely; 2026-05-01 promotes them to tokens (see Task A's per-commit gates).

**Why this is safer than "revert"**: revert destroys 1937 lines of work. The handoff treats that work as 2026-04-30's deliverable, lets it land cleanly, and lets 2026-05-01 do its structural cleanup on top. Each plan keeps its scope; merge conflict surface is bounded to the post-2026-04-30 state of `AppShell.tsx` (which is small) and `app-shell.test.tsx` (which 2026-05-01 will rewrite anyway).

---

## Resolved engineering decisions (eng-review locks)

Two open questions inherited from design-review are resolved here. These are no longer open.

### OQ1 — AppShell takes a `variant` prop (reversed by codex challenge #1)

**Decision (revised)**: `AppShell` accepts `variant?: 'main' | 'auth'`. `/login` and `/register` render `<AppShell variant="auth">`. The `auth` branch hides the nav strip, hides ProtectedRoute, hides the footer slot, and exposes a single "Public matches →" escape link. Brand markup stays inline in `AppShell.tsx`. **One file total: `AppShell.tsx`.** No `AuthShell.tsx`, no `AppBrand.tsx`.

**Engineering reasons (revised)**:
1. **`variant` is configuration-level, not shell-level shapeshifting.** Task B deletes the `isTableRoute` conditional because that was a *shell* secretly mutating chrome on a sub-route — without the route asking for it. A `variant` prop is the opposite: the route explicitly asks for an auth layout. Configuration-level differentiation is fine; it's the un-asked-for mutation Task B was deleting. Codex challenge #1 correctly identified that conflating these two anti-patterns was a category error.
2. **Reading path is shorter**: `router.tsx → AppShell variant="auth" → LoginPage` (3 hops) beats `router.tsx → AuthShell → AppBrand → LoginPage` (4 hops). For a maintainer asking "where does /login render?", fewer indirections wins.
3. **Brand markup duplication doesn't exist at 12 lines.** A 12-line component used in two places is a file-hop, not an abstraction boundary. Codex was right: AppBrand.tsx was the minimum recognizable unit of premature abstraction.

**Cost (revised)**:
- `AppShell.tsx`: −18 lines (delete isTableRoute / arena-topbar-hud / `<small>Poker Arena</small>`) +12 lines (variant branch with auth-mode rendering). Net 0.
- `router.tsx`: +1 line (wrap LoginPage / RegisterPage in `<AppShell variant="auth">`).
- `LoginPage.tsx`: +6 / −2 (drop inline page heading; preserve form + add public-matches escape).
- `RegisterPage.tsx`: +6 / −2 (same as LoginPage).
- `styles.css`: +18 (auth-mode rules, scoped under `.app-shell-auth`).
- `app-shell.test.tsx`: rewrites Task B's deletions plus adds `it('renders auth variant without nav strip', ...)`.
- **Net delta**: ~+30 lines, **1 component file modified, 0 new component files**. Down from the earlier +85/3-files estimate.

**Rejected alternative (now): separate `AuthShell.tsx` + `AppBrand.tsx`**. Original rationale leaned on "future SSO/OAuth integration friendliness" — that is speculative future-proofing (this is a research/entertainment platform with no OAuth roadmap; introducing structure for hypothetical future requirements violates gstack ETHOS). Without that pillar, the cost (+85 lines, 3 files, deeper indirection) doesn't pay off. **If** SSO is ever added and the auth flow grows real independent behavior, splitting `AppShell` into two files is a 30-minute mechanical refactor — pay the cost when it's earned, not before.

### OQ2 — `[data-theme="arena"]` attribute on `<html>` (not `.app-shell--theme-arena` class)

**Decision**: arena dark theme is activated by setting `document.documentElement.dataset.theme = 'arena'` in a `useEffect` mounted by `TablePage`. Cleanup on unmount. CSS overrides under `[data-theme="arena"] { ... }`.

**Engineering reasons**:
1. **No SSR exists** — confirmed via `apps/web/src/main.tsx` (uses `ReactDOM.createRoot(...).render(...)`, no `renderToString`/`hydrateRoot`). The historical objection to attribute-on-`<html>` (FOUC during hydration) does not apply to this codebase. **FOUC risk = 0**.
2. CSS Custom Properties cascade naturally from `<html>` (which is the same as `:root`). Every selector below inherits without specificity work. A class on `.app-shell` would cover only descendants, missing `<html>` and `<body>` background — fixable but unnecessarily fiddly.
3. Cleanup is a 4-line `useEffect` in `TablePage.tsx`:
   ```tsx
   useEffect(() => {
     document.documentElement.dataset.theme = 'arena';
     return () => { delete document.documentElement.dataset.theme; };
   }, []);
   ```
4. **Future-proof for global theme switching**: when a light/dark/auto switch lands later, `<html data-theme>` is industry-standard (Tailwind, shadcn, MDN-recommended). The class approach would require a refactor at that time. Pay the cost once, now.
5. Compatible with `prefers-color-scheme` media query as a fallback: `@media (prefers-color-scheme: dark) { :root { ... } }` and `[data-theme="arena"]` co-exist cleanly.

**Cost**:
- `TablePage.tsx`: +5 lines (one `useEffect` with cleanup).
- `styles.css`: `[data-theme="arena"] { ... }` block ~15 lines (in Task A's token-extraction sweep).
- `__tests__/table-page.test.tsx` or new `__tests__/theme.test.tsx`: +8 lines (assert mount sets attribute, unmount removes it).
- **Net delta**: +28 lines, 2–3 files.

**If SSR is added later** (it is not today): the standard FOUC mitigation is an inline `<script>` in `index.html` head reading `localStorage.theme || 'light'` and setting `document.documentElement.dataset.theme` *before* React hydrates. That's a 6-line `<script>` and well-documented. Don't pre-build it; flag it in Risk #6 as the path-when-needed.

**Rejected alternative**: `.app-shell--theme-arena` class on the AppShell root. Reason: only covers descendants of AppShell. AuthShell wouldn't pick it up. Can't reach `<html>` or `<body>`. Future global theme switcher requires migration. Today's "form purity" of staying in React tree buys a small refactor debt. Not worth it.

---

## Tasks

### Task A — Extract global design tokens into `:root`

**Pre-task environment fact-check (codex challenge #2)**:
- `apps/web/vitest.config.ts` currently uses **`environment: 'node'`**. No `document`, no `window`, no `getComputedStyle`. Any test in this plan that asserts CSS-cascade-resolved values **will not work in the current Vitest configuration**.
- This plan's strategy: keep the global Vitest environment as-is. Tests that need a DOM use `// @vitest-environment jsdom` per-file directive (see `theme-cascade.test.tsx` below). Tests that need actual browser CSS resolution go to Playwright e2e.
- **Future plans must be aware**: any new "computed style" test in this codebase will hit the same constraint. Don't propose a Vitest-cascade test without verifying the file-level environment first.

**Files**:
- Modify: `apps/web/src/styles.css` (only the `:root` block, lines 2–14, plus replace-hex sweep across the rest of the file)
- Create: `apps/web/src/__tests__/theme-cascade.test.tsx` (new — Layer 1 attribute + string-CSS test, see Acceptance below)
- Create (opt-in): `apps/web/e2e/theme.spec.ts` (new — Layer 2 Playwright cascade test, only run when e2e is installed)

**Acceptance**:
- **grep**: `grep -cE "var\(--" apps/web/src/styles.css` ≥ **120** (today: 32). Threshold reflects every hex/font-size/radius/spacing the file currently uses without a var.
- **grep**: zero hex color literals outside `:root`. Verify: `grep -nE "#[0-9a-fA-F]{3,6}" apps/web/src/styles.css | grep -v "^\s*[0-9]*:\s*--" | wc -l` returns **0**.
- **grep**: font-size scale collapses to 7 values. Verify: `grep -oE "font-size: [^;]+" apps/web/src/styles.css | sort -u | wc -l` returns **≤ 8** (7 tokens + the `inherit`/`em` cases).
- **screenshot**: visual diff of all 9 pages (run the same browse script that produced the original review) shows zero pixel-perceptible changes (this is a refactor, not a redesign — token extraction must be a no-op).
- **test**: `pnpm --filter web test` passes unchanged.

### Semantic token inventory (full set — single naming, dual-theme values)

The cascade strategy: tokens are defined once in `:root` (light theme = default). A scoped selector `[data-theme="arena"]` (or `.app-shell.is-arena` — pick one in eng-review) **redefines the same token names** with arena values. Components reference token names without knowing which theme is active. This is industry-standard CSS Custom Properties cascade — no PostCSS plugin, no build step, no theme provider.

**Existing 11 tokens** (kept, value-only edits if any):
`--app-topbar-height`, `--surface-page`, `--surface-panel`, `--surface-muted`, `--border-subtle`, `--text-primary`, `--text-secondary`, `--accent-primary`, `--accent-primary-hover`, `--danger`, `--danger-hover`.

**7 new semantic categories to add** (not optional — derived from D1/D5/D9 review findings):

1. **Type scale** — `--font-2xs` (10px), `--font-xs` (12px), `--font-sm` (13px), `--font-base` (14px), `--font-lg` (16px), `--font-xl` (20px), `--font-2xl` (28px). Plus `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace` for event hashes / matchIds (currently render in sans, hard to scan).
2. **Spacing scale** — `--space-1` (4px), `--space-2` (8px), `--space-3` (12px), `--space-4` (16px), `--space-6` (24px), `--space-8` (32px). Collapses today's ad-hoc 4/6/8/10/12/14/16/20/24/28 etc.
3. **Radius scale** — `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px), `--radius-pill` (999px).
4. **Shadow scale** — `--shadow-sm` (subtle elevation, replaces inline `box-shadow: 0 1px 2px rgba(...)`), `--shadow-md` (cards), `--shadow-lg` (modals/floating panels).
5. **State colors** — `--state-success`, `--state-warning`, `--state-info`. Currently the "0 active" green pill and various status chips use ad-hoc hex; this gives them a home. `--danger` already exists; promoted in semantic group as `--state-danger` alias.
6. **Link semantics** — `--accent-link` (default link blue, may equal `--accent-primary` initially but separate name allows divergence later), `--accent-link-visited` (universal rule requirement: visited links must distinguish — pick a desaturated variant).
7. **Interaction & a11y** — `--ring-focus` (the visible focus outline color, value: `--accent-primary` at full opacity, used in `outline: 2px solid var(--ring-focus); outline-offset: 2px`), `--ring-focus-arena` (same role under `[data-theme="arena"]` — typically chip-gold for visibility on dark felt).

**1 z-index scale group** (to prevent stacking races):
`--z-base` (0), `--z-dropdown` (100), `--z-topbar` (500), `--z-modal` (1000), `--z-toast` (2000).

**Arena-theme overrides** (under `[data-theme="arena"]` scope, populated *after* 2026-04-30 lands):
The same token names get redefined with arena values harvested from the post-2026-04-30 styles.css. Examples (final values pending the 2026-04-30 rewrite):
- `--surface-page: #080d16` (replaces light `#f6f7f9`)
- `--surface-panel: #172033` (replaces light `#fff`)
- `--text-primary: #f5f7fa` (light-on-dark)
- `--text-secondary: #9aa6b8`
- `--ring-focus: #d4a942` (chip-gold, more visible than blue on dark felt)
- `--state-success: #3de890` (already used in the `.arena-chip-stack` palette per `styles.css:2095` neighborhood)

**Total token count after Task A**: 11 existing + ~28 new = **~39 tokens in `:root`**, plus ~10 redefined under `[data-theme="arena"]`.

### `:root` organization contract (eng-review lock)

A 50-line `:root` block with no structure is unmaintainable. Lock the layout:

```css
:root {
  /* === Layout === */
  --app-topbar-height: 60px;

  /* === Surfaces === */
  --surface-page: #f6f7f9;
  --surface-panel: #fff;
  --surface-muted: #eef2f6;
  --border-subtle: #d8dee6;

  /* === Text === */
  --text-primary: #151b23;
  --text-secondary: #526070;

  /* === Accents === */
  --accent-primary: #1769aa;
  --accent-primary-hover: #125487;
  --accent-link: #1769aa;
  --accent-link-visited: #6b4d99;

  /* === States === */
  --state-success: #2f7d6b;
  --state-warning: #b27a18;
  --state-info: #1769aa;
  --state-danger: #b42318;
  --state-danger-hover: #8f1d13;

  /* === Type scale === */
  --font-2xs: 10px;
  --font-xs: 12px;
  --font-sm: 13px;
  --font-base: 14px;
  --font-lg: 16px;
  --font-xl: 20px;
  --font-2xl: 28px;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* === Spacing === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* === Radius === */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-pill: 999px;

  /* === Shadow === */
  --shadow-sm: 0 1px 2px rgba(20, 27, 35, 0.06);
  --shadow-md: 0 4px 12px rgba(20, 27, 35, 0.08);
  --shadow-lg: 0 12px 32px rgba(20, 27, 35, 0.12);

  /* === A11y === */
  --ring-focus: var(--accent-primary);

  /* === Z-index === */
  --z-base: 0;
  --z-dropdown: 100;
  --z-topbar: 500;
  --z-modal: 1000;
  --z-toast: 2000;
}

[data-theme="arena"] {
  /* === Surfaces (arena overrides) === */
  --surface-page: #080d16;
  --surface-panel: #172033;
  --surface-muted: #243246;
  --border-subtle: #2d3535;

  /* === Text (light-on-dark) === */
  --text-primary: #f5f7fa;
  --text-secondary: #9aa6b8;

  /* === Accents (chip-gold focus) === */
  --ring-focus: #d4a942;

  /* === States (arena variants if needed) === */
  --state-success: #3de890;
}
```

**Section comment headers are mandatory**, sort order within section is mandatory. Implementation that scrambles the order or drops comments fails Task A acceptance.

### Per-commit acceptance gates (transactionality contract)

Token migration is mechanical but voluminous (~150 hex/font-size/spacing replacements). The "≥120 var() + zero hex outside `:root`/`[data-theme]`" gate only verifies at the END. To bisect safely, lock per-commit gates.

**Required commit sequence (revised by codex challenge #3)** — each commit must pass tests AND its monotonic `var()` count floor.

**Baseline today**: `grep -cE "var\(--" apps/web/src/styles.css` returns **32** (verified pre-task). The "≥ 12 var()" floor for commit 1 is trivially satisfied at the baseline; the floor enforces a minimum, the **increment** is what proves migration progress is happening. Each commit's scope must drive the count up to the listed floor before it's allowed to merge.

| # | Commit name | Scope | `var()` count floor | Visual gate |
|---|---|---|---|---|
| 1 | `tokens: extract :root + arena overrides` | Add the 50-line `:root` block + `[data-theme="arena"]` block; **no call-site changes** | ≥ **12** (baseline 32 — trivially passes; this commit's job is the scaffold, not the count) | Tests green; `/lobby` and `/tables/:id` screenshot = baseline |
| 2 | `tokens: greys / surfaces / borders → tokens` | Replace `#fff`/`#f6f7f9`/`#d8dee6`/etc. with `var(--surface-*)` and `var(--border-*)` | ≥ **40** (added ~8 new var-references over baseline) | Visual diff = 0 px on Lobby and Agents — pure alias swap |
| 3 | `tokens: blues → tokens` | Replace `#1769aa`/`#125487`/`#258de3`/`#0b438c`/`#145ca8` with `var(--accent-*)` | ≥ **55** | Visual diff = 0 px on Lobby (button) and Match Replays (link) — pure alias swap |
| 4 | `tokens: greens / oranges / golds → tokens` | Replace state-color literals (`#2f7d6b`, `#b27a18`, etc.) with `var(--state-*)` | ≥ **75** | Visual diff = 0 px — pure alias swap |
| 5 | `tokens: type scale + font-mono` | Replace 17 distinct `font-size: Npx` literals with 7 `var(--font-*)`, **snapping each to nearest scale step** | ≥ **88** | Visual diff ≤ ±1px line-height drift on flagged pages, **scale-snapped (NOT zero-diff — see contradiction note below)** |
| 6 | `tokens: spacing + radius` | Replace ad-hoc px in margins/paddings/border-radius, **snapping to scale** | ≥ **104** | Visual diff ≤ 2px on any single layout box, **scale-snapped (NOT zero-diff)** |
| 7 | `tokens: arena hex → arena overrides` | Move arena-region hex into `[data-theme="arena"]` block under same token names | ≥ **118** | `/tables/:id` screenshot = baseline (arena overrides resolve to the same hex 04-30 wrote) |
| 8 | `tokens: final sweep + global gate` | Catch any stragglers, add `:focus-visible` global rule | ≥ **120** | All gates from "Acceptance" below |

**Contradiction reconciliation (codex challenge #3 finding)**: commits 5 and 6 introduce **deliberate** scale-snap drift (rounding 13px → 14px, 11px → 12px, 6px → 8px, etc.) to collapse 17+ ad-hoc font-sizes into a 7-step scale. That **cannot coexist** with "visual diff = 0 px". Decision: **scale-snap wins for commits 5 and 6**; visual gate is the looser `≤1-2px drift` shown above. Commits 2, 3, 4, 7 are pure alias swaps and **stay at zero-diff**. The earlier plan version conflating these has been corrected.

**If any commit fails either gate** (var-count floor OR visual gate), the commit is amended or split — never bypassed. No `--no-verify`. Bisect range stays at one commit's scope.

**Why 8 commits, not 1 atomic (codex challenge #3 raised this)**: codex argued for atomic to avoid mid-bisect partial-theme states. Counter: an atomic 220-line commit forces reviewers to read the whole sweep at once, where a single misplaced `var(--text-secondary)` (where `--text-primary` was meant) hides in the noise. **Per-token-family commits with monotonic count floors give review burden 1/8 the weight per commit and make individual mistakes traceable.** The mid-bisect concern is mitigated because each pure-alias commit (2/3/4/7) produces visually identical output — bisecting through them lands on a state that renders correctly, just with a partially-converted token vocabulary. That's not a "broken" state for users; it's a partial-rename state for engineers.

**Acceptance addition** (extending earlier criteria):
- **grep**: zero hex literals outside the `:root` block AND outside the `[data-theme="arena"]` block. Verify: `grep -nE "#[0-9a-fA-F]{3,6}" apps/web/src/styles.css | grep -vE "(:root \{|data-theme=\"arena\"\] \{|^\s*[0-9]+:\s*--)" | wc -l` returns **0**.
- **grep**: every active page's CSS rule uses `var(--*)` for color, font-size, spacing, radius. No literal hex / px values outside the `:root` and `[data-theme]` definitions.
- **manual check**: switching `<html data-theme="arena">` in DevTools on `/lobby` repaints the page in arena colors without any markup change. Proves the cascade works.
- **Theme cascade verification — split across two test layers (revised by codex challenge #2)**:

  > **Codex challenge #2 finding**: `apps/web/vitest.config.ts` uses `environment: 'node'`. There is no DOM, no `document`, no `getComputedStyle`. Even after migrating to jsdom, jsdom has known correctness gaps for dynamic-style updates of CSS custom properties (jsdom #2986). The original `getComputedStyle` test was broken before it could run. Split into two layers, each verifying what its environment can verify:

  **Layer 1 — Vitest unit (attribute + string-CSS, runs in current `node` environment)**:
  - File: `apps/web/src/__tests__/theme-cascade.test.tsx`
  - Asserts: rendering `<TablePage>` (or its mount effect) sets `document.documentElement.dataset.theme === 'arena'`, and unmount removes it. Uses `@testing-library/react` with a minimal `document` shim (or migrates the file to `// @vitest-environment jsdom` per-file directive — does **not** require a global env switch).
  - Asserts: `apps/web/src/styles.css` (read as a string) contains a `[data-theme="arena"]` block. Confirms the CSS rule **exists**, not that it resolves to a specific computed value.
  - Why this layer: validates the wiring in seconds, runs in CI, no browser needed.

  **Layer 2 — Playwright e2e (real browser computed-style, opt-in)**:
  - File: `apps/web/e2e/theme.spec.ts` (new, follows the existing `apps/web/e2e/demo.spec.ts` pattern that's also opt-in)
  - Asserts: navigate to `/tables/:id`, run `await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-page').trim())`, assert it equals the arena value (`#080d16` or whatever final hex lands). Then navigate to `/lobby` and assert it returns to the light value.
  - Why this layer: real browser, real CSS resolution. The only way to actually prove the cascade values flip.

  **Why split this way**: the Vitest layer catches "is the wiring there?" regressions cheaply. The Playwright layer catches "does the value actually flip?" regressions but only when e2e is opt-in-installed. If e2e isn't installed in a given workspace, Layer 1 still gates the most likely regression (someone deleting the `useEffect` or the CSS block). Don't write a single test that requires both browser-grade CSS resolution AND running in unit-test CI — that combination doesn't exist.

**Estimated lines**: `:root` grows from 13 → ~50 lines. `[data-theme="arena"]` block adds ~15 lines. Sweep across the file is ~150 mechanical replacements. **Net diff ≈ +60 / -10 in token blocks, ~150 single-line substitutions elsewhere = ~220 line changes, mostly 1:1.**

---

### Task B — Stop AppShell from rendering route-conditional fake chrome

**Files**:
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/__tests__/app-shell.test.tsx`
- Possibly modify: `apps/web/src/styles.css` (delete `.arena-topbar-hud`, `.arena-latency-pill`, `.arena-chip-wallet`, `.arena-chip-icon` rules at lines 1787–1830 if no longer referenced; also delete `.app-shell-table-arena` modifier if unused)

**Direction (recommended, with reason)**: **Keep AppShell as the only chrome; delete the route-conditional arena additions.**

Reasons:
1. The current `arena-topbar-hud` shows fake hardcoded values (`24ms`, `Play chips 125,880` — verified at AppShell.tsx:62–66). Production data isn't wired. Better to delete than to keep a placeholder.
2. The `<small>Poker Arena</small>` subtitle conditionally appearing on `/tables/*` is the visual "double brand" effect that made the table screen feel like a different product.
3. Keeping nav consistent across routes is the cheaper invariant than building two shells.
4. If a real chip-balance display is needed later, it belongs inside `PokerTableSurface`'s own header zone (already exists per 2026-04-30 plan), not in the global shell.

**Concrete changes**:
- Delete the `isTableRoute` branch and the `app-shell-table-arena` class application (AppShell.tsx:30–34).
- Delete the `<small>Poker Arena</small>` conditional (AppShell.tsx:42).
- Delete the entire `{isTableRoute ? (<div className="arena-topbar-hud">…</div>) : null}` block (AppShell.tsx:60–70) — this is the fake `24ms` latency and `Play chips 125,880` placeholder.
- In `app-shell.test.tsx` (post-2026-04-30-merge state), delete these specific lines (verified by grep against the uncommitted diff):
  - line 94: `expect(tableHtml).toContain('class="app-shell app-shell-table-arena"');`
  - line 95: `expect(tableHtml).toContain('aria-label="Arena status"');`
  - line 96: `expect(tableHtml).toContain('arena-topbar-hud');`
  - line 97: `expect(tableHtml).toContain('24ms');`
  - line 98: `expect(tableHtml).toContain('Play chips');`
  - line 99: `expect(tableHtml).toContain('125,880');`
  - line 100: `expect(lobbyHtml).not.toContain('arena-topbar-hud');`
  - line 102: `expect(cssRules(css, '.app-shell-table-arena .app-topbar')[0]).toContain('grid-template-columns: minmax(220px, auto) 1fr auto');`
  - line 103: `expect(cssRules(css, '.arena-topbar-hud')[0]).toContain('display: flex');`
  
  Replace with:
  ```ts
  it('renders identically on /lobby and /tables/* except for active-nav-link placement', () => {
    const lobbyHtml = renderShell('/lobby', true);
    const tableHtml = renderShell('/tables/abc', true);
    // Strip the active-class diff to compare shell structure
    const normalize = (h: string) => h.replace(/app-nav-link-active/g, 'app-nav-link');
    expect(normalize(lobbyHtml)).toBe(normalize(tableHtml));
  });
  
  it('TablePage mount sets data-theme=arena on documentElement', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/tables/abc']}>...</MemoryRouter>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('arena'));
    unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
  ```
- In `styles.css`, delete `.arena-topbar-hud`, `.arena-latency-pill`, `.arena-chip-wallet`, `.arena-chip-icon`, `.app-shell-table-arena` rules.

**Out of scope for this task — explicit boundaries**:
- **Do NOT touch** `styles.css:1943` `.poker-arena-shell .poker-felt::before { content: "★ POKER ARENA ★" }`. That's a felt-internal decoration owned by 2026-04-30's Task 2 Step 2.
- **Do NOT add** real latency / wallet display anywhere as part of this task. The right home for those is `PokerTableSurface`'s right-rail "Table info" tab (already exists in the snapshot). That work belongs to 2026-04-30 if/when it wires real WebSocket telemetry; this plan only deletes the fake.

**Acceptance**:
- **grep**: `grep -nE "isTableRoute|arena-topbar-hud|app-shell-table-arena" apps/web/src/components/AppShell.tsx` returns **0 matches**.
- **screenshot**: at 1440×900, navigate `/lobby → /tables/:id`. The header strip pixel-diffs only on the active-nav-pill location. The arena status strip is gone.
- **test**: `pnpm --filter web test -- app-shell.test.tsx` passes with the rewritten assertions.
- **e2e (if Playwright is set up)**: `apps/web/e2e/` — no regression in flows that hit `/tables/`.

**Estimated lines**: AppShell.tsx –20 / +2. styles.css –50 (delete unused arena-topbar rules). app-shell.test.tsx –8 / +6. **Net ~–70 lines.**

---

### Task C — Login & register render `<AppShell variant="auth">`

Per OQ1 (revised by codex challenge #1): one component file — `AppShell.tsx` — accepts a `variant` prop. No `AuthShell.tsx`. No `AppBrand.tsx`.

**Files**:
- Modify: `apps/web/src/components/AppShell.tsx` — add `variant?: 'main' | 'auth'` prop, default `'main'`. In `auth` mode: skip the nav strip, skip the user/logout area, render `.app-shell-auth` wrapper class for centered layout, add a single `<Link to="/matches">Public matches →</Link>` escape link below the brand. Brand markup stays inline.
- Modify: `apps/web/src/router.tsx` (lines 33–34: wrap LoginPage and RegisterPage in `<AppShell variant="auth">` directly; no new route wrapper component needed)
- Modify: `apps/web/src/pages/LoginPage.tsx` (remove any inline page heading the auth shell now provides; preserve form + switch link)
- Modify: `apps/web/src/pages/RegisterPage.tsx` (same as LoginPage)
- Modify: `apps/web/src/styles.css` (add `.app-shell-auth` rules — centered layout, see concrete spec below)
- Modify: `apps/web/src/__tests__/app-shell.test.tsx` — add `it('renders auth variant without nav strip', ...)` and `it('auth variant exposes public-matches escape link', ...)`. **No new test file** — auth tests live alongside main tests.

**Concrete auth-shell spec** (locks the design — engineer doesn't have to guess):

| Property | Value | Notes |
|---|---|---|
| Background | `var(--surface-page)` | Same as Lobby / Agents — no special "login color" |
| Container width | `max-width: 360px` | Single-column form |
| Container vertical | Desktop: `margin: 8rem auto` · Mobile (≤640px): `margin: 4rem auto 2rem` | Cramped at 375 if 8rem |
| Container padding | `padding: var(--space-6)` (24px) | Around content within container |
| Brand placement | Wordmark + "AP" mark, centered above form, ~`var(--space-8)` (32px) below brand block | Rendered by `AppShell` itself when `variant="auth"`, no `<small>Poker Arena</small>` |
| Subtitle | `<p class="auth-subtitle">multi-agent Texas Hold'em research platform</p>` rendered by AppShell auth branch | `font-size: var(--font-sm)`, `color: var(--text-secondary)`, centered |
| Form layout | Stacked label-above-input, fields full-width within container | Existing form markup in LoginPage / RegisterPage — no rewrite |
| Switch link | "No account? Register" / "Have an account? Log in" — preserved as text link below submit button, `font-size: var(--font-sm)` | Already in pages, just keep |
| Public-matches escape | `<Link to="/matches">Public matches →</Link>` rendered by AppShell auth branch (not per-page), `font-size: var(--font-xs)`, `color: var(--text-secondary)` | Wayfinding for unauthed users — `/matches` is public. Lives in AppShell so both /login and /register get it for free. |
| Error display | Red text directly under the offending field, `color: var(--state-danger)`, `font-size: var(--font-sm)` | Matches existing `useAuth` error shape |
| Tab order | brand-link → email → password → submit → switch-link → public-matches-link | Manual keyboard test |

**Acceptance**:
- **screenshot**: at 1440×900, `/login` shows the "AP / Agent Poker" wordmark centered above the form (no `<small>Poker Arena</small>`), the subtitle "multi-agent Texas Hold'em research platform" beneath, the form centered at `max-width: 360px`, background = `var(--surface-page)` (not bare grey).
- **screenshot**: at 375×812, the form fits without horizontal scroll, top margin reduced to 4rem, form fills viewport-padded width.
- **screenshot**: same shell on `/register` with no visual drift between the two pages other than the form itself.
- **grep**: `grep -nE 'variant="auth"' apps/web/src/router.tsx` returns **2 matches** (one for `/login` route, one for `/register` route).
- **grep**: `grep -nE "app-shell-auth" apps/web/src/styles.css apps/web/src/components/AppShell.tsx` returns **≥ 2 matches** (the wrapper class definition + usage).
- **grep**: `grep -nE 'to="/matches"' apps/web/src/components/AppShell.tsx` returns **1 match** (the auth-mode public-matches escape, rendered by AppShell, not by individual pages).
- **clickable**: from `/login`, clicking the brand wordmark navigates to `/` (which redirects per existing route logic). On `/login` and `/register` the protected-routes nav strip (Lobby/Agents/Replays/Simulate) is **not** rendered.
- **clickable**: from `/login`, clicking "Browse public match replays →" goes to `/matches` (public route, no auth required).
- **redirect**: `useLocation` `?next=` preservation still works after login (already implemented in router.tsx:21–22; verify nothing breaks it).
- **keyboard**: Tab from page top reaches brand-link → email → password → submit → switch-link → public-matches-link in that order. No focus traps.
- **a11y**: every focusable element shows `outline: 2px solid var(--ring-focus)` on `:focus-visible` (covered by Task D's global rule).

**Estimated lines**: AppShell.tsx +12 / –6 (variant branch). LoginPage.tsx +4 / –2 (drop heading; form preserved). RegisterPage.tsx +4 / –2. router.tsx +2 / –2. styles.css +18 (`.app-shell-auth` + responsive media query). app-shell.test.tsx +14 (two new `it` blocks). **Net ~+30 lines, 0 new files, 5 modified files.**

---

### Task D — Top nav active state + brand hover + global focus ring

**Files**:
- Modify: `apps/web/src/styles.css` (`.app-nav-link`, `.app-nav-link-active`, `.app-brand` rules — currently lines ~58–75; plus new global `:focus-visible` rule)

**Active-state design (locked)**: **2px underline using `--accent-primary` + font-weight 500 → 600 on the active link.**

Reasons:
- **Theme-agnostic**: an underline uses the same `--accent-primary` token in light and arena themes (value redefined under `[data-theme="arena"]` in Task A); no new "active surface" color needed for each theme.
- **No clash with arena chrome**: a filled-pill background fights the felt's color story under arena theme; a 2px line beneath the label doesn't.
- **Click-target stable**: pill background changes the hover/click footprint; underline doesn't.
- **600 weight is in-range**: existing nav links sit at 500; bump to 600 uses the same font without loading a new face.
- **Layered with `aria-current="page"`** (already on AppShell.tsx:54) — screen readers get semantics, sighted users get the underline.

Rejected alternatives:
- *Solid background fill*: requires `--surface-active-light` and `--surface-active-arena` — two new tokens for a problem an existing token already solves.
- *Bold-only*: WCAG warns against weight-only differentiation (some users perceive weight poorly); needs a second cue.

**Brand wordmark hover**:
- `cursor: pointer` on `.app-brand` (today inherits default).
- On hover, color of `Agent Poker` text shifts from `var(--text-primary)` to `var(--accent-primary)`.
- Transition: `color 120ms ease`.

**Accessibility minimum (new subsection)** — applies globally, not just to nav:

1. **Global focus ring**: add to `styles.css` near the top:
   ```css
   :focus-visible {
     outline: 2px solid var(--ring-focus);
     outline-offset: 2px;
     border-radius: var(--radius-sm);
   }
   ```
   `--ring-focus` is defined in Task A. Under `[data-theme="arena"]` it redefines to chip-gold for visibility on dark felt.
2. **WCAG AA contrast** for active and inactive nav: contrast ratio of nav text against `--surface-page` ≥ **4.5:1** for normal text. Verifiable via WebAIM's checker with the chosen `--accent-primary` value (`#1769aa` on `#f6f7f9` ≈ 5.2:1 — passes).
3. **Tab order check** for `/login` and `/register` (handled in Task C — referenced here as a cross-task acceptance).
4. **Visited-link distinction** (universal rule): in-content links (not nav) use `--accent-link` for unvisited and `--accent-link-visited` for visited. Nav links are not subject to visited-state because they're current-page indicators, not browse history.

**Acceptance**:
- **screenshot**: at 1440×900 on `/lobby`, the active "Lobby" tab shows a 2px underline under the label and is visibly heavier (font-weight 600); inactive items have no underline and weight 500. Difference is unambiguous at a 2-meter glance.
- **screenshot**: hovering "Agent Poker" wordmark shows pointer cursor and color shift to `--accent-primary`.
- **screenshot**: tabbing through `/lobby` shows a 2px ring on each focused element (nav, buttons, inputs). Take a `:focus-visible` screenshot per element type.
- **screenshot at arena theme** (preview only — switch `<html data-theme="arena">` in DevTools; full arena rendering ships with 2026-04-30): focus ring uses gold instead of blue, still visible against dark surfaces.
- **grep**: `grep -nE ":focus-visible|--ring-focus" apps/web/src/styles.css` returns **≥ 2 matches** (the global rule + the token definition).
- **grep**: `grep -nE "\.app-nav-link-active" apps/web/src/styles.css | wc -l` returns ≥ 2 (rule exists).
- **a11y tool** (manual): run axe DevTools or Lighthouse a11y on `/lobby`, `/login`, `/agents/new`. Zero contrast or focus-order errors. Record the score.

**Estimated lines**: styles.css +18 / -5 (active rule rewrite + focus-visible global + brand hover). **Net ~+15 lines.**

---

### Task E — Delete page-internal redundant nav links

**Files** (verified by grep, exact line numbers):
- Modify: `apps/web/src/pages/LobbyPage.tsx` lines 154–155 (`<Link to="/agents">Agents</Link>`, `<Link to="/matches">Replays</Link>`) — these duplicate the top nav. Keep the "Log out" button.
- Modify: `apps/web/src/pages/MatchesPage.tsx` line 48 (`<Link to="/lobby">Lobby</Link>` in page header) — duplicates top nav.
- Modify: `apps/web/src/pages/SimulatePage.tsx` lines 276–277 (`<Link to="/matches">Match replays</Link>`, `<Link to="/lobby">Lobby</Link>` in the page-header right slot). **Keep** lines 192–193 because those are post-action CTAs in the success card, not nav.
- Modify: `apps/web/src/pages/AgentsPage.tsx` line 122 (`<Link className="button-secondary" to="/lobby">Lobby</Link>`). **Keep** line 123 (`New agent` is the primary action, not nav).
- Modify: `apps/web/src/pages/AgentEditPage.tsx` line 128 (`<Link to="/agents">Agents</Link>` in page header). **Keep** line 258 (Cancel button in form).
- Modify: `apps/web/src/pages/MatchReplayPage.tsx` lines 18–19 and 60–61 (two pairs of `<Link to="/matches">…<Link to="/lobby">…`). Replace with **one** `← Back to matches` breadcrumb link only (matches is the immediate parent; lobby is reachable via top nav).

**Reachability matrix (lock — proves no horizontal navigation is lost)**:

| Deleted link | Source page | Original destination | Replacement path | Click count |
|---|---|---|---|---|
| LobbyPage:154 → /agents | Lobby | Agents | top-nav "Agents" | 1 |
| LobbyPage:155 → /matches | Lobby | Replays | top-nav "Replays" | 1 |
| MatchesPage:48 → /lobby | Matches | Lobby | top-nav "Lobby" | 1 |
| SimulatePage:276 → /matches | Simulate | Replays | top-nav "Replays" | 1 |
| SimulatePage:277 → /lobby | Simulate | Lobby | top-nav "Lobby" | 1 |
| AgentsPage:122 → /lobby | Agents | Lobby | top-nav "Lobby" | 1 |
| AgentEditPage:128 → /agents | AgentEdit | Agents | "Cancel" button at line 258 (preserved) | 1 |
| MatchReplayPage:18 → /matches | Replay detail | Matches | new "← Back to matches" breadcrumb at top of page | 1 |
| MatchReplayPage:19 → /lobby | Replay detail | Lobby | top-nav "Lobby" | 1 |
| MatchReplayPage:60 → /matches | Replay detail | Matches | covered by breadcrumb above | 1 |
| MatchReplayPage:61 → /lobby | Replay detail | Lobby | top-nav "Lobby" | 1 |

**Verdict**: every deleted link's destination is reachable in exactly 1 click. Zero loss of horizontal navigation. The breadcrumb on MatchReplayPage is the only newly-added affordance — it's contextual (parent direction), not redundant nav.

**Preserved (NOT deleted) — explicit list**:
- `SimulatePage:192–193` — "Open replay" + "Match replays" buttons inside the post-action success card. Contextual CTAs after a sim runs, not nav.
- `AgentsPage:123` — "New agent" primary action button in page header.
- `AgentsPage:178` — per-row "Edit" button on each agent.
- `MatchesPage:71` — per-row "Open replay" link in match list.
- `AgentEditPage:258` — form "Cancel" button.

**Acceptance**:
- **grep**: total nav-duplicate links removed = 11. Verify by running:
  ```
  grep -cE 'to="/(lobby|matches|agents)"' apps/web/src/pages/{LobbyPage,MatchesPage,SimulatePage,AgentsPage,AgentEditPage,MatchReplayPage}.tsx
  ```
  Expected after: **~7** remaining (the preserved CTAs + 1 breadcrumb listed in matrix), down from ~14 today.
- **screenshot**: at 1440×900, every page header right slot shows zero text-link redundancies; only contextual primary buttons (e.g., "New agent") remain.
- **clickable**: walk every row of the matrix above manually after the change — every destination reaches in ≤ 1 click via the matrix's "Replacement path" column.
- **test**: any existing Vitest/RTL test that asserts these links pass in different selectors must be updated. Pre-grep: `grep -rnE 'getByRole.*"link".*(Lobby|Match replays|Replays|Agents)' apps/web/src/__tests__/` — read each match and update the selector or assertion.

**Estimated lines**: 6 files, 2–4 lines each removed; MatchReplayPage gets +3 (breadcrumb addition). **Net ~–22 lines.**

---

### Task F — Mobile TablePage gate (delegated, with hard fallback)

**Status**: **Primary work covered by `2026-04-30-poker-arena-ui-upgrade.md` Task 2 Step 3** ("At tablet/mobile widths, stack the rail below the table, avoid overlapping seats, and let action buttons wrap").

This plan does not duplicate the work because both plans modify the same files (`TablePage.tsx`, `styles.css`) and a parallel mobile-CSS block from this plan would conflict at merge. Instead, **this plan publishes the acceptance gate as a hard precondition** for 2026-04-30 to ship, plus Task F.1 as a contingency.

**Hard mobile gate** (must pass before *either* plan ships):

At viewport 375×812 on `/tables/:tableId`:
1. Felt height ≤ **60% of viewport height** (i.e., ≤ 487px). Verifiable: `$B js "document.querySelector('.poker-felt').getBoundingClientRect().height / window.innerHeight"` returns ≤ 0.60.
2. Seat labels render **single-line** (no `Sea\nt N` text wrapping). Verifiable: text-content of any `[data-seat]` element matches `/^Seat \d/` exactly, no `\n`.
3. Right rail (`.poker-arena-rail` or equivalent) sits **below the felt**, not beside it. Verifiable: `getBoundingClientRect().top` of rail is greater than `getBoundingClientRect().bottom` of felt.
4. No element causes horizontal scroll. Verifiable: `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

If 2026-04-30 ships without satisfying these gates, **this plan does NOT ship until the gates pass**. Owner of the gate failure is whoever owns the arena CSS — which is 2026-04-30's Task 2 Step 2.

### Task F.1 — Mobile arena override (conditional, owned by 2026-05-01) (revised by codex challenge #5)

**Codex finding**: the original "Task F.1 contingency, only if 04-30 author declines to reopen" was a procrastination escape valve. If 04-30 author is unavailable, the gap creates queue paralysis with no deterministic owner. **Removed**: the "if author declines to reopen" clause. **Reframed**: F.1 is owned by 2026-05-01 directly. The trigger is a hard verification result, not a third-party decision.

**Trigger (revised)**: 2026-04-30 has merged AND any of Task F's 4 mobile gates **fail** under measurement. **No author negotiation required.** 2026-05-01 owner runs the F gate, sees the result, and either ships PR1 unmodified (gates pass) or rolls F.1 into PR1's tail commits (gates fail).

**Files**:
- Modify: `apps/web/src/styles.css` (one new `@media (max-width: 768px)` block scoped under `.poker-arena-shell`)

**Concrete spec** (executed when triggered):
- Felt: `aspect-ratio: 16 / 11` (capped) and `max-height: 60vh`
- Seats: switch from absolute-positioned around oval to `display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3)` below 480px
- Right rail: `display: flex; flex-direction: column` ordering after felt
- Seat label: `white-space: nowrap` to forbid line breaks

**Why conditional, not unconditional (compromise with codex)**: codex pushed for unconditional inclusion in PR1. Counter: F.1 uses `.poker-arena-shell` selectors **created by 2026-04-30**. Writing the media block before those selectors exist produces dead CSS. So F.1 still needs to land *after* 2026-04-30 — but the activation gate is now a measured-fail signal owned by 2026-05-01, not a third-party "declined to reopen" signal. **No queue paralysis possible.**

**Acceptance**: all four Task F gates pass after F.1 is applied (or PR1 refuses to merge).

**Estimated lines**: styles.css +35 inside one media query. **Conditional execution; lines added only if F gate fails.**

---

### Task G — Empty-state primary CTAs (promoted from Non-goals)

**Why this got promoted into scope** (was originally Non-goal):

`/matches` is the only page a public/unauthenticated visitor can land on. Its current empty state — table header with no rows + tiny grey "No match artifacts have been published yet." — depletes the goodwill reservoir before the user has done anything. Krug's billboard test fails: a first-time visitor cannot tell whether the app is broken or simply unused. Same problem on `/agents` for new authenticated users. Adding one CTA button per empty state turns "looks broken" into "looks ready to use" — this is a **3/10 → 7/10** improvement at ~10 lines of code per page. Cheap enough that excluding it would be irresponsible scope discipline; expensive enough that we ship it explicitly, not as a stealth addition during another task.

**Files**:
- Modify: `apps/web/src/pages/MatchesPage.tsx` (the `<tbody>` empty branch — currently a `<tr><td colSpan>No match artifacts...</td></tr>` row)
- Modify: `apps/web/src/pages/AgentsPage.tsx` (the empty-state `<div>` currently showing "No agents yet. Create one to seat it at a table.")
- Modify: `apps/web/src/pages/LobbyPage.tsx` (the "No tables yet. Create one above." branch — already has form above, so its CTA is implicit; no change needed unless `Tables` panel is empty AND form is below the fold on mobile)
- Modify: `apps/web/src/styles.css` (add `.empty-state` rule — vertical-stack, centered, padded; uses `var(--space-*)` tokens)

**Concrete spec** (locks copy and visual):

Each empty state renders three vertical-stacked elements, centered, with `var(--space-3)` between them:
1. **Headline** — `<p class="empty-state-headline">` — `font-size: var(--font-base)`, `color: var(--text-primary)`. Replaces the current grey one-liner with a clearer statement of state.
2. **Sub** — `<p class="empty-state-sub">` — `font-size: var(--font-sm)`, `color: var(--text-secondary)`. One sentence explaining the next step.
3. **Primary CTA** — `<Link class="button-primary">` — links to the action that fills this empty state.

Per page:

| Page | Headline | Sub | Primary CTA → href |
|---|---|---|---|
| MatchesPage | `No match replays yet.` | `Run a quick simulation to publish your first replay.` | `Run a simulation →` → `/simulate` (auth-required; unauthed users get redirected to login first) |
| AgentsPage | `No agents configured.` | `Add an HTTP endpoint and let it sit at a table.` | `Configure first agent →` → `/agents/new` |
| LobbyPage Tables panel | `No tables yet.` | `Use the form above to create one.` | (no button — the form is the action; sub-text is the pointer) |

For unauthenticated `/matches` visitors specifically: the CTA still links to `/simulate`, which kicks off the standard login redirect. After login they land on `/simulate` ready to run — that's the intended funnel.

**Acceptance**:
- **screenshot**: at 1440×900, fresh state on `/matches` (no artifacts) shows the three vertical-stacked elements, centered, with a visible blue primary button.
- **screenshot**: at 1440×900 on `/agents` (no agents), same pattern with "Configure first agent →".
- **clickable** (unauthed): on `/matches`, clicking "Run a simulation →" redirects to `/login?next=/simulate`. After login, arrives at `/simulate`. Round-trip verified manually.
- **clickable** (authed): on `/agents`, clicking "Configure first agent →" navigates directly to `/agents/new`.
- **grep**: `grep -nE "empty-state" apps/web/src/styles.css apps/web/src/pages/{MatchesPage,AgentsPage}.tsx` returns **≥ 4 matches** total.
- **a11y**: empty-state CTAs are keyboard-reachable in tab order, focus-ring visible (covered by Task D).

**Estimated lines**: MatchesPage.tsx +12 / -4. AgentsPage.tsx +12 / -4. styles.css +14 (`.empty-state`, `.empty-state-headline`, `.empty-state-sub` rules). LobbyPage.tsx no change. **Net ~+30 lines.**

---

## Risks / Open questions

1. ~~Conflict with uncommitted AppShell.tsx changes~~. **Resolved by eng-review correction (see Dependency / Reality check).** The uncommitted 1937-line diff IS 2026-04-30's deliverable; sequencing is the 4-step handoff playbook, not revert.

2. **Token-extraction pass is mechanical but voluminous.** Mitigated by Task A's per-commit gates (8 commits, each independently testable). If a commit fails its gate, amend or split — never `--no-verify`. Bisect range stays at one commit's scope.

3. **e2e tests on `/login`**. **Mitigated**: pre-checked `apps/web/e2e/demo.spec.ts` — uses `getByLabel('Email')`, `getByRole('button', { name: /create account/i })`. Form-semantic selectors only, zero ancestor-DOM dependence. Task C wrapping login in AuthShell does not break any existing e2e selector. Confirmed by grep against the only e2e file.

4. ~~AuthShell vs AppShell variant decision~~. **Resolved by OQ1 above** — independent AuthShell + AppBrand sub-component (3 files total).

5. **Active-route detection cleanup.** Task B removes `currentPath.startsWith('/tables/')` from AppShell. Pre-task grep: `grep -rn "isTableRoute\|startsWith.*tables" apps/web/src/` to catch any stragglers in pages or tests. As of pre-task baseline, only AppShell.tsx and `__tests__/app-shell.test.tsx` reference `isTableRoute` — both are in Task B scope.

6. ~~SSR/hydration FOUC risk~~. **Resolved by codebase audit.** `apps/web/src/main.tsx` uses `ReactDOM.createRoot(...).render(...)` (CSR-only). No `renderToString` or `hydrateRoot` exists. Setting `data-theme` in `useEffect` runs after first paint with no hydration step → **FOUC risk = 0**. If SSR is added later, the standard mitigation is a 6-line inline `<script>` in `index.html` head reading `localStorage.theme || 'light'` and setting `document.documentElement.dataset.theme` *before* React mounts. Don't pre-build it; revisit when SSR ships.

7. ~~Mobile gate sequencing risk~~. **Resolved by codex challenge #5** — Task F.1 is now owned by 2026-05-01 and triggered by measured gate failure, not by 04-30 author response. No deadlock surface.

8. **Empty-state CTA on `/matches` for unauthed users redirects through login.** Task G's "Run a simulation →" link on the public matches empty state goes to `/simulate`, which is auth-gated, which redirects to login. Question: is that desired UX (forces signup before first sim) or should the empty state offer a "browse without account" alternative? **Decision**: ship as-designed (login gate is fine — public viewers can scroll the list once it's populated; empty state IS the signup-conversion surface). Revisit only if onboarding metrics show drop-off.

9. **Visited-link semantics on nav.** The plan adds `--accent-link-visited` per universal a11y rules, but nav links carry `aria-current="page"` and are not subject to traditional visited-state styling. **Decision**: visited-link styling applies only to in-content links (e.g., per-row "Open replay" in matches list, public-matches escape on login page), not to top nav.

10. ~~Theme attribute vs class scope~~. **Resolved by OQ2 above** — `[data-theme="arena"]` on `<html>`, set via `useEffect` in TablePage.

11. **Vitest environment is `node` — no browser-grade CSS resolution exists in this codebase (revised by codex challenge #2)**. `apps/web/vitest.config.ts` uses `environment: 'node'`. There is no `document`, no `window`, no `getComputedStyle`. Even after migrating to jsdom, jsdom has open correctness gaps for dynamic-style updates of CSS custom properties (jsdom #2986). Strategy adopted by Task A: split cascade verification into two layers — Layer 1 (Vitest with per-file `// @vitest-environment jsdom` directive) verifies the wiring (attribute set on documentElement, CSS rule string exists), Layer 2 (Playwright e2e, opt-in) verifies actual computed values flip in a real browser. Don't write a single test that requires both browser CSS resolution AND running in unit-test CI — that combination doesn't exist in this codebase. **Future-plan note**: any new computed-style test in this repo hits the same constraint; design accordingly.

12. **TablePage `data-theme` cleanup on unmount edge case.** If user navigates `/tables/X` → `/lobby`, the `useEffect` cleanup must remove `data-theme`. If user navigates `/tables/X` → `/tables/Y` directly, the route stays mounted (React Router keeps TablePage rendered with new params) and the effect dependency `[]` does not re-fire — but `data-theme` is already set, so this is a no-op. Sanity-test in `__tests__/theme-cascade.test.tsx`: simulate `/tables/X → /lobby` and assert `documentElement.dataset.theme === undefined`. **Owner**: Task A acceptance.

13. **Print stylesheets and high-contrast mode**. Out of scope per Non-goals; flagged for future-plan if reported.

---

## Done when

**Visual / screenshot acceptance (re-run the same browse script that produced the original 17-screenshot review at 1440×900 + 375×812)**:
- Login / Register show "AP / Agent Poker" wordmark, centered form at `max-width: 360px`, subtitle "multi-agent Texas Hold'em research platform", and a "Browse public match replays →" escape link (Task C).
- Lobby / Agents / Simulate / Matches / Match-replay show zero redundant nav links in page headers; only contextual primary buttons (e.g., "New agent") and the new MatchReplayPage breadcrumb remain (Task E).
- Top-nav active item is unambiguous at a 2-meter glance on every page — 2px underline at `--accent-primary` plus font-weight 600 (Task D).
- Table-page header strip matches other pages: AP wordmark, nav, and that's it. No `<small>Poker Arena</small>` subtitle, no `arena-topbar-hud` strip, no fake `24ms` / `Play chips 125,880` placeholders (Task B).
- Match Replays empty state shows three-element vertical stack ending in a blue primary "Run a simulation →" button. Agents empty state shows the same pattern with "Configure first agent →" (Task G).

**Mobile (375px) acceptance**:
- `/tables/:id` passes all four gates in Task F (felt ≤ 60% viewport height, single-line seat labels, rail below felt, no horizontal scroll).
- `/login` and `/register` fit without horizontal scroll, top margin compresses to 4rem, form fills container.

**Accessibility acceptance**:
- All `:focus-visible` elements show `outline: 2px solid var(--ring-focus)` with 2px offset (Task D).
- Active vs inactive nav contrast ratio measured ≥ 4.5:1 (Task D, recorded value in plan or PR description).
- Keyboard tab walk through `/login` reaches: brand-link → email → password → submit → switch-link → public-matches-link in that exact order (Task C).
- axe DevTools / Lighthouse a11y on `/lobby`, `/login`, `/agents/new` reports zero contrast or focus-order errors. Lighthouse a11y score recorded.

**`grep` invariants hold**:
- `grep -cE "var\(--" apps/web/src/styles.css` ≥ **120** (was 32) (Task A).
- `grep -nE "#[0-9a-fA-F]{3,6}" apps/web/src/styles.css | grep -vE "(:root \{|data-theme=\"arena\"\] \{|^\s*[0-9]+:\s*--)"` returns **0 lines** (Task A).
- `grep -oE "font-size: [^;]+" apps/web/src/styles.css | sort -u | wc -l` ≤ **8** (Task A).
- `grep -nE "isTableRoute|arena-topbar-hud|app-shell-table-arena" apps/web/src/components/AppShell.tsx` returns **0 matches** (Task B).
- `grep -cE 'to="/(lobby|matches|agents)"' apps/web/src/pages/{LobbyPage,MatchesPage,SimulatePage,AgentsPage,AgentEditPage,MatchReplayPage}.tsx` returns **~7** total (was ~14) (Task E).
- `grep -nE ":focus-visible|--ring-focus" apps/web/src/styles.css` returns **≥ 2 matches** (Task D).
- `grep -nE "empty-state" apps/web/src/styles.css apps/web/src/pages/{MatchesPage,AgentsPage}.tsx` returns **≥ 4 matches** (Task G).

**Theme cascade verified**: switching `<html data-theme="arena">` in DevTools on `/lobby` repaints the page in arena colors with zero markup changes. Confirms the dual-theme cascade works (Task A).

**Tests pass**: `pnpm --filter web test` and `pnpm --filter web run lint` are green. The new `app-shell.test.tsx` assertion (theme attribute set on table mount) passes. Updated `getByRole('link', { name: ... })` assertions for deleted nav links pass.

**No regression in flows**: register → lobby → create table → sit → simulate → open replay → analysis tab — clickable end-to-end with no console errors and no visual regressions on screenshots not explicitly listed above.

---

## Deployment & Rollback (eng-review addition, revised by codex challenge #4)

### Ship as 3 PRs

Earlier "2 PR" structure assumed Task A had to wait for 04-30. Codex challenge #4 proved Task A's commit 1 has zero file-level overlap with 04-30 and can ship independently. New structure:

**PR0 — Token scaffold (independent, ships first regardless of 04-30 status)**:
- Scope: Task A commit 1 only — 12 new tokens added to `:root` (type scale 8 + radius scale 4). No call-site changes. No `[data-theme="arena"]` block (that lands in commit 7 with PR1).
- Visual delta: zero.
- Test delta: zero (no tests need to change for token-definition addition).
- Risk: **near-zero** — pure declaration addition.
- Rollback: `git revert <PR0>` is safe. No downstream code references the new tokens.

**PR1 — Token sweep + structural changes (depends on 04-30 + PR0 both merged)**:
- Scope: Task A commits 2–8 (color sweeps, type scale, spacing, arena hex, final sweep) + Tasks B, C, D, E, G + Task F.1 if F gate fails.
- Visual delta: intentional changes from Tasks B–G; pure-alias commits (2/3/4/7) are zero-diff; commits 5/6 are scale-snap (≤1-2px drift).
- Test delta: rewrites `__tests__/app-shell.test.tsx`. Adds new `it()` blocks for auth variant. Adds `__tests__/theme-cascade.test.tsx` (Layer 1).
- Risk: medium. Multiple intentional behavior changes.
- Rollback: `git revert <PR1>` is safe. PR0's 12 tokens remain (defensive — leaving them improves baseline).

**PR2 (optional, only if e2e infra installed) — Playwright cascade test**:
- Scope: `apps/web/e2e/theme.spec.ts` (Layer 2 cascade verification — real browser computed-style flip).
- Risk: zero (test-only addition).
- Rollback: `git revert <PR2>`.

**PR ordering**: PR0 → (04-30 PR + PR1, in that order) → PR2 if applicable.

**Total ship sequence (recap)**:
1. **PR0 (this plan, Task A commit 1)** opens *now* — independent of 04-30. Merges first.
2. **2026-04-30 author** commits the 1937-line uncommitted work (3 commits per the handoff playbook).
3. **2026-04-30 PR** opens, merges.
4. **PR1 (this plan, Task A commits 2-8 + Tasks B-G)** opens, rebased onto post-04-30 main. PR1 owner runs Task F mobile gates; if any fail, F.1 is folded into PR1's tail commits before merge.
5. **PR2 (optional Playwright cascade test)** opens if e2e infra is installed.

**Stalemate failsafe**: if step 2 stalls ≥3 working days after PR0 merges, PR1 scope auto-shrinks to `styles.css` lines 1–943 only (pre-arena tokenization). Arena tokenization defers to a follow-up PR after 2026-04-30 lands.

### Rollback path matrix

| Scenario | Rollback action | Side effects |
|---|---|---|
| PR0 (token scaffold) breaks something post-merge | `git revert <PR0>` | None. No call sites reference the new tokens. |
| PR1 (sweep + structural) breaks something | `git revert <PR1>` | PR0's 12 tokens stay (orphaned but harmless); page nav reverts to redundant-link state; empty states revert to bare text; AppShell regrows isTableRoute branch. Tests revert with the commit. |
| PR1 reverted but app-shell.test.tsx already drifted further | Cherry-pick test file from pre-PR1; re-run `pnpm --filter web test` to confirm green | Manual reconciliation step |
| PR2 (Playwright cascade) breaks something | `git revert <PR2>` | None. Test-only file. |
| 2026-04-30 needs revert post-PR1 merge | Revert 2026-04-30 first, then revert PR1 (token sweep references arena hex no longer in the file) — or rebase PR1 to handle pre-arena state | Coordinated revert; not a one-button operation |

### Deploy-time checklist

Before merging PR0:
- [ ] `pnpm --filter web test` green.
- [ ] `pnpm --filter web run lint` green.
- [ ] `grep -cE "^\s*--" apps/web/src/styles.css` increased by 12 over baseline.
- [ ] Visual diff vs main = 0 px on `/lobby` and `/agents` (pick any two pages — should be identical).

Before merging PR1:
- [ ] All 7 sweep commits (2–8) passed their per-commit `var()` count floor + visual gate.
- [ ] Manual click-through: register → lobby → create table → sit → simulate → open replay → analysis (per "Done when").
- [ ] Mobile screenshot at 375×812 of `/login`, `/tables/:id`, `/lobby` — no horizontal scroll, no broken layout.
- [ ] Task F mobile gates run; if any fail, F.1 added to PR1 tail commits.
- [ ] axe DevTools / Lighthouse a11y on `/lobby`, `/login`, `/agents/new` — zero violations.
- [ ] Reachability matrix walked manually (Task E) — all 11 deleted-link destinations reachable in ≤ 1 click.

Before merging PR2 (optional):
- [ ] Playwright is installed (`pnpm --filter web exec playwright --version` works).
- [ ] `pnpm --filter web e2e` includes the new `theme.spec.ts` and passes.

---

## What this plan does NOT promise

- It does not promise the table page **interior** looks "good" (felt, plaques, action console) — that's 2026-04-30's job. Cross-page chrome and AppShell consistency are this plan's job.
- It does not promise the analysis dashboard's "missing reasoning 28" framing is fixed — that's a separate copy/IA pass.
- It does not promise an empty-state **illustration** system. Task G adds CTA buttons and a 3-line copy block per empty state, not custom illustrations or animations.
- It does not introduce dark mode for the rest of the app. Light theme remains the default for non-table pages. Arena dark theme is scoped to `[data-theme="arena"]` and only `/tables/:id` flips that attribute.
- It does not promise to remove or keep the `★ POKER ARENA ★` felt decoration. That decision belongs to 2026-04-30 (it lives inside the felt's CSS block).
- It does not promise to wire real WebSocket telemetry into the table-page header. Removal of the fake `24ms` / `Play chips 125,880` placeholders happens here; replacement with real data lives in `PokerTableSurface` and is owned by 2026-04-30 (or a later plan).

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (not required for this plan type) |
| Codex Review | `/codex challenge` | Adversarial second opinion | 1 | issues_resolved | 5 attack points: 0 pass, 2 partial, 3 fail. **All 5 absorbed into plan** — OQ1 reversed (variant prop, not separate AuthShell); cascade test split into Vitest+Playwright layers (real env-mismatch bug fixed); per-commit `var()` count floor table added; PR0 path introduced (Task A commit 1 ships independent of 04-30); F.1 escape valve removed (now owned by 05-01 with measured trigger). |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | initial 6.9/10 → 9.4/10 across 13 dimensions; OQ1 + OQ2 resolved; 4-step handoff playbook for 2026-04-30 dependency; 8-commit per-commit gate for Task A; deployment split (PR0 + PR1 + optional PR2); rollback matrix added; e2e blast radius confirmed zero; SSR concern confirmed N/A (CSR-only project) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | initial 6.5/10 → 9.5/10 across 9 dimensions; Tasks A–G shaped; 5 contentious design decisions locked; 13 risks tracked |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not applicable (no developer-facing API) |

**CROSS-REVIEW:** design-review and eng-review agree on all 7 tasks and the 5 design decisions. Design-review's 2 open questions (AuthShell structure, theme selector form) are now locked by eng-review with concrete file-count and line-count cost estimates. No model disagreement.

**KEY DECISIONS (locked, do not relitigate)**:
1. **OQ1 → AppShell with `variant="auth"` prop** (codex challenge #1 reversed the original AuthShell+AppBrand decision). One component file. Reason: AuthShell+AppBrand was speculative future-proofing for SSO; variant is configuration-level, not shell-level shapeshifting (the anti-pattern Task B deletes). Cost: ~+30 lines, 0 new files.
2. **OQ2 → `[data-theme="arena"]` on `<html>`** via `useEffect` in TablePage. CSR-only confirmed → no FOUC. Cascade test split into 2 layers (codex challenge #2): Layer 1 Vitest with per-file jsdom directive (attribute + string-CSS), Layer 2 opt-in Playwright (real computed values).
3. **Sequencing → PR0 + 4-step handoff** (codex challenge #4 added the PR0 path). PR0 = Task A commit 1 only, ships independent of 04-30 (line ranges don't overlap). Then 04-30 author commits + ships, then PR1.
4. **Token migration → 8 commits with monotonic `var()` count floors** (codex challenge #3 fixed the gate). Floor table: 12 → 40 → 55 → 75 → 88 → 104 → 118 → ≥120. Pure-alias commits (2/3/4/7) are zero-diff; scale-snap commits (5/6) accept ≤1-2px drift — contradiction reconciled.
5. **Ship → 3 PRs**. PR0 = Task A commit 1 (independent). PR1 = sweep + Tasks B-G (depends on 04-30). PR2 = optional Playwright cascade test.
6. **F.1 → owned by 2026-05-01, triggered by measured gate failure** (codex challenge #5 removed the escape valve). No queue paralysis possible.

**UNRESOLVED:** none. All open questions resolved through 3-review pipeline (design + eng + codex challenge).

**VERDICT:** Three-review pipeline CLEARED. Plan is implementation-ready. **PR0 starts immediately** (no 04-30 dependency). 2026-04-30 handoff runs in parallel. PR1 starts when both PR0 and 04-30 have merged.
