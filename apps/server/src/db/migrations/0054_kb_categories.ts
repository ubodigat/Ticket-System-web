import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Wissensdatenbank-Kategorien: Artikel tragen den Kategorienamen (Ticket-Kategorie oder eigene
// KB-Kategorie); eigene KB-Kategorien liegen in einer separaten Tabelle.
export const migration_0054_kb_categories: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS category varchar(128) NULL`.execute(db);
    await db.schema.createIndex('idx_kb_articles_category').ifNotExists().on('kb_articles').column('category').execute();
    await db.schema.createTable('kb_categories').ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('name', 'varchar(128)', col => col.notNull().unique())
      .addColumn('created_by_user_id', 'char(36)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('kb_categories').ifExists().execute();
    await db.schema.dropIndex('idx_kb_articles_category').on('kb_articles').ifExists().execute();
    await sql`ALTER TABLE kb_articles DROP COLUMN IF EXISTS category`.execute(db);
  }
};
