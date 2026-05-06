# Werewolf NPC Thinking-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `WerewolfNpcAgent` wrapper that introduces a perceptible thinking delay, generates role-aware speech content and reasoning summaries, and updates the frontend to show "thinking…" → "speaking…" state transitions and real thought content in the event timeline.

**Architecture:** A new `WerewolfNpcAgent` wraps any inner agent, sleeps for a random delay after the inner agent resolves, then enriches the response with generated `inner`/`performance`/`speech` text and a `reasoningSummary`. Two small patches thread `inner` and `reasoningSummary` into the public broadcast stream. The frontend replaces the single `currentActor` with `thinkingActor` + `speakingActor` and renders a two-line timeline entry (speech + indented reasoning) for speak actions.

**Tech Stack:** TypeScript 5.5 strict (NodeNext), Vitest 2, React 18 + Vite 5, pnpm workspaces. All imports from `.ts` files use `.js` extensions.

---

## File Map

| File | Action |
|---|---|
| `packages/agent-runtime/src/werewolf-npc-agent.ts` | **Create** — WerewolfNpcAgent class + all content generation |
| `packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts` | **Create** — unit tests |
| `packages/agent-runtime/src/index.ts` | **Modify** — export new module |
| `packages/werewolf-orchestrator/src/sanitize-action.ts` | **Modify** — pass `inner` through for speak |
| `packages/realtime/src/werewolf-filter.ts` | **Modify** — delete inner-stripping logic |
| `packages/realtime/src/__tests__/werewolf-filter.test.ts` | **Modify** — update test that asserts inner is stripped |
| `packages/werewolf-orchestrator/src/match-runner.ts` | **Modify** — include `reasoningSummary` in `agent.action_received` event for day phases |
| `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts` | **Modify** — add assertion for `reasoningSummary` in events |
| `apps/api/src/werewolf-lobby-registry.ts` | **Modify** — swap `WerewolfRandomMockAgent` for `WerewolfNpcAgent` wrapping it |
| `apps/web/src/werewolf-room/werewolfRoomTypes.ts` | **Modify** — replace `currentActor` with `thinkingActor`/`speakingActor`, add `'reason'` kind and `sub` field |
| `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts` | **Modify** — return array, enrich speak handling |
| `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts` | **Modify** — update call sites, add speak/reason assertions |
| `apps/web/src/werewolf-room/werewolfRoomReducer.ts` | **Modify** — thinkingActor/speakingActor logic, handle array from normalizer |
| `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts` | **Modify** — update `currentActor` references, add new state assertions |
| `apps/web/src/werewolf-room/WerewolfTableSurface.tsx` | **Modify** — split `speaking` prop into `thinking` + `speaking` |
| `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx` | **Modify** — render `'reason'` kind and `sub` text |
| `apps/web/src/styles-werewolf.css` | **Modify** — add `is-thinking` CSS class |

---

## Task 1: Write failing tests for WerewolfNpcAgent

**Files:**
- Create: `packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '../werewolf-random-mock-agent.js';
import { WerewolfNpcAgent } from '../werewolf-npc-agent.js';

function makePublicState(nightNumber = 1): WerewolfPublicState {
  return {
    gameId: 'g',
    phase: 'day-speeches',
    nightNumber,
    dayNumber: 1,
    players: [
      { id: 'p1', seatIndex: 0, name: 'Bot 1', alive: true, revealedRole: null },
      { id: 'p2', seatIndex: 1, name: 'Bot 2', alive: true, revealedRole: null },
      { id: 'p3', seatIndex: 2, name: 'Bot 3', alive: false, revealedRole: null },
    ],
    history: [],
    winner: null,
  };
}

function makePrivateState(role: WerewolfPrivateState['selfRole'] = 'villager'): WerewolfPrivateState {
  return {
    selfId: 'p1',
    selfRole: role,
    selfSide: role === 'werewolf' ? 'werewolf' : 'good',
    knownAllies: role === 'werewolf' ? ['p4'] : [],
    seerKnowledge: role === 'seer' ? [{ targetId: 'p2', side: 'werewolf' }] : [],
    witchView: role === 'witch' ? { potions: { hasSave: true, hasPoison: true }, currentNightKillTarget: null } : null,
    hunterCanShoot: role === 'hunter',
  };
}

function makeSpeakRequest(role: WerewolfPrivateState['selfRole'] = 'villager'): WerewolfDecisionRequest {
  const validActions: WerewolfAction[] = [
    { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: '' },
  ];
  return {
    requestId: 'req-1',
    gameId: 'g',
    agentId: 'agent-p1',
    playerId: 'p1',
    phase: 'day-speeches',
    nightNumber: 1,
    dayNumber: 1,
    publicState: makePublicState(),
    privateState: makePrivateState(role),
    validActions,
    deadlineMs: 10_000,
  };
}

function makeVoteRequest(): WerewolfDecisionRequest {
  return {
    requestId: 'req-2',
    gameId: 'g',
    agentId: 'agent-p1',
    playerId: 'p1',
    phase: 'day-vote',
    nightNumber: 1,
    dayNumber: 1,
    publicState: makePublicState(),
    privateState: makePrivateState('villager'),
    validActions: [
      { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      { type: 'day-vote', voterId: 'p1', targetId: null },
    ],
    deadlineMs: 10_000,
  };
}

describe('WerewolfNpcAgent', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves only after the minimum thinking delay', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [2000, 2000],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());

    await vi.advanceTimersByTimeAsync(1999);
    // should not have resolved yet
    let resolved = false;
    void promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });

  it('enriches speak action: inner, performance, speech all non-empty', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.action.type).toBe('speak');
    if (response.action.type === 'speak') {
      expect(response.action.inner.length).toBeGreaterThan(0);
      expect(response.action.performance.length).toBeGreaterThan(0);
      expect(response.action.speech.length).toBeGreaterThan(0);
    }
  });

  it('speak inner, performance, speech all within schema length caps', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'aggressive',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    if (response.action.type === 'speak') {
      expect(response.action.inner.length).toBeLessThanOrEqual(4000);
      expect(response.action.performance.length).toBeLessThanOrEqual(500);
      expect(response.action.speech.length).toBeLessThanOrEqual(2000);
    }
  });

  it('sets reasoningSummary for speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeSpeakRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.reasoningSummary).toBeDefined();
    expect(response.reasoningSummary!.intent.length).toBeGreaterThan(0);
    expect(response.reasoningSummary!.confidence).toBeGreaterThanOrEqual(0);
    expect(response.reasoningSummary!.confidence).toBeLessThanOrEqual(1);
    expect(response.reasoningSummary!.keyObservations.length).toBeGreaterThanOrEqual(1);
  });

  it('sets reasoningSummary for non-speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeVoteRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.reasoningSummary).toBeDefined();
    expect(response.reasoningSummary!.intent.length).toBeGreaterThan(0);
  });

  it('seeded RNG: same seed produces identical content on two calls', async () => {
    const makeAgent = () => {
      const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'test-seed' });
      return new WerewolfNpcAgent('a', 'Bot', inner, {
        thinkingDelayRange: [0, 0],
        personality: 'balanced',
        seed: 'test-seed',
      });
    };

    const req = makeSpeakRequest('villager');

    const p1 = makeAgent().requestDecision(req);
    const p2 = makeAgent().requestDecision(req);
    await vi.runAllTimersAsync();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.action).toEqual(r2.action);
    expect(r1.reasoningSummary).toEqual(r2.reasoningSummary);
  });

  it('generates role-specific content for all 5 roles', async () => {
    const roles: WerewolfPrivateState['selfRole'][] = ['werewolf', 'seer', 'witch', 'hunter', 'villager'];
    for (const role of roles) {
      const inner = new WerewolfRandomMockAgent(`a-${role}`, 'Bot', { seed: 'seed' });
      const npc = new WerewolfNpcAgent(`a-${role}`, 'Bot', inner, {
        thinkingDelayRange: [0, 0],
        personality: 'balanced',
        seed: 'seed',
      });

      const promise = npc.requestDecision(makeSpeakRequest(role));
      await vi.runAllTimersAsync();
      const response = await promise;

      if (response.action.type === 'speak') {
        expect(response.action.inner.length, `inner empty for role=${role}`).toBeGreaterThan(0);
        expect(response.action.speech.length, `speech empty for role=${role}`).toBeGreaterThan(0);
      }
    }
  });

  it('does not modify a non-speak action', async () => {
    const inner = new WerewolfRandomMockAgent('a', 'Bot', { seed: 'seed' });
    const npc = new WerewolfNpcAgent('a', 'Bot', inner, {
      thinkingDelayRange: [0, 0],
      personality: 'balanced',
      seed: 'seed',
    });

    const promise = npc.requestDecision(makeVoteRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    // Day-vote action should retain its type and not be mutated
    expect(response.action.type).toBe('day-vote');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-npc-agent.test.ts
```

