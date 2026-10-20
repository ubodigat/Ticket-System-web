/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from './types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';

// Security-Audit R-2 (kritische Regression): Migrationen 0034/0035 haben den SPALTENTYP von
// approval_text/waiting_message (tickets) sowie phone/mobile/job_title/office_location (users)
// auf verschlüsselt umgestellt, die bereits vorhandenen KLARTEXT-Werte aber nie tatsächlich
// verschlüsselt -- jeder spätere Lesezugriff (decryptField) scheiterte an ihnen mit
// "Invalid authentication tag length"/"Unsupported state", wodurch GET /api/v2/tickets,
// /api/v2/users, /users/me und das Verzeichnis komplett mit 500 ausfielen, sobald auch nur EIN
// Ticket/Konto einen Altwert hatte.
//
// Dieses Skript wird automatisch am Ende von migrate.ts ausgeführt (für jede Installation, die
// migriert -- neu oder bestehend) und ist idempotent: ein Wert, der sich bereits erfolgreich
// entschlüsseln lässt, wird unverändert übersprungen; nur ein Wert, der NICHT als gültiges
// AES-256-GCM-Ciphertext mit passendem Auth-Tag gelesen werden kann, gilt als Klartext und wird
// jetzt nachträglich verschlüsselt. Kann bei Bedarf auch manuell erneut ausgeführt werden
// ("node dist/db/reencryptLegacy.js").
interface ReencryptJob {
  table: 'tickets' | 'users';
  field: string;
  purpose: string;
}

const JOBS: readonly ReencryptJob[] = [
  { table: 'tickets', field: 'approval_text', purpose: 'tickets.approval_text' },
  { table: 'tickets', field: 'waiting_message', purpose: 'tickets.waiting_message' },
  { table: 'users', field: 'phone', purpose: 'users.phone' },
  { table: 'users', field: 'mobile', purpose: 'users.mobile' },
  { table: 'users', field: 'job_title', purpose: 'users.job_title' },
  { table: 'users', field: 'office_location', purpose: 'users.office_location' }
];

export async function reencryptLegacyPlaintext(db: Kysely<Database>, env: Env, keyProvider: KeyProvider): Promise<{ reencrypted: number; checked: number }> {
  let reencrypted = 0;
  let checked = 0;

  for (const job of JOBS) {
    const dek = await ensureDek(db, keyProvider, job.purpose);
    // sql.ref/sql.table statisch pro festen, hier hart kodierten Feldnamen -- kein Nutzereingabe-
    // Bezug, daher unkritisch trotz dynamischem Spaltennamen.
    const rows = await sql<{ id: string; value: Buffer | null }>`
      select id, ${sql.ref(job.field)} as value from ${sql.table(job.table)} where ${sql.ref(job.field)} is not null
    `.execute(db);

    for (const row of rows.rows) {
      if (!row.value) continue;
      checked++;
      const stored = Buffer.isBuffer(row.value) ? row.value : Buffer.from(row.value);
      const ctx = {
        installationId: env.INSTALLATION_ID, schemaVersion: env.SCHEMA_VERSION,
        tableName: job.table, recordId: row.id, fieldName: job.field, keyVersion: dek.keyVersion
      };
      try {
        fieldCipher.decryptField(stored, dek.rawDek, ctx);
        continue; // Bereits gültig verschlüsselt -- nichts zu tun.
      } catch {
        // Kein gültiges AES-256-GCM-Ciphertext fuer diesen Kontext -> als Klartext behandeln.
      }
      const plaintext = stored.toString('utf8');
      const encrypted = fieldCipher.encryptField(plaintext, dek.rawDek, ctx);
      await sql`update ${sql.table(job.table)} set ${sql.ref(job.field)} = ${encrypted} where id = ${row.id}`.execute(db);
      reencrypted++;
    }
  }

  return { reencrypted, checked };
}
