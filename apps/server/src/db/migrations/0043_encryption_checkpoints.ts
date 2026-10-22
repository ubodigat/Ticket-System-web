import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0043_encryption_checkpoints: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('encryption_checkpoints').ifNotExists().addColumn('purpose', 'varchar(128)', col => col.primaryKey()).execute();
  },
  async down() { throw new Error('Encryption checkpoints must not be reset'); }
};
