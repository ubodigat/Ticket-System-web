/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Notifications, Account-Requests, Attachments, Audit-Log API
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireSession, requireAdmin } from './session.js';
import { routeError } from './routeError.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { sendMailSafe } from '../../mail/mailer.js';

export interface ExtrasRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const accountRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(255),
  company: z.string().trim().max(255).optional(),
  reason: z.string().trim().max(5000).optional()
});

const createNotificationSchema = z.object({
  recipient_user_ids: z.array(z.string().min(1)).min(1).max(200),
  type: z.string().trim().min(1).max(64),
  ticket_id: z.string().optional(),
  message: z.string().trim().min(1).max(2000)
});

const attachmentSchema = z.object({
  ticket_id: z.string().min(1),
  message_id: z.string().optional(),
  note_id: z.string().optional(),
  filename: z.string().trim().min(1).max(255).refine(
    name => !/[<>:"/\\|?*\x00-\x1F]/.test(name),
    'Ungültiger Dateiname'
  ),
  mime_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().nonnegative().max(15 * 1024 * 1024),
  data_b64: z.string().min(1)
});

// Von anderen Routen (z.B. tickets.ts) genutzt, um Benachrichtigungen anzulegen -- Inhalt wird
// genauso verschlüsselt wie jedes andere Pflichtfeld (docs §6.8 "Benachrichtigungstexte").
export async function createNotification(
  app: FastifyInstance,
  deps: ExtrasRouteDeps,
  params: { recipientUserId: string | null; recipientUsername: string; type: string; ticketId?: string | null; ticketNumber?: string | null; message: string }
): Promise<void> {
  const id = randomUUID();
  const dek = await ensureDek(app.db, deps.keyProvider, 'notifications.message');
  const encrypted = fieldCipher.encryptField(params.message, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'notifications',
    recordId: id,
    fieldName: 'message',
    keyVersion: dek.keyVersion
  });
  await app.db.insertInto('notifications').values({
    id,
    recipient_user_id: params.recipientUserId,
    recipient_username: params.recipientUsername,
    type: params.type,
    ticket_id: params.ticketId ?? null,
    ticket_number: params.ticketNumber ?? null,
    message: encrypted,
    is_read: false
  }).execute();

  // E-Mail-Zustellung ist best-effort und blockiert die In-App-Benachrichtigung nie (siehe
  // sendMailSafe) -- ohne konfiguriertes SMTP oder ohne hinterlegte E-Mail passiert einfach nichts.
  if (params.recipientUserId) {
    const recipient = await app.db.selectFrom('users').select('email_enc').where('id', '=', params.recipientUserId).executeTakeFirst();
    if (recipient?.email_enc) {
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const email = fieldCipher.decryptField(recipient.email_enc, emailDek.rawDek, {
        installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'users', recordId: params.recipientUserId, fieldName: 'email', keyVersion: emailDek.keyVersion
      });
      await sendMailSafe(
        { db: app.db, env: deps.env, keyProvider: deps.keyProvider },
        email,
        params.ticketNumber ? `Ticket ${params.ticketNumber}` : 'Benachrichtigung',
        params.message
      );
    }
  }
}

