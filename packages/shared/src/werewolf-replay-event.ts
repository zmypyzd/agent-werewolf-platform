export type WerewolfReplayEventType =
  | 'match.started'
  | 'agent.action_requested'
  | 'agent.action_received'
  | 'agent.timeout'
  | 'agent.invalid_action'
  | 'engine.action_applied'
  | 'phase.changed'
  | 'match.completed';

export interface WerewolfReplayEvent {
  readonly eventId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly eventType: WerewolfReplayEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}
