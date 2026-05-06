import path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  FileObjectStore,
  MemoryWerewolfDecisionTraceStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import {
  WerewolfHttpAgentAdapter,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type { WerewolfPlayerId } from '@agent-poker/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

interface AgentServer {
  readonly playerId: WerewolfPlayerId;
  readonly agentId: string;
  readonly url: string;
  close(): Promise<void>;
}

// Spins up one Fastify server per seat. The handler validates the incoming
// WerewolfDecisionRequest with the shared Zod schema, then hands it to a
// seeded WerewolfRandomMockAgent. Real-network roundtrip without ever
// leaving 127.0.0.1.
async function startAgentServer(
  playerId: WerewolfPlayerId,
  playerName: string,
  seedBase: string,
): Promise<AgentServer> {
  const agentId = `agent-${playerId}`;
  const worker = new WerewolfRandomMockAgent(agentId, playerName, {
    seed: `${seedBase}-${playerId}`,
  });

  const app: FastifyInstance = Fastify({ logger: false });
  app.post('/decide', async (req, reply) => {
    const parsed = WerewolfDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    // The Zod-parsed request shape is structurally compatible with the
    // domain WerewolfDecisionRequest interface; cast at the seam.
    const response = await worker.requestDecision(
      parsed.data as unknown as Parameters<typeof worker.requestDecision>[0],
    );
    return reply.send(response);
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error(`agent ${playerId}: listen failed`);
  return {
    playerId,
    agentId,
    url: `http://127.0.0.1:${addr.port}/decide`,
    close: () => app.close(),
  };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const gameId = args[0] ?? 'werewolf-demo-001';
  const seed = args[1] ?? 'werewolf-seed-001';

  console.log('\n=========================================');
  console.log('  Agent Werewolf Platform — Local Sim    ');
  console.log('=========================================\n');
  console.log(`Game ID: ${gameId}`);
  console.log(`Seed:    ${seed}\n`);

  const artifactStore = new ObjectWerewolfMatchArtifactStore(new FileObjectStore(OUTPUT_DIR));
  const decisionTraceStore = new MemoryWerewolfDecisionTraceStore();
  const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore });

  const { matchId, initialState } = orch.createMatch({
    gameId,
    seed,
    defaultTimeoutMs: 5_000,
  });

  // Stand up 9 in-process agent servers and register HTTP adapters pointed at them.
  const servers: AgentServer[] = [];
  try {
    for (const player of initialState.players) {
      const server = await startAgentServer(player.id, player.name, seed);
      servers.push(server);
      const adapter = new WerewolfHttpAgentAdapter({
        agentId: server.agentId,
        name: player.name,
        endpointUrl: server.url,
        timeoutMs: 5_000,
      });
      orch.registerAgent(matchId, player.id, adapter);
    }
    console.log(`Seated ${servers.length} agents. Running match...\n`);

    const t0 = Date.now();
    const summary = await orch.runMatch(matchId);
    const elapsed = Date.now() - t0;

    console.log(`Winner:           ${summary.winner}`);
    console.log(`Nights:           ${summary.nightCount}`);
    console.log(`Days:             ${summary.dayCount}`);
    console.log(`Steps:            ${summary.stepCount}`);
    console.log(`Replay events:    ${summary.replayEventCount}`);
    console.log(`Wall-clock:       ${elapsed}ms\n`);

    console.log('Final players:');
    for (const p of summary.finalPlayers) {
      const status = p.alive ? 'alive ' : 'dead  ';
      console.log(`  [${status}] ${p.name.padEnd(12)} ${p.role.padEnd(8)} (${p.side})`);
    }
    console.log('');
    console.log(`Match artifact: ${OUTPUT_DIR}/matches/${matchId}/manifest.json`);
    console.log(`Summary:        ${OUTPUT_DIR}/matches/${matchId}/summary.json`);
    console.log(`Replay:         ${OUTPUT_DIR}/matches/${matchId}/replay.jsonl`);
    console.log(`Decision trace: ${OUTPUT_DIR}/matches/${matchId}/decision-trace.jsonl`);
    console.log('');
    console.log('=========================================');
    console.log('Werewolf simulation complete!');
    console.log('=========================================\n');
  } finally {
    await Promise.all(servers.map((s) => s.close()));
  }
}

main().catch((err) => {
  console.error('Werewolf simulation failed:', err);
  process.exit(1);
});
