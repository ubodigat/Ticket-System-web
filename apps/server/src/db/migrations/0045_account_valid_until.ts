import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0045_account_valid_until: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_valid_until DATE NULL`.execute(db);
  },
  async down() { throw new Error('Removing account expiry may re-enable expired accounts'); }
};
