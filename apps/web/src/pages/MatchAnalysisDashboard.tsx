import type { AgentAnalysisSummary, AnalysisMetricSummary, MatchAnalysisSummary } from '../lib/api.js';
import {
  buildDistributionRows,
  formatCountLabel,
  formatNullableMs,
  formatNullablePercent,
} from '../lib/matchReplayView.js';

interface MatchAnalysisPanelProps {
  analysis: MatchAnalysisSummary | null;
  loading: boolean;
  error: string | null;
}

export function MatchAnalysisPanel({ analysis, loading, error }: MatchAnalysisPanelProps) {
  if (loading) return <p className="muted">Loading analysis...</p>;
  if (error) return <div className="error">{error}</div>;
  if (!analysis) return <p className="muted">No analysis summary published.</p>;

  return (
    <section className="analysis-panel">
      <div className="section-heading">
        <h2>Analysis Dashboard</h2>
        <p className="muted">
          {analysis.decisionCount} decisions · {analysis.agentCount} agents · {analysis.handCount} hands
        </p>
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
      {rows.length === 0 ? (
        <p className="muted">No entries.</p>
      ) : (
        rows.map(row => {
          const width = row.count <= 0 ? 0 : Math.max(4, Math.round(row.percent * 100));

          return (
            <div className="bar-row" key={row.label}>
              <div className="bar-row-label">
                <span>{formatCountLabel(row.label)}</span>
                <span>{row.count}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

function StreetActionMatrix({ streetCounts }: { streetCounts: Record<string, Record<string, number>> }) {
  const rows = Object.entries(streetCounts).flatMap(([street, counts]) =>
    buildDistributionRows(counts).map(row => ({ street, action: row.label, count: row.count })),
  );

  return (
    <section className="analysis-card">
      <h3>Street / Action Matrix</h3>
      {rows.length === 0 ? (
        <p className="muted">No street actions.</p>
      ) : (
        <div className="matrix-list">
          {rows.map(row => (
            <div className="matrix-row" key={`${row.street}:${row.action}`}>
              <span>{formatCountLabel(row.street)}</span>
              <span>{formatCountLabel(row.action)}</span>
              <strong>{row.count}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AgentComparison({ agents }: { agents: AgentAnalysisSummary[] }) {
  return (
    <section className="agent-comparison">
      <div className="section-heading">
        <h3>Agent Comparison</h3>
      </div>
      {agents.length === 0 ? (
        <p className="muted">No agent metrics.</p>
      ) : (
        <div className="agent-card-grid">
          {agents.map(agent => (
            <article className="agent-card" key={agent.agentId}>
              <div className="agent-card-header">
                <h4>{agent.agentId}</h4>
                <span className="muted">{agent.decisionCount} decisions</span>
              </div>
              <div className="agent-metrics">
                <MetricLabel label="avg latency" value={formatNullableMs(agent.averageLatencyMs)} />
                <MetricLabel label="max latency" value={formatNullableMs(agent.maxLatencyMs)} />
                <MetricLabel label="timeouts" value={agent.timeoutCount} />
                <MetricLabel label="invalid" value={agent.invalidActionCount} />
                <MetricLabel label="fallbacks" value={agent.fallbackCount} />
                <MetricLabel label="missing reasoning" value={agent.missingReasoningCount} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MetricLabel({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
