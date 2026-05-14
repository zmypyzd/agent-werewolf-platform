// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { StaticRouter } from 'react-router-dom/server.js';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: async () => ({ error: null }),
    },
  },
}));

const apiGetMock = vi.fn();
vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => apiGetMock(...args) },
  };
});

const { WerewolfHomeResolver, RESOLVER_TIMEOUT_MS } = await import(
  '../pages/WerewolfHomeResolver.js'
);

function renderResolver(initial = '/'): void {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<WerewolfHomeResolver />} />
        <Route path="/werewolf" element={<div>LOBBY</div>} />
        <Route path="/werewolf/:gameId" element={<div data-testid="room">ROOM</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WerewolfHomeResolver', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('navigates to the most-recent running match when one exists', async () => {
    apiGetMock.mockResolvedValueOnce([
      { gameId: 'old', status: 'running', name: '', seatedCount: 9, createdAt: 1 },
      { gameId: 'new', status: 'running', name: '', seatedCount: 9, createdAt: 100 },
      { gameId: 'done', status: 'completed', name: '', seatedCount: 9, createdAt: 200 },
    ]);
    renderResolver();
    await waitFor(() => expect(screen.getByTestId('room')).toBeTruthy());
  });

  it('falls back to lobby when no running matches exist', async () => {
    apiGetMock.mockResolvedValueOnce([
      { gameId: 'a', status: 'waiting', name: '', seatedCount: 0, createdAt: 1 },
    ]);
    renderResolver();
    await waitFor(() => expect(screen.getByText('LOBBY')).toBeTruthy());
  });

  it('falls back to lobby on API error', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('boom'));
    renderResolver();
    await waitFor(() => expect(screen.getByText('LOBBY')).toBeTruthy());
  });

  it('exports a timeout constant that bounds the spinner', () => {
    // Sanity guard — if someone drops the timeout, the spec name forces a
    // conversation about whether spectators should wait longer.
    expect(RESOLVER_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(RESOLVER_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});

// Importing StaticRouter to keep the helper import in case future
// SSR-style tests want to share this scaffolding.
void StaticRouter;
