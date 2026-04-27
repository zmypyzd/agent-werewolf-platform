import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { describe, expect, it } from 'vitest';
import type { MatchAnalysisSummary } from '../lib/api.js';
import type { MatchArtifactRecord, ReplayEvent } from '../lib/matchArtifacts.js';
import { MatchReplayPageContent } from '../pages/MatchReplayPage.js';

function hasClassToken(html: string, className: string): boolean {
  return [...html.matchAll(/class="([^"]+)"/g)]
    .some(match => match[1]!.split(/\s+/).includes(className));
}

const record: MatchArtifactRecord = {
  manifest: {
    artifactVersion: 1,
    matchId: 'match-1',
    tableId: 'table-1',
    createdAt: 1_777_280_000_000,
    handIds: ['hand-1'],
    files: {
      summary: {
        path: 'summary.json',
        sha256: 'summary-sha',
        bytes: 120,
        contentType: 'application/json',
      },
      replay: {
        path: 'replay.jsonl',
        sha256: 'replay-sha',
        bytes: 240,
        contentType: 'application/x-ndjson',
      },
      decisionTrace: {
        path: 'decision-trace.jsonl',
        sha256: 'trace-sha',
        bytes: 360,
        contentType: 'application/x-ndjson',
      },
      analysisSummary: {
        path: 'analysis-summary.json',
        sha256: 'analysis-sha',
        bytes: 180,
        contentType: 'application/json',
      },
    },
  },
  summary: {
    matchId: 'match-1',
    tableId: 'table-1',
    name: 'Replay fixture',
    seed: 'seed-1',
    startedAt: 1_777_280_000_000,
    completedAt: 1_777_280_100_000,
    handIds: ['hand-1'],
    agentIds: ['agent-a', 'agent-b'],
    finalStacks: { 'bot-a': 950, 'bot-b': 1050 },
    hands: [{
      handId: 'hand-1',
      tableId: 'table-1',
      handNumber: 1,
      seed: 'hand-seed-1',
      startedAt: 1,
      completedAt: 2,
      players: [
        { playerId: 'bot-a', agentId: 'agent-a', seatIndex: 0, stackBefore: 1000, stackAfter: 950 },
        { playerId: 'bot-b', agentId: 'agent-b', seatIndex: 1, stackBefore: 1000, stackAfter: 1050 },
      ],
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      communityCards: [{ rank: 'A', suit: 's' }],
      allActions: [{
        actionId: 'action-1',
        handId: 'hand-1',
        playerId: 'bot-a',
        phase: 'preflop',
        actionType: 'call',
        amount: 50,
        stackAfter: 950,
        sequence: 0,
        timestamp: 10,
      }],
      results: [
        { playerId: 'bot-a', seatIndex: 0, potIndex: 0, winAmount: 0, netChange: -50 },
        { playerId: 'bot-b', seatIndex: 1, potIndex: 0, winAmount: 100, netChange: 50 },
      ],
      finalPots: [{ amount: 100, eligiblePlayerIds: ['bot-b'] }],
    }],
  },
};

const replayEvents: ReplayEvent[] = [{
  eventId: 'event-1',
  handId: 'hand-1',
  tableId: 'table-1',
  sequence: 1,
  eventType: 'action.applied',
  timestamp: 1,
  data: {
    actionId: 'action-1',
    holeCards: ['AS', 'KH'],
    rawChainOfThought: 'secret reasoning',
    keyObservations: ['private note'],
    consideredActions: [{ reason: 'private reason' }],
  },
}];

const analysis: MatchAnalysisSummary = {
  matchId: 'match-1',
  tableId: 'table-1',
  generatedAt: 1_777_280_200_000,
  handCount: 1,
  agentCount: 2,
  decisionCount: 3,
  totals: {
    decisionCount: 3,
    actionCounts: { call: 3 },
    streetCounts: { preflop: { call: 3 } },
    intentCounts: {},
    riskCounts: {},
    missingReasoningCount: 0,
    timeoutCount: 0,
    invalidActionCount: 0,
    fallbackCount: 0,
    averageConfidence: null,
    averageLatencyMs: 12,
    maxLatencyMs: 20,
  },
  agents: [],
};

function renderContent(activeTab: 'replay' | 'analysis', currentAnalysis: MatchAnalysisSummary | null = analysis) {
  return renderToStaticMarkup(
    <StaticRouter location="/matches/match-1">
      <MatchReplayPageContent
        record={record}
        replayEvents={replayEvents}
        analysis={currentAnalysis}
        activeTab={activeTab}
        selectedHandId="hand-1"
        selectedActionId="hand-1:0"
        replayLoading={false}
        replayError={null}
        analysisLoading={false}
        analysisError={null}
        onSelectTab={() => undefined}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />
    </StaticRouter>,
  );
}

describe('MatchReplayPageContent', () => {
  it('renders the summary strip, replay workbench, and artifact metadata without private surfaces', () => {
    const html = renderContent('replay');

    expect(hasClassToken(html, 'match-summary-strip')).toBe(true);
    expect(hasClassToken(html, 'artifact-metadata')).toBe(true);
    expect(html).toContain('Replay Workbench');
    expect(html).toContain('Artifact Metadata');
    expect(html).toContain('<strong>1</strong><span>hands</span>');
    expect(html).toContain('<strong>2</strong><span>agents</span>');
    expect(html).toContain('<strong>3</strong><span>decisions</span>');
    expect(html).toContain('<strong>1</strong><span>public events</span>');
    expect(html).not.toContain('Replay Events');
    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
    expect(html).not.toContain('secret reasoning');
    expect(html).not.toContain('private reason');
  });

  it('uses the imported analysis dashboard and shows n/a decisions when analysis is absent', () => {
    const html = renderContent('analysis', null);

    expect(html).toContain('No analysis summary published.');
    expect(html).toContain('<strong>n/a</strong><span>decisions</span>');
    expect(html).not.toContain('Decision Analysis');
  });
});
