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
import type { Database } from '../types.js';

// Singleton-Tabelle für Unternehmenseinstellungen + Einrichtungsstatus (Setup-Wizard,
// docs/SPEC.md §5 "Einrichtungsseite"). Es gibt bewusst nur eine Zeile (id = 1).
export const migration_0005_app_settings: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('app_settings')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('company_name', 'varchar(255)', col => col.notNull().defaultTo(''))
      .addColumn('portal_name', 'varchar(255)', col => col.notNull().defaultTo(''))
      .addColumn('setup_completed_at', 'timestamp')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Genau eine Zeile von Anfang an -- der Setup-Handler aktualisiert sie nur (UPDATE),
    // fügt nie eine zweite ein. Verhindert eine Race-Condition "zwei parallele erste Requests
    // legen je eine Zeile an".
    await (db as unknown as Kysely<Database>)
      .insertInto('app_settings')
      .values({ id: 1, company_name: '', portal_name: '' })
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('app_settings').execute();
  }
};
