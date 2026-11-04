import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, type CompiledQuery, type DatabaseConnection, type Driver } from 'kysely';
import { buildApp } from '../src/http/app.js';
import type { Database } from '../src/db/types.js';
import type { Env } from '../src/config/env.js';

// Security-Audit R-30: Autorisierungstest fuer JEDE Route unter /api/v2/tickets/:id mit den Rollen
// "Admin einer anderen Gruppe", "fremdes normales Konto" und "Superadmin" -- gegen die echte App
// (buildApp), damit die zentrale Pruefung mitlaeuft. Die Routen kommen aus dem Quelltext; eine neue
// Route ist damit automatisch erfasst.
const routesDir = new URL('../src/http/routes/', import.meta.url);
const TICKET_ID = '6f1c2a90-1111-4222-8333-944455556666';
const ticketRoutes = readdirSync(routesDir).filter(file => file.endsWith('.ts')).flatMap(file =>
  [...readFileSync(new URL(file, routesDir), 'utf8').matchAll(/\b(?:app|scoped)\.(get|post|put|patch|delete)\(\s*'(\/api\/v2\/tickets\/:id[^']*)'/g)]
    .map(match => ({ method: match[1]!.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', route: match[2]! })));
const EXEMPT = new Set(['/api/v2/tickets/:id/approval-decision']);

const users = [
  { id: 'it-admin', username: 'it', role: 'admin' },
  { id: 'hr-admin', username: 'hr', role: 'admin' },
  { id: 'stranger', username: 'stranger', role: 'user' },
  { id: 'owner', username: 'owner', role: 'user' },
  { id: 'boss', username: 'boss', role: 'superadmin' }
].map(user => ({ ...user, account_archived: false, locked_until: null, locked_permanent: false, account_valid_until: null,
  permissions_json: JSON.stringify({ reports: true }) }));
const memberships = [{ user_id: 'it-admin', group_id: 'it' }, { user_id: 'hr-admin', group_id: 'hr' }];
const groups = [{ id: 'it', parent_id: null }, { id: 'hr', parent_id: null }];
// Nicht zugewiesenes Ticket der Gruppe "hr" -- nur hr-Mitglieder (und Superadmins) duerfen es sehen.
const ticket = { id: TICKET_ID, ticket_number: 'T-1', created_by_user_id: 'owner', created_by_username: 'owner', assigned_to_user_id: null,
  assigned_to_username: null, assigned_group_id: 'hr', category: 'Personal', status: 'Neu', archived_at: null, approval_status: null,
  approval_reviewer_id: null, merged_into_ticket_id: null, created_at: new Date(), first_response_at: null };

// Kysely mit einem Treiber, der Abfragen anhand des SQL-Texts beantwortet und Schreibzugriffe mitschreibt.
const writes: Array<{ op: string; table: string; parameters: readonly unknown[] }> = [];
function topLevelTable(sql: string): string | null {
  for (const match of sql.matchAll(/ from `(\w+)`/g)) {
    const before = sql.slice(0, match.index);
    if ((before.match(/\(/g) || []).length === (before.match(/\)/g) || []).length) return match[1]!;
  }
  return null;
}
function rowsFor(table: string | null, params: readonly unknown[]): unknown[] {
  const has = (value: string) => params.includes(value);
  switch (table) {
    case 'app_settings': return [{ id: 1, config_json: '{}', setup_completed_at: new Date() }];
    case 'sessions': return [{ revoked_at: null, expires_at: new Date(Date.now() + 3600_000), last_seen_at: new Date() }];
    case 'users': { const hit = users.filter(user => has(user.id)); return hit.length ? hit : users; }
    case 'tickets': return params.some(value => typeof value === 'string' && value !== TICKET_ID && /^[0-9a-f-]{36}$/.test(value)) ? [] : [ticket];
    case 'user_groups': return memberships.filter(row => has(row.user_id));
    case 'groups': return groups;
    default: return [];
  }
}
const connection: DatabaseConnection = {
  async executeQuery<R>(query: CompiledQuery): Promise<{ rows: R[] }> {
    const sql = query.sql;
    const write = sql.match(/^(insert into|update|delete from) `(\w+)`/);
    if (write) { writes.push({ op: write[1]!, table: write[2]!, parameters: query.parameters }); return { rows: [] }; }
    return { rows: rowsFor(topLevelTable(sql), query.parameters) as R[] };
  },
  async *streamQuery() { throw new Error('not supported'); }
};
const driver: Driver = {
  init: async () => {}, acquireConnection: async () => connection, beginTransaction: async () => {}, commitTransaction: async () => {},
  rollbackTransaction: async () => {}, releaseConnection: async () => {}, destroy: async () => {}
};
const db = new Kysely<Database>({ dialect: { createAdapter: () => new MysqlAdapter(), createDriver: () => driver,
  createIntrospector: kysely => new MysqlIntrospector(kysely), createQueryCompiler: () => new MysqlQueryCompiler() } });

describe('ticket routes refuse accounts without access (R-30)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      env: { NODE_ENV: 'test', PORT: 3000, HOST: '127.0.0.1', COOKIE_SECRET: 'a'.repeat(32), INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000' } as Env,
      db, keyProvider: { currentKekVersion: async () => 1, wrapDek: async (raw: Buffer) => raw, unwrapDek: async (wrapped: Buffer) => wrapped } as any
    });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  async function call(uid: string, method: string, route: string) {
    const url = route.replace(':id', TICKET_ID).replace(/:([A-Za-z]+)/g, 'probe-$1');
    const session = app.signCookie(Buffer.from(JSON.stringify({ uid, sid: `sid-${uid}`, iat: Date.now() })).toString('base64url'));
    writes.length = 0;
    const response = await app.inject({ method: method as any, url, cookies: { ticket_session: session, csrf_token: 'csrf' },
      headers: { 'x-csrf-token': 'csrf' }, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    // Nur das Zugriffsprotokoll darf schreiben, nichts am Ticket selbst.
    await new Promise(resolve => setImmediate(resolve));
    const ticketWrites = writes.filter(entry => entry.table !== 'global_audit_log' && entry.table !== 'sessions'
      && !(entry.table === 'ticket_audit_log' && entry.parameters.some(value => typeof value === 'string' && value.startsWith('activity:'))));
    return { response, ticketWrites };
  }

  it('finds the ticket routes in the source', () => {
    expect(ticketRoutes.length).toBeGreaterThan(30);
  });

  it.each(ticketRoutes.filter(entry => !EXEMPT.has(entry.route)))('$method $route answers 404 for an admin of another group', async ({ method, route }) => {
    const { response, ticketWrites } = await call('it-admin', method, route);
    expect(response.statusCode, `${method} ${route} -> ${response.body.slice(0, 120)}`).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
    expect(ticketWrites).toEqual([]);
  });

  it.each(ticketRoutes.filter(entry => !EXEMPT.has(entry.route)))('$method $route answers 404 for a foreign normal account', async ({ method, route }) => {
    const { response, ticketWrites } = await call('stranger', method, route);
    expect(response.statusCode, `${method} ${route} -> ${response.body.slice(0, 120)}`).toBe(404);
    expect(ticketWrites).toEqual([]);
  });

  it('lets group members, the author and superadmins through', async () => {
    for (const uid of ['hr-admin', 'boss']) {
      expect((await call(uid, 'GET', '/api/v2/tickets/:id/participants')).response.statusCode).toBe(200);
      expect((await call(uid, 'GET', '/api/v2/tickets/:id/audit-log')).response.statusCode).toBe(200);
    }
    expect((await call('owner', 'GET', '/api/v2/tickets/:id/participants')).response.statusCode).toBe(200);
  });

  it('leaves the approval decision to its own reviewer check', async () => {
    const { response } = await call('it-admin', 'POST', '/api/v2/tickets/:id/approval-decision');
    expect(response.statusCode).not.toBe(404);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('first-response-times only lists tickets the admin may see', async () => {
    const hidden = await call('it-admin', 'GET', '/api/v2/tickets/first-response-times');
    expect(hidden.response.statusCode).toBe(200);
    expect(hidden.response.json().tickets).toEqual([]);
    const visible = await call('hr-admin', 'GET', '/api/v2/tickets/first-response-times');
    expect(visible.response.json().tickets.map((row: { id: string }) => row.id)).toEqual([TICKET_ID]);
    expect(Object.keys(visible.response.json().tickets[0]).sort()).toEqual(['created_at', 'first_response_at', 'id']);
  });
});
