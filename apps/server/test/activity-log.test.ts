import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { recordActivity, shouldRecord } from '../src/domain/activityLog.js';

function fakeDb() {
  const rows: any[] = [];
  const db: any = {
    insertInto: (table: string) => ({ values: (values: any) => ({ execute: async () => { rows.push({ table, ...values }); } }) }),
    selectFrom: () => { const chain: any = { select: () => chain, where: () => chain, executeTakeFirst: async () => ({ ticket_number: 'TS-7' }) }; return chain; }
  };
  return { db, rows };
}

async function run(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, status = 200, session: any = { uid: 'u1', username: 'anna', role: 'admin' }) {
  const { db, rows } = fakeDb();
  const app = Fastify();
  app.decorateRequest('ticketSession', null);
  app.decorateRequest('auditDetail', null);
  app.addHook('onRequest', async req => { req.ticketSession = session; });
  app.addHook('onResponse', async (req, reply) => { await recordActivity(db, req, reply); });
  const handler = async (_req: any, reply: any) => reply.code(status).send({ ok: status < 400 });
  for (const path of ['/api/v2/tickets/:id', '/api/v2/tickets', '/api/v2/users/:id/change-password', '/api/v1/auth/login', '/api/v2/attachments/:id',
    '/api/v2/tickets/:id/messages', '/api/v2/tickets/:id/audit-log']) {
    app.route({ method: ['GET', 'POST', 'PATCH', 'DELETE'], url: path, handler });
  }
  try { await app.inject({ method, url, payload: method === 'GET' ? undefined : { password: 'Geheim-123' } }); }
  finally { await app.close(); }
  return rows;
}

describe('complete activity log', () => {
  it('records every changing action with actor, route, target, status and IP -- never the body', async () => {
    const rows = await run('PATCH', '/api/v2/tickets/t-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table: 'global_audit_log', actor_user_id: 'u1', actor_username: 'anna',
      action: 'request:PATCH /api/v2/tickets/:id', target_id: 't-1' });
    const detail = JSON.parse(rows[0].detail_json);
    expect(detail).toMatchObject({ status: 200, ticket: 'TS-7', params: { id: 't-1' } });
    expect(detail.ip).toBeTruthy();
    expect(rows[0].detail_json).not.toContain('Geheim-123');
  });
  it('records denied attempts, also for routes that write their own entry on success', async () => {
    expect(await run('POST', '/api/v2/users/x/change-password', 200)).toHaveLength(0);
    const denied = await run('POST', '/api/v2/users/x/change-password', 403);
    expect(denied).toHaveLength(1);
    expect(JSON.parse(denied[0].detail_json).status).toBe(403);
  });
  it('records reads of sensitive data, but not ordinary reads', async () => {
    expect(await run('GET', '/api/v2/attachments/a-1')).toHaveLength(1);
    expect(await run('GET', '/api/v2/tickets/t-1')).toHaveLength(0);
  });
  it('marks anonymous actions and skips rate-limited floods and self-logging login routes', async () => {
    const anonymous = await run('POST', '/api/v2/tickets', 401, null);
    expect(anonymous[0]).toMatchObject({ actor_user_id: null, actor_username: '-' });
    expect(await run('POST', '/api/v2/tickets', 429)).toHaveLength(0);
    expect(await run('POST', '/api/v1/auth/login', 401, null)).toHaveLength(0);
  });
  it('also writes every ticket action into that ticket\'s own protocol, without duplicating detailed entries', async () => {
    const message = await run('POST', '/api/v2/tickets/t-1/messages', 201);
    expect(message.map(r => r.table)).toEqual(['global_audit_log', 'ticket_audit_log']);
    expect(message[1]).toMatchObject({ ticket_id: 't-1', actor_username: 'anna', action: 'activity:POST /api/v2/tickets/:id/messages', new_value: null });
    const denied = await run('POST', '/api/v2/tickets/t-1/messages', 403);
    expect(denied[1]).toMatchObject({ table: 'ticket_audit_log', new_value: 'HTTP 403' });
    expect((await run('PATCH', '/api/v2/tickets/t-1')).map(r => r.table)).toEqual(['global_audit_log']);
    expect((await run('GET', '/api/v2/tickets/t-1/audit-log')).map(r => r.table)).toEqual(['global_audit_log']);
  });
  it('ignores non-API paths and unknown routes', () => {
    expect(shouldRecord('POST', undefined, 404)).toBe(false);
    expect(shouldRecord('POST', '/setup', 200)).toBe(false);
  });
});
