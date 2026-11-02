import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Genehmigungsverlauf je Ticket: Anfrage (wer, an wen, Begruendung) und Entscheidung (genehmigt
// oder abgelehnt, von wem, Kommentar) bleiben dauerhaft am Ticket sichtbar. Bisher ueberschrieb
// die Entscheidung den Anfragetext in tickets.approval_text, und nichts davon wurde angezeigt.
// Texte sind feldverschluesselt (ticket_approvals.request_text / .decision_text).
export const migration_0063_ticket_approvals: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createTable('ticket_approvals').ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('requested_by_user_id', 'char(36)')
      .addColumn('requested_by_username', 'varchar(255)')
      .addColumn('approver_user_id', 'char(36)')
      .addColumn('approver_username', 'varchar(255)')
      .addColumn('request_text_enc', sql`mediumblob`)
      .addColumn('status', 'varchar(16)', col => col.notNull().defaultTo('pending'))
      .addColumn('decided_by_user_id', 'char(36)')
      .addColumn('decided_by_username', 'varchar(255)')
      .addColumn('decision_text_enc', sql`mediumblob`)
      .addColumn('requested_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('decided_at', 'datetime')
      .execute();
    await db.schema.createIndex('idx_ticket_approvals_ticket').ifNotExists().on('ticket_approvals').columns(['ticket_id', 'requested_at']).execute();
    // Bestehende Genehmigungen ohne Texte uebernehmen (die alten Texte sind mit einem anderen
    // Feldkontext verschluesselt und bleiben in tickets.approval_text).
    await sql`INSERT INTO ticket_approvals (id, ticket_id, requested_by_username, approver_user_id, approver_username, status, requested_at, decided_at)
      SELECT UUID(), t.id, t.approval_requested_by, t.approval_reviewer_id, u.username, t.approval_status, t.updated_at,
        CASE WHEN t.approval_status = 'pending' THEN NULL ELSE t.updated_at END
      FROM tickets t LEFT JOIN users u ON u.id = t.approval_reviewer_id
      WHERE t.approval_status IN ('pending', 'approved', 'rejected')
        AND NOT EXISTS (SELECT 1 FROM ticket_approvals a WHERE a.ticket_id = t.id)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('ticket_approvals').ifExists().execute();
  }
};
