import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { isAccountExpired, isValidAccountDate } from '../src/domain/accountValidity.js';
import { registerUsersV2Routes } from '../src/http/routes/users.js';
import { registerAuthRoutes } from '../src/http/routes/auth.js';
import { buildApp } from '../src/http/app.js';

vi.mock('argon2', () => ({ hash: async () => 'hashed', verify: async () => true, argon2id: 2 }));
vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
const env: any = { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 3000, COOKIE_SECRET: 'a'.repeat(32), INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 };
const deps = { env, keyProvider: {} as any };

function database(expiry: string | null = null, role = 'user', rootCount = 0) {
  const writes: any[] = [];
  const conditions: any[] = [];
  const user = { id: 'target', username: 'person', role, account_valid_until: expiry, password_hash: 'hash',
    permissions_json: JSON.stringify({ canManageUsers: true }), account_archived: false, locked_permanent: false,
    locked_until: null, totp_enabled: true, totp_secret_enc: Buffer.alloc(50) };
  const db: any = {
    selectFrom: (table: string) => {
      const where: any[] = [];
      const q: any = { select: () => q, selectAll: () => q, orderBy: () => q,
        where: (...args: any[]) => { where.push(args); conditions.push({ table, args }); return q; },
        executeTakeFirst: async () => table === 'app_settings' ? { config_json: '{}', setup_completed_at: new Date() }
          : table === 'sessions' ? { expires_at: new Date(Date.now() + 3600_000), last_seen_at: new Date(), revoked_at: null }
          : table === 'users' && !where.some(([key]) => key === 'email_blind_idx') ? user : undefined,
        executeTakeFirstOrThrow: async () => ({ n: rootCount }), execute: async () => [] };
      return q;
    },
    updateTable: (table: string) => { const q: any = { set: (value: any) => { writes.push({ table, value }); return q; }, where: () => q, execute: async () => [] }; return q; },
    insertInto: (table: string) => ({ values: (value: any) => ({ execute: async () => writes.push({ table, value }) }) })
  };
  return { db, writes, conditions, user };
}

describe('account validity calendar semantics', () => {
  it.each(['2026-02-30', '2025-02-29', '22.10.2026', '2026-1-01', '', '0000-01-01'])('rejects invalid date %s', date => {
    expect(isValidAccountDate(date)).toBe(false);
  });
  it('accepts leap days and treats no limit as unlimited', () => {
    expect(isValidAccountDate('2028-02-29')).toBe(true);
    expect(isAccountExpired(null)).toBe(false);
    expect(isAccountExpired(undefined)).toBe(false);
  });
  it('remains valid through the chosen day in Berlin, including summer time', () => {
    expect(isAccountExpired('2026-10-22', new Date('2026-10-22T21:59:59.999Z'))).toBe(false);
    expect(isAccountExpired('2026-10-22', new Date('2026-10-22T22:00:00Z'))).toBe(true);
    expect(isAccountExpired('2026-12-22', new Date('2026-12-22T22:59:59.999Z'))).toBe(false);
    expect(isAccountExpired('2026-12-22', new Date('2026-12-22T23:00:00Z'))).toBe(true);
    expect(isAccountExpired(new Date('2026-10-22T00:00:00Z'), new Date('2026-10-22T22:00:00Z'))).toBe(true);
    expect(isAccountExpired('corrupt')).toBe(true);
  });
});

async function update(role: 'user' | 'admin' | 'superadmin', payload: any, expiry: string | null = null, targetRole = 'user', rootCount = 0) {
  const data = database(expiry, targetRole, rootCount);
  const app = Fastify(); app.decorate('db', data.db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: role === 'user' ? 'target' : 'actor', username: 'actor', role }; });
  registerUsersV2Routes(app, deps);
  try { return { ...data, response: await app.inject({ method: 'PATCH', url: '/api/v2/users/target', payload }) }; }
  finally { await app.close(); }
}

