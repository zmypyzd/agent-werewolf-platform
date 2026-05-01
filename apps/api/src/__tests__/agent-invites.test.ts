import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({ email: 'inviter@x.test', password: 'hunter22pw', displayName: 'Inviter' }),
  });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  const sc = reg.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)![1]!;
});

afterEach(async () => {
  await app.close();
});

async function createInvite(body: unknown = { displayName: 'Range Builder', notes: 'for eval', ttlSec: 3600 }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/agents/invites',
    headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify(body),
  });
}

describe('Agent Lab invites', () => {
  it('creates an Agent Lab invite with a register URL and no table binding', async () => {
    const res = await createInvite();

    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.token).toEqual(expect.any(String));
    expect(data.expiresAt).toBeGreaterThan(Date.now());
    expect(data.registerUrl).toContain(`/api/v1/agents/invites/${data.token}/register`);
    expect(JSON.stringify(data)).not.toContain('tableId');
  });

  it('rejects table-bound invite payloads', async () => {
    const res = await createInvite({ displayName: 'Bad Link', tableId: 'table-1', ttlSec: 3600 });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('registers an external agent config for the invite owner and marks the token used', async () => {
    const inviteRes = await createInvite();
    const token = JSON.parse(inviteRes.body).data.token;

    const registered = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/invites/${token}/register`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        displayName: 'External Solver',
        endpointUrl: 'http://localhost:9811/decide',
        authHeaderName: 'Authorization',
        authHeaderValue: 'Bearer never-echo',
        timeoutMs: 1200,
      }),
    });

    expect(registered.statusCode).toBe(201);
    const created = JSON.parse(registered.body).data.agent;
    expect(created.agentConfigId).toEqual(expect.any(String));
    expect(created.agentName).toBe('External Solver');
    expect(created.endpointUrl).toBe('http://localhost:9811/decide');
    expect(created.hasAuthHeader).toBe(true);
    expect(JSON.stringify(registered.body)).not.toContain('never-echo');

    const agents = await app.inject({
      method: 'GET',
      url: '/api/v1/me/agents',
      cookies: { apk_sid: cookie },
    });
    expect(agents.statusCode).toBe(200);
    expect(JSON.parse(agents.body).data.map((agent: { agentName: string }) => agent.agentName))
      .toContain('External Solver');

    const invites = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/invites',
      cookies: { apk_sid: cookie },
    });
    expect(invites.statusCode).toBe(200);
    expect(JSON.parse(invites.body).data).toContainEqual(expect.objectContaining({
      token,
      status: 'used',
      registeredAgentConfigId: created.agentConfigId,
    }));

    const secondUse = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/invites/${token}/register`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        displayName: 'Second Solver',
        endpointUrl: 'http://localhost:9812/decide',
      }),
    });
    expect(secondUse.statusCode).toBe(410);
    expect(JSON.parse(secondUse.body).error.code).toBe('AGENT_INVITE_UNAVAILABLE');
  });

  it('lists and revokes unused invites for the current user', async () => {
    const inviteRes = await createInvite({ displayName: 'Unused', notes: 'delete me', ttlSec: 60 });
    const token = JSON.parse(inviteRes.body).data.token;

    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/invites',
      cookies: { apk_sid: cookie },
    });
    expect(listBefore.statusCode).toBe(200);
    expect(JSON.parse(listBefore.body).data).toContainEqual(expect.objectContaining({
      token,
      displayName: 'Unused',
      notes: 'delete me',
      status: 'pending',
    }));

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/invites/${token}`,
      headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(revoked.statusCode).toBe(204);

    const registerAfterRevoke = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/invites/${token}/register`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        displayName: 'Late Solver',
        endpointUrl: 'http://localhost:9813/decide',
      }),
    });
    expect(registerAfterRevoke.statusCode).toBe(410);
    expect(JSON.parse(registerAfterRevoke.body).error.code).toBe('AGENT_INVITE_UNAVAILABLE');
  });
});
