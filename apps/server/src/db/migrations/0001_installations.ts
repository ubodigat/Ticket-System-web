import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Genau eine Zeile pro Installation; id ist die unveränderliche Installation-ID aus
// docs/CRYPTOGRAPHY.md §2, die in jedes AAD eingeht.
export const migration_0001_installations: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('installations')
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('schema_version', 'integer', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('installations').execute();
  }
};
