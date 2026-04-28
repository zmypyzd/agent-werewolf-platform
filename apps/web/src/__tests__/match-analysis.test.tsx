import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentAnalysisSummary, MatchAnalysisSummary } from '../lib/api.js';
import {
  MatchAnalysisPanel,
  sortAgentAnalysisSummaries,
} from '../pages/MatchAnalysisDashboard.js';

function hasClassToken(html: string, className: string): boolean {
  return [...html.matchAll(/class="([^"]+)"/g)]
    .some(match => match[1]!.split(/\s+/).includes(className));
}

function getStylesForClass(html: string, className: string): string[] {
  return [...html.matchAll(/<[^>]*class="([^"]+)"[^>]*style="([^"]*)"[^>]*>/g)]
    .filter(match => match[1]!.split(/\s+/).includes(className))
    .map(match => match[2]!);
}

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
  agents: [
    {
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
    },
    {
      agentId: 'bot-b',
      playerIds: ['player-b'],
      handIds: ['hand-1'],
      decisionCount: 2,
      actionCounts: { fold: 2 },
      streetCounts: { preflop: { fold: 1 }, flop: { fold: 1 } },
      intentCounts: { value: 1 },
      riskCounts: { medium: 1 },
      missingReasoningCount: 0,
      timeoutCount: 1,
      invalidActionCount: 1,
      fallbackCount: 1,
      averageConfidence: 0.6,
      averageLatencyMs: 45,
      maxLatencyMs: 77,
    },
  ],
};

const sortingAgents: AgentAnalysisSummary[] = [
  {
    ...analysis.agents[0]!,
    agentId: 'alpha',
    decisionCount: 7,
    averageLatencyMs: 20,
    timeoutCount: 1,
    invalidActionCount: 0,
    fallbackCount: 2,
    missingReasoningCount: 3,
  },
  {
    ...analysis.agents[0]!,
    agentId: 'bravo',
    decisionCount: 2,
    averageLatencyMs: 90,
    timeoutCount: 3,
    invalidActionCount: 4,
    fallbackCount: 0,
    missingReasoningCount: 1,
  },
  {
    ...analysis.agents[0]!,
    agentId: 'charlie',
    decisionCount: 7,
    averageLatencyMs: null,
    timeoutCount: 0,
    invalidActionCount: 2,
    fallbackCount: 5,
    missingReasoningCount: 4,
  },
];

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
    expect(html).toContain('Sort agents by');
    expect(html).toContain('Decision count');
    expect(html).toContain('bot-a');
    expect(html).toContain('31 ms');
  });

  it('renders required dashboard class names and distribution bar widths', () => {
    const narrowDistributionAnalysis: MatchAnalysisSummary = {
      ...analysis,
      totals: {
        ...analysis.totals,
        actionCounts: { common: 999, rare: 1, none: 0 },
      },
    };
    const html = renderToStaticMarkup(
      <MatchAnalysisPanel analysis={narrowDistributionAnalysis} loading={false} error={null} />,
    );

    [
      'analysis-panel',
      'section-heading',
      'metric-grid',
      'analysis-dashboard-grid',
      'analysis-card',
      'bar-row',
      'bar-row-label',
      'bar-track',
      'bar-fill',
      'matrix-list',
      'matrix-row',
      'agent-comparison',
      'agent-card-grid',
      'agent-card',
      'agent-card-header',
      'agent-metrics',
      'metric-warning',
    ].forEach(className => {
      expect(hasClassToken(html, className)).toBe(true);
    });
    expect(html).toContain('rare');
    expect(html).toContain('none');
    expect(getStylesForClass(html, 'bar-fill')).toEqual(
      expect.arrayContaining(['width:4%', 'width:0%']),
    );
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

  it('sorts agent analysis summaries by supported metrics without mutating input', () => {
    expect(sortAgentAnalysisSummaries(sortingAgents, 'decisionCount').map(agent => agent.agentId))
      .toEqual(['alpha', 'charlie', 'bravo']);
    expect(sortAgentAnalysisSummaries(sortingAgents, 'averageLatencyMs').map(agent => agent.agentId))
      .toEqual(['bravo', 'alpha', 'charlie']);
    expect(sortAgentAnalysisSummaries(sortingAgents, 'timeoutCount').map(agent => agent.agentId))
      .toEqual(['bravo', 'alpha', 'charlie']);
    expect(sortAgentAnalysisSummaries(sortingAgents, 'invalidActionCount').map(agent => agent.agentId))
      .toEqual(['bravo', 'charlie', 'alpha']);
    expect(sortAgentAnalysisSummaries(sortingAgents, 'fallbackCount').map(agent => agent.agentId))
      .toEqual(['charlie', 'alpha', 'bravo']);
    expect(sortAgentAnalysisSummaries(sortingAgents, 'missingReasoningCount').map(agent => agent.agentId))
      .toEqual(['charlie', 'alpha', 'bravo']);
    expect(sortingAgents.map(agent => agent.agentId)).toEqual(['alpha', 'bravo', 'charlie']);
  });
});
