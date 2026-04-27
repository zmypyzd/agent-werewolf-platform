import type { WsServerMessage } from './wire.js';
import { LOBBY_TOPIC, seatTopic, tableTopic } from './wire.js';

export interface HubConnection {
  // The client identifier for the lifetime of this connection. Set by the
  // /ws route after authenticating the cookie.
  readonly userId: string;
  // Send a JSON-encoded payload. Implementations may close the connection
  // on send failure; the hub treats a thrown send as a hint to drop the
  // connection from every topic it was subscribed to.
  send(json: string): void;
  // Optional. Called by the hub to forcibly close a misbehaving client.
  close?(): void;
}

export class RealtimeHub {
  private topics = new Map<string, Set<HubConnection>>();
  private connectionTopics = new WeakMap<HubConnection, Set<string>>();

  subscribe(connection: HubConnection, topic: string): void {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(connection);

    let topicsForConn = this.connectionTopics.get(connection);
    if (!topicsForConn) {
      topicsForConn = new Set();
      this.connectionTopics.set(connection, topicsForConn);
    }
    topicsForConn.add(topic);
  }

  unsubscribe(connection: HubConnection, topic: string): void {
    const set = this.topics.get(topic);
    if (set) {
      set.delete(connection);
      if (set.size === 0) this.topics.delete(topic);
    }
    this.connectionTopics.get(connection)?.delete(topic);
  }

  unsubscribeAll(connection: HubConnection): void {
    const topics = this.connectionTopics.get(connection);
    if (!topics) return;
    for (const t of topics) {
      const set = this.topics.get(t);
      if (set) {
        set.delete(connection);
        if (set.size === 0) this.topics.delete(t);
      }
    }
    this.connectionTopics.delete(connection);
  }

  publish(topic: string, message: WsServerMessage): void {
    const set = this.topics.get(topic);
    if (!set) return;
    const json = JSON.stringify(message);
    for (const conn of set) {
      try {
        conn.send(json);
      } catch {
        this.unsubscribeAll(conn);
        try { conn.close?.(); } catch { /* swallow */ }
      }
    }
  }

  publishLobby(type: string, payload: Record<string, unknown>): void {
    this.publish(LOBBY_TOPIC, { topic: LOBBY_TOPIC, type, payload });
  }

  publishTable(tableId: string, type: string, payload: Record<string, unknown>): void {
    const topic = tableTopic(tableId);
    this.publish(topic, { topic, type, payload });
  }

  publishSeat(userId: string, tableId: string, type: string, payload: Record<string, unknown>): void {
    const topic = seatTopic(userId, tableId);
    this.publish(topic, { topic, type, payload });
  }

  topicCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0;
  }
}
