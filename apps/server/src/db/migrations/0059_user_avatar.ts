import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Profilbild je Person: entweder eine der mitgelieferten Vorlagen (avatar_preset 1..6) oder ein
// eigenes, hochgeladenes Bild (avatar_image_enc, feldverschluesselt wie die uebrigen Personendaten).
// avatar_updated_at dient als Cache-Schluessel in der Bild-URL.
export const migration_0059_user_avatar: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_preset tinyint NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image_enc mediumblob NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime varchar(32) NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at datetime NULL DEFAULT NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    for (const column of ['avatar_updated_at', 'avatar_mime', 'avatar_image_enc', 'avatar_preset']) {
      await sql`ALTER TABLE users DROP COLUMN IF EXISTS ${sql.ref(column)}`.execute(db);
    }
  }
};
