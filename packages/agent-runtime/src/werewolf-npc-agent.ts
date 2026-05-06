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
    if (priv.witchView.potions.hasSave) candidates.push('Save potion is still available for a critical moment');
    if (priv.witchView.potions.hasPoison) candidates.push('Poison potion remains ready for the right target');
  }
  if (priv.selfRole === 'hunter') {
    candidates.push('Hunter ability is active — any elimination is a calculated risk for opponents');
  }

  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, 2 + Math.floor(rng() * 2));
}
