// Re-export the Zod envelope schemas so consumers can import them from one
// place without taking a transitive dep on @agent-poker/agent-protocol.
export {
  WsClientMessageSchema,
  WsServerMessageSchema,
} from '@agent-poker/agent-protocol';

export type Topic =
  | 'lobby'
  | `table:${string}`
  | `seat:${string}:${string}`
  | `match:${string}`
  | `player:${string}:${string}`;

export interface WsServerMessage {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface WsClientMessage {
  topic: string;
  type: 'subscribe' | 'unsubscribe' | 'ping';
  payload: Record<string, unknown>;
}

export const LOBBY_TOPIC = 'lobby' as const;

export function tableTopic(tableId: string): string {
  return `table:${tableId}`;
}

export function seatTopic(userId: string, tableId: string): string {
  return `seat:${userId}:${tableId}`;
}

export function werewolfMatchTopic(gameId: string): string {
  return `match:${gameId}`;
}

export function werewolfPlayerTopic(userId: string, gameId: string): string {
  return `player:${userId}:${gameId}`;
}

// Presence topic for an externally-registered agent's WS connection. Public —
// the agentId is a UUID, so leaking presence via guessing is bounded by
// brute-forcing the namespace. Lobby/agent-management UIs subscribe here to
// surface "online" indicators driven by AgentConnectionRegistry.
export function agentStatusTopic(agentId: string): string {
  return `agent.status:${agentId}`;
}

export const AGENT_STATUS_TOPIC_PREFIX = 'agent.status:' as const;
