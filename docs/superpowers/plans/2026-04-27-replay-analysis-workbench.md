# Replay Analysis Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/matches/:matchId` into a Replay Workbench that visually presents public match replay and analysis artifacts.

**Architecture:** Keep the existing API and artifact schema unchanged. Add pure web-client view model helpers for hand/action/analysis derivations, then render those helpers through focused React components wired into the current match detail page. The implementation remains public-safe by consuming only existing public match summary, replay, and analysis responses.

**Tech Stack:** TypeScript, React 18, React Router, Vite, Vitest SSR rendering tests, existing `apps/web/src/lib/api.ts` API wrapper.

---

## File Structure

- Create `apps/web/src/lib/matchArtifacts.ts`
  - Owns web-side TypeScript interfaces for public match artifact data: cards, hands, replay events, and match record.
- Create `apps/web/src/lib/matchReplayView.ts`
  - Owns pure formatting and derivation helpers for hand rail entries, action timeline rows, and analysis distribution rows.
- Create `apps/web/src/pages/MatchReplayWorkbench.tsx`
  - Owns the Replay tab UI: final stack strip, hand rail, hand board, action timeline, and action inspector.
- Create `apps/web/src/pages/MatchAnalysisDashboard.tsx`
  - Owns the Analysis tab UI: metric strip, distribution bars, street/action matrix, and agent comparison cards.
- Modify `apps/web/src/pages/MatchReplayPage.tsx`
  - Loads existing API data, manages selected hand/action state, renders the new workbench and dashboard components, and keeps artifact metadata.
- Modify `apps/web/src/styles.css`
  - Adds responsive workbench/dashboard styles while preserving existing lobby and table UI classes.
- Create `apps/web/src/__tests__/match-replay-view.test.ts`
  - Tests pure helper behavior without React.
- Create `apps/web/src/__tests__/match-replay-workbench.test.tsx`
  - Tests SSR output for the Replay Workbench and privacy boundaries.
- Modify `apps/web/src/__tests__/match-analysis.test.tsx`
  - Points analysis rendering tests at the new dashboard component and verifies visual dashboard content.

---

## Task 1: Public Artifact Types And View Models

**Files:**
- Create: `apps/web/src/lib/matchArtifacts.ts`
- Create: `apps/web/src/lib/matchReplayView.ts`
- Create: `apps/web/src/__tests__/match-replay-view.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/src/__tests__/match-replay-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import {
  buildActionTimeline,
  buildDistributionRows,
  buildHandReplayViews,
  formatCard,
  formatCountLabel,
} from '../lib/matchReplayView.js';

const hand: HandSummary = {
  handId: 'hand-1',
  handNumber: 1,
  seed: 'seed-1',
  communityCards: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  allActions: [
    { playerId: 'bot-a', actionType: 'call', amount: 50 },
    { playerId: 'bot-b', actionType: 'raise', amount: 150 },
  ],
  results: [
    { playerId: 'bot-a', winAmount: 0, netChange: -50 },
    { playerId: 'bot-b', winAmount: 200, netChange: 150 },
  ],
};

const events: ReplayEvent[] = [
  {
    eventId: 'event-1',
    handId: 'hand-1',
    tableId: 'tbl-1',
    sequence: 1,
    eventType: 'player_action',
    timestamp: 1,
    data: { phase: 'preflop' },
  },
  {
    eventId: 'event-2',
    handId: 'hand-1',
    tableId: 'tbl-1',
    sequence: 2,
    eventType: 'player_action',
    timestamp: 2,
    data: { street: 'flop' },
  },
  {
    eventId: 'event-3',
    handId: 'hand-2',
    tableId: 'tbl-1',
    sequence: 3,
    eventType: 'player_action',
    timestamp: 3,
    data: { phase: 'turn' },
  },
];

describe('match replay view helpers', () => {
  it('formats public cards and count labels', () => {
    expect(formatCard({ rank: 'A', suit: 's' })).toBe('AS');
    expect(formatCard({ rank: 'T', suit: 'c' })).toBe('TC');
    expect(formatCountLabel('pot_control')).toBe('pot control');
  });

  it('builds hand rail summaries from public hand data and replay events', () => {
    const views = buildHandReplayViews([hand], events);

    expect(views).toEqual([{
      handId: 'hand-1',
      handNumber: 1,
      seed: 'seed-1',
      actionCount: 2,
      eventCount: 2,
      communityCardCount: 3,
      biggestNetChange: 150,
    }]);
  });

  it('builds action timeline rows with inferred public street context', () => {
    const timeline = buildActionTimeline(hand, events);

    expect(timeline).toEqual([
      {
        id: 'hand-1:0',
        ordinal: 1,
        playerId: 'bot-a',
        actionType: 'call',
        amount: 50,
        street: 'preflop',
        eventType: 'player_action',
      },
      {
        id: 'hand-1:1',
        ordinal: 2,
        playerId: 'bot-b',
        actionType: 'raise',
        amount: 150,
        street: 'flop',
        eventType: 'player_action',
      },
    ]);
  });

  it('sorts distribution rows by count and computes percentages', () => {
    expect(buildDistributionRows({ fold: 1, call: 3, raise: 2 })).toEqual([
      { label: 'call', count: 3, percent: 0.5 },
      { label: 'raise', count: 2, percent: 1 / 3 },
      { label: 'fold', count: 1, percent: 1 / 6 },
    ]);
  });
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-replay-view.test.ts
```

