import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '../replay-event.js';

// Regression: ISSUE-001 — phase.changed events were emitted as
// `{ from, to }` but the spectator reducer extracts `phase`,
// `nightNumber`, `dayNumber` from event.data. As a result, the phase
// indicator stayed pinned at "WAITING FOR PLAYERS" for an entire match.
// Found by /qa on 2026-05-06.
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-06.md
describe('match-runner phase.changed payload shape', () => {
  it('every phase.changed event carries phase + nightNumber + dayNumber', async () => {
    const initial = createGame({ gameId: 'g-shape', seed: 'seed-shape' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const phaseChanges = events.filter((e) => e.eventType === 'phase.changed');
    expect(phaseChanges.length).toBeGreaterThan(0);
    for (const e of phaseChanges) {
      expect(typeof e.data['phase']).toBe('string');
      expect(typeof e.data['nightNumber']).toBe('number');
      expect(typeof e.data['dayNumber']).toBe('number');
      // Defensive: the legacy `from`/`to` shape silently broke the UI; if
      // anyone re-introduces it, this test should fail loudly.
      expect(e.data['from']).toBeUndefined();
      expect(e.data['to']).toBeUndefined();
    }
  });

  it('first night phase.changed reports nightNumber>=1, never the initial 0', async () => {
    const initial = createGame({ gameId: 'g-first-night', seed: 'seed-first-night' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const firstNightChange = events.find(
      (e) =>
        e.eventType === 'phase.changed' &&
        typeof e.data['phase'] === 'string' &&
        (e.data['phase'] as string).startsWith('night-'),
    );
    expect(firstNightChange).toBeDefined();
    expect(firstNightChange!.data['nightNumber']).toBeGreaterThanOrEqual(1);
  });
});
