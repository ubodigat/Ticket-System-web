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
