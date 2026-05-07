import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api } from '../lib/api.js';

export interface MyAgentConfigVM {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
  timeoutMs: number;
  description: string | null;
}

export type AgentPickerState =
  | { kind: 'loading' }
  | { kind: 'login-required' }
  | { kind: 'fetch-error'; message: string }
  | { kind: 'empty-list' }
  | { kind: 'list'; agents: MyAgentConfigVM[]; submittingId?: string; inviteError?: string };

export interface AgentPickerPopoverProps {
  // The seat the popover is anchored to (used for header label + invite POST).
  seatIndex: number;
  // Viewport coordinates of the seat that opened this popover. The popover
  // renders into a Portal at document.body and uses position:fixed against
  // these coordinates so it can't be clipped by the .ww-board-wrapper's
  // overflow:hidden (which existed before this feature for night-overlay
  // containment and remains load-bearing). `top` is needed to flip the
  // popover above the seat when there isn't room below.
  anchorRect: { left: number; top: number; bottom: number; width: number };
  // Called when the user invokes "Invite NPC" from the popover.
  onInviteNpc: (seatIndex: number) => Promise<void> | void;
  // Called when the user picks an agent and the POST succeeded. Parent should
  // refresh lobby state.
  onInviteAgent: (seatIndex: number, agentConfigId: string) => Promise<void> | void;
  onClose: () => void;
}

