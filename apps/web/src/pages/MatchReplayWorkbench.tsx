import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import {
  REPLAY_STREET_FILTERS,
  buildActionTimeline,
  buildHandReplayViews,
  filterActionTimelineByStreet,
  formatCard,
  formatCountLabel,
  getNextActionId,
  getPreviousActionId,
  resolveActiveReplayStreetFilter,
  resolveSelectedStreetFilter,
  type ActionTimelineItem,
  type ReplayStreetFilter,
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
  const timeline = useMemo(
    () => buildActionTimeline(selectedHand, replayEvents),
    [replayEvents, selectedHand],
  );
  const [streetFilter, setStreetFilter] = useState<ReplayStreetFilter>('all');
  const [isPlaying, setIsPlaying] = useState(false);
  const previousSelectedHandIdRef = useRef<string | null>(selectedHandId);
  const effectiveStreetFilter = resolveActiveReplayStreetFilter(
    streetFilter,
    selectedHandId,
    previousSelectedHandIdRef.current,
  );
  const filteredTimeline = useMemo(
    () => filterActionTimelineByStreet(timeline, effectiveStreetFilter),
    [effectiveStreetFilter, timeline],
  );
  const selectedAction = filteredTimeline.find(action => action.id === selectedActionId)
    ?? filteredTimeline[0]
    ?? null;
  const stackEntries = Object.entries(finalStacks);
  const selectedActionPosition = selectedAction
    ? filteredTimeline.findIndex(action => action.id === selectedAction.id) + 1
    : 0;

  useEffect(() => {
    if (previousSelectedHandIdRef.current === selectedHandId) return;
    previousSelectedHandIdRef.current = selectedHandId;
    setIsPlaying(false);
    setStreetFilter('all');
  }, [selectedHandId]);

  useEffect(() => {
    if (filteredTimeline.length === 0) {
      setIsPlaying(false);
      return;
    }
    if (selectedActionId && filteredTimeline.some(action => action.id === selectedActionId)) return;
    onSelectAction(filteredTimeline[0]!.id);
  }, [filteredTimeline, onSelectAction, selectedActionId]);

  const selectPreviousAction = useCallback(() => {
    const previousActionId = getPreviousActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter);
    if (!previousActionId) return;
    setIsPlaying(false);
    onSelectAction(previousActionId);
  }, [effectiveStreetFilter, onSelectAction, selectedAction?.id, timeline]);

  const selectNextAction = useCallback(() => {
    const nextActionId = getNextActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter);
    if (!nextActionId) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying(false);
    onSelectAction(nextActionId);
  }, [effectiveStreetFilter, onSelectAction, selectedAction?.id, timeline]);

  const handleSelectHand = useCallback((handId: string) => {
    setIsPlaying(false);
    setStreetFilter('all');
    onSelectHand(handId);
  }, [onSelectHand]);

  const handleSelectAction = useCallback((actionId: string) => {
    setIsPlaying(false);
    onSelectAction(actionId);
  }, [onSelectAction]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const intervalId = window.setInterval(() => {
      const currentActionId = selectedActionId && filteredTimeline.some(action => action.id === selectedActionId)
        ? selectedActionId
        : filteredTimeline[0]?.id ?? null;
      const nextActionId = getNextActionId(timeline, currentActionId, effectiveStreetFilter);
      if (!nextActionId) {
        setIsPlaying(false);
        return;
      }
      onSelectAction(nextActionId);
    }, 800);

    return () => window.clearInterval(intervalId);
  }, [effectiveStreetFilter, filteredTimeline, isPlaying, onSelectAction, selectedActionId, timeline]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreReplayKeyboardEvent(event)) return;
      if (event.key === 'ArrowLeft') {
        const previousActionId = getPreviousActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter);
        if (!previousActionId) return;
        event.preventDefault();
        setIsPlaying(false);
        onSelectAction(previousActionId);
      }
      if (event.key === 'ArrowRight') {
        const nextActionId = getNextActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter);
        if (!nextActionId) return;
        event.preventDefault();
        setIsPlaying(false);
        onSelectAction(nextActionId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectiveStreetFilter, onSelectAction, selectedAction?.id, timeline]);

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

      <ReplayControls
        actionCount={filteredTimeline.length}
        isPlaying={isPlaying}
        selectedActionPosition={selectedActionPosition}
        selectedStreetFilter={effectiveStreetFilter}
        canStepBackward={getPreviousActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter) !== null}
        canStepForward={getNextActionId(timeline, selectedAction?.id ?? null, effectiveStreetFilter) !== null}
        onSelectAction={handleSelectAction}
        onSelectStreetFilter={filter => {
          setIsPlaying(false);
          setStreetFilter(filter);
        }}
        onStepBackward={selectPreviousAction}
        onStepForward={selectNextAction}
        onTogglePlay={() => setIsPlaying(current => !current)}
        timeline={filteredTimeline}
      />

      <div className="workbench-grid">
        <HandRail
          handViews={handViews}
          selectedHandId={selectedHandId}
          onSelectHand={handleSelectHand}
        />
        <HandBoard
          hand={selectedHand}
          handView={selectedHandView}
          timeline={filteredTimeline}
          selectedActionId={selectedAction?.id ?? null}
          selectedStreetFilter={effectiveStreetFilter}
          onSelectAction={handleSelectAction}
        />
        <ActionInspector hand={selectedHand} selectedAction={selectedAction} />
      </div>
    </section>
  );
}

