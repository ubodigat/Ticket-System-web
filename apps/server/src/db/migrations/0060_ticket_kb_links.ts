import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Vorhandene Loesungen aus der Wissensdatenbank direkt einem Ticket zuordnen. Wird das Ticket oder
// der Artikel geloescht, verschwindet nur die Zuordnung.
export const migration_0060_ticket_kb_links: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('ticket_kb_links').ifNotExists()
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('article_id', 'char(36)', col => col.notNull().references('kb_articles.id').onDelete('cascade'))
      .addColumn('linked_by_user_id', 'char(36)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addPrimaryKeyConstraint('pk_ticket_kb_links', ['ticket_id', 'article_id'])
      .execute();
    await db.schema.createIndex('idx_ticket_kb_links_article').ifNotExists().on('ticket_kb_links').column('article_id').execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('ticket_kb_links').ifExists().execute();
  }
};
