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

// Teilmenge von docs/DATABASE_SCHEMA.md §2/§4 für das Phase-1-Grundgerüst. name/email sind
// AES-256-GCM-verschlüsselt gespeichert (name_enc/email_enc); email_blind_idx ist der
// HMAC-Blind-Index für Exact-Match-Lookups (docs/adr/0005), NICHT der Klartext.
export const migration_0003_users_and_groups: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('groups')
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('name', 'varchar(128)', col => col.notNull())
      .addColumn('is_default', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('users')
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('username', 'varchar(64)', col => col.notNull().unique())
      .addColumn('name_enc', 'varbinary(512)', col => col.notNull())
      .addColumn('email_enc', 'varbinary(512)', col => col.notNull())
      .addColumn('email_blind_idx', 'char(64)', col => col.notNull().unique())
      .addColumn('password_hash', 'varchar(255)', col => col.notNull())
      .addColumn('role', 'varchar(16)', col => col.notNull())
      .addColumn('department_group_id', 'char(36)', col => col.references('groups.id').onDelete('set null'))
      .addColumn('account_archived', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('locked_until', 'timestamp')
      .addColumn('locked_permanent', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('installation_id', 'char(36)', col => col.notNull().references('installations.id'))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('users').execute();
    await db.schema.dropTable('groups').execute();
  }
};
