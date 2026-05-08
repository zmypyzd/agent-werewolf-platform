import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  WerewolfActionSchema,
  WerewolfReasoningSummarySchema,
} from '@agent-poker/agent-protocol';
import {
  hashAgentToken,
  type AgentRecord,
  type IAgentStore,
  type IWerewolfDecisionMailbox,
} from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';

// /api/v1/werewolf/wait + /action — the HTTP surface that
// WerewolfMailboxRunner (in agent-runtime) talks to. Both routes are
// authenticated with a Bearer token issued at agent registration time:
//
//   Authorization: Bearer ag_<base64url-of-32-bytes>
//
// The platform stores sha256(token); we hash and compare here. Lookups
// hit the partial index `agents_token_hash_idx` from the init migration.

declare module 'fastify' {
  interface FastifyRequest {
    agent: AgentRecord | null;
  }
}

class AgentBearerAuthError extends AppError {
  constructor(message: string) {
    super('UNAUTHENTICATED', message);
  }
}

export interface WerewolfMailboxRoutesOptions extends FastifyPluginOptions {
  agentStore: IAgentStore;
  mailbox: IWerewolfDecisionMailbox;
  // How long /wait keeps the connection open before responding 204. Long-
  // polling lets the runner avoid hammering the API; the mailbox class
  // already supports timed polling, so we just plumb a config value
  // through. Default 25s — fits comfortably under most edge-host
  // request timeouts (Vercel's default is 30s for Hobby, 60s for Pro).
  longPollMs?: number;
  // Per-claim wait between polls of werewolf_decision_actions when the
  // agent submits via /action. Default 250ms — applied only on the
  // mailbox side, not exposed to the runner.
  pollIntervalMs?: number;
}

const ActionRequestSchema = z.object({
  mailboxRequestId: z.string().uuid(),
  action: WerewolfActionSchema,
  reasoningSummary: WerewolfReasoningSummarySchema.optional(),
});

const DEFAULT_LONG_POLL_MS = 25_000;

export async function werewolfMailboxRoutes(
  app: FastifyInstance,
  opts: WerewolfMailboxRoutesOptions,
) {
  const { agentStore, mailbox } = opts;
  const longPollMs = opts.longPollMs ?? DEFAULT_LONG_POLL_MS;

  app.decorateRequest('agent', null);

  // Bearer-token preHandler. Only registered on the mailbox routes (this
  // file is scoped via app.register prefix — see server.ts wire-up).
  const requireAgentAuth = async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new AgentBearerAuthError('missing Authorization: Bearer <token> header');
    }
    const rawToken = header.slice(7).trim();
    if (rawToken.length === 0) {
      throw new AgentBearerAuthError('empty bearer token');
    }
    const tokenHash = hashAgentToken(rawToken);
    const agent = await agentStore.findByTokenHash(tokenHash);
    if (!agent) {
      // Constant-time-ish: we still hashed before lookup, so timing leaks
      // here are bounded by the DB index probe — small relative to the
      // network jitter the caller already absorbs.
      throw new AgentBearerAuthError('invalid or revoked bearer token');
    }
    if (agent.protocol !== 'longpoll') {
      throw new AgentBearerAuthError(
        `agent ${agent.id} is protocol=${agent.protocol}; mailbox endpoints only accept longpoll`,
      );
    }
    req.agent = agent;
  };

  // ─── GET /api/v1/werewolf/wait ────────────────────────────────────────
  // Long-polls for the next pending decision request for this agent.
  // Returns 200 + { mailboxRequestId, request } when one lands; 204 when
  // the long-poll budget elapses with no work.
  app.get(
    '/werewolf/wait',
    { preHandler: [requireAgentAuth] },
    async (req, reply) => {
      const agent = req.agent!;
      const queryAgentId = (req.query as { agent_id?: string }).agent_id;
      if (queryAgentId !== undefined && queryAgentId !== agent.id) {
        throw new AppError(
          'FORBIDDEN',
          `query agent_id (${queryAgentId}) does not match authenticated agent (${agent.id})`,
        );
      }

      const deadline = Date.now() + longPollMs;
      // Burst-poll the mailbox until something appears or we hit the
      // long-poll deadline. Each claim hits the FOR UPDATE SKIP LOCKED
      // RPC, so concurrent /wait calls from a duplicated runner won't
      // both grab the same row.
      while (Date.now() < deadline) {
        const claimed = await mailbox.claimNextRequest(agent.id);
        if (claimed) {
          reply.status(200).send({
            mailboxRequestId: claimed.requestId,
            request: claimed.statePayload,
          });
          return;
        }
        // Tight sleep — the mailbox row appears via INSERT, not via a
        // DB notification, so we have no choice but to poll. The
        // 250ms cadence is a compromise between freshness and DB load.
        await sleep(250);
      }
      reply.status(204).send();
    },
  );

  // ─── POST /api/v1/werewolf/action ─────────────────────────────────────
  // Submits the agent's decision for a previously-claimed request. Body
  // shape matches what WerewolfMailboxRunner.submit() sends. Idempotent
  // on duplicate mailboxRequestId — the orchestrator uses the first
  // submission and ignores later ones.
  app.post(
    '/werewolf/action',
    { preHandler: [requireAgentAuth] },
    async (req, reply) => {
      const agent = req.agent!;
      const parsed = ActionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          'SCHEMA_VALIDATION_FAILED',
          `/action body failed validation: ${parsed.error.message}`,
        );
      }
      const { mailboxRequestId, action, reasoningSummary } = parsed.data;

      // submitAction looks up matchPk internally and validates that the
      // request belongs to this agent — see MailboxOwnershipError.
      try {
        await mailbox.submitAction({
          requestId: mailboxRequestId,
          agentId: agent.id,
          action: action as unknown as Record<string, unknown>,
          ...(reasoningSummary !== undefined
            ? { reasoningSummary: reasoningSummary as unknown as Record<string, unknown> }
            : { reasoningSummary: null }),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'MailboxOwnershipError') {
          throw new AppError('FORBIDDEN', err.message);
        }
        throw err;
      }

      reply.status(204).send();
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
