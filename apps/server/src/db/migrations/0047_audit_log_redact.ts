import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit R-13: bereinigt Alteintraege, die den Genehmigungsgrund/die Begruendung einer
// Entscheidung bzw. den Kalender-Betreff im Klartext in ticket_audit_log.new_value hatten --
// siehe tickets.ts (Routen fuer approval-request/approval-decision/calendar-event), die das
// jetzt gar nicht mehr so schreiben.
export const migration_0047_audit_log_redact: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      UPDATE ticket_audit_log
      SET new_value = REGEXP_REPLACE(new_value, ', Grund: .*\\)$', ', mit Begründung)')
      WHERE action = 'approval_requested' AND new_value LIKE '%, Grund: %'
    `.execute(db);
    await sql`
      UPDATE ticket_audit_log
      SET new_value = CONCAT(SUBSTRING_INDEX(new_value, ':', 1), ' (mit Begründung)')
      WHERE action = 'approval_decided' AND new_value LIKE '%:%'
    `.execute(db);
    await sql`
      UPDATE ticket_audit_log
      SET new_value = '(Termin angelegt)'
      WHERE action = 'calendar_event_created'
    `.execute(db);
  },
  async down() { throw new Error('Bereinigte Klartext-Kopien im Audit-Log koennen nicht wiederhergestellt werden'); }
};