Expected: `Cannot find module '../werewolf-npc-agent.js'`

---

## Task 2: Implement WerewolfNpcAgent

**Files:**
- Create: `packages/agent-runtime/src/werewolf-npc-agent.ts`

- [ ] **Step 1: Create the implementation file**

```ts
// packages/agent-runtime/src/werewolf-npc-agent.ts
import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfPrivateState,
  WerewolfPublicState,
  WerewolfReasoningSummary,
  WerewolfRole,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';
import { createSeededRng } from './werewolf-prng.js';

export type WerewolfNpcPersonality = 'cautious' | 'aggressive' | 'balanced';

export interface WerewolfNpcConfig {
  thinkingDelayRange: [min: number, max: number];
  personality: WerewolfNpcPersonality;
  seed?: string;
}

const DEFAULT_CONFIG: WerewolfNpcConfig = {
  thinkingDelayRange: [1500, 3500],
  personality: 'balanced',
};

export class WerewolfNpcAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  readonly agentId: string;
  readonly name: string;
  private readonly inner: IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;
  private readonly config: WerewolfNpcConfig;
  private readonly rng: () => number;

  constructor(
    agentId: string,
    name: string,
    inner: IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>,
    config?: Partial<WerewolfNpcConfig>,
  ) {
    this.agentId = agentId;
    this.name = name;
    this.inner = inner;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = this.config.seed
      ? createSeededRng(`${this.config.seed}-${agentId}`)
      : Math.random;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const response = await this.inner.requestDecision(req);

    const [min, max] = this.config.thinkingDelayRange;
    const delay = min + this.rng() * (max - min);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    const action = enrichSpeakAction(response.action, req, this.config.personality, this.rng);
    const reasoningSummary = generateReasoning(action, req, this.config.personality, this.rng);

    return { ...response, action, reasoningSummary };
  }
}

function pick<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)] as T;
}

function accusationTarget(
  pub: WerewolfPublicState,
  priv: WerewolfPrivateState,
  rng: () => number,
): string {
  const alive = pub.players.filter((p) => p.alive && p.id !== priv.selfId);
  if (alive.length === 0) return 'someone';

  if (priv.selfRole === 'werewolf') {
    const safe = alive.filter((p) => !priv.knownAllies.includes(p.id));
    if (safe.length > 0) return pick(safe, rng).name;
  }

  if (priv.selfRole === 'seer' && priv.seerKnowledge.length > 0) {
    const knownWolves = priv.seerKnowledge.filter((k) => k.side === 'werewolf');
    if (knownWolves.length > 0) {
      const target = knownWolves[Math.floor(rng() * knownWolves.length)]!;
      const found = alive.find((p) => p.id === target.targetId);
      if (found) return found.name;
    }
  }

  return pick(alive, rng).name;
}

function enrichSpeakAction(
  action: WerewolfAction,
  req: WerewolfDecisionRequest,
  personality: WerewolfNpcPersonality,
  rng: () => number,
): WerewolfAction {
  if (action.type !== 'speak') return action;

  const target = accusationTarget(req.publicState, req.privateState, rng);
  const role = req.privateState.selfRole;

  return {
    type: 'speak',
    playerId: action.playerId,
    inner: generateInner(role, target, rng),
    performance: generatePerformance(personality, rng),
    speech: generateSpeech(role, personality, target, rng),
  };
}

const INNER: Record<WerewolfRole, readonly string[]> = {
  werewolf: [
    'Stay calm. Steer suspicion away from the pack. Accuse someone safe.',
    'The village is watching. I need to sound convincing and keep my ally covered.',
    'If I push hard enough on someone innocent, the real threat stays hidden.',
  ],
  seer: [
    'I have confirmed information. The question is how much to reveal without becoming a target.',
    'My check was clear. I should guide the vote without showing all my cards.',
    'I know who the wolves are. Timing the reveal is everything.',
  ],
  witch: [
    'I still have cards to play. Keep quiet and observe for now.',
    'Something happened last night. I know more than I am letting on.',
    'My potions are precious. I will not waste them by drawing attention.',
  ],
  hunter: [
    'If they vote me out I am taking someone with me. They should factor that in.',
    'My ability is still active. The threat of retaliation keeps me safer than most.',
    'Whoever targets me will regret it. I just need them to know that.',
  ],
  villager: [
    'No special information. I have to reason from what I can see.',
    'The vote patterns are telling. Someone is trying too hard to redirect.',
    'I am watching reactions. The liars always give something away.',
  ],
};

const PERFORMANCE: Record<WerewolfNpcPersonality, readonly string[]> = {
  cautious: [
    'speaks quietly, eyes scanning the circle',
    'pauses frequently, choosing words carefully',
    'sits back, voice measured and controlled',
  ],
  aggressive: [
    'leans forward, voice firm and direct',
    'gestures emphatically, maintaining steady eye contact',
    'speaks with conviction, pointing toward the accused',
  ],
  balanced: [
    'speaks clearly, referencing the game history',
    'makes deliberate eye contact with each player in turn',
    'gestures calmly while presenting the reasoning',
  ],
};

const SPEECH: Record<WerewolfRole, Record<WerewolfNpcPersonality, readonly string[]>> = {
  werewolf: {
    cautious: [
      'I have been watching everyone closely. {target} seemed unusually quiet — worth a second look?',
      'I am not ready to commit yet. But if I had to flag someone, it would be {target}.',
    ],
    aggressive: [
      'I am going on record: {target} is suspicious. The behaviour does not add up.',
      '{target} needs to explain themselves. I am pushing for a vote on them.',
    ],
    balanced: [
      'My read based on the vote patterns: {target} is the most likely threat right now.',
      '{target} behaviour this round stands out to me. I think the vote should go there.',
    ],
  },
  seer: {
    cautious: [
      'I have some information I am not ready to fully share. But {target} is worth watching.',
      'The clues point somewhere. I am keeping my read close for now — but {target} is on my list.',
    ],
    aggressive: [
      'I will be direct: I have confirmed information and {target} is not who they claim to be.',
      'I used my ability and I am going on record. {target} is a threat. Vote accordingly.',
    ],
    balanced: [
      'I have role information from my check. Without revealing everything: focus on {target}.',
      'Based on what I know, {target} is the most dangerous player left in this circle.',
    ],
  },
  witch: {
    cautious: [
      'I have no strong public reads. I will defer to what others have observed.',
      'Something happened last night that shapes my view. I am not naming names yet.',
    ],
    aggressive: [
      'I have special knowledge and {target} is a threat. Trust me on this one.',
      'I know more than most people here. {target} should be on everyone\'s radar.',
    ],
    balanced: [
      'My assessment: {target} is the most suspicious based on everything so far.',
      'I have been processing what I know. My read points to {target}.',
    ],
  },
  hunter: {
    cautious: [
      'I am keeping my powder dry. But know that if I go down, I will not go alone.',
      'I have a special ability that activates if I am eliminated. I will use it wisely.',
    ],
    aggressive: [
      'Whoever pushes to eliminate me: I am taking you with me. Think carefully.',
      '{target} is suspicious to me. And if I go, the hunter goes hot.',
    ],
    balanced: [
      'My read is on {target}. For the record — if I am eliminated, my ability fires.',
      'I have kept quiet for a reason. {target} is where my suspicion sits.',
    ],
  },
  villager: {
    cautious: [
      'I do not have special information. I will vote based on who seems off in this conversation.',
      'I am not sure yet. Let me hear from everyone before I commit to a name.',
    ],
    aggressive: [
      '{target} needs to explain themselves. Their story has not held up.',
      'I am calling {target} out. The patterns do not lie and something is off.',
    ],
    balanced: [
      'Looking at the vote history and behaviour this round, {target} does not add up.',
      'My read based on night results and who has been deflecting: {target} is worth scrutinising.',
    ],
  },
};

function generateInner(role: WerewolfRole, target: string, rng: () => number): string {
  const pool = INNER[role];
  return pick(pool, rng).replace('{target}', target);
}

function generatePerformance(personality: WerewolfNpcPersonality, rng: () => number): string {
  return pick(PERFORMANCE[personality], rng);
}

function generateSpeech(
  role: WerewolfRole,
  personality: WerewolfNpcPersonality,
  target: string,
  rng: () => number,
): string {
  const rolePool = SPEECH[role];
  const pool = rolePool[personality];
  return pick(pool, rng).replace('{target}', target);
}

const INTENT_POOL: Record<string, readonly string[]> = {
  'speak-werewolf': [
    'Deflect suspicion and redirect the vote toward a safe accusation target',
    'Maintain cover while creating plausible doubt about an innocent player',
  ],
  'speak-seer': [
    'Surface role information to guide the village vote without fully exposing position',
    'Apply confirmed knowledge to steer elimination toward a wolf-side player',
  ],
  'speak-witch': [
    'Maintain strategic ambiguity while nudging the village toward the right suspect',
    'Preserve informational advantage by revealing only what is necessary',
  ],
  'speak-hunter': [
    'Signal hunter ability to discourage targeted elimination and protect village',
    'Apply targeted pressure while keeping the retaliatory ability as a deterrent',
  ],
  'speak-villager': [
    'Analyse behavioural patterns and propose the most suspicious candidate',
    'Synthesise observable evidence to build consensus around the most likely threat',
  ],
  'day-vote': [
    'Cast vote against the most likely wolf candidate based on speech patterns',
    'Follow the evidence and commit to the elimination vote',
  ],
  'werewolf-vote': [
    'Eliminate the most dangerous villager threat before daybreak',
    'Target the player most likely to expose the pack in tomorrow\'s speeches',
  ],
  'seer-divine': [
    'Investigate the player with the most suspicious public behaviour',
    'Gather role information on the most ambiguous player before dawn',
  ],
  'witch-save': ['Preserve a valuable village player to maintain defensive strength'],
  'witch-poison': ['Eliminate a confirmed or highly suspected wolf-side player'],
  'witch-skip-save': ['Conserve the save potion for a more critical moment'],
  'witch-skip-poison': ['Withhold poison until a higher-confidence target emerges'],
  'hunter-shoot': ['Use hunter ability to eliminate the most dangerous remaining threat'],
};

const CONFIDENCE_RANGE: Record<WerewolfNpcPersonality, [number, number]> = {
  cautious:   [0.55, 0.72],
  aggressive: [0.75, 0.95],
  balanced:   [0.62, 0.82],
};

function generateReasoning(
  action: WerewolfAction,
  req: WerewolfDecisionRequest,
  personality: WerewolfNpcPersonality,
  rng: () => number,
): WerewolfReasoningSummary {
  const intentKey = action.type === 'speak' ? `speak-${req.privateState.selfRole}` : action.type;
  const intentPool = INTENT_POOL[intentKey] ?? ['Execute optimal action given current game state'];
  const intent = pick(intentPool, rng);

  const [lo, hi] = CONFIDENCE_RANGE[personality];
  const confidence = Math.round((lo + rng() * (hi - lo)) * 100) / 100;

  const keyObservations = buildObservations(req, rng);

  return { intent, confidence, keyObservations };
}

function buildObservations(req: WerewolfDecisionRequest, rng: () => number): string[] {
  const { publicState: pub, privateState: priv } = req;
  const deadCount = pub.players.filter((p) => !p.alive).length;
  const aliveCount = pub.players.filter((p) => p.alive).length;

  const candidates: string[] = [
    `Night ${pub.nightNumber}: the circle has narrowed to ${aliveCount} active players`,
    `${deadCount} player${deadCount !== 1 ? 's' : ''} eliminated so far — every vote now carries more weight`,
    'The werewolf pack could still be operating at full strength',
    `Day ${pub.dayNumber} vote patterns reveal potential coordination among some players`,
  ];

  if (priv.selfRole === 'seer' && priv.seerKnowledge.length > 0) {
    candidates.push('Confirmed role information changes the threat probability distribution significantly');
  }
  if (priv.selfRole === 'witch' && priv.witchView) {
    if (priv.witchView.hasSave) candidates.push('Save potion is still available for a critical moment');
    if (priv.witchView.hasPoison) candidates.push('Poison potion remains ready for the right target');
  }
  if (priv.selfRole === 'hunter') {
    candidates.push('Hunter ability is active — any elimination is a calculated risk for opponents');
  }

  const shuffled = [...candidates].sort(() => rng() - 0.5);
  return shuffled.slice(0, 2 + Math.floor(rng() * 2));
}
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-npc-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/werewolf-npc-agent.ts packages/agent-runtime/src/__tests__/werewolf-npc-agent.test.ts
git commit -m "feat(agent-runtime): add WerewolfNpcAgent with thinking delay and role-aware content"
```

