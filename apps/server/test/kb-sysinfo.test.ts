import Fastify from 'fastify';
import { Kysely, DummyDriver, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { registerSystemInfoRoutes } from '../src/http/routes/systemInfo.js';
import { registerKnowledgeRoutes } from '../src/http/routes/knowledge.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
const deps = { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1, NODE_ENV: 'test' } as any, keyProvider: {} as any };

function dummyDb() {
  return new Kysely<any>({ dialect: { createAdapter: () => new MysqlAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: db => new MysqlIntrospector(db), createQueryCompiler: () => new MysqlQueryCompiler() } });
}

describe('system information', () => {
  it.each(['user', 'admin'] as const)('is not available to %s accounts', async role => {
    const app = Fastify(); app.decorate('db', dummyDb());
    app.addHook('onRequest', async req => { req.ticketSession = { uid: 'u', username: 'u', role }; });
    registerSystemInfoRoutes(app, deps);
    try { expect((await app.inject({ method: 'GET', url: '/api/v2/system/info' })).statusCode).toBe(403); }
    finally { await app.close(); }
  });
  it('returns versions and installation state to superadmins without exposing secrets', async () => {
    const app = Fastify(); app.decorate('db', dummyDb());
    app.addHook('onRequest', async req => { req.ticketSession = { uid: 'u', username: 'u', role: 'superadmin' }; });
    registerSystemInfoRoutes(app, deps);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v2/system/info' });
      expect(response.statusCode).toBe(200);
      const info = response.json();
      expect(info.runtime.node).toBe(process.version);
      expect(info.installation.installationId).toBe('test');
      expect(Array.isArray(info.libraries.server)).toBe(true);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
});

function kbDb(state: { ticketCategories: any[]; kbCategories: any[] }) {
  const inserted: any[] = [];
  const db: any = {
    selectFrom: (table: string) => {
      const filters: any[] = [];
      const chain: any = {
        select: () => chain, selectAll: () => chain, orderBy: () => chain, leftJoin: () => chain,
        where: (...args: any[]) => { filters.push(args); return chain; },
        execute: async () => table === 'categories' ? state.ticketCategories : table === 'kb_categories' ? state.kbCategories : [],
        executeTakeFirst: async () => {
          if (table === 'users') return { permissions_json: JSON.stringify({ kb: 'edit' }) };
          const name = filters.find(f => f[0] === 'name')?.[2];
          const source = table === 'categories' ? state.ticketCategories : table === 'kb_categories' ? state.kbCategories : [];
          return source.find(c => c.name === name);
        }
      };
      return chain;
    },
    insertInto: (table: string) => ({ values: (values: any) => ({ execute: async () => { inserted.push({ table, values }); } }) })
  };
  return { db, inserted };
}
async function kbRequest(method: 'GET' | 'POST', url: string, payload?: any, role: 'user' | 'admin' | 'superadmin' = 'superadmin') {
  const state = { ticketCategories: [{ id: 't1', name: 'Netzwerk' }], kbCategories: [{ id: 'k1', name: 'Anleitungen' }, { id: 'k2', name: 'netzwerk' }] };
  const { db, inserted } = kbDb(state);
  const app = Fastify(); app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'admin', username: 'admin', role }; });
  registerKnowledgeRoutes(app, deps);
  try { return { response: await app.inject({ method, url, payload }), inserted }; }
  finally { await app.close(); }
}

describe('knowledge base categories', () => {
  it('denies requesters (role user) every knowledge base read endpoint', async () => {
    for (const url of ['/api/v2/kb/articles', '/api/v2/kb/categories', '/api/v2/kb/articles/a1/attachments', '/api/v2/kb/attachments/f1']) {
      expect((await kbRequest('GET', url, undefined, 'user')).response.statusCode).toBe(403);
    }
  });
  it('lists ticket categories plus own knowledge base categories without duplicates', async () => {
    const { response } = await kbRequest('GET', '/api/v2/kb/categories');
    expect(response.json().categories).toEqual([
      { id: 't1', name: 'Netzwerk', source: 'ticket' },
      { id: 'k1', name: 'Anleitungen', source: 'kb' }
    ]);
  });
  it('rejects articles with an unknown category and accepts known ones', async () => {
    const unknown = await kbRequest('POST', '/api/v2/kb/articles', { title: 'T', content: '<p>Inhalt</p>', category: 'Gibt es nicht' });
    expect(unknown.response.statusCode).toBe(400);
    expect(unknown.response.json().error).toBe('invalid_category');
    expect(unknown.inserted).toHaveLength(0);
    const known = await kbRequest('POST', '/api/v2/kb/articles', { title: 'T', content: '<p>Inhalt</p>', category: 'Anleitungen' });
    expect(known.response.statusCode).toBe(201);
    expect(known.inserted[0].values.category).toBe('Anleitungen');
  });
  it('refuses a new knowledge base category that already exists', async () => {
    const { response, inserted } = await kbRequest('POST', '/api/v2/kb/categories', { name: 'Netzwerk' });
    expect(response.statusCode).toBe(409);
    expect(inserted).toHaveLength(0);
  });
});
