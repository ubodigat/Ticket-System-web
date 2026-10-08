import { readFileSync } from 'node:fs';
import { createPool } from 'mysql2';
import { Kysely, MysqlDialect } from 'kysely';
import type { Env } from '../config/env.js';
import type { Database } from './types.js';

// Verbindung zu MariaDB ausschließlich über den typisierten Query-Builder (Kysely), nie über
// rohe SQL-Strings -- gemäß docs/SPEC.md §3 und docs/adr/0001. TLS ist verpflichtend, sobald
// DB_SSL_CA_PATH gesetzt ist; DB_SSL_REJECT_UNAUTHORIZED darf in Produktion nie auf false stehen
// (Standardwert ist true, siehe env.ts).
export function createDb(env: Env): Kysely<Database> {
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
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