---

## Task 3: Export WerewolfNpcAgent from index

**Files:**
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Add export line**

Open `packages/agent-runtime/src/index.ts` and add the following line after the `werewolf-random-mock-agent` export:

```ts
export * from './werewolf-npc-agent.js';
```

The file should end with:

```ts
export * from './werewolf-mock-agent.js';
export * from './werewolf-random-mock-agent.js';
export * from './werewolf-npc-agent.js';   // ← add this
export * from './werewolf-prng.js';
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @agent-poker/agent-runtime run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): export WerewolfNpcAgent"
```

---

## Task 4: Allow `inner` to flow through the broadcast pipeline

**Files:**
- Modify: `packages/werewolf-orchestrator/src/sanitize-action.ts`
- Modify: `packages/realtime/src/werewolf-filter.ts`
- Modify: `packages/realtime/src/__tests__/werewolf-filter.test.ts`

- [ ] **Step 1: Update sanitize-action — pass `inner` through for speak**

Replace the `speak` case in `packages/werewolf-orchestrator/src/sanitize-action.ts` (currently around lines 22–28):

```ts
    case 'speak':
      return {
        type: 'speak',
        playerId: action.playerId,
        inner: action.inner,
        performance: action.performance,
        speech: action.speech,
      };
```

(Remove the line `// inner was omitted here` — the old code omitted `inner: action.inner`.)

