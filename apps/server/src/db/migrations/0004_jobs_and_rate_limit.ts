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
