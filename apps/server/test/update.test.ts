import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUpdateRoutes } from '../src/http/routes/update.js';
import type { Env } from '../src/config/env.js';

afterEach(() => vi.unstubAllGlobals());

// Step-up (siehe update.ts requireStepUp) prueft das Passwort echt per argon2 -- fuer die Tests
// reicht ein simpler Mock, der "correct-password" als gueltig behandelt, ohne echtes Hashing.
vi.mock('argon2', () => ({ verify: async (_hash: string, password: string) => password === 'correct-password' }));

const baseEnv: Partial<Env> = { INSTALLATION_ID: 'test-install', SCHEMA_VERSION: 1 };

function buildDb() {
  const auditLogRows: unknown[] = [];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = {
        select: () => chain,
        where: () => chain,
        executeTakeFirst: async () => table === 'users' ? { password_hash: 'irrelevant', totp_enabled: false, totp_secret_enc: null } : undefined,
        executeTakeFirstOrThrow: async () => ({ password_hash: 'irrelevant', totp_enabled: false, totp_secret_enc: null })
      };
      return chain;
    },
    insertInto: (table: string) => ({
      values: (value: unknown) => ({
        execute: async () => { if (table === 'global_audit_log') auditLogRows.push(value); }
      })
    })
  };
  return { db, auditLogRows };
}

async function requestUpdate(
  env: Partial<Env>,
  role: 'user' | 'superadmin' = 'superadmin',
  method: 'GET' | 'POST' = 'GET',
  path: 'status' | 'run' | 'migrate' | 'rollback' = method === 'GET' ? 'status' : 'run',
  payload?: Record<string, unknown>
) {
  const app = Fastify();
  const { db } = buildDb();
  app.decorate('db', db);
  app.addHook('onRequest', async req => {
    req.ticketSession = { uid: 'test-user', username: 'test', role };
  });
  registerUpdateRoutes(app, { env: { ...baseEnv, ...env } as Env, keyProvider: {} as any });
  try {
    return await app.inject({ method, url: `/api/v2/update/${path}`, payload });
  } finally {
    await app.close();
  }
}

describe('update routes', () => {
  const enabledEnv = { UPDATE_SERVICE_URL: 'http://updater:3099', UPDATE_TOKEN: 'test-token' };
  const stepUp = { password: 'correct-password' };
  const commit = 'a'.repeat(40);

  it('reports an unconfigured updater without treating a status query as an outage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate({});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false, error: 'update_service_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    // /run ohne konfigurierten Updater: Step-up muss trotzdem zuerst durchlaufen (Passwort
    // stimmt), erst der eigentliche Aufruf scheitert an der fehlenden Konfiguration.
    const runResponse = await requestUpdate({}, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(runResponse.statusCode).toBe(503);
    expect(runResponse.json().error).toBe('update_service_not_configured');
  });

  it('rejects ordinary users before contacting the privileged updater', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await requestUpdate(enabledEnv, 'user')).statusCode).toBe(403);
    expect((await requestUpdate(enabledEnv, 'user', 'POST', 'run', { ...stepUp, expected_commit: commit })).statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards an authenticated status response with a signed, non-replayable request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, updateAvailable: true })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate(enabledEnv);
    expect(response.statusCode).toBe(200);
    expect(response.json().enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://updater:3099/status', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer test-token',
        'x-update-timestamp': expect.any(String),
        'x-update-nonce': expect.any(String),
        'x-update-signature': expect.any(String)
      })
    }));
  });

  it('distinguishes an unreachable configured updater from disabled updates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const response = await requestUpdate(enabledEnv);
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('update_service_unreachable');
  });

  it('rejects /run without a correct password (step-up)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate(enabledEnv, 'superadmin', 'POST', 'run', { password: 'wrong', expected_commit: commit });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('wrong_password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects /run when the target commit no longer matches what GitHub reports (commit pinning)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ remoteCommit: 'b'.repeat(40) })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate(enabledEnv, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('commit_mismatch');
  });

  it('runs the update once password and matching commit are confirmed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ remoteCommit: commit })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, job: { running: true } }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestUpdate(enabledEnv, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires a password for /migrate and /rollback too', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await requestUpdate(enabledEnv, 'superadmin', 'POST', 'migrate', {})).statusCode).toBe(401);
    expect((await requestUpdate(enabledEnv, 'superadmin', 'POST', 'rollback', { expected_commit: commit })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
