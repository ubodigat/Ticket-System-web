/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { KeyProvider } from './keyProvider.js';
import { DEK_WRAP_FORMAT, dekWrapAad, ensureDek, insertDekVersion, unwrapDekRow } from './dekService.js';
import { computeBlindIndex, fieldCipher, generateRawDek, isCurrentField, type ResolvedDek } from './fieldCrypto.js';

// Schluesselrotation und fortsetzbare Neuverschluesselung.
//
// DEK-Rotation: neue Version je Zweck anlegen und aktiv setzen. Alte Versionen bleiben gespeichert,
// bis reencryptAll jeden Wert auf die neue Version gebracht hat -- vorher bleibt alles lesbar.
// KEK-Rotation: neue KEK an den Schluesselbund haengen (keyProvider.appendKekVersion), danach
// rewrapAllDeks: jede DEK wird mit der neuen KEK neu umhuellt. Die Felddaten selbst bleiben dabei
// unberuehrt. Erst danach darf die alte KEK aus der Datei entfernt werden.
// reencryptAll: bringt Werte im Altformat (ohne Kopf) und Werte aelterer DEK-Versionen auf Format
// und Version der aktiven DEK. Fortschritt steht je Spalte in crypto_jobs; ein Abbruch (Neustart,
// Zeitbudget) setzt beim naechsten Lauf an der gespeicherten Stelle fort.

export interface EncryptedColumn {
  readonly purpose: string;
  readonly table: string;
  readonly column: string;
  readonly fieldName: string;
  readonly aadTable?: string;
  readonly key?: readonly string[];
  readonly recordId?: (row: Record<string, unknown>) => string;
  readonly batch?: number;
}

const col = (purpose: string, table: string, column: string, fieldName: string, extra: Partial<EncryptedColumn> = {}): EncryptedColumn =>
  ({ purpose, table, column, fieldName, ...extra });
const BIG = { batch: 10 };

// Jede verschluesselte Spalte mit DEK-Zweck und AAD-Kontext -- muss zu den Schreibstellen passen.
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  col('account_requests.name', 'account_requests', 'name', 'name'),
  col('account_requests.email', 'account_requests', 'email', 'email'),
  col('account_requests.company', 'account_requests', 'company', 'company'),
  col('account_requests.reason', 'account_requests', 'reason', 'reason'),
  col('admin_todos.content', 'admin_todos', 'content', 'content'),
  col('recurring_admin_todos.content', 'recurring_admin_todos', 'content', 'content'),
  col('app_settings.smtp_password', 'app_settings', 'smtp_password_enc', 'smtp_password'),
  col('app_settings.ldap_bind_password', 'app_settings', 'ldap_bind_password_enc', 'ldap_bind_password'),
  col('app_settings.outlook_client_secret', 'app_settings', 'outlook_client_secret_enc', 'outlook_client_secret'),
  col('app_settings.mail_secrets', 'app_settings', 'mail_secrets_enc', 'mail_secrets'),
  col('attachments.filename', 'attachments', 'filename', 'filename'),
  col('attachments.data', 'attachments', 'data_b64', 'data', BIG),
  col('file_uploads.filename', 'file_uploads', 'filename', 'filename'),
  col('file_uploads.data', 'file_upload_chunks', 'data_enc', 'data', {
    ...BIG, aadTable: 'file_uploads', key: ['upload_id', 'part'], recordId: row => `${row.upload_id}:${row.part}`
  }),
  col('kb_article_attachments.filename', 'kb_article_attachments', 'filename', 'filename'),
  col('kb_article_attachments.data', 'kb_article_attachments', 'data_b64', 'data', BIG),
  col('kb_articles.title', 'kb_articles', 'title', 'title'),
  col('kb_articles.content', 'kb_articles', 'content', 'content'),
  col('notifications.message', 'notifications', 'message', 'message'),
  col('recurring_ticket_rules.title', 'recurring_ticket_rules', 'title', 'title'),
  col('recurring_ticket_rules.description', 'recurring_ticket_rules', 'description', 'description'),
  col('text_blocks.content', 'text_blocks', 'content', 'content'),
  col('ticket_approvals.request_text', 'ticket_approvals', 'request_text_enc', 'request_text'),
  col('ticket_approvals.decision_text', 'ticket_approvals', 'decision_text_enc', 'decision_text'),
  col('ticket_messages.content', 'ticket_messages', 'content', 'content'),
  col('ticket_messages.content_html', 'ticket_messages', 'content_html', 'content_html'),
  col('ticket_notes.content', 'ticket_notes', 'content', 'content'),
  col('ticket_time_entries.note', 'ticket_time_entries', 'note_enc', 'note'),
  col('ticket_todos.content', 'ticket_todos', 'content', 'content'),
  ...['title', 'description', 'approval_text', 'custom_fields_json', 'incident_notice', 'waiting_message']
    .map(field => col(`tickets.${field}`, 'tickets', field, field)),
  col('users.preferences', 'user_preferences', 'value_enc', 'value', { key: ['user_id'] }),
  col('users.name', 'users', 'name_enc', 'name'),
  col('users.email', 'users', 'email_enc', 'email'),
  col('users.totp_secret', 'users', 'totp_secret_enc', 'totp_secret'),
  ...['phone', 'mobile', 'job_title', 'office_location'].map(field => col(`users.${field}`, 'users', field, field)),
  col('users.outlook_refresh_token', 'users', 'outlook_refresh_token_enc', 'outlook_refresh_token'),
  col('users.avatar_image', 'users', 'avatar_image_enc', 'avatar_image'),
  col('users.profile', 'users', 'profile_enc', 'profile')
];

