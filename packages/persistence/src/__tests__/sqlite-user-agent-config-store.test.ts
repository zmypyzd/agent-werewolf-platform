import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundError } from '@agent-poker/shared';
import { openDatabase } from '../sqlite/connection.js';
import type { SqliteDb } from '../sqlite/connection.js';
import { SqliteUserAgentConfigStore } from '../sqlite/sqlite-user-agent-config-store.js';
import { SqliteUserStore } from '../sqlite/sqlite-user-store.js';

describe('SqliteUserAgentConfigStore', () => {
  let db: SqliteDb;
  let store: SqliteUserAgentConfigStore;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const users = new SqliteUserStore(db);
    await users.createUser({ userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A' });
    await users.createUser({ userId: 'u-2', email: 'b@x.test', passwordHash: 'h', displayName: 'B' });
    store = new SqliteUserAgentConfigStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create + get round-trip', async () => {
    const created = await store.create({
      agentConfigId: 'cfg-1',
      userId: 'u-1',
      agentName: 'Bot',
      endpointUrl: 'https://example.test/agent',
      authHeaderName: 'Authorization',
      authHeaderValue: 'Bearer secret',
      timeoutMs: 4000,
      description: 'a bot',
    });
    expect(created.agentConfigId).toBe('cfg-1');

    const got = await store.get('u-1', 'cfg-1');
    expect(got?.agentName).toBe('Bot');
    expect(got?.authHeaderValue).toBe('Bearer secret');
  });

  it('list is scoped per user', async () => {
    await store.create({
      agentConfigId: 'cfg-a', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    await store.create({
      agentConfigId: 'cfg-b', userId: 'u-2', agentName: 'B', endpointUrl: 'https://b.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    const u1 = await store.list('u-1');
    const u2 = await store.list('u-2');
    expect(u1.map(c => c.agentConfigId)).toEqual(['cfg-a']);
    expect(u2.map(c => c.agentConfigId)).toEqual(['cfg-b']);
  });

  it('get is scoped per user (cannot read another user\'s config)', async () => {
    await store.create({
      agentConfigId: 'cfg-1', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    expect(await store.get('u-2', 'cfg-1')).toBeNull();
  });

  it('update applies a partial patch and bumps updatedAt', async () => {
    const created = await store.create({
      agentConfigId: 'cfg-1', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    await new Promise(r => setTimeout(r, 5));
    const patched = await store.update('u-1', 'cfg-1', { agentName: 'A2', timeoutMs: 2000 });
    expect(patched.agentName).toBe('A2');
    expect(patched.timeoutMs).toBe(2000);
    expect(patched.endpointUrl).toBe('https://a.test');
    expect(patched.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('update can clear nullable fields by setting null', async () => {
    await store.create({
      agentConfigId: 'cfg-1', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: 'X', authHeaderValue: 'Y', timeoutMs: 1000, description: 'd',
    });
    const patched = await store.update('u-1', 'cfg-1', {
      authHeaderName: null,
      authHeaderValue: null,
      description: null,
    });
    expect(patched.authHeaderName).toBeNull();
    expect(patched.authHeaderValue).toBeNull();
    expect(patched.description).toBeNull();
  });

  it('update on a config owned by another user throws NotFoundError', async () => {
    await store.create({
      agentConfigId: 'cfg-1', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    await expect(store.update('u-2', 'cfg-1', { agentName: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete is scoped per user (other user cannot delete)', async () => {
    await store.create({
      agentConfigId: 'cfg-1', userId: 'u-1', agentName: 'A', endpointUrl: 'https://a.test',
      authHeaderName: null, authHeaderValue: null, timeoutMs: 1000, description: null,
    });
    await store.delete('u-2', 'cfg-1');
    expect(await store.get('u-1', 'cfg-1')).not.toBeNull();
    await store.delete('u-1', 'cfg-1');
    expect(await store.get('u-1', 'cfg-1')).toBeNull();
  });
});
