import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { RealtimeHub, serveSseFromHub, werewolfMatchTopic } from '@agent-poker/realtime';

// GET /api/v1/werewolf/stream/:gameId — public SSE stream of werewolf
// match replay events. Open to anonymous spectators (mirrors the
// existing /ws 'match:<gameId>' visibility model). Live events arrive
// as `data: <JSON>\n\n` frames where the JSON is a WsServerMessage
// envelope `{ topic, type, payload }`.
//
// Why this exists alongside /ws: serverless platforms (Vercel, Netlify
// Functions) cannot host persistent WebSocket connections, but they
// stream HTTP responses just fine. Phase 2 adds SSE so spectator UI
// works in the Vercel-fronted deployment; Phase 5+ phases out /ws.

interface WerewolfStreamRoutesOptions extends FastifyPluginOptions {
  hub: RealtimeHub;
}

export async function werewolfStreamRoutes(
  app: FastifyInstance,
  opts: WerewolfStreamRoutesOptions,
) {
  const { hub } = opts;

  app.get('/werewolf/stream/:gameId', async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    if (!gameId || gameId.length === 0) {
      reply.status(400).send({ error: { code: 'INVALID_CONFIG', message: 'gameId required' } });
      return;
    }

    const handle = serveSseFromHub(req, reply, hub, {
      topics: [werewolfMatchTopic(gameId)],
      // No preface for now — late spectators only get events from the
      // moment they connect. Replay/catch-up will be added when we
      // wire the Postgres replay event store as a "fetch backlog
      // before subscribing" source.
    });

    // Returning the done promise keeps the Fastify handler alive for
    // the lifetime of the SSE connection. When the client disconnects
    // (TCP close, abort, or server-side handle.close()), serveSseFromHub
    // resolves done, the handler returns, and Fastify proceeds normally.
    await handle.done;
  });
}
