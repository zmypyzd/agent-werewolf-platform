import { describe, expect, it } from 'vitest';
import {
  createPostgresWerewolfBundle,
  loadPostgresConfigFromEnv,
} from '../postgres-werewolf-bundle.js';
import { buildServer } from '../server.js';

const VALID_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJfake.service.role',
  SUPABASE_ANON_KEY: 'eyJfake.anon',
};

describe('postgres-werewolf-bundle factory', () => {
  it('loadPostgresConfigFromEnv returns null when any of the three env vars is missing', () => {
    expect(loadPostgresConfigFromEnv({})).toBeNull();
    expect(
      loadPostgresConfigFromEnv({ SUPABASE_URL: VALID_ENV.SUPABASE_URL }),
    ).toBeNull();
    expect(
      loadPostgresConfigFromEnv({
        SUPABASE_URL: VALID_ENV.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      }),
    ).toBeNull();
  });

  it('loadPostgresConfigFromEnv returns the full triple when all three are present', () => {
    const cfg = loadPostgresConfigFromEnv(VALID_ENV);
    expect(cfg).not.toBeNull();
    expect(cfg!.url).toBe(VALID_ENV.SUPABASE_URL);
    expect(cfg!.serviceRoleKey).toBe(VALID_ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(cfg!.anonKey).toBe(VALID_ENV.SUPABASE_ANON_KEY);
  });

  it('createPostgresWerewolfBundle returns null in SQLite-only mode (no Supabase env)', () => {
    expect(createPostgresWerewolfBundle({})).toBeNull();
  });

  it('buildServer without bundle leaves /api/v1/werewolf/wait returning 404', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const r = await app.inject({ method: 'GET', url: '/api/v1/werewolf/wait' });
      expect(r.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('buildServer with bundle.agentStore + bundle.mailbox makes mailbox routes auth-required (401, not 404)', async () => {
    const bundle = createPostgresWerewolfBundle(VALID_ENV)!;
    const app = buildServer({
      werewolfAgentStore: bundle.agentStore,
      werewolfMailbox: bundle.mailbox,
    });
    await app.ready();
    try {
      // Route exists but no auth → 401, not 404. Confirms the wire-up
      // landed without actually making a Supabase round-trip.
      const r = await app.inject({ method: 'GET', url: '/api/v1/werewolf/wait' });
      expect(r.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('createPostgresWerewolfBundle wires every store + the mailbox when env is set', () => {
    const bundle = createPostgresWerewolfBundle(VALID_ENV);
    expect(bundle).not.toBeNull();
    // No network call should have happened — createClient only allocates
    // an in-process client object. We only check that all dependencies
    // were constructed and reference the same Supabase service client.
    expect(bundle!.client).toBeDefined();
    expect(bundle!.config).toEqual({
      url: VALID_ENV.SUPABASE_URL,
      serviceRoleKey: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: VALID_ENV.SUPABASE_ANON_KEY,
    });
    expect(bundle!.agentStore).toBeDefined();
    expect(bundle!.mailbox).toBeDefined();
    expect(bundle!.registry).toBeDefined();
    expect(bundle!.artifactStore).toBeDefined();
    expect(bundle!.traceStore).toBeDefined();
    expect(bundle!.replayEventStore).toBeDefined();
  });
});
