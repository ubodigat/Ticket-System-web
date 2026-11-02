import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Weitere Kontoangaben (Personalnummer, Kostenstelle, Gebaeude/Raum, Eintrittsdatum, Arbeitstage und
// -zeiten, Erreichbarkeit) als ein feldverschluesseltes JSON (siehe domain/userProfile.ts).
export const migration_0064_user_profile: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_enc mediumblob NULL DEFAULT NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS profile_enc`.execute(db);
  }
};
