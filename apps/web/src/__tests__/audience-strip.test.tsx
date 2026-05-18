// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AudienceStrip } from '../components/AudienceStrip.js';

describe('AudienceStrip', () => {
  it('renders a watch count and reaction emoji buttons', () => {
    render(<AudienceStrip watching={12} episodeId="a3f9b2c8" />);
    expect(screen.getByText('AUDIENCE')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/EP-a3f9b/)).toBeTruthy();
    // Each reaction has an aria-labelled button.
    expect(screen.getByLabelText(/React ❤️/)).toBeTruthy();
    expect(screen.getByLabelText(/React 🔥/)).toBeTruthy();
  });

  it('defaults to a self-only watch count when prop omitted', () => {
    render(<AudienceStrip />);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('omits the EP badge when episodeId is missing', () => {
    render(<AudienceStrip watching={3} />);
    expect(screen.queryByText(/EP-/)).toBeNull();
  });

  it('increments the reaction count when a button is clicked', () => {
    render(<AudienceStrip watching={1} />);
    const btn = screen.getByLabelText(/React 🔥/);
    act(() => {
      btn.click();
      btn.click();
      btn.click();
    });
    // The 3 is inside the same button.
    expect(btn.textContent).toMatch(/3/);
  });
});
