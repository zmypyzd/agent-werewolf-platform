import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import {
  AgentConnection,
  type AgentConnectionRegistry,
  type AgentSocket,
} from '@agent-poker/agent-runtime';
import {
  hashAgentToken,
  type IAgentStore,
} from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';

// /api/v1/agents/connect — reverse-WebSocket transport for external
// werewolf agents. The agent process opens an outbound WS here with
// `Authorization: Bearer <wsToken>`; the platform pushes decision
// requests back over the persistent connection. See
// docs/agent-ws-transport-design.md for the full design.
//
// Sibling, not relative, of the player-UI /ws (apps/api/src/routes/ws.ts).
// Different audience (agent processes), different lifecycle (point-to-point
// RPC, not broadcast pub/sub), different auth (Bearer token, not session
// cookie). Do not merge.

export interface AgentsWsRoutesOptions extends FastifyPluginOptions {
  agentStore: IAgentStore;
  agentRegistry: AgentConnectionRegistry;
}

declare module 'fastify' {
  interface FastifyRequest {
    // Reuses the same field as werewolf-mailbox.ts (declared there) so
    // the type augmentation doesn't conflict.
    wsAgentId?: string;
  }
}

class AgentWsAuthError extends AppError {
  constructor(message: string) {
    super('UNAUTHENTICATED', message);
  }
}

export async function agentsWsRoutes(
  app: FastifyInstance,
  opts: AgentsWsRoutesOptions,
) {
  const { agentStore, agentRegistry } = opts;

  // preValidation runs before the WebSocket upgrade completes, so a
  // failed auth produces a clean HTTP 401 (not a closed-after-handshake
  // socket). The handler below is only entered for authenticated agents.
  const requireAgentWsAuth = async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new AgentWsAuthError('missing Authorization: Bearer <token> header');
    }
    const rawToken = header.slice(7).trim();
    if (rawToken.length === 0) {
      throw new AgentWsAuthError('empty bearer token');
    }
    const tokenHash = hashAgentToken(rawToken);
    const agent = await agentStore.findByTokenHash(tokenHash);
    if (!agent) {
      throw new AgentWsAuthError('invalid or revoked bearer token');
    }
    if (agent.protocol !== 'ws') {
      throw new AgentWsAuthError(
        `agent ${agent.id} is protocol=${agent.protocol}; /agents/connect only accepts protocol=ws`,
      );
    }
    req.wsAgentId = agent.id;
  };

  app.get(
    '/agents/connect',
    { websocket: true, preValidation: [requireAgentWsAuth] },
    (socket, req) => {
      const agentId = req.wsAgentId;
      if (!agentId) {
        // Defense in depth: preValidation should have populated this.
        // If it didn't, refuse the upgrade by closing immediately.
        socket.close(1008, 'unauthenticated');
        return;
      }

      // Adapt ws.WebSocket to the registry's minimal AgentSocket shim so
      // the registry / connection stay decoupled from Fastify and `ws`.
      const wsSocket = socket as unknown as WebSocket;
      const agentSocket: AgentSocket = {
        send(data) {
          wsSocket.send(data);
        },
        close(code, reason) {
          wsSocket.close(code, reason);
        },
      };

      const conn = new AgentConnection({
        agentId,
        socket: agentSocket,
      });

      // Wire socket events FIRST so any frame the agent sends after our
      // hello is observed. register() may evict an older conn for the
      // same agentId (sending it goodbye) — that's fine because the
      // registry's identity-checked unregister won't tear ours down.
      socket.on('message', (raw: Buffer | ArrayBuffer | Uint8Array) => {
        conn.handleFrame(raw.toString());
      });
      socket.on('close', () => {
        conn.handleSocketClosed('peer_closed');
      });
      socket.on('error', (err: Error) => {
        conn.handleSocketClosed(`socket_error: ${err.message}`);
      });

      conn.onClose(() => {
        agentRegistry.unregister(conn);
      });

      agentRegistry.register(conn);
      conn.start();
    },
  );
}
