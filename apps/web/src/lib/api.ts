// Lightweight authed fetch wrapper. Always sends:
//   - credentials: 'include'  → session cookie travels on every call
//   - X-Requested-With: fetch → matches the server-side CSRF guard
//
// BASE is built from the optional VITE_API_BASE_URL env var (set at
// build time for split-deploy setups where the SPA and the API live
// on different origins). Default empty → relative paths, which work
// when the SPA is served same-origin with the API or when an upstream
// proxy / Vercel rewrite handles the indirection.
//
// When a Supabase session is present, an Authorization: Bearer <jwt>
// header is also attached so JWT-protected routes (external-contributor
// path) authenticate correctly alongside the legacy cookie path.
import { supabase } from './supabase.js';
import { signOut } from './auth.js';

const API_ROOT = import.meta.env?.VITE_API_BASE_URL ?? '';
const BASE = `${API_ROOT}/api/v1`;

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

// Endpoints that authenticate via the legacy cookie session only and will
// 401 for Supabase-JWT-only users. The 401 here is expected (it just means
// "no cookie session"), not a signal that the JWT was rejected, so the
// auto-signOut interceptor below must skip them.
const COOKIE_ONLY_AUTH_PATHS = new Set(['/auth/me']);
function isCookieOnlyAuthPath(path: string): boolean {
  return COOKIE_ONLY_AUTH_PATHS.has(path);
}

async function call<T>(method: string, path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  // Attach Supabase JWT when a session exists (JWT path for external-contributor
  // routes). Cookie path (credentials: 'include') stays active for legacy routes.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  const res = await fetch(`${BASE}${path}`, init);

  if (res.status === 401 && !isCookieOnlyAuthPath(path)) {
    // Only react with sign-out + redirect when we had a JWT session AND
    // the 401 was not from a cookie-only legacy endpoint that always 401s
    // for Supabase-only users (see isCookieOnlyAuthPath). Without that
    // exclusion, AuthProvider's /auth/me probe on mount would auto-signOut
    // every Supabase login and bounce the user straight back to /login.
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession) {
      await signOut();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    // Fall through to throw via the existing error pipeline below.
  }

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
