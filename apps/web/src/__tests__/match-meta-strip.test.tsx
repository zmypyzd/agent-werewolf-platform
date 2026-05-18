// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchMetaStrip } from '../components/MatchMetaStrip.js';
import {
  emptyRoomState,
  type WerewolfRoomState,
} from '../werewolf-room/werewolfRoomTypes.js';

function makeState(overrides: Partial<WerewolfRoomState> = {}): WerewolfRoomState {
  return {
    ...emptyRoomState('a3f9b2c8-deadbeef'),
    ...overrides,
  };
}

describe('MatchMetaStrip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows WAITING pill and falls back to id slice when no name', () => {
    render(<MatchMetaStrip state={makeState()} />);
    expect(screen.getByText('WAITING')).toBeTruthy();
    // gameId.slice(0, 8) = "a3f9b2c8"
    expect(screen.getByText('a3f9b2c8')).toBeTruthy();
  });

  it('shows the match name when provided', () => {
    render(<MatchMetaStrip state={makeState()} name="紫罗兰之夜" />);
    expect(screen.getByText('紫罗兰之夜')).toBeTruthy();
  });

  it('renders LIVE pill while running and shows elapsed time', () => {
    const startedAt = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(startedAt + 3 * 60 * 1000 + 42 * 1000); // 03:42 elapsed
    render(
      <MatchMetaStrip
        state={makeState({ status: 'running' })}
        startedAt={startedAt}
      />,
    );
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText('00:03:42')).toBeTruthy();
  });

  it('reports the freshest round (day vs night) as a separate pill', () => {
    render(
      <MatchMetaStrip
        state={makeState({ status: 'running', dayNumber: 2, nightNumber: 3 })}
      />,
    );
    expect(screen.getByText('NIGHT 3')).toBeTruthy();
  });

  it('prefers DAY when day and night numbers are tied', () => {
    render(
      <MatchMetaStrip
        state={makeState({ status: 'running', dayNumber: 2, nightNumber: 2 })}
      />,
    );
    expect(screen.getByText('DAY 2')).toBeTruthy();
  });

  it('shows failure reason inline when status is failed', () => {
    render(
      <MatchMetaStrip
        state={makeState({ status: 'failed', failureReason: 'engine crashed' })}
      />,
    );
    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText('engine crashed')).toBeTruthy();
  });

  it('omits the elapsed cell when startedAt is undefined', () => {
    render(<MatchMetaStrip state={makeState({ status: 'waiting' })} />);
    expect(screen.queryByText(/^\d\d:\d\d:\d\d$/)).toBeNull();
  });
});
