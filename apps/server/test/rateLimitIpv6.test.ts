import { describe, it, expect } from 'vitest';
import { Kysely, DummyDriver, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { buildApp } from '../src/http/app.js';
import type { Database } from '../src/db/types.js';
import type { Env } from '../src/config/env.js';
import type { KeyProvider } from '../src/crypto/keyProvider.js';

// Security-Audit R-10 / CVE-2026-15144: Vor @fastify/rate-limit 11.2.0 wurde der Zähler aus dem
// rohen Text von req.ip gebildet. Eine IPv6-Adresse hat viele gültige Schreibweisen, und ein
// Anschluss verfügt meist über ein ganzes /64-Netz -- jede neue Adresse bekam dadurch ein
// frisches Kontingent, was Password-Spraying trotz Login-Limit erlaubte. ipv6Subnet: 64 in
// app.ts fasst IPv6-Clients jetzt ausdrücklich auf das /64-Netz zusammen. Dieser Test schlägt mit
// @fastify/rate-limit < 11.2.0 fehl und besteht ab 11.2.1.
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

function fakeKeyProvider(): KeyProvider {
  return {
    getCurrentKek: async () => ({ version: 1 }),
    wrapDek: async (raw) => raw,
    unwrapDek: async (wrapped) => wrapped
  };
}

async function buildTestApp() {
  const env: Env = {
    NODE_ENV: 'test', PORT: 3000, HOST: '127.0.0.1',
    DB_HOST: 'localhost', DB_PORT: 3306, DB_NAME: 'ticketsystem_test', DB_USER: 'app', DB_PASSWORD: 'secret',
    DB_SSL_REJECT_UNAUTHORIZED: true, KEK_FILE_PATH: '/dev/null', COOKIE_SECRET: 'a'.repeat(32),
    INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000', SCHEMA_VERSION: 1,
    TRUSTED_PROXY_CIDR: '172.30.250.0/24'
  };
  const app = await buildApp({ env, db: fakeDb(), keyProvider: fakeKeyProvider() });
  await app.ready();
  return app;
}

describe('rate-limit IPv6-Normalisierung (Security-Audit R-10)', () => {
  it('zählt Login-Anfragen aus demselben IPv6-/64-Netz gemeinsam statt pro Adresse', async () => {
    const app = await buildTestApp();
    try {
      let limited = 0;
      for (let i = 1; i <= 15; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/v1/auth/login',
          remoteAddress: '172.30.250.5', // vertrautes Caddy-Netz
          headers: { 'x-forwarded-for': `2001:db8:1:2::${i.toString(16)}` }, // wechselnde Adresse, gleiches /64
          payload: { username: 'x', password: 'y' }
        });
        if (res.statusCode === 429) limited++;
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('zählt dieselbe IPv6-Adresse in unterschiedlichen Schreibweisen weiterhin gemeinsam', async () => {
    const app = await buildTestApp();
    try {
      const notations = [
        '2001:db8:1:2:0:0:0:1', '2001:0db8:0001:0002:0000:0000:0000:0001',
        '2001:db8:1:2::1', '2001:DB8:1:2::1', '2001:db8:1:2:0::1'
      ];
      let limited = 0;
      for (let round = 0; round < 3; round++) {
        for (const addr of notations) {
          const res = await app.inject({
            method: 'POST', url: '/api/v1/auth/login',
            remoteAddress: '172.30.250.5',
            headers: { 'x-forwarded-for': addr },
            payload: { username: 'x', password: 'y' }
          });
          if (res.statusCode === 429) limited++;
        }
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
