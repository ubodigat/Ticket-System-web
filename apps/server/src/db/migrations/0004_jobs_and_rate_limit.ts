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

// Job-Queue und Rate-Limit-Store gemäß docs/JOBS.md und docs/adr/0004/0008.
export const migration_0004_jobs_and_rate_limit: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('jobs')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('type', 'varchar(64)', col => col.notNull())
      .addColumn('payload_json', 'json', col => col.notNull())
      .addColumn('status', 'varchar(16)', col => col.notNull().defaultTo('queued'))
      .addColumn('attempts', 'integer', col => col.notNull().defaultTo(0))
      .addColumn('max_attempts', 'integer', col => col.notNull().defaultTo(5))
      .addColumn('idempotency_key', 'varchar(255)', col => col.notNull().unique())
      .addColumn('run_after', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('locked_by', 'varchar(64)')
      .addColumn('locked_at', 'timestamp')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createIndex('idx_jobs_status_run_after')
      .on('jobs')
      .columns(['status', 'run_after'])
      .execute();

    await db.schema
      .createTable('job_dead_letter')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('job_id', 'integer', col => col.notNull())
      .addColumn('type', 'varchar(64)', col => col.notNull())
      .addColumn('payload_json', 'json', col => col.notNull())
      .addColumn('last_error', 'text', col => col.notNull())
      .addColumn('attempts', 'integer', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('rate_limit_counters')
      .addColumn('rate_key', 'varchar(255)', col => col.notNull())
      .addColumn('window_start', 'timestamp', col => col.notNull())
      .addColumn('count', 'integer', col => col.notNull().defaultTo(1))
      .addPrimaryKeyConstraint('pk_rate_limit_counters', ['rate_key', 'window_start'])
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('rate_limit_counters').execute();
    await db.schema.dropTable('job_dead_letter').execute();
    await db.schema.dropTable('jobs').execute();
  }
};