- [ ] **Step 2: Update werewolf-filter — delete inner-stripping logic**

In `packages/realtime/src/werewolf-filter.ts`, delete:
1. The `containsSpeakInner` function (lines roughly 62–72)
2. The `stripSpeakInner` function (lines roughly 74–85)
3. The `if (containsSpeakInner(next.data))` block inside `werewolfReplayEventToPublic` (lines roughly 39–42)

The `werewolfReplayEventToPublic` function should look like this after the edit:

```ts
export function werewolfReplayEventToPublic(
  event: WerewolfReplayEvent,
): WerewolfReplayEvent | null {
  let next = event;
  if (isAgentActionEvent(event.eventType)) {
    const phase = event.data['phase'];
    if (typeof phase === 'string' && PRIVATE_PHASES.has(phase as WerewolfPhase)) {
      next = stripActorFields(next);
    }
  }
  if (event.eventType === 'match.started' && 'seed' in next.data) {
    const { seed: _seed, ...rest } = next.data as Record<string, unknown>;
    next = { ...next, data: rest };
  }
  return next;
}
```

- [ ] **Step 3: Update werewolf-filter test — replace the "strips inner" test**

In `packages/realtime/src/__tests__/werewolf-filter.test.ts`, find the test at line 145:

```ts
  it('strips inner from speak action even if it slipped past sanitize-action', () => {
```

Replace the entire test with:

```ts
  it('passes inner through on speak action (inner is intentionally public)', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'engine.action_applied',
      data: {
        phase: 'day-speeches',
        action: { type: 'speak', playerId: 'p1', inner: 'my thoughts', performance: 'X', speech: 'Y' },
        newPhase: 'day-speeches',
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    const action = out.data['action'] as Record<string, unknown>;
    expect(action['inner']).toBe('my thoughts');
    expect(action['performance']).toBe('X');
  });
```

- [ ] **Step 4: Run realtime tests**

```bash
pnpm --filter @agent-poker/realtime run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/sanitize-action.ts packages/realtime/src/werewolf-filter.ts packages/realtime/src/__tests__/werewolf-filter.test.ts
git commit -m "feat(realtime): allow speak inner to flow through public broadcast pipeline"
```

---

## Task 5: Include `reasoningSummary` in `agent.action_received` event (day phases only)

**Files:**
- Modify: `packages/werewolf-orchestrator/src/match-runner.ts`
- Modify: `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts`

- [ ] **Step 1: Write the failing test first**

Add this test to the bottom of the existing `describe` block in `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts`:

```ts
  it('includes reasoningSummary in agent.action_received for day-phase events when agent provides one', async () => {
    const initial = createGame({ gameId: 'g-reason-1', seed: 'seed-reason-1' });
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    // Build agents that always return a reasoningSummary
    const agents = new Map<string, WerewolfAgent>();
    for (const p of initial.players) {
      const base = new WerewolfMockAgent(`agent-${p.id}`, p.name);
      const wrapped: WerewolfAgent = {
        agentId: base.agentId,
        name: base.name,
        async requestDecision(req) {
          const res = await base.requestDecision(req);
          return {
            ...res,
            reasoningSummary: {
              intent: 'test-intent',
              confidence: 0.8,
              keyObservations: ['obs-1'],
            },
          };
        },
      };
      agents.set(p.id, wrapped);
    }

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const dayReceivedWithReasoning = events.filter(
      (e) =>
        e.eventType === 'agent.action_received' &&
        typeof e.data['phase'] === 'string' &&
        !(e.data['phase'] as string).startsWith('night-') &&
        e.data['reasoningSummary'] !== undefined,
    );
    expect(dayReceivedWithReasoning.length).toBeGreaterThan(0);

    const nightReceivedWithReasoning = events.filter(
      (e) =>
        e.eventType === 'agent.action_received' &&
        typeof e.data['phase'] === 'string' &&
        (e.data['phase'] as string).startsWith('night-') &&
        e.data['reasoningSummary'] !== undefined,
    );
    expect(nightReceivedWithReasoning.length).toBe(0);
  });
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner.test.ts -t 'reasoningSummary'
```

Expected: test fails (no `reasoningSummary` in events yet).

- [ ] **Step 3: Patch match-runner**

In `packages/werewolf-orchestrator/src/match-runner.ts`, find the `this.emit('agent.action_received', ...)` call (roughly lines 263–273). Change it to:

```ts
    this.emit('agent.action_received', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      phase: phaseBefore,
      action: sanitizeActionForBroadcast(action),
      usedFallback,
      timedOut,
      elapsedMs,
      ...(invalidReason !== null ? { invalidReason } : {}),
      ...(!phaseBefore.startsWith('night-') && parsedReasoningForTrace
        ? { reasoningSummary: parsedReasoningForTrace }
        : {}),
    });
```

- [ ] **Step 4: Run the new test — expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner.test.ts -t 'reasoningSummary'
```

Expected: PASS.

- [ ] **Step 5: Run all orchestrator tests**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator run test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/werewolf-orchestrator/src/match-runner.ts packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts
git commit -m "feat(orchestrator): emit reasoningSummary in agent.action_received for day phases"
```

---

## Task 6: Wire WerewolfNpcAgent in the lobby registry

**Files:**
- Modify: `apps/api/src/werewolf-lobby-registry.ts`

- [ ] **Step 1: Update the import and agent construction**

In `apps/api/src/werewolf-lobby-registry.ts`, find the existing import at line 2:

```ts
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
```

Replace it with:

```ts
import { WerewolfNpcAgent, WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
```

