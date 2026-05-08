import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Node 20 (Render's runtime) lacks a global WebSocket; supabase-js 2.45+
// initializes RealtimeClient eagerly inside createClient and crashes on
// startup without one. We pass `ws` as the realtime transport explicitly
// so the same client works on Node 20 and Node 22+.
//
// The cast to `any` papers over a structural mismatch between `ws`'s
// `ErrorEvent` (with .message/.error) and the DOM lib's `ErrorEvent`.
// Runtime is fine — supabase-realtime only reads .data/.code from
// MessageEvent/CloseEvent, never touches the differing ErrorEvent fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtimeOpts = { transport: WebSocket as any };

export interface SupabaseClientConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly anonKey: string;
}

export type SupabaseServiceClient = SupabaseClient;
export type SupabaseUserClient = SupabaseClient;

// Service-role client. Bypasses RLS — use only on the orchestrator process
// or in API routes that intentionally need cross-user reads/writes (decision
// mailbox, replay event ingestion, match summary writes).
//
// Never expose this key to the browser or to any code path that runs the
// agent runner directly — service-role bypass means a single leaked call
// can read every row in every user's profile.
export function createServiceRoleClient(cfg: SupabaseClientConfig): SupabaseServiceClient {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    realtime: realtimeOpts,
  });
}

// User-scoped client. Forwards the supplied JWT so RLS policies see the
// correct auth.uid(). Use this for routes that act on behalf of an
// authenticated user — agent registration, invite list, profile updates.
export function createUserScopedClient(
  cfg: SupabaseClientConfig,
  userJwt: string,
): SupabaseUserClient {
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    realtime: realtimeOpts,
  });
}

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

// Decode a Supabase API key (JWT) payload without verifying the signature.
// We only need the `role` claim to fail-fast when the operator has swapped
// service_role and anon env vars — a Supabase Cloud API gateway would
// reject a forged JWT regardless, so signature verification here adds no
// security and would only require a public key we don't have at boot.
function readJwtRole(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const claims = JSON.parse(json) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

export function loadSupabaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClientConfig {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !serviceRoleKey || !anonKey) {
    const missing = [
      !url ? 'SUPABASE_URL' : null,
      !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
      !anonKey ? 'SUPABASE_ANON_KEY' : null,
    ]
      .filter((s): s is string => s !== null)
      .join(', ');
    throw new SupabaseConfigError(`Missing Supabase env: ${missing}`);
  }

  // Catch the most common deployment misconfiguration: SUPABASE_SERVICE_ROLE_KEY
  // populated with the anon key (or vice-versa). The JWT payload's `role`
  // claim is what PostgREST uses to switch Postgres roles, so a swapped
  // value silently degrades every server-side query to the anon role —
  // surfacing later as "permission denied for table …" the first time
  // the orchestrator writes. Failing at boot is much easier to diagnose.
  const serviceRoleClaim = readJwtRole(serviceRoleKey);
  if (serviceRoleClaim !== null && serviceRoleClaim !== 'service_role') {
    throw new SupabaseConfigError(
      `SUPABASE_SERVICE_ROLE_KEY carries role="${serviceRoleClaim}", expected "service_role". ` +
        `Most likely the anon key was placed in this slot. ` +
        `Re-copy the service_role key from Supabase → Project Settings → API.`,
    );
  }
  const anonClaim = readJwtRole(anonKey);
  if (anonClaim !== null && anonClaim !== 'anon') {
    throw new SupabaseConfigError(
      `SUPABASE_ANON_KEY carries role="${anonClaim}", expected "anon". ` +
        `Re-copy the anon key from Supabase → Project Settings → API.`,
    );
  }

  return { url, serviceRoleKey, anonKey };
}
