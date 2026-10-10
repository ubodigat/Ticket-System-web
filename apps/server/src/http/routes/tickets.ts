/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Tickets API - vollständig sicher, normalisiert, RBAC-enforced
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireSession, requireAdmin } from './session.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek, type ResolvedDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { routeError } from './routeError.js';
import { createNotification } from './extras.js';
import { calculateSlaDueAt } from '../../domain/sla.js';
import { isValidTicketStatus } from '../../domain/status.js';
import { buildTicketNumber } from '../../domain/ticketNumber.js';

export interface TicketsRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}


// Alle Ticket-/Chat-/Notiz-Inhalte werden serverseitig AES-256-GCM-verschlüsselt gespeichert
// (docs-Entscheidung: serverseitig statt Ende-zu-Ende, da Server weiterhin lesen/filtern muss).
// Eine DEK pro Zweck wird einmal pro Request geladen und für alle betroffenen Felder desselben
// Zwecks wiederverwendet statt pro Zeile neu entschlüsselt zu werden.
interface TicketDeks {
  title: ResolvedDek;
  description: ResolvedDek;
  incidentNotice: ResolvedDek;
}

async function loadTicketDeks(app: FastifyInstance, keyProvider: KeyProvider): Promise<TicketDeks> {
  const [title, description, incidentNotice] = await Promise.all([
    ensureDek(app.db, keyProvider, 'tickets.title'),
    ensureDek(app.db, keyProvider, 'tickets.description'),
    ensureDek(app.db, keyProvider, 'tickets.incident_notice')
  ]);
  return { title, description, incidentNotice };
}

function encryptTicketField(
  value: string,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string,
  fieldName: string
): Buffer {
  return fieldCipher.encryptField(value, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'tickets',
    recordId,
    fieldName,
    keyVersion: dek.keyVersion
  });
}

function decryptTicketField(
  stored: Buffer,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string,
  fieldName: string
): string {
  return fieldCipher.decryptField(stored, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'tickets',
    recordId,
    fieldName,
    keyVersion: dek.keyVersion
  });
}

function decryptTicketRow<T extends { id: string; title: Buffer; description?: Buffer; incident_notice?: Buffer | null }>(
  row: T,
  deks: TicketDeks,
  deps: TicketsRouteDeps
): Omit<T, 'title' | 'description'> & { title: string; description?: string } {
  const out: any = { ...row, title: decryptTicketField(row.title, deks.title, deps, row.id, 'title') };
  if (row.description !== undefined) {
    out.description = decryptTicketField(row.description, deks.description, deps, row.id, 'description');
  }
  if (row.incident_notice) {
    out.incident_notice = decryptTicketField(row.incident_notice, deks.incidentNotice, deps, row.id, 'incident_notice');
  }
  return out;
}

const createTicketSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(50000),
  priority: z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch']).default('Normal'),
  category: z.string().trim().max(128).optional(),
  type: z.enum(['ticket', 'incident']).default('ticket'),
  incident_notice: z.string().trim().max(2000).optional(),
  custom_fields: z.record(z.unknown()).optional(),
  on_behalf_of_user_id: z.string().optional()
});

const updateTicketSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(50000).optional(),
  status: z.string().trim().min(1).max(64).refine(isValidTicketStatus, 'invalid_status').optional(),
  priority: z.string().trim().min(1).max(32).optional(),
  category: z.string().trim().max(128).nullable().optional(),
  assigned_to_user_id: z.string().nullable().optional(),
  assigned_to_username: z.string().nullable().optional(),
  sla_due_at: z.string().nullable().optional(),
  custom_due_at: z.string().nullable().optional(),
  // approval_status/approval_text bewusst NICHT hier: sonst koennte jede Admin-Person per
  // generischem PATCH die Genehmigung direkt setzen und damit die Pruefer-/Vertretungs-
  // Beschraenkung von POST /tickets/:id/approval-decision umgehen. Aenderungen am
  // Genehmigungsstatus laufen ausschliesslich ueber die dedizierten Endpunkte dort.
  type: z.enum(['ticket', 'incident']).optional(),
  incident_notice: z.string().trim().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
  waiting_message: z.string().trim().max(2000).optional(),
  archived_author_ack: z.boolean().optional()
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  content_html: z.string().max(200000).optional()
});

const addNoteSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  stream: z.enum(['admin-chat', 'solution']),
  note_type: z.string().trim().min(1).max(64),
  is_pinned: z.boolean().default(false),
  is_resolution: z.boolean().default(false)
});

const requestApprovalSchema = z.object({
  approver_user_id: z.string().min(1),
  text: z.string().trim().max(5000).optional()
});

const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(5000).optional()
});

const addTimeEntrySchema = z.object({
  minutes: z.number().int().positive().max(24 * 60),
  note: z.string().trim().max(512).optional()
});

const linkIncidentSchema = z.object({
  incident_id: z.string().min(1)
});

const createTodoSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  assignee_user_id: z.string().nullable().optional(),
  assignee_username: z.string().nullable().optional()
});

const updateTodoSchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  assignee_user_id: z.string().nullable().optional(),
  assignee_username: z.string().nullable().optional(),
  done: z.boolean().optional()
});

interface MessageDeks {
  content: ResolvedDek;
  contentHtml: ResolvedDek;
}

async function loadMessageDeks(app: FastifyInstance, keyProvider: KeyProvider): Promise<MessageDeks> {
  const [content, contentHtml] = await Promise.all([
    ensureDek(app.db, keyProvider, 'ticket_messages.content'),
    ensureDek(app.db, keyProvider, 'ticket_messages.content_html')
  ]);
  return { content, contentHtml };
}

function encryptMessage(deps: TicketsRouteDeps, deks: MessageDeks, recordId: string, content: string, contentHtml: string | null) {
  const ctxBase = {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'ticket_messages',
    recordId
  };
  return {
    content: fieldCipher.encryptField(content, deks.content.rawDek, { ...ctxBase, fieldName: 'content', keyVersion: deks.content.keyVersion }),
    content_html: contentHtml !== null
      ? fieldCipher.encryptField(contentHtml, deks.contentHtml.rawDek, { ...ctxBase, fieldName: 'content_html', keyVersion: deks.contentHtml.keyVersion })
      : null
  };
}

