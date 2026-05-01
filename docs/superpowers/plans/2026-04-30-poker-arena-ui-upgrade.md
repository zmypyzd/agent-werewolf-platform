# Poker Arena UI Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the live poker table screen into a dark poker-arena presentation inspired by the provided reference image.

**Architecture:** Preserve the existing live table data flow. `TablePage` remains the page orchestrator, `PokerTableSurface` renders the table and right rail, `PlayerActionPanel` renders the human turn console, and `styles.css` owns the visual treatment.

**Tech Stack:** React, TypeScript, Vite, Vitest, server-side render tests with `react-dom/server`, CSS.

---

### Task 1: Arena Markup Contract

**Files:**
- Modify: `apps/web/src/__tests__/poker-table-surface.test.tsx`
- Modify: `apps/web/src/live-table/PokerTableSurface.tsx`
- Modify: `apps/web/src/live-table/PlayerActionPanel.tsx`

- [ ] **Step 1: Write the failing test**

Add expectations that the live table renders an arena shell, a right rail tab strip, room stats, player ranking rows, and action button variants for fold/call/raise.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- poker-table-surface.test.tsx`

Expected: FAIL because the arena class names and rail labels are not rendered yet.

- [ ] **Step 3: Implement minimal markup**

Add semantic class names and static labels while preserving existing text such as `Visible Hands`, `Live Log`, action labels, validation attributes, and card rendering.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- poker-table-surface.test.tsx`

Expected: PASS.

### Task 2: Arena Visual System

**Files:**
- Modify: `apps/web/src/pages/TablePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Update page shell**

Add table-page wrapper classes and compact metadata that let CSS create the dark arena scene without changing table actions or lifecycle behavior.

- [ ] **Step 2: Replace table CSS block**

Restyle the table with dark chrome, oval felt, player plaques, glowing actor states, larger cards, right rail panels, and bottom action buttons.

- [ ] **Step 3: Keep responsive behavior**

At tablet/mobile widths, stack the rail below the table, avoid overlapping seats, and let action buttons wrap.

### Task 3: Verification

**Files:**
- Test: `apps/web/src/__tests__/poker-table-surface.test.tsx`
- Test: `apps/web/src/__tests__/table-page.test.tsx`

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter web test -- poker-table-surface.test.tsx table-page.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run lint if focused tests pass**

Run: `pnpm --filter web run lint`

Expected: PASS, or report pre-existing failures with exact output.

