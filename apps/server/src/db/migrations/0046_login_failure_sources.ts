import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit R-11: Bisher sperrte ein Fehlversuchszaehler allein am Konto (users.
// failed_login_count/locked_until/locked_permanent) -- wer nur den Benutzernamen kennt, konnte
// damit JEDES Konto (auch Superadmins) ohne eigene Anmeldung aussperren. Diese Tabelle traegt
// die automatische Sperre jetzt pro (Konto, Quellnetz): nur wiederholte Fehlversuche AUS
// DEMSELBEN Netz fuehren zu einer (immer befristeten) Sperre. users.locked_permanent/
// locked_until bleiben unangetastet und wirken weiterhin fuer die bewusste, manuelle Sperre
// durch eine Admin-Person (siehe users.ts PATCH) -- das hier ist zusaetzlich, kein Ersatz.
export const migration_0046_login_failure_sources: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('login_failure_sources')
      .ifNotExists()
      .addColumn('user_id', 'char(36)', c => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('source_prefix', 'varchar(64)', c => c.notNull())
      .addColumn('failure_count', 'integer', c => c.notNull().defaultTo(0))
      .addColumn('locked_until', 'timestamp')
      .addColumn('updated_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addPrimaryKeyConstraint('login_failure_sources_pk', ['user_id', 'source_prefix'])
      .execute();
    // Kontoweiter Backoff (unabhaengig von der Quelle, siehe domain/loginThrottle.ts) braucht
    // den Zeitpunkt des letzten Fehlversuchs, um die wachsende Wartezeit durchzusetzen.
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_last_at TIMESTAMP NULL`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('login_failure_sources').execute();
    await sql`ALTER TABLE users DROP COLUMN failed_login_last_at`.execute(db);
  }
};
