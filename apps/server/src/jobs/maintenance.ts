/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Periodische Wartung: Auto-Archivierung geschlossener Tickets + Ausführung fälliger
// wiederkehrender Ticket-Regeln.
//
// Bewusst EIN einfacher In-Prozess-Timer (setInterval in index.ts), KEINE echte Job-Queue mit
// Tabellen-Lock/Retry/Dead-Letter wie in docs/JOBS.md beschrieben -- das ist eine bekannte
// Vereinfachung, die bei genau einer laufenden App-Instanz korrekt funktioniert, aber bei
// mehreren gleichzeitig laufenden Instanzen zu doppelter Ausführung führen kann (keine
// Sperre zwischen Instanzen). Für eine horizontal skalierte Installation müsste das durch die
// in docs/JOBS.md vorgesehene DB-Queue ersetzt werden.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher, decryptFieldTolerant } from '../crypto/fieldCrypto.js';
import { randomUUID } from 'node:crypto';
import { mysqlTimestamp } from '../db/date.js';
import { isAccountExpired } from '../domain/accountValidity.js';
import { buildTicketNumber } from '../domain/ticketNumber.js';
import { runRecurringAdminTodos } from './adminTodos.js';
import { notifyUser } from '../domain/notifications.js';

const DEFAULT_AUTO_ARCHIVE_DAYS = 3;

interface MaintenanceDeps {
  db: Kysely<Database>;
  env: Env;
  keyProvider: KeyProvider;
}

export async function runAutoArchive(deps: MaintenanceDeps): Promise<number> {
  const settingsRow = await deps.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const config = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
  const configuredDays = Number(config.autoArchiveClosedAfterDays);
  const days = Number.isFinite(configuredDays) ? configuredDays : DEFAULT_AUTO_ARCHIVE_DAYS;
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const due = await deps.db.selectFrom('tickets')
    .select('id')
    .where('status', '=', 'Geschlossen')
    .where('archived_at', 'is', null)
    .where('closed_at', 'is not', null)
    .where('closed_at', '<=', cutoff)
    .execute();

  for (const ticket of due) {
    await deps.db.updateTable('tickets')
      .set({ archived_at: mysqlTimestamp(), updated_at: mysqlTimestamp() })
      .where('id', '=', ticket.id)
      .execute();
    await deps.db.insertInto('ticket_audit_log').values({
      id: randomUUID(),
      ticket_id: ticket.id,
      actor_user_id: null,
      actor_username: 'system',
      action: 'auto_archived'
    }).execute();
  }
  return due.length;
}

function advanceDate(date: Date, unit: 'day' | 'week' | 'month', count: number): Date {
  const next = new Date(date);
  if (unit === 'day') next.setDate(next.getDate() + count);
  else if (unit === 'week') next.setDate(next.getDate() + count * 7);
  else next.setMonth(next.getMonth() + count);
  return next;
}

export async function runRecurringTickets(deps: MaintenanceDeps): Promise<number> {
  const settingsRow = await deps.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const numberingConfig = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
  const due = await deps.db.selectFrom('recurring_ticket_rules')
    .selectAll()
    .where('active', '=', true)
    .where('next_run_at', '<=', new Date())
    .execute();

  if (due.length === 0) return 0;

  const titleDek = await ensureDek(deps.db, deps.keyProvider, 'tickets.title');
  const descriptionDek = await ensureDek(deps.db, deps.keyProvider, 'tickets.description');
  // Security-Audit N10-Rest: die Regel selbst speichert title/description jetzt ebenfalls
  // verschlüsselt (Migration 0038) -- erst entschlüsseln, dann für das neue Ticket erneut
  // verschlüsseln (eigene DEKs je Tabelle, nicht einfach weiterkopieren).
  const ruleTitleDek = await ensureDek(deps.db, deps.keyProvider, 'recurring_ticket_rules.title');
  const ruleDescriptionDek = await ensureDek(deps.db, deps.keyProvider, 'recurring_ticket_rules.description');

  for (const rule of due) {
    const ruleTitle = decryptFieldTolerant(rule.title, ruleTitleDek.rawDek, {
      installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'recurring_ticket_rules', recordId: rule.id, fieldName: 'title', keyVersion: ruleTitleDek.keyVersion
    });
    const ruleDescription = decryptFieldTolerant(rule.description, ruleDescriptionDek.rawDek, {
      installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'recurring_ticket_rules', recordId: rule.id, fieldName: 'description', keyVersion: ruleDescriptionDek.keyVersion
    });
    const rows = await deps.db.selectFrom('tickets').select('ticket_number').execute();
    const lastNum = rows.reduce((max, row) => {
      const found = String(row.ticket_number || '').match(/(\d+)(?!.*\d)/);
      return Math.max(max, found ? Number(found[1]) || 0 : 0);
    }, 0);
    const ticketNumber = buildTicketNumber(lastNum + 1, rule.category, numberingConfig);

    const newId = randomUUID();
    const ctx = (fieldName: string, keyVersion: number) => ({
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'tickets',
      recordId: newId,
      fieldName,
      keyVersion
    });
    await deps.db.insertInto('tickets').values({
      id: newId,
      ticket_number: ticketNumber,
      title: fieldCipher.encryptField(ruleTitle, titleDek.rawDek, ctx('title', titleDek.keyVersion)),
      description: fieldCipher.encryptField(ruleDescription, descriptionDek.rawDek, ctx('description', descriptionDek.keyVersion)),
      priority: rule.priority,
      category: rule.category,
      type: 'ticket',
      created_by_user_id: rule.created_by_user_id,
      created_by_username: 'system (wiederkehrend)',
      status: 'Neu',
      installation_id: deps.env.INSTALLATION_ID
    }).execute();

    await deps.db.insertInto('ticket_audit_log').values({
      id: randomUUID(), ticket_id: newId, actor_user_id: null, actor_username: 'system', action: 'created_recurring'
    }).execute();

    await deps.db.updateTable('recurring_ticket_rules')
      .set({ next_run_at: mysqlTimestamp(advanceDate(new Date(rule.next_run_at), rule.interval_unit, rule.interval_count)) })
      .where('id', '=', rule.id)
      .execute();
  }
  return due.length;
}

