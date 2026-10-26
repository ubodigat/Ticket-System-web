import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0050_personal_workspace: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable('ticket_time_entries').addColumn('note_enc', sql`mediumblob`).execute();
    await db.schema.createTable('user_preferences')
      .addColumn('user_id', 'char(36)', c => c.primaryKey().references('users.id').onDelete('cascade'))
      .addColumn('value_enc', sql`mediumblob`, c => c.notNull()).execute();
    await db.schema.createTable('ticket_work_timers')
      .addColumn('user_id', 'char(36)', c => c.primaryKey().references('users.id').onDelete('cascade'))
      .addColumn('id', 'char(36)', c => c.notNull().unique())
      .addColumn('ticket_id', 'char(36)', c => c.notNull().references('tickets.id').onDelete('restrict'))
      .addColumn('started_at', 'datetime', c => c.notNull())
      .addColumn('stopped_at', 'datetime').execute();
  },
  async down() { throw new Error('Forward-only personal workspace migration'); }
};
