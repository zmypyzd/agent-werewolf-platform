import type { WerewolfRole, WerewolfSide } from './werewolf-types.js';

export const WEREWOLF_TOTAL_PLAYERS = 9 as const;

export const WEREWOLF_ROLE_DISTRIBUTION: ReadonlyArray<WerewolfRole> = [
  'werewolf', 'werewolf', 'werewolf',
  'villager', 'villager', 'villager',
  'seer',
  'witch',
  'hunter',
];

export const WEREWOLF_ROLE_TO_SIDE: Readonly<Record<WerewolfRole, WerewolfSide>> = {
  werewolf: 'werewolf',
  villager: 'good',
  seer: 'good',
  witch: 'good',
  hunter: 'good',
};

export const WEREWOLF_MAX_PK_ROUNDS = 3 as const;

export const WEREWOLF_NAME_POOL: ReadonlyArray<string> = [
  '天狼', '星辰', '明月',
  '清风', '流水', '青山',
  '先知', '灵巫', '猎手',
];
