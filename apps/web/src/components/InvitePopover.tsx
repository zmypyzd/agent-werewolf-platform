import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import {
  buildCodingAgentInvitePrompt,
  buildHttpAgentInvitePrompt,
  type GeneratedAgentInvite,
} from '../lib/invite-boilerplate.js';
import { useClipboardToast } from './ClipboardToast.js';

export type InviteAgentKind = 'coding' | 'http';

const INVITE_TTL_SEC = 24 * 60 * 60;

export async function mintAndCopyInvite(
  kind: InviteAgentKind,
  showToast: (msg: string) => void,
): Promise<void> {
  let invite: GeneratedAgentInvite;
  try {
    invite = await api.post<GeneratedAgentInvite>('/agents/invites', {
      ttlSec: INVITE_TTL_SEC,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      showToast(`邀请生成失败: ${e.message}`);
    } else {
      showToast('邀请生成失败');
    }
    throw e;
  }
  const text =
    kind === 'coding'
      ? buildCodingAgentInvitePrompt(invite, 'werewolf')
      : buildHttpAgentInvitePrompt(invite, 'werewolf');
  try {
    await navigator.clipboard.writeText(text);
    showToast(
      kind === 'coding'
        ? '已复制 Coding Agent 邀请文案到剪贴板'
        : '已复制 HTTP Agent 邀请文案到剪贴板',
    );
  } catch {
    showToast('邀请已生成，但复制到剪贴板失败');
  }
}

export interface InvitePopoverProps {
  isAuthed: boolean;
  onClose: () => void;
}

export function InvitePopover({ isAuthed, onClose }: InvitePopoverProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useClipboardToast();
  const [busy, setBusy] = useState<InviteAgentKind | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function handleClick(kind: InviteAgentKind) {
    if (!isAuthed) {
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?next=${next}&pendingInvite=${kind}`);
      onClose();
      return;
    }
    if (busy !== null) return;
    setBusy(kind);
    try {
      await mintAndCopyInvite(kind, showToast);
      onClose();
    } catch {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="invite-popover" role="dialog" aria-label="Invite agent">
      <button
        type="button"
        className="invite-popover-action"
        onClick={() => void handleClick('coding')}
        disabled={busy !== null}
      >
        {busy === 'coding' ? '生成中…' : '邀请 Coding Agent'}
      </button>
      <button
        type="button"
        className="invite-popover-action"
        onClick={() => void handleClick('http')}
        disabled={busy !== null}
      >
        {busy === 'http' ? '生成中…' : '邀请 HTTP Agent'}
      </button>
      {!isAuthed ? (
        <div className="invite-popover-hint">点击后会先登录,登录完成自动复制邀请文案。</div>
      ) : null}
    </div>
  );
}
