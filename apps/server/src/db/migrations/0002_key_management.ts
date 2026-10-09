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

// data_encryption_keys: DEKs, KEK-umwickelt, versioniert, pro Zweck -- docs/CRYPTOGRAPHY.md §1.
// key_rotation_log: Nachvollziehbarkeit jeder Rotation -- docs/CRYPTOGRAPHY.md §5.
export const migration_0002_key_management: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('data_encryption_keys')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('purpose', 'varchar(128)', col => col.notNull())
      .addColumn('key_version', 'integer', col => col.notNull())
      .addColumn('wrapped_dek', 'varbinary(255)', col => col.notNull())
      .addColumn('active', 'boolean', col => col.notNull().defaultTo(true))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addUniqueConstraint('uq_dek_purpose_version', ['purpose', 'key_version'])
      .execute();

    await db.schema
      .createTable('key_rotation_log')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('purpose', 'varchar(128)', col => col.notNull())
      .addColumn('old_key_version', 'integer')
      .addColumn('new_key_version', 'integer', col => col.notNull())
      .addColumn('reason', 'varchar(255)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('key_rotation_log').execute();
    await db.schema.dropTable('data_encryption_keys').execute();
  }
};