export const BLIND_INDEX_PURPOSE = 'blind-index.users.email';
const BLIND_JOB = 'users.email_blind_idx';

export interface CryptoDeps {
  readonly db: Kysely<Database>;
  readonly keyProvider: KeyProvider;
  readonly installationId: string;
}

export interface ReencryptResult {
  processed: number;
  updated: number;
  failed: number;
  complete: boolean;
  failures: string[];
}

const jobKey = (c: EncryptedColumn) => `${c.table}.${c.column}`;

async function jobState(db: Kysely<Database>, key: string, targetVersion: number) {
  const row = await db.selectFrom('crypto_jobs').selectAll().where('job_key', '=', key).executeTakeFirst();
  if (row && row.target_version === targetVersion) return row;
  // Neue Zielversion (erneute Rotation) -> von vorn beginnen.
  await db.insertInto('crypto_jobs').values({ job_key: key, last_id: null, processed: 0, failed: 0, target_version: targetVersion, done_at: null })
    .onDuplicateKeyUpdate({ last_id: null, processed: 0, failed: 0, target_version: targetVersion, done_at: null }).execute();
  return { job_key: key, last_id: null, processed: 0, failed: 0, target_version: targetVersion, done_at: null };
}

async function reencryptColumn(deps: CryptoDeps, c: EncryptedColumn, deadline: number, result: ReencryptResult): Promise<boolean> {
  const dek = await ensureDek(deps.db, deps.keyProvider, c.purpose);
  const key = c.key ?? ['id'];
  const state = await jobState(deps.db, jobKey(c), dek.keyVersion);
  if (state.done_at) return true;
  let last: unknown[] | null = state.last_id ? JSON.parse(state.last_id) : null;
  const batch = c.batch ?? 200;
  while (Date.now() < deadline) {
    const after = last
      ? sql`AND (${sql.join(key.map(k => sql.ref(k)))}) > (${sql.join(last.map(v => sql`${v}`))})`
      : sql``;
    const rows = (await sql<Record<string, unknown>>`SELECT ${sql.join(key.map(k => sql.ref(k)))}, ${sql.ref(c.column)} AS value
      FROM ${sql.table(c.table)} WHERE ${sql.ref(c.column)} IS NOT NULL ${after}
      ORDER BY ${sql.join(key.map(k => sql.ref(k)))} LIMIT ${batch}`.execute(deps.db)).rows;
    if (!rows.length) {
      await deps.db.updateTable('crypto_jobs').set({ done_at: new Date(), last_id: null }).where('job_key', '=', jobKey(c)).execute();
      return true;
    }
    let failed = 0;
    let updated = 0;
    for (const row of rows) {
      result.processed++;
      const stored = Buffer.isBuffer(row.value) ? row.value : Buffer.from(row.value as Uint8Array);
      if (isCurrentField(stored, dek)) continue;
      const recordId = c.recordId ? c.recordId(row) : String(row[key[0]!]);
      const ctx = { installationId: deps.installationId, tableName: c.aadTable ?? c.table, recordId, fieldName: c.fieldName };
      let fresh: Buffer;
      try {
        fresh = fieldCipher.encryptField(fieldCipher.decryptField(stored, dek, ctx), dek, ctx);
      } catch {
        failed++;
        if (result.failures.length < 50) result.failures.push(`${c.table}.${c.column} ${recordId}`);
        continue;
      }
      // Nur ersetzen, wenn der Wert inzwischen nicht von der Anwendung geaendert wurde.
      const where = sql.join(key.map(k => sql`${sql.ref(k)} = ${row[k] as string | number}`), sql` AND `);
      const res = await sql`UPDATE ${sql.table(c.table)} SET ${sql.ref(c.column)} = ${fresh} WHERE ${where} AND ${sql.ref(c.column)} = ${stored}`.execute(deps.db);
      updated += Number(res.numAffectedRows ?? 0);
    }
    result.updated += updated;
    result.failed += failed;
    last = key.map(k => rows[rows.length - 1]![k]);
    await deps.db.updateTable('crypto_jobs').set({
      last_id: JSON.stringify(last), processed: sql`processed + ${rows.length}`, failed: sql`failed + ${failed}`
    }).where('job_key', '=', jobKey(c)).execute();
  }
  return false;
}

