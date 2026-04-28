# Frontend Product Iterations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 10 frontend product iterations that turn the MVP web app into a coherent agent poker workspace without violating hand-history privacy or gambling/financial boundaries.

**Architecture:** Start by fixing backend response boundaries that the UI depends on: public-safe table hand history and explicit table management permission. Then add a shared app shell, upgrade Lobby/Table/Agent/Replay pages, and add a Simulation Studio. Each task is independently testable and should be committed before moving to the next task.

**Tech Stack:** TypeScript, Fastify, React 18, React Router, Vite, Vitest, render-to-static-markup component tests, existing global `styles.css`.

---

## File Structure

Backend prerequisites:

- Create `apps/api/src/routes/public-hand-summary.ts`
  - Owns conversion from private `HandSummary` to public-safe `PublicHandSummary`.
- Modify `apps/api/src/routes/matches.ts`
  - Reuses the shared public-hand summary helper.
- Modify `apps/api/src/routes/tables.ts`
  - Adds `canManage` to table detail responses.
  - Returns public-safe summaries from table hand-history routes.
- Modify or add API tests under `apps/api/src/__tests__`
  - Covers no `holeCards` or `handEvaluation` in table hand-history responses.
  - Covers `canManage` true for owner and false for another user.

Shared frontend:

- Create `apps/web/src/components/AppShell.tsx`
  - Shared page shell, navigation, page header, action slot.
- Create `apps/web/src/components/ConfirmDialog.tsx`
  - Reusable in-app confirmation for destructive actions.
- Modify `apps/web/src/styles.css`
  - Adds design tokens and reusable classes for shell, nav, cards, data rows,
    buttons, forms, status chips, alerts, and responsive grids.
- Modify `apps/web/src/router.tsx`
  - Wraps `/lobby`, `/tables/:tableId`, `/agents`, `/agents/new`,
    `/agents/:agentId/edit`, `/matches`, and `/matches/:matchId` in the shared
    shell.
  - Adds `/simulate` when Task 8 is implemented.

Product pages:

- Modify `apps/web/src/pages/LobbyPage.tsx`
- Modify `apps/web/src/pages/TablePage.tsx`
- Modify `apps/web/src/live-table/buildPokerTableViewModel.ts`
- Modify `apps/web/src/live-table/PokerTableSurface.tsx`
- Modify `apps/web/src/live-table/SeatManagementPanel.tsx`
- Modify `apps/web/src/live-table/PlayerActionPanel.tsx`
- Create `apps/web/src/pages/SimulatePage.tsx`
- Modify `apps/web/src/pages/AgentsPage.tsx`
- Modify `apps/web/src/pages/AgentEditPage.tsx`
- Modify `apps/web/src/pages/MatchReplayWorkbench.tsx`
- Modify `apps/web/src/pages/MatchAnalysisDashboard.tsx`
- Modify `apps/web/src/lib/api.ts`
- Modify `apps/web/src/lib/matchReplayView.ts`

Tests:

- Add or modify tests in `apps/web/src/__tests__/`
- Keep existing `apps/web/e2e/demo.spec.ts` green.

Execution note:

- User requested subagents with maximum reasoning. Use `reasoning_effort: xhigh`
  for implementer and reviewer subagents unless a task is purely mechanical.

---

### Task 1: Backend-Safe Table History And Table Management Permission

**Files:**
- Create: `apps/api/src/routes/public-hand-summary.ts`
- Modify: `apps/api/src/routes/matches.ts`
- Modify: `apps/api/src/routes/tables.ts`
- Test: `apps/api/src/__tests__/table-history-privacy.test.ts`

- [x] **Step 1: Write failing API tests for table hand-history privacy**

Add tests that create a table, run a hand, call:

```text
GET /api/v1/tables/:tableId/hands
GET /api/v1/tables/:tableId/hands/:handId
```

Expected assertions:

```ts
expect(JSON.stringify(response.body.data)).not.toContain('holeCards');
expect(JSON.stringify(response.body.data)).not.toContain('handEvaluation');
expect(response.body.data[0].players[0]).toMatchObject({
  playerId: expect.stringMatching(/^player-/),
  agentId: expect.stringMatching(/^(agent|human|http)-/),
  seatIndex: expect.any(Number),
});
```