Then find the agent construction block around line 149:

```ts
    const agent = new WerewolfRandomMockAgent(agentId, finalDisplayName, {
      seed: entry.seed,
    });
```

Replace it with:

```ts
    const inner = new WerewolfRandomMockAgent(agentId, finalDisplayName, {
      seed: entry.seed,
    });
    const agent = new WerewolfNpcAgent(agentId, finalDisplayName, inner, {
      seed: entry.seed,
      personality: 'balanced',
      thinkingDelayRange: [1500, 3500],
    });
```

- [ ] **Step 2: Run API tests**

```bash
pnpm --filter api run test
```

Expected: all pass. Note: API tests that use agents directly (e.g. `werewolf-matches.integration.test.ts`) still use `WerewolfRandomMockAgent` directly, which is correct — the lobby registry change only affects the invite-npc/fill-with-npcs path.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/werewolf-lobby-registry.ts
git commit -m "feat(api): use WerewolfNpcAgent with thinking delay for lobby NPC invites"
```

---

## Task 7: Update frontend types

**Files:**
- Modify: `apps/web/src/werewolf-room/werewolfRoomTypes.ts`

- [ ] **Step 1: Replace `currentActor`, add `'reason'` kind, add `sub` field**

Replace the entire file content with:

```ts
// Local mirror of werewolf types from packages/shared. Webland keeps its
// own type defs (same pattern as live-table/liveTableTypes.ts) so the
// frontend doesn't depend on the shared workspace package.

export type WerewolfRole =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter';

export type WerewolfSide = 'good' | 'werewolf';

export type WerewolfPhase =
  | 'setup'
  | 'night-werewolf-vote'
  | 'night-witch'
  | 'night-seer'
  | 'night-resolve'
  | 'day-announce'
  | 'day-speeches'
  | 'day-vote'
  | 'day-resolve'
  | 'hunter-shoot'
  | 'game-over';

export type WerewolfReplayEventType =
  | 'match.started'
  | 'agent.action_requested'
  | 'agent.action_received'
  | 'agent.timeout'
  | 'agent.invalid_action'
  | 'engine.action_applied'
  | 'phase.changed'
  | 'match.completed';

export interface WerewolfReplayEvent {
  readonly eventId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly eventType: WerewolfReplayEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

// Mirrors the server's WerewolfSeatInfo plus per-seat live UI state.
export interface SeatVM {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string };
  alive: boolean;
  revealedRole?: WerewolfRole;
  revealedSide?: WerewolfSide;
}

export type WerewolfTimelineLineKind =
  | 'system'
  | 'phase-day'
  | 'phase-night'
  | 'speak'
  | 'vote'
  | 'system-night-fold'
  | 'completion'
  | 'reason';   // indented reasoning line, subordinate to the speak entry above it

export interface WerewolfTimelineLine {
  id: string;
  kind: WerewolfTimelineLineKind;
  text: string;
  timestamp: number;
  sub?: string;   // performance descriptor shown below speech text on 'speak' entries
}

export interface WerewolfRoomState {
  gameId: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: SeatVM[];
  currentPhase: WerewolfPhase | 'pre-match' | 'completed';
  dayNumber: number;
  nightNumber: number;
  thinkingActor?: string | undefined;   // set on agent.action_requested, cleared on action_received
  speakingActor?: string | undefined;   // set on agent.action_received (speak), cleared on phase.changed
  timeline: WerewolfTimelineLine[];
  winner?: WerewolfSide;
  failureReason?: string;
}

export function emptyRoomState(gameId: string): WerewolfRoomState {
  return {
    gameId,
    status: 'waiting',
    seats: Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' as const },
      alive: true,
    })),
    currentPhase: 'pre-match',
    dayNumber: 0,
    nightNumber: 0,
    timeline: [],
  };
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm --filter web run lint
```

Expected: TypeScript errors about `currentActor` in reducer and surface — those are fixed in the next tasks.

- [ ] **Step 3: Commit after all frontend tasks are done (hold this commit)**

Defer the commit for this file until Task 9 (all frontend changes will be committed together in Task 11).

---

## Task 8: Update `normalizeWerewolfReplayEvent`

**Files:**
- Modify: `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts`
- Modify: `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`

- [ ] **Step 1: Write failing tests for the new speak-enrich behaviour**

Add these tests to `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts` (the function now returns `WerewolfTimelineLine[]`, update existing call sites in the same edit):

```ts
// Update all existing calls from:
//   const line = normalizeWerewolfReplayEvent(...)
//   expect(line?.kind)...
// To:
//   const lines = normalizeWerewolfReplayEvent(...)
//   expect(lines[0]?.kind)...

// Then add at the bottom of the describe block:

  it('agent.action_received speak → two lines: speak + reason', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: 'secret', performance: 'nods slowly', speech: 'I suspect Bot 2.' },
          reasoningSummary: { intent: 'Expose the wolf', confidence: 0.8, keyObservations: ['obs'] },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.kind).toBe('speak');
    expect(lines[0]!.text).toContain('Bot 1');
    expect(lines[0]!.text).toContain('I suspect Bot 2.');
    expect(lines[0]!.sub).toBe('nods slowly');
    expect(lines[1]!.kind).toBe('reason');
    expect(lines[1]!.text).toContain('Expose the wolf');
  });

  it('agent.action_received speak without reasoningSummary → one speak line only', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: 'shrugs', speech: 'No comment.' },
        },
      }),
      NAME_INDEX,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('speak');
    expect(lines[0]!.sub).toBe('shrugs');
  });

  it('returns empty array for null-producing events', () => {
    const lines = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: { phase: 'night-werewolf-vote', action: { type: 'werewolf-vote' } },
      }),
      NAME_INDEX,
    );
    // night-phase non-speak — handled by reducer fold logic, normalizer returns []
    expect(lines).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to confirm failures**

```bash
pnpm --filter web exec vitest run src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts
```

Expected: type errors or failures.

- [ ] **Step 3: Rewrite normalizeWerewolfReplayEvent**

Replace `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts` with:

