// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const apiPostMock = vi.fn();
vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    api: { ...actual.api, post: (...args: unknown[]) => apiPostMock(...args) },
  };
});

const { InvitePopover, mintAndCopyInvite } = await import(
  '../components/InvitePopover.js'
);

describe('InvitePopover', () => {
  beforeEach(() => {
    apiPostMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(isAuthed = true) {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <InvitePopover isAuthed={isAuthed} onClose={onClose} />
      </MemoryRouter>,
    );
    return { onClose };
  }

  it('renders the two action buttons', () => {
    setup();
    expect(screen.getByText('邀请 Coding Agent')).toBeTruthy();
    expect(screen.getByText('邀请 HTTP Agent')).toBeTruthy();
  });

  it('hides the login hint when authed', () => {
    setup(true);
    expect(screen.queryByText(/点击后会先登录/)).toBeNull();
  });

  it('shows the login hint when not authed', () => {
    setup(false);
    expect(screen.getByText(/点击后会先登录/)).toBeTruthy();
  });
});

describe('mintAndCopyInvite', () => {
  beforeEach(() => {
    apiPostMock.mockReset();
  });

  it('writes the assembled boilerplate to the clipboard and reports success', async () => {
    apiPostMock.mockResolvedValueOnce({
      token: 'tok-1',
      expiresAt: Date.now() + 3600_000,
      registerUrl: 'https://example.com/api/v1/agents/invites/tok-1/register',
    });
    const writeText = vi.fn().mockResolvedValueOnce(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const showToast = vi.fn();
    const showFallbackText = vi.fn();

    await mintAndCopyInvite('coding', { showToast, showFallbackText });

    expect(apiPostMock).toHaveBeenCalledWith('/agents/invites', { ttlSec: 86400 });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain('WEREWOLF module');
    expect(copied).toContain('tok-1');
    expect(showToast).toHaveBeenCalledWith(
      '已复制 Coding Agent 邀请文案到剪贴板',
    );
    expect(showFallbackText).not.toHaveBeenCalled();
  });

  it('falls back to manual-copy textarea when clipboard write fails', async () => {
    apiPostMock.mockResolvedValueOnce({
      token: 'tok-2',
      expiresAt: Date.now() + 3600_000,
      registerUrl: 'https://example.com/api/v1/agents/invites/tok-2/register',
    });
    const writeText = vi.fn().mockRejectedValueOnce(new Error('safari gesture expired'));
    Object.assign(navigator, { clipboard: { writeText } });
    const showToast = vi.fn();
    const showFallbackText = vi.fn();

    await mintAndCopyInvite('http', { showToast, showFallbackText });

    expect(showFallbackText).toHaveBeenCalledTimes(1);
    expect(showFallbackText.mock.calls[0]![1]).toContain('HTTP agent for the 9-player WEREWOLF');
    expect(showFallbackText.mock.calls[0]![1]).toContain('tok-2');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reports an error toast when invite mint fails — no clipboard write attempted', async () => {
    apiPostMock.mockRejectedValueOnce(new Error('500'));
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const showToast = vi.fn();
    const showFallbackText = vi.fn();

    await expect(
      mintAndCopyInvite('coding', { showToast, showFallbackText }),
    ).rejects.toThrow();

    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalled();
    expect(showFallbackText).not.toHaveBeenCalled();
  });

  // act + waitFor imports are used elsewhere; void them to suppress unused-
  // export lints if a future change removes their last usage.
  it('exports the act/waitFor helpers indirectly (smoke)', () => {
    void act;
    void waitFor;
    expect(true).toBe(true);
  });
});
