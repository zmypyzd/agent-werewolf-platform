// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WerewolfChannelCard } from '../components/WerewolfChannelCard.js';

describe('WerewolfChannelCard', () => {
  it('renders title, sub, and chips with model-variant classes', () => {
    render(
      <WerewolfChannelCard
        title="AGENT ARENA · WEREWOLF EP-47"
        sub="9 AI agents · 5 roles · omniscient spectator broadcast"
        chips={[
          { label: '3 × GPT-4', variant: 'gpt' },
          { label: '4 × Claude', variant: 'claude' },
          { label: '2 × Llama', variant: 'llama' },
          { label: 'SEED #a3f7c2e1' },
          { label: 'v0.4.2', variant: 'neutral' },
        ]}
      />,
    );

    expect(screen.getByText('AGENT ARENA · WEREWOLF EP-47')).toBeTruthy();
    expect(screen.getByText(/omniscient spectator broadcast/)).toBeTruthy();

    expect(screen.getByText('3 × GPT-4').className).toContain('is-gpt');
    expect(screen.getByText('4 × Claude').className).toContain('is-claude');
    expect(screen.getByText('2 × Llama').className).toContain('is-llama');

    // Neutral / undefined variants get the base .ww-chip class without
    // a model accent — verify both forms collapse to the same thing.
    const seed = screen.getByText('SEED #a3f7c2e1');
    const version = screen.getByText('v0.4.2');
    expect(seed.className).toBe('ww-chip');
    expect(version.className).toBe('ww-chip');
  });

  it('falls back to a role-roster placeholder when no role art is provided', () => {
    render(<WerewolfChannelCard title="Match name" />);
    expect(screen.getByText(/Role roster/i)).toBeTruthy();
  });

  it('renders supplied role-art images instead of the placeholder', () => {
    render(
      <WerewolfChannelCard
        title="Match name"
        roleArt={[
          { src: 'data:image/webp;base64,AAA', alt: 'villager' },
          { src: 'data:image/webp;base64,BBB', alt: 'werewolf' },
        ]}
      />,
    );

    expect(screen.getByAltText('villager')).toBeTruthy();
    expect(screen.getByAltText('werewolf')).toBeTruthy();
    expect(screen.queryByText(/Role roster/i)).toBeNull();
  });

  it('omits the chip strip and sub line when those props are not provided', () => {
    render(<WerewolfChannelCard title="Bare minimum" />);
    expect(screen.getByText('Bare minimum')).toBeTruthy();
    expect(screen.queryByText(/×/)).toBeNull();
  });
});
