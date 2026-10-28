import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Lesezugriffe auf besonders schuetzenswerte Daten: Exporte, Dateien, Zugangskonfiguration, Protokolle.
const SENSITIVE_READS = new Set([
  'GET /api/v2/users/export.csv', 'GET /api/v2/attachments/:id', 'GET /api/v2/attachments/:id/preview',
  'GET /api/v2/attachments/:id/office-view', 'GET /api/v2/uploads/:id/content', 'GET /api/v2/kb/attachments/:attachmentId',
  'GET /api/v2/settings/smtp', 'GET /api/v2/settings/ldap', 'GET /api/v2/settings/outlook', 'GET /api/v2/outlook/callback',
  'GET /api/v2/audit-log', 'GET /api/v2/tickets/:id/audit-log', 'GET /api/v2/system/info'
]);
// Schreiben eigene, ausfuehrlichere Eintraege (inkl. eingegebenem Benutzernamen bei Fehlschlaegen).
const OWN_ENTRIES = new Set(['POST /api/v1/auth/login', 'POST /api/v1/auth/mfa-verify']);
// Schreiben bei Erfolg bereits einen fachlichen Eintrag -- hier nur noch Fehlschlaege/Ablehnungen.
const AUDITED_ON_SUCCESS = new Set([
  'POST /api/v2/users', 'DELETE /api/v2/users/:id', 'POST /api/v2/users/:id/mfa-reset', 'POST /api/v2/users/:id/change-password',
  'POST /api/v2/users/import.csv', 'POST /api/v2/groups', 'PATCH /api/v2/groups/:id', 'DELETE /api/v2/groups/:id',
  'PATCH /api/v2/settings', 'PATCH /api/v2/settings/smtp', 'PATCH /api/v2/settings/outlook/secret', 'PATCH /api/v2/settings/ldap',
  'POST /api/v2/categories', 'PATCH /api/v2/categories/:id', 'POST /api/v2/mail/send', 'POST /api/v2/mfa/disable',
  'POST /api/v2/update/run', 'POST /api/v2/update/migrate', 'POST /api/v2/update/rollback'
]);
// Technische Zwischenschritte: Erfolg ohne eigenen Eintrag (der Abschluss wird protokolliert).
const QUIET_ON_SUCCESS = new Set([
  'PUT /api/v2/uploads/:id/chunks/:part', 'POST /api/v2/mfa/login/status', 'POST /api/v2/mfa/passkeys/options', 'POST /api/v2/mfa/login/finish'
]);

// Ticket-Protokoll: diese Routen schreiben bei Erfolg bereits einen eigenen, ausfuehrlicheren
// Ticket-Eintrag (z.B. "Status: Neu -> In Bearbeitung") -- dann kein zweiter, allgemeiner Eintrag.
const TICKET_AUDITED_ON_SUCCESS = new Set([
  'POST /api/v2/tickets', 'PATCH /api/v2/tickets/:id', 'POST /api/v2/tickets/:id/link-incident',
  'POST /api/v2/tickets/:id/request-approval', 'POST /api/v2/tickets/:id/approval-decision',
  'PUT /api/v2/tickets/:id/participants', 'POST /api/v2/tickets/:id/related', 'POST /api/v2/tickets/:id/calendar-event',
  'POST /api/v2/tickets/:id/merge'
]);
// Jedes Oeffnen des Ticket-Protokolls waere sonst selbst ein Eintrag darin (steht im Systemprotokoll).
const TICKET_LOG_EXCLUDED = new Set(['GET /api/v2/tickets/:id/audit-log']);
const TICKET_ID_FROM_BODY = new Set(['POST /api/v2/attachments', 'POST /api/v2/uploads', 'POST /api/v2/work-timer']);

