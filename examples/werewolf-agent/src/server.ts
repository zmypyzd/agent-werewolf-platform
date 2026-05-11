import http from 'http';

const PORT = 8080;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  seatIndex: number;
  name: string;
  alive: boolean;
  revealedRole: string | null;
}

interface HistoryEvent {
  type: string;
  [key: string]: unknown;
}

interface PublicState {
  phase: string;
  nightNumber: number;
  dayNumber: number;
  players: Player[];
  history: HistoryEvent[];
  winner: string | null;
}

interface SeerEntry { targetId: string; side: 'werewolf' | 'good' }

interface WitchView {
  potions: { hasSave: boolean; hasPoison: boolean };
  currentNightKillTarget: string | null;
}

interface PrivateState {
  selfId: string;
  selfRole: 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';
  selfSide: 'werewolf' | 'good';
  knownAllies: string[];
  seerKnowledge: SeerEntry[];
  witchView: WitchView | null;
  hunterCanShoot: boolean;
}

interface WerewolfAction {
  type: string;
  playerId?: string;
  inner?: string;
  performance?: string;
  speech?: string;
  voterId?: string;
  targetId?: string | null;
  [key: string]: unknown;
}

interface DecisionRequest {
  requestId: string;
  gameId: string;
  agentId: string;
  playerId: string;
  phase: string;
  nightNumber: number;
  dayNumber: number;
  publicState: PublicState;
  privateState: PrivateState;
  validActions: WerewolfAction[];
  deadlineMs: number;
}

// ─── Strategy helpers ─────────────────────────────────────────────────────────

// Pick a random element
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// Players alive other than self
function otherAlive(players: Player[], selfId: string): Player[] {
  return players.filter(p => p.alive && p.id !== selfId);
}

// Most suspicious: appeared in most vote tallies as a target
function mostSuspicious(players: Player[], history: HistoryEvent[], exclude: string[]): string | null {
  const tally: Record<string, number> = {};
  for (const ev of history) {
    if (ev.type === 'vote') {
      const record = (ev as { record?: { tally?: Record<string, number> } }).record;
      for (const [id, n] of Object.entries(record?.tally ?? {})) {
        if (!exclude.includes(id)) tally[id] = (tally[id] ?? 0) + n;
      }
    }
  }
  const candidates = Object.entries(tally).filter(([id]) =>
    players.find(p => p.id === id && p.alive)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]![0];
}

// IDs the seer knows are wolves
function knownWolves(seerKnowledge: SeerEntry[]): string[] {
  return seerKnowledge.filter(e => e.side === 'werewolf').map(e => e.targetId);
}

// IDs already divined
function alreadyDivined(seerKnowledge: SeerEntry[]): string[] {
  return seerKnowledge.map(e => e.targetId);
}

// ─── Speeches ────────────────────────────────────────────────────────────────

const PERFORMANCES = [
  'speaks quietly, eyes scanning the circle',
  'leans forward, voice firm and direct',
  'pauses frequently, choosing words carefully',
  'speaks clearly, referencing the game history',
  'makes deliberate eye contact with each player in turn',
  'gestures emphatically, maintaining steady eye contact',
];

