import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, type MatchAnalysisSummary } from '../lib/api.js';
import type { MatchArtifactRecord, ReplayEvent } from '../lib/matchArtifacts.js';
import { buildActionTimeline } from '../lib/matchReplayView.js';
import { MatchAnalysisPanel } from './MatchAnalysisDashboard.js';
import { ReplayWorkbench } from './MatchReplayWorkbench.js';

type MatchReplayTab = 'replay' | 'analysis';

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function ReplayNavigationLinks() {
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <Link to="/matches">Back to matches</Link>
      <Link to="/lobby">Lobby</Link>
    </div>
  );
}

interface MatchReplayPageContentProps {
  record: MatchArtifactRecord;
  replayEvents: ReplayEvent[];
  analysis: MatchAnalysisSummary | null;
  activeTab: MatchReplayTab;
  selectedHandId: string | null;
  selectedActionId: string | null;
  replayLoading: boolean;
  replayError: string | null;
  analysisLoading: boolean;
  analysisError: string | null;
  onSelectTab: (tab: MatchReplayTab) => void;
  onSelectHand: (handId: string) => void;
  onSelectAction: (actionId: string) => void;
}

export function MatchReplayPageContent({
  record,
  replayEvents,
  analysis,
  activeTab,
  selectedHandId,
  selectedActionId,
  replayLoading,
  replayError,
  analysisLoading,
  analysisError,
  onSelectTab,
  onSelectHand,
  onSelectAction,
}: MatchReplayPageContentProps) {
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{record.summary.name}</h1>
        <div className="row">
          <Link to="/matches">Match replays</Link>
          <Link to="/lobby">Lobby</Link>
        </div>
      </div>

      <p className="muted" style={{ overflowWrap: 'anywhere' }}>
        match {record.summary.matchId}
        {' · '}completed {formatTime(record.summary.completedAt)}
      </p>

      <div aria-label="Match summary" className="match-summary-strip">
        <div>
          <strong>{record.summary.hands.length}</strong>
          <span>hands</span>
        </div>
        <div>
          <strong>{record.summary.agentIds.length}</strong>
          <span>agents</span>
        </div>
        <div>
          <strong>{analysis?.decisionCount ?? 'n/a'}</strong>
          <span>decisions</span>
        </div>
        <div>
          <strong>{replayEvents.length}</strong>
          <span>public events</span>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Match detail views">
        <button
          type="button"
          id="match-replay-tab"
          role="tab"
          aria-selected={activeTab === 'replay'}
          aria-controls="match-replay-panel"
          onClick={() => onSelectTab('replay')}
        >
          Replay
        </button>
        <button
          type="button"
          id="match-analysis-tab"
          role="tab"
          aria-selected={activeTab === 'analysis'}
          aria-controls="match-analysis-panel"
          onClick={() => onSelectTab('analysis')}
        >
          Analysis
        </button>
      </div>

      {activeTab === 'replay' ? (
        <div
          id="match-replay-panel"
          role="tabpanel"
          aria-labelledby="match-replay-tab"
        >
          <ReplayWorkbench
            hands={record.summary.hands}
            replayEvents={replayEvents}
            finalStacks={record.summary.finalStacks}
            selectedHandId={selectedHandId}
            selectedActionId={selectedActionId}
            replayLoading={replayLoading}
            replayError={replayError}
            onSelectHand={onSelectHand}
            onSelectAction={onSelectAction}
          />
        </div>
      ) : null}

      {activeTab === 'analysis' ? (
        <div
          id="match-analysis-panel"
          role="tabpanel"
          aria-labelledby="match-analysis-tab"
        >
          <MatchAnalysisPanel
            analysis={analysis}
            loading={analysisLoading}
            error={analysisError}
          />
        </div>
      ) : null}

      <section className="artifact-metadata">
        <h2>Artifact Metadata</h2>
        <dl>
          <div>
            <dt>Created</dt>
            <dd>{formatTime(record.manifest.createdAt)}</dd>
          </div>
          <div>
            <dt>Hands</dt>
            <dd>{record.manifest.handIds.length}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function MatchReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [record, setRecord] = useState<MatchArtifactRecord | null>(null);
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([]);
  const [analysis, setAnalysis] = useState<MatchAnalysisSummary | null>(null);
  const [activeTab, setActiveTab] = useState<MatchReplayTab>('replay');
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replayLoading, setReplayLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    setLoading(true);
    setReplayLoading(true);
    setAnalysisLoading(true);
    setError(null);
    setReplayError(null);
    setAnalysisError(null);
    setRecord(null);
    setReplayEvents([]);
    setAnalysis(null);
    setSelectedHandId(null);
    setSelectedActionId(null);

    api.get<MatchArtifactRecord | null>(`/matches/${matchId}`)
      .then(data => {
        if (!alive) return;
        setRecord(data);
        setSelectedHandId(data?.summary.hands[0]?.handId ?? data?.summary.handIds[0] ?? null);
        setError(null);
      })
      .catch(e => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load match');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    api.get<ReplayEvent[]>(`/matches/${matchId}/replay`)
      .then(data => {
        if (!alive) return;
        setReplayEvents(data);
        setReplayError(null);
      })
      .catch(e => {
        if (!alive) return;
        setReplayError(e instanceof ApiError ? e.message : 'Failed to load replay events');
      })
      .finally(() => {
        if (alive) setReplayLoading(false);
      });

    api.getMatchAnalysis(matchId)
      .then(data => {
        if (!alive) return;
        setAnalysis(data);
        setAnalysisError(null);
      })
      .catch(e => {
        if (!alive) return;
        setAnalysisError(e instanceof ApiError ? e.message : 'Failed to load analysis');
      })
      .finally(() => {
        if (alive) setAnalysisLoading(false);
      });

    return () => { alive = false; };
  }, [matchId]);

  const selectedHand = useMemo(() => {
    if (!record || !selectedHandId) return null;
    return record.summary.hands.find(hand => hand.handId === selectedHandId) ?? null;
  }, [record, selectedHandId]);

  const selectedEvents = useMemo(() => {
    if (!selectedHand) return [];
    return replayEvents.filter(event => event.handId === selectedHand.handId);
  }, [replayEvents, selectedHand]);

  const selectedTimeline = useMemo(
    () => buildActionTimeline(selectedHand, selectedEvents),
    [selectedEvents, selectedHand],
  );

  useEffect(() => {
    const hasSelectedAction = selectedActionId !== null
      && selectedTimeline.some(action => action.id === selectedActionId);
    if (hasSelectedAction) return;

    const nextActionId = selectedTimeline[0]?.id ?? null;
    if (selectedActionId !== nextActionId) {
      setSelectedActionId(nextActionId);
    }
  }, [selectedActionId, selectedTimeline]);

  const handleSelectHand = useCallback((handId: string) => {
    setSelectedHandId(handId);
    const nextHand = record?.summary.hands.find(hand => hand.handId === handId) ?? null;
    const nextEvents = replayEvents.filter(event => event.handId === handId);
    const nextTimeline = buildActionTimeline(nextHand, nextEvents);
    setSelectedActionId(nextTimeline[0]?.id ?? null);
  }, [record, replayEvents]);

  const handleSelectAction = useCallback((actionId: string) => {
    setSelectedActionId(actionId);
  }, []);

  const handleSelectTab = useCallback((tab: MatchReplayTab) => {
    setActiveTab(tab);
  }, []);

  if (!matchId) {
    return (
      <div className="page">
        <div>Missing match id.</div>
        <ReplayNavigationLinks />
      </div>
    );
  }
  if (loading) return <div className="page">Loading match...</div>;
  if (error) {
    return (
      <div className="page">
        <div className="error">{error}</div>
        <ReplayNavigationLinks />
      </div>
    );
  }
  if (!record) {
    return (
      <div className="page">
        <div>Match not found.</div>
        <ReplayNavigationLinks />
      </div>
    );
  }

  return (
    <MatchReplayPageContent
      record={record}
      replayEvents={replayEvents}
      analysis={analysis}
      activeTab={activeTab}
      selectedHandId={selectedHandId}
      selectedActionId={selectedActionId}
      replayLoading={replayLoading}
      replayError={replayError}
      analysisLoading={analysisLoading}
      analysisError={analysisError}
      onSelectTab={handleSelectTab}
      onSelectHand={handleSelectHand}
      onSelectAction={handleSelectAction}
    />
  );
}
