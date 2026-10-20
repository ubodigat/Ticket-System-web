/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N10: Telefon/Mobilnummer/Position/Standort standen bisher im Klartext (Migration
// 0029) -- jetzt AES-256-GCM-verschlüsselt wie name/email (users.ts loadContactDeks/
// encryptContactField/decryptContactField). "department"/"department_group_id" bleiben bewusst
// Klartext (siehe users.ts-Kommentar bei "department"): werden für Gruppen-/Kategorie-Logik
// gebraucht, nicht Teil dieses Befunds. ALTER TABLE ... MODIFY COLUMN auf einer Installation mit
// bereits vorhandenen Klartext-Werten würde diese als rohe Bytes übernehmen und beim nächsten
// Lesen fehlschlagen -- betrifft nur Installationen, die zwischen Einführung dieser Felder
// (Migration 0029) und diesem Update bereits Werte gespeichert hatten.
export const migration_0035_encrypt_contact_fields: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    for (const col of ['phone', 'mobile', 'job_title', 'office_location']) {
      await db.schema.alterTable('users').modifyColumn(col, sql`varbinary(512)`).execute();
    }
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users').modifyColumn('phone', sql`varchar(64)`).execute();
    await db.schema.alterTable('users').modifyColumn('mobile', sql`varchar(64)`).execute();
    await db.schema.alterTable('users').modifyColumn('job_title', sql`varchar(255)`).execute();
    await db.schema.alterTable('users').modifyColumn('office_location', sql`varchar(255)`).execute();
  }
};
