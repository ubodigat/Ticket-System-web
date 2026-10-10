import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Kysely, DummyDriver, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { buildApp } from '../src/http/app.js';
import type { Database } from '../src/db/types.js';
import type { Env } from '../src/config/env.js';
import type { KeyProvider } from '../src/crypto/keyProvider.js';

// Reiner Boot-/Verdrahtungstest, OHNE echte Datenbank: eine echte MariaDB ist in dieser
// Umgebung nicht verfügbar, Mocken jeder einzelnen Query wäre unverhältnismäßig. DummyDriver
// (von Kysely selbst bereitgestellt) lässt jede Query "erfolgreich" mit 0 Zeilen zurückkehren,
// wirft aber NICHT -- das reicht, um genau die Fehlerklasse zu fangen, die den echten
// Produktionsausfall vom 11.10.2026 verursacht hat: ein Hook/Plugin, der in falscher
// Reihenfolge registriert ist, wirft bei JEDER Anfrage (auch /health) einen ungefangenen
// Fehler, lange bevor eine echte Datenbankantwort überhaupt eine Rolle spielt. Ersetzt keinen
// echten Durchklick-Test gegen eine echte Installation, fängt aber genau diese Klasse von
// Verdrahtungsfehlern, die Typecheck/Unit-Tests allein nicht sehen (siehe CHANGES.md
// 2026-10-11 "Kritischer Ausfall (502)").
function fakeDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler()
    }
  });
}

function fakeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '127.0.0.1',
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_NAME: 'ticketsystem_test',
    DB_USER: 'app',
    DB_PASSWORD: 'secret',
    DB_SSL_REJECT_UNAUTHORIZED: true,
    KEK_FILE_PATH: '/dev/null',
    COOKIE_SECRET: 'a'.repeat(32),
    INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000',
    SCHEMA_VERSION: 1,
    TRUSTED_PROXY_HOPS: 0
  };
}

function fakeKeyProvider(): KeyProvider {
  return {
    getCurrentKek: async () => ({ version: 1 }),
    wrapDek: async (raw) => raw,
    unwrapDek: async (wrapped) => wrapped
  };
}

describe('buildApp – Boot- und Verdrahtungs-Smoke-Test', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: fakeEnv(), db: fakeDb(), keyProvider: fakeKeyProvider() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('startet ohne zu werfen (fängt Registrierungsreihenfolge-Fehler wie den 502-Vorfall)', () => {
    expect(app).toBeDefined();
  });

  it('/health antwortet, statt bei jeder Anfrage ungefangen zu werfen', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect([200, 503]).toContain(res.statusCode);
  });

  it('geschützte v2-Routen antworten ohne Sitzung mit 401, nicht mit 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('ein manipuliertes/ungültiges Sitzungs-Cookie lässt den onRequest-Hook nicht abstürzen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/tickets', cookies: { ticket_session: 'garbage-not-a-valid-signed-cookie' } });
    expect(res.statusCode).toBe(401);
  });

  it('Admin-only-Routen antworten ohne Sitzung ebenfalls mit 401, nicht mit 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/users' });
    expect(res.statusCode).toBe(401);
  });

  it('eine unbekannte Route liefert 404, kein Absturz', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v2/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
