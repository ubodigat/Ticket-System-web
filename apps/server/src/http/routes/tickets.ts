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
import { fieldCipher, blindIndexCandidates } from '../../crypto/fieldCrypto.js';
import { routeError } from './routeError.js';
import { createNotification } from './extras.js';
import { calculateSlaDueAt } from '../../domain/sla.js';
import { loadModules, maskTicketModules, modulesFromConfig, requireModule } from '../../domain/modules.js';
import { groupWithDescendants } from '../../domain/groups.js';
import { canAccessTicket, loadTicketScope, recipientsWithAccess, scopeAllowsTicket } from '../../domain/ticketAccess.js';
import { approverCandidates } from '../../domain/approvalRouting.js';
import { isValidTicketStatus } from '../../domain/status.js';
import { buildTicketNumber } from '../../domain/ticketNumber.js';
import { priorityFromImpact } from '../../domain/categoryFaq.js';
import { mysqlTimestamp } from '../../db/date.js';
import { hasPermission } from '../../domain/adminPermissions.js';
import { sanitizeServerHtml } from '../../domain/sanitizer.js';
import { manualTimeEntryPeriod } from '../../domain/timeEntryPeriod.js';
import { loadOutlookSettings, getGraphAccessToken, createCalendarEvent } from '../../domain/graphClient.js';

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
  // Security-Audit N10: approval_text/waiting_message sind jetzt ebenfalls verschlüsselt.
  approvalText: ResolvedDek;
  waitingMessage: ResolvedDek;
  // Security-Audit N10-Rest: die tatsächlichen Freitext-/Auswahlwerte der Admin-definierten
  // Zusatzfelder (nicht deren Definition -- die liegt in categories.custom_fields_json).
  customFields: ResolvedDek;
}

async function loadTicketDeks(app: FastifyInstance, keyProvider: KeyProvider): Promise<TicketDeks> {
  const [title, description, incidentNotice, approvalText, waitingMessage, customFields] = await Promise.all([
    ensureDek(app.db, keyProvider, 'tickets.title'),
    ensureDek(app.db, keyProvider, 'tickets.description'),
    ensureDek(app.db, keyProvider, 'tickets.incident_notice'),
    ensureDek(app.db, keyProvider, 'tickets.approval_text'),
    ensureDek(app.db, keyProvider, 'tickets.waiting_message'),
    ensureDek(app.db, keyProvider, 'tickets.custom_fields_json')
  ]);
  return { title, description, incidentNotice, approvalText, waitingMessage, customFields };
}

function encryptTicketField(
  value: string,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string,
  fieldName: string
): Buffer {
  return fieldCipher.encryptField(value, dek, {
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'tickets',
    recordId,
    fieldName
  });
}

// Security-Audit R-2: NUR für approval_text/waiting_message (per Migration 0034 nachträglich auf
// verschlüsselt umgestellt, siehe db/reencryptLegacy.ts) -- title/description/incident_notice
// waren von Anfang an verschlüsselt, ein Entschlüsselungsfehler dort bleibt bewusst ein echter
// Fehler (Hinweis auf Manipulation/Korruption), statt ihn als "war wohl Klartext" zu kaschieren.
function decryptTicketFieldTolerant(
  stored: Buffer,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string,
  fieldName: string
): string {
  return fieldCipher.decryptField(stored, dek, {
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'tickets',
    recordId,
    fieldName
  });
}

function decryptTicketField(
  stored: Buffer,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string,
  fieldName: string
): string {
  return fieldCipher.decryptField(stored, dek, {
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'tickets',
    recordId,
    fieldName
  });
}

function decryptTicketRow<T extends {
  id: string; title: Buffer; description?: Buffer; incident_notice?: Buffer | null;
  approval_text?: Buffer | null; waiting_message?: Buffer | null; custom_fields_json?: Buffer | null;
}>(
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
  if (row.approval_text) {
    out.approval_text = decryptTicketFieldTolerant(row.approval_text, deks.approvalText, deps, row.id, 'approval_text');
  }
  if (row.waiting_message) {
    out.waiting_message = decryptTicketFieldTolerant(row.waiting_message, deks.waitingMessage, deps, row.id, 'waiting_message');
  }
  if (row.custom_fields_json !== undefined) {
    out.custom_fields_json = decryptCustomFieldsJson(row.custom_fields_json, deks.customFields, deps, row.id);
  }
  return out;
}

// Security-Audit N10-Rest: tolerant, weil bestehende Tickets aus der Zeit vor Migration 0040
// erst durch db/reencryptLegacy.ts nachverschluesselt werden (R-2-Timing). Das JSON selbst wird
// komplett als ein Feld verschluesselt/entschluesselt, nicht Wert fuer Wert.
function decryptCustomFieldsJson(
  stored: Buffer | null,
  dek: ResolvedDek,
  deps: TicketsRouteDeps,
  recordId: string
): string | null {
  if (!stored) return null;
  return fieldCipher.decryptField(stored, dek, {
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'tickets',
    recordId,
    fieldName: 'custom_fields_json'
  });
}

const createTicketSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(50000),
  priority: z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch']).default('Normal'),
  category: z.string().trim().max(128).optional(),
  // "Wer ist betroffen?" / "Wie dringend ist es?" (1..3); beide zusammen bestimmen die Prioritaet.
  impact: z.number().int().min(1).max(3).optional(),
  urgency: z.number().int().min(1).max(3).optional(),
  type: z.enum(['ticket', 'incident']).default('ticket'),
  incident_notice: z.string().trim().max(2000).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  on_behalf_of_user_id: z.string().optional()
});

const updateTicketSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(50000).optional(),
  status: z.string().trim().min(1).max(64).refine(isValidTicketStatus, 'invalid_status').optional(),
  // Security-Audit N12: PATCH erlaubte bisher jeden beliebigen String (bis 32 Zeichen) statt nur
  // der vier gültigen Stufen -- ein falscher Wert würde lautlos aus der SLA-Berechnung
  // (slaHoursByPriority ist nach genau diesen vier Werten indiziert) herausfallen.
  priority: z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch']).optional(),
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
  content: z.string().trim().max(50000),
  content_html: z.string().max(200000).optional(),
  // Anhaenge werden direkt danach mit message_id hochgeladen (POST /api/v2/attachments bzw. /uploads).
  has_attachments: z.boolean().optional()
}).refine(value => value.content.length > 0 || value.has_attachments === true);

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
  note: z.string().trim().max(512).optional(),
  started_at: z.string().datetime().optional()
}).strict();

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
    tableName: 'ticket_messages',
    recordId
  };
  const sanitizedHtml = contentHtml !== null ? sanitizeServerHtml(contentHtml) : null;
  return {
    content: fieldCipher.encryptField(content, deks.content, { ...ctxBase, fieldName: 'content' }),
    content_html: sanitizedHtml !== null && sanitizedHtml.length > 0
      ? fieldCipher.encryptField(sanitizedHtml, deks.contentHtml, { ...ctxBase, fieldName: 'content_html' })
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
    tableName: 'ticket_messages',
    recordId: row.id
  };
  return {
    ...row,
    content: fieldCipher.decryptField(row.content, deks.content, { ...ctxBase, fieldName: 'content' }),
    content_html: row.content_html
      ? fieldCipher.decryptField(row.content_html, deks.contentHtml, { ...ctxBase, fieldName: 'content_html' })
      : null
  };
}

async function loadNoteDek(app: FastifyInstance, keyProvider: KeyProvider): Promise<ResolvedDek> {
  return ensureDek(app.db, keyProvider, 'ticket_notes.content');
}

function encryptNote(deps: TicketsRouteDeps, dek: ResolvedDek, recordId: string, content: string): Buffer {
  return fieldCipher.encryptField(content, dek, {
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'ticket_notes',
    recordId,
    fieldName: 'content'
  });
}

function decryptNote<T extends { id: string; content: Buffer }>(row: T, dek: ResolvedDek, deps: TicketsRouteDeps) {
  return {
    ...row,
    content: fieldCipher.decryptField(row.content, dek, {
      installationId: deps.env.INSTALLATION_ID,
      tableName: 'ticket_notes',
      recordId: row.id,
      fieldName: 'content'
    })
  };
}

