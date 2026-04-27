import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import {
  buildActionTimeline,
  buildHandReplayViews,
  formatCard,
  formatCountLabel,
  type ActionTimelineItem,
} from '../lib/matchReplayView.js';

export interface ReplayWorkbenchProps {
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
  const selectedHandView = handViews.find(hand => hand.handId === selectedHand?.handId) ?? null;
  const timeline = buildActionTimeline(selectedHand, replayEvents);
  const selectedAction = timeline.find(action => action.id === selectedActionId) ?? timeline[0] ?? null;
  const stackEntries = Object.entries(finalStacks);

  return (
    <section className="workbench-panel">
      <div>
        <h2>Replay Workbench</h2>
        <p className="muted">
          Review public hand flow, board texture, stack outcomes, and aggregate action context.
        </p>
      </div>

      {replayError ? <div className="error">{replayError}</div> : null}
      {replayLoading ? <p className="muted">Loading replay events...</p> : null}

      <div aria-label="Final stacks" className="stack-strip">
        {stackEntries.length === 0 ? (
          <p className="muted">No final stacks recorded.</p>
        ) : (
          stackEntries.map(([playerId, stack]) => (
            <div className="stack-card" key={playerId}>
              <strong>{playerId}</strong>
              <span>{stack}</span>
            </div>
          ))
        )}
      </div>

      <div className="workbench-grid">
        <HandRail
          handViews={handViews}
          selectedHandId={selectedHandId}
          onSelectHand={onSelectHand}
        />
        <HandBoard
          hand={selectedHand}
          handView={selectedHandView}
          timeline={timeline}
          selectedActionId={selectedAction?.id ?? null}
          onSelectAction={onSelectAction}
        />
        <ActionInspector hand={selectedHand} selectedAction={selectedAction} />
      </div>
    </section>
  );
}

function HandRail({
  handViews,
  selectedHandId,
  onSelectHand,
}: {
  handViews: ReturnType<typeof buildHandReplayViews>;
  selectedHandId: string | null;
  onSelectHand: (handId: string) => void;
}) {
  return (
    <aside aria-label="Hands" className="hand-rail">
      <h3>Hands</h3>
      {handViews.length === 0 ? (
        <p className="muted">No hands recorded.</p>
      ) : (
        handViews.map(hand => (
          <button
            aria-pressed={hand.handId === selectedHandId}
            className="hand-rail-item"
            key={hand.handId}
            onClick={() => onSelectHand(hand.handId)}
            type="button"
          >
            <strong>Hand {hand.handNumber}</strong>
            <span>{hand.actionCount} actions</span>
            <span>{hand.eventCount} events</span>
            <span>{hand.communityCardCount} board cards</span>
            <span>
              {hand.biggestNetChange === null ? 'no net result' : `biggest net ${hand.biggestNetChange}`}
            </span>
          </button>
        ))
      )}
    </aside>
  );
}

function HandBoard({
  hand,
  handView,
  timeline,
  selectedActionId,
  onSelectAction,
}: {
  hand: HandSummary | null;
  handView: ReturnType<typeof buildHandReplayViews>[number] | null;
  timeline: ActionTimelineItem[];
  selectedActionId: string | null;
  onSelectAction: (actionId: string) => void;
}) {
  if (!hand) {
    return (
      <div className="hand-board">
        <h3>No hand selected.</h3>
        <p className="muted">Select a hand from the rail to inspect its public replay.</p>
      </div>
    );
  }

  return (
    <div className="hand-board">
      <div className="hand-board-header">
        <div>
          <h3>Hand {hand.handNumber}</h3>
          <p className="muted">Seed {hand.seed}</p>
        </div>
        <span className="pill">{handView?.actionCount ?? hand.allActions.length} actions</span>
      </div>

      <div>
        <h4>Board</h4>
        <div aria-label="Community cards" className="community-row">
          {hand.communityCards.length === 0 ? (
            <span className="muted">No community cards.</span>
          ) : (
            hand.communityCards.map((card, index) => (
              <span className="card-chip" key={`${card.rank}${card.suit}:${index}`}>
                {formatCard(card)}
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <h4>Results</h4>
        <div className="result-grid">
          {hand.results.length === 0 ? (
            <p className="muted">No results recorded.</p>
          ) : (
            hand.results.map(result => (
              <div className="result-card" key={`${result.playerId}:${result.potIndex}`}>
                <strong>{result.playerId}</strong>
                <span>Pot {result.potIndex}</span>
                <span>Won {result.winAmount}</span>
                <span>Net {result.netChange}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="action-timeline">
        <h4>Action Timeline</h4>
        {timeline.length === 0 ? (
          <p className="muted">No actions recorded.</p>
        ) : (
          timeline.map(action => (
            <button
              aria-pressed={action.id === selectedActionId}
              className="timeline-row"
              key={action.id}
              onClick={() => onSelectAction(action.id)}
              type="button"
            >
              <span>{action.ordinal}</span>
              <strong>{action.playerId}</strong>
              <span>{formatCountLabel(action.actionType)}</span>
              <span>{formatTimelineAmount(action.amount)}</span>
              <span>{action.street ? formatCountLabel(action.street) : 'unknown'}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ActionInspector({
  hand,
  selectedAction,
}: {
  hand: HandSummary | null;
  selectedAction: ActionTimelineItem | null;
}) {
  return (
    <aside className="action-inspector">
      <h3>Selected Action</h3>
      {!hand ? <p className="muted">No hand selected.</p> : null}
      {hand && !selectedAction ? <p className="muted">No action selected.</p> : null}
      {selectedAction ? (
        <dl>
          <div>
            <dt>Player</dt>
            <dd>{selectedAction.playerId}</dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd>{formatCountLabel(selectedAction.actionType)}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{formatInspectorAmount(selectedAction.amount)}</dd>
          </div>
          <div>
            <dt>Street</dt>
            <dd>{selectedAction.street ? formatCountLabel(selectedAction.street) : 'unknown'}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{selectedAction.eventId ?? selectedAction.eventType ?? 'No linked event'}</dd>
          </div>
        </dl>
      ) : null}
      <p className="muted">Only aggregate analysis is available for this action.</p>
    </aside>
  );
}

function formatTimelineAmount(amount: number): string {
  return amount === 0 ? '' : String(amount);
}

function formatInspectorAmount(amount: number): string {
  return amount === 0 ? 'n/a' : String(amount);
}