- [x] **Step 2: Write failing API test for `canManage`**

Create a table as Alice. Fetch the table as Alice and Bob.

Expected assertions:

```ts
expect(aliceResponse.body.data.canManage).toBe(true);
expect(bobResponse.body.data.canManage).toBe(false);
```

- [x] **Step 3: Run the focused API tests and confirm failure**

Run:

```bash
pnpm --filter api run test -- src/__tests__/table-history-privacy.test.ts
```

Expected: FAIL because table hand-history routes return private summaries and table detail lacks `canManage`.

- [x] **Step 4: Add public hand summary helper**

Create `apps/api/src/routes/public-hand-summary.ts`:

```ts
import type { HandSummary, PublicHandPlayerSummary, PublicHandSummary } from '@agent-poker/shared';

export function publicHandSummary(summary: HandSummary): PublicHandSummary {
  return {
    ...summary,
    players: summary.players.map(player => {
      const {
        holeCards: _holeCards,
        handEvaluation: _handEvaluation,
        ...publicPlayer
      } = player as PublicHandPlayerSummary & Record<string, unknown>;
      return publicPlayer as PublicHandPlayerSummary;
    }),
  };
}

export function publicHandSummaries(summaries: HandSummary[]): PublicHandSummary[] {
  return summaries.map(publicHandSummary);
}
```

- [x] **Step 5: Use helper in match routes**

In `apps/api/src/routes/matches.ts`, replace the local public hand summary mapping with `publicHandSummary` from the new helper.

- [x] **Step 6: Use helper in table hand-history routes**

In `apps/api/src/routes/tables.ts`:

```ts
reply.send({ data: publicHandSummaries(hands) });
```

and:

```ts
reply.send({ data: publicHandSummary(hand) });
```

- [x] **Step 7: Add `canManage` to table detail**

In `GET /tables/:tableId`, return:

```ts
reply.send({
  data: {
    ...table,
    canManage: orchestrator.getTableOwnerUserId(req.params.tableId) === req.user!.userId,
  },
});
```

- [x] **Step 8: Run focused API tests**

Run:

```bash
pnpm --filter api run test -- src/__tests__/table-history-privacy.test.ts
pnpm --filter api run test -- src/__tests__/matches.test.ts
```

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add apps/api/src/routes/public-hand-summary.ts apps/api/src/routes/matches.ts apps/api/src/routes/tables.ts apps/api/src/__tests__/table-history-privacy.test.ts
git commit -m "Add public-safe table hand history"
```

---

### Task 2: App Shell And Visual Tokens

**Files:**
- Create: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/app-shell.test.tsx`

- [x] **Step 1: Write AppShell static-render tests**

Create `apps/web/src/__tests__/app-shell.test.tsx` using `renderToStaticMarkup`.

Assertions:

```ts
expect(html).toContain('Agent Poker');
expect(html).toContain('href="/lobby"');
expect(html).toContain('href="/agents"');
expect(html).toContain('href="/matches"');
expect(html).not.toContain('href="/simulate"');
expect(html).toContain('class="app-shell"');
```

- [x] **Step 2: Run test and confirm failure**

```bash
pnpm --filter web run test -- src/__tests__/app-shell.test.tsx
```

Expected: FAIL because `AppShell` does not exist.

- [x] **Step 3: Implement `AppShell`**

Create a component with:

```ts
export interface AppShellProps {
  children: ReactNode;
  currentPath?: string;
  showSimulate?: boolean;
}
```

Navigation links:

- Lobby: `/lobby`
- Agents: `/agents`
- Replays: `/matches`
- Simulate: `/simulate` only when `showSimulate` is true

- [x] **Step 4: Add reusable styles**

Add global classes:

- `.app-shell`
- `.app-topbar`
- `.app-brand`
- `.app-nav`
- `.app-nav-link`
- `.app-content`
- `.page-header`
- `.page-actions`
- `.panel`
- `.button-primary`
- `.button-secondary`
- `.button-danger`
- `.status-chip`
- `.data-table`
- `.responsive-grid`

