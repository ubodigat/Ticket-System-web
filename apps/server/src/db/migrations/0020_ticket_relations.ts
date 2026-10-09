/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// "Verwandte Tickets" -- im Altsystem ein Feld "relatedIds: []" direkt am Ticket-Objekt (nie
// serverseitig persistiert), jetzt eine eigene Tabelle. Jede Verknüpfung wird als zwei Zeilen
// (A->B und B->A) gespeichert, damit beide Seiten mit einer einfachen WHERE-Abfrage gefunden
// werden -- siehe tickets.ts GET/POST/DELETE /api/v2/tickets/:id/related.
export const migration_0020_ticket_relations: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('ticket_relations')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('related_ticket_id', 'char(36)', col => col.notNull())
      .execute();

    await db.schema
      .createIndex('idx_ticket_relations_ticket')
      .on('ticket_relations')
      .column('ticket_id')
      .execute();

    await db.schema
      .createIndex('idx_ticket_relations_unique')
      .on('ticket_relations')
      .columns(['ticket_id', 'related_ticket_id'])
      .unique()
      .execute();

    // Merge: welches Ticket wurde in welches andere übernommen (siehe /merge-Endpunkt).
    await db.schema.alterTable('tickets').addColumn('merged_into_ticket_id', 'char(36)').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('ticket_relations').ifExists().execute();
    await db.schema.alterTable('tickets').dropColumn('merged_into_ticket_id').execute();
  }
};
