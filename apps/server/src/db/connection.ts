/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { readFileSync } from 'node:fs';
import { createPool } from 'mysql2';
import { Kysely, MysqlDialect } from 'kysely';
import type { Env } from '../config/env.js';
import type { Database } from './types.js';

// Verbindung zu MariaDB über den typisierten Query-Builder (Kysely). TLS ist verpflichtend, sobald
// DB_SSL_CA_PATH gesetzt ist; die Zertifikatspruefung laesst sich nicht abschalten (siehe env.ts).
// Security-Audit N9: "schema" (Abgleich in db/schemaSync.ts) nutzt IMMER das volle DB_USER/DB_PASSWORD-
// Konto, weil Tabellen angelegt und erweitert werden. "runtime" (Standard) nutzt DB_RUNTIME_USER/
// DB_RUNTIME_PASSWORD -- ein kompromittierter App-Prozess kann das Schema dann weder veraendern
// noch Tabellen loeschen, nur Zeilen lesen und schreiben.
export type DbPurpose = 'schema' | 'runtime';

// Jede Verbindung arbeitet in UTC, unabhaengig von der Zeitzone des MariaDB-Servers: sonst wuerden
// DEFAULT CURRENT_TIMESTAMP, NOW() und die von mysql2 als UTC ('Z') gelesenen Werte auseinanderlaufen
// (verschobene Fristen, zu spaet versandte Mails aus der Warteschlange).
export const SESSION_TIME_ZONE_SQL = "SET time_zone = '+00:00'";

export function createDb(env: Env, purpose: DbPurpose = 'runtime'): Kysely<Database> {
  const useRuntimeAccount = purpose === 'runtime' && !!env.DB_RUNTIME_USER && !!env.DB_RUNTIME_PASSWORD;
  const credentials = useRuntimeAccount
    ? { user: env.DB_RUNTIME_USER, password: env.DB_RUNTIME_PASSWORD }
    : { user: env.DB_USER, password: env.DB_PASSWORD };
  if (!credentials.user || !credentials.password) {
    // Security-Audit N9: DB_USER/DB_PASSWORD sind jetzt optional (der App-Container bekommt sie
    // absichtlich nicht mehr) -- ohne diese klare Meldung würde mysql2 nur mit einer kryptischen
    // Fehlermeldung über eine fehlgeschlagene Authentifizierung mit "undefined" scheitern.
    const needed = purpose === 'schema' ? 'DB_USER/DB_PASSWORD' : 'DB_RUNTIME_USER/DB_RUNTIME_PASSWORD oder DB_USER/DB_PASSWORD';
    throw new Error(`Keine Datenbank-Zugangsdaten für Zweck "${purpose}" konfiguriert -- ${needed} wird benötigt.`);
  }
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: credentials.user,
    password: credentials.password,
    connectionLimit: 10,
    supportBigNumbers: true,
    // MariaDB extended JSON metadata otherwise makes mysql2 return objects. Our database
    // types and explicit JSON.parse calls require strings, including the encrypted mail envelope.
    jsonStrings: true,
    dateStrings: false,
    timezone: 'Z',
    ...(env.DB_SSL_CA_PATH
      ? { ssl: { ca: readFileSync(env.DB_SSL_CA_PATH, 'utf8'), rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } }
      : {})
  });

  // mysql2 arbeitet die Befehle einer Verbindung der Reihe nach ab -- die Zeitzone ist damit gesetzt,
  // bevor die erste Abfrage der Anwendung auf dieser Verbindung laeuft.
  pool.on('connection', connection => {
    connection.query(SESSION_TIME_ZONE_SQL, error => {
      if (error) connection.destroy();
    });
  });

  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool })
  });
}