// Blind-Index der E-Mail-Adressen nach einer Rotation des Blind-Index-Schluessels neu berechnen.
async function rebuildBlindIndex(deps: CryptoDeps, deadline: number, result: ReencryptResult): Promise<boolean> {
  const blind = await ensureDek(deps.db, deps.keyProvider, BLIND_INDEX_PURPOSE);
  const emailDek = await ensureDek(deps.db, deps.keyProvider, 'users.email');
  const state = await jobState(deps.db, BLIND_JOB, blind.keyVersion);
  if (state.done_at) return true;
  let last = state.last_id ? JSON.parse(state.last_id)[0] as string : '';
  while (Date.now() < deadline) {
    const rows = await deps.db.selectFrom('users').select(['id', 'email_enc', 'email_blind_idx'])
      .where('id', '>', last).orderBy('id').limit(200).execute();
    if (!rows.length) {
      await deps.db.updateTable('crypto_jobs').set({ done_at: new Date(), last_id: null }).where('job_key', '=', BLIND_JOB).execute();
      return true;
    }
    for (const row of rows) {
      result.processed++;
      try {
        const email = fieldCipher.decryptField(row.email_enc, emailDek, { installationId: deps.installationId, tableName: 'users', recordId: row.id, fieldName: 'email' });
        const index = computeBlindIndex(blind.rawDek, email.trim().toLowerCase());
        if (index !== row.email_blind_idx) {
          await deps.db.updateTable('users').set({ email_blind_idx: index }).where('id', '=', row.id).execute();
          result.updated++;
        }
      } catch {
        result.failed++;
        if (result.failures.length < 50) result.failures.push(`users.email_blind_idx ${row.id}`);
      }
    }
    last = rows[rows.length - 1]!.id;
    await deps.db.updateTable('crypto_jobs').set({ last_id: JSON.stringify([last]), processed: sql`processed + ${rows.length}` })
      .where('job_key', '=', BLIND_JOB).execute();
  }
  return false;
}

// Laeuft hoechstens budgetMs lang und setzt beim naechsten Aufruf fort.
export async function reencryptAll(deps: CryptoDeps, budgetMs = Number.POSITIVE_INFINITY): Promise<ReencryptResult> {
  const deadline = Date.now() + budgetMs;
  const result: ReencryptResult = { processed: 0, updated: 0, failed: 0, complete: false, failures: [] };
  for (const column of ENCRYPTED_COLUMNS) {
    if (!await reencryptColumn(deps, column, deadline, result)) return result;
  }
  result.complete = await rebuildBlindIndex(deps, deadline, result);
  return result;
}

// Sind noch Werte im Altformat oder mit alter Schluesselversion unterwegs?
export async function reencryptPending(db: Kysely<Database>): Promise<boolean> {
  const keys = [...ENCRYPTED_COLUMNS.map(jobKey), BLIND_JOB];
  const done = await db.selectFrom('crypto_jobs').select('job_key').where('job_key', 'in', keys).where('done_at', 'is not', null).execute();
  return done.length < keys.length;
}