const DEFAULT_WAITING_REMINDER_DAYS = 2;
const DEFAULT_WAITING_AUTO_CLOSE_DAYS = 7;

async function notifyTicketAuthor(deps: MaintenanceDeps, ticket: { id: string; created_by_user_id: string | null; created_by_username: string; ticket_number: string }, message: string): Promise<void> {
  // Ueber die zentrale Zustellung: beachtet persoenliche Einstellungen und gesperrte/archivierte Konten.
  await notifyUser(deps, { recipientUserId: ticket.created_by_user_id, type: 'statusChange', ticketId: ticket.id,
    ticketNumber: ticket.ticket_number, message });
}

// Erinnert die anfragende Person nach X Tagen, schließt das Ticket nach Y Tagen automatisch,
// wenn "Warten auf ..." (siehe waiting_since/waiting_message, PATCH /api/v2/tickets/:id) zu
// lange unbeantwortet bleibt. Konfigurierbar über app_settings.config_json, wie autoArchive.
export async function runAbsenceSchedules(deps: MaintenanceDeps): Promise<{ reassigned: number; ended: number }> {
  const now = new Date();
  const expired = await deps.db.updateTable('user_absences').set({ active: false, ended_at: mysqlTimestamp(now) }).where('active', '=', true).where('until_at', '<', now).executeTakeFirst();
  const periods = await deps.db.selectFrom('user_absences').selectAll().where('active', '=', true)
    .where(eb => eb.or([eb('from_at', 'is', null), eb('from_at', '<=', now)]))
    .where(eb => eb.or([eb('until_at', 'is', null), eb('until_at', '>=', now)])).execute();
  let reassigned = 0;
  for (const period of periods) await deps.db.transaction().execute(async trx => {
    await trx.selectFrom('users').select('id').where('id', '=', period.user_id).forUpdate().executeTakeFirst();
    const current = await trx.selectFrom('user_absences').select('active').where('id', '=', period.id).forUpdate().executeTakeFirst();
    if (!current?.active) return;
    const candidate = period.substitute_user_id ? await trx.selectFrom('users').select(['id', 'username', 'role', 'account_archived', 'locked_permanent', 'account_valid_until']).where('id', '=', period.substitute_user_id).executeTakeFirst() : null;
    const substitute = candidate && !candidate.account_archived && !candidate.locked_permanent && !isAccountExpired(candidate.account_valid_until) && candidate.role !== 'user' ? candidate : null;
    const tickets = await trx.selectFrom('tickets').select('id').where('assigned_to_user_id', '=', period.user_id).where('archived_at', 'is', null).where('status', '!=', 'Geschlossen').execute();
    for (const ticket of tickets) {
      const changed = await trx.updateTable('tickets').set({ assigned_to_user_id: substitute?.id || null, assigned_to_username: substitute?.username || null, updated_at: mysqlTimestamp(now) }).where('id', '=', ticket.id).where('assigned_to_user_id', '=', period.user_id).executeTakeFirst();
      if (!Number(changed.numUpdatedRows)) continue;
      await trx.insertInto('ticket_audit_log').values({ id: randomUUID(), ticket_id: ticket.id, actor_user_id: null, actor_username: 'system', action: 'reassigned_absence', field: 'assigned_to_user_id', old_value: period.user_id, new_value: substitute?.id || null }).execute();
      reassigned++;
    }
  });
  return { reassigned, ended: Number(expired.numUpdatedRows) };
}

