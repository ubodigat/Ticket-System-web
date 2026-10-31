import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Untergruppen: jede Benutzergruppe kann einer uebergeordneten Gruppe zugeordnet werden. Wird die
// uebergeordnete Gruppe geloescht, haengt die Anwendung Untergruppen vorher eine Ebene hoeher ein;
// der Fremdschluessel ist nur die Absicherung dahinter.
export const migration_0057_group_parent: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE \`groups\` ADD COLUMN IF NOT EXISTS parent_id char(36) NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE \`groups\` ADD CONSTRAINT fk_groups_parent FOREIGN KEY IF NOT EXISTS (parent_id) REFERENCES \`groups\` (id) ON DELETE SET NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`ALTER TABLE \`groups\` DROP FOREIGN KEY IF EXISTS fk_groups_parent`.execute(db);
    await sql`ALTER TABLE \`groups\` DROP COLUMN IF EXISTS parent_id`.execute(db);
  }
};
