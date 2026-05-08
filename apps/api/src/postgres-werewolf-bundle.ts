import {
  PostgresAgentStore,
  PostgresWerewolfDecisionTraceStore,
  PostgresWerewolfMatchArtifactStore,
  PostgresWerewolfMatchRegistry,
  PostgresWerewolfReplayEventStore,
  WerewolfDecisionMailbox,
  createServiceRoleClient,
  type IAgentStore,
  type IWerewolfDecisionMailbox,
  type IWerewolfDecisionTraceStore,
  type IWerewolfMatchArtifactStore,
  type IWerewolfMatchRegistry,
  type IWerewolfReplayEventStore,
  type SupabaseClientConfig,
  type SupabaseServiceClient,
} from '@agent-poker/persistence';

// Phase 1 wire-up. When the Supabase env triple is present, this factory
// constructs the Postgres-backed werewolf stores + mailbox in one shot
// and returns them. Callers (apps/api/src/index.ts) feed the result into
// buildServer.
//
// Returns null when env is incomplete — the API server then runs in
// SQLite-only / in-memory mode (the existing dev-and-test path), which
// keeps the test suite hermetic and lets local development work without
// a Supabase project.
//
// Bundle members are deliberately wide: callers may use only some of
// them (the mailbox routes need agentStore + mailbox; the orchestrator
// path needs all five stores). Building once and selecting later is
// cheaper than constructing the Supabase client multiple times.

export interface PostgresWerewolfBundle {
  readonly client: SupabaseServiceClient;
  readonly config: SupabaseClientConfig;
  readonly agentStore: IAgentStore;
  readonly mailbox: IWerewolfDecisionMailbox;
  readonly registry: IWerewolfMatchRegistry;
  readonly artifactStore: IWerewolfMatchArtifactStore;
  readonly traceStore: IWerewolfDecisionTraceStore;
  readonly replayEventStore: IWerewolfReplayEventStore;
}

export interface PostgresWerewolfBundleEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

export function loadPostgresConfigFromEnv(
  env: PostgresWerewolfBundleEnv = process.env,
): SupabaseClientConfig | null {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !serviceRoleKey || !anonKey) return null;
  return { url, serviceRoleKey, anonKey };
}

export function createPostgresWerewolfBundle(
  env: PostgresWerewolfBundleEnv = process.env,
): PostgresWerewolfBundle | null {
  const config = loadPostgresConfigFromEnv(env);
  if (config === null) return null;

  const client = createServiceRoleClient(config);
  const agentStore = new PostgresAgentStore(client);
  const mailbox = new WerewolfDecisionMailbox(client);
  const registry = new PostgresWerewolfMatchRegistry(client);
  const replayEventStore = new PostgresWerewolfReplayEventStore(client);
  const artifactStore = new PostgresWerewolfMatchArtifactStore(client, { resolver: registry });
  const traceStore = new PostgresWerewolfDecisionTraceStore(client, { resolver: registry });

  return {
    client,
    config,
    agentStore,
    mailbox,
    registry,
    artifactStore,
    traceStore,
    replayEventStore,
  };
}
