/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher, type ResolvedDek } from '../crypto/fieldCrypto.js';
import { ENCRYPTED_COLUMNS, type EncryptedColumn } from '../crypto/rotation.js';

// Auskunft und Datenexport fuer Betroffene (DSGVO Art. 15 und 20, Security-Audit 11/2026): alle
// Daten, die einer Person gehoeren, als JSON -- entschluesselt ueber dieselbe Spalten-Registry wie
// die Schluesselrotation (crypto/rotation.ts), damit kein verschluesseltes Feld vergessen wird.
//
// Bewusst NICHT enthalten: Geheimnisse und Pruefwerte (Passwort-Hash, TOTP-Geheimnis, Outlook-Token,
// Blind-Index, Wiederherstellungs- und Geraete-Token-Hashes, MFA-Einrichtungscode), interne Notizen
// des Supports und Tickets anderer Personen. Jede Spalte steht ausdruecklich in einer Positivliste.

interface Section {
  readonly key: string;
  readonly table: keyof Database & string;
  readonly owner: string;
  readonly columns: readonly string[];
  readonly orderBy?: string;
}

export const EXPORT_ROW_LIMIT = 10_000;

const SECTIONS: readonly Section[] = [
  { key: 'account', table: 'users', owner: 'id', columns: ['id', 'username', 'name_enc', 'email_enc', 'role', 'department', 'phone', 'mobile',
    'job_title', 'office_location', 'profile_enc', 'supervisor_user_id', 'notif_prefs_json', 'totp_enabled', 'ldap_login_enabled',
    'account_valid_until', 'account_archived', 'outlook_account_email', 'outlook_connected_at', 'avatar_preset', 'avatar_mime',
    'avatar_updated_at', 'created_at', 'updated_at'] },
  { key: 'preferences', table: 'user_preferences', owner: 'user_id', columns: ['user_id', 'value_enc'] },
  { key: 'groups', table: 'user_groups', owner: 'user_id', columns: ['group_id', 'created_at'] },
  { key: 'absences', table: 'user_absences', owner: 'user_id', columns: ['id', 'active', 'from_at', 'until_at', 'substitute_user_id', 'visible', 'ended_at', 'created_at'], orderBy: 'created_at' },
  { key: 'sessions', table: 'sessions', owner: 'user_id', columns: ['user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'last_seen_at'], orderBy: 'created_at' },
  { key: 'trustedDevices', table: 'mfa_devices', owner: 'user_id', columns: ['verified_at'], orderBy: 'verified_at' },
  { key: 'notifications', table: 'notifications', owner: 'recipient_user_id', columns: ['id', 'type', 'ticket_number', 'message', 'is_read', 'created_at'], orderBy: 'created_at' },
  { key: 'tickets', table: 'tickets', owner: 'created_by_user_id', columns: ['id', 'ticket_number', 'title', 'description', 'status', 'priority', 'category',
    'type', 'custom_fields_json', 'approval_status', 'created_at', 'updated_at', 'closed_at', 'archived_at'], orderBy: 'created_at' },
  { key: 'messagesWritten', table: 'ticket_messages', owner: 'sender_user_id', columns: ['id', 'ticket_id', 'content', 'created_at', 'edited_at'], orderBy: 'created_at' },
  { key: 'timeEntries', table: 'ticket_time_entries', owner: 'user_id', columns: ['id', 'ticket_id', 'minutes', 'note_enc', 'created_at'], orderBy: 'created_at' },
  { key: 'personalTodoTimeEntries', table: 'admin_todo_time_entries', owner: 'user_id', columns: ['id', 'todo_id', 'minutes', 'note_enc', 'created_at'], orderBy: 'created_at' },
  { key: 'personalTodos', table: 'admin_todos', owner: 'created_by_user_id', columns: ['id', 'content', 'done', 'due_at', 'done_at', 'created_at'], orderBy: 'created_at' },
  { key: 'activity', table: 'global_audit_log', owner: 'actor_user_id', columns: ['action', 'target_type', 'target_id', 'detail_json', 'created_at'], orderBy: 'created_at' }
];

// Spalten, die nie exportiert werden duerfen -- Schutz gegen ein versehentliches Erweitern der Liste.
export const NEVER_EXPORTED = new Set(['password_hash', 'totp_secret_enc', 'totp_pending_secret_enc', 'outlook_refresh_token_enc', 'email_blind_idx',
  'token_hash', 'code_hash', 'mfa_enroll_code_hash', 'avatar_image_enc', 'permissions_json']);
export const exportSections = (): readonly Section[] => SECTIONS;

export interface ExportDeps { db: Kysely<Database>; keyProvider: KeyProvider; installationId: string }

export async function buildPersonalDataExport(deps: ExportDeps, uid: string) {
  const deks = new Map<string, ResolvedDek>();
  const dekFor = async (purpose: string) => {
    if (!deks.has(purpose)) deks.set(purpose, await ensureDek(deps.db, deps.keyProvider, purpose));
    return deks.get(purpose)!;
  };
  const registry = (table: string, column: string): EncryptedColumn | undefined =>
    ENCRYPTED_COLUMNS.find(entry => entry.table === table && entry.column === column);

  async function plain(table: string, column: string, row: Record<string, unknown>): Promise<unknown> {
    const value = row[column];
    if (value === null || value === undefined) return null;
    const entry = registry(table, column);
    if (entry && Buffer.isBuffer(value)) {
      const recordId = entry.recordId ? entry.recordId(row) : String(row[(entry.key ?? ['id'])[0]!]);
      try {
        return fieldCipher.decryptField(value, await dekFor(entry.purpose), {
          installationId: deps.installationId, tableName: entry.aadTable ?? entry.table, recordId, fieldName: entry.fieldName
        });
      } catch { return { error: 'not_decryptable' }; }
    }
    if (Buffer.isBuffer(value)) return { base64: value.toString('base64') };
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    return value;
  }

  const result: Record<string, unknown> = {};
  const truncated: string[] = [];
  const ownTicketIds: string[] = [];
  for (const section of SECTIONS) {
    let query = (deps.db as Kysely<any>).selectFrom(section.table).select([...section.columns]).where(section.owner, '=', uid);
    if (section.orderBy) query = query.orderBy(section.orderBy, 'desc');
    const rows = await query.limit(EXPORT_ROW_LIMIT + 1).execute() as Record<string, unknown>[];
    if (rows.length > EXPORT_ROW_LIMIT) { truncated.push(section.key); rows.length = EXPORT_ROW_LIMIT; }
    const out = [];
    for (const row of rows) {
      const entry: Record<string, unknown> = {};
      for (const column of section.columns) entry[column.replace(/_enc$/, '')] = await plain(section.table, column, row);
      out.push(entry);
    }
    if (section.key === 'tickets') ownTicketIds.push(...rows.map(row => String(row.id)));
    result[section.key] = section.key === 'account' || section.key === 'preferences' ? out[0] ?? null : out;
  }

  // Gespraech in den eigenen Tickets (auch Antworten des Supports, die die Person ohnehin sieht) --
  // keine internen Notizen.
  const conversation = [];
  for (let index = 0; index < ownTicketIds.length && conversation.length <= EXPORT_ROW_LIMIT; index += 500) {
    const rows = await deps.db.selectFrom('ticket_messages').select(['id', 'ticket_id', 'sender_username', 'sender_role', 'content', 'created_at', 'edited_at'])
      .where('ticket_id', 'in', ownTicketIds.slice(index, index + 500)).orderBy('created_at', 'asc').execute() as Record<string, unknown>[];
    for (const row of rows) {
      conversation.push({ id: row.id, ticket_id: row.ticket_id, sender_username: row.sender_username, sender_role: row.sender_role,
        content: await plain('ticket_messages', 'content', row), created_at: await plain('ticket_messages', 'created_at', row),
        edited_at: await plain('ticket_messages', 'edited_at', row) });
    }
  }
  if (conversation.length > EXPORT_ROW_LIMIT) { truncated.push('ticketConversations'); conversation.length = EXPORT_ROW_LIMIT; }
  result.ticketConversations = conversation;

  return { format: 'ticket-system-personal-data-1', exportedAt: new Date().toISOString(), subject: uid, truncated, ...result };
}