Expected: FAIL because `apps/web/src/lib/matchArtifacts.ts` and `apps/web/src/lib/matchReplayView.ts` do not exist.

- [ ] **Step 3: Add public artifact web types**

Create `apps/web/src/lib/matchArtifacts.ts`:

```ts
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'c' | 'd' | 'h' | 's';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface HandSummary {
  handId: string;
  handNumber: number;
  seed: string;
  communityCards?: Card[];
  allActions?: Array<{ playerId: string; actionType: string; amount: number }>;
  results?: Array<{ playerId: string; winAmount: number; netChange: number }>;
}

export interface MatchArtifactRecord {
  manifest: {
    matchId: string;
    tableId: string;
    createdAt: number;
    files: {
      summary: { sha256: string; bytes: number };
      replay: { sha256: string; bytes: number };
      analysisSummary?: { sha256: string; bytes: number };
    };
  };
  summary: {
    matchId: string;
    tableId: string;
    name: string;
    seed: string;
    startedAt: number;
    completedAt: number;
    handIds: string[];
    hands: HandSummary[];
    finalStacks: Record<string, number>;
    agentIds: string[];
  };
}
```

- [ ] **Step 4: Add pure view helper implementation**

Create `apps/web/src/lib/matchReplayView.ts`:

```ts
import type { Card, HandSummary, ReplayEvent, Suit } from './matchArtifacts.js';

const SUIT_GLYPH: Record<Suit, string> = { s: 'S', h: 'H', d: 'D', c: 'C' };

export interface HandReplayView {
  handId: string;
  handNumber: number;
  seed: string;
  actionCount: number;
  eventCount: number;
  communityCardCount: number;
  biggestNetChange: number | null;
}

export interface ActionTimelineItem {
  id: string;
  ordinal: number;
  playerId: string;
  actionType: string;
  amount: number;
  street: string | null;
  eventType: string | null;
}

export interface DistributionRow {
  label: string;
  count: number;
  percent: number;
}

export function formatCard(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}

export function formatCountLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function formatNullableMs(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value)} ms`;
}

export function formatNullablePercent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

export function buildHandReplayViews(
  hands: HandSummary[],
  replayEvents: ReplayEvent[],
): HandReplayView[] {
  return hands.map(hand => {
    const actionCount = hand.allActions?.length ?? 0;
    const eventCount = replayEvents.filter(event => event.handId === hand.handId).length;
    const communityCardCount = hand.communityCards?.length ?? 0;
    const netChanges = hand.results?.map(result => Math.abs(result.netChange)) ?? [];
    const biggestNetChange = netChanges.length === 0 ? null : Math.max(...netChanges);

    return {
      handId: hand.handId,
      handNumber: hand.handNumber,
      seed: hand.seed,
      actionCount,
      eventCount,
      communityCardCount,
      biggestNetChange,
    };
  });
}

export function buildActionTimeline(
  hand: HandSummary | null,
  replayEvents: ReplayEvent[],
): ActionTimelineItem[] {
  if (!hand) return [];
  const handEvents = replayEvents
    .filter(event => event.handId === hand.handId)
    .sort((a, b) => a.sequence - b.sequence);
  const actionEvents = handEvents.filter(event => isActionLikeEvent(event.eventType));

  return (hand.allActions ?? []).map((action, index) => {
    const event = actionEvents[index] ?? handEvents[index] ?? null;
    return {
      id: `${hand.handId}:${index}`,
      ordinal: index + 1,
      playerId: action.playerId,
      actionType: action.actionType,
      amount: action.amount,
      street: event ? extractStreet(event) : null,
      eventType: event?.eventType ?? null,
    };
  });
}