function decryptMessage<T extends { id: string; content: Buffer; content_html: Buffer | null }>(
  row: T,
  deks: MessageDeks,
  deps: TicketsRouteDeps
) {
  const ctxBase = {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'ticket_messages',
    recordId: row.id
  };
  return {
    ...row,
    content: fieldCipher.decryptField(row.content, deks.content.rawDek, { ...ctxBase, fieldName: 'content', keyVersion: deks.content.keyVersion }),
    content_html: row.content_html
      ? fieldCipher.decryptField(row.content_html, deks.contentHtml.rawDek, { ...ctxBase, fieldName: 'content_html', keyVersion: deks.contentHtml.keyVersion })
      : null
  };
}

async function loadNoteDek(app: FastifyInstance, keyProvider: KeyProvider): Promise<ResolvedDek> {
  return ensureDek(app.db, keyProvider, 'ticket_notes.content');
}

function encryptNote(deps: TicketsRouteDeps, dek: ResolvedDek, recordId: string, content: string): Buffer {
  return fieldCipher.encryptField(content, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'ticket_notes',
    recordId,
    fieldName: 'content',
    keyVersion: dek.keyVersion
  });
}

function decryptNote<T extends { id: string; content: Buffer }>(row: T, dek: ResolvedDek, deps: TicketsRouteDeps) {
  return {
    ...row,
    content: fieldCipher.decryptField(row.content, dek.rawDek, {
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'ticket_notes',
      recordId: row.id,
      fieldName: 'content',
      keyVersion: dek.keyVersion
    })
  };
}

