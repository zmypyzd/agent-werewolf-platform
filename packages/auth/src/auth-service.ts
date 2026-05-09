import { createClient } from '@supabase/supabase-js';

export interface IAuthService {
  verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }>;
}

/**
 * Test-only auth service. Always returns the configured defaultUserId, never validates signature.
 * Throws if no userId configured — fails loudly rather than guessing from token contents.
 */
export class MockAuthService implements IAuthService {
  constructor(private readonly defaultUserId?: string) {}

  async verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }> {
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
    return { userId: this.defaultUserId, jwt: token };
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
    });
  }

  async verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }> {
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

    return { userId: data.user.id, jwt: token };
  }
}
