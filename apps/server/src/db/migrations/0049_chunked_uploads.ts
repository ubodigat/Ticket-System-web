import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0049_chunked_uploads: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('file_uploads')
      .addColumn('id', 'char(36)', c => c.primaryKey())
      .addColumn('owner_user_id', 'char(36)', c => c.references('users.id').onDelete('set null'))
      .addColumn('ticket_id', 'char(36)', c => c.references('tickets.id').onDelete('cascade'))
      .addColumn('article_id', 'char(36)', c => c.references('kb_articles.id').onDelete('cascade'))
      .addColumn('filename', sql`blob`, c => c.notNull())
      .addColumn('mime_type', 'varchar(255)', c => c.notNull())
      .addColumn('size_bytes', 'integer', c => c.notNull())
      .addColumn('received_bytes', 'integer', c => c.notNull().defaultTo(0))
      .addColumn('completed', 'boolean', c => c.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
    await db.schema.createTable('file_upload_chunks')
      .addColumn('upload_id', 'char(36)', c => c.notNull().references('file_uploads.id').onDelete('cascade'))
      .addColumn('part', 'integer', c => c.notNull())
      .addColumn('data_enc', sql`longblob`, c => c.notNull())
      .addPrimaryKeyConstraint('file_upload_chunks_pk', ['upload_id', 'part']).execute();
    await db.schema.createIndex('file_uploads_owner_created').on('file_uploads').columns(['owner_user_id', 'created_at']).execute();
  },
  async down() { throw new Error('Forward-only encrypted upload migration'); }
};