describe('account validity administration', () => {
  it('persists an optional validity date when creating an account', async () => {
    const data = database(); const select = data.db.selectFrom;
    data.db.selectFrom = (table: string) => {
      const q = select(table);
      if (table === 'users') q.executeTakeFirst = async () => undefined;
      return q;
    };
    const app = Fastify(); app.decorate('db', data.db);
    app.addHook('onRequest', async req => { req.ticketSession = { uid: 'actor', username: 'admin', role: 'superadmin' }; });
    registerUsersV2Routes(app, deps);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v2/users', payload: {
        username: 'new-person', name: 'New Person', email: 'person@example.org', password: 'long-enough-password', role: 'user', account_valid_until: '2099-12-31'
      } });
      expect(response.statusCode).toBe(201);
      expect(data.writes).toContainEqual({ table: 'users', value: expect.objectContaining({ account_valid_until: '2099-12-31' }) });
    } finally { await app.close(); }
  });
  it('saves a future validity date without logging the user out early', async () => {
    const result = await update('superadmin', { account_valid_until: '2099-12-31' });
    expect(result.response.statusCode).toBe(200);
    expect(result.writes).toContainEqual({ table: 'users', value: expect.objectContaining({ account_valid_until: '2099-12-31' }) });
    expect(result.writes.some(w => w.table === 'sessions')).toBe(false);
  });
  it('can remove a validity limit and revokes old sessions when restoring an expired account', async () => {
    const result = await update('superadmin', { account_valid_until: null }, '2000-01-01');
    expect(result.response.statusCode).toBe(200);
    expect(result.writes.some(w => w.table === 'sessions')).toBe(true);
    expect(result.writes).toContainEqual({ table: 'users', value: expect.objectContaining({ account_valid_until: null }) });
  });
  it('revokes sessions when immediately expiring an account', async () => {
    const result = await update('admin', { account_valid_until: '2000-01-01' });
    expect(result.response.statusCode).toBe(200);
    expect(result.writes.some(w => w.table === 'sessions')).toBe(true);
  });
  it('does not let users extend or clear their own validity', async () => {
    for (const value of [null, '2099-12-31']) {
      const result = await update('user', { account_valid_until: value });
      expect(result.response.statusCode).toBe(403); expect(result.writes).toHaveLength(0);
    }
  });
  it('rejects invalid calendar dates without changing the account', async () => {
    const result = await update('superadmin', { account_valid_until: '2026-02-31' });
    expect(result.response.statusCode).toBe(400); expect(result.writes).toHaveLength(0);
  });
  it('protects the last unlimited superadmin and forbids admin-to-admin changes', async () => {
    expect((await update('superadmin', { account_valid_until: '2099-01-01' }, null, 'superadmin')).response.statusCode).toBe(409);
    expect((await update('admin', { account_valid_until: '2099-01-01' }, null, 'admin')).response.statusCode).toBe(403);
    const allowed = await update('superadmin', { account_valid_until: '2099-01-01' }, null, 'superadmin', 1);
    expect(allowed.response.statusCode).toBe(200);
    expect(allowed.conditions).toContainEqual({ table: 'users', args: ['account_valid_until', 'is', null] });
  });
});

describe('expired account access', () => {
  it('rejects password login and pending MFA even when credentials are otherwise correct', async () => {
    const { db, writes } = database('2000-01-01'); const app = Fastify(); app.decorate('db', db);
    registerAuthRoutes(app, deps);
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'person', password: 'correct-password' } });
      expect(login.statusCode).toBe(401);
      const json = JSON.stringify({ uid: 'target', iat: Date.now() });
      const mfaToken = Buffer.from(json).toString('base64url') + '.' + createHmac('sha256', env.COOKIE_SECRET).update(json).digest('base64url');
      const mfa = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa-verify', payload: { mfaToken, code: '123456' } });
      expect(mfa.statusCode).toBe(401);
      expect(writes.some(w => w.table === 'sessions')).toBe(false);
    } finally { await app.close(); }
  });
  it.each([null, '2099-01-01', '2000-01-01'])('checks expiry on every existing session (%s)', async expiry => {
    const { db } = database(expiry);
    const app = await buildApp({ ...deps, db });
    app.get('/expiry-probe', async (req, reply) => reply.code(req.ticketSession ? 200 : 401).send({}));
    try {
      const payload = Buffer.from(JSON.stringify({ uid: 'target', sid: 'session', iat: Date.now() })).toString('base64url');
      const response = await app.inject({ method: 'GET', url: '/expiry-probe', cookies: { ticket_session: app.signCookie(payload) } });
      expect(response.statusCode).toBe(expiry === '2000-01-01' ? 401 : 200);
    } finally { await app.close(); }
  });
});