export function buildDistributionRows(counts: Record<string, number>): DistributionRow[] {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return [];

  return Object.entries(counts)
    .map(([label, count]) => ({ label, count, percent: count / total }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function isActionLikeEvent(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return normalized.includes('action') || normalized.includes('decision');
}

function extractStreet(event: ReplayEvent): string | null {
  const street = event.data.street ?? event.data.phase;
  return typeof street === 'string' && street.length > 0 ? street : null;
}
```

- [ ] **Step 5: Run helper tests and verify they pass**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-replay-view.test.ts
```

Expected: PASS for `match-replay-view.test.ts`.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add apps/web/src/lib/matchArtifacts.ts apps/web/src/lib/matchReplayView.ts apps/web/src/__tests__/match-replay-view.test.ts
git commit -m "Add replay view model helpers"
```

Expected: commit succeeds and `git status --short` does not show these three files.

---

## Task 2: Replay Workbench Components

**Files:**
- Create: `apps/web/src/pages/MatchReplayWorkbench.tsx`
- Create: `apps/web/src/__tests__/match-replay-workbench.test.tsx`

- [ ] **Step 1: Write the failing Replay Workbench SSR tests**

Create `apps/web/src/__tests__/match-replay-workbench.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import { ReplayWorkbench } from '../pages/MatchReplayWorkbench.js';

const hand: HandSummary = {
  handId: 'hand-1',
  handNumber: 1,
  seed: 'seed-1',
  communityCards: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  allActions: [
    { playerId: 'bot-a', actionType: 'call', amount: 50 },
    { playerId: 'bot-b', actionType: 'raise', amount: 150 },
  ],
  results: [
    { playerId: 'bot-a', winAmount: 0, netChange: -50 },
    { playerId: 'bot-b', winAmount: 200, netChange: 150 },
  ],
};

const replayEvents: ReplayEvent[] = [{
  eventId: 'event-1',
  handId: 'hand-1',
  tableId: 'tbl-1',
  sequence: 1,
  eventType: 'player_action',
  timestamp: 1,
  data: { phase: 'preflop' },
}];

describe('ReplayWorkbench', () => {
  it('renders hand rail, public board, action timeline, and inspector', () => {
    const html = renderToStaticMarkup(
      <ReplayWorkbench
        hands={[hand]}
        replayEvents={replayEvents}
        finalStacks={{ 'bot-a': 950, 'bot-b': 1150 }}
        selectedHandId="hand-1"
        selectedActionId="hand-1:1"
        replayLoading={false}
        replayError={null}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />,
    );

    expect(html).toContain('Replay Workbench');
    expect(html).toContain('Hand 1');
    expect(html).toContain('AS');
    expect(html).toContain('KH');
    expect(html).toContain('QD');
    expect(html).toContain('bot-b');
    expect(html).toContain('raise');
    expect(html).toContain('150');
    expect(html).toContain('Selected Action');
    expect(html).toContain('Only aggregate analysis is available for this action.');
  });

  it('renders explicit empty states without private surfaces', () => {
    const html = renderToStaticMarkup(
      <ReplayWorkbench
        hands={[]}
        replayEvents={[]}
        finalStacks={{}}
        selectedHandId={null}
        selectedActionId={null}
        replayLoading={false}
        replayError={null}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />,
    );

    expect(html).toContain('No hands recorded.');
    expect(html).toContain('No hand selected.');
    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
  });
});
```

- [ ] **Step 2: Run the workbench tests and verify they fail**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-replay-workbench.test.tsx
```

Expected: FAIL because `apps/web/src/pages/MatchReplayWorkbench.tsx` does not exist.

- [ ] **Step 3: Create the Replay Workbench component**

Create `apps/web/src/pages/MatchReplayWorkbench.tsx` with these exported props and component structure:

```tsx
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import {
  buildActionTimeline,
  buildHandReplayViews,
  formatCard,
  formatCountLabel,
  type ActionTimelineItem,
} from '../lib/matchReplayView.js';

interface ReplayWorkbenchProps {
  hands: HandSummary[];
  replayEvents: ReplayEvent[];
  finalStacks: Record<string, number>;
  selectedHandId: string | null;
  selectedActionId: string | null;
  replayLoading: boolean;
  replayError: string | null;
  onSelectHand: (handId: string) => void;
  onSelectAction: (actionId: string) => void;
}

export function ReplayWorkbench({
  hands,
  replayEvents,
  finalStacks,
  selectedHandId,
  selectedActionId,
  replayLoading,
  replayError,
  onSelectHand,
  onSelectAction,
}: ReplayWorkbenchProps) {
  const handViews = buildHandReplayViews(hands, replayEvents);
  const selectedHand = hands.find(hand => hand.handId === selectedHandId) ?? null;
  const timeline = buildActionTimeline(selectedHand, replayEvents);
  const selectedAction = timeline.find(action => action.id === selectedActionId) ?? timeline[0] ?? null;

  return (
    <section className="workbench-panel">
      <div className="section-heading">
        <div>
          <h2>Replay Workbench</h2>
          <p className="muted">Review public hand flow, actions, and aggregate decision context.</p>
        </div>
      </div>

      <FinalStackStrip finalStacks={finalStacks} />

      {replayError && <div className="error">{replayError}</div>}

      <div className="workbench-grid">
        <aside className="hand-rail" aria-label="Hands">
          <h3>Hands</h3>
          {handViews.map(hand => (
            <button
              key={hand.handId}
              type="button"
              className="hand-rail-item"
              aria-pressed={hand.handId === selectedHandId}
              onClick={() => onSelectHand(hand.handId)}
            >
              <strong>Hand {hand.handNumber}</strong>
              <span>{hand.actionCount} actions</span>
              <span>{hand.eventCount} events</span>
              <span>
                {hand.biggestNetChange === null ? 'no net result' : `biggest net ${hand.biggestNetChange}`}
              </span>
            </button>
          ))}
          {handViews.length === 0 && <p className="muted">No hands recorded.</p>}
        </aside>

        <HandBoard
          hand={selectedHand}
          timeline={timeline}
          selectedActionId={selectedAction?.id ?? null}
          replayLoading={replayLoading}
          onSelectAction={onSelectAction}
        />

        <ActionInspector hand={selectedHand} action={selectedAction} />
      </div>
    </section>
  );
}

function FinalStackStrip({ finalStacks }: { finalStacks: Record<string, number> }) {
  const entries = Object.entries(finalStacks);
  return (
    <div className="stack-strip" aria-label="Final stacks">
      {entries.map(([agentId, stack]) => (
        <div className="stack-card" key={agentId}>
          <span>{agentId}</span>
          <strong>{stack}</strong>
        </div>
      ))}
      {entries.length === 0 && <span className="muted">No final stacks recorded.</span>}
    </div>
  );
}

function HandBoard({
  hand,
  timeline,
  selectedActionId,
  replayLoading,
  onSelectAction,
}: {
  hand: HandSummary | null;
  timeline: ActionTimelineItem[];
  selectedActionId: string | null;
  replayLoading: boolean;
  onSelectAction: (actionId: string) => void;
}) {
  if (!hand) {
    return (
      <section className="hand-board">
        <h3>No hand selected.</h3>
        <p className="muted">Select a hand to inspect its public replay.</p>
      </section>
    );
  }

  const communityCards = hand.communityCards ?? [];
  const results = hand.results ?? [];

  return (
    <section className="hand-board">
      <div className="hand-board-header">
        <div>
          <h3>Hand {hand.handNumber}</h3>
          <p className="muted">seed {hand.seed}</p>
        </div>
        <span className="pill">{timeline.length} actions</span>
      </div>

      <div className="community-row" aria-label="Community cards">
        {communityCards.map((card, index) => (
          <span className="card-chip" key={`${card.rank}${card.suit}:${index}`}>{formatCard(card)}</span>
        ))}
        {communityCards.length === 0 && <span className="muted">No community cards recorded.</span>}
      </div>

      <div className="result-grid">
        {results.map((result, index) => (
          <div className="result-card" key={`${result.playerId}:${index}`}>
            <span>{result.playerId}</span>
            <strong>{result.netChange >= 0 ? `+${result.netChange}` : result.netChange}</strong>
            <small>win {result.winAmount}</small>
          </div>
        ))}
        {results.length === 0 && <p className="muted">No results recorded for this hand.</p>}
      </div>

      <div className="action-timeline">
        <h4>Action Timeline</h4>
        {timeline.map(action => (
          <button
            key={action.id}
            type="button"
            className="timeline-row"
            aria-pressed={action.id === selectedActionId}
            onClick={() => onSelectAction(action.id)}
          >
            <span>#{action.ordinal}</span>
            <strong>{action.playerId}</strong>
            <span>{formatCountLabel(action.actionType)}</span>
            <span>{action.amount > 0 ? action.amount : ''}</span>
            <small>{action.street ? formatCountLabel(action.street) : 'street unknown'}</small>
          </button>
        ))}
        {replayLoading && <p className="muted">Loading replay events...</p>}
        {!replayLoading && timeline.length === 0 && <p className="muted">No actions recorded for this hand.</p>}
      </div>
    </section>
  );
}

function ActionInspector({
  hand,
  action,
}: {
  hand: HandSummary | null;
  action: ActionTimelineItem | null;
}) {
  return (
    <aside className="action-inspector">
      <h3>Selected Action</h3>
      {!hand && <p className="muted">No hand selected.</p>}
      {hand && !action && <p className="muted">No action selected.</p>}
      {hand && action && (
        <dl>
          <div><dt>Player</dt><dd>{action.playerId}</dd></div>
          <div><dt>Action</dt><dd>{formatCountLabel(action.actionType)}</dd></div>
          <div><dt>Amount</dt><dd>{action.amount > 0 ? action.amount : 'n/a'}</dd></div>
          <div><dt>Street</dt><dd>{action.street ? formatCountLabel(action.street) : 'unknown'}</dd></div>
          <div><dt>Event</dt><dd>{action.eventType ? formatCountLabel(action.eventType) : 'unknown'}</dd></div>
        </dl>
      )}
      <p className="muted">Only aggregate analysis is available for this action.</p>
    </aside>
  );
}
```

- [ ] **Step 4: Run the workbench tests and verify they pass**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-replay-workbench.test.tsx
```

Expected: PASS for `match-replay-workbench.test.tsx`.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/web/src/pages/MatchReplayWorkbench.tsx apps/web/src/__tests__/match-replay-workbench.test.tsx
git commit -m "Add replay workbench components"
```

Expected: commit succeeds and `git status --short` does not show these two files.

---

## Task 3: Analysis Dashboard Components

**Files:**
- Create: `apps/web/src/pages/MatchAnalysisDashboard.tsx`
- Modify: `apps/web/src/__tests__/match-analysis.test.tsx`

- [ ] **Step 1: Update the analysis tests first**

Replace `apps/web/src/__tests__/match-analysis.test.tsx` with:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchAnalysisPanel } from '../pages/MatchAnalysisDashboard.js';
import type { MatchAnalysisSummary } from '../lib/api.js';

const analysis: MatchAnalysisSummary = {
  matchId: 'match-1',
  tableId: 'tbl-1',
  generatedAt: 1_777_280_000_000,
  handCount: 2,
  agentCount: 2,
  decisionCount: 5,
  totals: {
    decisionCount: 5,
    actionCounts: { call: 3, fold: 2 },
    streetCounts: {
      preflop: { call: 2, fold: 1 },
      flop: { call: 1, fold: 1 },
    },
    intentCounts: { pot_control: 2, value: 1 },
    riskCounts: { low: 2, medium: 1 },
    missingReasoningCount: 2,
    timeoutCount: 1,
    invalidActionCount: 1,
    fallbackCount: 1,
    averageConfidence: 0.72,
    averageLatencyMs: 14.4,
    maxLatencyMs: 31,
  },
  agents: [{
    agentId: 'bot-a',
    playerIds: ['player-a'],
    handIds: ['hand-1', 'hand-2'],
    decisionCount: 3,
    actionCounts: { call: 3 },
    streetCounts: { preflop: { call: 2 }, flop: { call: 1 } },
    intentCounts: { pot_control: 2 },
    riskCounts: { low: 2 },
    missingReasoningCount: 1,
    timeoutCount: 0,
    invalidActionCount: 0,
    fallbackCount: 0,
    averageConfidence: 0.8,
    averageLatencyMs: 10,
    maxLatencyMs: 12,
  }],
};

describe('MatchAnalysisPanel', () => {
  it('renders aggregate dashboard metrics and agent comparison content', () => {
    const html = renderToStaticMarkup(<MatchAnalysisPanel analysis={analysis} loading={false} error={null} />);

    expect(html).toContain('Analysis Dashboard');
    expect(html).toContain('5 decisions');
    expect(html).toContain('2 agents');
    expect(html).toContain('call');
    expect(html).toContain('fold');
    expect(html).toContain('pot control');
    expect(html).toContain('Street / Action Matrix');
    expect(html).toContain('Agent Comparison');
    expect(html).toContain('bot-a');
    expect(html).toContain('31 ms');
  });

  it('renders loading, error, and empty states', () => {
    expect(renderToStaticMarkup(<MatchAnalysisPanel analysis={null} loading={true} error={null} />))
      .toContain('Loading analysis');
    expect(renderToStaticMarkup(<MatchAnalysisPanel analysis={null} loading={false} error="failed" />))
      .toContain('failed');
    expect(renderToStaticMarkup(<MatchAnalysisPanel analysis={null} loading={false} error={null} />))
      .toContain('No analysis summary published.');
  });

  it('does not render private reasoning surfaces', () => {
    const html = renderToStaticMarkup(<MatchAnalysisPanel analysis={analysis} loading={false} error={null} />);

    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
  });
});
```

- [ ] **Step 2: Run the analysis test and verify it fails**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-analysis.test.tsx
```

Expected: FAIL because `apps/web/src/pages/MatchAnalysisDashboard.tsx` does not exist.

- [ ] **Step 3: Create the Analysis Dashboard component**

Create `apps/web/src/pages/MatchAnalysisDashboard.tsx`:

```tsx
import type { AgentAnalysisSummary, AnalysisMetricSummary, MatchAnalysisSummary } from '../lib/api.js';
import {
  buildDistributionRows,
  formatCountLabel,
  formatNullableMs,
  formatNullablePercent,
} from '../lib/matchReplayView.js';

export function MatchAnalysisPanel({
  analysis,
  loading,
  error,
}: {
  analysis: MatchAnalysisSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="muted">Loading analysis...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!analysis) return <div className="muted">No analysis summary published.</div>;

  return (
    <section className="analysis-panel">
      <div className="section-heading">
        <div>
          <h2>Analysis Dashboard</h2>
          <p className="muted">
            {analysis.decisionCount} decisions · {analysis.agentCount} agents · {analysis.handCount} hands
          </p>
        </div>
      </div>

      <MetricStrip metrics={analysis.totals} />

      <div className="analysis-dashboard-grid">
        <DistributionCard title="Actions" counts={analysis.totals.actionCounts} />
        <DistributionCard title="Intent" counts={analysis.totals.intentCounts} />
        <DistributionCard title="Risk" counts={analysis.totals.riskCounts} />
        <StreetActionMatrix streetCounts={analysis.totals.streetCounts} />
      </div>

      <AgentComparison agents={analysis.agents} />
    </section>
  );
}

function MetricStrip({ metrics }: { metrics: AnalysisMetricSummary }) {
  return (
    <div className="metric-grid">
      <div><strong>{metrics.decisionCount}</strong><span>decisions</span></div>
      <div><strong>{formatNullableMs(metrics.averageLatencyMs)}</strong><span>avg latency</span></div>
      <div><strong>{formatNullableMs(metrics.maxLatencyMs)}</strong><span>max latency</span></div>
      <div><strong>{formatNullablePercent(metrics.averageConfidence)}</strong><span>avg confidence</span></div>
      <div><strong>{metrics.timeoutCount}</strong><span>timeouts</span></div>
      <div><strong>{metrics.invalidActionCount}</strong><span>invalid</span></div>
      <div><strong>{metrics.fallbackCount}</strong><span>fallbacks</span></div>
      <div><strong>{metrics.missingReasoningCount}</strong><span>missing reasoning</span></div>
    </div>
  );
}

function DistributionCard({ title, counts }: { title: string; counts: Record<string, number> }) {
  const rows = buildDistributionRows(counts);
  return (
    <section className="analysis-card">
      <h3>{title}</h3>
      {rows.map(row => (
        <div className="bar-row" key={row.label}>
          <div className="bar-row-label">
            <span>{formatCountLabel(row.label)}</span>
            <strong>{row.count}</strong>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(4, Math.round(row.percent * 100))}%` }} />
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">No entries.</p>}
    </section>
  );
}

