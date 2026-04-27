import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../sqlite/connection.js';
import type { SqliteDb } from '../sqlite/connection.js';
import { SqliteTableStore } from '../sqlite/sqlite-table-store.js';
import { makeTable } from './sqlite-fixtures.js';

describe('SqliteTableStore', () => {
  let db: SqliteDb;
  let store: SqliteTableStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteTableStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('saveTable + getTable round-trip', async () => {
    const t = makeTable('tbl-1');
    await store.saveTable(t);
    const got = await store.getTable('tbl-1');
    expect(got).toEqual(t);
  });

  it('saveTable upserts on the same id', async () => {
    const t = makeTable('tbl-1');
    await store.saveTable(t);
    const t2 = { ...t, handNumber: 5 };
    await store.saveTable(t2);
    const got = await store.getTable('tbl-1');
    expect(got?.handNumber).toBe(5);
  });

  it('listTables returns all saved tables', async () => {
    await store.saveTable(makeTable('t1'));
    await store.saveTable(makeTable('t2'));
    const list = await store.listTables();
    expect(list).toHaveLength(2);
    expect(list.map(t => t.tableId).sort()).toEqual(['t1', 't2']);
  });

  it('deleteTable removes the row', async () => {
    await store.saveTable(makeTable('t1'));
    await store.deleteTable('t1');
    expect(await store.getTable('t1')).toBeNull();
  });

  it('getTable returns null for unknown', async () => {
    expect(await store.getTable('nope')).toBeNull();
  });
});
