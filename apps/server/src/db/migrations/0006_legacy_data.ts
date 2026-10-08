import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Kompatibilitaets-Speicher fuer die bestehende Browser-App. Damit koennen die vorhandenen
// Ticket-/Einstellungs-/Log-Objekte serverseitig in MariaDB liegen, waehrend die Domaene
// schrittweise in normalisierte Tabellen migriert wird.
export const migration_0006_legacy_data: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('legacy_data')
      .addColumn('data_key', 'varchar(64)', col => col.primaryKey())
      .addColumn('value_json', 'json', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    await db.schema
      .createTable('legacy_attachments')
      .addColumn('id', 'varchar(64)', col => col.primaryKey())
      .addColumn('value_json', 'json', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('legacy_attachments').execute();
    await db.schema.dropTable('legacy_data').execute();
  }
};