function buildSpeech(req: DecisionRequest): WerewolfAction {
  const { privateState, publicState, playerId } = req;
  const { selfRole, selfSide, seerKnowledge, knownAllies } = privateState;
  const alive = otherAlive(publicState.players, playerId);

  const performance = pick(PERFORMANCES);
  let inner: string;
  let speech: string;

  if (selfSide === 'werewolf') {
    // Wolf: act innocent, deflect
    const deflectTarget = pick(alive.filter(p => !knownAllies.includes(p.id)));
    inner = `I'm a werewolf. I must appear innocent and steer suspicion away. Deflecting toward ${deflectTarget?.id ?? 'someone'}.`;
    const options = [
      `I've been watching everyone carefully. ${deflectTarget ? `Seat ${deflectTarget.seatIndex} (${deflectTarget.id}) has seemed very quiet — that worries me.` : 'Nothing suspicious yet from me.'}`,
      `I'm a villager trying to find the wolves. Let's think logically about who benefits from chaos. I suspect the quiet players.`,
      `${deflectTarget ? `${deflectTarget.id} has been deflecting questions all game. I'm not comfortable with that.` : 'I have no strong read yet. Let us hear more before we vote.'}`,
    ];
    speech = pick(options);
  } else if (selfRole === 'seer') {
    const wolves = knownWolves(seerKnowledge);
    if (wolves.length > 0) {
      inner = `Seer: I have confirmed ${wolves.join(', ')} as wolf/wolves. I should reveal this.`;
      speech = `I am the seer! I have checked ${wolves[0]} and confirmed they are a WEREWOLF. We must vote them out today!`;
    } else {
      const goodChecked = seerKnowledge.filter(e => e.side === 'good');
      inner = `Seer: I have checked ${goodChecked.length} players and found no wolves yet. I need to be careful revealing too early.`;
      speech = goodChecked.length > 0
        ? `I have information but I need to be careful. I can vouch for ${goodChecked[0]!.targetId} — they are on the good side.`
        : `I am gathering information. Let us not rush the vote today.`;
    }
  } else if (selfRole === 'witch') {
    inner = `Witch: I need to protect the good side. ${privateState.witchView?.potions.hasSave ? 'I still have my save potion.' : ''} ${privateState.witchView?.potions.hasPoison ? 'I still have my poison.' : ''}`;
    speech = pick([
      'I have a feeling about who the wolves are. Let us hear from everyone before voting.',
      'I am watching the patterns. Someone is lying — their story does not add up.',
      'Be careful about who we vote out. We cannot afford to lose a good player.',
    ]);
  } else if (selfRole === 'hunter') {
    inner = `Hunter: I should be strategic. If I die, I take someone with me. I should establish credibility.`;
    speech = pick([
      'I will be direct: I am suspicious of the players who push hardest for others to be voted out without evidence.',
      'Let us focus on behavior patterns, not just accusations. Who has been inconsistent?',
      'I have been paying close attention. Some players here are not who they claim to be.',
    ]);
  } else {
    // Villager
    const topSuspect = mostSuspicious(publicState.players, publicState.history, [playerId]);
    inner = `Villager: analyzing the situation. Top suspect based on votes: ${topSuspect ?? 'unclear'}.`;
    if (topSuspect) {
      speech = pick([
        `Looking at the vote history, ${topSuspect} keeps getting targeted — there might be a reason for that. I want to hear their defense.`,
        `${topSuspect} has been drawing a lot of attention. Either they are a wolf or someone is framing them. Let them speak.`,
        `I am leaning toward ${topSuspect} as suspicious based on the patterns I have seen so far.`,
      ]);
    } else {
      speech = pick([
        'I do not have a strong read yet. Let us hear everyone before we commit to a vote.',
        'Day one is always hard. I want to base my vote on reason, not just gut feeling.',
        'The wolves are among us, staying quiet. Watch who deflects and who asks good questions.',
      ]);
    }
  }

  return {
    type: 'speak',
    playerId,
    inner,
    performance,
    speech,
  };
}

// ─── Decision logic ───────────────────────────────────────────────────────────

