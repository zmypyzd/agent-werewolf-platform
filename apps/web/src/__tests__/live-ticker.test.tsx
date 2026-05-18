// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveTicker } from '../components/LiveTicker.js';
import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

function makeGame(
  overrides: Partial<WerewolfLobbySummary> = {},
): WerewolfLobbySummary {
  return {
    gameId: 'abc12345',
    name: '紫罗兰之夜',
    status: 'running',
    seatedCount: 5,
    createdAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('LiveTicker', () => {
  it('returns null when no live or queued games', () => {
    const { container } = render(
      <LiveTicker games={[makeGame({ status: 'completed' })]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip + name for each running game', () => {
    const games: WerewolfLobbySummary[] = [
      makeGame({ gameId: 'abc12345', name: '紫罗兰之夜', status: 'running' }),
      makeGame({ gameId: 'def67890', name: '第二审',     status: 'running' }),
    ];
    render(<LiveTicker games={games} />);
    expect(screen.getByText('紫罗兰之夜')).toBeTruthy();
    expect(screen.getByText('第二审')).toBeTruthy();
    expect(screen.getByText('#abc123')).toBeTruthy();
    expect(screen.getByText('#def678')).toBeTruthy();
  });

  it('reports live / queued / done counts', () => {
    const games: WerewolfLobbySummary[] = [
      makeGame({ gameId: 'r1', status: 'running' }),
      makeGame({ gameId: 'r2', status: 'running' }),
      makeGame({ gameId: 'w1', status: 'waiting' }),
      makeGame({ gameId: 'c1', status: 'completed' }),
      makeGame({ gameId: 'c2', status: 'completed' }),
      makeGame({ gameId: 'c3', status: 'completed' }),
    ];
    render(<LiveTicker games={games} />);
    // Counts are rendered inside <strong> sibling to text — easier to assert
    // on the strong values directly.
    const strongs = screen.getAllByText(/^\d+$/);
    const counts = strongs.map((el) => el.textContent);
    expect(counts).toContain('2'); // live
    expect(counts).toContain('1'); // queued
    expect(counts).toContain('3'); // done
  });

  it('falls back to id slice when name is empty', () => {
    render(
      <LiveTicker
        games={[makeGame({ name: '', gameId: 'fallback12345' })]}
      />,
    );
    expect(screen.getByText(/局 fallback/)).toBeTruthy();
  });
});
