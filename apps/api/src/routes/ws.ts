import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { WebSocket } from 'ws';
import { WsClientMessageSchema } from '@agent-poker/agent-protocol';
import type { HubConnection, RealtimeHub } from '@agent-poker/realtime';
import { LOBBY_TOPIC } from '@agent-poker/realtime';

interface WsRoutesOptions extends FastifyPluginOptions {
  hub: RealtimeHub;
}

export async function wsRoutes(app: FastifyInstance, opts: WsRoutesOptions) {
  const { hub } = opts;

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!req.user) {
      try { socket.send(JSON.stringify({ topic: 'system', type: 'error', payload: { code: 'UNAUTHENTICATED' } })); } catch { /* ignore */ }
      socket.close(1008, 'unauthenticated');
      return;
    }

    const userId = req.user.userId;
    const conn: HubConnection = {
      userId,
      send(json) { (socket as unknown as WebSocket).send(json); },
      close() { socket.close(); },
    };

    socket.on('message', (raw: Buffer | ArrayBuffer | Uint8Array) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = WsClientMessageSchema.safeParse(parsed);
      if (!result.success) return;
      const msg = result.data;

      switch (msg.type) {
        case 'subscribe':
          // Only allow subscriptions to lobby and table:* topics. seat:<userId>:<tableId>
          // is auto-managed server-side and rejects client subscription attempts.
          if (msg.topic === LOBBY_TOPIC || msg.topic.startsWith('table:')) {
            hub.subscribe(conn, msg.topic);
            // Auto-subscribe to the user's seat topic for this table.
            if (msg.topic.startsWith('table:')) {
              const tableId = msg.topic.slice('table:'.length);
              hub.subscribe(conn, `seat:${userId}:${tableId}`);
            }
          }
          break;
        case 'unsubscribe':
          hub.unsubscribe(conn, msg.topic);
          if (msg.topic.startsWith('table:')) {
            const tableId = msg.topic.slice('table:'.length);
            hub.unsubscribe(conn, `seat:${userId}:${tableId}`);
          }
          break;
        case 'ping':
          try { conn.send(JSON.stringify({ topic: msg.topic, type: 'pong', payload: {} })); } catch { /* swallow */ }
          break;
      }
    });

    socket.on('close', () => {
      hub.unsubscribeAll(conn);
    });
    socket.on('error', () => {
      hub.unsubscribeAll(conn);
    });
  });
}