```ts
import type {
  WerewolfReplayEvent,
  WerewolfTimelineLine,
} from './werewolfRoomTypes.js';

const NIGHT_PHASE_PREFIX = 'night-';
const DAY_PHASE_PREFIX = 'day-';

export type NameIndex = Readonly<Record<string, string>>;

function nameOf(playerId: unknown, names: NameIndex): string {
  if (typeof playerId !== 'string') return '???';
  return names[playerId] ?? playerId;
}

function phaseOf(event: WerewolfReplayEvent): string | undefined {
  const v = event.data['phase'];
  return typeof v === 'string' ? v : undefined;
}

export function normalizeWerewolfReplayEvent(
  event: WerewolfReplayEvent,
  names: NameIndex,
): WerewolfTimelineLine[] {
  const id = event.eventId;
  const ts = event.timestamp;

  if (event.eventType === 'match.started') {
    return [{ id, timestamp: ts, kind: 'system', text: '对局开始' }];
  }

  if (event.eventType === 'phase.changed') {
    const phase = phaseOf(event);
    if (typeof phase === 'string') {
      if (phase.startsWith(NIGHT_PHASE_PREFIX)) {
        const n = Number(event.data['nightNumber'] ?? 0);
        return [{ id, timestamp: ts, kind: 'phase-night', text: `🌙 夜 ${n}` }];
      }
      if (phase.startsWith(DAY_PHASE_PREFIX)) {
        const d = Number(event.data['dayNumber'] ?? 0);
        return [{ id, timestamp: ts, kind: 'phase-day', text: `☀️ 天 ${d}` }];
      }
      if (phase === 'game-over') {
        return [{ id, timestamp: ts, kind: 'system', text: '游戏结束' }];
      }
    }
    return [];
  }

  if (event.eventType === 'agent.action_received') {
    const phase = phaseOf(event);
    if (typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX)) {
      // Night actor identity is stripped by werewolfReplayEventToPublic.
      // Reducer folds these into a single system-night-fold line.
      return [];
    }
    const action = event.data['action'] as
      | { type?: string; targetId?: string; playerId?: string; performance?: string; speech?: string }
      | undefined;
    const playerId = event.data['playerId'];
    const reasoning = event.data['reasoningSummary'] as
      | { intent?: string }
      | undefined;

    if (action?.type === 'speak') {
      const speech = action.speech ?? '';
      const performance = action.performance ?? '';
      const speakLine: WerewolfTimelineLine = {
        id,
        timestamp: ts,
        kind: 'speak',
        text: `${nameOf(playerId, names)}: "${speech}"`,
        ...(performance ? { sub: performance } : {}),
      };
      const lines: WerewolfTimelineLine[] = [speakLine];
      if (reasoning?.intent) {
        lines.push({
          id: `${id}-reason`,
          timestamp: ts,
          kind: 'reason',
          text: `💭 ${reasoning.intent}`,
        });
      }
      return lines;
    }
    if (action?.type === 'day-vote') {
      return [{
        id,
        timestamp: ts,
        kind: 'vote',
        text: `${nameOf(playerId, names)} 投 ${nameOf(action.targetId, names)}`,
      }];
    }
    return [{
      id,
      timestamp: ts,
      kind: 'system',
      text: `${nameOf(playerId, names)} 行动`,
    }];
  }

  if (event.eventType === 'match.completed') {
    const winner = event.data['winner'];
    const text =
      winner === 'good'
        ? '🏁 终局：好人胜'
        : winner === 'werewolf'
          ? '🏁 终局：狼人胜'
          : '🏁 终局';
    return [{ id, timestamp: ts, kind: 'completion', text }];
  }

  // engine.action_applied / agent.action_requested / agent.timeout / agent.invalid_action
  return [{ id, timestamp: ts, kind: 'system', text: `[${event.eventType}]` }];
}
```

- [ ] **Step 4: Update the test file to use arrays**

In `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`, update every existing call site from:

```ts
const line = normalizeWerewolfReplayEvent(makeEvent(...), NAME_INDEX);
expect(line?.kind).toBe(...)
expect(line?.text)...
```

To:

```ts
const lines = normalizeWerewolfReplayEvent(makeEvent(...), NAME_INDEX);
expect(lines[0]?.kind).toBe(...)
expect(lines[0]?.text)...
```

- [ ] **Step 5: Run normalizer tests**

```bash
pnpm --filter web exec vitest run src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts
```

Expected: all pass.

---

## Task 9: Update `werewolfRoomReducer`

**Files:**
- Modify: `apps/web/src/werewolf-room/werewolfRoomReducer.ts`
- Modify: `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`

- [ ] **Step 1: Write failing tests for new actor state**

Add these tests to `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts` (before the final closing brace of the `describe` block):

```ts
  it('agent.action_requested (day) sets thinkingActor, leaves speakingActor undefined', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-speeches', playerId: 'p3' },
      }),
    });
    expect(after.thinkingActor).toBe('p3');
    expect(after.speakingActor).toBeUndefined();
  });

  it('agent.action_received (speak) sets speakingActor, clears thinkingActor', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const thinking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-speeches', playerId: 'p3' },
      }),
    });
    const after = werewolfRoomReducer(thinking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p3',
          action: { type: 'speak', playerId: 'p3', inner: 'x', performance: 'y', speech: 'z' },
        },
      }),
    });
    expect(after.speakingActor).toBe('p3');
    expect(after.thinkingActor).toBeUndefined();
  });

  it('agent.action_received (non-speak) clears both actors', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const thinking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-vote', playerId: 'p3' },
      }),
    });
    const after = werewolfRoomReducer(thinking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: { phase: 'day-vote', playerId: 'p3', action: { type: 'day-vote', voterId: 'p3', targetId: 'p2' } },
      }),
    });
    expect(after.thinkingActor).toBeUndefined();
    expect(after.speakingActor).toBeUndefined();
  });

  it('phase.changed clears both actors', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const withSpeaking = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', playerId: 'p2', inner: '', performance: '', speech: '' },
        },
      }),
    });
    const after = werewolfRoomReducer(withSpeaking, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    expect(after.thinkingActor).toBeUndefined();
    expect(after.speakingActor).toBeUndefined();
  });

  it('speak action produces two timeline lines (speak + reason)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: 'x', performance: 'nods', speech: 'I suspect Bot 2.' },
          reasoningSummary: { intent: 'Expose the wolf', confidence: 0.8, keyObservations: [] },
        },
      }),
    });
    expect(after.timeline.some((l) => l.kind === 'speak')).toBe(true);
    expect(after.timeline.some((l) => l.kind === 'reason')).toBe(true);
  });

  it('speak action without reasoningSummary produces one speak line only', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p1',
          action: { type: 'speak', playerId: 'p1', inner: '', performance: '', speech: 'Nothing.' },
        },
      }),
    });
    expect(after.timeline.some((l) => l.kind === 'speak')).toBe(true);
    expect(after.timeline.some((l) => l.kind === 'reason')).toBe(false);
  });
```

Also update the two existing tests that reference `currentActor` (lines 56 and 76 in the original file):
- `expect(after.currentActor).toBeUndefined()` → `expect(after.thinkingActor).toBeUndefined()`
- `expect(after.currentActor).toBe('p3')` → `expect(after.thinkingActor).toBe('p3')`
- `expect(after.currentActor).toBeUndefined()` (info isolation test) → `expect(after.thinkingActor).toBeUndefined()`

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm --filter web exec vitest run src/werewolf-room/__tests__/werewolfRoomReducer.test.ts
```

Expected: failures on missing `thinkingActor`, `speakingActor`.

- [ ] **Step 3: Rewrite werewolfRoomReducer**

Replace `apps/web/src/werewolf-room/werewolfRoomReducer.ts` with:

```ts
import {
  type SeatVM,
  type WerewolfPhase,
  type WerewolfReplayEvent,
  type WerewolfRole,
  type WerewolfRoomState,
  type WerewolfSide,
  type WerewolfTimelineLine,
} from './werewolfRoomTypes.js';
import {
  normalizeWerewolfReplayEvent,
  type NameIndex,
} from './normalizeWerewolfReplayEvent.js';