export function registerTicketsV2Routes(app: FastifyInstance, deps: TicketsRouteDeps): void {
  async function hasAdminPermission(session: { uid: string; role: string }, key: 'approvals' | 'reports'): Promise<boolean> {
    return hasPermission(app.db, session, key);
  }

  // GET /api/v2/tickets - Alle Tickets (RBAC: Admins sehen alle, Users nur eigene)
  // Empfaenger fuer Ticket-Ereignisse: nur aktive Admin-/Superadmin-Konten. Normale Konten derselben
  // Abteilung/Gruppe duerfen von fremden Tickets nichts erfahren. Hat die Gruppe keine Admins, gehen
  // Hinweise an alle Admins, damit nichts unbemerkt bleibt.
  async function staffRecipients(groupId: string | null): Promise<string[]> {
    const base = () => app.db.selectFrom('users').select('id').where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false);
    if (groupId) {
      // Untergruppen gehoeren dazu: ein Ticket an "IT" erreicht auch "IT > Netzwerk".
      const groups = await app.db.selectFrom('groups').select(['id', 'parent_id']).execute();
      const members = await base().where('id', 'in', eb => eb.selectFrom('user_groups').select('user_id')
        .where('group_id', 'in', groupWithDescendants(groupId, groups))).execute();
      if (members.length) return members.map(r => r.id);
    }
    return (await base().execute()).map(r => r.id);
  }
  // Security-Audit R-28: nur Beteiligte, die das Ticket auch lesen duerfen (aktive Admin-Konten) --
  // sonst erhielten normale Konten Statuswechsel und Wartenachrichten fremder Tickets.
  async function participantIds(ticketId: string): Promise<string[]> {
    return (await app.db.selectFrom('ticket_participants').innerJoin('users', 'users.id', 'ticket_participants.user_id')
      .select('ticket_participants.user_id').where('ticket_participants.ticket_id', '=', ticketId)
      .where('users.role', 'in', ['admin', 'superadmin']).where('users.account_archived', '=', false).execute()).map(r => r.user_id);
  }
  // Security-Audit R-30: nur an Konten, die das Ticket oeffnen duerfen (Gruppen sind abgeschottet;
  // auch Erwaehnungen und der Fallback "alle Admins" erreichen niemanden ausserhalb).
  async function notifyMany(ids: Array<string | null | undefined>, params: { type: string; ticketId: string; ticketNumber: string | null;
    message: string; actorUserId: string }) {
    for (const recipientUserId of await recipientsWithAccess(app.db, params.ticketId, ids)) {
      await createNotification(app, deps, { recipientUserId, ...params });
    }
  }

  // Zustaendige Person einer Teilaufgabe: aktives Admin-Konto mit Zugriff auf das Ticket; der
  // Benutzername kommt aus der Datenbank (nie ungeprueft vom Client).
  async function todoAssignee(ticketId: string, userId: string | null | undefined, username: string | null | undefined) {
    if (!userId && !username) return { assignee_user_id: null, assignee_username: null };
    const lookup = app.db.selectFrom('users').select(['id', 'username', 'role'])
      .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false);
    const user = userId ? await lookup.where('id', '=', userId).executeTakeFirst() : await lookup.where('username', '=', username as string).executeTakeFirst();
    if (!user || !(await canAccessTicket(app.db, { uid: user.id, role: user.role }, ticketId))) throw { statusCode: 400, message: 'invalid_assignee' };
    return { assignee_user_id: user.id, assignee_username: user.username };
  }
  // @-Erwaehnungen wie im Frontend ("@Vollstaendiger Name" oder "@benutzername"); laengster Treffer
  // gewinnt, damit "@Max Mustermann" nicht zusaetzlich eine Person namens "Max" erwaehnt.
  async function mentionedStaff(content: string): Promise<string[]> {
    if (!content.includes('@')) return [];
    const staff = await app.db.selectFrom('users').select(['id', 'username', 'name_enc'])
      .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false).execute();
    const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
    const handles: Array<{ handle: string; id: string }> = [];
    for (const person of staff) {
      let name = '';
      try {
        name = fieldCipher.decryptField(person.name_enc, nameDek, { installationId: deps.env.INSTALLATION_ID, tableName: 'users', recordId: person.id, fieldName: 'name' });
      } catch { name = ''; }
      for (const handle of [person.username, name]) if (handle) handles.push({ handle: handle.toLocaleLowerCase('de-DE'), id: person.id });
    }
    handles.sort((a, b) => b.handle.length - a.handle.length);
    const text = content.toLocaleLowerCase('de-DE');
    const found = new Set<string>();
    for (let index = text.indexOf('@'); index >= 0; index = text.indexOf('@', index + 1)) {
      const rest = text.slice(index + 1);
      const match = handles.find(h => rest.startsWith(h.handle) && !/[\p{L}\p{N}_]/u.test(rest.charAt(h.handle.length)));
      if (match) found.add(match.id);
    }
    return [...found];
  }

  // Vollstaendige Namen (statt Benutzernamen) fuer Chat und interne Notizen; Fallback bleibt der
  // gespeicherte Benutzername (z.B. bei geloeschten Konten).
  async function displayNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(ids.filter((value): value is string => !!value))];
    if (!unique.length) return names;
    const rows = await app.db.selectFrom('users').select(['id', 'name_enc']).where('id', 'in', unique).execute();
    if (!rows.length) return names;
    const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
    for (const row of rows) {
      try {
        const name = fieldCipher.decryptField(row.name_enc, nameDek, { installationId: deps.env.INSTALLATION_ID, tableName: 'users', recordId: row.id, fieldName: 'name' });
        if (name) names.set(row.id, name);
      } catch { /* Name nicht entschluesselbar: Benutzername bleibt sichtbar. */ }
    }
    return names;
  }

  // Anhaenge eines Tickets gruppiert nach Chat-Nachricht bzw. interner Notiz (nur Metadaten).
  async function attachmentsByParent(ticketId: string, parent: 'message_id' | 'note_id') {
    const rows = await app.db.selectFrom('attachments')
      .select(['id', 'message_id', 'note_id', 'filename', 'mime_type', 'size_bytes'])
      .where('ticket_id', '=', ticketId).where(parent, 'is not', null).orderBy('created_at', 'asc').execute();
    const grouped = new Map<string, Array<{ id: string; name: string; type: string; size: number }>>();
    if (!rows.length) return grouped;
    const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
    for (const att of rows) {
      let name = 'Anhang';
      try {
        name = fieldCipher.decryptField(att.filename, filenameDek, {
          installationId: deps.env.INSTALLATION_ID,
          tableName: 'attachments', recordId: att.id, fieldName: 'filename'
        });
      } catch { /* Name nicht entschluesselbar: Anhang bleibt mit neutralem Namen erreichbar. */ }
      const key = att[parent]!;
      const list = grouped.get(key) ?? [];
      list.push({ id: att.id, name, type: att.mime_type, size: Number(att.size_bytes) });
      grouped.set(key, list);
    }
    return grouped;
  }

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
          'id', 'ticket_number', 'title', 'description', 'status', 'priority', 'category', 'type',
          'created_by_user_id', 'created_by_username', 'assigned_to_user_id', 'assigned_to_username', 'assigned_group_id',
          'sla_due_at', 'custom_due_at', 'archived_at', 'closed_at', 'archived_author_ack',
          'approval_status', 'approval_requested_by', 'approval_reviewer_id', 'approval_text',
          'incident_id', 'incident_notice', 'filed_by_user_id', 'filed_by_username',
          'waiting_since', 'waiting_message', 'custom_fields_json', 'created_at', 'updated_at', 'impact', 'urgency',
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
            .as('author_archived'),
          eb.selectFrom('ticket_approvals')
            .select('requested_at')
            .whereRef('ticket_approvals.ticket_id', '=', 'tickets.id')
            .where('ticket_approvals.status', '=', 'pending')
            .orderBy('requested_at', 'desc')
            .limit(1)
            .as('approval_requested_at')
        ])
        .where('archived_at', 'is', null);

      if (!isAdmin) {
        // User sieht nur eigene, nicht-archivierte Tickets
        query = query.where('created_by_user_id', '=', session.uid);
      }

      const scope = session.role === 'admin' ? await loadTicketScope(app.db, session) : null;
      const rows = (await query.orderBy('created_at', 'desc').execute()).filter(row => !scope || scopeAllowsTicket(scope, row));
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const tickets = rows.map(row => ({
        ...row,
        title: decryptTicketField(row.title, deks.title, deps, row.id, 'title'),
        description: decryptTicketField(row.description, deks.description, deps, row.id, 'description'),
        incident_notice: row.incident_notice
          ? decryptTicketField(row.incident_notice, deks.incidentNotice, deps, row.id, 'incident_notice')
          : null,
        approval_text: isAdmin && row.approval_text
          ? decryptTicketFieldTolerant(row.approval_text, deks.approvalText, deps, row.id, 'approval_text')
          : null,
        waiting_message: row.waiting_message
          ? decryptTicketFieldTolerant(row.waiting_message, deks.waitingMessage, deps, row.id, 'waiting_message')
          : null,
        custom_fields_json: decryptCustomFieldsJson(row.custom_fields_json, deks.customFields, deps, row.id)
      }));
      const modules = await loadModules(app.db);
      return reply.send({ tickets: tickets.map(ticket => maskTicketModules(ticket, modules)) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/archived - Archiv: Admins sehen alle, normale Benutzer nur eigene.
  app.get('/api/v2/tickets/archived', async (req, reply) => {
    try {
      const session = requireSession(req);
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      let query = app.db.selectFrom('tickets')
        .selectAll()
        .where('archived_at', 'is not', null)
        .orderBy('archived_at', 'desc');
      if (!isAdmin) query = query.where('created_by_user_id', '=', session.uid);
      const scope = session.role === 'admin' ? await loadTicketScope(app.db, session) : null;
      const rows = (await query.execute()).filter(row => !scope || scopeAllowsTicket(scope, row));
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const modules = await loadModules(app.db);
      const tickets = rows.map(row => maskTicketModules({ ...decryptTicketRow(row, deks, deps), ...(isAdmin ? {} : { approval_text: null }) }, modules));
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
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'reports'))) return reply.code(403).send({ error: 'forbidden' });
      const { since } = req.query as { since?: string };
      let query = app.db.selectFrom('tickets')
        .select(eb => [
          'id',
          'created_at',
          'created_by_user_id', 'assigned_to_user_id', 'assigned_group_id', 'category',
          eb.selectFrom('ticket_messages')
            .select('created_at')
            .whereRef('ticket_messages.ticket_id', '=', 'tickets.id')
            .where('sender_role', '!=', 'user')
            .orderBy('created_at', 'asc')
            .limit(1)
            .as('first_response_at')
        ]);
      if (since) {
        const sinceDate = new Date(since);
        if (Number.isNaN(sinceDate.getTime())) return reply.code(400).send({ error: 'invalid_since' });
        query = query.where('created_at', '>=', sinceDate);
      }
      // Security-Audit R-30: nur Tickets, die die Person auch sehen darf (vorher alle IDs).
      const scope = await loadTicketScope(app.db, session);
      const rows = (await query.execute()).filter(row => scopeAllowsTicket(scope, row))
        .map(row => ({ id: row.id, created_at: row.created_at, first_response_at: row.first_response_at }));
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

      // Security-Audit B6: eine Großstörung erscheint als Banner bei ALLEN Benutzern (GET
      // /api/v2/incidents/active) -- ohne diese Prüfung könnte jedes normale Konto einen
      // beliebigen Text ("Störung: Passwort bitte unter ... neu setzen") als offiziellen Hinweis
      // ausgeben (interner Phishing-Kanal). Nicht-Admins erzwingen daher type='ticket' und kein
      // incident_notice, unabhängig davon was im Request-Body steht.
      const isAdminActor = session.role === 'admin' || session.role === 'superadmin';
      const ticketType = isAdminActor ? parsed.data.type : 'ticket';
      const incidentNoticeInput = isAdminActor ? parsed.data.incident_notice : undefined;

      // Benutzer muessen eine bestehende, aktive Kategorie waehlen (Pflichtfeld im Formular).
      if (!isAdminActor) {
        const category = parsed.data.category
          ? await app.db.selectFrom('categories').select('id').where('name', '=', parsed.data.category).where('archived', '=', false).executeTakeFirst()
          : undefined;
        if (!category) return reply.code(400).send({ error: 'category_required' });
      }
      // Prioritaet aus Auswirkung und Dringlichkeit serverseitig ableiten (nicht dem Client vertrauen).
      const hasImpact = parsed.data.impact !== undefined && parsed.data.urgency !== undefined;
      if (hasImpact) parsed.data.priority = priorityFromImpact(parsed.data.impact!, parsed.data.urgency!);

      const newId = randomUUID();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const titleEnc = encryptTicketField(parsed.data.title, deks.title, deps, newId, 'title');
      const descriptionEnc = encryptTicketField(parsed.data.description, deks.description, deps, newId, 'description');
      const incidentNoticeEnc = incidentNoticeInput
        ? encryptTicketField(incidentNoticeInput, deks.incidentNotice, deps, newId, 'incident_notice')
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
      // Ohne Modul "Lösungsfristen" bekommen neue Tickets keine Frist.
      const slaDueAt = modulesFromConfig(slaConfig).sla ? calculateSlaDueAt(new Date(), parsed.data.priority, slaConfig) : null;

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
            impact: hasImpact ? parsed.data.impact! : null,
            urgency: hasImpact ? parsed.data.urgency! : null,
            type: ticketType,
            incident_notice: incidentNoticeEnc,
            created_by_user_id: authorUserId,
            created_by_username: authorUsername,
            filed_by_user_id: filedByUserId,
            filed_by_username: filedByUsername,
            assigned_group_id: assignedGroupId,
            status: 'Neu',
            sla_due_at: slaDueAt ? mysqlTimestamp(slaDueAt) : null,
            installation_id: deps.env.INSTALLATION_ID,
            custom_fields_json: parsed.data.custom_fields
              ? encryptTicketField(JSON.stringify(parsed.data.custom_fields), deks.customFields, deps, newId, 'custom_fields_json')
              : null
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
        if (modulesFromConfig(config).approvals && wf?.enabled && (wf.priorities || []).includes(parsed.data.priority)) {
          const creator = await app.db.selectFrom('users').select('supervisor_user_id').where('id', '=', session.uid).executeTakeFirst();
          // Vorgesetzte Person, Ersatzperson der Kategorie bzw. Gruppe, allgemeine Ersatzperson
          // (domain/approvalRouting.ts) -- die erste davon mit aktivem Konto, sonst eine Superadmin-Person.
          const [memberships, groupRows] = await Promise.all([
            app.db.selectFrom('user_groups').select('group_id').where('user_id', '=', session.uid).execute(),
            app.db.selectFrom('groups').select(['id', 'parent_id']).execute()
          ]);
          const candidates = approverCandidates({
            supervisorId: creator?.supervisor_user_id, rules: wf.fallbackRules, category: parsed.data.category ?? null,
            creatorGroupIds: memberships.map(row => row.group_id), groups: groupRows, globalFallbackId: wf.fallbackApproverUserId
          });
          let approver: { id: string; username: string } | undefined;
          for (const candidateId of candidates) {
            if (candidateId === session.uid) continue;
            approver = await app.db.selectFrom('users').select(['id', 'username'])
              .where('id', '=', candidateId).where('account_archived', '=', false).executeTakeFirst();
            if (approver) break;
          }
          if (!approver) {
            approver = await app.db.selectFrom('users').select(['id', 'username'])
              .where('role', '=', 'superadmin').where('id', '!=', session.uid).where('account_archived', '=', false).executeTakeFirst();
          }
          if (approver) {
            await app.db.updateTable('tickets').set({
              approval_status: 'pending', approval_requested_by: session.username, approval_reviewer_id: approver.id,
              updated_at: mysqlTimestamp()
            }).where('id', '=', newId).execute();
            await app.db.insertInto('ticket_audit_log').values({
              id: randomUUID(), ticket_id: newId, actor_user_id: session.uid, actor_username: session.username,
              action: 'approval_requested', field: 'approval_status', old_value: null, new_value: `pending (Prüfer: ${approver.username})`
            }).execute();
            await recordApprovalRequest(newId, { uid: session.uid, username: session.username }, approver);
            await createNotification(app, deps, {
              recipientUserId: approver.id, recipientUsername: approver.username, type: 'approvalRequested',
              ticketId: newId, ticketNumber: null,
              message: `${session.username} hat ein Ticket mit Priorität ${parsed.data.priority} angelegt – bitte genehmigen.`
            });
            approvalRequested = true;
          }
        }
      }

      const ticketRow = await app.db.selectFrom('tickets').selectAll().where('id', '=', newId).executeTakeFirstOrThrow();

      // Zuständige Personen benachrichtigen: Mitglieder der zugewiesenen Gruppe, sonst alle
      // Admin/Superadmin-Konten -- außer wenn die erstellende Person selbst admin ist oder das
      // Ticket erst noch eine Genehmigung braucht.
      if (!isCreatorAdmin && !approvalRequested) {
        await notifyMany(await staffRecipients(assignedGroupId), { type: 'newTicket', ticketId: newId,
          ticketNumber: ticketRow.ticket_number, message: `Neues Ticket von ${session.username} erstellt.`, actorUserId: session.uid });
      }
      // Im Auftrag angelegt: die Person, fuer die das Ticket gilt, erfaehrt davon.
      if (filedByUserId) {
        await notifyMany([authorUserId], { type: 'statusChange', ticketId: newId, ticketNumber: ticketRow.ticket_number,
          message: `Für dich wurde das Ticket ${ticketRow.ticket_number} angelegt.`, actorUserId: session.uid });
      }

      req.auditDetail = { ticket: ticketRow.ticket_number };
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
      const modules = await loadModules(app.db);
      return reply.send({ ticket: maskTicketModules({ ...decryptTicketRow(ticket, deks, deps), ...(isAdmin ? {} : { approval_text: null }), author_archived: authorRow?.account_archived ?? false }, modules) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/tickets/:id - Ticket aktualisieren.
  // Admins duerfen alle freigegebenen Felder bearbeiten; normale Benutzer duerfen nur ihr
  // eigenes, offenes Ticket als geloest schliessen.
  app.patch('/api/v2/tickets/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const parsed = updateTicketSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const ticket = await app.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      const patchKeys = Object.entries(parsed.data)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
      const isSelfClose = !isAdmin
        && ticket.created_by_user_id === session.uid
        && ticket.archived_at === null
        && ticket.status !== 'Geschlossen'
        && parsed.data.status === 'Geschlossen'
        && patchKeys.every(key => key === 'status');
      if (!isAdmin && !isSelfClose) return reply.code(403).send({ error: 'forbidden' });

      // Benutzername kommt aus der Datenbank, nie ungeprueft vom Client -- sonst koennten ID und
      // angezeigter Name auf verschiedene Personen zeigen (und Hinweise an die falsche gehen).
      if (parsed.data.assigned_to_user_id !== undefined || parsed.data.assigned_to_username !== undefined) {
        const wantedId = parsed.data.assigned_to_user_id ?? null;
        const wantedName = parsed.data.assigned_to_username ?? null;
        if (!wantedId && !wantedName) {
          parsed.data.assigned_to_user_id = null;
          parsed.data.assigned_to_username = null;
        } else {
          const lookup = app.db.selectFrom('users').select(['id', 'username'])
            .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false);
          const assignee = wantedId
            ? await lookup.where('id', '=', wantedId).executeTakeFirst()
            : await lookup.where('username', '=', wantedName as string).executeTakeFirst();
          if (!assignee) return reply.code(400).send({ error: 'invalid_assignee' });
          parsed.data.assigned_to_user_id = assignee.id;
          parsed.data.assigned_to_username = assignee.username;
        }
      }

      const updates: Record<string, unknown> = { updated_at: mysqlTimestamp() };
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
          updates.archived_at = parsed.data.archived ? mysqlTimestamp() : null;
          auditChanges.push({ field: 'archived', old: wasArchived, new: parsed.data.archived });
        }
      }

      // Fristen gehoeren zum Modul "Lösungsfristen" -- ist es deaktiviert, bleiben sie unveraendert.
      const slaModuleActive = (await loadModules(app.db)).sla;
      for (const [key, value] of Object.entries(parsed.data)) {
        if (key === 'title' || key === 'description' || key === 'incident_notice' || key === 'archived' || key === 'waiting_message') continue;
        if ((key === 'custom_due_at' || key === 'sla_due_at') && !slaModuleActive) continue;
        if (value !== undefined) {
          const oldValue = (ticket as any)[key];
          let nextValue = value;
          if (key === 'custom_due_at' || key === 'sla_due_at') {
            if (value === null || value === '') {
              nextValue = null;
            } else {
              const parsedDate = new Date(String(value));
              if (Number.isNaN(parsedDate.getTime())) {
                return reply.code(400).send({ error: 'invalid_datetime', field: key });
              }
              nextValue = mysqlTimestamp(parsedDate);
            }
          }
          if (oldValue !== nextValue) {
            updates[key] = nextValue;
            auditChanges.push({ field: key, old: oldValue, new: value });
          }
        }
      }

      // Status-Spezial: closed_at setzen
      if (parsed.data.status === 'Geschlossen' && ticket.status !== 'Geschlossen') {
        updates.closed_at = mysqlTimestamp();
      }

      // "Warten auf Benutzer"/-"...": Start-Zeitpunkt und Hinweistext für die Erinnerung/das
      // automatische Schließen durch jobs/maintenance.ts (runWaitingTickets). Nur beim
      // tatsächlichen Statuswechsel berührt, nicht bei jedem PATCH.
      if (parsed.data.status !== undefined && parsed.data.status !== ticket.status) {
        const wasWaiting = ticket.status.startsWith('Warten auf');
        const isWaitingNow = parsed.data.status.startsWith('Warten auf');
        if (!wasWaiting && isWaitingNow) {
          updates.waiting_since = mysqlTimestamp();
          // Security-Audit N10: jetzt verschlüsselt wie title/description.
          if (parsed.data.waiting_message) {
            deks = deks ?? await loadTicketDeks(app, deps.keyProvider);
            updates.waiting_message = encryptTicketField(parsed.data.waiting_message, deks.waitingMessage, deps, id, 'waiting_message');
          } else {
            updates.waiting_message = null;
          }
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

        const event = { ticketId: id, ticketNumber: ticket.ticket_number, actorUserId: session.uid };
        if (parsed.data.status !== undefined && parsed.data.status !== ticket.status) {
          const waitingInfo = parsed.data.status.startsWith('Warten auf') && parsed.data.waiting_message ? parsed.data.waiting_message : null;
          await notifyMany([ticket.created_by_user_id, ...await participantIds(id)], {
            ...event,
            type: parsed.data.status === 'Geschlossen' ? 'ticketClosed' : 'statusChange',
            message: waitingInfo
              ? `Ticket ${ticket.ticket_number}: Es werden Informationen benötigt – ${waitingInfo}`
              : `Status von Ticket ${ticket.ticket_number} geändert zu "${parsed.data.status}"`
          });
        }
        if (typeof updates.assigned_to_user_id === 'string') {
          await notifyMany([updates.assigned_to_user_id], { ...event, type: 'ticketAssigned',
            message: `Ticket ${ticket.ticket_number} wurde dir zugewiesen.` });
        }
        if (isAdmin && ['title', 'description', 'priority', 'category', 'custom_due_at'].some(field => field in updates)) {
          await notifyMany([ticket.created_by_user_id], { ...event, type: 'ticketEdited',
            message: `Ticket ${ticket.ticket_number} wurde vom Support bearbeitet.` });
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
      const names = await displayNames(rows.map(row => row.sender_user_id));
      const byMessage = await attachmentsByParent(id, 'message_id');
      const messages = rows.map(row => ({ ...decryptMessage(row, msgDeks, deps),
        sender_name: (row.sender_user_id && names.get(row.sender_user_id)) || row.sender_username,
        attachments: byMessage.get(row.id) ?? [] }));
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
        .select(['id', 'ticket_number', 'created_by_user_id', 'created_by_username', 'assigned_to_user_id', 'assigned_to_username', 'assigned_group_id', 'status', 'archived_at'])
        .where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const msgId = randomUUID();
      const msgDeks = await loadMessageDeks(app, deps.keyProvider);
      const encrypted = encryptMessage(deps, msgDeks, msgId, parsed.data.content, parsed.data.content_html ?? null);
      await app.db.transaction().execute(async trx => {
        const current = await trx.selectFrom('tickets').select(['status', 'archived_at']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
        await trx.insertInto('ticket_messages').values({
          id: msgId,
          ticket_id: id,
          sender_user_id: session.uid,
          sender_username: session.username,
          sender_name: session.username,
          sender_role: session.role,
          content: encrypted.content,
          content_html: encrypted.content_html,
          has_attachments: parsed.data.has_attachments === true
        }).execute();

        // Resolve the pending request without granting users general status-edit rights.
        const resumed = !isAdmin && !current.archived_at && ['Warten auf Benutzer', 'Geschlossen'].includes(current.status);
        await trx.updateTable('tickets').set({ updated_at: mysqlTimestamp(),
          ...(resumed ? { status: 'In Bearbeitung', waiting_since: null, waiting_message: null, waiting_reminder_sent: false, closed_at: null } : {})
        }).where('id', '=', id).execute();
        if (resumed) await trx.insertInto('ticket_audit_log').values({
          id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
          action: 'updated', field: 'status', old_value: current.status, new_value: 'In Bearbeitung'
        }).execute();
      });

      // Schreibt der Support: Ersteller, Zustaendige und Beteiligte. Schreibt die anfragende Person:
      // Zustaendige und Beteiligte -- ist niemand zugewiesen, die Gruppe bzw. alle Admins (vorher
      // blieb eine Antwort auf ein nicht zugewiesenes Ticket fuer alle unbemerkt).
      const messageEvent = { type: 'newMessage', ticketId: id, ticketNumber: ticket.ticket_number,
        message: `Neue Nachricht zu Ticket ${ticket.ticket_number}`, actorUserId: session.uid };
      const involved = [ticket.assigned_to_user_id, ...await participantIds(id)].filter((value): value is string => !!value);
      if (isAdmin) await notifyMany([ticket.created_by_user_id, ...involved], messageEvent);
      else await notifyMany(involved.length ? involved : await staffRecipients(ticket.assigned_group_id), messageEvent);

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
      const { id, messageId } = req.params as { id: string; messageId: string };
      const parsed = z.object({ content: z.string().trim().min(1).max(50000) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const existing = await app.db.selectFrom('ticket_messages').select(['id', 'sender_user_id', 'content'])
        .where('id', '=', messageId).where('ticket_id', '=', id).executeTakeFirst();
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      if (existing.sender_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });
      // Wer das Ticket nicht (mehr) sehen darf, oder ein archiviertes Ticket: keine Aenderung mehr.
      const ticket = await app.db.selectFrom('tickets').select(['created_by_user_id', 'archived_at']).where('id', '=', id).executeTakeFirst();
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!ticket || ticket.archived_at || (!isAdmin && ticket.created_by_user_id !== session.uid)) return reply.code(403).send({ error: 'forbidden' });

      const msgDeks = await loadMessageDeks(app, deps.keyProvider);
      const ctxBase = {
        installationId: deps.env.INSTALLATION_ID,
        tableName: 'ticket_messages', recordId: messageId
      };
      // Nur echte inhaltliche Aenderungen werden gespeichert und als "bearbeitet" markiert.
      let previous: string | null = null;
      try { previous = fieldCipher.decryptField(existing.content, msgDeks.content, { ...ctxBase, fieldName: 'content' }); } catch { previous = null; }
      if (previous !== parsed.data.content) {
        await app.db.updateTable('ticket_messages')
          .set({ content: fieldCipher.encryptField(parsed.data.content, msgDeks.content, { ...ctxBase, fieldName: 'content' }),
            content_html: null, edited_at: mysqlTimestamp() })
          .where('id', '=', messageId)
          .execute();
      }

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
      // Anhaenge interner Notizen (nur Metadaten; Inhalt wie ueblich ueber /api/v2/attachments/:id).
      const byNote = await attachmentsByParent(id, 'note_id');
      const names = await displayNames(rows.map(row => row.author_user_id));
      return reply.send({ notes: notes.map(note => ({ ...note, author_name: (note.author_user_id && names.get(note.author_user_id)) || note.author_username,
        attachments: byNote.get(note.id) ?? [] })) });
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

      const mentioned = await mentionedStaff(parsed.data.content);
      if (mentioned.length) {
        const info = await app.db.selectFrom('tickets').select('ticket_number').where('id', '=', id).executeTakeFirst();
        await notifyMany(mentioned, { type: 'mention', ticketId: id, ticketNumber: info?.ticket_number ?? null, actorUserId: session.uid,
          message: `${session.username} hat dich in einer internen Notiz zu Ticket ${info?.ticket_number ?? ''} erwähnt.` });
      }

      const noteRow = await app.db.selectFrom('ticket_notes').selectAll().where('id', '=', noteId).executeTakeFirstOrThrow();
      return reply.code(201).send({ note: decryptNote(noteRow, noteDek, deps) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/tickets/:id/notes/:noteId - nur Admin
  app.patch('/api/v2/tickets/:id/notes/:noteId', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id, noteId } = req.params as { id: string; noteId: string };
      const parsed = addNoteSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      // Notiz muss tatsächlich zum Ticket aus dem Pfad gehören -- verhindert, dass eine
      // über die URL vertauschte noteId versehentlich eine Notiz eines anderen Tickets trifft.
      const existingNote = await app.db.selectFrom('ticket_notes').selectAll().where('id', '=', noteId).where('ticket_id', '=', id).executeTakeFirst();
      if (!existingNote) return reply.code(404).send({ error: 'note_not_found' });

      const noteDek = await loadNoteDek(app, deps.keyProvider);
      const updates: Record<string, unknown> = {};
      if (parsed.data.content !== undefined) {
        let previous: string | null = null;
        try { previous = decryptNote(existingNote, noteDek, deps).content; } catch { previous = null; }
        if (previous !== parsed.data.content) {
          updates.content = encryptNote(deps, noteDek, noteId, parsed.data.content);
          updates.edited_at = mysqlTimestamp();
        }
      }
      if (parsed.data.note_type !== undefined) updates.note_type = parsed.data.note_type;
      if (parsed.data.is_pinned !== undefined) updates.is_pinned = parsed.data.is_pinned;
      if (parsed.data.is_resolution !== undefined) updates.is_resolution = parsed.data.is_resolution;

      if (Object.keys(updates).length > 0) {
        await app.db.updateTable('ticket_notes').set(updates).where('id', '=', noteId).where('ticket_id', '=', id).execute();
      }
      // Nur neu hinzugekommene Erwaehnungen melden, nicht bei jeder Bearbeitung erneut alle.
      if (parsed.data.content !== undefined) {
        let previous = new Set<string>();
        try { previous = new Set(await mentionedStaff(decryptNote(existingNote, noteDek, deps).content)); } catch { previous = new Set(); }
        const added = (await mentionedStaff(parsed.data.content)).filter(uid => !previous.has(uid));
        if (added.length) {
          const info = await app.db.selectFrom('tickets').select('ticket_number').where('id', '=', id).executeTakeFirst();
          await notifyMany(added, { type: 'mention', ticketId: id, ticketNumber: info?.ticket_number ?? null, actorUserId: session.uid,
            message: `${session.username} hat dich in einer internen Notiz zu Ticket ${info?.ticket_number ?? ''} erwähnt.` });
        }
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
  // Notiz-Anhänge kommen mit der jeweiligen Nachricht bzw. Notiz.
  app.get('/api/v2/tickets/:id/attachments', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const rows = await app.db.selectFrom('attachments')
        .select(['id', 'filename', 'mime_type', 'size_bytes', 'uploaded_by_user_id', 'uploaded_by_username', 'created_at'])
        .where('ticket_id', '=', id).where('message_id', 'is', null).where('note_id', 'is', null)
        .orderBy('created_at', 'asc').execute();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
      const attachments = rows.map(row => ({
        ...row,
        filename: fieldCipher.decryptField(row.filename, filenameDek, {
          installationId: deps.env.INSTALLATION_ID,
          tableName: 'attachments', recordId: row.id, fieldName: 'filename'
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
        .select(['id', 'ticket_number', 'title', 'incident_notice'])
        .where('type', '=', 'incident')
        .where('archived_at', 'is', null)
        .where('status', '!=', 'Geschlossen')
        .execute();
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const incidents = rows.map(row => ({ id: row.id, ticket_number: row.ticket_number,
        title: decryptTicketField(row.title, deks.title, deps, row.id, 'title'),
        incident_notice: row.incident_notice ? decryptTicketField(row.incident_notice, deks.incidentNotice, deps, row.id, 'incident_notice') : null }));
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

      // Link and status must commit together for every role, not via an extra admin-only PATCH.
      const result = await app.db.transaction().execute(async trx => {
        const rows = await trx.selectFrom('tickets')
          .select(['id', 'type', 'status', 'created_by_user_id', 'archived_at', 'incident_id'])
          .where('id', 'in', [id, parsed.data.incident_id]).orderBy('id', 'asc').forUpdate().execute();
        const ticket = rows.find(row => row.id === id);
        if (!ticket) throw { statusCode: 404, message: 'not_found' };
        const isAdmin = session.role === 'admin' || session.role === 'superadmin';
        if (!isAdmin && ticket.created_by_user_id !== session.uid) throw { statusCode: 403, message: 'forbidden' };
        if (ticket.archived_at) throw { statusCode: 409, message: 'ticket_archived' };
        const incident = rows.find(row => row.id === parsed.data.incident_id);
        if (!incident || incident.type !== 'incident' || ticket.type === 'incident' || id === incident.id || !isValidTicketStatus(incident.status)) {
          throw { statusCode: 400, message: 'not_an_incident' };
        }
        const publicIncident = !incident.archived_at && incident.status !== 'Geschlossen';
        if (!publicIncident && !(await canAccessTicket(trx, session, incident.id))) throw { statusCode: 400, message: 'not_an_incident' };

        const previousStatus = ticket.status, previousIncidentId = ticket.incident_id;
        const changed = previousStatus !== incident.status;
        const now = mysqlTimestamp();
        await trx.updateTable('tickets').set({ incident_id: incident.id, status: incident.status, updated_at: now,
          ...(changed ? { closed_at: incident.status === 'Geschlossen' ? now : null,
            waiting_since: incident.status.startsWith('Warten auf') ? now : null,
            waiting_reminder_sent: false, waiting_message: null } : {})
        }).where('id', '=', id).execute();
        if (previousIncidentId !== incident.id) await trx.insertInto('ticket_audit_log').values({
          id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
          action: 'linked_incident', field: 'incident_id', old_value: previousIncidentId || null, new_value: incident.id
        }).execute();
        if (changed) await trx.insertInto('ticket_audit_log').values({
          id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
          action: 'updated', field: 'status', old_value: previousStatus, new_value: incident.status
        }).execute();
        return { success: true, status: incident.status };
      });
      return reply.send(result);
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Genehmigungen ---
  // Verlauf in ticket_approvals (Migration 0063): Anfrage und Entscheidung bleiben am Ticket
  // sichtbar. tickets.approval_* haelt weiterhin den aktuellen Stand (Board-Kennzeichnung, Sperren).

  const approvalTextCtx = (approvalId: string, field: 'request_text' | 'decision_text') => ({
    installationId: deps.env.INSTALLATION_ID,
    tableName: 'ticket_approvals', recordId: approvalId, fieldName: field
  });
  async function encryptApprovalText(approvalId: string, field: 'request_text' | 'decision_text', value: string | undefined) {
    if (!value) return null;
    const dek = await ensureDek(app.db, deps.keyProvider, `ticket_approvals.${field}`);
    return fieldCipher.encryptField(value, dek, approvalTextCtx(approvalId, field));
  }
  async function decryptApprovalText(approvalId: string, field: 'request_text' | 'decision_text', value: Buffer | null) {
    if (!value) return null;
    try {
      const dek = await ensureDek(app.db, deps.keyProvider, `ticket_approvals.${field}`);
      return fieldCipher.decryptField(value, dek, approvalTextCtx(approvalId, field));
    } catch { return null; }
  }
  // Neue Anfrage: eine noch offene Anfrage desselben Tickets gilt als ersetzt.
  async function recordApprovalRequest(ticketId: string, requester: { uid: string | null; username: string | null },
    approver: { id: string; username: string }, text?: string) {
    await app.db.updateTable('ticket_approvals').set({ status: 'superseded', decided_at: mysqlTimestamp() })
      .where('ticket_id', '=', ticketId).where('status', '=', 'pending').execute();
    const approvalId = randomUUID();
    await app.db.insertInto('ticket_approvals').values({
      id: approvalId, ticket_id: ticketId, requested_by_user_id: requester.uid, requested_by_username: requester.username,
      approver_user_id: approver.id, approver_username: approver.username,
      request_text_enc: await encryptApprovalText(approvalId, 'request_text', text)
    }).execute();
  }
  // Direkte Anhaenge eines Tickets (nicht aus Chat oder interner Kommunikation), nur Metadaten.
  async function directAttachments(ticketId: string) {
    const rows = await app.db.selectFrom('attachments').select(['id', 'filename', 'mime_type', 'size_bytes'])
      .where('ticket_id', '=', ticketId).where('message_id', 'is', null).where('note_id', 'is', null)
      .orderBy('created_at', 'asc').execute();
    if (!rows.length) return [];
    const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
    return rows.map(att => {
      let name = 'Anhang';
      try {
        name = fieldCipher.decryptField(att.filename, filenameDek, {
          installationId: deps.env.INSTALLATION_ID,
          tableName: 'attachments', recordId: att.id, fieldName: 'filename'
        });
      } catch { /* Name nicht entschluesselbar: Anhang bleibt mit neutralem Namen erreichbar. */ }
      return { id: att.id, name, type: att.mime_type, size: Number(att.size_bytes) };
    });
  }

  // POST /api/v2/tickets/:id/request-approval (Admin mit Recht "Genehmigungen")
  // Pruefen darf jedes aktive Konto, auch normale Benutzer (z.B. Vorgesetzte ohne Admin-Rolle).
  app.post('/api/v2/tickets/:id/request-approval', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await loadModules(app.db)).approvals) return reply.code(403).send({ error: 'module_disabled' });
      if (!(await hasAdminPermission(session, 'approvals'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = requestApprovalSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      // Trennung von Antragsteller und Pruefer erzwingen -- ohne diese Prüfung könnte eine Person
      // mit "approvals"-Recht sich selbst als Prüfer eintragen und die eigene Anfrage genehmigen.
      if (parsed.data.approver_user_id === session.uid) {
        return reply.code(400).send({ error: 'approver_must_not_be_self' });
      }
      const ticketForApproval = await app.db.selectFrom('tickets').select(['ticket_number', 'created_by_user_id', 'archived_at'])
        .where('id', '=', id).executeTakeFirst();
      if (!ticketForApproval) return reply.code(404).send({ error: 'not_found' });
      if (ticketForApproval.archived_at) return reply.code(409).send({ error: 'ticket_archived' });
      if (ticketForApproval.created_by_user_id && ticketForApproval.created_by_user_id === parsed.data.approver_user_id) {
        return reply.code(400).send({ error: 'approver_must_not_be_requester' });
      }

      const approver = await app.db.selectFrom('users').select(['id', 'username', 'account_archived'])
        .where('id', '=', parsed.data.approver_user_id).executeTakeFirst();
      if (!approver || approver.account_archived) return reply.code(400).send({ error: 'invalid_approver' });

      // Security-Audit N10: approval_text jetzt verschlüsselt wie title/description.
      const approvalDeks = await loadTicketDeks(app, deps.keyProvider);
      const approvalTextEnc = parsed.data.text
        ? encryptTicketField(parsed.data.text, approvalDeks.approvalText, deps, id, 'approval_text')
        : null;

      await app.db.updateTable('tickets').set({
        approval_status: 'pending',
        approval_requested_by: session.username,
        approval_reviewer_id: approver.id,
        approval_text: approvalTextEnc,
        updated_at: mysqlTimestamp()
      }).where('id', '=', id).execute();
      await recordApprovalRequest(id, { uid: session.uid, username: session.username }, approver, parsed.data.text);

      // Security-Audit R-13: approval_text ist in tickets.approval_text verschlüsselt (N10) --
      // der Genehmigungsgrund darf deshalb nicht zusätzlich im Klartext im Audit-Log landen, das
      // würde die Verschlüsselungszusage faktisch aushöhlen (ein DB-Dump/Backup würde ihn trotzdem
      // preisgeben). Nur noch vermerkt, DASS eine Begründung mitgegeben wurde, nicht ihr Inhalt.
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'approval_requested', field: 'approval_status', old_value: null,
        new_value: `pending (Prüfer: ${approver.username}${parsed.data.text ? ', mit Begründung' : ''})`
      }).execute();

      // Der Text steht nicht in der Benachrichtigung (sie landet auch per E-Mail), sondern nur in
      // der Genehmigungsansicht.
      await createNotification(app, deps, {
        recipientUserId: approver.id,
        recipientUsername: approver.username,
        type: 'approvalRequested',
        ticketId: id,
        ticketNumber: ticketForApproval.ticket_number ?? null,
        message: `${session.username} bittet dich um eine Genehmigung für Ticket ${ticketForApproval.ticket_number ?? ''}`
      });
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/tickets/:id/approval-decision - nur die als Prüfer eingetragene Person (jede
  // Rolle) oder Superadmin als Vertretung -- IDOR-Schutz auf Genehmiger-Ebene.
  app.post('/api/v2/tickets/:id/approval-decision', async (req, reply) => {
    try {
      const session = requireSession(req);
      if (!(await loadModules(app.db)).approvals) return reply.code(403).send({ error: 'module_disabled' });
      const { id } = req.params as { id: string };
      const parsed = decideApprovalSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (parsed.data.decision === 'rejected' && !parsed.data.reason) return reply.code(400).send({ error: 'reason_required' });

      const ticket = await app.db.selectFrom('tickets')
        .select(['approval_reviewer_id', 'approval_status', 'approval_requested_by', 'ticket_number', 'created_by_user_id', 'created_by_username'])
        .where('id', '=', id).executeTakeFirst();
      if (!ticket || ticket.approval_status !== 'pending') return reply.code(409).send({ error: 'no_pending_approval' });
      if (session.role !== 'superadmin' && ticket.approval_reviewer_id !== session.uid) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      // Security-Audit N10: approval_text jetzt verschlüsselt wie title/description.
      const decisionDeks = await loadTicketDeks(app, deps.keyProvider);
      const decisionTextEnc = parsed.data.reason
        ? encryptTicketField(parsed.data.reason, decisionDeks.approvalText, deps, id, 'approval_text')
        : null;

      await app.db.updateTable('tickets').set({
        approval_status: parsed.data.decision,
        approval_text: decisionTextEnc,
        updated_at: mysqlTimestamp()
      }).where('id', '=', id).execute();

      const pending = await app.db.selectFrom('ticket_approvals').select(['id', 'requested_by_user_id', 'requested_by_username'])
        .where('ticket_id', '=', id).where('status', '=', 'pending').orderBy('requested_at', 'desc').executeTakeFirst();
      if (pending) {
        await app.db.updateTable('ticket_approvals').set({
          status: parsed.data.decision, decided_by_user_id: session.uid, decided_by_username: session.username,
          decision_text_enc: await encryptApprovalText(pending.id, 'decision_text', parsed.data.reason), decided_at: mysqlTimestamp()
        }).where('id', '=', pending.id).execute();
      }

      // Security-Audit R-13: wie bei approval_requested oben -- die Begründung der Entscheidung
      // darf nicht zusätzlich zur verschlüsselten Spalte im Klartext im Audit-Log stehen.
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'approval_decided', field: 'approval_status', old_value: 'pending',
        new_value: parsed.data.reason ? `${parsed.data.decision} (mit Begründung)` : parsed.data.decision
      }).execute();

      // Benachrichtigt werden das erstellende Konto und, falls abweichend, die anfragende Person.
      const message = `Genehmigung für Ticket ${ticket.ticket_number} ${parsed.data.decision === 'approved' ? 'erteilt' : 'abgelehnt'}`;
      const recipients = new Map<string, string | null>();
      if (ticket.created_by_user_id) recipients.set(ticket.created_by_user_id, ticket.created_by_username);
      if (pending?.requested_by_user_id) recipients.set(pending.requested_by_user_id, pending.requested_by_username);
      recipients.delete(session.uid);
      for (const [recipientUserId, recipientUsername] of recipients) {
        await createNotification(app, deps, {
          recipientUserId, recipientUsername: recipientUsername ?? undefined, type: 'approvalDecided',
          ticketId: id, ticketNumber: ticket.ticket_number, message
        });
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/approvals - offene Genehmigungen der angemeldeten Person (jede Rolle). Liefert nur,
  // was fuer die Entscheidung noetig ist: Ticketkopf, Zusatzfelder, Anfrage und direkte Anhaenge --
  // keinen Chat, keine interne Kommunikation, keine verwandten Tickets.
  app.get('/api/v2/approvals', async (req, reply) => {
    try {
      const session = requireSession(req);
      if (!(await loadModules(app.db)).approvals) return reply.send({ approvals: [] });
      const rows = await app.db.selectFrom('tickets')
        .select(['id', 'ticket_number', 'title', 'description', 'priority', 'category', 'status', 'created_by_user_id', 'created_by_username',
          'assigned_to_user_id', 'assigned_group_id', 'custom_fields_json', 'created_at'])
        .where('approval_status', '=', 'pending').where('approval_reviewer_id', '=', session.uid).where('archived_at', 'is', null)
        .orderBy('created_at', 'asc').execute();
      if (!rows.length) return reply.send({ approvals: [] });
      const deks = await loadTicketDeks(app, deps.keyProvider);
      const requests = await app.db.selectFrom('ticket_approvals')
        .select(['id', 'ticket_id', 'requested_by_user_id', 'requested_by_username', 'request_text_enc', 'requested_at'])
        .where('ticket_id', 'in', rows.map(row => row.id)).where('status', '=', 'pending').execute();
      const scope = await loadTicketScope(app.db, session);
      const names = await displayNames([...rows.map(row => row.created_by_user_id), ...requests.map(row => row.requested_by_user_id)]);
      const approvals = [];
      for (const row of rows) {
        const request = requests.find(entry => entry.ticket_id === row.id);
        approvals.push({
          ticket_id: row.id,
          ticket_number: row.ticket_number,
          title: decryptTicketField(row.title, deks.title, deps, row.id, 'title'),
          description: decryptTicketField(row.description, deks.description, deps, row.id, 'description'),
          priority: row.priority,
          category: row.category,
          status: row.status,
          created_at: row.created_at,
          author: (row.created_by_user_id && names.get(row.created_by_user_id)) || row.created_by_username,
          custom_fields_json: decryptCustomFieldsJson(row.custom_fields_json, deks.customFields, deps, row.id),
          requested_by: (request?.requested_by_user_id && names.get(request.requested_by_user_id)) || request?.requested_by_username || null,
          requested_at: request?.requested_at ?? null,
          request_text: request ? await decryptApprovalText(request.id, 'request_text', request.request_text_enc) : null,
          attachments: await directAttachments(row.id),
          // Das volle Ticket oeffnen darf nur, wer es auch ohne Genehmigung sehen duerfte.
          can_open: scopeAllowsTicket(scope, row)
        });
      }
      return reply.send({ approvals });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/tickets/:id/approvals - Genehmigungsverlauf eines Tickets. Den Anfragetext sehen
  // Admins und die anfragende Person; das erstellende Konto sieht Status und Entscheidung.
  app.get('/api/v2/tickets/:id/approvals', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });
      if (!(await loadModules(app.db)).approvals) return reply.send({ approvals: [] });
      const rows = await app.db.selectFrom('ticket_approvals').selectAll().where('ticket_id', '=', id)
        .where('status', '!=', 'superseded').orderBy('requested_at', 'desc').execute();
      const names = await displayNames(rows.flatMap(row => [row.requested_by_user_id, row.approver_user_id, row.decided_by_user_id]));
      const nameOf = (userId: string | null, username: string | null) => (userId && names.get(userId)) || username || null;
      const approvals = [];
      for (const row of rows) {
        const mayReadRequest = isAdmin || row.requested_by_user_id === session.uid;
        approvals.push({
          id: row.id,
          status: row.status,
          requested_by: nameOf(row.requested_by_user_id, row.requested_by_username),
          approver: nameOf(row.approver_user_id, row.approver_username),
          decided_by: nameOf(row.decided_by_user_id, row.decided_by_username),
          requested_at: row.requested_at,
          decided_at: row.decided_at,
          request_text: mayReadRequest ? await decryptApprovalText(row.id, 'request_text', row.request_text_enc) : null,
          decision_text: await decryptApprovalText(row.id, 'decision_text', row.decision_text_enc)
        });
      }
      return reply.send({ approvals });
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
      if (entries.some(entry => entry.note_enc)) {
        const dek = await ensureDek(app.db, deps.keyProvider, 'ticket_time_entries.note');
        for (const entry of entries) if (entry.note_enc) {
          entry.note = fieldCipher.decryptField(entry.note_enc, dek, {
            installationId: deps.env.INSTALLATION_ID,
            tableName: 'ticket_time_entries', recordId: entry.id, fieldName: 'note'
          });
        }
      }
      return reply.send({ entries: entries.map(({ note_enc, ...entry }) => entry) });
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
      const period = manualTimeEntryPeriod(parsed.data.minutes, parsed.data.started_at, new Date());
      if (!period) return reply.code(400).send({ error: 'invalid_period' });

      const entryId = randomUUID();
      await app.db.insertInto('ticket_time_entries').values({
        id: entryId,
        ticket_id: id,
        user_id: session.uid,
        username: session.username,
        minutes: parsed.data.minutes,
        note: parsed.data.note ?? null,
        started_at: period.started_at,
        ended_at: period.ended_at
      }).execute();
      return reply.code(201).send({ id: entryId });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/tickets/:id/time-entries/:entryId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id, entryId } = req.params as { id: string; entryId: string };
      await app.db.deleteFrom('ticket_time_entries').where('id', '=', entryId).where('ticket_id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Teilaufgaben (Todos) ---

  async function loadTodoDek() {
    return ensureDek(app.db, deps.keyProvider, 'ticket_todos.content');
  }
  function todoCtx(recordId: string) {
    return {
      installationId: deps.env.INSTALLATION_ID,
      tableName: 'ticket_todos',
      recordId,
      fieldName: 'content'
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
      const todos = rows.map(row => ({ ...row, content: fieldCipher.decryptField(row.content, dek, todoCtx(row.id)) }));
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

      const assignee = await todoAssignee(id, parsed.data.assignee_user_id, parsed.data.assignee_username);
      const todoId = randomUUID();
      const dek = await loadTodoDek();
      await app.db.insertInto('ticket_todos').values({
        id: todoId,
        ticket_id: id,
        content: fieldCipher.encryptField(parsed.data.content, dek, todoCtx(todoId)),
        ...assignee,
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
      const { id, todoId } = req.params as { id: string; todoId: string };
      const parsed = updateTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const todo = await app.db.selectFrom('ticket_todos').select(['id', 'assignee_user_id']).where('id', '=', todoId).where('ticket_id', '=', id).executeTakeFirst();
      if (!todo) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && todo.assignee_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const updates: Record<string, unknown> = {};
      if (isAdmin && parsed.data.content !== undefined) {
        const dek = await loadTodoDek();
        updates.content = fieldCipher.encryptField(parsed.data.content, dek, todoCtx(todoId));
      }
      if (isAdmin && (parsed.data.assignee_user_id !== undefined || parsed.data.assignee_username !== undefined)) {
        Object.assign(updates, await todoAssignee(id, parsed.data.assignee_user_id, parsed.data.assignee_username));
      }
      if (parsed.data.done !== undefined) {
        updates.done = parsed.data.done;
        // Zeigt in der Oberfläche an, wann die Teilaufgabe erledigt wurde; beim erneuten
        // Öffnen (done=false) wird der Zeitpunkt wieder entfernt, da sie dann nicht mehr erledigt ist.
        updates.done_at = parsed.data.done ? mysqlTimestamp() : null;
      }

      if (Object.keys(updates).length > 0) {
        await app.db.updateTable('ticket_todos').set(updates).where('id', '=', todoId).where('ticket_id', '=', id).execute();
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/tickets/:id/todos/:todoId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id, todoId } = req.params as { id: string; todoId: string };
      await app.db.deleteFrom('ticket_todos').where('id', '=', todoId).where('ticket_id', '=', id).execute();
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

      const ticket = await app.db.selectFrom('tickets').select(['id', 'ticket_number']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const previousParticipants = new Set(await participantIds(id));

      // Security-Audit R-28: Beteiligte brauchen Lesezugriff -- den haben nur aktive Admin-Konten.
      const requested = [...new Set(parsed.data.user_ids)];
      const users = requested.length
        ? await app.db.selectFrom('users').select(['id', 'username']).where('id', 'in', requested)
          .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false).execute()
        : [];
      if (users.length !== requested.length) return reply.code(400).send({ error: 'invalid_participant' });

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
      await notifyMany(users.map(u => u.id).filter(uid => !previousParticipants.has(uid)), { type: 'ticketAssigned', ticketId: id,
        ticketNumber: ticket.ticket_number, actorUserId: session.uid,
        message: `Du wurdest als beteiligte Person zu Ticket ${ticket.ticket_number} hinzugefügt.` });
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
      const visible = [];
      for (const row of rows) if (await canAccessTicket(app.db, session, row.related_ticket_id)) visible.push(row.related_ticket_id);
      return reply.send({ relatedTicketIds: visible });
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
      if (!(await canAccessTicket(app.db, session, other.id))) return reply.code(403).send({ error: 'forbidden' });

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

  // --- Outlook-Kalendertermine ---
  // Legt über Microsoft Graph (App-only, siehe domain/graphClient.ts) einen echten Termin im
  // konfigurierten Postfach an und verknüpft ihn mit dem Ticket -- z.B. um eine SLA-/Custom-
  // Frist direkt als Kalendertermin sichtbar zu machen.

  const createCalendarEventSchema = z.object({
    subject: z.string().trim().min(1).max(512),
    notes: z.string().trim().max(5000).optional(),
    start_at: z.string().min(1),
    end_at: z.string().min(1),
    attendee_emails: z.array(z.string().trim().email()).max(20).optional()
  });

  app.get('/api/v2/tickets/:id/calendar-events', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const events = await app.db.selectFrom('ticket_calendar_events').selectAll().where('ticket_id', '=', id).orderBy('start_at', 'asc').execute();
      return reply.send({ events });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/tickets/:id/calendar-event', { config: { rateLimit: {
    max: 20, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip
  } } }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      await requireModule(app.db, 'outlook');
      const { id } = req.params as { id: string };
      const parsed = createCalendarEventSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      // Explicit, rate-limited admin invitations may include validated external addresses.

      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      const startAt = new Date(parsed.data.start_at);
      const endAt = new Date(parsed.data.end_at);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        return reply.code(400).send({ error: 'invalid_time_range' });
      }

      // Security-Audit R-7: Einladungen aus dem gemeinsamen Firmenpostfach nur an aktive Konten dieser
      // Installation oder an ausdruecklich freigegebene Partnerdomains (Systemeinstellungen > Outlook).
      const attendees = [...new Set((parsed.data.attendee_emails ?? []).map(email => email.toLowerCase()))];
      const attendeeDomains = [...new Set(attendees.map(email => email.split('@').pop()!))];
      if (attendees.length) {
        const settingsRow = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
        let allowedDomains: string[] = [];
        try { allowedDomains = JSON.parse(settingsRow?.config_json || '{}').outlookConfig?.externalDomains ?? []; } catch { allowedDomains = []; }
        const allowed = new Set(allowedDomains.map(domain => String(domain).toLowerCase()));
        const blindDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
        const candidates = (email: string) => blindIndexCandidates(blindDek, email);
        const known = new Set((await app.db.selectFrom('users').select('email_blind_idx')
          .where('email_blind_idx', 'in', attendees.flatMap(candidates)).where('account_archived', '=', false).execute()).map(row => row.email_blind_idx));
        const rejected = attendees.filter(email => !candidates(email).some(hash => known.has(hash)) && !allowed.has(email.split('@').pop()!));
        if (rejected.length) {
          return reply.code(403).send({ error: 'attendee_domain_not_allowed', domains: [...new Set(rejected.map(email => email.split('@').pop()))] });
        }
      }

      const outlook = await loadOutlookSettings(app.db, deps.env, deps.keyProvider);
      if (!outlook) return reply.code(409).send({ error: 'outlook_not_configured' });

      let accessToken: string;
      try {
        accessToken = await getGraphAccessToken(outlook.tenantId, outlook.clientId, outlook.clientSecret);
      } catch {
        return reply.code(502).send({ error: 'outlook_auth_failed' });
      }

      let created;
      try {
        created = await createCalendarEvent(accessToken, outlook.mailbox, {
          subject: parsed.data.subject,
          bodyText: parsed.data.notes || `Ticket ${id}`,
          startAt, endAt,
          attendeeEmails: attendees.length ? attendees : undefined
        });
      } catch {
        return reply.code(502).send({ error: 'outlook_event_create_failed' });
      }

      const eventId = randomUUID();
      await app.db.insertInto('ticket_calendar_events').values({
        id: eventId, ticket_id: id, graph_event_id: created.graphEventId, web_link: created.webLink,
        subject: parsed.data.subject, start_at: mysqlTimestamp(startAt), end_at: mysqlTimestamp(endAt),
        created_by_user_id: session.uid
      }).execute();
      // Security-Audit R-13: der Betreff landet schon in ticket_calendar_events -- nicht nochmal
      // im Klartext im Audit-Log.
      await app.db.insertInto('ticket_audit_log').values({
        id: randomUUID(), ticket_id: id, actor_user_id: session.uid, actor_username: session.username,
        action: 'calendar_event_created', field: 'calendar_event', old_value: null,
        new_value: attendees.length ? `(Termin angelegt, ${attendees.length} Teilnehmende: ${attendeeDomains.join(', ')})`.slice(0, 1000) : '(Termin angelegt)'
      }).execute();
      return reply.code(201).send({ id: eventId, webLink: created.webLink });
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
      // Security-Audit R-30: Quelle und Ziel -- sonst liesse sich ein fremdes Ticket in ein eigenes ziehen.
      if (await canAccessTicket(app.db, session, id) === false || await canAccessTicket(app.db, session, parsed.data.target_ticket_id) === false) {
        return reply.code(404).send({ error: 'not_found' });
      }

      // Security-Audit N11: lief bisher als Folge unabhängiger Einzel-Updates ohne Transaktion --
      // ein Fehler/Absturz mittendrin konnte Nachrichten/Notizen bereits auf das Zielticket
      // verschoben haben, während andere Tabellen (Anhänge, Teilaufgaben, ...) noch beim
      // Ursprungsticket standen oder dieses nie als zusammengeführt markiert wurde. Zeilensperre
      // (FOR UPDATE) auf beiden Tickets verhindert zusätzlich, dass ein gleichzeitiger zweiter
      // Merge-Versuch auf dasselbe Ticket eine inkonsistente Doppel-Zusammenführung erzeugt.
      await app.db.transaction().execute(async trx => {
        const source = await trx.selectFrom('tickets').select(['id', 'ticket_number', 'merged_into_ticket_id', 'created_by_user_id']).where('id', '=', id).forUpdate().executeTakeFirst();
        const target = await trx.selectFrom('tickets').select(['id', 'ticket_number', 'created_by_user_id', 'merged_into_ticket_id']).where('id', '=', parsed.data.target_ticket_id).forUpdate().executeTakeFirst();
        if (!source || !target) throw { statusCode: 404, message: 'not_found' };
        if (source.merged_into_ticket_id) throw { statusCode: 409, message: 'already_merged' };
        if (target.merged_into_ticket_id) throw { statusCode: 409, message: 'target_already_merged' };

        // Security-Audit N11: nach dem Zusammenführen sieht, wer Zugriff auf das Zielticket hat,
        // auch alle Nachrichten/Notizen, die vorher nur im Ursprungsticket standen -- bei
        // unterschiedlichen Ersteller-Konten würde private Kommunikation offengelegt.
        // Deshalb auch für Superadmins nur innerhalb desselben bekannten Kontos zulassen.
        if (!source.created_by_user_id || source.created_by_user_id !== target.created_by_user_id) {
          throw { statusCode: 403, message: 'cross_user_merge_forbidden' };
        }

        await trx.updateTable('ticket_messages').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        await trx.updateTable('ticket_notes').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        await trx.updateTable('ticket_todos').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        await trx.updateTable('ticket_time_entries').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        await trx.updateTable('ticket_work_timers').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        await trx.updateTable('attachments').set({ ticket_id: target.id }).where('ticket_id', '=', source.id).execute();
        // Beteiligte: direktes Umhängen könnte den Unique-Index (ticket_id, user_id) verletzen,
        // falls dieselbe Person bei beiden Tickets beteiligt ist -- deshalb per IGNORE kopieren statt verschieben.
        const sourceParticipants = await trx.selectFrom('ticket_participants').select(['user_id', 'username']).where('ticket_id', '=', source.id).execute();
        if (sourceParticipants.length) {
          await trx.insertInto('ticket_participants')
            .values(sourceParticipants.map(p => ({ id: randomUUID(), ticket_id: target.id, user_id: p.user_id, username: p.username })))
            .onDuplicateKeyUpdate({ ticket_id: target.id })
            .execute();
        }
        await trx.deleteFrom('ticket_participants').where('ticket_id', '=', source.id).execute();

        await trx.updateTable('tickets').set({
          archived_at: mysqlTimestamp(), merged_into_ticket_id: target.id, updated_at: mysqlTimestamp()
        }).where('id', '=', source.id).execute();
        await trx.updateTable('tickets').set({ updated_at: mysqlTimestamp() }).where('id', '=', target.id).execute();

        await trx.insertInto('ticket_audit_log').values({
          id: randomUUID(), ticket_id: source.id, actor_user_id: session.uid, actor_username: session.username,
          action: 'merged_into', field: 'merged_into_ticket_id', old_value: null, new_value: target.id
        }).execute();
        await trx.insertInto('ticket_audit_log').values({
          id: randomUUID(), ticket_id: target.id, actor_user_id: session.uid, actor_username: session.username,
          action: 'merged_from', field: 'merged_into_ticket_id', old_value: null, new_value: source.id
        }).execute();
      });
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
