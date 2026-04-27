import { describe, it, expect, beforeEach } from 'vitest';
import type { ISessionStore, Session } from '@agent-poker/persistence';
import { createSession, destroySession, validateSession } from '../sessions.js';

class FakeSessionStore implements ISessionStore {
  private rows = new Map<string, Session>();

  constructor(private now: () => number) {}

  async create(sessionId: string, userId: string, expiresAt: number): Promise<void> {
    const t = this.now();
    this.rows.set(sessionId, {
      sessionId,
      userId,
      createdAt: t,
      expiresAt,
      lastSeenAt: t,
    });
  }

  async find(sessionId: string): Promise<Session | null> {
    const row = this.rows.get(sessionId);
    if (!row) return null;
    if (row.expiresAt <= this.now()) return null;
    return { ...row };
  }

  async touch(sessionId: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const row = this.rows.get(sessionId);
    if (!row) return;
    this.rows.set(sessionId, { ...row, lastSeenAt, expiresAt });
  }

  async delete(sessionId: string): Promise<void> {
    this.rows.delete(sessionId);
  }
}

describe('sessions', () => {
  let now: number;
  let clock: () => number;
  let store: FakeSessionStore;

  beforeEach(() => {
    now = 1_000_000;
    clock = () => now;
    store = new FakeSessionStore(clock);
  });

  it('createSession returns a sessionId and expiresAt = now + ttl', async () => {
    const created = await createSession(store, 'user-1', { ttlMs: 5000 }, clock);
    expect(created.sessionId).toBeTruthy();
    expect(created.expiresAt).toBe(now + 5000);
    const found = await store.find(created.sessionId);
    expect(found?.userId).toBe('user-1');
  });

  it('validateSession returns the session and slides the expiry', async () => {
    const { sessionId } = await createSession(store, 'user-1', { ttlMs: 5000 }, clock);
    now += 1000;
    const validated = await validateSession(store, sessionId, { ttlMs: 5000 }, clock);
    expect(validated).not.toBeNull();
    expect(validated?.userId).toBe('user-1');
    expect(validated?.lastSeenAt).toBe(now);
    expect(validated?.expiresAt).toBe(now + 5000);

    const stored = await store.find(sessionId);
    expect(stored?.expiresAt).toBe(now + 5000);
  });

  it('validateSession returns null after expiry and does not touch', async () => {
    const { sessionId } = await createSession(store, 'user-1', { ttlMs: 5000 }, clock);
    now += 5001;
    const validated = await validateSession(store, sessionId, { ttlMs: 5000 }, clock);
    expect(validated).toBeNull();
  });

  it('validateSession returns null for an unknown sessionId', async () => {
    const validated = await validateSession(store, 'nope', { ttlMs: 5000 }, clock);
    expect(validated).toBeNull();
  });

  it('destroySession removes the row', async () => {
    const { sessionId } = await createSession(store, 'user-1', { ttlMs: 5000 }, clock);
    await destroySession(store, sessionId);
    const validated = await validateSession(store, sessionId, { ttlMs: 5000 }, clock);
    expect(validated).toBeNull();
  });
});