export function registerExtrasV2Routes(app: FastifyInstance, deps: ExtrasRouteDeps): void {

  // --- Benachrichtigungen ---

  // GET /api/v2/notifications - Eigene Benachrichtigungen
  app.get('/api/v2/notifications', async (req, reply) => {
    try {
      const session = requireSession(req);
      const rows = await app.db.selectFrom('notifications')
        .selectAll()
        .where('recipient_username', '=', session.username)
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute();
      const dek = await ensureDek(app.db, deps.keyProvider, 'notifications.message');
      const notifications = rows.map(row => ({
        ...row,
        message: row.message
          ? fieldCipher.decryptField(row.message, dek.rawDek, {
              installationId: deps.env.INSTALLATION_ID,
              schemaVersion: deps.env.SCHEMA_VERSION,
              tableName: 'notifications',
              recordId: row.id,
              fieldName: 'message',
              keyVersion: dek.keyVersion
            })
          : null
      }));
      return reply.send({ notifications });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/notifications - nur Admin: gezielt Benachrichtigungen an bestimmte Konten
  // anlegen (z.B. Statusänderung, Vertretungswechsel). Kein offener Endpunkt für beliebige
  // Benutzer, sonst könnte sich jede Person beliebige Benachrichtigungen unterschieben.
  app.post('/api/v2/notifications', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = createNotificationSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const ticket = parsed.data.ticket_id
        ? await app.db.selectFrom('tickets').select('ticket_number').where('id', '=', parsed.data.ticket_id).executeTakeFirst()
        : null;
      const recipients = await app.db.selectFrom('users').select(['id', 'username'])
        .where('id', 'in', parsed.data.recipient_user_ids).execute();

      for (const r of recipients) {
        if (r.id === session.uid) continue;
        await createNotification(app, deps, {
          recipientUserId: r.id,
          recipientUsername: r.username,
          type: parsed.data.type,
          ticketId: parsed.data.ticket_id ?? null,
          ticketNumber: ticket?.ticket_number ?? null,
          message: parsed.data.message
        });
      }
      return reply.code(201).send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/notifications/:id/read - Als gelesen markieren
  app.post('/api/v2/notifications/:id/read', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      // Nur eigene Benachrichtigungen markieren (IDOR-Schutz)
      await app.db.updateTable('notifications')
        .set({ is_read: true })
        .where('id', '=', id)
        .where('recipient_username', '=', session.username)
        .execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/notifications/read-all
  app.post('/api/v2/notifications/read-all', async (req, reply) => {
    try {
      const session = requireSession(req);
      await app.db.updateTable('notifications')
        .set({ is_read: true })
        .where('recipient_username', '=', session.username)
        .execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/notifications/:id - nur eigene (IDOR-Schutz über recipient_username)
  app.delete('/api/v2/notifications/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('notifications')
        .where('id', '=', id)
        .where('recipient_username', '=', session.username)
        .execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/notifications - alle eigenen löschen
  app.delete('/api/v2/notifications', async (req, reply) => {
    try {
      const session = requireSession(req);
      await app.db.deleteFrom('notifications')
        .where('recipient_username', '=', session.username)
        .execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Konto-Anfragen ---

  // POST /api/v2/account-requests - Neue Anfrage (ohne Login). Eigenes, engeres Limit, da
  // öffentlich und unauthentifiziert erreichbar (Spam/Enumeration-Eindämmung).
  app.post('/api/v2/account-requests', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = accountRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const id = randomUUID();
    const nameDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.name');
    const emailDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.email');
    const ctx = (fieldName: string, keyVersion: number) => ({
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'account_requests',
      recordId: id,
      fieldName,
      keyVersion
    });
    await app.db.insertInto('account_requests').values({
      id,
      name: fieldCipher.encryptField(parsed.data.name, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
      email: fieldCipher.encryptField(parsed.data.email, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
      company: parsed.data.company ?? null,
      reason: parsed.data.reason ?? null,
      status: 'pending',
      installation_id: deps.env.INSTALLATION_ID
    }).execute();
    return reply.code(201).send({ success: true });
  });

  // GET /api/v2/account-requests - Alle Anfragen (nur Admin)
  app.get('/api/v2/account-requests', async (req, reply) => {
    try {
      requireAdmin(req);
      const rows = await app.db.selectFrom('account_requests')
        .selectAll().orderBy('created_at', 'desc').execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.email');
      const requests = rows.map(row => {
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID,
          schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'account_requests',
          recordId: row.id,
          fieldName,
          keyVersion
        });
        return {
          ...row,
          name: fieldCipher.decryptField(row.name, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
          email: fieldCipher.decryptField(row.email, emailDek.rawDek, ctx('email', emailDek.keyVersion))
        };
      });
      return reply.send({ requests });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/account-requests/:id - Anfrage annehmen/ablehnen (nur Admin)
  app.patch('/api/v2/account-requests/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = z.object({ status: z.enum(['approved', 'rejected']) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      await app.db.updateTable('account_requests')
        .set({ status: parsed.data.status, reviewed_by_user_id: session.uid, updated_at: new Date().toISOString() })
        .where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Datei-Anhänge ---

  const attachmentCtx = (fieldName: string, recordId: string, keyVersion: number) => ({
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'attachments',
    recordId,
    fieldName,
    keyVersion
  });

  // GET /api/v2/attachments/:id - Anhang abrufen (Auth erforderlich + Ticket-Prüfung)
  app.get('/api/v2/attachments/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const attachment = await app.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
      if (!attachment) return reply.code(404).send({ error: 'not_found' });

      // IDOR: Wenn Ticket-Anhang, prüfen ob User Zugang zum Ticket hat
      if (attachment.ticket_id) {
        const ticket = await app.db.selectFrom('tickets').select('created_by_user_id').where('id', '=', attachment.ticket_id).executeTakeFirst();
        const isAdmin = session.role === 'admin' || session.role === 'superadmin';
        if (ticket && !isAdmin && ticket.created_by_user_id !== session.uid) {
          return reply.code(403).send({ error: 'forbidden' });
        }
      }

      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'attachments.data');
      const filename = fieldCipher.decryptField(attachment.filename, filenameDek.rawDek, attachmentCtx('filename', attachment.id, filenameDek.keyVersion));
      const data_b64 = fieldCipher.decryptField(attachment.data_b64, dataDek.rawDek, attachmentCtx('data', attachment.id, dataDek.keyVersion));

      return reply.send({ attachment: { ...attachment, filename, data_b64 } });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/attachments - Anhang hochladen
  app.post('/api/v2/attachments', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = attachmentSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      // IDOR-Schutz: nur anhängen, wer das Ticket sehen darf (fehlte bisher komplett --
      // jede angemeldete Person hätte Dateien an ein beliebiges fremdes Ticket hängen können).
      const ticket = await app.db.selectFrom('tickets').select(['id', 'created_by_user_id']).where('id', '=', parsed.data.ticket_id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'ticket_not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && ticket.created_by_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });

      // Sicherheit: Gefährliche MIME-Typen ablehnen
      // image/svg+xml wird ausgefuehrt, sobald es direkt (z.B. ueber einen blob:-Link im neuen
      // Tab) im Browser geoeffnet wird -- eingebettetes <script> laeuft dann same-origin mit der
      // Session der oeffnenden Person (gespeicherte XSS via Anhang).
      const blockedMime = ['text/html', 'application/javascript', 'application/x-php', 'application/x-sh', 'image/svg+xml'];
      if (blockedMime.includes(parsed.data.mime_type.toLowerCase())) {
        return reply.code(400).send({ error: 'blocked_mime_type' });
      }

      // Sicherheit: Dateierweiterungen prüfen
      const blockedExtensions = ['.exe', '.php', '.sh', '.bat', '.cmd', '.ps1', '.py', '.rb', '.js', '.html', '.svg', '.svgz', '.htm', '.xhtml'];
      const ext = parsed.data.filename.toLowerCase().split('.').pop() ?? '';
      if (blockedExtensions.includes('.' + ext)) {
        return reply.code(400).send({ error: 'blocked_extension' });
      }

      const id = randomUUID();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'attachments.data');
      await app.db.insertInto('attachments').values({
        id,
        ticket_id: parsed.data.ticket_id,
        message_id: parsed.data.message_id ?? null,
        note_id: parsed.data.note_id ?? null,
        uploaded_by_user_id: session.uid,
        uploaded_by_username: session.username,
        filename: fieldCipher.encryptField(parsed.data.filename, filenameDek.rawDek, attachmentCtx('filename', id, filenameDek.keyVersion)),
        mime_type: parsed.data.mime_type,
        size_bytes: parsed.data.size_bytes,
        data_b64: fieldCipher.encryptField(parsed.data.data_b64, dataDek.rawDek, attachmentCtx('data', id, dataDek.keyVersion))
      }).execute();

      return reply.code(201).send({ id, filename: parsed.data.filename, size_bytes: parsed.data.size_bytes, mime_type: parsed.data.mime_type });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Globales Audit-Log ---
  // GET /api/v2/audit-log (nur Admin)
  app.get('/api/v2/audit-log', async (req, reply) => {
    try {
      requireAdmin(req);
      const log = await app.db.selectFrom('global_audit_log')
        .selectAll().orderBy('created_at', 'desc').limit(500).execute();
      return reply.send({ log });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Gespeicherte Listenansichten ---
  // Eigene Ansichten + von anderen geteilte (is_shared) -- keine Verschlüsselung nötig, enthält
  // nur Filterwerte (Status/Priorität/Kategorie/...), keine personenbezogenen Freitexte.

  app.get('/api/v2/list-views', async (req, reply) => {
    try {
      const session = requireSession(req);
      const rows = await app.db.selectFrom('list_views')
        .selectAll()
        .where((eb) => eb.or([eb('owner_user_id', '=', session.uid), eb('is_shared', '=', true)]))
        .orderBy('created_at', 'asc').execute();
      const views = rows.map(row => ({ ...row, filters: JSON.parse(row.filters_json) }));
      return reply.send({ views });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const createListViewSchema = z.object({
    name: z.string().trim().min(1).max(128),
    filters: z.record(z.unknown()),
    is_shared: z.boolean().default(false)
  });

  app.post('/api/v2/list-views', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = createListViewSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const id = randomUUID();
      await app.db.insertInto('list_views').values({
        id, name: parsed.data.name, owner_user_id: session.uid,
        filters_json: JSON.stringify(parsed.data.filters), is_shared: parsed.data.is_shared
      }).execute();
      return reply.code(201).send({ id });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/list-views/:id - nur die eigene Person (Besitzer) oder Admin
  app.delete('/api/v2/list-views/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const view = await app.db.selectFrom('list_views').select('owner_user_id').where('id', '=', id).executeTakeFirst();
      if (!view) return reply.code(404).send({ error: 'not_found' });
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && view.owner_user_id !== session.uid) return reply.code(403).send({ error: 'forbidden' });
      await app.db.deleteFrom('list_views').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

}