- [x] **Step 5: Wrap routed pages without linking to missing `/simulate`**

Update `router.tsx` so protected product pages and public match pages render inside `AppShell`.

- [x] **Step 6: Run tests and build**

```bash
pnpm --filter web run test -- src/__tests__/app-shell.test.tsx
pnpm --filter web run build
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/router.tsx apps/web/src/styles.css apps/web/src/__tests__/app-shell.test.tsx
git commit -m "Add web app shell"
```

---

### Task 3: Lobby Table Ops

**Files:**
- Modify: `apps/web/src/pages/LobbyPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/lobby-page.test.tsx`

- [x] **Step 1: Extract pure lobby view component**

Create an exported `LobbyTableList` or `LobbyPageContent` that accepts:

```ts
tables: TableSummary[];
loading: boolean;
error: string | null;
onCreate: (tableId: string) => void;
```

- [x] **Step 2: Write static-render tests**

Assert status chip, players, spectators, blinds, current hand, Join/Watch labels, loading, empty, and error states.

- [x] **Step 3: Replace raw table with styled table-op rows**

Each table row/card must show:

- table name
- status chip
- seated/max
- spectator count
- blind config including ante
- current hand or `No hand`
- primary action: Join when `canSit`, Watch otherwise

- [x] **Step 4: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/lobby-page.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/LobbyPage.tsx apps/web/src/styles.css apps/web/src/__tests__/lobby-page.test.tsx
git commit -m "Upgrade lobby table operations"
```

---

### Task 4: Complete Table Creation Controls

**Files:**
- Modify: `apps/web/src/pages/LobbyPage.tsx`
- Modify: `apps/web/src/__tests__/lobby-page.test.tsx`

- [x] **Step 1: Add pure request builder**

Export:

```ts
export function buildCreateTableRequest(input: CreateTableFormState): CreateTableRequestResult
```

It should validate:

- name is not blank
- `2 <= maxSeats <= 9`
- `smallBlind >= 1`
- `bigBlind >= smallBlind`
- `ante >= 0`
- `defaultTimeoutMs > 0`
- `0 <= maxSpectators <= 1000`

- [x] **Step 2: Write validation tests**

Cover valid request and invalid blind relationship.

- [x] **Step 3: Add form fields**

Expose:

- ante
- seed
- default timeout
- max spectators

Submit body must match:

```ts
{
  name,
  maxSeats,
  blindConfig: { smallBlind, bigBlind, ante },
  defaultTimeoutMs,
  ...(seed.trim() ? { seed: seed.trim() } : {}),
  maxSpectators,
}
```

- [x] **Step 4: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/lobby-page.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/LobbyPage.tsx apps/web/src/__tests__/lobby-page.test.tsx
git commit -m "Expose full table creation controls"
```

---

### Task 5: Table Lifecycle Controls And Safe Hand History

**Files:**
- Modify: `apps/web/src/pages/TablePage.tsx`
- Modify: `apps/web/src/live-table/liveTableTypes.ts`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/table-page.test.tsx`

- [x] **Step 1: Extend web table type**

Add optional `canManage?: boolean` to `TableSnapshot`.

- [x] **Step 2: Add table hand-history types**

Define web-local public hand summary types that omit private cards and evaluations.

- [x] **Step 3: Write static tests for control panel**

Assert:

- watch/unwatch buttons render based on watch state
- delete/close control only renders when `canManage` is true
- hand history rows render hand number, action count, board count, net result
- no rendered markup contains `holeCards`

- [x] **Step 4: Implement watch/unwatch**

Call:

```ts
POST /tables/:tableId/watch
DELETE /tables/:tableId/watch
```

Refresh table after success.

- [x] **Step 5: Implement owner-only delete**

When `table.canManage === true`, show an in-app confirmation and call:

```ts
DELETE /tables/:tableId
```

On success, navigate to `/lobby`.

- [x] **Step 6: Implement hand history fetch**

Fetch `GET /tables/:tableId/hands` and render only public-safe fields.

- [x] **Step 7: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/table-page.test.tsx
pnpm --filter web run test -- src/__tests__/poker-table-surface.test.tsx
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/web/src/pages/TablePage.tsx apps/web/src/live-table/liveTableTypes.ts apps/web/src/styles.css apps/web/src/__tests__/table-page.test.tsx
git commit -m "Add table lifecycle controls"
```

