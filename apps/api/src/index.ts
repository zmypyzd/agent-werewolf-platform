import { buildServer, type BuildServerOptions } from './server.js';
import { createPostgresWerewolfBundle } from './postgres-werewolf-bundle.js';

// Boot wiring. SQLite is the default; Postgres mode activates when all
// three SUPABASE_* env vars are present. Modes are not mutually exclusive
// — when Postgres is on, the werewolf stores + mailbox routes use it;
// other subsystems (auth sessions, poker tables) continue on SQLite for
// now (Phase 1 keeps the user-facing UI flow stable).

const opts: BuildServerOptions = {};
const bundle = createPostgresWerewolfBundle();
if (bundle) {
  opts.werewolfMatchArtifactStore = bundle.artifactStore;
  opts.werewolfDecisionTraceStore = bundle.traceStore;
  opts.werewolfAgentStore = bundle.agentStore;
  opts.werewolfMailbox = bundle.mailbox;
}

const app = buildServer(opts);

const port = parseInt(process.env['PORT'] ?? '3000', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

app.listen({ port, host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Agent Platform API running at ${address}`);
  console.log(`Werewolf storage: ${bundle ? 'Postgres (Supabase)' : 'in-memory (SQLite for auth)'}`);
  console.log('Endpoints:');
  console.log('  POST   /api/v1/tables');
  console.log('  GET    /api/v1/tables');
  console.log('  GET    /api/v1/tables/:tableId');
  console.log('  POST   /api/v1/tables/:tableId/agents');
  console.log('  POST   /api/v1/tables/:tableId/hands/start');
  console.log('  GET    /api/v1/tables/:tableId/hands/:handId');
  console.log('  GET    /api/v1/tables/:tableId/hands/:handId/replay');
  console.log('  POST   /api/v1/simulate');
  if (bundle) {
    console.log('  GET    /api/v1/werewolf/wait');
    console.log('  POST   /api/v1/werewolf/action');
  }
});
