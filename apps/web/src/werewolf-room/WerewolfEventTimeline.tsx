import { useEffect, useMemo, useRef, useState } from 'react';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

export interface WerewolfEventTimelineProps {
  lines: WerewolfTimelineLine[];
}

type TimelineTab = 'audience' | 'events';

// Demo audience chat lines mirroring the approved finalized.html chat
// panel. There is no real backend chat stream yet — these are static
// presentation-layer commentary so spectators see the panel populated
// instead of an empty box. Swap for SSE-driven content once a chat
// endpoint exists, following the same shape (username, tone, msg, time).
const DEMO_AUDIENCE_LINES: ReadonlyArray<{
  readonly id: string;
  readonly username: string;
  readonly tone: 'mod' | 'blue' | 'green' | 'red' | 'neutral';
  readonly msg: string;
  readonly time: string;
}> = [
  { id: 'a1', username: 'PathosMod',     tone: 'mod',     msg: 'Echo-3 finally outed a wolf. About time the seer claimed.',                          time: '-12s' },
  { id: 'a2', username: 'AlphaWatchdog', tone: 'blue',    msg: 'If the seer is real, why didn’t they check Atlas earlier? still feels coordinated.', time: '-9s' },
  { id: 'a3', username: 'CauldronVibe',  tone: 'green',   msg: 'Witch is thinking 8 seconds already, this antidote decision is huge.',               time: '-6s' },
  { id: 'a4', username: 'WolfScent',     tone: 'red',     msg: 'Echo-2 deflection to P7 is textbook wolf misdirection. revote!',                     time: '-3s' },
  { id: 'a5', username: 'TheoryCraft',   tone: 'neutral', msg: 'Pulse-6 sitting on the trigger. If they banish hunter the table flips.',             time: '-1s' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function WerewolfEventTimeline({ lines }: WerewolfEventTimelineProps) {
  // EVENTS is the default active tab because it shows real reducer-driven
  // timeline data. AUDIENCE is a presentation-layer demo until a real
  // spectator-chat stream lands.
  const [activeTab, setActiveTab] = useState<TimelineTab>('events');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Most recent system event surfaces as the AUDIENCE tab's system-card
  // (banishment / death announcement at the top of the audience feed).
  // Walk the timeline backward so we only pay O(1) on the typical case
  // where the newest event is itself a 'system' line.
  const latestSystemLine = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (l && l.kind === 'system') return l;
    }
    return undefined;
  }, [lines]);

  useEffect(() => {
    if (activeTab !== 'events') return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, activeTab]);

  return (
    <div className="ww-timeline" aria-live="polite">
      <div className="ww-timeline-tabs" role="tablist" aria-label="Timeline channel">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'audience'}
          className={`ww-timeline-tab${activeTab === 'audience' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('audience')}
        >
          AUDIENCE
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'events'}
          className={`ww-timeline-tab${activeTab === 'events' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          EVENTS
        </button>
      </div>

      {activeTab === 'audience' ? (
        <div className="ww-timeline-body ww-timeline-body-audience">
          {latestSystemLine ? (
            <div className="ww-timeline-system-card" role="status">
              <div className="ww-timeline-system-pin">
                LATEST · {formatTime(latestSystemLine.timestamp)}
              </div>
              <div className="ww-timeline-system-msg">{latestSystemLine.text}</div>
            </div>
          ) : null}
          {DEMO_AUDIENCE_LINES.map((line) => (
            <div key={line.id} className="ww-timeline-chat-line">
              <span
                className={`ww-timeline-chat-username is-${line.tone}`}
              >
                {line.username}
              </span>
              <span className="ww-timeline-chat-msg">{line.msg}</span>
              <span className="ww-timeline-chat-time">{line.time}</span>
            </div>
          ))}
          <div className="ww-timeline-chat-input" aria-label="Audience chat input">
            <span className="ww-timeline-chat-input-fake">Audience chat is read-only…</span>
            <button type="button" className="ww-timeline-chat-send" disabled>
              SEND
            </button>
          </div>
        </div>
      ) : (
        <div className="ww-timeline-body" ref={bodyRef}>
          {lines.length === 0 ? (
            <div className="ww-timeline-empty">暂无事件</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={`ww-tl-entry kind-${line.kind}`}>
                {line.kind !== 'reason' && (
                  <span className="ww-tl-time">{formatTime(line.timestamp)}</span>
                )}
                <span className="ww-tl-text">
                  {line.text}
                  {line.sub !== undefined && (
                    <span className="ww-tl-sub">{line.sub}</span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
