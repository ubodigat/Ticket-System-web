import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration_0027_admin_todos: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('admin_todos')
      .addColumn('id', 'char(36)', c => c.primaryKey())
      .addColumn('content', sql`mediumblob`, c => c.notNull())
      .addColumn('created_by_user_id', 'char(36)', c => c.references('users.id').onDelete('set null'))
      .addColumn('due_at', 'datetime')
      .addColumn('done', 'boolean', c => c.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
    await db.schema.createTable('admin_todo_members')
      .addColumn('todo_id', 'char(36)', c => c.notNull().references('admin_todos.id').onDelete('cascade'))
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('hidden', 'boolean', c => c.notNull().defaultTo(false))
      .addPrimaryKeyConstraint('admin_todo_member_pk', ['todo_id', 'user_id']).execute();
    await db.schema.createIndex('admin_todo_member_user_idx').on('admin_todo_members').columns(['user_id', 'hidden']).execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('admin_todo_members').execute();
    await db.schema.dropTable('admin_todos').execute();
  }
};
