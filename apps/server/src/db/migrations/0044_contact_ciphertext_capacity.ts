import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0044_contact_ciphertext_capacity: Migration = {
  async up(db: Kysely<unknown>) {
    // 255 Unicode characters plus IV/tag do not fit in the old 512-byte columns.
    for (const field of ['phone', 'mobile', 'job_title', 'office_location']) {
      await db.schema.alterTable('users').modifyColumn(field, sql`varbinary(2048)`).execute();
    }
  },
  async down() { throw new Error('Reducing ciphertext capacity may destroy data'); }
};
