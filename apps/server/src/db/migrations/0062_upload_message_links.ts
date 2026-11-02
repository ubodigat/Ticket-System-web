import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Grosse Dateien (gestueckelter Upload) koennen jetzt auch direkt an eine Chat-Nachricht oder eine
// interne Notiz gehaengt werden -- bisher nur an die Anhangliste des Tickets.
export const migration_0062_upload_message_links: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS message_id char(36) NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS note_id char(36) NULL DEFAULT NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    for (const column of ['note_id', 'message_id']) {
      await sql`ALTER TABLE file_uploads DROP COLUMN IF EXISTS ${sql.ref(column)}`.execute(db);
    }
  }
};