// Zu welchem Ticket gehoert die Aktion? Nur die ID wird aus dem Body gelesen, nie Inhalte.
async function resolveTicketId(db: Kysely<Database>, req: FastifyRequest, route: string, key: string,
  params: Record<string, string>): Promise<string | null> {
  const fromHandler = req.auditDetail?.ticketId;
  if (typeof fromHandler === 'string') return fromHandler;
  if (route.startsWith('/api/v2/tickets/:id')) return params.id ?? null;
  if (TICKET_ID_FROM_BODY.has(key)) {
    const body = (req.body ?? {}) as { ticket_id?: unknown; ticketId?: unknown };
    const value = body.ticket_id ?? body.ticketId;
    return typeof value === 'string' && value.length <= 36 ? value : null;
  }
  if (!params.id) return null;
  if (route.startsWith('/api/v2/attachments/:id')) {
    return (await db.selectFrom('attachments').select('ticket_id').where('id', '=', params.id).executeTakeFirst())?.ticket_id ?? null;
  }
  if (route.startsWith('/api/v2/uploads/:id')) {
    return (await db.selectFrom('file_uploads').select('ticket_id').where('id', '=', params.id).executeTakeFirst())?.ticket_id ?? null;
  }
  if (route.startsWith('/api/v2/work-timer/:id')) {
    return (await db.selectFrom('ticket_work_timers').select('ticket_id').where('id', '=', params.id).executeTakeFirst())?.ticket_id ?? null;
  }
  return null;
}

export function shouldRecord(method: string, route: string | undefined, status: number): boolean {
  if (!route || !route.startsWith('/api/')) return false;
  const key = `${method} ${route}`;
  if (!MUTATING.has(method) && !SENSITIVE_READS.has(key)) return false;
  // 429: keine Protokollflut (und damit Datenbanklast) durch abgewiesene Massenanfragen.
  if (OWN_ENTRIES.has(key) || status === 429) return false;
  return !(status < 400 && (AUDITED_ON_SUCCESS.has(key) || QUIET_ON_SUCCESS.has(key)));
}

// Protokolliert nie Request-Bodies (koennten Passwoerter, Tokens oder Inhalte enthalten) -- nur wer,
// was (Methode + Routenmuster), welches Ziel (Pfadparameter), Ergebnis (HTTP-Status) und Quell-IP.
export async function recordActivity(db: Kysely<Database>, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const route = req.routeOptions?.url;
  if (!shouldRecord(req.method, route, reply.statusCode)) return;
  const params = Object.fromEntries(Object.entries((req.params ?? {}) as Record<string, unknown>)
    .map(([key, value]) => [key, String(value).slice(0, 128)]));
  const { ticketId: _handlerTicketId, ...extra } = req.auditDetail ?? {};
  const detail: Record<string, unknown> = { status: reply.statusCode, ip: req.ip,
    ...(Object.keys(params).length ? { params } : {}), ...extra };
  const key = `${req.method} ${route}`;
  const ticketId = await resolveTicketId(db, req, route!, key, params);
  const ticket = ticketId
    ? await db.selectFrom('tickets').select('ticket_number').where('id', '=', ticketId).executeTakeFirst()
    : undefined;
  if (ticket && detail.ticket === undefined) detail.ticket = ticket.ticket_number;
  const session = req.ticketSession;
  await db.insertInto('global_audit_log').values({
    id: randomUUID(),
    actor_user_id: session?.uid ?? null,
    actor_username: (session?.username ?? '-').slice(0, 64),
    action: `request:${req.method} ${route}`.slice(0, 128),
    target_type: 'request',
    target_id: params.id ?? params.attachmentId ?? null,
    detail_json: JSON.stringify(detail)
  }).execute();
  // Zusaetzlich im Protokoll des betroffenen Tickets (nur wenn das Ticket existiert -- Fremdschluessel).
  if (ticketId && ticket && !TICKET_LOG_EXCLUDED.has(key) && !(reply.statusCode < 400 && TICKET_AUDITED_ON_SUCCESS.has(key))) {
    await db.insertInto('ticket_audit_log').values({
      id: randomUUID(), ticket_id: ticketId,
      actor_user_id: session?.uid ?? null,
      actor_username: (session?.username ?? '-').slice(0, 64),
      action: `activity:${key}`.slice(0, 128),
      field: null, old_value: null,
      new_value: reply.statusCode >= 400 ? `HTTP ${reply.statusCode}` : null
    }).execute();
  }
}
