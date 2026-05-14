// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClipboardToastProvider,
  useClipboardToast,
} from '../components/ClipboardToast.js';

function Trigger({ mode, text }: { mode: 'simple' | 'fallback'; text?: string }) {
  const { showToast, showFallbackText } = useClipboardToast();
  return (
    <button
      onClick={() => {
        if (mode === 'simple') showToast('hello');
        else showFallbackText('failed', text ?? 'BOILERPLATE');
      }}
    >
      go
    </button>
  );
}

describe('ClipboardToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a simple toast and auto-dismisses', () => {
    render(
      <ClipboardToastProvider>
        <Trigger mode="simple" />
      </ClipboardToastProvider>,
    );
    act(() => {
      screen.getByText('go').click();
    });
    expect(screen.getByText('hello')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.queryByText('hello')).toBeNull();
  });

  it('shows a fallback textarea when clipboard write fails', () => {
    render(
      <ClipboardToastProvider>
        <Trigger mode="fallback" text="THE_PROMPT" />
      </ClipboardToastProvider>,
    );
    act(() => {
      screen.getByText('go').click();
    });
    expect(screen.getByText('failed')).toBeTruthy();
    const textarea = screen.getByLabelText('可手动复制的邀请文案') as HTMLTextAreaElement;
    expect(textarea.value).toBe('THE_PROMPT');
    expect(screen.getByText('关闭')).toBeTruthy();
  });

  it('keeps the fallback visible past the short-toast window', () => {
    render(
      <ClipboardToastProvider>
        <Trigger mode="fallback" />
      </ClipboardToastProvider>,
    );
    act(() => {
      screen.getByText('go').click();
    });
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // Short toast would have vanished by 1800ms — fallback must outlive it.
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('dismiss button clears the fallback immediately', () => {
    render(
      <ClipboardToastProvider>
        <Trigger mode="fallback" />
      </ClipboardToastProvider>,
    );
    act(() => {
      screen.getByText('go').click();
    });
    act(() => {
      screen.getByText('关闭').click();
    });
    expect(screen.queryByText('failed')).toBeNull();
  });

  it('useClipboardToast no-ops outside the provider (no throw)', () => {
    // Standalone test mounts the trigger without a provider — exercising the
    // hook's fallback so tests that don't wrap with a provider don't crash.
    expect(() =>
      render(<Trigger mode="simple" />),
    ).not.toThrow();
    act(() => {
      screen.getByText('go').click();
    });
    expect(screen.queryByText('hello')).toBeNull();
  });
});
