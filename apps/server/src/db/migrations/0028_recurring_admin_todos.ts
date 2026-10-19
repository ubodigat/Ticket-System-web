import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration_0028_recurring_admin_todos: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('recurring_admin_todos')
      .addColumn('id', 'char(36)', c => c.primaryKey())
      .addColumn('content', sql`mediumblob`, c => c.notNull())
      .addColumn('created_by_user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('recipient_ids_json', 'text', c => c.notNull())
      .addColumn('interval_unit', 'varchar(10)', c => c.notNull())
      .addColumn('interval_count', 'integer', c => c.notNull())
      .addColumn('due_after_hours', 'integer')
      .addColumn('next_run_at', 'datetime', c => c.notNull())
      .addColumn('active', 'boolean', c => c.notNull().defaultTo(true))
      .addColumn('created_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
    await db.schema.createIndex('recurring_admin_todos_due').on('recurring_admin_todos').columns(['active', 'next_run_at']).execute();
  },
  async down(db: Kysely<unknown>) { await db.schema.dropTable('recurring_admin_todos').execute(); }
};
