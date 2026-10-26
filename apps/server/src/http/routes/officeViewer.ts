import type { FastifyInstance } from 'fastify';
import type { UsersRouteDeps } from './users.js';
import { requireSession } from './session.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { isAccountExpired } from '../../domain/accountValidity.js';
import { signOfficeConfig, signOfficeSource, verifyOfficeSource } from '../../documents/officeTokens.js';
import { routeError } from './routeError.js';

export function registerOfficeViewerRoutes(app: FastifyInstance, deps: UsersRouteDeps) {
  async function authorized(id: string, uid: string) {
    const user = await app.db.selectFrom('users').select(['role', 'account_archived', 'locked_permanent', 'locked_until', 'account_valid_until']).where('id', '=', uid).executeTakeFirst();
    if (!user || user.account_archived || user.locked_permanent || (user.locked_until && new Date(user.locked_until) > new Date()) || isAccountExpired(user.account_valid_until)) throw { statusCode: 403, message: 'forbidden' };
    const attachment = await app.db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!attachment?.ticket_id) throw { statusCode: 404, message: 'attachment_not_found' };
    const ticket = await app.db.selectFrom('tickets').select('created_by_user_id').where('id', '=', attachment.ticket_id).executeTakeFirst();
    if (!ticket || (user.role === 'user' && ticket.created_by_user_id !== uid)) throw { statusCode: 403, message: 'forbidden' };
    if (attachment.size_bytes > 15 * 1024 * 1024) throw { statusCode: 413, message: 'preview_too_large' };
    return attachment;
  }
  async function decrypt(attachment: { id: string; filename: Buffer; data_b64: Buffer }, field: 'filename' | 'data') {
    const dek = await ensureDek(app.db, deps.keyProvider, `attachments.${field}`);
    return fieldCipher.decryptField(field === 'filename' ? attachment.filename : attachment.data_b64, dek.rawDek,
      { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION, tableName: 'attachments',
        recordId: attachment.id, fieldName: field, keyVersion: dek.keyVersion });
  }
  app.get('/api/v2/attachments/:id/office-config', async (req, reply) => {
    try {
      const { uid } = requireSession(req); const { id } = req.params as { id: string };
      const attachment = await authorized(id, uid);
      reply.header('Cache-Control', 'no-store');
      if (!deps.env.ONLYOFFICE_ENABLED || !deps.env.ONLYOFFICE_JWT_SECRET) return { enabled: false, reason: 'office_viewer_not_enabled' };
      const title = await decrypt(attachment, 'filename'); const fileType = title.split('.').at(-1)?.toLowerCase() || '';
      const documentType = ['xlsx', 'xls', 'ods'].includes(fileType) ? 'cell' : ['pptx', 'ppt', 'odp'].includes(fileType) ? 'slide' : 'word';
      if (!['docx', 'doc', 'odt', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'].includes(fileType)) return { enabled: false, reason: 'unsupported_office_format' };
      const available = await fetch('http://documentserver/healthcheck', { signal: AbortSignal.timeout(2500) }).then(async response => response.ok && (await response.text()).trim() === 'true').catch(() => false);
      if (!available) return { enabled: false, reason: 'office_viewer_starting' };
      const source = await signOfficeSource(deps.env.COOKIE_SECRET, id, uid);
      const config = { documentType, width: '100%', height: '100%', type: 'desktop',
        document: { fileType, key: `ticket-${id}`, title, url: `http://app:3000/api/v2/office/source/${id}?token=${source}`,
          permissions: { edit: false, comment: false, review: false, fillForms: false, copy: true, download: true, print: true } },
        editorConfig: { mode: 'view', lang: 'de', customization: { autosave: false, plugins: false, chat: false, comments: false, help: false } } };
      return { enabled: true, config: { ...config, token: await signOfficeConfig(deps.env.ONLYOFFICE_JWT_SECRET, config) } };
    } catch (error) { return routeError(app, reply, error); }
  });
  app.get('/api/v2/attachments/:id/office-view', async (req, reply) => {
    try {
      const { uid } = requireSession(req); const { id } = req.params as { id: string }; await authorized(id, uid);
      return reply.header('Cache-Control', 'no-store').header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'")
        .header('X-Frame-Options', 'SAMEORIGIN').type('text/html; charset=utf-8').send('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Office</title><link rel="stylesheet" href="/js/office-view.css"><div id="office-editor"></div><p id="office-error" role="alert" hidden></p><script src="/js/office-view.js" defer></script></html>');
    } catch (error) { return routeError(app, reply, error); }
  });
  // Internal-only in Caddy. Short-lived, attachment/user-bound capability; never log the URL token.
  app.get('/api/v2/office/source/:id', { logLevel: 'silent' }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }; const token = (req.query as { token?: string }).token;
      if (!token || token.length > 2048) return reply.code(401).send({ error: 'invalid_source_token' });
      let uid: string;
      try { uid = await verifyOfficeSource(deps.env.COOKIE_SECRET, token, id); }
      catch { return reply.code(401).send({ error: 'invalid_source_token' }); }
      const attachment = await authorized(id, uid);
      const original = Buffer.from(await decrypt(attachment, 'data'), 'base64');
      return reply.header('Cache-Control', 'no-store').type('application/octet-stream').send(original);
    } catch (error) { return routeError(app, reply, error); }
  });
}
