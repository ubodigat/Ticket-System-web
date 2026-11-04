/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { SessionContext } from '../http/routes/session.js';

// Wer welches Ticket sehen darf -- serverseitig, nicht nur in der Oberflaeche (vorher filterte nur
// AdminBoard.canAccessTicket; ueber die API bekam jede Admin-Person alle Tickets).
//   - normale Konten: nur eigene Tickets
//   - Superadmin: alle
//   - Admin: eigene, ihr zugewiesene oder beteiligte Tickets und Tickets ihrer Gruppe (inklusive
//     Ober- und Untergruppen). Tickets OHNE Gruppe zusaetzlich, wenn sie niemandem zugewiesen
//     sind oder zur Kategorie "Allgemein" gehoeren. Gruppen sind abgeschottet (Security-Audit
//     R-30): ein nicht zugewiesenes Ticket der Gruppe "Personal" sieht nur, wer zu "Personal"
//     gehoert -- nicht jede Admin-Person.
// Die Regeln entsprechen AdminBoard.canAccessTicket im Frontend.

export interface AccessSession { uid: string; role: string }

export interface AccessTicketRow {
  id: string;
  created_by_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_group_id?: string | null;
  category?: string | null;
}

export interface TicketScope {
  all: boolean;
  uid: string;
  role: string;
  visibleGroupIds: Set<string>;
  participantTicketIds: Set<string> | null;
}

const isStaff = (role: string) => role === 'admin' || role === 'superadmin';

// Eigene Gruppen plus deren Ober- und Untergruppen (wie groupWithDescendants in groups.ts).
export function visibleGroupIds(ownGroupIds: string[], groups: Array<{ id: string; parent_id: string | null }>): Set<string> {
  const parentOf = new Map(groups.map(group => [group.id, group.parent_id]));
  const visible = new Set<string>();
  for (const own of ownGroupIds) {
    for (let current: string | null | undefined = own, guard = 0; current && guard < 32; current = parentOf.get(current), guard++) visible.add(current);
  }
  const queue = [...ownGroupIds];
  for (let index = 0; index < queue.length; index++) {
    for (const group of groups) {
      if (group.parent_id === queue[index] && !queue.includes(group.id)) { queue.push(group.id); visible.add(group.id); }
    }
  }
  return visible;
}

// Sichtbarkeit fuer viele Tickets auf einmal (Listen). participantTicketIds null = alle
// Beteiligungen der Person werden mitgeladen.
export async function loadTicketScope(db: Kysely<Database>, session: AccessSession): Promise<TicketScope> {
  if (session.role !== 'admin') {
    return { all: session.role === 'superadmin', uid: session.uid, role: session.role, visibleGroupIds: new Set(), participantTicketIds: new Set() };
  }
  const [memberships, groups, participations] = await Promise.all([
    db.selectFrom('user_groups').select('group_id').where('user_id', '=', session.uid).execute(),
    db.selectFrom('groups').select(['id', 'parent_id']).execute(),
    db.selectFrom('ticket_participants').select('ticket_id').where('user_id', '=', session.uid).execute()
  ]);
  return {
    all: false, uid: session.uid, role: session.role,
    visibleGroupIds: visibleGroupIds(memberships.map(row => row.group_id), groups),
    participantTicketIds: new Set(participations.map(row => row.ticket_id))
  };
}

export function scopeAllowsTicket(scope: TicketScope, ticket: AccessTicketRow): boolean {
  if (scope.all) return true;
  if (ticket.created_by_user_id && ticket.created_by_user_id === scope.uid) return true;
  if (!isStaff(scope.role)) return false;
  if (ticket.assigned_to_user_id === scope.uid) return true;
  if (scope.participantTicketIds?.has(ticket.id)) return true;
  if (ticket.assigned_group_id) return scope.visibleGroupIds.has(ticket.assigned_group_id);
  return openToAllStaff(ticket);
}

// Ohne Gruppe: nicht zugewiesen oder allgemeine Kategorie.
function openToAllStaff(ticket: AccessTicketRow): boolean {
  return !ticket.assigned_group_id && (!ticket.assigned_to_user_id || !ticket.category || ticket.category === 'Allgemein');
}

