/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Mehrfach-Beteiligte je Ticket -- im Altsystem ein Feld "participants: []" direkt am
// Ticket-Objekt (nie serverseitig persistiert), jetzt eine eigene Tabelle. Keine verschlüsselten
// Felder nötig (nur Fremdschlüssel/Benutzername, kein Freitext).
export const migration_0014_ticket_participants: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('ticket_participants')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('user_id', 'char(36)', col => col.notNull())
      .addColumn('username', 'varchar(64)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createIndex('idx_ticket_participants_ticket')
      .on('ticket_participants')
      .column('ticket_id')
      .execute();

    await db.schema
      .createIndex('idx_ticket_participants_unique')
      .on('ticket_participants')
      .columns(['ticket_id', 'user_id'])
      .unique()
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('ticket_participants').ifExists().execute();
  }
};