export async function runWaitingTickets(deps: MaintenanceDeps): Promise<{ reminded: number; closed: number }> {
  const settingsRow = await deps.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const config = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
  const reminderDays = Number(config.waitingReminderDays) || DEFAULT_WAITING_REMINDER_DAYS;
  const autoCloseDays = Number(config.waitingAutoCloseDays) || DEFAULT_WAITING_AUTO_CLOSE_DAYS;

  const waiting = await deps.db.selectFrom('tickets')
    .select(['id', 'ticket_number', 'created_by_user_id', 'created_by_username', 'waiting_since', 'waiting_message', 'waiting_reminder_sent'])
    .where('waiting_since', 'is not', null)
    .where('archived_at', 'is', null)
    .execute();

  let reminded = 0;
  let closed = 0;
  const now = Date.now();
  for (const t of waiting) {
    const since = new Date(t.waiting_since as unknown as string).getTime();
    const daysWaiting = (now - since) / (24 * 60 * 60 * 1000);
    if (config.waitingAfterAction !== 'keep_open' && daysWaiting >= autoCloseDays) {
      await deps.db.updateTable('tickets').set({
        status: 'Geschlossen', closed_at: mysqlTimestamp(), updated_at: mysqlTimestamp(),
        waiting_since: null, waiting_message: null, waiting_reminder_sent: false
      }).where('id', '=', t.id).execute();
      await deps.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: t.id, actor_user_id: null, actor_username: 'system',
        action: 'auto_closed_waiting'
      }).execute();
      await notifyTicketAuthor(deps, t, 'Dein Ticket wurde automatisch geschlossen, weil wir keine Antwort erhalten haben. Du kannst jederzeit wieder antworten.');
      closed++;
    } else if (config.waitingReminderEnabled !== false && daysWaiting >= reminderDays && !t.waiting_reminder_sent) {
      await deps.db.updateTable('tickets').set({ waiting_reminder_sent: true }).where('id', '=', t.id).execute();
      await deps.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: t.id, actor_user_id: null, actor_username: 'system',
        action: 'waiting_reminder_sent'
      }).execute();
      // Security-Audit N10: waiting_message ist jetzt AES-256-GCM-verschlüsselt (tickets.ts).
      // R-2: tolerant entschlüsseln -- siehe fieldCrypto.ts decryptFieldTolerant.
      let waitingMessageText: string | null = null;
      if (t.waiting_message) {
        const dek = await ensureDek(deps.db, deps.keyProvider, 'tickets.waiting_message');
        waitingMessageText = decryptFieldTolerant(t.waiting_message, dek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'tickets', recordId: t.id, fieldName: 'waiting_message', keyVersion: dek.keyVersion
        });
      }
      await notifyTicketAuthor(deps, t, `Erinnerung: Wir warten noch auf deine Antwort.${waitingMessageText ? ' ' + waitingMessageText : ''}`);
      reminded++;
    }
  }
  return { reminded, closed };
}

async function logSystemAction(deps: MaintenanceDeps, action: string, detail: Record<string, unknown>): Promise<void> {
  await deps.db.insertInto('global_audit_log').values({
    id: randomUUID(), actor_user_id: null, actor_username: 'System', action, target_type: 'system', target_id: null,
    detail_json: JSON.stringify(detail)
  }).execute();
}

export function startMaintenanceScheduler(deps: MaintenanceDeps, intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const tick = async () => {
    // Automatische Aktionen erscheinen im Systemprotokoll (nur wenn tatsaechlich etwas passiert ist),
    // ebenso jeder Fehlschlag eines Jobs.
    const jobs: Array<[string, string, () => Promise<Record<string, number>>]> = [
      ['Abwesenheitsplanung', 'system.absences_processed', async () => runAbsenceSchedules(deps)],
      ['Auto-Archivierung', 'system.auto_archived', async () => ({ count: await runAutoArchive(deps) })],
      ['Wiederkehrende Tickets', 'system.recurring_tickets_created', async () => ({ count: await runRecurringTickets(deps) })],
      ['Wiederkehrende Aufgaben', 'system.recurring_todos_created', async () => ({ count: Number(await runRecurringAdminTodos(deps)) || 0 })],
      ['Warten-auf-Benutzer', 'system.waiting_processed', async () => await runWaitingTickets(deps)]
    ];
    for (const [name, action, job] of jobs) {
      try {
        const result = await job();
        if (Object.values(result).some(value => Number(value) > 0)) await logSystemAction(deps, action, result);
      } catch (err) {
        console.error(`Wartungsjob fehlgeschlagen: ${name}`, err);
        await logSystemAction(deps, 'system.job_failed', { job: name }).catch(() => {});
      }
    }
  };
  void tick();
  return setInterval(tick, intervalMs);
}