export async function rotateDek(db: Kysely<Database>, provider: KeyProvider, purpose: string, reason: string): Promise<number> {
  return db.transaction().execute(async trx => {
    const current = await trx.selectFrom('data_encryption_keys').select(['key_version', 'active'])
      .where('purpose', '=', purpose).orderBy('key_version', 'desc').forUpdate().execute();
    const previous = current.find(row => !!row.active)?.key_version ?? null;
    const version = (current[0]?.key_version ?? 0) + 1;
    await trx.updateTable('data_encryption_keys').set({ active: false }).where('purpose', '=', purpose).execute();
    await insertDekVersion(trx, provider, purpose, version, generateRawDek());
    await trx.insertInto('key_rotation_log').values({ purpose, old_key_version: previous, new_key_version: version, reason }).execute();
    return version;
  });
}

export async function rotateAllDeks(db: Kysely<Database>, provider: KeyProvider, reason: string): Promise<string[]> {
  const purposes = new Set([...ENCRYPTED_COLUMNS.map(c => c.purpose), BLIND_INDEX_PURPOSE]);
  for (const row of await db.selectFrom('data_encryption_keys').select('purpose').distinct().execute()) purposes.add(row.purpose);
  for (const purpose of purposes) await rotateDek(db, provider, purpose, reason);
  return [...purposes];
}

// Jede DEK mit der aktuellen KEK (und AAD-Bindung) neu umhuellen.
export async function rewrapAllDeks(db: Kysely<Database>, provider: KeyProvider): Promise<number> {
  const current = await provider.currentKekVersion();
  const rows = await db.selectFrom('data_encryption_keys').select(['id', 'purpose', 'key_version', 'wrapped_dek', 'active', 'kek_version', 'wrap_format']).execute();
  let count = 0;
  for (const row of rows) {
    if (row.kek_version === current && row.wrap_format === DEK_WRAP_FORMAT) continue;
    const raw = await unwrapDekRow(provider, row.purpose, row as never);
    await db.updateTable('data_encryption_keys').set({
      wrapped_dek: await provider.wrapDek(raw, dekWrapAad(row.purpose, row.key_version)), kek_version: current, wrap_format: DEK_WRAP_FORMAT
    }).where('id', '=', row.id).where('kek_version', '=', row.kek_version).execute();
    count++;
  }
  return count;
}

// DEK-Versionen, die nach abgeschlossener Neuverschluesselung niemand mehr braucht, entfernen.
export async function pruneRetiredDeks(db: Kysely<Database>): Promise<number> {
  if (await reencryptPending(db)) throw new Error('Die Neuverschluesselung ist noch nicht abgeschlossen -- alte Schluesselversionen werden noch gebraucht.');
  const failed = await db.selectFrom('crypto_jobs').select(db.fn.sum<number>('failed').as('n')).executeTakeFirst();
  if (Number(failed?.n ?? 0) > 0) throw new Error('Einzelne Werte konnten nicht neu verschluesselt werden -- alte Schluesselversionen bleiben erhalten (siehe "keys status").');
  const result = await db.deleteFrom('data_encryption_keys').where('active', '=', false).executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export interface CryptoStatus {
  kekVersions: number[];
  currentKek: number;
  dekKekVersions: number[];
  unboundWraps: number;
  purposes: { purpose: string; active: number | null; versions: number }[];
  reencryptPending: boolean;
}

export async function cryptoStatus(db: Kysely<Database>, provider: KeyProvider): Promise<CryptoStatus> {
  const rows = await db.selectFrom('data_encryption_keys').select(['purpose', 'key_version', 'active', 'kek_version', 'wrap_format']).execute();
  const byPurpose = new Map<string, { active: number | null; versions: number }>();
  for (const row of rows) {
    const entry = byPurpose.get(row.purpose) ?? { active: null, versions: 0 };
    entry.versions++;
    if (row.active) entry.active = row.key_version;
    byPurpose.set(row.purpose, entry);
  }
  return {
    kekVersions: await provider.kekVersions(),
    currentKek: await provider.currentKekVersion(),
    dekKekVersions: [...new Set(rows.map(r => r.kek_version))].sort((a, b) => a - b),
    unboundWraps: rows.filter(r => r.wrap_format !== DEK_WRAP_FORMAT).length,
    purposes: [...byPurpose.entries()].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => a.purpose.localeCompare(b.purpose)),
    reencryptPending: await reencryptPending(db)
  };
}

export type { ResolvedDek };
