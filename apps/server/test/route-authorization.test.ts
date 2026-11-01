import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Kysely, DummyDriver, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { buildApp } from '../src/http/app.js';
import type { Database } from '../src/db/types.js';
import type { Env } from '../src/config/env.js';

// Autorisierungstest fuer JEDE API-Route (Security-Audit, Empfehlung "Ein Autorisierungstest pro
// Route"): ohne Anmeldung darf keine Route erfolgreich antworten oder abstuerzen. Die Routen werden
// direkt aus dem Quelltext gelesen -- eine neue Route ohne Waechter faellt damit automatisch auf.
// Einzige bewusst oeffentliche Ausnahmen: Kontoanfrage und MFA-Anmeldeablauf (brauchen ein
// kurzlebiges Anmelde-Token, das hier fehlt) -- auch sie duerfen ohne Token nichts preisgeben.
const routesDir = new URL('../src/http/routes/', import.meta.url);
const routes = readdirSync(routesDir).filter(file => file.endsWith('.ts')).flatMap(file =>
  [...readFileSync(new URL(file, routesDir), 'utf8').matchAll(/\b(?:app|scoped)\.(get|post|put|patch|delete)\(\s*'(\/api\/v2\/[^']+)'/g)]
    .map(match => ({ method: match[1]!.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: match[2]!.replace(/:([A-Za-z]+)/g, 'probe-$1') })));

function fakeDb(): Kysely<Database> {
  return new Kysely<Database>({ dialect: {
    createAdapter: () => new MysqlAdapter(), createDriver: () => new DummyDriver(),
    createIntrospector: db => new MysqlIntrospector(db), createQueryCompiler: () => new MysqlQueryCompiler()
  } });
}

describe('route authorization without a session', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      env: { NODE_ENV: 'test', PORT: 3000, HOST: '127.0.0.1', DB_HOST: 'localhost', DB_PORT: 3306, DB_NAME: 'test', DB_USER: 'app', DB_PASSWORD: 'secret',
        DB_SSL_REJECT_UNAUTHORIZED: true, KEK_FILE_PATH: '/dev/null', COOKIE_SECRET: 'a'.repeat(32),
        INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000', SCHEMA_VERSION: 1 } as Env,
      db: fakeDb(), keyProvider: { getCurrentKek: async () => ({ version: 1 }), wrapDek: async raw => raw, unwrapDek: async wrapped => wrapped } as any
    });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('finds the API routes in the source', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it.each(routes)('$method $url refuses anonymous access', async ({ method, url }) => {
    const response = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
    // Der OAuth-Rueckweg von Microsoft leitet ohne Sitzung nur auf die Fehlermeldung der eigenen Seite.
    if (url === '/api/v2/outlook/callback') {
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toMatch(/^\/[a-z-]+\.html\?outlook=failed$/);
      return;
    }
    expect(response.statusCode, `${method} ${url} -> ${response.statusCode} ${response.body.slice(0, 120)}`).toBeGreaterThanOrEqual(400);
    expect(response.statusCode, `${method} ${url} -> ${response.statusCode}`).toBeLessThan(500);
  });
});
