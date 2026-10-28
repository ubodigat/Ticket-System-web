import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Das Systemprotokoll erfasst jetzt jede Aktion -- ohne Index wuerde jede sortierte, seitenweise
// Abfrage die komplette Tabelle sortieren.
export const migration_0053_global_audit_log_index: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createIndex('idx_global_audit_log_created').ifNotExists()
      .on('global_audit_log').columns(['created_at', 'id']).execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('idx_global_audit_log_created').on('global_audit_log').ifExists().execute();
  }
};
