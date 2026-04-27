import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../sqlite/connection.js';
import type { SqliteDb } from '../sqlite/connection.js';
import { SqliteHandStore } from '../sqlite/sqlite-hand-store.js';
import { makeEvent, makeHand } from './sqlite-fixtures.js';

describe('SqliteHandStore', () => {
  let db: SqliteDb;
  let store: SqliteHandStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteHandStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('saveHandSummary + getHandSummary round-trip', async () => {
    const h = makeHand('hand-1', 'tbl-1');
    await store.saveHandSummary(h);
    const got = await store.getHandSummary('hand-1');
    expect(got).toEqual(h);
  });

  it('listHandSummaries filters by tableId and orders by completedAt', async () => {
    await store.saveHandSummary(makeHand('h2', 'tbl-1', 200));
    await store.saveHandSummary(makeHand('h1', 'tbl-1', 100));
    await store.saveHandSummary(makeHand('hX', 'tbl-2', 150));
    const list = await store.listHandSummaries('tbl-1');
    expect(list.map(h => h.handId)).toEqual(['h1', 'h2']);
  });

  it('appendReplayEvent + getReplayEvents returns events in sequence order', async () => {
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 2));
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 0));
    await store.appendReplayEvent(makeEvent('hand-1', 'tbl-1', 1));
    const events = await store.getReplayEvents('hand-1');
    expect(events.map(e => e.sequence)).toEqual([0, 1, 2]);
  });

  it('events are scoped per hand', async () => {
    await store.appendReplayEvent(makeEvent('hand-A', 'tbl-1', 0));
    await store.appendReplayEvent(makeEvent('hand-B', 'tbl-1', 0));
    expect((await store.getReplayEvents('hand-A')).map(e => e.handId)).toEqual(['hand-A']);
    expect((await store.getReplayEvents('hand-B')).map(e => e.handId)).toEqual(['hand-B']);
  });

  it('getHandSummary returns null for unknown', async () => {
    expect(await store.getHandSummary('nope')).toBeNull();
  });
});
