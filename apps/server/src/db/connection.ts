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

// Verbindung zu MariaDB ausschließlich über den typisierten Query-Builder (Kysely), nie über
// rohe SQL-Strings -- gemäß docs/SPEC.md §3 und docs/adr/0001. TLS ist verpflichtend, sobald
// DB_SSL_CA_PATH gesetzt ist; DB_SSL_REJECT_UNAUTHORIZED darf in Produktion nie auf false stehen
// (Standardwert ist true, siehe env.ts).
// Security-Audit N9: "migrate" nutzt IMMER das volle DB_USER/DB_PASSWORD-Konto (DDL-Rechte für
// ALTER/CREATE TABLE nötig). "runtime" (Standard) nutzt DB_RUNTIME_USER/DB_RUNTIME_PASSWORD,
// falls konfiguriert -- ein kompromittierter App-Prozess (z.B. über eine künftige Schwachstelle)
// könnte das Schema dann nicht mehr verändern oder Tabellen löschen, nur noch Zeilen lesen/
// schreiben. Ohne konfiguriertes Laufzeit-Konto (Rückwärtskompatibilität) bleibt das Verhalten
// unverändert wie vor diesem Update.
export function createDb(env: Env, purpose: 'migrate' | 'runtime' = 'runtime'): Kysely<Database> {
  const useRuntimeAccount = purpose === 'runtime' && !!env.DB_RUNTIME_USER && !!env.DB_RUNTIME_PASSWORD;
  const credentials = useRuntimeAccount
    ? { user: env.DB_RUNTIME_USER, password: env.DB_RUNTIME_PASSWORD }
    : { user: env.DB_USER, password: env.DB_PASSWORD };
  if (!credentials.user || !credentials.password) {
    // Security-Audit N9: DB_USER/DB_PASSWORD sind jetzt optional (der App-Container bekommt sie
    // absichtlich nicht mehr) -- ohne diese klare Meldung würde mysql2 nur mit einer kryptischen
    // Fehlermeldung über eine fehlgeschlagene Authentifizierung mit "undefined" scheitern.
    const needed = purpose === 'migrate' ? 'DB_USER/DB_PASSWORD' : 'DB_RUNTIME_USER/DB_RUNTIME_PASSWORD oder DB_USER/DB_PASSWORD';
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
    dateStrings: false,
    ...(env.DB_SSL_CA_PATH
      ? { ssl: { ca: readFileSync(env.DB_SSL_CA_PATH, 'utf8'), rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } }
      : {})
  });

  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool })
  });
}
