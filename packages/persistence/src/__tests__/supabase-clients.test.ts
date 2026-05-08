import { describe, it, expect } from 'vitest';
import {
  loadSupabaseConfigFromEnv,
  SupabaseConfigError,
} from '../postgres/supabase-clients.js';

// Build an unsigned JWT carrying the given payload. We don't need a valid
// signature — the production code only inspects the payload.
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string): string =>
    Buffer.from(s, 'utf8')
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(JSON.stringify(payload)),
    'sig',
  ].join('.');
}

const SERVICE_ROLE_JWT = makeJwt({ role: 'service_role', iss: 'supabase' });
const ANON_JWT = makeJwt({ role: 'anon', iss: 'supabase' });
const URL = 'https://example.supabase.co';

describe('loadSupabaseConfigFromEnv', () => {
  it('accepts a properly configured env triple', () => {
    const cfg = loadSupabaseConfigFromEnv({
      SUPABASE_URL: URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      SUPABASE_ANON_KEY: ANON_JWT,
    } as NodeJS.ProcessEnv);
    expect(cfg.url).toBe(URL);
    expect(cfg.serviceRoleKey).toBe(SERVICE_ROLE_JWT);
    expect(cfg.anonKey).toBe(ANON_JWT);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is the anon JWT (swapped env)', () => {
    expect(() =>
      loadSupabaseConfigFromEnv({
        SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: ANON_JWT,
        SUPABASE_ANON_KEY: ANON_JWT,
      } as NodeJS.ProcessEnv),
    ).toThrow(SupabaseConfigError);
  });

  it('throws when SUPABASE_ANON_KEY is the service_role JWT (swapped env)', () => {
    expect(() =>
      loadSupabaseConfigFromEnv({
        SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
        SUPABASE_ANON_KEY: SERVICE_ROLE_JWT,
      } as NodeJS.ProcessEnv),
    ).toThrow(SupabaseConfigError);
  });

  it('throws on missing env vars', () => {
    expect(() =>
      loadSupabaseConfigFromEnv({ SUPABASE_URL: URL } as NodeJS.ProcessEnv),
    ).toThrow(SupabaseConfigError);
  });

  it('skips the role check for malformed JWTs (network layer rejects them anyway)', () => {
    // Unparseable JWTs return null role; we don't fail-fast on those because
    // we cannot confidently say the operator made a mistake. PostgREST will
    // surface an "Invalid API key" error on the first request.
    expect(() =>
      loadSupabaseConfigFromEnv({
        SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: 'not.a.jwt',
        SUPABASE_ANON_KEY: 'also.not.jwt',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
