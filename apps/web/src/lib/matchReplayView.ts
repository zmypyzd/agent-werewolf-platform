import type {
  ActionType,
  Card,
  HandPhase,
  HandSummary,
  PublicHandAction,
  ReplayEvent,
  Suit,
} from './matchArtifacts.js';

const SUIT_GLYPH: Record<Suit, string> = { s: 'S', h: 'H', d: 'D', c: 'C' };
const HAND_PHASE_VALUES: readonly HandPhase[] = [
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
  'complete',
];
const HAND_PHASES = new Set<HandPhase>(HAND_PHASE_VALUES);

export type ReplayStreetFilter = 'all' | HandPhase;
export const REPLAY_STREET_FILTERS: readonly ReplayStreetFilter[] = ['all', ...HAND_PHASE_VALUES];

export interface HandReplayView {
  handId: string;
  handNumber: number;
  actionCount: number;
  eventCount: number;
  communityCardCount: number;
  biggestNetChange: number | null;
}

export interface ActionTimelineItem {
  id: string;
  eventId: string | null;
  ordinal: number;
  playerId: string;
  actionType: ActionType;
  amount: number;
  street: HandPhase | null;
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
  const eventCountsByHandId = replayEvents.reduce((counts, event) => {
    counts.set(event.handId, (counts.get(event.handId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return hands.map(hand => {
    const actionCount = hand.allActions.length;
    const eventCount = eventCountsByHandId.get(hand.handId) ?? 0;
    const communityCardCount = hand.communityCards.length;
    const netChanges = hand.results.map(result => Math.abs(result.netChange));
    const biggestNetChange = netChanges.length === 0 ? null : Math.max(...netChanges);

    return {
      handId: hand.handId,
      handNumber: hand.handNumber,
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
  const appliedEvents = handEvents.filter(event => event.eventType === 'action.applied');
  const actionEvents = matchAppliedEvents(hand.allActions, appliedEvents);

  return hand.allActions.map((action, index) => {
    const event = actionEvents[index] ?? null;
    return {
      id: `${hand.handId}:${index}`,
      eventId: event?.eventId ?? null,
      ordinal: index + 1,
      playerId: action.playerId,
      actionType: action.actionType,
      amount: action.amount,
      street: action.phase ?? (event ? extractStreet(event) : null),
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

export function resolveSelectedStreetFilter(value: unknown): ReplayStreetFilter {
  if (value === 'all') return 'all';
  return isHandPhase(value) ? value : 'all';
}

export function resolveActiveReplayStreetFilter(
  streetFilter: ReplayStreetFilter,
  selectedHandId: string | null,
  previousSelectedHandId: string | null,
): ReplayStreetFilter {
  if (selectedHandId !== previousSelectedHandId) return 'all';
  return resolveSelectedStreetFilter(streetFilter);
}

export function filterActionTimelineByStreet(
  timeline: ActionTimelineItem[],
  streetFilter: ReplayStreetFilter,
): ActionTimelineItem[] {
  const selectedStreet = resolveSelectedStreetFilter(streetFilter);
  if (selectedStreet === 'all') return timeline;
  return timeline.filter(action => action.street === selectedStreet);
}

export function getPreviousActionId(
  timeline: ActionTimelineItem[],
  selectedActionId: string | null,
  streetFilter: ReplayStreetFilter = 'all',
): string | null {
  if (!selectedActionId) return null;
  const filteredTimeline = filterActionTimelineByStreet(timeline, streetFilter);
  const selectedIndex = filteredTimeline.findIndex(action => action.id === selectedActionId);
  if (selectedIndex <= 0) return null;
  return filteredTimeline[selectedIndex - 1]?.id ?? null;
}

export function getNextActionId(
  timeline: ActionTimelineItem[],
  selectedActionId: string | null,
  streetFilter: ReplayStreetFilter = 'all',
): string | null {
  if (!selectedActionId) return null;
  const filteredTimeline = filterActionTimelineByStreet(timeline, streetFilter);
  const selectedIndex = filteredTimeline.findIndex(action => action.id === selectedActionId);
  if (selectedIndex < 0) return null;
  return filteredTimeline[selectedIndex + 1]?.id ?? null;
}

function matchAppliedEvents(
  actions: PublicHandAction[],
  appliedEvents: ReplayEvent[],
): Array<ReplayEvent | null> {
  const exactMatches = new Map<number, ReplayEvent>();
  const reservedEvents = new Set<ReplayEvent>();
  const usedEvents = new Set<ReplayEvent>();

  actions.forEach((action, actionIndex) => {
    const event = appliedEvents.find(candidate =>
      !reservedEvents.has(candidate) && candidate.data.actionId === action.actionId,
    );
    if (!event) return;
    exactMatches.set(actionIndex, event);
    reservedEvents.add(event);
  });

  let fallbackIndex = 0;
  return actions.map((_, actionIndex) => {
    const exactMatch = exactMatches.get(actionIndex);
    if (exactMatch) {
      usedEvents.add(exactMatch);
      return exactMatch;
    }

    while (
      fallbackIndex < appliedEvents.length
      && (usedEvents.has(appliedEvents[fallbackIndex]!)
        || reservedEvents.has(appliedEvents[fallbackIndex]!))
    ) {
      fallbackIndex += 1;
    }

    const event = appliedEvents[fallbackIndex] ?? null;
    if (event) {
      usedEvents.add(event);
      fallbackIndex += 1;
    }

    return event;
  });
}

function extractStreet(event: ReplayEvent): HandPhase | null {
  const street = event.data.street ?? event.data.phase;
  return isHandPhase(street) ? street : null;
}

function isHandPhase(value: unknown): value is HandPhase {
  return typeof value === 'string' && HAND_PHASES.has(value as HandPhase);
}
