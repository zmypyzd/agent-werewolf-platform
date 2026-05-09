import { describe, it, expect } from 'vitest';
import { MockAuthService } from '../auth-service.js';

describe('MockAuthService', () => {
  it('throws on missing Authorization header', async () => {
    const svc = new MockAuthService('user-1');
    await expect(svc.verifyJwt(undefined)).rejects.toThrow(/Missing Authorization/);
  });

  it('throws on non-Bearer scheme', async () => {
    const svc = new MockAuthService('user-1');
    await expect(svc.verifyJwt('Basic abc')).rejects.toThrow(/Bearer/);
  });

  it('throws on Bearer with no token', async () => {
    const svc = new MockAuthService('user-1');
    await expect(svc.verifyJwt('Bearer ')).rejects.toThrow(/Missing Bearer token/);
  });

  it('returns provided defaultUserId regardless of token contents', async () => {
    const svc = new MockAuthService('user-fixed');
    const result = await svc.verifyJwt('Bearer any-token-string');
    expect(result).toEqual({ userId: 'user-fixed', jwt: 'any-token-string' });
  });

  it('throws if no defaultUserId configured', async () => {
    const svc = new MockAuthService();
    await expect(svc.verifyJwt('Bearer abc')).rejects.toThrow(/defaultUserId/);
  });
});
