import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Zeitpunkt, an dem eine eigene Aufgabe (admin_todos) als erledigt markiert wurde -- wird in der
// Aufgabenliste angezeigt (Teilaufgaben haben das bereits seit 0036).
export const migration_0055_admin_todo_done_at: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE admin_todos ADD COLUMN IF NOT EXISTS done_at timestamp NULL DEFAULT NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`ALTER TABLE admin_todos DROP COLUMN IF EXISTS done_at`.execute(db);
  }
};