---

### Task 6: Seat Identity And Buy-In Controls

**Files:**
- Modify: `apps/web/src/live-table/buildPokerTableViewModel.ts`
- Modify: `apps/web/src/live-table/PokerTableSurface.tsx`
- Modify: `apps/web/src/live-table/SeatManagementPanel.tsx`
- Modify: `apps/web/src/pages/TablePage.tsx`
- Test: `apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts`
- Test: `apps/web/src/__tests__/poker-table-surface.test.tsx`

- [ ] **Step 1: Extend seat view model**

Add:

```ts
identityLabel: string;
adapterLabel: 'Human' | 'HTTP Agent' | 'Mock Agent';
isYou: boolean;
```

- [ ] **Step 2: Write view-model tests**

Assert human/http/mock labels, you marker, current actor, and dealer state.

- [ ] **Step 3: Render identity badges**

Seat nodes must show adapter badge, you marker, dealer marker, status, and stack.

- [ ] **Step 4: Add buy-in input to seat controls**

Seat management should pass a selected buy-in to human and agent seat calls.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter web run test -- src/live-table/__tests__/buildPokerTableViewModel.test.ts src/__tests__/poker-table-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/live-table apps/web/src/pages/TablePage.tsx apps/web/src/__tests__/poker-table-surface.test.tsx
git commit -m "Improve live table seat identity"
```

---

### Task 7: Player Action Panel

**Files:**
- Modify: `apps/web/src/live-table/PlayerActionPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/poker-table-surface.test.tsx`

- [ ] **Step 1: Add action label helpers**

Export pure helpers:

```ts
formatActionLabel(action: LegalAction): string
buildPresetAmounts(action: LegalAction, potAmount?: number): number[]
formatDeadline(deadlineAt: number, now: number): string
```

- [ ] **Step 2: Write helper tests**

Cover Fold, Check, Call 50, Raise, All-in, min/max presets, and expired deadline.

- [ ] **Step 3: Render title-cased action buttons**

Buttons must use labels like `Fold`, `Check`, `Call 50`, `All-in 900`.

- [ ] **Step 4: Render bet/raise presets**

For sized actions, show min, midpoint, max/all-in presets when values are valid and distinct.

- [ ] **Step 5: Render deadline state**

Show a compact turn timer using `deadlineAt`.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/poker-table-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/live-table/PlayerActionPanel.tsx apps/web/src/styles.css apps/web/src/__tests__/poker-table-surface.test.tsx
git commit -m "Upgrade player action controls"
```

---

### Task 8: Simulation Studio

**Files:**
- Create: `apps/web/src/pages/SimulatePage.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/simulate-page.test.tsx`

- [ ] **Step 1: Add simulation request builder tests**

Cover valid request, 20-hand cap, at least two agents, blind validation, and strategy values.

- [ ] **Step 2: Implement `SimulatePage` form**

Fields:

- match name
- max seats
- small blind
- big blind
- ante
- seed
- timeout
- number of hands
- agent rows: name, strategy, buy-in

- [ ] **Step 3: Add route and nav**

Add protected `/simulate` route. Set `showSimulate` true in `AppShell`.

- [ ] **Step 4: Submit simulation**

