import { describe, it, expect, afterEach } from 'vitest';
import { FileHandStore } from '../file-store.js';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { HandSummary, ReplayEvent } from '@agent-poker/shared';

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `poker-test-${randomUUID()}`);
}

function makeHand(handId: string, tableId: string): HandSummary {
  return {
    handId,
    tableId,
    handNumber: 1,
    seed: 'seed-1',
    startedAt: Date.now(),
    completedAt: Date.now() + 1000,
    players: [],
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    communityCards: [],
    allActions: [],
    results: [],
    finalPots: [],
  };
}

function makeEvent(handId: string, tableId: string, seq: number): ReplayEvent {
  return {
    eventId: `evt-${seq}`,
    handId,
    tableId,
    sequence: seq,
    eventType: 'test.event',
    timestamp: Date.now(),
    data: { seq },
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  dirs.length = 0;
});

describe('FileHandStore', () => {
  it('appendReplayEvent creates JSONL file', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    await store.appendReplayEvent(makeEvent('h1', 'tbl-1', 0));
    const file = path.join(dir, 'tbl-1', 'h1.replay.jsonl');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('multiple appends → N lines in JSONL', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    for (let i = 0; i < 5; i++) {
      await store.appendReplayEvent(makeEvent('h1', 'tbl-1', i));
    }
    const events = await store.getReplayEvents('h1');
    expect(events).toHaveLength(5);
  });

  it('getReplayEvents parses JSONL correctly', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    const evt = makeEvent('h1', 'tbl-1', 0);
    await store.appendReplayEvent(evt);
    const events = await store.getReplayEvents('h1');
    expect(events[0]).toEqual(evt);
  });

  it('saveHandSummary creates JSON file', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    const hand = makeHand('h1', 'tbl-1');
    await store.saveHandSummary(hand);
    const file = path.join(dir, 'tbl-1', 'h1.summary.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed.handId).toBe('h1');
  });

  it('non-existent file → getReplayEvents returns empty array', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    const events = await store.getReplayEvents('nonexistent');
    expect(events).toEqual([]);
  });

  it('nested directory created automatically', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileHandStore(dir);
    await store.appendReplayEvent(makeEvent('h1', 'tbl-new', 0));
    expect(fs.existsSync(path.join(dir, 'tbl-new'))).toBe(true);
  });
});
