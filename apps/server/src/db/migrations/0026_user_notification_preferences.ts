import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration_0026_user_notification_preferences: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .addColumn('notif_prefs_json', 'text')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .dropColumn('notif_prefs_json')
      .execute();
  }
};