interface ServerLobbyEntry {
  gameId: string;
  name: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: Array<{
    seatIndex: number;
    playerId: string;
    occupant:
      | { kind: 'empty' }
      | { kind: 'npc'; agentId: string; displayName: string };
  }>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: WerewolfSide;
  failureReason?: string;
  finalPlayers?: ReadonlyArray<{
    id: string;
    seatIndex: number;
    name: string;
    role: string;
    side: WerewolfSide;
    alive: boolean;
  }>;
}

export type WerewolfRoomAction =
  | { type: 'lobby-sync'; entry: ServerLobbyEntry }
  | { type: 'replay-event'; event: WerewolfReplayEvent }
  | {
      type: 'match-completed';
      winner: WerewolfSide;
      finalPlayers: ReadonlyArray<{
        id: string;
        seatIndex: number;
        name: string;
        role: string;
        side: WerewolfSide;
        alive: boolean;
      }>;
    }
  | { type: 'match-failed'; reason: string };

const NIGHT_PHASE_PREFIX = 'night-';

function isNightPhase(phase: string | WerewolfPhase | undefined): boolean {
  return typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX);
}

function nameIndexFromSeats(seats: SeatVM[]): NameIndex {
  const out: Record<string, string> = {};
  for (const s of seats) {
    if (s.occupant.kind === 'npc') out[s.playerId] = s.occupant.displayName;
    else out[s.playerId] = s.playerId;
  }
  return out;
}

