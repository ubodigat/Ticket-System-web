import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit R-23/R-25/R-28:
// - mfa_failed_count/mfa_failed_last_at: kontoweiter Zaehler nur fuer falsche Zwei-Faktor-Codes
//   (TOTP, Wiederherstellungscode, Passkey). Getrennt vom Passwort-Zaehler, damit Dritte ohne
//   Passwort den zweiten Faktor einer Person nicht ausbremsen koennen.
// - mfa_enroll_code_hash/mfa_enroll_code_expires_at: einmaliger Einrichtungscode, den eine
//   berechtigte Admin-Person erzeugt -- Alternative zum Bestaetigungscode per E-Mail, wenn die
//   Ersteinrichtung des zweiten Faktors verpflichtend ist.
// - Beteiligte an Tickets duerfen nur noch Admin-Konten sein (nur sie haben Lesezugriff);
//   bestehende Eintraege normaler Konten werden entfernt.
export const migration_0061_audit_hardening: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failed_count int NOT NULL DEFAULT 0`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failed_last_at timestamp NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enroll_code_hash char(64) NULL DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enroll_code_expires_at timestamp NULL DEFAULT NULL`.execute(db);
    await sql`DELETE tp FROM ticket_participants tp JOIN users u ON u.id = tp.user_id WHERE u.role = 'user'`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    for (const column of ['mfa_enroll_code_expires_at', 'mfa_enroll_code_hash', 'mfa_failed_last_at', 'mfa_failed_count']) {
      await sql`ALTER TABLE users DROP COLUMN IF EXISTS ${sql.ref(column)}`.execute(db);
    }
  }
};