function StreetActionMatrix({ streetCounts }: { streetCounts: Record<string, Record<string, number>> }) {
  const rows = Object.entries(streetCounts).flatMap(([street, counts]) =>
    Object.entries(counts).map(([action, count]) => ({ street, action, count })),
  );

  return (
    <section className="analysis-card">
      <h3>Street / Action Matrix</h3>
      <div className="matrix-list">
        {rows.map(row => (
          <div className="matrix-row" key={`${row.street}:${row.action}`}>
            <span>{formatCountLabel(row.street)}</span>
            <strong>{formatCountLabel(row.action)}</strong>
            <em>{row.count}</em>
          </div>
        ))}
      </div>
      {rows.length === 0 && <p className="muted">No street actions.</p>}
    </section>
  );
}

function AgentComparison({ agents }: { agents: AgentAnalysisSummary[] }) {
  return (
    <section className="agent-comparison">
      <h3>Agent Comparison</h3>
      <div className="agent-card-grid">
        {agents.map(agent => (
          <article className="agent-card" key={agent.agentId}>
            <div className="agent-card-header">
              <strong>{agent.agentId}</strong>
              <span>{agent.decisionCount} decisions</span>
            </div>
            <dl className="agent-metrics">
              <div><dt>Avg Latency</dt><dd>{formatNullableMs(agent.averageLatencyMs)}</dd></div>
              <div><dt>Max Latency</dt><dd>{formatNullableMs(agent.maxLatencyMs)}</dd></div>
              <div><dt>Timeouts</dt><dd>{agent.timeoutCount}</dd></div>
              <div><dt>Invalid</dt><dd>{agent.invalidActionCount}</dd></div>
              <div><dt>Fallbacks</dt><dd>{agent.fallbackCount}</dd></div>
              <div><dt>Missing Reasoning</dt><dd>{agent.missingReasoningCount}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      {agents.length === 0 && <p className="muted">No agent metrics.</p>}
    </section>
  );
}
```

- [ ] **Step 4: Run the analysis tests and verify they pass**

Run:

```bash
pnpm --filter web run test -- src/__tests__/match-analysis.test.tsx
```

Expected: PASS for `match-analysis.test.tsx`.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/web/src/pages/MatchAnalysisDashboard.tsx apps/web/src/__tests__/match-analysis.test.tsx
git commit -m "Add match analysis dashboard"
```

Expected: commit succeeds and `git status --short` does not show these two files.

---

## Task 4: Wire The Workbench Into MatchReplayPage

**Files:**
- Modify: `apps/web/src/pages/MatchReplayPage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/__tests__/match-analysis.test.tsx`

- [ ] **Step 1: Run the current web tests before wiring**

Run:

```bash
pnpm --filter web run test
```

Expected: PASS for the existing web tests added in Tasks 1 through 3.

- [ ] **Step 2: Replace local artifact interfaces and analysis components in the page**

Modify the imports at the top of `apps/web/src/pages/MatchReplayPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, type MatchAnalysisSummary } from '../lib/api.js';
import type { MatchArtifactRecord, ReplayEvent } from '../lib/matchArtifacts.js';
import { buildActionTimeline } from '../lib/matchReplayView.js';
import { MatchAnalysisPanel } from './MatchAnalysisDashboard.js';
import { ReplayWorkbench } from './MatchReplayWorkbench.js';

export type { MatchAnalysisSummary } from '../lib/api.js';
```

Delete these local definitions from `MatchReplayPage.tsx` because they now live in shared web files:

```tsx
type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
type Suit = 'c' | 'd' | 'h' | 's';
interface Card { rank: Rank; suit: Suit }
interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}
interface HandSummary {
  handId: string;
  handNumber: number;
  seed: string;
  communityCards?: Card[];
  allActions?: Array<{ playerId: string; actionType: string; amount: number }>;
  results?: Array<{ playerId: string; winAmount: number; netChange: number }>;
}
interface MatchArtifactRecord {
  manifest: {
    matchId: string;
    tableId: string;
    createdAt: number;
    files: {
      summary: { sha256: string; bytes: number };
      replay: { sha256: string; bytes: number };
      analysisSummary?: { sha256: string; bytes: number };
    };
  };
  summary: {
    matchId: string;
    tableId: string;
    name: string;
    seed: string;
    startedAt: number;
    completedAt: number;
    handIds: string[];
    hands: HandSummary[];
    finalStacks: Record<string, number>;
    agentIds: string[];
  };
}
const SUIT_GLYPH: Record<Suit, string> = { s: 'S', h: 'H', d: 'D', c: 'C' };
function formatCard(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}
function formatCountLabel(value: string): string {
  return value.replaceAll('_', ' ');
}
function formatNullableMs(value: number | null): string {
  return value === null ? 'n/a' : `${value} ms`;
}
function formatNullablePercent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}
```

Delete `CountTable`, `StreetActionTable`, `MetricStrip`, and the old inline `MatchAnalysisPanel` from `MatchReplayPage.tsx`.

- [ ] **Step 3: Add selected action state and keep it in sync**

In `MatchReplayPage`, add state next to `selectedHandId`:

```tsx
const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
```

When resetting load state in the `useEffect`, add:

```tsx
setSelectedActionId(null);
```

After `selectedEvents`, add:

```tsx
const selectedTimeline = useMemo(() => (
  buildActionTimeline(selectedHand, selectedEvents)
), [selectedHand, selectedEvents]);

useEffect(() => {
  setSelectedActionId(selectedTimeline[0]?.id ?? null);
}, [selectedHandId, selectedTimeline]);
```

Add a local handler:

```tsx
function handleSelectHand(handId: string) {
  setSelectedHandId(handId);
}
```

- [ ] **Step 4: Replace the old Replay tab body**

Replace the old `activeTab === 'replay'` fragment with:

```tsx
{activeTab === 'replay' && (
  <ReplayWorkbench
    hands={record.summary.hands}
    replayEvents={replayEvents}
    finalStacks={record.summary.finalStacks}
    selectedHandId={selectedHandId}
    selectedActionId={selectedActionId}
    replayLoading={replayLoading}
    replayError={replayError}
    onSelectHand={handleSelectHand}
    onSelectAction={setSelectedActionId}
  />
)}
```

Keep the existing `activeTab === 'analysis'` block, now using the imported dashboard component:

```tsx
{activeTab === 'analysis' && (
  <MatchAnalysisPanel
    analysis={analysis}
    loading={analysisLoading}
    error={analysisError}
  />
)}
```

- [ ] **Step 5: Update header summary and artifact metadata**

In the page header area, keep `formatTime` and add a concise summary row below the match metadata:

```tsx
<div className="match-summary-strip">
  <div><strong>{record.summary.handIds.length}</strong><span>hands</span></div>
  <div><strong>{record.summary.agentIds.length}</strong><span>agents</span></div>
  <div><strong>{analysis?.decisionCount ?? 'n/a'}</strong><span>decisions</span></div>
  <div><strong>{replayEvents.length}</strong><span>public events</span></div>
</div>
```

Change the final artifact section heading from `Artifact` to `Artifact Metadata` and add class names:

```tsx
<section className="artifact-metadata">
  <h2>Artifact Metadata</h2>
  <p className="muted" style={{ overflowWrap: 'anywhere' }}>
    summary sha256 {record.manifest.files.summary.sha256}
    <br />
    replay sha256 {record.manifest.files.replay.sha256}
    {record.manifest.files.analysisSummary && (
      <>
        <br />
        analysis sha256 {record.manifest.files.analysisSummary.sha256}
      </>
    )}
  </p>
</section>
```

- [ ] **Step 6: Add responsive styles**

Append this CSS to `apps/web/src/styles.css`:

```css
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.match-summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.match-summary-strip div,
.stack-card,
.analysis-card,
.agent-card,
.action-inspector,
.hand-board,
.hand-rail {
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
}
.match-summary-strip div {
  padding: 10px;
  min-height: 64px;
}
.match-summary-strip strong {
  display: block;
  font-size: 20px;
}
.match-summary-strip span {
  display: block;
  margin-top: 4px;
  color: #666;
  font-size: 12px;
}
.workbench-panel {
  margin-top: 16px;
}
.stack-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin: 12px 0 16px;
}
.stack-card {
  padding: 10px;
  min-height: 64px;
}
.stack-card span,
.stack-card strong {
  display: block;
}
.stack-card strong {
  margin-top: 4px;
  font-size: 20px;
}
.workbench-grid {
  display: grid;
  grid-template-columns: minmax(160px, 0.75fr) minmax(360px, 2fr) minmax(220px, 1fr);
  gap: 16px;
  align-items: start;
}
.hand-rail,
.hand-board,
.action-inspector {
  padding: 12px;
}
.hand-rail-item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  width: 100%;
  margin-bottom: 8px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}
.hand-rail-item[aria-pressed="true"],
.timeline-row[aria-pressed="true"] {
  border-color: #222;
  box-shadow: 0 0 0 1px #222 inset;
}
.hand-rail-item span,
.timeline-row small {
  color: #666;
  font-size: 12px;
}
.hand-board-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.pill {
  border: 1px solid #d8d8d8;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
  white-space: nowrap;
}
.community-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
  min-height: 40px;
}
.card-chip {
  border: 1px solid #333;
  border-radius: 6px;
  min-width: 42px;
  padding: 8px 10px;
  text-align: center;
  font-weight: 700;
  background: #f9fafb;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.result-card {
  border: 1px solid #e4e4e4;
  border-radius: 8px;
  padding: 8px;
}
.result-card span,
.result-card strong,
.result-card small {
  display: block;
}
.result-card strong {
  margin-top: 4px;
}
.action-timeline h4 {
  margin-bottom: 8px;
}
.timeline-row {
  display: grid;
  grid-template-columns: 40px minmax(90px, 1fr) minmax(90px, 1fr) 70px minmax(90px, 1fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  min-height: 42px;
  margin-bottom: 8px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}
.action-inspector dl,
.agent-metrics {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}
.action-inspector dl div,
.agent-metrics div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #eee;
  padding-bottom: 6px;
}
.action-inspector dt,
.agent-metrics dt {
  color: #666;
}
.action-inspector dd,
.agent-metrics dd {
  margin: 0;
  font-weight: 700;
  text-align: right;
}
.analysis-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  align-items: start;
}
.analysis-card,
.agent-card {
  padding: 12px;
}
.bar-row {
  margin-top: 10px;
}
.bar-row-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.bar-track {
  height: 8px;
  border-radius: 999px;
  background: #ececec;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: inherit;
  background: #2563eb;
}
.matrix-list {
  display: grid;
  gap: 8px;
}
.matrix-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
  border-bottom: 1px solid #eee;
  padding-bottom: 6px;
}
.matrix-row em {
  font-style: normal;
  font-weight: 700;
}
.agent-comparison {
  margin-top: 16px;
}
.agent-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.agent-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.artifact-metadata {
  margin-top: 16px;
  border-top: 1px solid #eee;
  padding-top: 12px;
}
@media (max-width: 840px) {
  .page {
    padding: 16px;
  }
  .workbench-grid {
    grid-template-columns: 1fr;
  }
  .timeline-row {
    grid-template-columns: 36px minmax(80px, 1fr) minmax(80px, 1fr);
  }
  .timeline-row span:nth-child(4),
  .timeline-row small {
    grid-column: span 1;
  }
}
```

- [ ] **Step 7: Run focused web tests**

Run:

```bash
pnpm --filter web run test
```

Expected: PASS for `api.test.ts`, `match-analysis.test.tsx`, `match-replay-view.test.ts`, and `match-replay-workbench.test.tsx`.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add apps/web/src/pages/MatchReplayPage.tsx apps/web/src/styles.css apps/web/src/__tests__/match-analysis.test.tsx
git commit -m "Wire replay workbench into match page"
```

Expected: commit succeeds and `git status --short` does not show these files.

---

## Task 5: Final Verification And Browser Check

**Files:**
- No source files created in this task.

- [ ] **Step 1: Run web build**

Run:

```bash
pnpm --filter web run build
```

Expected: PASS. Vite prints a production bundle summary.

- [ ] **Step 2: Run full build**

Run:

```bash
pnpm build
```

Expected: PASS. A Node engine warning may appear if the local shell is not using Node 20.

- [ ] **Step 3: Run TypeScript lint**

Run:

```bash
pnpm lint
```

Expected: PASS with exit code 0. A Node engine warning may appear if the local shell is not using Node 20.

- [ ] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS with `53 passed` test files and all tests passing after the new web tests are included. If the sandbox rejects localhost listeners with `listen EPERM: operation not permitted 127.0.0.1`, rerun the same command with escalated permissions.

- [ ] **Step 5: Check Git status**

Run:

```bash
git status --short --branch
```

Expected: only the intentionally untracked `.pnpm-store/` cache remains.

- [ ] **Step 6: Start the web dev server for manual review**

Run:

```bash
pnpm --filter web dev
```

Expected: Vite starts and prints a local URL, usually `http://localhost:5173/`. Keep this process running for the user to inspect `/matches` and `/matches/:matchId`.

If port `5173` is already in use, Vite will select another port. Report the actual URL from the command output.
