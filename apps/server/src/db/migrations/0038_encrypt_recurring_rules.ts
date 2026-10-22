/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N10-Rest: title/description einer wiederkehrenden Ticket-Regel landen beim
// tatsächlichen Erzeugen eines Tickets (jobs/maintenance.ts runRecurringTickets) verschlüsselt
// im neuen Ticket -- die Regel selbst speicherte denselben Inhalt aber bisher im Klartext.
// Gleiche Behandlung wie tickets.title/description (siehe Migration 0008). ALTER TABLE ... MODIFY
// COLUMN auf einer Installation mit vorhandenen Klartext-Regeln würde diese als rohe Bytes
// uebernehmen -- db/reencryptLegacy.ts (laeuft automatisch nach jeder Migration) erkennt und
// verschluesselt genau das nachtraeglich, siehe dortige Erweiterung.
export const migration_0038_encrypt_recurring_rules: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('recurring_ticket_rules')
      .modifyColumn('title', sql`varbinary(2048)`)
      .execute();
    await db.schema.alterTable('recurring_ticket_rules')
      .modifyColumn('description', sql`mediumblob`)
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('recurring_ticket_rules')
      .modifyColumn('title', sql`varchar(255)`)
      .execute();
    await db.schema.alterTable('recurring_ticket_rules')
      .modifyColumn('description', sql`text`)
      .execute();
  }
};
