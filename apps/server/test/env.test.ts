import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

function freshLoadEnv(source: NodeJS.ProcessEnv) {
  // loadEnv cached ihr Ergebnis modulintern; für isolierte Tests importieren wir die Funktion
  // über einen dynamischen Re-Import-Umweg, indem wir ein eigenes env-Objekt direkt validieren.
  // Da der Cache ein Modul-Singleton ist, testen wir hier nur den Validierungsfehlerfall, der
  // vor dem Caching auftritt.
  return loadEnv(source);
}

describe('loadEnv', () => {
  it('verweigert den Start ohne DB-Zugangsdaten (kein unsicherer Default)', () => {
    expect(() => freshLoadEnv({})).toThrow(/Ungültige\/fehlende Konfiguration/);
  });

  it('verweigert ein zu kurzes COOKIE_SECRET', () => {
    expect(() =>
      freshLoadEnv({
        DB_HOST: 'localhost',
        DB_NAME: 'ticketsystem',
        DB_USER: 'app',
        DB_PASSWORD: 'secret',
        KEK_FILE_PATH: '/run/secrets/kek',
        COOKIE_SECRET: 'zu-kurz',
        INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000'
      })
    ).toThrow();
  });

  // Vor dem Erfolgsfall unten, da loadEnv ein erfolgreiches Ergebnis modulweit zwischenspeichert.
  const base = {
    DB_HOST: 'localhost', DB_NAME: 'ticketsystem', DB_USER: 'app', DB_PASSWORD: 'secret',
    KEK_FILE_PATH: '/run/secrets/kek', COOKIE_SECRET: 'x'.repeat(32),
    INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000'
  };
  it.each(['false', '0', 'no'])('verweigert DB_SSL_REJECT_UNAUTHORIZED=%s (Zertifikatspruefung nicht abschaltbar)', value => {
    expect(() => freshLoadEnv({ ...base, NODE_ENV: 'test', DB_SSL_REJECT_UNAUTHORIZED: value })).toThrow(/DB_SSL_REJECT_UNAUTHORIZED/);
  });
  it('verweigert in Produktion eine Datenbankverbindung ohne TLS (DB_SSL_CA_PATH fehlt)', () => {
    expect(() => freshLoadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/DB_SSL_CA_PATH/);
  });

  it('accepts empty optional updater variables from Docker Compose', () => {
    const env = freshLoadEnv({
      DB_HOST: 'localhost', DB_NAME: 'ticketsystem', DB_USER: 'app', DB_PASSWORD: 'secret',
      KEK_FILE_PATH: '/run/secrets/kek', COOKIE_SECRET: 'x'.repeat(32),
      INSTALLATION_ID: '123e4567-e89b-12d3-a456-426614174000', DB_SSL_CA_PATH: '/run/secrets/mariadb-ca.pem',
      UPDATE_SERVICE_URL: '', UPDATE_TOKEN: ''
    });
    expect(env.UPDATE_SERVICE_URL).toBeUndefined();
    expect(env.UPDATE_TOKEN).toBeUndefined();
  });
});
