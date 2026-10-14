import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUpdateRoutes } from '../src/http/routes/update.js';
import type { Env } from '../src/config/env.js';

afterEach(() => vi.unstubAllGlobals());

async function requestUpdate(env: Partial<Env>, role: 'user' | 'superadmin' = 'superadmin', method: 'GET' | 'POST' = 'GET') {
  const app = Fastify();
  app.addHook('onRequest', async req => {
    req.ticketSession = { uid: 'test-user', username: 'test', role };
  });
  registerUpdateRoutes(app, { env: env as Env });
  try {
    return await app.inject({ method, url: `/api/v2/update/${method === 'GET' ? 'status' : 'run'}` });
  } finally {
    await app.close();
  }
}

describe('update routes', () => {
  const enabledEnv = { UPDATE_SERVICE_URL: 'http://updater:3099', UPDATE_TOKEN: 'test-token' };

  it('reports an unconfigured updater without treating a status query as an outage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate({});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false, error: 'update_service_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await requestUpdate({}, 'superadmin', 'POST')).statusCode).toBe(503);
  });

  it('rejects ordinary users before contacting the privileged updater', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await requestUpdate(enabledEnv, 'user')).statusCode).toBe(403);
    expect((await requestUpdate(enabledEnv, 'user', 'POST')).statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards an authenticated status response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, updateAvailable: true })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate(enabledEnv);
    expect(response.statusCode).toBe(200);
    expect(response.json().enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://updater:3099/status', expect.objectContaining({
      headers: { authorization: 'Bearer test-token' }
    }));
  });

  it('distinguishes an unreachable configured updater from disabled updates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const response = await requestUpdate(enabledEnv);
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('update_service_unreachable');
  });
});
