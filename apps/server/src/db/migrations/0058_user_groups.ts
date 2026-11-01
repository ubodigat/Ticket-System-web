import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Mehrfach-Gruppen: eine Person kann beliebig vielen Benutzergruppen angehoeren. Bisher gab es nur
// users.department_group_id (genau eine Gruppe); bestehende Zuordnungen werden uebernommen und die
// alte Spalte entfernt, damit es nur noch eine Quelle fuer Gruppenmitgliedschaften gibt.
// Beide Fremdschluessel loeschen mit -- eine geloeschte Gruppe/Person hinterlaesst keine Zuordnung.
export const migration_0058_user_groups: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('user_groups').ifNotExists()
      .addColumn('user_id', 'char(36)', col => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('group_id', 'char(36)', col => col.notNull().references('groups.id').onDelete('cascade'))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addPrimaryKeyConstraint('pk_user_groups', ['user_id', 'group_id'])
      .execute();
    await db.schema.createIndex('idx_user_groups_group').ifNotExists().on('user_groups').column('group_id').execute();

    const legacy = await sql`SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department_group_id'`.execute(db);
    if (!legacy.rows.length) return;
    await sql`INSERT IGNORE INTO user_groups (user_id, group_id)
      SELECT u.id, u.department_group_id FROM users u JOIN \`groups\` g ON g.id = u.department_group_id`.execute(db);
    const constraints = await sql<{ name: string }>`SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department_group_id' AND REFERENCED_TABLE_NAME IS NOT NULL`.execute(db);
    for (const { name } of constraints.rows) await sql`ALTER TABLE users DROP FOREIGN KEY ${sql.ref(name)}`.execute(db);
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS department_group_id`.execute(db);
  },
  async down() {
    throw new Error('0058_user_groups ist forward-only (Mehrfach-Gruppen lassen sich nicht auf eine Gruppe zurueckfuehren).');
  }
};
