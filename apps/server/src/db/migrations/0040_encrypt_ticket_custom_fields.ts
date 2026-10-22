/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N10-Rest: tickets.custom_fields_json enthaelt die tatsaechlichen, von Admins pro
// Kategorie definierten Freitext-/Auswahlwerte eines Tickets (potenziell personenbezogen) und war
// bisher unverschluesseltes Klartext-JSON. categories.custom_fields_json (Feld-DEFINITIONEN:
// Label/Typ/Optionen, keine Nutzerdaten) ist davon NICHT betroffen und bleibt Klartext.
export const migration_0040_encrypt_ticket_custom_fields: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('tickets')
      .modifyColumn('custom_fields_json', sql`mediumblob`)
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('tickets')
      .modifyColumn('custom_fields_json', sql`text`)
      .execute();
  }
};