function decide(req: DecisionRequest): WerewolfAction {
  const { phase, validActions, privateState, publicState, playerId } = req;
  const { selfRole, selfSide, seerKnowledge, knownAllies, witchView, hunterCanShoot } = privateState;

  if (validActions.length === 0) throw new Error('No valid actions');

  // day-speeches
  if (phase === 'day-speeches') {
    const speechTemplate = validActions.find(a => a.type === 'speak');
    if (speechTemplate) {
      return buildSpeech(req);
    }
  }

  // day-vote
  if (phase === 'day-vote') {
    const wolves = selfSide === 'werewolf' ? [] : knownWolves(seerKnowledge);
    const allies = selfSide === 'werewolf' ? [playerId, ...knownAllies] : [];
    const alive = otherAlive(publicState.players, playerId);

    // Prefer confirmed wolves
    for (const wolfId of wolves) {
      const action = validActions.find(a => a.type === 'day-vote' && a.targetId === wolfId);
      if (action) return action;
    }

    // Avoid self and allies
    const suspicious = mostSuspicious(publicState.players, publicState.history, [...allies, playerId]);
    if (suspicious) {
      const action = validActions.find(a => a.type === 'day-vote' && a.targetId === suspicious);
      if (action) return action;
    }

    // Pick a random non-ally non-self alive player
    const candidate = pick(alive.filter(p => !allies.includes(p.id)));
    if (candidate) {
      const action = validActions.find(a => a.type === 'day-vote' && a.targetId === candidate.id);
      if (action) return action;
    }

    // Fall back to first action (abstain or first candidate)
    return validActions[0]!;
  }

  // night-werewolf-vote
  if (phase === 'night-werewolf-vote') {
    // Prefer confirmed good players from seer (if any wolf somehow has that info)
    const voteActions = validActions.filter(a => a.type === 'werewolf-vote');
    if (voteActions.length > 0) return pick(voteActions);
    return validActions[0]!;
  }

  // night-seer
  if (phase === 'night-seer') {
    const divined = alreadyDivined(seerKnowledge);
    const undivined = validActions.filter(a => a.type === 'seer-divine' && !divined.includes(a.targetId as string));
    if (undivined.length > 0) return pick(undivined);
    const any = validActions.filter(a => a.type === 'seer-divine');
    if (any.length > 0) return pick(any);
    return validActions[0]!;
  }

  // night-witch
  if (phase === 'night-witch') {
    if (!witchView) return validActions[0]!;

    // Save sub-step
    const saveAction = validActions.find(a => a.type === 'witch-save');
    if (saveAction && witchView.potions.hasSave && witchView.currentNightKillTarget) {
      // Save if the target is likely a good player (not a known wolf)
      const wolves = knownWolves(seerKnowledge); // witch doesn't have seer knowledge, but just in case
      if (!wolves.includes(witchView.currentNightKillTarget)) {
        return saveAction;
      }
    }

    // Poison sub-step
    const poisonActions = validActions.filter(a => a.type === 'witch-poison');
    if (poisonActions.length > 0 && witchView.potions.hasPoison) {
      // Poison a known wolf if we know one
      const wolves = knownWolves(seerKnowledge);
      for (const wolfId of wolves) {
        const action = poisonActions.find(a => a.targetId === wolfId);
        if (action) return action;
      }
      // Otherwise skip poison (save it)
    }

    // Skip
    return validActions.find(a => a.type === 'witch-skip-save' || a.type === 'witch-skip-poison') ?? validActions[0]!;
  }

  // hunter-shoot
  if (phase === 'hunter-shoot' && hunterCanShoot) {
    const wolves = knownWolves(seerKnowledge);
    for (const wolfId of wolves) {
      const action = validActions.find(a => a.type === 'hunter-shoot' && a.targetId === wolfId);
      if (action) return action;
    }
    // Shoot the most suspicious alive player
    const alive = otherAlive(publicState.players, playerId);
    const suspicious = mostSuspicious(publicState.players, publicState.history, [playerId]);
    if (suspicious) {
      const action = validActions.find(a => a.type === 'hunter-shoot' && a.targetId === suspicious);
      if (action) return action;
    }
    // Shoot random alive player
    const target = pick(alive);
    if (target) {
      const action = validActions.find(a => a.type === 'hunter-shoot' && a.targetId === target.id);
      if (action) return action;
    }
    return validActions[0]!;
  }

  return validActions[0]!;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: 'WerewolfAgent' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/decide') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += String(chunk); });
  req.on('end', () => {
    try {
      const decisionReq = JSON.parse(body) as DecisionRequest;
      const { requestId, agentId, playerId, phase, privateState } = decisionReq;

      console.log(
        `[${new Date().toISOString()}] ${phase} req=${requestId.slice(-8)} ` +
        `player=${playerId} role=${privateState.selfRole} side=${privateState.selfSide}`
      );

      const action = decide(decisionReq);
      console.log(`  → ${JSON.stringify(action).slice(0, 120)}`);

      const responseBody = {
        requestId,
        agentId,
        action,
        reasoningSummary: {
          intent: `${privateState.selfRole} acting in ${phase}`,
          confidence: 0.75,
          keyObservations: [
            `Role: ${privateState.selfRole} (${privateState.selfSide})`,
            `Alive: ${decisionReq.publicState.players.filter(p => p.alive).length} players`,
          ],
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    } catch (err) {
      console.error('Handler error:', err);
      res.writeHead(500);
      res.end('Internal error');
    }
  });
});

server.listen(PORT, () => {
  console.log(`✓ WerewolfAgent listening on http://localhost:${PORT}/decide`);
});
