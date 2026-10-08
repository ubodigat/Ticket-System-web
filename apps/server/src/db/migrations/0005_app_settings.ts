import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { Database } from '../types.js';

// Singleton-Tabelle für Unternehmenseinstellungen + Einrichtungsstatus (Setup-Wizard,
// docs/SPEC.md §5 "Einrichtungsseite"). Es gibt bewusst nur eine Zeile (id = 1).
export const migration_0005_app_settings: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('app_settings')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('company_name', 'varchar(255)', col => col.notNull().defaultTo(''))
      .addColumn('portal_name', 'varchar(255)', col => col.notNull().defaultTo(''))
      .addColumn('setup_completed_at', 'timestamp')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Genau eine Zeile von Anfang an -- der Setup-Handler aktualisiert sie nur (UPDATE),
    // fügt nie eine zweite ein. Verhindert eine Race-Condition "zwei parallele erste Requests
    // legen je eine Zeile an".
    await (db as unknown as Kysely<Database>)
      .insertInto('app_settings')
      .values({ id: 1, company_name: '', portal_name: '' })
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('app_settings').execute();
  }
};
