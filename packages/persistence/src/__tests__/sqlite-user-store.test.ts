import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmailTakenError } from '@agent-poker/shared';
import { openDatabase } from '../sqlite/connection.js';
import type { SqliteDb } from '../sqlite/connection.js';
import { SqliteUserStore } from '../sqlite/sqlite-user-store.js';

describe('SqliteUserStore', () => {
  let db: SqliteDb;
  let store: SqliteUserStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteUserStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('createUser + findById round-trip', async () => {
    const created = await store.createUser({
      userId: 'u-1',
      email: 'Alice@Example.test',
      passwordHash: 'hash-1',
      displayName: 'Alice',
    });
    expect(created.email).toBe('alice@example.test');

    const found = await store.findById('u-1');
    expect(found).not.toBeNull();
    expect(found?.email).toBe('alice@example.test');
    expect(found?.displayName).toBe('Alice');
    expect(found?.passwordHash).toBe('hash-1');
  });

  it('findByEmail is case-insensitive', async () => {
    await store.createUser({
      userId: 'u-1',
      email: 'alice@example.test',
      passwordHash: 'h',
      displayName: 'Alice',
    });
    const a = await store.findByEmail('ALICE@example.test');
    const b = await store.findByEmail('  alice@example.test  ');
    expect(a?.userId).toBe('u-1');
    expect(b?.userId).toBe('u-1');
  });

  it('duplicate email throws EmailTakenError', async () => {
    await store.createUser({ userId: 'u-1', email: 'a@x.test', passwordHash: 'h1', displayName: 'A' });
    await expect(
      store.createUser({ userId: 'u-2', email: 'A@X.test', passwordHash: 'h2', displayName: 'A2' }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('updateDisplayName mutates only the display name', async () => {
    await store.createUser({ userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'Old' });
    await store.updateDisplayName('u-1', 'New');
    const u = await store.findById('u-1');
    expect(u?.displayName).toBe('New');
    expect(u?.email).toBe('a@x.test');
  });

  it('findById returns null for unknown', async () => {
    expect(await store.findById('nope')).toBeNull();
  });

  it('findByEmail returns null for unknown', async () => {
    expect(await store.findByEmail('nope@x.test')).toBeNull();
  });
});
