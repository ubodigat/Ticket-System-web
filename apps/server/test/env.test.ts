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
});
