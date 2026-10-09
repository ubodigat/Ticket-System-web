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

// Kategorien (mit eigenen Feldern pro Kategorie), Abwesenheit/Vertretung, Zeiterfassung,
// Textbausteine, Wissensdatenbank, wiederkehrende Ticket-Regeln -- die fehlenden Backend-
// Domänen aus dem Funktionsvergleich mit dem Stand vom 07.10.2026.
export const migration_0009_categories_absence_time: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('categories')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('name', 'varchar(128)', col => col.notNull().unique())
      .addColumn('auto_assign_group_id', 'char(36)')
      .addColumn('custom_fields_json', 'text') // [{id,label,type,required,options?}]
      .addColumn('locked', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('archived', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('user_absences')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('user_id', 'char(36)', col => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('active', 'boolean', col => col.notNull().defaultTo(true))
      .addColumn('from_at', 'timestamp')
      .addColumn('until_at', 'timestamp')
      .addColumn('substitute_user_id', 'char(36)')
      .addColumn('visible', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('ended_at', 'timestamp')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createIndex('idx_user_absences_user_active')
      .on('user_absences')
      .columns(['user_id', 'active'])
      .execute();

    await db.schema
      .createTable('ticket_time_entries')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('user_id', 'char(36)')
      .addColumn('username', 'varchar(64)', col => col.notNull())
      .addColumn('minutes', 'integer', col => col.notNull())
      .addColumn('note', 'varchar(512)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('text_blocks')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('title', 'varchar(255)', col => col.notNull())
      .addColumn('content', sql`mediumblob`, col => col.notNull()) // AES-256-GCM-verschlüsselt
      .addColumn('created_by_user_id', 'char(36)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('kb_articles')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('title', 'varbinary(1024)', col => col.notNull()) // AES-256-GCM-verschlüsselt
      .addColumn('content', sql`mediumblob`, col => col.notNull()) // AES-256-GCM-verschlüsselt
      .addColumn('source_ticket_id', 'char(36)')
      .addColumn('created_by_user_id', 'char(36)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('recurring_ticket_rules')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('title', 'varchar(255)', col => col.notNull())
      .addColumn('description', 'text', col => col.notNull())
      .addColumn('category', 'varchar(128)')
      .addColumn('priority', 'varchar(32)', col => col.notNull().defaultTo('Normal'))
      .addColumn('interval_unit', 'varchar(16)', col => col.notNull()) // day | week | month
      .addColumn('interval_count', 'integer', col => col.notNull().defaultTo(1))
      .addColumn('next_run_at', 'timestamp', col => col.notNull())
      .addColumn('active', 'boolean', col => col.notNull().defaultTo(true))
      .addColumn('created_by_user_id', 'char(36)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Erweiterbare Systemeinstellungen (SLA-Stunden pro Priorität, Geschäftszeiten,
    // Benachrichtigungs-Policy, Konto-Selbstverwaltung, Ticketnummernformat, ...) als JSON --
    // vermeidet eine neue Migration für jede einzelne zukünftige Einstellung.
    await db.schema
      .alterTable('app_settings')
      .addColumn('config_json', 'text')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings').dropColumn('config_json').execute();
    await db.schema.dropTable('recurring_ticket_rules').ifExists().execute();
    await db.schema.dropTable('kb_articles').ifExists().execute();
    await db.schema.dropTable('text_blocks').ifExists().execute();
    await db.schema.dropTable('ticket_time_entries').ifExists().execute();
    await db.schema.dropTable('user_absences').ifExists().execute();
    await db.schema.dropTable('categories').ifExists().execute();
  }
};
