import { randomUUID } from 'crypto';
import { WerewolfDecisionResponseSchema } from '@agent-poker/agent-protocol';
import type { WerewolfDecisionRequest } from '@agent-poker/shared';

// Synthetic decide-probe used at agent registration time to verify the
// endpoint URL the operator just supplied is (a) reachable from this
// API server, (b) speaks the werewolf decision protocol, and (c)
// returns within a reasonable budget.
//
// Motivation: in earlier versions of the platform a misconfigured
// endpointUrl (broken tunnel, wrong port, expired host) was silently
// accepted by /agents/invites/.../register and only manifested as a
// mute seat once the agent was seated in a match — the orchestrator's
// per-call timeout substituted validActions[0] and the agent appeared
// to play but never spoke. Probing at register time produces a 400 the
// moment the URL is wrong, before any match is involved.
//
// Probe semantics:
//   - Sends a minimal-but-valid WerewolfDecisionRequest with the
//     `requestId` prefixed `probe-` so agents that want to short-circuit
//     can detect us.
//   - Times out at `min(timeoutMs, PROBE_TIMEOUT_CEILING_MS)`; bounded
//     so a slow endpoint can't park the register call for >10s.
//   - Validates the response body against WerewolfDecisionResponseSchema
//     but DOES NOT enforce that the returned action structurally
//     matches the synthetic request's validActions — agents that pick a
//     different shape but are otherwise well-typed are still proof the
//     wire works.

export interface ProbeOutcome {
  ok: boolean;
  // Set only when ok=false. Distinguishes "couldn't connect / timed out
  // / non-2xx" (network/transport failure) from "got a response but it
  // didn't match the schema" (protocol mismatch).
  code?: 'ENDPOINT_UNREACHABLE' | 'ENDPOINT_INVALID_RESPONSE';
  reason?: string;
}

export interface ProbeOptions {
  endpointUrl: string;
  authHeaderName: string | null;
  authHeaderValue: string | null;
  // Per-call budget. Bounded below to PROBE_TIMEOUT_FLOOR_MS so a
  // misconfigured client passing 0 doesn't make every probe time out
  // instantly, and above to PROBE_TIMEOUT_CEILING_MS so the register
  // call stays snappy.
  timeoutMs: number;
  // Test-injection seam. Production uses global fetch.
  fetchImpl?: typeof fetch;
}

export const PROBE_TIMEOUT_FLOOR_MS = 1_000;
export const PROBE_TIMEOUT_CEILING_MS = 10_000;

export async function probeHttpAgentEndpoint(opts: ProbeOptions): Promise<ProbeOutcome> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const budget = Math.min(
    Math.max(opts.timeoutMs, PROBE_TIMEOUT_FLOOR_MS),
    PROBE_TIMEOUT_CEILING_MS,
  );

  const requestId = `probe-${randomUUID()}`;
  const syntheticRequest = buildSyntheticRequest(requestId);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.authHeaderName && opts.authHeaderValue) {
    headers[opts.authHeaderName] = opts.authHeaderValue;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let res: Response;
  try {
    res = await fetchFn(opts.endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(syntheticRequest),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = controller.signal.aborted
      ? `endpoint did not respond within ${budget}ms`
      : `failed to reach endpoint: ${(err as Error).message}`;
    return { ok: false, code: 'ENDPOINT_UNREACHABLE', reason };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return {
      ok: false,
      code: 'ENDPOINT_UNREACHABLE',
      reason: `endpoint returned HTTP ${res.status}`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      code: 'ENDPOINT_INVALID_RESPONSE',
      reason: `response was not valid JSON: ${(err as Error).message}`,
    };
  }

  const parsed = WerewolfDecisionResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'ENDPOINT_INVALID_RESPONSE',
      reason: `response failed werewolf schema: ${parsed.error.message}`,
    };
  }

  return { ok: true };
}

function buildSyntheticRequest(requestId: string): WerewolfDecisionRequest {
  return {
    requestId,
    gameId: 'probe',
    agentId: 'probe-agent',
    playerId: 'p1',
    phase: 'day-vote',
    nightNumber: 1,
    dayNumber: 1,
    publicState: {
      gameId: 'probe',
      phase: 'day-vote',
      nightNumber: 1,
      dayNumber: 1,
      players: [],
      history: [],
      winner: null,
    },
    privateState: {
      selfId: 'p1',
      selfRole: 'villager',
      selfSide: 'good',
      knownAllies: [],
      seerKnowledge: [],
      witchView: null,
      hunterCanShoot: false,
    },
    validActions: [{ type: 'day-vote', voterId: 'p1', targetId: null }],
    deadlineMs: 5000,
  };
}
