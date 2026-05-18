// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GameRow } from '../components/GameRow.js';
import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

function makeGame(
  overrides: Partial<WerewolfLobbySummary> = {},
): WerewolfLobbySummary {
  return {
    gameId: 'a3f9b2c8',
    name: '紫罗兰之夜',
    status: 'running',
    seatedCount: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('GameRow', () => {
  it('links to the room and renders running pill + name + WATCH CTA', () => {
    render(wrap(<GameRow game={makeGame()} />));
    expect(screen.getByText('紫罗兰之夜')).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    expect(screen.getByText(/▶ WATCH/)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/werewolf/a3f9b2c8');
  });

  it('uses REPLAY CTA for completed games', () => {
    render(wrap(<GameRow game={makeGame({ status: 'completed' })} />));
    expect(screen.getByText('COMPLETED')).toBeTruthy();
    expect(screen.getByText('REPLAY')).toBeTruthy();
  });

  it('uses OPEN CTA for waiting games', () => {
    render(wrap(<GameRow game={makeGame({ status: 'waiting' })} />));
    expect(screen.getByText('WAITING')).toBeTruthy();
    expect(screen.getByText(/OPEN/)).toBeTruthy();
  });

  it('falls back to id slice when name is empty', () => {
    render(wrap(<GameRow game={makeGame({ name: '' })} />));
    expect(screen.getByText('a3f9b2c8')).toBeTruthy();
  });

  it('renders a seated-state meta cell', () => {
    render(wrap(<GameRow game={makeGame({ seatedCount: 7 })} />));
    expect(screen.getByText('7/9')).toBeTruthy();
  });
});
