import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { RealtimeHub } from '@agent-poker/realtime';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;

beforeEach(async () => {
  hub = new RealtimeHub();
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  attachment = attachWerewolfHub(orch, hub);

  app = buildServer({
    hub,
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
    werewolfHubAttachment: attachment,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<{ sid: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register ${email} failed: ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sid = /apk_sid=([^;]+)/.exec(setCookie)?.[1];
  if (!sid) throw new Error('no apk_sid');
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `apk_sid=${sid}` } });
  const meBody = await me.json() as { data: { user: { userId: string } } };
  return { sid, userId: meBody.data.user.userId };
}

function connectWs(sid: string): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers: { cookie: `apk_sid=${sid}` } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function awaitMessage(messages: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 4000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('awaitMessage timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function setupAndRunMatch(gameId: string, ownerships: Array<{ userId: string }>): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  const ownership = ownerships.map((o, i) => ({ playerId: initialState.players[i]!.id, userId: o.userId }));
  attachment.attachMatch(matchId, ownership);
  await orch.runMatch(matchId);
}

describe('werewolf WS topics', () => {
  it('match:<gameId> is publicly subscribable and emits replay events with no actor identity in night phases', async () => {
    const alice = await registerAs('a-werewolf@x.test');
    const a = await connectWs(alice.sid);
    a.ws.send(JSON.stringify({ topic: 'match:g-public', type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: 'match:g-public', type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-public' && m['type'] === 'pong');

    await setupAndRunMatch('g-public', []);

    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-public' && m['type'] === 'match.completed');

    const matchFrames = a.messages.filter((m) => m['topic'] === 'match:g-public' && m['type'] !== 'pong');
    expect(matchFrames.length).toBeGreaterThan(0);
    const nightFrames = matchFrames.filter(
      (m) =>
        ['agent.action_requested', 'agent.action_received'].includes(m['type'] as string) &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(((m['payload'] as Record<string, unknown>)['phase'] as string)),
    );
    expect(nightFrames.length).toBeGreaterThan(0);
    for (const f of nightFrames) {
      expect((f['payload'] as Record<string, unknown>)['playerId']).toBeUndefined();
      expect((f['payload'] as Record<string, unknown>)['agentId']).toBeUndefined();
    }

    a.ws.close();
  }, 10_000);

  it('player:<userId>:<gameId> is delivered only to the owning user', async () => {
    const alice = await registerAs('alice-w@x.test');
    const bob = await registerAs('bob-w@x.test');
    const a = await connectWs(alice.sid);
    const b = await connectWs(bob.sid);

    const aliceTopic = `player:${alice.userId}:g-priv`;
    const bobTopic = `player:${bob.userId}:g-priv`;

    a.ws.send(JSON.stringify({ topic: aliceTopic, type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: aliceTopic, type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === aliceTopic && m['type'] === 'pong');

    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    await setupAndRunMatch('g-priv', [{ userId: alice.userId }, { userId: bob.userId }]);

    await awaitMessage(a.messages, (m) => m['topic'] === aliceTopic && m['type'] === 'werewolf.private_state');
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');

    // Alice never sees Bob's player topic frames.
    const aliceCrossTopic = a.messages.filter((m) => m['topic'] === bobTopic);
    expect(aliceCrossTopic).toHaveLength(0);

    a.ws.close();
    b.ws.close();
  }, 10_000);

  it('rejects subscribe to bare match: topic (empty gameId)', async () => {
    const alice = await registerAs('alice-bare-match@x.test');
    const a = await connectWs(alice.sid);

    // Subscribe to the malformed bare 'match:' topic. The gate must drop it.
    a.ws.send(JSON.stringify({ topic: 'match:', type: 'subscribe', payload: {} }));

    // Positive control: a follow-up subscribe to a real topic must still work,
    // proving the bare-'match:' rejection was a clean no-op (no crash, no
    // socket close, no leaked state).
    a.ws.send(JSON.stringify({ topic: 'match:g-bare-real', type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: 'match:g-bare-real', type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-bare-real' && m['type'] === 'pong');

    // Negative-space assertion: publishing on the literal bare 'match:' topic
    // must not reach the client. (The hub already silently never publishes to
    // that exact topic in production, but we publish here directly to confirm
    // the gate refused the subscribe rather than silently accepting it.)
    hub.publish('match:', { topic: 'match:', type: 'leak.probe', payload: { canary: true } });

    // Run a real match on the positive-control topic so we get genuine
    // delivery on 'match:g-bare-real' and prove the WS connection is healthy.
    await setupAndRunMatch('g-bare-real', []);
    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-bare-real' && m['type'] === 'match.completed');

    const leak = a.messages.filter((m) => m['topic'] === 'match:' && m['type'] === 'leak.probe');
    expect(leak).toHaveLength(0);

    a.ws.close();
  }, 10_000);

  it('rejects subscribe to player:<userId>: with empty gameId', async () => {
    const alice = await registerAs('alice-empty-game@x.test');
    const a = await connectWs(alice.sid);

    const emptyGameTopic = `player:${alice.userId}:`;
    // Subscribe to the malformed empty-gameId topic. The gate must drop it.
    a.ws.send(JSON.stringify({ topic: emptyGameTopic, type: 'subscribe', payload: {} }));

    // Positive control: subscribe to a real player topic and prove it works.
    const realTopic = `player:${alice.userId}:g-empty-real`;
    a.ws.send(JSON.stringify({ topic: realTopic, type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: realTopic, type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === realTopic && m['type'] === 'pong');

    // Negative-space assertion: publishing on the malformed empty-gameId topic
    // must not reach the client.
    hub.publish(emptyGameTopic, { topic: emptyGameTopic, type: 'leak.probe', payload: { canary: true } });

    // Run a match where Alice is a player on g-empty-real so she actually
    // receives private state on the real topic — proves the WS+gate path works.
    await setupAndRunMatch('g-empty-real', [{ userId: alice.userId }]);
    await awaitMessage(a.messages, (m) => m['topic'] === realTopic && m['type'] === 'werewolf.private_state');

    const leak = a.messages.filter((m) => m['topic'] === emptyGameTopic && m['type'] === 'leak.probe');
    expect(leak).toHaveLength(0);

    a.ws.close();
  }, 10_000);

  it("a client cannot subscribe to another user's player topic — server-side gate drops the subscribe", async () => {
    const alice = await registerAs('alice-gate@x.test');
    const bob = await registerAs('bob-gate@x.test');
    const a = await connectWs(alice.sid);
    const b = await connectWs(bob.sid);

    // Bob legitimately subscribes to his own topic so he WILL receive frames.
    const bobTopic = `player:${bob.userId}:g-gate`;
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    // Alice tries to subscribe to Bob's player topic — the server-side gate
    // must silently drop the subscribe.
    a.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    await setupAndRunMatch('g-gate', [{ userId: bob.userId }, { userId: bob.userId }]);

    // Bob receives private state on his own topic.
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');

    // Alice never sees Bob's private state — confirms the gate worked.
    const aliceFrames = a.messages.filter((m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');
    expect(aliceFrames).toHaveLength(0);

    a.ws.close();
    b.ws.close();
  }, 10_000);
});
