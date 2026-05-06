import { useEffect, useRef } from 'react';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

export interface WerewolfEventTimelineProps {
  lines: WerewolfTimelineLine[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function WerewolfEventTimeline({ lines }: WerewolfEventTimelineProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="ww-timeline" aria-live="polite">
      <div className="ww-timeline-header">
        <div className="ww-timeline-live-dot" />
        <span className="ww-timeline-title">事件流 · Events</span>
      </div>
      <div className="ww-timeline-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="ww-timeline-empty">暂无事件</div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={`ww-tl-entry kind-${line.kind}`}
            >
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
    </div>
  );
}
