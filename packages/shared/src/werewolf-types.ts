export type WerewolfRole =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter';

export type WerewolfSide = 'werewolf' | 'good';

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

export type WerewolfPlayerId = string;

export interface WerewolfPlayer {
  readonly id: WerewolfPlayerId;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WitchPotionState {
  readonly hasSave: boolean;
  readonly hasPoison: boolean;
}

export interface NightActionRecord {
  readonly werewolfTarget: WerewolfPlayerId | null;
  readonly witchSaved: WerewolfPlayerId | null;
  readonly witchPoisoned: WerewolfPlayerId | null;
  readonly seerTarget: WerewolfPlayerId | null;
  readonly seerResult: WerewolfSide | null;
}

export interface SpeechRecord {
  readonly playerId: WerewolfPlayerId;
  readonly inner: string;
  readonly performance: string;
  readonly speech: string;
}

export interface DayVoteRecord {
  readonly votes: ReadonlyArray<{ voterId: WerewolfPlayerId; targetId: WerewolfPlayerId | null }>;
  readonly tally: Readonly<Record<WerewolfPlayerId, number>>;
  readonly banished: WerewolfPlayerId | null;
  readonly pkRound: number;
  readonly tied: boolean;
}

export type WerewolfHistoryEntry =
  | { readonly type: 'role-assigned'; readonly playerId: WerewolfPlayerId; readonly role: WerewolfRole }
  | { readonly type: 'night-action'; readonly night: number; readonly record: NightActionRecord }
  | { readonly type: 'death'; readonly day: number; readonly playerId: WerewolfPlayerId; readonly cause: 'wolf-kill' | 'witch-poison' | 'banishment' | 'hunter-shoot' }
  | { readonly type: 'speech'; readonly day: number; readonly record: SpeechRecord }
  | { readonly type: 'vote'; readonly day: number; readonly record: DayVoteRecord }
  | { readonly type: 'hunter-shoot'; readonly shooterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId | null }
  | { readonly type: 'game-over'; readonly winner: WerewolfSide };

export interface PendingNightActions {
  readonly werewolfVotes: Readonly<Record<WerewolfPlayerId, WerewolfPlayerId>>;
  readonly witchSaved: WerewolfPlayerId | null;
  readonly witchPoisoned: WerewolfPlayerId | null;
  readonly seerTarget: WerewolfPlayerId | null;
  readonly seerResult: WerewolfSide | null;
}

export interface PendingHunterShoot {
  readonly hunterId: WerewolfPlayerId;
  readonly cause: 'wolf-kill' | 'witch-poison' | 'banishment';
}

export interface WerewolfGameState {
  readonly gameId: string;
  readonly seed: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly players: ReadonlyArray<WerewolfPlayer>;
  readonly witchPotions: WitchPotionState;
  readonly pendingNight: PendingNightActions;
  readonly pendingDaySpeeches: ReadonlyArray<SpeechRecord>;
  readonly pendingDayVote: DayVoteRecord | null;
  readonly pendingHunterShoot: PendingHunterShoot | null;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly winner: WerewolfSide | null;
}

export type WerewolfAction =
  | { readonly type: 'werewolf-vote'; readonly voterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-save'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-save' }
  | { readonly type: 'witch-poison'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-poison' }
  | { readonly type: 'seer-divine'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'speak'; readonly playerId: WerewolfPlayerId; readonly inner: string; readonly performance: string; readonly speech: string }
  | { readonly type: 'day-vote'; readonly voterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId | null }
  | { readonly type: 'hunter-shoot'; readonly targetId: WerewolfPlayerId | null };

export interface WerewolfPublicState {
  readonly gameId: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly players: ReadonlyArray<{
    readonly id: WerewolfPlayerId;
    readonly seatIndex: number;
    readonly name: string;
    readonly alive: boolean;
    readonly revealedRole: WerewolfRole | null;
  }>;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly winner: WerewolfSide | null;
}

export interface WerewolfPrivateState {
  readonly selfId: WerewolfPlayerId;
  readonly selfRole: WerewolfRole;
  readonly selfSide: WerewolfSide;
  readonly knownAllies: ReadonlyArray<WerewolfPlayerId>;
  readonly seerKnowledge: ReadonlyArray<{ readonly targetId: WerewolfPlayerId; readonly side: WerewolfSide }>;
  readonly witchView: {
    readonly potions: WitchPotionState;
    readonly currentNightKillTarget: WerewolfPlayerId | null;
  } | null;
  readonly hunterCanShoot: boolean;
}
