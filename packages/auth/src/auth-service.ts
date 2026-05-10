import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Node 20 (Render's runtime) lacks a global WebSocket; supabase-js 2.45+
// initializes RealtimeClient eagerly inside createClient and crashes on
// startup without one. We pass `ws` as the realtime transport explicitly
// so the same client works on Node 20 and Node 22+. Mirrors the same
// workaround in packages/persistence/src/postgres/supabase-clients.ts.
//
// The cast to `any` papers over a structural mismatch between `ws`'s
// ErrorEvent (with .message/.error) and the DOM lib's ErrorEvent.
// Runtime is fine — supabase-realtime only reads .data/.code from
// MessageEvent/CloseEvent, never touches the differing ErrorEvent fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtimeOpts = { transport: WebSocket as any };

export interface VerifiedJwt {
  userId: string;
  jwt: string;
  email: string;
  displayName: string;
}

export interface IAuthService {
  verifyJwt(authHeader: string | undefined): Promise<VerifiedJwt>;
}

/**
 * Test-only auth service. Always returns the configured defaultUserId, never validates signature.
 * Throws if no userId configured — fails loudly rather than guessing from token contents.
 */
export class MockAuthService implements IAuthService {
  constructor(
    private readonly defaultUserId?: string,
    private readonly defaultEmail: string = 'mock@example.test',
    private readonly defaultDisplayName: string = 'Mock User',
  ) {}

  async verifyJwt(authHeader: string | undefined): Promise<VerifiedJwt> {
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    const parts = authHeader.split(' ');
    const scheme = parts[0];
    const token = parts[1];
    if (scheme !== 'Bearer') {
      throw new Error('Authorization scheme must be Bearer');
    }
    if (!token) {
      throw new Error('Missing Bearer token');
    }
    if (!this.defaultUserId) {
      throw new Error('MockAuthService requires defaultUserId to return a userId');
    }
    return {
      userId: this.defaultUserId,
      jwt: token,
      email: this.defaultEmail,
      displayName: this.defaultDisplayName,
    };
  }
}

/**
 * Production auth service. Uses supabase.auth.getUser(jwt) which performs full
 * signature + expiry verification server-side. Costs one RPC per request, but
 * is authoritative. Alternative is local jose verification with the JWT secret;
 * we prefer correctness over latency.
 */
export class SupabaseAuthService implements IAuthService {
  private readonly client: ReturnType<typeof createClient>;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: realtimeOpts,
    });
  }

  async verifyJwt(authHeader: string | undefined): Promise<VerifiedJwt> {
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    const parts = authHeader.split(' ');
    const scheme = parts[0];
    const token = parts[1];
    if (scheme !== 'Bearer') {
      throw new Error('Authorization scheme must be Bearer');
    }
    if (!token) {
      throw new Error('Missing Bearer token');
    }

    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) {
      throw new Error(`Invalid or expired JWT: ${error?.message ?? 'no user returned'}`);
    }

    const email = data.user.email ?? '';
    if (!email) {
      // Email is required to find-or-create a user_store entry. Supabase
      // accounts created via password auth always carry an email; reject
      // here if it's missing so the failure is visible at the auth layer
      // rather than as a downstream NOT-NULL violation.
      throw new Error('Supabase user has no email');
    }
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const rawName = meta['display_name'];
    const displayName = typeof rawName === 'string' && rawName.length > 0
      ? rawName
      : email.split('@')[0] ?? email;

    return { userId: data.user.id, jwt: token, email, displayName };
  }
}
