// Re-export the Zod envelope schemas so consumers can import them from one
// place without taking a transitive dep on @agent-poker/agent-protocol.
export {
  WsClientMessageSchema,
  WsServerMessageSchema,
} from '@agent-poker/agent-protocol';

export type Topic = 'lobby' | `table:${string}` | `seat:${string}:${string}`;

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
