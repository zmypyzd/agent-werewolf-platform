import type { RuntimeEnv } from './config.js';
import { DEFAULT_SESSION_TTL_MS, SESSION_COOKIE_NAME } from './config.js';

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number; // seconds (cookie spec)
}

export function sessionCookieOptions(
  env: RuntimeEnv,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env === 'production',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  };
}

export interface ClearCookieOptions {
  path: '/';
}

export function clearCookieOptions(): ClearCookieOptions {
  return { path: '/' };
}

export { SESSION_COOKIE_NAME };