// Einzelnes Ticket: null, wenn es nicht existiert (die Route antwortet dann selbst mit 404).
export async function canAccessTicket(db: Kysely<Database>, session: AccessSession, ticketId: string): Promise<boolean | null> {
  const ticket = await db.selectFrom('tickets')
    .select(['id', 'created_by_user_id', 'assigned_to_user_id', 'assigned_group_id', 'category'])
    .where('id', '=', ticketId).executeTakeFirst();
  if (!ticket) return null;
  if (session.role === 'superadmin') return true;
  if (ticket.created_by_user_id === session.uid) return true;
  if (session.role !== 'admin') return false;
  // Schnelle Faelle ohne weitere Abfragen.
  if (ticket.assigned_to_user_id === session.uid || openToAllStaff(ticket)) return true;
  return scopeAllowsTicket(await loadTicketScope(db, session), ticket);
}

// Empfaenger von Ticket-Hinweisen: nur aktive Konten, die das Ticket auch oeffnen duerfen
// (Security-Audit R-30) -- sonst verriete eine Benachrichtigung Nummer und Inhalt fremder Tickets.
export async function recipientsWithAccess(db: Kysely<Database>, ticketId: string, userIds: Array<string | null | undefined>): Promise<string[]> {
  const unique = [...new Set(userIds.filter((value): value is string => !!value))];
  if (!unique.length) return [];
  const users = await db.selectFrom('users').select(['id', 'role']).where('id', 'in', unique).where('account_archived', '=', false).execute();
  const roleOf = new Map(users.map(user => [user.id, user.role]));
  const allowed: string[] = [];
  for (const uid of unique) {
    const role = roleOf.get(uid);
    if (role && await canAccessTicket(db, { uid, role }, ticketId)) allowed.push(uid);
  }
  return allowed;
}

// Zentrale Pruefung fuer JEDE Route unter /api/v2/tickets/:id (Security-Audit R-30): wer das Ticket
// nicht sehen darf, bekommt 404 (verraet nicht, dass es existiert) -- auch fuer Unterrouten (Chat,
// Notizen, Anhaenge, Zeiten, Aufgaben, Beteiligte, verwandte Tickets, Wissensdatenbank,
// Zusammenfuehren). Neue Routen sind automatisch erfasst. Einzige Ausnahme: die
// Genehmigungsentscheidung prueft die eingetragene Person selbst. Die Einzelpruefungen der Routen
// (Rolle, eigenes Ticket) bleiben zusaetzlich bestehen.
export const TICKET_ROUTE = /^\/api\/v2\/tickets\/:id(\/|$)/;
export const TICKET_ACCESS_EXEMPT = new Set(['/api/v2/tickets/:id/approval-decision']);

export function ticketRouteGuard(db: Kysely<Database>) {
  return async function guardTicketRoute(req: FastifyRequest, reply: FastifyReply) {
    const url = req.routeOptions?.url;
    const session: SessionContext | null = req.ticketSession;
    if (!url || !session || !TICKET_ROUTE.test(url) || TICKET_ACCESS_EXEMPT.has(url)) return;
    const id = (req.params as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string') return;
    if (await canAccessTicket(db, session, id) === false) {
      req.log?.warn({ event: 'ticket.access_denied', uid: session.uid, role: session.role, url, method: req.method }, 'Ticketzugriff abgewiesen');
      return reply.code(404).send({ error: 'not_found' });
    }
  };
}

// Ausstehende Genehmigung: die eingetragene Person darf Ticketkopf und direkte Anhaenge lesen
// (nicht Chat, interne Kommunikation oder verwandte Tickets).
export async function isPendingApprover(db: Kysely<Database>, session: AccessSession, ticketId: string): Promise<boolean> {
  const row = await db.selectFrom('tickets').select(['approval_status', 'approval_reviewer_id'])
    .where('id', '=', ticketId).executeTakeFirst();
  return !!row && row.approval_status === 'pending' && row.approval_reviewer_id === session.uid;
}

// Lesen eines Ticket-Anhangs: wer das Ticket sehen darf; Anhaenge interner Notizen nur Admins;
// die pruefende Person einer offenen Genehmigung die direkten Anhaenge. Ohne (noch vorhandenes)
// Ticket nur die hochladende Person.
export async function canReadAttachment(db: Kysely<Database>, session: AccessSession,
  attachment: { ticket_id: string | null; note_id?: string | null; message_id?: string | null; uploaded_by_user_id?: string | null }): Promise<boolean> {
  if (attachment.note_id && !isStaff(session.role)) return false;
  const access = attachment.ticket_id ? await canAccessTicket(db, session, attachment.ticket_id) : null;
  if (access === null) return !!attachment.uploaded_by_user_id && attachment.uploaded_by_user_id === session.uid;
  if (access) return true;
  return !attachment.note_id && !attachment.message_id && await isPendingApprover(db, session, attachment.ticket_id!);
}
