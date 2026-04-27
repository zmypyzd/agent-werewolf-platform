import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchAnalysisPanel, type MatchAnalysisSummary } from '../pages/MatchReplayPage.js';

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
  it('renders aggregate and agent decision metrics', () => {
    const html = renderToStaticMarkup(<MatchAnalysisPanel analysis={analysis} loading={false} error={null} />);

    expect(html).toContain('Decision Analysis');
    expect(html).toContain('5 decisions');
    expect(html).toContain('2 agents');
    expect(html).toContain('call');
    expect(html).toContain('fold');
    expect(html).toContain('pot control');
    expect(html).toContain('bot-a');
    expect(html).toContain('31 ms');
  });

  it('does not render private reasoning surfaces', () => {
    const html = renderToStaticMarkup(<MatchAnalysisPanel analysis={analysis} loading={false} error={null} />);

    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
  });
});
