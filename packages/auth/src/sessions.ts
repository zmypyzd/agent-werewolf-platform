import { randomUUID } from 'crypto';
import type { ISessionStore, Session } from '@agent-poker/persistence';
import { DEFAULT_SESSION_TTL_MS } from './config.js';

export interface SessionConfig {
  ttlMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  ttlMs: DEFAULT_SESSION_TTL_MS,
};

export interface CreatedSession {
  sessionId: string;
  expiresAt: number;
}

export async function createSession(
  store: ISessionStore,
  userId: string,
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
  now: () => number = Date.now,
  generateId: () => string = randomUUID,
): Promise<CreatedSession> {
  const sessionId = generateId();
  const expiresAt = now() + config.ttlMs;
  await store.create(sessionId, userId, expiresAt);
  return { sessionId, expiresAt };
}

// Validates a session id; on success, slides the expiry forward by ttlMs and
// returns the session. Returns null when the session is unknown or expired.
export async function validateSession(
  store: ISessionStore,
  sessionId: string,
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
  now: () => number = Date.now,
): Promise<Session | null> {
  const session = await store.find(sessionId);
  if (!session) return null;

  const t = now();
  const newExpiresAt = t + config.ttlMs;
  await store.touch(sessionId, t, newExpiresAt);
  return { ...session, lastSeenAt: t, expiresAt: newExpiresAt };
}

export async function destroySession(store: ISessionStore, sessionId: string): Promise<void> {
  await store.delete(sessionId);
}
