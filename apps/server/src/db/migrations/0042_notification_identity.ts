import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
export const migration_0042_notification_identity: Migration = {
  async up(db: Kysely<unknown>) {
    // Never backfill by username: it may now belong to a different account.
    await sql`DELETE n FROM notifications n LEFT JOIN users u ON u.id = n.recipient_user_id WHERE u.id IS NULL`.execute(db);
    const existing = await sql`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND CONSTRAINT_NAME = 'fk_notification_recipient'`.execute(db);
    if (!existing.rows.length) {
      await db.schema.alterTable('notifications').addForeignKeyConstraint('fk_notification_recipient',
        ['recipient_user_id'], 'users', ['id'], cb => cb.onDelete('cascade')).execute();
    }
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('notifications').dropConstraint('fk_notification_recipient').execute();
  }
};
