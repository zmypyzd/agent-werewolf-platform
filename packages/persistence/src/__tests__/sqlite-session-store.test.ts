import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../sqlite/connection.js';
import type { SqliteDb } from '../sqlite/connection.js';
import { SqliteSessionStore } from '../sqlite/sqlite-session-store.js';
import { SqliteUserStore } from '../sqlite/sqlite-user-store.js';

describe('SqliteSessionStore', () => {
  let db: SqliteDb;
  let users: SqliteUserStore;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    users = new SqliteUserStore(db);
    await users.createUser({ userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A' });
  });

  afterEach(() => {
    db.close();
  });

  it('create + find round-trip', async () => {
    const store = new SqliteSessionStore(db, () => 1000);
    await store.create('s-1', 'u-1', 9999);
    const got = await store.find('s-1');
    expect(got).not.toBeNull();
    expect(got?.userId).toBe('u-1');
    expect(got?.expiresAt).toBe(9999);
    expect(got?.createdAt).toBe(1000);
    expect(got?.lastSeenAt).toBe(1000);
  });

  it('find returns null for an expired session', async () => {
    let now = 1000;
    const store = new SqliteSessionStore(db, () => now);
    await store.create('s-expired', 'u-1', 1500);
    now = 2000;
    expect(await store.find('s-expired')).toBeNull();
  });

  it('find returns null when expiresAt equals now (boundary)', async () => {
    let now = 1000;
    const store = new SqliteSessionStore(db, () => now);
    await store.create('s-edge', 'u-1', 1500);
    now = 1500;
    expect(await store.find('s-edge')).toBeNull();
  });

  it('touch updates lastSeenAt and expiresAt', async () => {
    let now = 1000;
    const store = new SqliteSessionStore(db, () => now);
    await store.create('s-1', 'u-1', 2000);
    await store.touch('s-1', 1500, 5000);
    now = 1600;
    const got = await store.find('s-1');
    expect(got?.lastSeenAt).toBe(1500);
    expect(got?.expiresAt).toBe(5000);
  });

  it('delete removes the session', async () => {
    const store = new SqliteSessionStore(db, () => 1000);
    await store.create('s-1', 'u-1', 9999);
    await store.delete('s-1');
    expect(await store.find('s-1')).toBeNull();
  });

  it('find returns null for unknown id', async () => {
    const store = new SqliteSessionStore(db, () => 1000);
    expect(await store.find('nope')).toBeNull();
  });
});
