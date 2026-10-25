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
import { fieldCipher, computeBlindIndex, decryptFieldTolerant } from '../../crypto/fieldCrypto.js';
import { queueMail as sendMail, queueMailIfConfigured as sendMailSafe, queueUserMail } from '../../mail/queue.js';
import { mysqlTimestamp } from '../../db/date.js';
import { convertOfficePreview, discardOfficePreview } from '../../documents/officePreview.js';
import { validateUploadedFile } from '../../domain/fileValidation.js';
import { scanIfConfigured } from '../../domain/antivirus.js';

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

const sendMailSchema = z.object({
  to: z.string().email().max(255),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(50000)
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
  if (!params.recipientUserId) return;
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

  // E-Mail-Zustellung ist best-effort und blockiert die In-App-Benachrichtigung nie.
  // Security-Audit R-15: ein Fehler beim Einreihen (DB-Fehler, kaputtes JSON in
  // notif_prefs_json, ...) liess bisher den ganzen Aufruf durchschlagen -- ein bereits
  // gespeicherter Vorgang (neues Ticket, Statuswechsel) endete dadurch trotzdem mit HTTP 500,
  // obwohl die In-App-Benachrichtigung oben schon erfolgreich angelegt war. Jetzt nur noch
  // geloggt, nie mehr nach aussen durchgereicht.
  try {
    await queueUserMail({ db: app.db, ...deps }, params.recipientUserId,
      params.ticketNumber ? `Ticket ${params.ticketNumber}` : 'Benachrichtigung', params.message, params.type);
  } catch (err) {
    app.log.error({ err, recipientUserId: params.recipientUserId }, 'Mail konnte nicht eingereiht werden');
  }
}

export function registerExtrasV2Routes(app: FastifyInstance, deps: ExtrasRouteDeps): void {
  async function hasAdminPermission(session: { uid: string; role: string }, key: 'canManageRequests' | 'canViewLogs'): Promise<boolean> {
    if (session.role === 'superadmin') return true;
    if (session.role !== 'admin') return false;
    const row = await app.db.selectFrom('users').select('permissions_json').where('id', '=', session.uid).executeTakeFirst();
    let permissions: Record<string, unknown> = {};
    try { permissions = row?.permissions_json ? JSON.parse(row.permissions_json) : {}; } catch { permissions = {}; }
    return permissions[key] === true;
  }

  // POST /api/v2/mail/send - SMTP-Versand aus der Oberfläche (M-1: gegen offenes Relay gehärtet).
  // Nur für Admins erlaubt; Empfänger muss ein bekanntes Konto der eigenen Instanz sein.
  app.post('/api/v2/mail/send', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = sendMailSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
      const blindIdx = computeBlindIndex(blindIndexDek.rawDek, parsed.data.to.trim().toLowerCase());
      const known = await app.db.selectFrom('users').select('id')
        .where('email_blind_idx', '=', blindIdx).executeTakeFirst();
      if (!known) return reply.code(403).send({ error: 'recipient_not_allowed' });

      await sendMail(
        { db: app.db, env: deps.env, keyProvider: deps.keyProvider },
        parsed.data.to,
        parsed.data.subject,
        parsed.data.body
      );

      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(),
        actor_user_id: session.uid,
        actor_username: session.username,
        action: 'mail.queued',
        target_type: 'user',
        target_id: known.id,
        detail_json: null
      }).execute();

      return reply.send({ success: true });
    } catch (e: any) {
      if (e?.message === 'smtp_not_configured') return reply.code(409).send({ error: 'smtp_not_configured' });
      return routeError(app, reply, e);
    }
  });

  // --- Benachrichtigungen ---

  // GET /api/v2/notifications - Eigene Benachrichtigungen
  app.get('/api/v2/notifications', async (req, reply) => {
    try {
      const session = requireSession(req);
      const rows = await app.db.selectFrom('notifications')
        .selectAll()
        .where('recipient_user_id', '=', session.uid)
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
        .where('recipient_user_id', '=', session.uid)
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
        .where('recipient_user_id', '=', session.uid)
        .execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/notifications/:id - nur eigene (IDOR-Schutz über recipient_user_id)
  app.delete('/api/v2/notifications/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('notifications')
        .where('id', '=', id)
        .where('recipient_user_id', '=', session.uid)
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
        .where('recipient_user_id', '=', session.uid)
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
    // Security-Audit N10-Rest: company/reason sind Freitextfelder (koennen personenbezogene
    // Angaben enthalten) und werden jetzt genauso verschluesselt wie name/email.
    const companyDek = parsed.data.company ? await ensureDek(app.db, deps.keyProvider, 'account_requests.company') : null;
    const reasonDek = parsed.data.reason ? await ensureDek(app.db, deps.keyProvider, 'account_requests.reason') : null;
    await app.db.insertInto('account_requests').values({
      id,
      name: fieldCipher.encryptField(parsed.data.name, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
      email: fieldCipher.encryptField(parsed.data.email, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
      company: companyDek ? fieldCipher.encryptField(parsed.data.company!, companyDek.rawDek, ctx('company', companyDek.keyVersion)) : null,
      reason: reasonDek ? fieldCipher.encryptField(parsed.data.reason!, reasonDek.rawDek, ctx('reason', reasonDek.keyVersion)) : null,
      status: 'pending',
      installation_id: deps.env.INSTALLATION_ID
    }).execute();
    return reply.code(201).send({ success: true });
  });

  // GET /api/v2/account-requests - Alle Anfragen (nur Admin)
  app.get('/api/v2/account-requests', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageRequests'))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('account_requests')
        .selectAll().orderBy('created_at', 'desc').execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.email');
      const companyDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.company');
      const reasonDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.reason');
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
          email: fieldCipher.decryptField(row.email, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
          // Security-Audit N10-Rest: tolerant, weil bestehende Anfragen aus der Zeit vor Migration
          // 0039 erst durch db/reencryptLegacy.ts nachverschluesselt werden (siehe R-2-Timing).
          company: row.company ? decryptFieldTolerant(row.company, companyDek.rawDek, ctx('company', companyDek.keyVersion)) : null,
          reason: row.reason ? decryptFieldTolerant(row.reason, reasonDek.rawDek, ctx('reason', reasonDek.keyVersion)) : null
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
      if (!(await hasAdminPermission(session, 'canManageRequests'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = z.object({ status: z.enum(['approved', 'rejected']) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      await app.db.updateTable('account_requests')
        .set({ status: parsed.data.status, reviewed_by_user_id: session.uid, updated_at: mysqlTimestamp() })
        .where('id', '=', id).execute();

      // "Konto genehmigt"-Automail (Systemeinstellungen > Benachrichtigungen) -- gab es bisher
      // serverseitig gar nicht, nur die lokale Version vom 07.10.2026 hatte dafuer einen
      // (dort client-seitig wirkungslosen) Schalter. Best-effort wie alle anderen Mails hier.
      if (parsed.data.status === 'approved') {
        const settingsRow = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
        const config = settingsRow?.config_json ? JSON.parse(settingsRow.config_json) : {};
        if (config.notifConfig?.accountApproved) {
          const request = await app.db.selectFrom('account_requests').selectAll().where('id', '=', id).executeTakeFirst();
          if (request) {
            const nameDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.name');
            const emailDek = await ensureDek(app.db, deps.keyProvider, 'account_requests.email');
            const ctx = (fieldName: string, keyVersion: number) => ({
              installationId: deps.env.INSTALLATION_ID,
              schemaVersion: deps.env.SCHEMA_VERSION,
              tableName: 'account_requests',
              recordId: request.id,
              fieldName,
              keyVersion
            });
            const email = fieldCipher.decryptField(request.email, emailDek.rawDek, ctx('email', emailDek.keyVersion));
            const name = fieldCipher.decryptField(request.name, nameDek.rawDek, ctx('name', nameDek.keyVersion));
            await sendMailSafe(
              { db: app.db, env: deps.env, keyProvider: deps.keyProvider },
              email,
              'Dein Konto wurde freigeschaltet',
              `Hallo ${name},\n\ndein Konto wurde freigeschaltet. Du kannst dich jetzt anmelden.`
            );
          }
        }
      }
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
  app.delete('/api/v2/attachments/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      const attachment = await app.db.selectFrom('attachments').select(['id', 'ticket_id', 'uploaded_by_user_id']).where('id', '=', id).executeTakeFirst();
      if (!attachment) return reply.code(404).send({ error: 'not_found' });
      if (attachment.uploaded_by_user_id !== actor.uid) return reply.code(403).send({ error: 'forbidden' });
      await app.db.deleteFrom('attachments').where('id', '=', id).where('uploaded_by_user_id', '=', actor.uid).execute();
      discardOfficePreview(id);
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });

  app.get('/api/v2/attachments/:id/preview', async (req, reply) => {
    try {
      const actor = requireSession(req);
      const { id } = req.params as { id: string };
      const attachment = await app.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
      if (!attachment || !attachment.ticket_id) return reply.code(404).send({ error: 'not_found' });
      const ticket = await app.db.selectFrom('tickets').select('created_by_user_id').where('id', '=', attachment.ticket_id).executeTakeFirst();
      if (!ticket) return reply.code(404).send({ error: 'not_found' });
      if (!['admin', 'superadmin'].includes(actor.role) && ticket.created_by_user_id !== actor.uid) return reply.code(403).send({ error: 'forbidden' });
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'attachments.data');
      const filename = fieldCipher.decryptField(attachment.filename, filenameDek.rawDek, attachmentCtx('filename', id, filenameDek.keyVersion));
      const supported = /\.(pdf|xlsx|xls|ods|docx|doc|odt|pptx|ppt|odp)$/i.test(filename);
      if (!supported) return reply.code(415).send({ error: 'unsupported_preview' });
      if (!/\.pdf$/i.test(filename) && !deps.env.OFFICE_PREVIEW_URL) return reply.code(503).send({ error: 'preview_not_configured' });
      const encoded = fieldCipher.decryptField(attachment.data_b64, dataDek.rawDek, attachmentCtx('data', id, dataDek.keyVersion));
      const original = Buffer.from(encoded, 'base64');
      let pdf: Buffer;
      try { pdf = /\.pdf$/i.test(filename) ? original : await convertOfficePreview(id, filename, original, deps.env.OFFICE_PREVIEW_URL!); }
      catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        return reply.code(status || 503).send({ error: status ? (error as { message: string }).message : 'preview_unavailable' });
      }
      return reply.header('cache-control', 'no-store').header('content-disposition', "inline; filename=preview.pdf")
        .header('content-security-policy', "default-src 'none'; frame-ancestors 'self'")
        .type('application/pdf').send(pdf);
    } catch (error) { return routeError(app, reply, error); }
  });

  // bodyLimit höher als der globale 2MB-Standard (N2 im Security-Audit): Anhänge bis 15MB
  // kommen base64-kodiert im JSON-Body (~33% Overhead) plus Metadaten.
  app.post('/api/v2/attachments', { bodyLimit: 21 * 1024 * 1024 }, async (req, reply) => {
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

      // Zero-Trust-Validierung: Dateiname, Erweiterung, Magic Bytes, Skript-Inhalte und echter MIME-Typ
      const validated = await validateUploadedFile({
        filename: parsed.data.filename,
        declaredMimeType: parsed.data.mime_type,
        dataB64: parsed.data.data_b64,
        maxSizeBytes: 15 * 1024 * 1024
      });

      // Virenscan (B7, optional -- siehe domain/antivirus.ts), erst NACH der günstigeren
      // Magic-Byte-/Inhaltsprüfung oben.
      await scanIfConfigured(deps.env, validated.buffer);

      // Tagesquote pro Konto prüfen (max. 200 MB in 24 Stunden, B7)
      const used = await app.db.selectFrom('attachments')
        .select(eb => eb.fn.sum<number>('size_bytes').as('total'))
        .where('uploaded_by_user_id', '=', session.uid)
        .where('created_at', '>=', new Date(Date.now() - 86400000)).executeTakeFirst();
      if (Number(used?.total ?? 0) + validated.sizeBytes > 200 * 1024 * 1024) {
        return reply.code(429).send({ error: 'upload_quota_exceeded' });
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
        filename: fieldCipher.encryptField(validated.safeFilename, filenameDek.rawDek, attachmentCtx('filename', id, filenameDek.keyVersion)),
        mime_type: validated.mimeType,
        size_bytes: validated.sizeBytes,
        data_b64: fieldCipher.encryptField(parsed.data.data_b64, dataDek.rawDek, attachmentCtx('data', id, dataDek.keyVersion))
      }).execute();

      return reply.code(201).send({ id, filename: validated.safeFilename, size_bytes: validated.sizeBytes, mime_type: validated.mimeType });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Globales Audit-Log ---
  // GET /api/v2/audit-log (nur Admin)
  app.get('/api/v2/audit-log', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canViewLogs'))) return reply.code(403).send({ error: 'forbidden' });
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
    filters: z.record(z.string(), z.unknown()),
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
