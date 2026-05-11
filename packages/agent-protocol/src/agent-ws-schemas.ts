import { z } from 'zod';
import {
  WerewolfActionSchema,
  WerewolfDecisionRequestSchema,
  WerewolfReasoningSummarySchema,
} from './werewolf-schemas.js';

// ─── WS transport for external werewolf agents ───────────────────────────────
// Wire protocol for the reverse-WebSocket transport described in
// docs/agent-ws-transport-design.md. The agent process opens an outbound
// WS to /api/v1/agents/connect (Bearer-token auth at upgrade) and the
// platform pushes decision requests over that connection.
//
// Distinct from the player-UI /ws (apps/api/src/routes/ws.ts) which uses
// WsClientMessageSchema in @agent-poker/shared — different audience,
// different lifecycle, do not merge.
//
// A single agent connection multiplexes concurrent decisions across
// multiple matches via correlationId; the server assigns the id and the
// agent must echo it back.

export const AGENT_WS_PROTOCOL_VERSION = 1;

// ─── Server → Agent ──────────────────────────────────────────────────────────

const HelloFrameSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  agentId: z.string().min(1),
  // Echoed in agent logs / decision-trace so a flaky connection can be
  // correlated across server restarts.
  serverConnectionId: z.string().min(1),
});

const DecideFrameSchema = z.object({
  type: z.literal('decide'),
  correlationId: z.string().min(1),
  request: WerewolfDecisionRequestSchema,
});

// Sent when the orchestrator no longer needs a pending decision (timeout
// already triggered fallback, match ended, agent connection replaced, ...).
// Agent should drop the in-flight computation; any late `decide.response`
// for a cancelled correlationId is recorded as `agent.late_response` and
// ignored.
const CancelFrameSchema = z.object({
  type: z.literal('cancel'),
  correlationId: z.string().min(1),
  reason: z.enum([
    'deadline_exceeded',
    'match_ended',
    'connection_replaced',
    'server_shutdown',
  ]),
});

const PingFrameSchema = z.object({
  type: z.literal('ping'),
  ts: z.number().int().nonnegative(),
});

// Final frame before the server closes the socket. `code` is a
// machine-readable reason; `message` is human-readable for logs.
const GoodbyeFrameSchema = z.object({
  type: z.literal('goodbye'),
  code: z.enum(['replaced', 'unauthorized', 'banned', 'server_shutdown']),
  message: z.string().max(500),
});

export const AgentWsServerMessageSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  DecideFrameSchema,
  CancelFrameSchema,
  PingFrameSchema,
  GoodbyeFrameSchema,
]);

// ─── Agent → Server ──────────────────────────────────────────────────────────

const DecideResponseFrameSchema = z.object({
  type: z.literal('decide.response'),
  correlationId: z.string().min(1),
  action: WerewolfActionSchema,
  reasoningSummary: WerewolfReasoningSummarySchema.optional(),
});

// Equivalent to a thrown exception in the HTTP adapter: orchestrator
// substitutes werewolfFallback and records `agent.invalid_action` /
// `agent.timeout` style trace entry.
const DecideErrorFrameSchema = z.object({
  type: z.literal('decide.error'),
  correlationId: z.string().min(1),
  code: z.enum([
    'handler_threw',
    'invalid_request',
    'cancelled',
    'internal_error',
  ]),
  message: z.string().max(500),
});

const PongFrameSchema = z.object({
  type: z.literal('pong'),
  ts: z.number().int().nonnegative(),
});

export const AgentWsClientMessageSchema = z.discriminatedUnion('type', [
  DecideResponseFrameSchema,
  DecideErrorFrameSchema,
  PongFrameSchema,
]);

// ─── Type exports ────────────────────────────────────────────────────────────
// Inferred directly from the schemas. Note: Zod infers MUTABLE arrays for
// fields like publicState.players, while @agent-poker/shared keeps the same
// shapes as deeply-readonly types. Outbound senders that hold a readonly
// WerewolfDecisionRequest (e.g. AgentConnection.rpc) must therefore avoid
// passing it through this typed union — see the dedicated decide-frame
// emitter in AgentConnection.

export type AgentWsServerMessage = z.infer<typeof AgentWsServerMessageSchema>;
export type AgentWsClientMessage = z.infer<typeof AgentWsClientMessageSchema>;

export type AgentWsServerMessageOfType<T extends AgentWsServerMessage['type']> =
  Extract<AgentWsServerMessage, { type: T }>;
export type AgentWsClientMessageOfType<T extends AgentWsClientMessage['type']> =
  Extract<AgentWsClientMessage, { type: T }>;
