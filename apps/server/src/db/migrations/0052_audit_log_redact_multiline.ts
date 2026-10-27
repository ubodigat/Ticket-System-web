import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit R-13 (Rest): Migration 0047 nutzte REGEXP_REPLACE mit ", Grund: .*\)$". MariaDBs
// Regex-Engine (PCRE-Semantik) laesst den Punkt standardmaessig keine Zeilenumbrueche treffen --
// ein mehrzeiliger Genehmigungsgrund (vom Schema bis 5.000 Zeichen erlaubt) wurde deshalb NICHT
// ersetzt und blieb im Klartext im Audit-Log stehen. Fix hier bewusst OHNE Regex: SUBSTRING_INDEX
// schneidet alles ab dem ERSTEN ", Grund: " ab, unabhaengig von Zeilenumbruechen im Rest -- robuster
// als ein "(?s)"-Flag und deckt auch den Fall ab, dass der Grund selbst die Zeichenfolge ", Grund: "
// enthaelt (SUBSTRING_INDEX mit count=1 nimmt immer das erste Vorkommen).
export const migration_0052_audit_log_redact_multiline: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      UPDATE ticket_audit_log
      SET new_value = CONCAT(SUBSTRING_INDEX(new_value, ', Grund: ', 1), ', mit Begründung)')
      WHERE action = 'approval_requested' AND new_value LIKE '%, Grund: %'
    `.execute(db);
  },
  async down() { throw new Error('Bereinigte Klartext-Kopien im Audit-Log koennen nicht wiederhergestellt werden'); }
};
