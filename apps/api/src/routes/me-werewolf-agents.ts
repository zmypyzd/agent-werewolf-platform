import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError } from '@agent-poker/shared';
import type { AgentRecord, IAgentStore } from '@agent-poker/persistence';
import type { AgentConnectionRegistry } from '@agent-poker/agent-runtime';

// /api/v1/me/werewolf-agents — owner-bound CRUD for werewolf agents.
// Parallel surface to /api/v1/me/agents (which manages SQLite
// user_agent_configs for HTTP-webhook poker agents). The two stores are
// independent during Phase 1; Phase 2 will collapse them once auth
// migrates to Supabase Auth and the agents table FKs back to auth.users.
//
// GET returns both protocols the platform manages owner-bound: longpoll
// (mailbox-driven) and ws (reverse-WS, P1+ design). POST still only
// creates longpoll agents — ws agents originate from the invite
// registration flow (POST /agents/invites/:token/register with
// transport.kind='ws') so they get a one-time wsToken as part of that
// surface.

interface MeWerewolfAgentsPluginOptions extends FastifyPluginOptions {
  agentStore: IAgentStore;
  // Optional. When provided, the GET response sets `online` for ws agents
  // based on whether AgentConnectionRegistry.acquire returns a live conn.
  // Absent in legacy boot paths that predate P1 — online will be null
  // for those builds, which matches the "online state unknown" semantics
  // longpoll already has.
  agentRegistry?: AgentConnectionRegistry;
}

const CreateRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_\-\.]+$/, 'name may contain only A-Z, a-z, 0-9, _, -, .'),
  description: z.string().max(500).optional(),
  // Mailbox per-call budget. Werewolf decisions are slower than poker.
  // 1s floor prevents footguns; 2-min ceiling lines up with the DB
  // CHECK constraint on agents.timeout_ms.
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

// Public DTO. Excludes token_hash (never serialized) and callback_url /
// auth_header_* (only relevant to protocol='http' agents, which are
// managed via /me/agents instead).
//
// `online` is meaningful only for protocol='ws' agents — true iff the
// agent currently has a live WS connection in AgentConnectionRegistry.
// For longpoll agents we'd need a separate liveness signal (mailbox
// claim recency); out of scope for P3. Returned as `null` when the
// registry wasn't injected, or for protocols where online has no
// meaning. Callers that care should treat `null` as "unknown", not
// "offline".
function toPublicWerewolfAgent(a: AgentRecord, online: boolean | null) {
  return {
    agentId: a.id,
    name: a.name,
    description: a.description,
    protocol: a.protocol,
    timeoutMs: a.timeoutMs,
    status: a.status,
    online,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function computeOnline(
  a: AgentRecord,
  registry: AgentConnectionRegistry | undefined,
): boolean | null {
  if (a.protocol !== 'ws') return null;
  if (!registry) return null;
  return registry.acquire(a.id) !== null;
}

export async function meWerewolfAgentsRoutes(
  app: FastifyInstance,
  opts: MeWerewolfAgentsPluginOptions,
) {
  const { agentStore, agentRegistry } = opts;

  app.get(
    '/me/werewolf-agents',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const list = await agentStore.list(req.user!.userId);
      // Both werewolf-platform protocols are surfaced here. 'http' agents
      // live under /me/agents and are filtered out to avoid mixing the
      // two stores' shape contracts.
      const werewolfOnly = list.filter(
        (a) => a.protocol === 'longpoll' || a.protocol === 'ws',
      );
      // Parity with POST /me/werewolf-agents and rotate-token: those two
      // surface the one-shot rawToken and must never be cached. The list
      // response carries per-user agent inventory (names, descriptions,
      // protocol) — not credential material, but still personal data that
      // a shared cache or browser bfcache could cross-leak between sessions
      // on the same device. Apply the same no-store defense so every
      // caching layer is consistently informed that /me/werewolf-agents
      // responses must not be retained.
      reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .send({
          data: werewolfOnly.map((a) =>
            toPublicWerewolfAgent(a, computeOnline(a, agentRegistry)),
          ),
        });
    },
  );

  // Returns the raw token in the response body. The token is shown
  // exactly once — the platform stores only sha256(token) — so the UI
  // must surface it to the operator immediately. Subsequent reads only
  // see the public DTO.
  app.post(
    '/me/werewolf-agents',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const parsed = CreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          'SCHEMA_VALIDATION_FAILED',
          `/me/werewolf-agents body failed validation: ${parsed.error.message}`,
        );
      }
      const { name, description, timeoutMs } = parsed.data;
      const result = await agentStore.create({
        ownerId: req.user!.userId,
        name,
        description: description ?? null,
        protocol: 'longpoll',
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
      // create() always returns rawToken for protocol='longpoll' (the
      // store generates one and persists sha256). Defence-in-depth:
      // assert non-null so a future protocol change can't silently
      // ship a route that fails to surface a credential.
      if (result.rawToken === null) {
        throw new AppError(
          'INTERNAL_ERROR',
          `agent ${result.agent.id} created without a token (protocol mismatch)`,
        );
      }
      // Defense-in-depth: rawToken is shown exactly once. Forbid any
      // intermediary cache (CDN, browser bfcache, dev-tools "preserve
      // log" replays) from holding onto the response so a leak from the
      // immediate transport doesn't outlive the legitimate read.
      reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .status(201)
        .send({
          data: {
            agent: toPublicWerewolfAgent(result.agent, null),
            rawToken: result.rawToken,
          },
        });
    },
  );

  app.post(
    '/me/werewolf-agents/:id/rotate-token',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const result = await agentStore.rotateToken(req.user!.userId, id);
        // See no-store rationale in POST /me/werewolf-agents — same
        // defense applies to rotate-token, which equally shows the new
        // raw token exactly once.
        reply
          .header('Cache-Control', 'no-store')
          .header('Pragma', 'no-cache')
          .send({
            data: {
              agent: toPublicWerewolfAgent(result.agent, null),
              rawToken: result.rawToken,
            },
          });
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        throw err;
      }
    },
  );

  app.delete(
    '/me/werewolf-agents/:id',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // Lookup-then-delete so we can return 404 distinctly from a
      // silent no-op. The two queries race in theory but the worst
      // case is a 200 followed by a stale read — acceptable.
      const existing = await agentStore.get(req.user!.userId, id);
      if (!existing) throw new NotFoundError('Agent', id);
      await agentStore.delete(req.user!.userId, id);
      reply.status(204).send();
    },
  );
}
