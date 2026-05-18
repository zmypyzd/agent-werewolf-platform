// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HeroCard } from '../components/HeroCard.js';
import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

describe('HeroCard', () => {
  it('renders an empty-state CTA when there is no featured match', () => {
    render(wrap(<HeroCard featured={null} />));
    expect(screen.getByText('还没有正在进行的对局')).toBeTruthy();
  });

  it('renders the match name + LIVE pill + JOIN BROADCAST when featured', () => {
    const game: WerewolfLobbySummary = {
      gameId: 'a3f9b2c8',
      name: '紫罗兰之夜',
      status: 'running',
      seatedCount: 9,
      createdAt: Date.now(),
    };
    render(wrap(<HeroCard featured={game} />));
    expect(screen.getByText('紫罗兰之夜')).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText(/JOIN BROADCAST/)).toBeTruthy();
    expect(screen.getByText('9/9 seated')).toBeTruthy();
    // Link target points at the room route, not the lobby.
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/werewolf/a3f9b2c8');
  });

  it('falls back to id slice when name is empty', () => {
    render(
      wrap(
        <HeroCard
          featured={{
            gameId: 'fallback00000',
            name: '',
            status: 'running',
            seatedCount: 3,
            createdAt: Date.now(),
          }}
        />,
      ),
    );
    expect(screen.getByText(/局 fallback/)).toBeTruthy();
  });
});
