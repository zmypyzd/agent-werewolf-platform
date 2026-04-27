import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('password', () => {
  it('hashPassword + verifyPassword round-trip', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(0);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('verifyPassword fails for the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stable', hash)).toBe(false);
  });

  it('hashing the same password twice yields different hashes (salt works)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-input', a)).toBe(true);
    expect(await verifyPassword('same-input', b)).toBe(true);
  });

  it('verifyPassword returns false for an empty hash without throwing', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('verifyPassword returns false for a malformed hash without throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });
});
