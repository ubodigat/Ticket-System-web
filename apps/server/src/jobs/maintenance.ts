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
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_AUTO_ARCHIVE_DAYS = 3;

interface MaintenanceDeps {
  db: Kysely<Database>;
  env: Env;
  keyProvider: KeyProvider;
}

export async function runAutoArchive(deps: MaintenanceDeps): Promise<number> {
  const settingsRow = await deps.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const config = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
  const days = Number(config.autoArchiveClosedAfterDays) || DEFAULT_AUTO_ARCHIVE_DAYS;
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
      .set({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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
  const due = await deps.db.selectFrom('recurring_ticket_rules')
    .selectAll()
    .where('active', '=', true)
    .where('next_run_at', '<=', new Date())
    .execute();

  if (due.length === 0) return 0;

  const titleDek = await ensureDek(deps.db, deps.keyProvider, 'tickets.title');
  const descriptionDek = await ensureDek(deps.db, deps.keyProvider, 'tickets.description');

  for (const rule of due) {
    const maxRow = await deps.db.selectFrom('tickets')
      .select(deps.db.fn.max('ticket_number').as('max_num'))
      .executeTakeFirst();
    const lastNum = parseInt(String(maxRow?.max_num ?? '0').replace(/\D/g, ''), 10) || 0;
    const ticketNumber = String(lastNum + 1).padStart(5, '0');

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
      title: fieldCipher.encryptField(rule.title, titleDek.rawDek, ctx('title', titleDek.keyVersion)),
      description: fieldCipher.encryptField(rule.description, descriptionDek.rawDek, ctx('description', descriptionDek.keyVersion)),
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
      .set({ next_run_at: advanceDate(new Date(rule.next_run_at), rule.interval_unit, rule.interval_count) })
      .where('id', '=', rule.id)
      .execute();
  }
  return due.length;
}

const DEFAULT_WAITING_REMINDER_DAYS = 2;
const DEFAULT_WAITING_AUTO_CLOSE_DAYS = 7;

async function notifyTicketAuthor(deps: MaintenanceDeps, ticket: { id: string; created_by_user_id: string | null; created_by_username: string; ticket_number: string }, message: string): Promise<void> {
  if (!ticket.created_by_user_id) return;
  const id = randomUUID();
  const dek = await ensureDek(deps.db, deps.keyProvider, 'notifications.message');
  const encrypted = fieldCipher.encryptField(message, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'notifications', recordId: id, fieldName: 'message', keyVersion: dek.keyVersion
  });
  await deps.db.insertInto('notifications').values({
    id, recipient_user_id: ticket.created_by_user_id, recipient_username: ticket.created_by_username,
    type: 'statusChange', ticket_id: ticket.id, ticket_number: ticket.ticket_number, message: encrypted, is_read: false
  }).execute();
}

// Erinnert die anfragende Person nach X Tagen, schließt das Ticket nach Y Tagen automatisch,
// wenn "Warten auf ..." (siehe waiting_since/waiting_message, PATCH /api/v2/tickets/:id) zu
// lange unbeantwortet bleibt. Konfigurierbar über app_settings.config_json, wie autoArchive.
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
    if (daysWaiting >= autoCloseDays) {
      await deps.db.updateTable('tickets').set({
        status: 'Geschlossen', closed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        waiting_since: null, waiting_message: null, waiting_reminder_sent: false
      }).where('id', '=', t.id).execute();
      await deps.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: t.id, actor_user_id: null, actor_username: 'system',
        action: 'auto_closed_waiting'
      }).execute();
      await notifyTicketAuthor(deps, t, 'Dein Ticket wurde automatisch geschlossen, weil wir keine Antwort erhalten haben. Du kannst jederzeit wieder antworten.');
      closed++;
    } else if (daysWaiting >= reminderDays && !t.waiting_reminder_sent) {
      await deps.db.updateTable('tickets').set({ waiting_reminder_sent: true }).where('id', '=', t.id).execute();
      await deps.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: t.id, actor_user_id: null, actor_username: 'system',
        action: 'waiting_reminder_sent'
      }).execute();
      await notifyTicketAuthor(deps, t, `Erinnerung: Wir warten noch auf deine Antwort.${t.waiting_message ? ' ' + t.waiting_message : ''}`);
      reminded++;
    }
  }
  return { reminded, closed };
}

export function startMaintenanceScheduler(deps: MaintenanceDeps, intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const tick = async () => {
    try {
      await runAutoArchive(deps);
      await runRecurringTickets(deps);
      await runWaitingTickets(deps);
    } catch (err) {
      console.error('Wartungslauf fehlgeschlagen:', err);
    }
  };
  void tick();
  return setInterval(tick, intervalMs);
}
