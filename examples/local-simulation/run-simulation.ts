import path from 'path';
import { fileURLToPath } from 'url';
import { TableOrchestrator } from '@agent-poker/table-orchestrator';
import {
  MemoryTableStore,
  MemoryHandStore,
  MemoryDecisionTraceStore,
  FileHandStore,
  FileMatchArtifactStore,
} from '@agent-poker/persistence';
import { RandomMockAgent, AlwaysCallAgent, AggressiveAgent, AlwaysFoldAgent } from '@agent-poker/agent-runtime';
import type { HandSummary } from '@agent-poker/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const MAX_LOCAL_SIMULATION_HANDS = 20;

// CLI args
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const requestedNumHands = parseInt(args[0] ?? '5', 10);
const numHands = Number.isFinite(requestedNumHands)
  ? Math.min(Math.max(requestedNumHands, 1), MAX_LOCAL_SIMULATION_HANDS)
  : 5;
const seed = args[1] ?? 'demo-seed-001';

async function main() {
  console.log('\n====================================');
  console.log('  Agent Poker Platform — Local Sim  ');
  console.log('====================================\n');
  console.log(`Seed: ${seed}`);
  console.log(`Hands: ${numHands}`);
  if (requestedNumHands > MAX_LOCAL_SIMULATION_HANDS) {
    console.log(`Requested hands capped at ${MAX_LOCAL_SIMULATION_HANDS}`);
  }
  console.log('');

  const tableStore = new MemoryTableStore();
  const memHandStore = new MemoryHandStore();
  const decisionTraceStore = new MemoryDecisionTraceStore();
  const fileHandStore = new FileHandStore(OUTPUT_DIR);
  const matchArtifactStore = new FileMatchArtifactStore(OUTPUT_DIR);

  // Composite store: writes to both memory and file
  const handStore = {
    saveHandSummary: async (hand: HandSummary) => {
      await memHandStore.saveHandSummary(hand);
      await fileHandStore.saveHandSummary(hand);
    },
    getHandSummary: (id: string) => memHandStore.getHandSummary(id),
    listHandSummaries: (tId: string) => memHandStore.listHandSummaries(tId),
    appendReplayEvent: async (evt: Parameters<typeof memHandStore.appendReplayEvent>[0]) => {
      await memHandStore.appendReplayEvent(evt);
      await fileHandStore.appendReplayEvent(evt);
    },
    getReplayEvents: (id: string) => memHandStore.getReplayEvents(id),
  };

  const orch = new TableOrchestrator(tableStore, handStore, null, decisionTraceStore);

  // Create table
  const table = await orch.createTable({
    name: 'Local Simulation Table',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    seed,
    defaultTimeoutMs: 5000,
  });

  console.log(`Table created: ${table.tableId}`);

  // Add agents
  const agents = [
    { id: 'bot-random', name: 'RandomBot', factory: (id: string, n: string) => new RandomMockAgent(id, n) },
    { id: 'bot-call', name: 'AlwaysCallBot', factory: (id: string, n: string) => new AlwaysCallAgent(id, n) },
    { id: 'bot-aggro', name: 'AggressiveBot', factory: (id: string, n: string) => new AggressiveAgent(id, n) },
    { id: 'bot-fold', name: 'AlwaysFoldBot', factory: (id: string, n: string) => new AlwaysFoldAgent(id, n) },
  ];

  for (const a of agents) {
    const agent = a.factory(a.id, a.name);
    await orch.addAgent(table.tableId, { agentId: a.id, name: a.name, adapterType: 'mock' }, agent, 1000);
  }

  console.log(`Agents seated: ${agents.map(a => a.name).join(', ')}`);
  console.log('');

  // Run hands
  const summaries: HandSummary[] = [];
  for (let i = 0; i < numHands; i++) {
    const t0 = Date.now();
    try {
      const summary = await orch.startHand(table.tableId);
      summaries.push(summary);
      const duration = Date.now() - t0;

      console.log(`Hand #${summary.handNumber} [seed: ${summary.seed}]`);
      const winners = summary.results.filter(r => r.winAmount > 0);
      for (const w of winners) {
        const player = summary.players.find(p => p.playerId === w.playerId);
        const name = player ? `${player.agentId}` : w.playerId;
        const net = w.netChange >= 0 ? `+${w.netChange}` : `${w.netChange}`;
        console.log(`  Winner: ${name} (${net} chips)`);
      }
      if (summary.communityCards.length > 0) {
        const cards = summary.communityCards.map(c => `${c.rank}${c.suit}`).join(' ');
        console.log(`  Community: ${cards}`);
      }
      console.log(`  Actions: ${summary.allActions.length}`);
      console.log(`  Duration: ${duration}ms`);
      console.log('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`Hand #${i + 1} failed: ${msg}`);
      break;
    }
  }

  if (summaries.length === 0) {
    console.log('No hands completed.');
    return;
  }

  // Final stacks
  const finalTable = await orch.getTable(table.tableId);
  console.log('Final Stacks:');
  for (const seat of finalTable.seats) {
    if (seat) {
      console.log(`  ${seat.agentId}: ${seat.stack} chips`);
    }
  }

  const replayEvents = (
    await Promise.all(summaries.map(summary => memHandStore.getReplayEvents(summary.handId)))
  ).flat();
  const decisionTraces = await decisionTraceStore.listDecisionTraces(table.tableId);

  const artifact = await matchArtifactStore.saveMatchArtifact({
    matchId: table.tableId,
    tableId: table.tableId,
    name: table.config.name,
    seed: table.config.seed || seed,
    hands: summaries,
    replayEvents,
    decisionTraces,
  });

  const lastSummary = summaries[summaries.length - 1]!;
  console.log('');
  console.log(`Replay events written to: ${OUTPUT_DIR}/${table.tableId}/`);
  console.log(`Last hand summary: ${OUTPUT_DIR}/${table.tableId}/${lastSummary.handId}.summary.json`);
  console.log(`Last hand replay: ${OUTPUT_DIR}/${table.tableId}/${lastSummary.handId}.replay.jsonl`);
  console.log(`Match artifact: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/manifest.json`);
  console.log(`Match summary: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/summary.json`);
  console.log(`Match replay: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/replay.jsonl`);
  console.log(`Match decision traces: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/decision-trace.jsonl`);
  console.log(`Match analysis summary: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/analysis-summary.json`);
  console.log('');
  console.log('====================================');
  console.log('Simulation complete!');
  console.log('====================================\n');
}

main().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
