import { describe, it, expect } from 'vitest';
import { Kysely, DummyDriver, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { buildApp } from '../src/http/app.js';
import type { Database } from '../src/db/types.js';
import type { Env } from '../src/config/env.js';
import type { KeyProvider } from '../src/crypto/keyProvider.js';

// Security-Audit R-1: Regressionstest fuer trustProxy, wie vom Audit-Bericht gefordert --
// bestaetigt dauerhaft, dass req.ip hinter dem konfigurierten Proxy-Netz die echte Client-IP
// liefert (nicht die des Proxys), UND dass eine direkte Anfrage von AUSSERHALB dieses Netzes den
// X-Forwarded-For-Header nicht einfach faelschen kann.
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

async function buildTestApp(trustedProxyCidr: string | undefined) {
  const env: Env = {
    NODE_ENV: 'test', PORT: 3000, HOST: '127.0.0.1',
    DB_HOST: 'localhost', DB_PORT: 3306, DB_NAME: 'ticketsystem_test', DB_USER: 'app', DB_PASSWORD: 'secret',
    DB_SSL_REJECT_UNAUTHORIZED: true, KEK_FILE_PATH: '/dev/null', COOKIE_SECRET: 'a'.repeat(32),
    INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000', SCHEMA_VERSION: 1,
    ...(trustedProxyCidr ? { TRUSTED_PROXY_CIDR: trustedProxyCidr } : {})
  };
  const app = await buildApp({ env, db: fakeDb(), keyProvider: fakeKeyProvider() });
  // Diagnose-Route nur fuer diesen Test -- muss VOR app.ready() registriert werden.
  app.get('/__test/ip', async (req) => ({ ip: req.ip, protocol: req.protocol }));
  await app.ready();
  return app;
}

describe('trustProxy (Security-Audit R-1)', () => {
  it('ohne TRUSTED_PROXY_CIDR vertraut der Server keinem Proxy (sicherer Default)', async () => {
    const app = await buildTestApp(undefined);
    try {
      const res = await app.inject({
        method: 'GET', url: '/__test/ip',
        remoteAddress: '172.30.250.5', // simulierter Caddy-Container
        headers: { 'x-forwarded-for': '203.0.113.9' } // vom Client behaupteter Wert
      });
      // Ohne Vertrauen zaehlt NUR die direkte TCP-Peer-Adresse, der Header wird ignoriert.
      expect(res.json().ip).toBe('172.30.250.5');
    } finally {
      await app.close();
    }
  });

  it('mit TRUSTED_PROXY_CIDR liefert req.ip die echte Client-IP hinter dem Proxy', async () => {
    const app = await buildTestApp('172.30.250.0/24');
    try {
      const res = await app.inject({
        method: 'GET', url: '/__test/ip',
        remoteAddress: '172.30.250.5', // Caddy, im vertrauten Netz
        headers: { 'x-forwarded-for': '203.0.113.9' } // von Caddy gesetzter, echter Client-Wert
      });
      expect(res.json().ip).toBe('203.0.113.9');
    } finally {
      await app.close();
    }
  });

  it('ein direkter Client (nicht im vertrauten Netz) kann seine eigene IP nicht per Header faelschen', async () => {
    const app = await buildTestApp('172.30.250.0/24');
    try {
      const res = await app.inject({
        method: 'GET', url: '/__test/ip',
        remoteAddress: '198.51.100.1', // direkter Client, NICHT im vertrauten Proxy-Netz
        headers: { 'x-forwarded-for': '203.0.113.9' } // Faelschungsversuch
      });
      // Da der direkte Peer nicht im vertrauten Netz liegt, zaehlt dessen eigene Adresse,
      // der gefaelschte Header wird verworfen -- genau das verhindert, dass sich alle Nutzer
      // (oder ein Angreifer) ein Rate-Limit "erschleichen" koennen, indem sie X-Forwarded-For
      // selbst setzen.
      expect(res.json().ip).toBe('198.51.100.1');
    } finally {
      await app.close();
    }
  });
});
