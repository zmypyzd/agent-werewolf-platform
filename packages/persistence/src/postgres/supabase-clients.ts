import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  });
}

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
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
  return { url, serviceRoleKey, anonKey };
}
