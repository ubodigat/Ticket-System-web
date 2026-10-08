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
