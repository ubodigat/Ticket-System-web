import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0041_mail_secrets: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS mail_secrets_enc MEDIUMBLOB`.execute(db);
  },
  async down() { throw new Error('Encrypted secrets require a forward-only migration'); }
};
