import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

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

export function MatchReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [record, setRecord] = useState<MatchArtifactRecord | null>(null);
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([]);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replayLoading, setReplayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    setLoading(true);
    setReplayLoading(true);
    setError(null);
    setReplayError(null);
    setRecord(null);
    setReplayEvents([]);
    setSelectedHandId(null);

    api.get<MatchArtifactRecord | null>(`/matches/${matchId}`)
      .then(data => {
        if (!alive) return;
        setRecord(data);
        setSelectedHandId(data?.summary.handIds[0] || null);
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

    return () => { alive = false; };
  }, [matchId]);

  const selectedHand = useMemo(() => {
    if (!record || !selectedHandId) return null;
    return record.summary.hands.find(hand => hand.handId === selectedHandId) || null;
  }, [record, selectedHandId]);

  const selectedEvents = useMemo(() => {
    if (!record || !selectedHandId) return [];
    return replayEvents.filter(event => event.handId === selectedHandId);
  }, [record, replayEvents, selectedHandId]);
  const selectedCommunityCards = selectedHand?.communityCards ?? [];
  const selectedActions = selectedHand?.allActions ?? [];
  const selectedResults = selectedHand?.results ?? [];

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
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{record.summary.name}</h1>
        <div className="row">
          <Link to="/matches">Match replays</Link>
          <Link to="/lobby">Lobby</Link>
        </div>
      </div>

      <p className="muted" style={{ overflowWrap: 'anywhere' }}>
        match {record.summary.matchId}
        {' · '}seed {record.summary.seed}
        {' · '}completed {formatTime(record.summary.completedAt)}
      </p>

      <section style={{ marginTop: 16 }}>
        <h2>Final Stacks</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(record.summary.finalStacks).map(([agentId, stack]) => (
            <span key={agentId} style={{ border: '1px solid #ccc', borderRadius: 4, padding: '6px 8px' }}>
              {agentId}: {stack}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Hands</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {record.summary.hands.map(hand => (
            <button
              key={hand.handId}
              onClick={() => setSelectedHandId(hand.handId)}
              style={{
                border: hand.handId === selectedHandId ? '2px solid #222' : '1px solid #bbb',
              }}
            >
              Hand {hand.handNumber}
            </button>
          ))}
          {record.summary.hands.length === 0 && (
            <span className="muted">No hands recorded.</span>
          )}
        </div>
      </section>

      {selectedHand && (
        <section style={{ marginTop: 16 }}>
          <h2>Hand {selectedHand.handNumber}</h2>
          <p className="muted">seed {selectedHand.seed}</p>
          <div>
            Community:{' '}
            {selectedCommunityCards.length === 0
              ? 'none'
              : selectedCommunityCards.map(formatCard).join(' ')}
          </div>
          <h3>Actions</h3>
          {selectedActions.length === 0 ? (
            <p className="muted">No actions recorded for this hand.</p>
          ) : (
            <ol>
              {selectedActions.map((action, index) => (
                <li key={index}>
                  {action.playerId} {action.actionType}
                  {action.amount > 0 ? ` ${action.amount}` : ''}
                </li>
              ))}
            </ol>
          )}
          <h3>Results</h3>
          {selectedResults.length === 0 ? (
            <p className="muted">No results recorded for this hand.</p>
          ) : (
            <ul>
              {selectedResults.map((result, index) => (
                <li key={index}>
                  {result.playerId}: win {result.winAmount}, net {result.netChange}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <h2>Replay Events</h2>
        {replayError && <div className="error">{replayError}</div>}
        <ol
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            background: '#fafafa',
            border: '1px solid #ddd',
            padding: '8px 24px',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          {selectedEvents.map(event => (
            <li key={event.eventId}>
              #{event.sequence} {event.eventType}
            </li>
          ))}
          {replayLoading && (
            <li className="muted">Loading replay events...</li>
          )}
          {selectedHand && !replayLoading && selectedEvents.length === 0 && (
            <li className="muted">No replay events recorded for this hand.</li>
          )}
          {!selectedHand && (
            <li className="muted">No hand selected.</li>
          )}
        </ol>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Artifact</h2>
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>
          summary sha256 {record.manifest.files.summary.sha256}
          <br />
          replay sha256 {record.manifest.files.replay.sha256}
        </p>
      </section>
    </div>
  );
}
