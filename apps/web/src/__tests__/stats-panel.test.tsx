// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatsPanel } from '../components/StatsPanel.js';
import {
  emptyRoomState,
  type SeatVM,
  type WerewolfRoomState,
} from '../werewolf-room/werewolfRoomTypes.js';

function makeSeat(overrides: Partial<SeatVM> = {}): SeatVM {
  return {
    seatIndex: 0,
    playerId: 'p1',
    occupant: { kind: 'npc', agentId: 'a1', displayName: 'Nova-1' },
    alive: true,
    ...overrides,
  };
}

function makeState(seats: SeatVM[], overrides: Partial<WerewolfRoomState> = {}): WerewolfRoomState {
  return {
    ...emptyRoomState('g-test'),
    seats,
    status: 'running',
    ...overrides,
  };
}

describe('StatsPanel', () => {
  it('counts alive seats with a populated bar', () => {
    const seats: SeatVM[] = [
      makeSeat({ seatIndex: 0, playerId: 'p1', alive: true }),
      makeSeat({ seatIndex: 1, playerId: 'p2', alive: true }),
      makeSeat({ seatIndex: 2, playerId: 'p3', alive: false, causeOfDeath: 'wolf-kill' }),
    ];
    render(<StatsPanel state={makeState(seats)} />);
    expect(screen.getByText('ALIVE')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // alive count
    expect(screen.getByText('/ 3')).toBeTruthy(); // total occupied
  });

  it('shows wolves remaining when roles are revealed', () => {
    const seats: SeatVM[] = [
      makeSeat({ seatIndex: 0, playerId: 'p1', alive: true, revealedRole: 'werewolf' }),
      makeSeat({ seatIndex: 1, playerId: 'p2', alive: false, revealedRole: 'werewolf', causeOfDeath: 'banishment' }),
      makeSeat({ seatIndex: 2, playerId: 'p3', alive: true, revealedRole: 'villager' }),
    ];
    render(<StatsPanel state={makeState(seats)} />);
    expect(screen.getByText('WOLVES REMAINING')).toBeTruthy();
    expect(screen.getByText('of 2 initial')).toBeTruthy();
  });

  it('shows "身份未揭晓" when no roles revealed yet', () => {
    const seats: SeatVM[] = [
      makeSeat({ seatIndex: 0, playerId: 'p1', alive: true }),
      makeSeat({ seatIndex: 1, playerId: 'p2', alive: true }),
    ];
    render(<StatsPanel state={makeState(seats)} />);
    expect(screen.getByText('身份未揭晓')).toBeTruthy();
  });

  it('renders the speaker card pointing at the speaking actor', () => {
    const seats: SeatVM[] = [
      makeSeat({ seatIndex: 2, playerId: 'p3', occupant: { kind: 'npc', agentId: 'a3', displayName: 'Quark-3' }, alive: true, revealedRole: 'seer' }),
    ];
    render(<StatsPanel state={makeState(seats, { speakingActor: 'p3' })} />);
    expect(screen.getByText('Quark-3')).toBeTruthy();
    expect(screen.getByText('SEAT P3')).toBeTruthy();
  });

  it('shows "无人发言" when no one is speaking', () => {
    const seats: SeatVM[] = [makeSeat()];
    render(<StatsPanel state={makeState(seats, { speakingActor: undefined })} />);
    expect(screen.getByText('无人发言')).toBeTruthy();
  });

  it('lists recent kills with cause labels', () => {
    const seats: SeatVM[] = [
      makeSeat({ seatIndex: 0, playerId: 'p1', occupant: { kind: 'npc', agentId: 'a1', displayName: 'Nova-1' }, alive: false, causeOfDeath: 'wolf-kill' }),
      makeSeat({ seatIndex: 5, playerId: 'p6', occupant: { kind: 'npc', agentId: 'a6', displayName: 'Tau-6' }, alive: false, causeOfDeath: 'witch-poison' }),
    ];
    render(<StatsPanel state={makeState(seats)} />);
    expect(screen.getByText('Nova-1')).toBeTruthy();
    expect(screen.getByText('✝ 被狼刀')).toBeTruthy();
    expect(screen.getByText('✝ 被毒')).toBeTruthy();
  });

  it('shows "尚无淘汰" when no deaths yet', () => {
    const seats: SeatVM[] = [makeSeat({ alive: true })];
    render(<StatsPanel state={makeState(seats)} />);
    expect(screen.getByText('尚无淘汰')).toBeTruthy();
  });
});
