import { describe, it, expect } from 'vitest';
import { SESSION_COOKIE_NAME, sessionCookieOptions, clearCookieOptions } from '../cookie.js';

describe('cookie', () => {
  it('cookie name is apk_sid', () => {
    expect(SESSION_COOKIE_NAME).toBe('apk_sid');
  });

  it('production options include Secure', () => {
    const opts = sessionCookieOptions('production', 60_000);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.secure).toBe(true);
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(60);
  });

  it('development options omit Secure', () => {
    expect(sessionCookieOptions('development').secure).toBe(false);
  });

  it('test options omit Secure', () => {
    expect(sessionCookieOptions('test').secure).toBe(false);
  });

  it('clearCookieOptions matches the path used to set the cookie', () => {
    expect(clearCookieOptions().path).toBe('/');
  });
});
