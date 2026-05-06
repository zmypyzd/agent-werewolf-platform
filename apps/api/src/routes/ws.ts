import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { WebSocket } from 'ws';
import { WsClientMessageSchema } from '@agent-poker/agent-protocol';
import type { HubConnection, RealtimeHub } from '@agent-poker/realtime';
import { LOBBY_TOPIC } from '@agent-poker/realtime';

interface WsRoutesOptions extends FastifyPluginOptions {
  hub: RealtimeHub;
}

const PLAYER_TOPIC_PREFIX = 'player:';

function isOwnPlayerTopic(topic: string, userId: string): boolean {
  // 'player:<userId>:<gameId>' — the userId segment must equal the
  // authenticated userId. Slice + indexOf instead of split, so a malformed
  // gameId containing ":" cannot fool the gate.
  if (!topic.startsWith(PLAYER_TOPIC_PREFIX)) return false;
  const rest = topic.slice(PLAYER_TOPIC_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return false;
  if (colon === rest.length - 1) return false; // empty gameId
  return rest.slice(0, colon) === userId;
}

export async function wsRoutes(app: FastifyInstance, opts: WsRoutesOptions) {
  const { hub } = opts;

  app.get('/ws', { websocket: true }, (socket, req) => {
    // Anonymous connections are allowed. Auth is enforced PER-TOPIC on
    // subscribe instead of as an upgrade-time gate, so spectator clients
    // that only watch public match/table data can connect without a session.
    //
    // Topic visibility model:
    //   - LOBBY_TOPIC      — public (mirrors GET /tables list)
    //   - 'table:<id>'     — public poker table view
    //   - 'match:<id>'     — public werewolf match view (already filtered
    //                        to public payloads via werewolfReplayEventToPublic)
    //   - 'player:<uid>:*' — private; requires authenticated session
    //                        whose userId matches the topic prefix
    //   - 'seat:<uid>:*'   — private hole-cards path; auto-subscribed when
    //                        an authed user subscribes to 'table:<id>'
    //
    // No new information disclosure: every public topic above is already
    // reachable via an unauthenticated REST endpoint that returns the same
    // data. The change is consistency between WS and REST, not a relaxation.
    const authedUserId = req.user?.userId ?? null;
    // Anonymous connections still need a unique identity so the hub's
    // unsubscribeAll on disconnect targets only this conn.
    const connId = authedUserId ?? `anon-${randomUUID()}`;

    const conn: HubConnection = {
      userId: connId,
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
          if (msg.topic === LOBBY_TOPIC) {
            hub.subscribe(conn, msg.topic);
          } else if (msg.topic.startsWith('table:')) {
            hub.subscribe(conn, msg.topic);
            // Auto-subscribe the authed user to their own private hole-cards
            // topic for this table. Anonymous viewers never receive seat:*
            // data because there is no userId to bind to.
            if (authedUserId) {
              const tableId = msg.topic.slice('table:'.length);
              hub.subscribe(conn, `seat:${authedUserId}:${tableId}`);
            }
          } else if (msg.topic.startsWith('match:')) {
            if (msg.topic === 'match:') break;
            hub.subscribe(conn, msg.topic);
          } else if (authedUserId && isOwnPlayerTopic(msg.topic, authedUserId)) {
            hub.subscribe(conn, msg.topic);
          }
          // else: silently drop — same behaviour as before for unknown topics
          // and for private-topic attempts by an anonymous client.
          break;
        case 'unsubscribe':
          hub.unsubscribe(conn, msg.topic);
          if (msg.topic.startsWith('table:') && authedUserId) {
            const tableId = msg.topic.slice('table:'.length);
            hub.unsubscribe(conn, `seat:${authedUserId}:${tableId}`);
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
