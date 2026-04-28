// Lightweight authed fetch wrapper. Always sends:
//   - credentials: 'include'  → session cookie travels on every call
//   - X-Requested-With: fetch → matches the server-side CSRF guard
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  body?: unknown;
  signal?: AbortSignal;
}

export interface AnalysisMetricSummary {
  decisionCount: number;
  actionCounts: Record<string, number>;
  streetCounts: Record<string, Record<string, number>>;
  intentCounts: Record<string, number>;
  riskCounts: Record<string, number>;
  missingReasoningCount: number;
  timeoutCount: number;
  invalidActionCount: number;
  fallbackCount: number;
  averageConfidence: number | null;
  averageLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface AgentAnalysisSummary extends AnalysisMetricSummary {
  agentId: string;
  playerIds: string[];
  handIds: string[];
}

export interface MatchAnalysisSummary {
  matchId: string;
  tableId: string;
  generatedAt: number;
  handCount: number;
  agentCount: number;
  decisionCount: number;
  totals: AnalysisMetricSummary;
  agents: AgentAnalysisSummary[];
}

export type SimulationStrategy = 'random' | 'always-call' | 'always-fold' | 'aggressive';

export interface SimulateAgentRequest {
  name: string;
  strategy: SimulationStrategy;
  buyIn: number;
}

export interface SimulateRequest {
  name: string;
  maxSeats: number;
  blindConfig: {
    smallBlind: number;
    bigBlind: number;
    ante: number;
  };
  seed?: string;
  defaultTimeoutMs?: number;
  agents: SimulateAgentRequest[];
  numHands: number;
}

export interface SimulateResponse {
  tableId: string;
  hands: unknown[];
  finalStacks: Record<string, number>;
  totalHands: number;
  matchArtifact: {
    matchId: string;
    manifest: unknown;
  };
}

async function call<T>(method: string, path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  const res = await fetch(`${BASE}${path}`, init);

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = await res.json() as { error?: { code?: string; message?: string } };
      if (parsed.error?.code) code = parsed.error.code;
      if (parsed.error?.message) message = parsed.error.message;
    } catch { /* non-JSON body */ }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json() as { data: T };
  return data.data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => call<T>('GET', path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body !== undefined ? { body } : {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body !== undefined ? { body } : {}),
  del: <T>(path: string) => call<T>('DELETE', path),
  getMatchAnalysis: (matchId: string, signal?: AbortSignal) =>
    call<MatchAnalysisSummary>(
      'GET',
      `/matches/${encodeURIComponent(matchId)}/analysis`,
      signal ? { signal } : {},
    ),
  simulate: (request: SimulateRequest) =>
    call<SimulateResponse>('POST', '/simulate', { body: request }),
};
