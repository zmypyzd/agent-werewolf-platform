import { useEffect, useRef } from 'react';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

export interface WerewolfEventTimelineProps {
  lines: WerewolfTimelineLine[];
}

export function WerewolfEventTimeline({ lines }: WerewolfEventTimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div className="werewolf-timeline" ref={ref} aria-live="polite">
      {lines.length === 0 ? (
        <div className="werewolf-timeline-empty">暂无事件</div>
      ) : (
        lines.map((line) => (
          <div
            key={line.id}
            className={`werewolf-timeline-line werewolf-timeline-${line.kind}`}
          >
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}