// Seat-anchored popover for D3=C. Two affordances on top: invite NPC (the
// existing fast path) and pick from the user's registered agents. The agent
// list goes through the 12 interaction states locked in plan D4=A. The
// component owns its fetch and POST lifecycles; the parent only knows about
// callbacks.
export function AgentPickerPopover({
  seatIndex,
  anchorRect,
  onInviteNpc,
  onInviteAgent,
  onClose,
}: AgentPickerPopoverProps) {
  const [state, setState] = useState<AgentPickerState>({ kind: 'loading' });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch /me/agents on mount. 401 surfaces as login-required; other
  // failures surface as fetch-error. Empty list is its own state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agents = await api.get<MyAgentConfigVM[]>('/me/agents');
        if (cancelled) return;
        setState(agents.length === 0 ? { kind: 'empty-list' } : { kind: 'list', agents });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.statusCode === 401) {
          setState({ kind: 'login-required' });
        } else {
          setState({
            kind: 'fetch-error',
            message: e instanceof Error ? e.message : 'Failed to load agents',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC closes; Tab focus trap kept simple — the popover is small and
  // ESC-or-click-outside is the primary close path.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click-outside closes. Anchor element triggers the popover; the parent
  // mounts <AgentPickerPopover> as a sibling, so we listen on document and
  // close on any click that isn't inside our root.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const root = containerRef.current;
      if (!root) return;
      if (!(e.target instanceof Node)) return;
      if (!root.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  async function handlePickAgent(agentConfigId: string) {
    if (state.kind !== 'list') return;
    setState({ kind: 'list', agents: state.agents, submittingId: agentConfigId });
    try {
      await onInviteAgent(seatIndex, agentConfigId);
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? (e.code ?? '') : '';
      let msg = e instanceof Error ? e.message : 'Invite failed';
      if (code === 'AGENT_NOT_FOUND') msg = '找不到这个 agent';
      else if (code === 'WEREWOLF_SEAT_OCCUPIED') {
        msg = '这个座位刚被占用了';
        setTimeout(onClose, 800);
      } else if (code === 'WEREWOLF_GAME_NOT_READY') {
        msg = '游戏已开始';
        setTimeout(onClose, 800);
      } else if (code === 'AGENT_IN_USE') msg = '这个 agent 在另一桌中';
      else if (code === 'UNAUTHENTICATED') msg = '请先登录';
      setState({ kind: 'list', agents: state.agents, inviteError: msg });
    }
  }

  async function handlePickNpc() {
    try {
      await onInviteNpc(seatIndex);
      onClose();
    } catch {
      // Parent handles toast; just stay open.
    }
  }

  // Position fixed against viewport coordinates from the anchor seat.
  // Initial pass uses translateX(-50%) to center on the seat; the
  // useLayoutEffect below then measures the popover and clamps it inside
  // the viewport (flipping above the seat if there's no room below). We
  // start hidden via opacity:0 so the unclamped pass is never visible —
  // edge seats and seats near the bottom of the viewport otherwise pushed
  // the popover off-screen and made it unclickable.
  const [clampedStyle, setClampedStyle] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const margin = 8;

    function reposition() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const desiredLeft =
        anchorRect.left + anchorRect.width / 2 - rect.width / 2;
      const left = Math.max(
        margin,
        Math.min(desiredLeft, vw - rect.width - margin),
      );

      const belowTop = anchorRect.bottom + margin;
      const aboveTop = anchorRect.top - margin - rect.height;
      let top: number;
      if (belowTop + rect.height <= vh - margin) {
        top = belowTop;
      } else if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        top = Math.max(margin, vh - rect.height - margin);
      }

      setClampedStyle({ position: 'fixed', top, left });
    }

    reposition();

    const ro = new ResizeObserver(reposition);
    ro.observe(el);
    window.addEventListener('resize', reposition);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', reposition);
    };
  }, [anchorRect]);

  const popoverStyle: React.CSSProperties = clampedStyle ?? {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translateX(-50%)',
    opacity: 0,
    pointerEvents: 'none',
  };

  const ui = (
    <div
      ref={containerRef}
      className="ww-agent-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ww-agent-picker-header"
      style={popoverStyle}
    >
      <header className="ww-agent-picker-header">
        <span id="ww-agent-picker-header" className="ww-agent-picker-title">
          INVITE AGENT
        </span>
        <span className="ww-agent-picker-seat-marker">P{seatIndex + 1}</span>
      </header>

      <button
        className="ww-agent-picker-npc-row"
        onClick={handlePickNpc}
        type="button"
      >
        邀请 NPC（机器人）
      </button>

      <div className="ww-agent-picker-divider">— or —</div>

      {state.kind === 'loading' ? (
        <div className="ww-agent-picker-state ww-agent-picker-loading" aria-live="polite">
          <div className="ww-agent-picker-skeleton" />
          <div className="ww-agent-picker-skeleton" />
          <div className="ww-agent-picker-skeleton" />
        </div>
      ) : null}

      {state.kind === 'login-required' ? (
        <div className="ww-agent-picker-state">
          <h3 className="ww-agent-picker-state-title">请先登录</h3>
          <a
            className="ww-agent-picker-cta"
            href={`/login?return=${encodeURIComponent(window.location.pathname)}`}
          >
            去登录
          </a>
        </div>
      ) : null}

      {state.kind === 'fetch-error' ? (
        <div className="ww-agent-picker-state ww-agent-picker-error">
          <p>{state.message}</p>
          <button
            type="button"
            className="ww-agent-picker-retry"
            onClick={() => setState({ kind: 'loading' })}
          >
            重试
          </button>
        </div>
      ) : null}

      {state.kind === 'empty-list' ? (
        <div className="ww-agent-picker-state">
          <h3 className="ww-agent-picker-state-title">尚无注册的 agent</h3>
          <p className="ww-agent-picker-state-body">
            去 /me/agents 注册一个 HTTP agent 后回来
          </p>
          <a className="ww-agent-picker-cta" href="/me/agents">
            去注册
          </a>
        </div>
      ) : null}

      {state.kind === 'list' ? (
        <ul className="ww-agent-picker-list" role="listbox" aria-label="My agents">
          {state.agents.map((a) => {
            const submitting = state.submittingId === a.agentConfigId;
            return (
              <li
                key={a.agentConfigId}
                className="ww-agent-picker-row"
                role="option"
                aria-selected={false}
                aria-disabled={submitting}
                tabIndex={submitting ? -1 : 0}
                onClick={() => !submitting && handlePickAgent(a.agentConfigId)}
                onKeyDown={(e) => {
                  if (submitting) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePickAgent(a.agentConfigId);
                  }
                }}
              >
                <div className="ww-agent-picker-row-name">{a.agentName}</div>
                <div className="ww-agent-picker-row-endpoint">
                  {truncate(a.endpointUrl, 32)}
                </div>
                <div className="ww-agent-picker-row-meta">
                  <span className="ww-agent-picker-timeout">
                    {Math.round(a.timeoutMs / 1000)}s
                  </span>
                  {a.description ? (
                    <span className="ww-agent-picker-description">
                      {truncate(a.description, 40)}
                    </span>
                  ) : null}
                </div>
                <span className="ww-agent-picker-row-cta">
                  {submitting ? 'INVITING…' : 'Take this seat'}
                </span>
              </li>
            );
          })}
          {state.inviteError ? (
            <li className="ww-agent-picker-invite-error">{state.inviteError}</li>
          ) : null}
        </ul>
      ) : null}

      <footer className="ww-agent-picker-footer">
        <button type="button" className="ww-agent-picker-cancel" onClick={onClose}>
          取消
        </button>
      </footer>
    </div>
  );

  // Render to document.body so the parent's overflow:hidden (set on
  // .ww-board-wrapper for night-overlay containment) cannot clip us.
  return createPortal(ui, document.body);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