export function registerTicketsV2Routes(app: FastifyInstance, deps: TicketsRouteDeps): void {

  // GET /api/v2/tickets - Alle Tickets (RBAC: Admins sehen alle, Users nur eigene)
  app.get('/api/v2/tickets', async (req, reply) => {
    try {
      const session = requireSession(req);
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';

      // Die Übersicht (Kanban/Liste) brauchte bisher kein Zähl-/Status-Wissen über Chat, Notizen,
      // Teilaufgaben und Anhänge -- die liegen seit der Normalisierung in eigenen Tabellen und
      // kommen nicht mehr automatisch mit (vorher: ein JSON-Blob mit allem zusammen). Ohne diese
      // korrelierten Unterabfragen zeigten die Karten immer "0" an und das "wartet auf
      // Antwort"-Symbol nie, unabhängig vom tatsächlichen Stand.
      let query = app.db.selectFrom('tickets')
        .select(eb => [
          'id', 'ticket_number', 'title', 'status', 'priority', 'category', 'type',
          'created_by_user_id', 'created_by_username', 'assigned_to_user_id', 'assigned_to_username', 'assigned_group_id',
          'sla_due_at', 'custom_due_at', 'archived_at', 'closed_at', 'archived_author_ack',
          'approval_status', 'approval_requested_by', 'approval_reviewer_id', 'approval_text',
          'incident_id', 'incident_notice', 'filed_by_user_id', 'filed_by_username',
          'waiting_since', 'waiting_message', 'custom_fields_json', 'created_at', 'updated_at',
          eb.selectFrom('ticket_messages')
            .select('sender_role')
            .whereRef('ticket_messages.ticket_id', '=', 'tickets.id')
            .orderBy('created_at', 'desc')
            .limit(1)
            .as('last_message_role'),
          eb.selectFrom('ticket_messages')
            .select(eb2 => eb2.fn.countAll<number>().as('n'))
            .whereRef('ticket_messages.ticket_id', '=', 'tickets.id')
            .as('message_count'),
          eb.selectFrom('ticket_notes')
            .select(eb2 => eb2.fn.countAll<number>().as('n'))
            .whereRef('ticket_notes.ticket_id', '=', 'tickets.id')
            .as('note_count'),
          eb.selectFrom('ticket_todos')
            .select(eb2 => eb2.fn.countAll<number>().as('n'))
            .whereRef('ticket_todos.ticket_id', '=', 'tickets.id')
            .as('todo_count'),
          eb.selectFrom('ticket_todos')
            .select(eb2 => eb2.fn.countAll<number>().as('n'))
            .whereRef('ticket_todos.ticket_id', '=', 'tickets.id')
            .where('done', '=', true)
            .as('todo_done_count'),
          eb.selectFrom('attachments')
            .select(eb2 => eb2.fn.countAll<number>().as('n'))
            .whereRef('attachments.ticket_id', '=', 'tickets.id')
            .as('attachment_count'),
          eb.selectFrom('users')
            .select('account_archived')
            .whereRef('users.id', '=', 'tickets.created_by_user_id')
            .as('author_archived')
        ])
        .where('archived_at', 'is', null);

      if (!isAdmin) {
        // User sieht nur eigene, nicht-archivierte Tickets
        query = query.where('created_by_user_id', '=', session.uid);
      }

      const rows = await query.orderBy('created_at', 'desc').execute();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const tickets = rows.map(row => ({
        ...row,
        title: decryptTicketField(row.title, deks.title, deps, row.id, 'title'),
        incident_notice: row.incident_notice
          ? decryptTicketField(row.incident_notice, deks.incidentNotice, deps, row.id, 'incident_notice')
          : null
      }));
      return reply.send({ tickets });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/archived - Archiv (nur Admin)
  app.get('/api/v2/tickets/archived', async (req, reply) => {
    try {
      requireAdmin(req);
      const rows = await app.db.selectFrom('tickets')
        .selectAll()
        .where('archived_at', 'is not', null)
        .orderBy('archived_at', 'desc')
        .execute();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const tickets = rows.map(row => decryptTicketRow(row, deks, deps));
      return reply.send({ tickets });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/first-response-times - nur Admin, nur fuer Auswertung (AdminBoard.
  // openReports). Store.getTickets() liefert bewusst keine Chat-Nachrichten mit (N+1-Kosten fuer
  // jeden normalen Abruf, siehe mapApiTicketToLegacy) -- "Erste Antwortzeit" blieb dadurch bisher
  // immer leer, obwohl die Kennzahl in der Oberflaeche existierte. Eigener, schlanker Endpunkt
  // statt die generische Ticket-Liste mit einer weiteren korrelierten Unterabfrage zu belasten,
  // die nur dieser eine Report braucht.
  app.get('/api/v2/tickets/first-response-times', async (req, reply) => {
    try {
      requireAdmin(req);
      const { since } = req.query as { since?: string };
      let query = app.db.selectFrom('tickets')
        .select(eb => [
          'id',
          'created_at',
          eb.selectFrom('ticket_messages')
            .select('created_at')
            .whereRef('ticket_messages.ticket_id', '=', 'tickets.id')
            .where('sender_role', '!=', 'user')
            .orderBy('created_at', 'asc')
            .limit(1)
            .as('first_response_at')
        ]);
      if (since) query = query.where('created_at', '>=', new Date(since));
      const rows = await query.execute();
      return reply.send({ tickets: rows });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets - Neues Ticket erstellen
  app.post('/api/v2/tickets', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = createTicketSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const newId = randomUUID();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const titleEnc = encryptTicketField(parsed.data.title, deks.title, deps, newId, 'title');
      const descriptionEnc = encryptTicketField(parsed.data.description, deks.description, deps, newId, 'description');
      const incidentNoticeEnc = parsed.data.incident_notice
        ? encryptTicketField(parsed.data.incident_notice, deks.incidentNotice, deps, newId, 'incident_notice')
        : null;

      // Ticketnummer per SELECT MAX + Insert hat eine Race-Window (zwei gleichzeitige Anfragen
      // können denselben "nächsten" Wert berechnen). Der UNIQUE-Constraint auf ticket_number
      // verhindert eine doppelte Nummer in der Datenbank, aber ohne Retry würde die zweite
      // Anfrage einfach mit einem Fehler abbrechen -- das ist die "Race Condition" aus der
      // Anforderungsliste. Deshalb: bei ER_DUP_ENTRY auf ticket_number neu nummerieren.
      // Automatische Zuweisung an die für die Kategorie hinterlegte Gruppe (Systemeinstellungen
      // > Zuweisung im alten UI-Entwurf; auto_assign_group_id auf der Kategorie im Backend).
      const assignedGroupId = parsed.data.category
        ? (await app.db.selectFrom('categories').select('auto_assign_group_id').where('name', '=', parsed.data.category).executeTakeFirst())?.auto_assign_group_id ?? null
        : null;

      // "Ticket im Auftrag von" -- nur Admin/Superadmin dürfen ein Ticket im Namen einer anderen
      // Person anlegen; created_by_user_id/-username bleiben dann die Zielperson (Autor), die
      // tatsächlich handelnde Person wird separat in filed_by_user_id/-username vermerkt.
      let authorUserId = session.uid;
      let authorUsername = session.username;
      let filedByUserId: string | null = null;
      let filedByUsername: string | null = null;
      if (parsed.data.on_behalf_of_user_id) {
        const isAdmin = session.role === 'admin' || session.role === 'superadmin';
        if (!isAdmin) return reply.code(403).send({ error: 'forbidden' });
        const onBehalfUser = await app.db.selectFrom('users').select(['id', 'username'])
          .where('id', '=', parsed.data.on_behalf_of_user_id).executeTakeFirst();
        if (!onBehalfUser) return reply.code(400).send({ error: 'invalid_body' });
        authorUserId = onBehalfUser.id;
        authorUsername = onBehalfUser.username;
        filedByUserId = session.uid;
        filedByUsername = session.username;
      }

      // SLA-Frist serverseitig berechnen (vorher nur eine Client-Anzeige, nie eine echte,
      // serverseitig gesetzte Tatsache) -- aus den Systemeinstellungen (config.slaHoursByPriority/
      // businessHours), nicht aus dem Request.
      const settingsRowForSla = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
      const slaConfig = settingsRowForSla?.config_json ? JSON.parse(settingsRowForSla.config_json) : {};
      const slaDueAt = calculateSlaDueAt(new Date(), parsed.data.priority, slaConfig);

      const numberingSettingsRow = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
      const numberingConfig = numberingSettingsRow?.config_json ? JSON.parse(numberingSettingsRow.config_json) : {};

      const MAX_TICKET_NUMBER_RETRIES = 5;
      for (let attempt = 0; attempt < MAX_TICKET_NUMBER_RETRIES; attempt++) {
        // Höchste bisher vergebene laufende Nummer über alle Tickets hinweg (unabhängig vom
        // Format/Präfix) -- robust gegen nachträgliche Formatänderungen, da nur die Ziffern
        // ausgewertet werden, nicht die komplette formatierte Zeichenkette.
        const rows = await app.db.selectFrom('tickets').select('ticket_number').execute();
        const lastNum = rows.reduce((max, row) => {
          const digits = String(row.ticket_number || '').match(/(\d+)(?!.*\d)/);
          return Math.max(max, digits ? parseInt(digits[1]!, 10) : 0);
        }, 0);
        const ticketNumber = buildTicketNumber(lastNum + 1, parsed.data.category ?? null, numberingConfig);

        try {
          await app.db.insertInto('tickets').values({
            id: newId,
            ticket_number: ticketNumber,
            title: titleEnc,
            description: descriptionEnc,
            priority: parsed.data.priority,
            category: parsed.data.category ?? null,
            type: parsed.data.type,
            incident_notice: incidentNoticeEnc,
            created_by_user_id: authorUserId,
            created_by_username: authorUsername,
            filed_by_user_id: filedByUserId,
            filed_by_username: filedByUsername,
            assigned_group_id: assignedGroupId,
            status: 'Neu',
            sla_due_at: slaDueAt ? slaDueAt.toISOString() : null,
            installation_id: deps.env.INSTALLATION_ID,
            custom_fields_json: parsed.data.custom_fields ? JSON.stringify(parsed.data.custom_fields) : null
          }).execute();
          break;
        } catch (err: any) {
          const isDuplicateTicketNumber = err?.code === 'ER_DUP_ENTRY' && String(err?.message ?? '').includes('ticket_number');
          if (!isDuplicateTicketNumber || attempt === MAX_TICKET_NUMBER_RETRIES - 1) throw err;
        }
      }

      // Audit-Log
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(),
        ticket_id: newId,
        actor_user_id: session.uid,
        actor_username: session.username,
        action: filedByUserId ? 'created_on_behalf' : 'created',
        field: filedByUserId ? 'filed_by_username' : null,
        old_value: null,
        new_value: filedByUserId ? `Im Namen von: ${authorUsername}` : null
      }).execute();

      // Automatischer Genehmigungsworkflow: löst bei passender Priorität eine Genehmigungsanfrage
      // an die Vorgesetzte Person aus (sonst Ersatzperson aus den Systemeinstellungen, sonst
      // irgendeine Superadmin-Person) -- niemand genehmigt die eigene Anfrage.
      const isCreatorAdmin = session.role === 'admin' || session.role === 'superadmin';
      let approvalRequested = false;
      if (!isCreatorAdmin && !filedByUserId) {
        const settingsRow = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
        const config = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
        const wf = config.approvalWorkflow;
        if (wf?.enabled && (wf.priorities || []).includes(parsed.data.priority)) {
          const creator = await app.db.selectFrom('users').select('supervisor_user_id').where('id', '=', session.uid).executeTakeFirst();
          let approverId: string | null = creator?.supervisor_user_id ?? null;
          if (!approverId && wf.fallbackApproverUserId) approverId = wf.fallbackApproverUserId;
          if (!approverId) {
            const fallbackSuperadmin = await app.db.selectFrom('users').select('id')
              .where('role', '=', 'superadmin').where('id', '!=', session.uid).executeTakeFirst();
            approverId = fallbackSuperadmin?.id ?? null;
          }
          if (approverId && approverId !== session.uid) {
            const approver = await app.db.selectFrom('users').select(['id', 'username']).where('id', '=', approverId).executeTakeFirst();
            if (approver) {
              await app.db.updateTable('tickets').set({
                approval_status: 'pending', approval_requested_by: session.username, approval_reviewer_id: approver.id,
                updated_at: new Date().toISOString()
              }).where('id', '=', newId).execute();
              await app.db.insertInto('ticket_audit_log').values({
                id: randomUUID(), ticket_id: newId, actor_user_id: session.uid, actor_username: session.username,
                action: 'approval_requested', field: 'approval_status', old_value: null, new_value: `pending (Prüfer: ${approver.username})`
              }).execute();
              await createNotification(app, deps, {
                recipientUserId: approver.id, recipientUsername: approver.username, type: 'approvalRequested',
                ticketId: newId, ticketNumber: null,
                message: `${session.username} hat ein Ticket mit Priorität ${parsed.data.priority} angelegt – bitte genehmigen.`
              });
              approvalRequested = true;
            }
          }
        }
      }

      const ticketRow = await app.db.selectFrom('tickets').selectAll().where('id', '=', newId).executeTakeFirstOrThrow();

      // Zuständige Personen benachrichtigen: Mitglieder der zugewiesenen Gruppe, sonst alle
      // Admin/Superadmin-Konten -- außer wenn die erstellende Person selbst admin ist oder das
      // Ticket erst noch eine Genehmigung braucht.
      if (!isCreatorAdmin && !approvalRequested) {
        const recipients = assignedGroupId
          ? await app.db.selectFrom('users').select(['id', 'username']).where('department_group_id', '=', assignedGroupId).execute()
          : await app.db.selectFrom('users').select(['id', 'username']).where('role', 'in', ['admin', 'superadmin']).execute();
        for (const r of recipients) {
          await createNotification(app, deps, {
            recipientUserId: r.id,
            recipientUsername: r.username,
            type: 'newTicket',
            ticketId: newId,
            ticketNumber: ticketRow.ticket_number,
            message: `Neues Ticket von ${session.username} erstellt.`
          });
        }
      }

      return reply.code(201).send({ ticket: decryptTicketRow(ticketRow, deks, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/:id - Ein Ticket lesen (IDOR-Schutz)
  app.get('/api/v2/tickets/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });

      // IDOR: User darf nur eigene Tickets lesen
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const deks = await loadTicketDeks(app, deps.keyProvider);
      const authorRow = ticket.created_by_user_id
        ? await app.db.selectFrom('users').select('account_archived').where('id', '=', ticket.created_by_user_id).executeTakeFirst()
        : undefined;
      return reply.send({ ticket: { ...decryptTicketRow(ticket, deks, deps), author_archived: authorRow?.account_archived ?? false } });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/tickets/:id - Ticket aktualisieren (nur Admin)
  app.patch('/api/v2/tickets/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = updateTicketSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const ticket = await app.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const auditChanges: Array<{ field: string; old: unknown; new: unknown }> = [];

      // title/description sind verschlüsselt (Buffer in der DB) -- getrennt behandeln, damit
      // weder Klartext ins Audit-Log gerät noch versehentlich ein String in die Buffer-Spalte
      // geschrieben wird. Verschlüsselte Felder loggen nur "geändert", nicht den Inhalt.
      let deks: TicketDeks | undefined;
      if (parsed.data.title !== undefined) {
        deks = await loadTicketDeks(app, deps.keyProvider);
        const oldTitle = decryptTicketField(ticket.title, deks.title, deps, id, 'title');
        if (oldTitle !== parsed.data.title) {
          updates.title = encryptTicketField(parsed.data.title, deks.title, deps, id, 'title');
          auditChanges.push({ field: 'title', old: '(geändert)', new: '(geändert)' });
        }
      }
      if (parsed.data.description !== undefined) {
        deks = deks ?? await loadTicketDeks(app, deps.keyProvider);
        const oldDescription = decryptTicketField(ticket.description, deks.description, deps, id, 'description');
        if (oldDescription !== parsed.data.description) {
          updates.description = encryptTicketField(parsed.data.description, deks.description, deps, id, 'description');
          auditChanges.push({ field: 'description', old: '(geändert)', new: '(geändert)' });
        }
      }
      if (parsed.data.incident_notice !== undefined) {
        deks = deks ?? await loadTicketDeks(app, deps.keyProvider);
        updates.incident_notice = parsed.data.incident_notice === null
          ? null
          : encryptTicketField(parsed.data.incident_notice, deks.incidentNotice, deps, id, 'incident_notice');
        auditChanges.push({ field: 'incident_notice', old: '(geändert)', new: '(geändert)' });
      }
      // archived ist kein eigenes Spaltenfeld -- bildet auf archived_at (Timestamp/NULL) ab.
      if (parsed.data.archived !== undefined) {
        const wasArchived = ticket.archived_at !== null;
        if (parsed.data.archived !== wasArchived) {
          updates.archived_at = parsed.data.archived ? new Date().toISOString() : null;
          auditChanges.push({ field: 'archived', old: wasArchived, new: parsed.data.archived });
        }
      }

      for (const [key, value] of Object.entries(parsed.data)) {
        if (key === 'title' || key === 'description' || key === 'incident_notice' || key === 'archived' || key === 'waiting_message') continue;
        if (value !== undefined) {
          const oldValue = (ticket as any)[key];
          if (oldValue !== value) {
            updates[key] = value;
            auditChanges.push({ field: key, old: oldValue, new: value });
          }
        }
      }

      // Status-Spezial: closed_at setzen
      if (parsed.data.status === 'Geschlossen' && ticket.status !== 'Geschlossen') {
        updates.closed_at = new Date().toISOString();
      }

      // "Warten auf Benutzer"/-"...": Start-Zeitpunkt und Hinweistext für die Erinnerung/das
      // automatische Schließen durch jobs/maintenance.ts (runWaitingTickets). Nur beim
      // tatsächlichen Statuswechsel berührt, nicht bei jedem PATCH.
      if (parsed.data.status !== undefined && parsed.data.status !== ticket.status) {
        const wasWaiting = ticket.status.startsWith('Warten auf');
        const isWaitingNow = parsed.data.status.startsWith('Warten auf');
        if (!wasWaiting && isWaitingNow) {
          updates.waiting_since = new Date().toISOString();
          updates.waiting_message = parsed.data.waiting_message ?? null;
          updates.waiting_reminder_sent = false;
        } else if (wasWaiting && !isWaitingNow) {
          updates.waiting_since = null;
          updates.waiting_message = null;
          updates.waiting_reminder_sent = false;
        }
      }

      if (Object.keys(updates).length > 1) {
        await app.db.updateTable('tickets').set(updates).where('id', '=', id).execute();

        // Alle Änderungen im Audit-Log festhalten
        for (const change of auditChanges) {
          await app.db.insertInto('ticket_audit_log').values({
            id: randomUUID(),
            ticket_id: id,
            actor_user_id: session.uid,
            actor_username: session.username,
            action: 'updated',
            field: change.field,
            old_value: change.old != null ? String(change.old) : null,
            new_value: change.new != null ? String(change.new) : null
          }).execute();
        }

        // Statusänderung dem Ersteller melden (sofern nicht er selbst der Akteur ist).
        if (parsed.data.status !== undefined && ticket.created_by_user_id && ticket.created_by_user_id !== session.uid) {
          await createNotification(app, deps, {
            recipientUserId: ticket.created_by_user_id,
            recipientUsername: ticket.created_by_username,
            type: 'statusChange',
            ticketId: id,
            ticketNumber: ticket.ticket_number,
            message: `Status von Ticket ${ticket.ticket_number} geändert zu "${parsed.data.status}"`
          });
        }
      }

      const updated = await app.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      deks = deks ?? await loadTicketDeks(app, deps.keyProvider);
      return reply.send({ ticket: decryptTicketRow(updated, deks, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // Archivieren/Reaktivieren laeuft ueber PATCH /api/v2/tickets/:id { archived: true|false }
  // (bildet auf archived_at ab, siehe oben) -- deckt beide Richtungen in einem Pfad ab, statt
  // eines eigenen, nur einseitig archivierenden /archive-Endpunkts.

  // --- Chat-Nachrichten ---

  // GET /api/v2/tickets/:id/messages
  app.get('/api/v2/tickets/:id/messages', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };

      // IDOR-Schutz: Ticket-Zugehörigkeit prüfen
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('ticket_messages')
        .selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      const msgDeks = await loadMessageDeks(app, deps.keyProvider);
      const messages = rows.map(row => decryptMessage(row, msgDeks, deps));
      return reply.send({ messages });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets/:id/messages
  app.post('/api/v2/tickets/:id/messages', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      // IDOR-Schutz
      const ticket = await app.db.selectFrom('tickets')
        .select(['id', 'ticket_number', 'created_by_user_id', 'created_by_username', 'assigned_to_user_id', 'assigned_to_username'])
        .where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const msgId = randomUUID();
      const msgDeks = await loadMessageDeks(app, deps.keyProvider);
      const encrypted = encryptMessage(deps, msgDeks, msgId, parsed.data.content, parsed.data.content_html ?? null);
      await app.db.insertInto('ticket_messages').values({
        id: msgId,
        ticket_id: id,
        sender_user_id: session.uid,
        sender_username: session.username,
        sender_name: session.username, // wird im Frontend mit echtem Namen aufgelöst
        sender_role: session.role,
        content: encrypted.content,
        content_html: encrypted.content_html,
        has_attachments: false
      }).execute();

      // Ticket updated_at setzen
      await app.db.updateTable('tickets').set({ updated_at: new Date().toISOString() }).where('id', '=', id).execute();

      // Benachrichtigung an die jeweils andere Seite (Ersteller <-> zuständige Person).
      if (isAdmin && ticket.created_by_user_id && ticket.created_by_user_id !== session.uid) {
        await createNotification(app, deps, {
          recipientUserId: ticket.created_by_user_id,
          recipientUsername: ticket.created_by_username,
          type: 'newMessage',
          ticketId: id,
          ticketNumber: ticket.ticket_number,
          message: `Neue Nachricht zu Ticket ${ticket.ticket_number}`
        });
      } else if (!isAdmin && ticket.assigned_to_user_id && ticket.assigned_to_username) {
        await createNotification(app, deps, {
          recipientUserId: ticket.assigned_to_user_id,
          recipientUsername: ticket.assigned_to_username,
          type: 'newMessage',
          ticketId: id,
          ticketNumber: ticket.ticket_number,
          message: `Neue Nachricht zu Ticket ${ticket.ticket_number}`
        });
      }

      const msgRow = await app.db.selectFrom('ticket_messages').selectAll().where('id', '=', msgId).executeTakeFirstOrThrow();
      return reply.code(201).send({ message: decryptMessage(msgRow, msgDeks, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/tickets/:id/messages/:messageId - nur die absendende Person darf ihre eigene
  // Nachricht bearbeiten (kein Admin-Override -- Chat-Integrität gegenüber der anfragenden Person).
  app.patch('/api/v2/tickets/:id/messages/:messageId', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { messageId } = req.params as { id: string; messageId: string };
      const parsed = z.object({ content: z.string().trim().min(1).max(50000) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const existing = await app.db.selectFrom('ticket_messages').select(['id', 'sender_user_id']).where('id', '=', messageId).executeTakeFirst();
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      if (existing.sender_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const msgDeks = await loadMessageDeks(app, deps.keyProvider);
      const ctxBase = {
        installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'ticket_messages', recordId: messageId
      };
      await app.db.updateTable('ticket_messages')
        .set({ content: fieldCipher.encryptField(parsed.data.content, msgDeks.content.rawDek, { ...ctxBase, fieldName: 'content', keyVersion: msgDeks.content.keyVersion }) })
        .where('id', '=', messageId)
        .execute();

      const msgRow = await app.db.selectFrom('ticket_messages').selectAll().where('id', '=', messageId).executeTakeFirstOrThrow();
      return reply.send({ message: decryptMessage(msgRow, msgDeks, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Interne Notizen (nur Admin) ---

  // GET /api/v2/tickets/:id/notes
  app.get('/api/v2/tickets/:id/notes', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      const rows = await app.db.selectFrom('ticket_notes')
        .selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      const noteDek = await loadNoteDek(app, deps.keyProvider);
      const notes = rows.map(row => decryptNote(row, noteDek, deps));
      return reply.send({ notes });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets/:id/notes
  app.post('/api/v2/tickets/:id/notes', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = addNoteSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const noteId = randomUUID();
      const noteDek = await loadNoteDek(app, deps.keyProvider);
      await app.db.insertInto('ticket_notes').values({
        id: noteId,
        ticket_id: id,
        author_user_id: session.uid,
        author_username: session.username,
        author_name: session.username,
        stream: parsed.data.stream,
        note_type: parsed.data.note_type,
        content: encryptNote(deps, noteDek, noteId, parsed.data.content),
        is_pinned: parsed.data.is_pinned,
        is_resolution: parsed.data.is_resolution,
        has_attachments: false
      }).execute();

      const noteRow = await app.db.selectFrom('ticket_notes').selectAll().where('id', '=', noteId).executeTakeFirstOrThrow();
      return reply.code(201).send({ note: decryptNote(noteRow, noteDek, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/tickets/:id/notes/:noteId - nur Admin
  app.patch('/api/v2/tickets/:id/notes/:noteId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { noteId } = req.params as { id: string; noteId: string };
      const parsed = addNoteSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const noteDek = await loadNoteDek(app, deps.keyProvider);
      const updates: Record<string, unknown> = {};
      if (parsed.data.content !== undefined) updates.content = encryptNote(deps, noteDek, noteId, parsed.data.content);
      if (parsed.data.note_type !== undefined) updates.note_type = parsed.data.note_type;
      if (parsed.data.is_pinned !== undefined) updates.is_pinned = parsed.data.is_pinned;
      if (parsed.data.is_resolution !== undefined) updates.is_resolution = parsed.data.is_resolution;

      if (Object.keys(updates).length > 0) {
        await app.db.updateTable('ticket_notes').set(updates).where('id', '=', noteId).execute();
      }
      const noteRow = await app.db.selectFrom('ticket_notes').selectAll().where('id', '=', noteId).executeTakeFirstOrThrow();
      return reply.send({ note: decryptNote(noteRow, noteDek, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Audit-Log ---
  // GET /api/v2/tickets/:id/attachments - Liste der Anhänge eines Tickets (nur Metadaten,
  // ohne data_b64 -- der eigentliche Inhalt wird erst bei Bedarf über GET /api/v2/attachments/:id
  // geladen, siehe extras.ts). Nur reine Ticket-Anhänge (message_id/note_id sind null); Chat-/
  // Notiz-Anhänge sind in der Oberfläche noch nicht angebunden.
  app.get('/api/v2/tickets/:id/attachments', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('attachments')
        .select(['id', 'filename', 'mime_type', 'size_bytes', 'uploaded_by_username', 'created_at'])
        .where('ticket_id', '=', id).where('message_id', 'is', null).where('note_id', 'is', null)
        .orderBy('created_at', 'asc').execute();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
      const attachments = rows.map(row => ({
        ...row,
        filename: fieldCipher.decryptField(row.filename, filenameDek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'attachments', recordId: row.id, fieldName: 'filename', keyVersion: filenameDek.keyVersion
        })
      }));
      return reply.send({ attachments });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/:id/audit-log (nur Admin)
  app.get('/api/v2/tickets/:id/audit-log', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      const log = await app.db.selectFrom('ticket_audit_log')
        .selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      return reply.send({ log });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Großstörungen ---
  // Ein Großstörungs-Ticket ist ein normales Ticket mit type='incident' (siehe createTicketSchema).

  // GET /api/v2/incidents/active - aktive Großstörungen (für Banner, alle angemeldeten Personen)
  app.get('/api/v2/incidents/active', async (req, reply) => {
    try {
      requireSession(req);
      const rows = await app.db.selectFrom('tickets')
        .select(['id', 'ticket_number', 'title'])
        .where('type', '=', 'incident')
        .where('archived_at', 'is', null)
        .where('status', '!=', 'Geschlossen')
        .execute();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const incidents = rows.map(row => ({ ...row, title: decryptTicketField(row.title, deks.title, deps, row.id, 'title') }));
      return reply.send({ incidents });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets/:id/link-incident - Ticket einer Großstörung zuordnen (Admin, oder die
  // Person selbst beim/direkt nach Erstellen ihres eigenen Tickets -- reduziert doppelte Tickets
  // während einer Störung, ohne dass ein Admin erst eingreifen muss).
  app.post('/api/v2/tickets/:id/link-incident', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const parsed = linkIncidentSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const ticket = await app.db.selectFrom('tickets').select('created_by_user_id').where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const incident = await app.db.selectFrom('tickets').select(['id', 'type']).where('id', '=', parsed.data.incident_id).executeTakeFirst();
      if (!incident || incident.type !== 'incident') return reply.code(400).send({ error: 'not_an_incident' });

      await app.db.updateTable('tickets').set({ incident_id: parsed.data.incident_id, updated_at: new Date().toISOString() }).where('id', '=', id).execute();
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'linked_incident', field: 'incident_id', old_value: null, new_value: parsed.data.incident_id
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Genehmigungen ---

  // POST /api/v2/tickets/:id/request-approval (nur Admin)
  app.post('/api/v2/tickets/:id/request-approval', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = requestApprovalSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const approver = await app.db.selectFrom('users').select(['username']).where('id', '=', parsed.data.approver_user_id).executeTakeFirst();
      if (!approver) return reply.code(400).send({ error: 'invalid_body' });

      await app.db.updateTable('tickets').set({
        approval_status: 'pending',
        approval_requested_by: session.username,
        approval_reviewer_id: parsed.data.approver_user_id,
        approval_text: parsed.data.text ?? null,
        updated_at: new Date().toISOString()
      }).where('id', '=', id).execute();

      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'approval_requested', field: 'approval_status', old_value: null,
        new_value: `pending (Prüfer: ${approver.username}${parsed.data.text ? `, Grund: ${parsed.data.text}` : ''})`
      }).execute();

      const ticketRow = await app.db.selectFrom('tickets').select(['ticket_number']).where('id', '=', id).executeTakeFirst();
      await createNotification(app, deps, {
        recipientUserId: parsed.data.approver_user_id,
        recipientUsername: approver.username,
        type: 'approvalRequested',
        ticketId: id,
        ticketNumber: ticketRow?.ticket_number ?? null,
        message: `${session.username} bittet dich um eine Genehmigung für Ticket ${ticketRow?.ticket_number ?? ''}${parsed.data.text ? ': ' + parsed.data.text : ''}`
      });
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets/:id/approval-decision - nur die als Prüfer eingetragene Person
  // (oder Admin/Superadmin als Vertretung) darf entscheiden -- IDOR-Schutz auf Genehmiger-Ebene.
  app.post('/api/v2/tickets/:id/approval-decision', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = decideApprovalSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const ticket = await app.db.selectFrom('tickets')
        .select(['approval_reviewer_id', 'approval_status', 'approval_requested_by', 'ticket_number', 'created_by_user_id'])
        .where('id', '=', id).executeTakeFirst();
      if (!ticket || ticket.approval_status !== 'pending') return reply.code(409).send({ error: 'no_pending_approval' });
      if (session.role !== 'superadmin' && ticket.approval_reviewer_id !== session.uid) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      await app.db.updateTable('tickets').set({
        approval_status: parsed.data.decision,
        approval_text: parsed.data.reason ?? null,
        updated_at: new Date().toISOString()
      }).where('id', '=', id).execute();

      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'approval_decided', field: 'approval_status', old_value: 'pending',
        new_value: parsed.data.reason ? `${parsed.data.decision}: ${parsed.data.reason}` : parsed.data.decision
      }).execute();

      if (ticket.approval_requested_by) {
        await createNotification(app, deps, {
          recipientUserId: ticket.created_by_user_id,
          recipientUsername: ticket.approval_requested_by,
          type: 'approvalDecided',
          ticketId: id,
          ticketNumber: ticket.ticket_number,
          message: `Genehmigung für Ticket ${ticket.ticket_number} ${parsed.data.decision === 'approved' ? 'erteilt' : 'abgelehnt'}`
        });
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Zeiterfassung ---

  app.get('/api/v2/tickets/:id/time-entries', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const entries = await app.db.selectFrom('ticket_time_entries').selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      return reply.send({ entries });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/tickets/:id/time-entries', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = addTimeEntrySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const entryId = randomUUID();
      await app.db.insertInto('ticket_time_entries').values({
        id: entryId,
        ticket_id: id,
        user_id: session.uid,
        username: session.username,
        minutes: parsed.data.minutes,
        note: parsed.data.note ?? null
      }).execute();
      return reply.code(201).send({ id: entryId });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/tickets/:id/time-entries/:entryId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { entryId } = req.params as { id: string; entryId: string };
      await app.db.deleteFrom('ticket_time_entries').where('id', '=', entryId).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Teilaufgaben (Todos) ---

  async function loadTodoDek() {
    return ensureDek(app.db, deps.keyProvider, 'ticket_todos.content');
  }
  function todoCtx(recordId: string, keyVersion: number) {
    return {
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'ticket_todos',
      recordId,
      fieldName: 'content',
      keyVersion
    };
  }

  app.get('/api/v2/tickets/:id/todos', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('ticket_todos').selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      const dek = await loadTodoDek();
      const todos = rows.map(row => ({ ...row, content: fieldCipher.decryptField(row.content, dek.rawDek, todoCtx(row.id, dek.keyVersion)) }));
      return reply.send({ todos });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/tickets/:id/todos', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = createTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const todoId = randomUUID();
      const dek = await loadTodoDek();
      await app.db.insertInto('ticket_todos').values({
        id: todoId,
        ticket_id: id,
        content: fieldCipher.encryptField(parsed.data.content, dek.rawDek, todoCtx(todoId, dek.keyVersion)),
        assignee_user_id: parsed.data.assignee_user_id ?? null,
        assignee_username: parsed.data.assignee_username ?? null,
        done: false,
        created_by_user_id: session.uid
      }).execute();
      return reply.code(201).send({ id: todoId });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH: Admins dürfen alles ändern; die zugewiesene Person darf nur "done" umschalten.
  app.patch('/api/v2/tickets/:id/todos/:todoId', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { todoId } = req.params as { id: string; todoId: string };
      const parsed = updateTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const todo = await app.db.selectFrom('ticket_todos').select(['id', 'assignee_user_id']).where('id', '=', todoId).executeTakeFirst();
      if (!todo) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && todo.assignee_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const updates: Record<string, unknown> = {};
      if (isAdmin && parsed.data.content !== undefined) {
        const dek = await loadTodoDek();
        updates.content = fieldCipher.encryptField(parsed.data.content, dek.rawDek, todoCtx(todoId, dek.keyVersion));
      }
      if (isAdmin && parsed.data.assignee_user_id !== undefined) updates.assignee_user_id = parsed.data.assignee_user_id;
      if (isAdmin && parsed.data.assignee_username !== undefined) updates.assignee_username = parsed.data.assignee_username;
      if (parsed.data.done !== undefined) updates.done = parsed.data.done;

      if (Object.keys(updates).length > 0) {
        await app.db.updateTable('ticket_todos').set(updates).where('id', '=', todoId).execute();
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/tickets/:id/todos/:todoId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { todoId } = req.params as { id: string; todoId: string };
      await app.db.deleteFrom('ticket_todos').where('id', '=', todoId).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Mehrfach-Beteiligte ---
  // Eine zusätzliche Person kann an einem Ticket "beteiligt" sein, ohne die eine zuständige
  // Person (assigned_to_user_id) zu ersetzen -- z.B. zur Information oder Mitarbeit.

  app.get('/api/v2/tickets/:id/participants', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('ticket_participants').selectAll().where('ticket_id', '=', id).orderBy('created_at', 'asc').execute();
      return reply.send({ participants: rows });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const setParticipantsSchema = z.object({ user_ids: z.array(z.string().min(1)).max(100) });

  // PUT statt einzelner POST/DELETE, weil das Admin-UI immer die komplette neue Auswahl aus
  // einem Mehrfach-Auswahlfeld überträgt (nur Admin).
  app.put('/api/v2/tickets/:id/participants', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = setParticipantsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const ticket = await app.db.selectFrom('tickets').select('id').where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });

      const users = parsed.data.user_ids.length
        ? await app.db.selectFrom('users').select(['id', 'username']).where('id', 'in', parsed.data.user_ids).execute()
        : [];

      await app.db.deleteFrom('ticket_participants').where('ticket_id', '=', id).execute();
      if (users.length) {
        await app.db.insertInto('ticket_participants').values(
          users.map(u => ({ id: randomUUID(), ticket_id: id, user_id: u.id, username: u.username }))
        ).execute();
      }
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'participants_updated', field: 'participants', old_value: null,
        new_value: users.map(u => u.username).join(', ') || null
      }).execute();
      return reply.send({ success: true, participants: users });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Verwandte Tickets ---
  // Symmetrisch: eine Verknüpfung wird als zwei Zeilen (A->B und B->A) gespeichert, siehe
  // Migration 0020.

  app.get('/api/v2/tickets/:id/related', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('ticket_relations').select('related_ticket_id').where('ticket_id', '=', id).execute();
      return reply.send({ relatedTicketIds: rows.map(r => r.related_ticket_id) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const relatedTicketSchema = z.object({ related_ticket_id: z.string().min(1) });

  app.post('/api/v2/tickets/:id/related', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = relatedTicketSchema.safeParse(req.body);
      if (!parsed.success || parsed.data.related_ticket_id === id) return reply.code(400).send({ error: 'invalid_body' });

      const other = await app.db.selectFrom('tickets').select('id').where('id', '=', parsed.data.related_ticket_id).executeTakeFirst();
      if (!other) return reply.code(404).send({ error: 'not_found' });

      await app.db.insertInto('ticket_relations').values({ id: randomUUID(), ticket_id: id, related_ticket_id: other.id })
        .onDuplicateKeyUpdate({ ticket_id: id }).execute();
      await app.db.insertInto('ticket_relations').values({ id: randomUUID(), ticket_id: other.id, related_ticket_id: id })
        .onDuplicateKeyUpdate({ ticket_id: other.id }).execute();
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'related_linked', field: 'related_ticket_id', old_value: null, new_value: other.id
      }).execute();
      return reply.code(201).send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/tickets/:id/related/:relatedId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id, relatedId } = req.params as { id: string; relatedId: string };
      await app.db.deleteFrom('ticket_relations').where('ticket_id', '=', id).where('related_ticket_id', '=', relatedId).execute();
      await app.db.deleteFrom('ticket_relations').where('ticket_id', '=', relatedId).where('related_ticket_id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Zusammenführen ---
  // Verschiebt Nachrichten/Notizen/Teilaufgaben/Zeiten/Anhänge/Beteiligte per Fremdschlüssel-
  // Update auf das Zielticket (kein Entschlüsseln/Neu-Verschlüsseln nötig, Inhalte bleiben
  // unverändert), archiviert das Ursprungsticket und vermerkt merged_into_ticket_id.
  const mergeTicketSchema = z.object({ target_ticket_id: z.string().min(1) });

  app.post('/api/v2/tickets/:id/merge', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = mergeTicketSchema.safeParse(req.body);
      if (!parsed.success || parsed.data.target_ticket_id === id) return reply.code(400).send({ error: 'invalid_body' });

      const [source, target] = await Promise.all([
        app.db.selectFrom('tickets').select(['id', 'ticket_number']).where('id', '=', id).executeTakeFirst(),
        app.db.selectFrom('tickets').select(['id', 'ticket_number']).where('id', '=', parsed.data.target_ticket_id).executeTakeFirst()
      ]);
      if (!source || !target) return reply.code(404).send({ error: 'not_found' });

      await app.db.updateTable('ticket_messages').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
      await app.db.updateTable('ticket_notes').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
      await app.db.updateTable('ticket_todos').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
      await app.db.updateTable('ticket_time_entries').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
      await app.db.updateTable('attachments').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
      // Beteiligte: direktes Umhängen könnte den Unique-Index (ticket_id, user_id) verletzen,
      // falls dieselbe Person bei beiden Tickets beteiligt ist -- deshalb per IGNORE kopieren statt verschieben.
      const sourceParticipants = await app.db.selectFrom('ticket_participants').select(['user_id', 'username']).where('ticket_id', '=', source.id).execute();
      if (sourceParticipants.length) {
        await app.db.insertInto('ticket_participants')
          .values(sourceParticipants.map(p => ({ id: randomUUID(), ticket_id: target.id, user_id: p.user_id, username: p.username })))
          .onDuplicateKeyUpdate({ ticket_id: target.id })
          .execute();
      }
      await app.db.deleteFrom('ticket_participants').where('ticket_id', '=', source.id).execute();

      await app.db.updateTable('tickets').set({
        archived_at: new Date().toISOString(), merged_into_ticket_id: target.id, updated_at: new Date().toISOString()
      }).where('id', '=', source.id).execute();
      await app.db.updateTable('tickets').set({ updated_at: new Date().toISOString() }).where('id', '=', target.id).execute();

      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: source.id, actor_user_id: session.uid, actor_username: session.username,
        action: 'merged_into', field: 'merged_into_ticket_id', old_value: null, new_value: target.id
      }).execute();
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: target.id, actor_user_id: session.uid, actor_username: session.username,
        action: 'merged_from', field: 'merged_into_ticket_id', old_value: null, new_value: source.id
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
