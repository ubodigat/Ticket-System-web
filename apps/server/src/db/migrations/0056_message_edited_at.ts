import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Zeitpunkt der letzten inhaltlichen Bearbeitung von Chat-Nachrichten und internen Notizen --
// wird in der Oberflaeche als "bearbeitet" angezeigt.
export const migration_0056_message_edited_at: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS edited_at timestamp NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE ticket_notes ADD COLUMN IF NOT EXISTS edited_at timestamp NULL DEFAULT NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`ALTER TABLE ticket_messages DROP COLUMN IF EXISTS edited_at`.execute(db);
    await sql`ALTER TABLE ticket_notes DROP COLUMN IF EXISTS edited_at`.execute(db);
  }
};