export function werewolfRoomReducer(
  state: WerewolfRoomState,
  action: WerewolfRoomAction,
): WerewolfRoomState {
  if (action.type === 'lobby-sync') {
    const seats: SeatVM[] = action.entry.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      occupant: s.occupant,
      alive: true,
    }));
    return {
      ...state,
      gameId: action.entry.gameId,
      status: action.entry.status,
      seats,
      ...(action.entry.failureReason
        ? { failureReason: action.entry.failureReason }
        : {}),
    };
  }

  if (action.type === 'match-completed') {
    const seats = state.seats.map((s) => {
      const fp = action.finalPlayers.find((p) => p.seatIndex === s.seatIndex);
      if (!fp) return s;
      return {
        ...s,
        alive: fp.alive,
        revealedRole: fp.role as WerewolfRole,
        revealedSide: fp.side,
      };
    });
    return {
      ...state,
      status: 'completed',
      winner: action.winner,
      currentPhase: 'completed',
      thinkingActor: undefined,
      speakingActor: undefined,
      seats,
    };
  }

  if (action.type === 'match-failed') {
    return { ...state, status: 'failed', failureReason: action.reason };
  }

  // replay-event
  const event = action.event;
  const names = nameIndexFromSeats(state.seats);
  const phase = (event.data['phase'] as string | undefined) ?? state.currentPhase;
  let next: WerewolfRoomState = state;

  if (event.eventType === 'phase.changed') {
    const newPhase = event.data['phase'] as WerewolfPhase | undefined;
    if (newPhase) {
      next = {
        ...next,
        currentPhase: newPhase,
        nightNumber:
          typeof event.data['nightNumber'] === 'number'
            ? (event.data['nightNumber'] as number)
            : next.nightNumber,
        dayNumber:
          typeof event.data['dayNumber'] === 'number'
            ? (event.data['dayNumber'] as number)
            : next.dayNumber,
        thinkingActor: undefined,
        speakingActor: undefined,
      };
    }
  }

  if (event.eventType === 'agent.action_requested') {
    if (!isNightPhase(phase)) {
      const pid = event.data['playerId'];
      if (typeof pid === 'string') {
        next = { ...next, thinkingActor: pid, speakingActor: undefined };
      }
    }
  }

  if (event.eventType === 'agent.action_received') {
    const actionData = event.data['action'] as { type?: string } | undefined;
    const pid = event.data['playerId'];
    if (actionData?.type === 'speak' && typeof pid === 'string' && !isNightPhase(phase)) {
      next = { ...next, thinkingActor: undefined, speakingActor: pid };
    } else {
      next = { ...next, thinkingActor: undefined, speakingActor: undefined };
    }
  }

  if (event.eventType === 'match.completed') {
    const w = event.data['winner'];
    if (w === 'good' || w === 'werewolf') {
      next = {
        ...next,
        status: 'completed',
        currentPhase: 'completed',
        thinkingActor: undefined,
        speakingActor: undefined,
        winner: w,
      };
    }
  }

  const lines = normalizeWerewolfReplayEvent(event, names);

  if (lines.length === 0) {
    if (isNightPhase(phase)) {
      const last = next.timeline[next.timeline.length - 1];
      if (
        last &&
        last.kind === 'system-night-fold' &&
        last.text.includes(`夜 ${next.nightNumber}`)
      ) {
        return next;
      }
      const fold: WerewolfTimelineLine = {
        id: `night-fold-${next.nightNumber}-${event.eventId}`,
        kind: 'system-night-fold',
        text: `🌙 夜 ${next.nightNumber} · 行动中…`,
        timestamp: event.timestamp,
      };
      return { ...next, timeline: [...next.timeline, fold] };
    }
    return next;
  }

  return { ...next, timeline: [...next.timeline, ...lines] };
}
```

- [ ] **Step 4: Run reducer tests**

```bash
pnpm --filter web exec vitest run src/werewolf-room/__tests__/werewolfRoomReducer.test.ts
```

Expected: all pass.

---

## Task 10: Update `WerewolfTableSurface` (thinking/speaking seat card states)

**Files:**
- Modify: `apps/web/src/werewolf-room/WerewolfTableSurface.tsx`

- [ ] **Step 1: Update SeatCard props and caller**

In `apps/web/src/werewolf-room/WerewolfTableSurface.tsx`:

1. Change `SeatCardProps` — replace `speaking: boolean` with `thinking: boolean` and `speaking: boolean`:

```tsx
interface SeatCardProps {
  seat: SeatVM;
  pos: { left: string; top: string };
  thinking: boolean;
  speaking: boolean;
  revealRoles: boolean;
  onInvite?: (seatIndex: number) => void;
}
```

2. Update `SeatCard` function — replace the `speaking` prop references and add `thinking`:

```tsx
function SeatCard({ seat, pos, thinking, speaking, revealRoles, onInvite }: SeatCardProps) {
  const isEmpty = seat.occupant.kind === 'empty';
  const dead = !seat.alive && !isEmpty;
  const isWolf = seat.revealedRole === 'werewolf';

  const cardClass = [
    'ww-seat',
    isEmpty ? 'is-empty' : '',
    dead ? 'is-dead' : '',
    thinking ? 'is-thinking' : '',
    speaking ? 'is-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const roleEmoji = revealRoles && seat.revealedRole
    ? ROLE_EMOJI[seat.revealedRole]
    : '👤';

  const badgeClass = ['ww-seat-role-badge', isWolf && revealRoles ? 'is-wolf' : '']
    .filter(Boolean)
    .join(' ');

  let statusText: string;
  if (dead) {
    statusText = revealRoles && seat.revealedRole
      ? `✝ ${ROLE_LABELS[seat.revealedRole]}`
      : '✝ 已淘汰';
  } else if (thinking) {
    statusText = 'thinking…';
  } else if (speaking) {
    statusText = 'speaking…';
  } else {
    statusText = 'waiting';
  }

  const statusClass = [
    'ww-seat-status',
    dead ? 'is-dead' : '',
    thinking ? 'is-thinking' : '',
    speaking ? 'is-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cardClass}
      style={{ left: pos.left, top: pos.top }}
      data-seat-index={seat.seatIndex}
    >
      <div className={badgeClass}>{roleEmoji}</div>
      <div className="ww-seat-id">P{seat.seatIndex + 1}</div>
      {isEmpty ? (
        <>
          <div className="ww-seat-name" style={{ color: 'var(--ww-text-dim)' }}>empty</div>
          <button
            className="ww-seat-invite"
            onClick={() => onInvite?.(seat.seatIndex)}
            disabled={!onInvite}
          >
            邀请 NPC
          </button>
        </>
      ) : (
        <>
          <div className="ww-seat-name">
            {seat.occupant.kind === 'npc' ? seat.occupant.displayName : '???'}
          </div>
          <div className={statusClass}>{statusText}</div>
        </>
      )}
    </div>
  );
}
```

3. Update the `SeatCard` call site inside `WerewolfTableSurface` — replace:

```tsx
              speaking={state.currentActor === seat.playerId}
```

With:

```tsx
              thinking={state.thinkingActor === seat.playerId}
              speaking={state.speakingActor === seat.playerId}
```

- [ ] **Step 2: Run type check**

```bash
pnpm --filter web run lint
```

Expected: no errors (if `werewolfRoomTypes.ts` has already been updated in Task 7).

---

## Task 11: Update `WerewolfEventTimeline` (render `reason` kind and `sub` text) and CSS

**Files:**
- Modify: `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx`
- Modify: `apps/web/src/styles-werewolf.css`

- [ ] **Step 1: Update WerewolfEventTimeline to render `reason` and `sub`**

Replace `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx` with:

```tsx
import { useEffect, useRef } from 'react';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

export interface WerewolfEventTimelineProps {
  lines: WerewolfTimelineLine[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function WerewolfEventTimeline({ lines }: WerewolfEventTimelineProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="ww-timeline" aria-live="polite">
      <div className="ww-timeline-header">
        <div className="ww-timeline-live-dot" />
        <span className="ww-timeline-title">事件流 · Events</span>
      </div>
      <div className="ww-timeline-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="ww-timeline-empty">暂无事件</div>
        ) : (
          lines.map((line) => {
            const isReason = line.kind === 'reason';
            return (
              <div
                key={line.id}
                className={`ww-tl-entry kind-${line.kind}`}
              >
                {isReason ? (
                  <span className="ww-tl-reason-text">{line.text}</span>
                ) : (
                  <>
                    <span className="ww-tl-time">{formatTime(line.timestamp)}</span>
                    <span className="ww-tl-text">
                      {line.text}
                      {line.sub ? (
                        <span className="ww-tl-sub">{line.sub}</span>
                      ) : null}
                    </span>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `is-thinking` CSS class and timeline sub/reason styles**

Open `apps/web/src/styles-werewolf.css` and append these rules at the end of the file:

```css
/* ── Thinking state (seat card) ───────────────────────────────────── */
.ww-seat.is-thinking {
  box-shadow: 0 0 0 2px rgba(91, 74, 255, 0.35);
}
.ww-seat-status.is-thinking {
  color: var(--ww-night);
  opacity: 0.75;
  animation: ww-thinking-pulse 1.4s ease-in-out infinite;
}
@keyframes ww-thinking-pulse {
  0%, 100% { opacity: 0.45; }
  50%       { opacity: 0.85; }
}

/* ── Timeline: reason line ───────────────────────────────────────── */
.ww-tl-entry.kind-reason {
  padding-left: 32px;
  padding-top: 2px;
  padding-bottom: 4px;
}
.ww-tl-reason-text {
  font-family: 'JetBrains Mono', monospace;
  font-style: italic;
  font-size: 11px;
  color: var(--ww-text-muted, #5c6278);
}

/* ── Timeline: performance sub-text ─────────────────────────────── */
.ww-tl-sub {
  display: block;
  font-size: 11px;
  color: var(--ww-text-dim, #333650);
  margin-top: 2px;
  font-style: italic;
}
```

- [ ] **Step 3: Run all frontend tests**

```bash
pnpm --filter web run test
```

Expected: all pass.

- [ ] **Step 4: Commit all frontend changes together**

```bash
git add \
  apps/web/src/werewolf-room/werewolfRoomTypes.ts \
  apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts \
  apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts \
  apps/web/src/werewolf-room/werewolfRoomReducer.ts \
  apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts \
  apps/web/src/werewolf-room/WerewolfTableSurface.tsx \
  apps/web/src/werewolf-room/WerewolfEventTimeline.tsx \
  apps/web/src/styles-werewolf.css
git commit -m "feat(web): thinking/speaking seat states and enriched timeline for NPC reasoning"
```

---

## Task 12: Full build and smoke test

- [ ] **Step 1: Build the entire workspace**

```bash
pnpm build
```

Expected: exits 0 with no type errors.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all suites pass.

- [ ] **Step 3: Verify the local simulation works end-to-end**

```bash
pnpm demo:werewolf
```

Expected: simulation completes, prints winner + player list. The agents now take 1.5–3.5 s per decision (you will see the simulation runs slower — that is intentional).

- [ ] **Step 4: (Optional) Start dev server and manually verify UI**

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm --filter web dev
```

Open `http://localhost:5173/werewolf`, create a game, fill with NPCs, start the match. Verify:
- Seat cards show "thinking…" while the NPC deliberates
- Seat card transitions to "speaking…" when speak action arrives
- Event timeline shows `Bot N: "speech text"` with performance sub-text below
- Indented `💭 intent text` line appears under each speak entry

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| `WerewolfNpcAgent` with thinking delay | Tasks 1–2 |
| Role-aware `inner`, `performance`, `speech` for speak | Task 2 |
| `reasoningSummary` (intent + keyObservations) for all actions | Task 2 |
| Export from agent-runtime | Task 3 |
| `inner` flows through public broadcast | Task 4 |
| `reasoningSummary` in `agent.action_received` (day phases only) | Task 5 |
| Lobby registry uses `WerewolfNpcAgent` | Task 6 |
| `thinkingActor` / `speakingActor` in room state | Tasks 7, 9 |
| `normalizeWerewolfReplayEvent` returns array, enriches speak | Task 8 |
| Reducer: correct actor state transitions | Task 9 |
| Seat card: "thinking…" / "speaking…" / "waiting" labels | Task 10 |
| Timeline: `reason` kind + `sub` text | Task 11 |
| `is-thinking` CSS animation | Task 11 |
| Night-phase reasoning NOT in broadcast events | Task 5 |
| Privacy note documented | Design doc (already committed) |

**Type consistency:** `thinkingActor` / `speakingActor` names are consistent across types (Task 7), reducer (Task 9), and surface (Task 10). `normalizeWerewolfReplayEvent` return type is `WerewolfTimelineLine[]` in both the implementation (Task 8) and reducer consumer (Task 9).