Call `POST /simulate`. On success, show link to `/matches/:matchId` and provide a primary open-replay action.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/simulate-page.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/SimulatePage.tsx apps/web/src/router.tsx apps/web/src/components/AppShell.tsx apps/web/src/lib/api.ts apps/web/src/styles.css apps/web/src/__tests__/simulate-page.test.tsx apps/web/src/__tests__/app-shell.test.tsx
git commit -m "Add simulation studio"
```

---

### Task 9: Agent Lab Productization

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Modify: `apps/web/src/pages/AgentsPage.tsx`
- Modify: `apps/web/src/pages/AgentEditPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/__tests__/agents-page.test.tsx`

- [ ] **Step 1: Write static-render tests**

Assert:

- agent cards/rows show name, endpoint, timeout, auth status, description
- endpoint contract text appears on edit page
- auth header value is password input and write-only
- delete uses `ConfirmDialog` markup, not native `confirm`

- [ ] **Step 2: Implement `ConfirmDialog`**

Props:

```ts
open: boolean;
title: string;
message: string;
confirmLabel: string;
cancelLabel?: string;
onConfirm: () => void;
onCancel: () => void;
```

- [ ] **Step 3: Replace native `confirm`**

Remove `confirm('Delete this agent config?')` from `AgentsPage`.

- [ ] **Step 4: Add endpoint contract guidance**

Show concise request/response contract and security note on `AgentEditPage`.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/agents-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ConfirmDialog.tsx apps/web/src/pages/AgentsPage.tsx apps/web/src/pages/AgentEditPage.tsx apps/web/src/styles.css apps/web/src/__tests__/agents-page.test.tsx
git commit -m "Upgrade agent management"
```

---

### Task 10: Replay Player, Analysis Report, And QA

**Files:**
- Modify: `apps/web/src/pages/MatchReplayWorkbench.tsx`
- Modify: `apps/web/src/pages/MatchAnalysisDashboard.tsx`
- Modify: `apps/web/src/lib/matchReplayView.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/e2e/demo.spec.ts` or add focused e2e specs if Playwright is available
- Test: existing replay and analysis tests

- [ ] **Step 1: Add replay player state helpers**

Add pure helpers for:

- previous action id
- next action id
- selected street
- timeline action filtering

- [ ] **Step 2: Write replay helper tests**

Use existing `match-replay-view.test.ts` and add previous/next/street filter cases.

- [ ] **Step 3: Add replay controls**

Render:

- previous
- next
- play/pause
- action range input
- street markers or filter controls

- [ ] **Step 4: Add keyboard stepping**

Left/right arrows step actions when focus is not inside an input, select, textarea, or button.

- [ ] **Step 5: Add analysis sorting helpers**

Support sorting agents by:

- decision count
- average latency
- timeout count
- invalid action count
- fallback count
- missing reasoning count

- [ ] **Step 6: Add warning styles**

Timeout, invalid, and fallback metrics use warning classes when non-zero.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter web run test -- src/__tests__/match-replay-view.test.ts src/__tests__/match-replay-workbench.test.tsx src/__tests__/match-analysis.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run full web verification**

```bash
pnpm --filter web run test
pnpm --filter web run build
pnpm lint
```

Expected: PASS.

- [ ] **Step 9: Browser QA when available**

If Playwright dependencies are installed:

```bash
pnpm --filter web run e2e
```

If not installed, start the dev server and run a browser smoke test manually with screenshots for:

- Lobby desktop
- Live table desktop
- Simulation page
- Agent lab
- Replay/Analysis
- 375px mobile layout

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/MatchReplayWorkbench.tsx apps/web/src/pages/MatchAnalysisDashboard.tsx apps/web/src/lib/matchReplayView.ts apps/web/src/styles.css apps/web/src/__tests__ apps/web/e2e
git commit -m "Add replay player and analysis report"
```

---

## Final Verification

Run after Task 10:

```bash
pnpm test
pnpm build
pnpm lint
```

Expected: all pass. If `pnpm lint` fails because of pre-existing issues outside this branch, record the exact failing files and commands before final handoff.

## Spec Coverage Review

- Backend-safe hand history: Task 1.
- `canManage`/owner-only destructive controls: Tasks 1 and 5.
- App shell and no broken Simulate link: Tasks 2 and 8.
- Lobby operations: Task 3.
- Complete create table controls: Task 4.
- Table lifecycle and hand history: Task 5.
- Seat identity and buy-in: Task 6.
- Action panel: Task 7.
- Simulation Studio: Task 8.
- Agent Lab: Task 9.
- Replay/Analysis/QA: Task 10.

No planned task adds real-money gambling, deposits, withdrawals, betting odds,
payments, wallets, prizes, or financial transaction behavior.