function ReplayControls({
  actionCount,
  canStepBackward,
  canStepForward,
  isPlaying,
  selectedActionPosition,
  selectedStreetFilter,
  timeline,
  onSelectAction,
  onSelectStreetFilter,
  onStepBackward,
  onStepForward,
  onTogglePlay,
}: {
  actionCount: number;
  canStepBackward: boolean;
  canStepForward: boolean;
  isPlaying: boolean;
  selectedActionPosition: number;
  selectedStreetFilter: ReplayStreetFilter;
  timeline: ActionTimelineItem[];
  onSelectAction: (actionId: string) => void;
  onSelectStreetFilter: (streetFilter: ReplayStreetFilter) => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  onTogglePlay: () => void;
}) {
  const selectedFilter = resolveSelectedStreetFilter(selectedStreetFilter);

  const handleRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const actionPosition = Number.parseInt(event.currentTarget.value, 10);
    const action = timeline[actionPosition - 1];
    if (action) onSelectAction(action.id);
  };

  return (
    <section aria-label="Replay controls" className="replay-controls">
      <div className="replay-control-row">
        <button
          className="button-secondary replay-control-button"
          disabled={!canStepBackward}
          onClick={onStepBackward}
          type="button"
        >
          Previous
        </button>
        <button
          className="button-secondary replay-control-button"
          disabled={actionCount === 0 || (!isPlaying && !canStepForward)}
          onClick={onTogglePlay}
          type="button"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          className="button-secondary replay-control-button"
          disabled={!canStepForward}
          onClick={onStepForward}
          type="button"
        >
          Next
        </button>
        <label className="action-range-control">
          <span>
            Action {selectedActionPosition || 0} of {actionCount}
          </span>
          <input
            aria-label="Action position"
            disabled={actionCount === 0}
            max={actionCount}
            min={actionCount === 0 ? 0 : 1}
            onChange={handleRangeChange}
            type="range"
            value={selectedActionPosition}
          />
        </label>
      </div>
      <fieldset className="street-filter-group">
        <legend>Street filter</legend>
        {REPLAY_STREET_FILTERS.map(filter => (
          <button
            aria-pressed={filter === selectedFilter}
            className="street-filter-button"
            key={filter}
            onClick={() => onSelectStreetFilter(filter)}
            type="button"
          >
            {formatStreetFilter(filter)}
          </button>
        ))}
      </fieldset>
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
  selectedStreetFilter,
  onSelectAction,
}: {
  hand: HandSummary | null;
  handView: ReturnType<typeof buildHandReplayViews>[number] | null;
  timeline: ActionTimelineItem[];
  selectedActionId: string | null;
  selectedStreetFilter: ReplayStreetFilter;
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
          <p className="muted">{hand.handId}</p>
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
          <p className="muted">{formatTimelineEmptyState(selectedStreetFilter)}</p>
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

function formatStreetFilter(filter: ReplayStreetFilter): string {
  return filter === 'all' ? 'All' : formatCountLabel(filter);
}

function formatTimelineEmptyState(filter: ReplayStreetFilter): string {
  return filter === 'all'
    ? 'No actions recorded.'
    : `No ${formatCountLabel(filter)} actions recorded.`;
}

export function shouldIgnoreReplayKeyboardEvent(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'defaultPrevented' | 'metaKey' | 'shiftKey' | 'target'>,
): boolean {
  return event.defaultPrevented
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || shouldIgnoreReplayKeyboardTarget(event.target);
}

function shouldIgnoreReplayKeyboardTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'SELECT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'BUTTON';
}
