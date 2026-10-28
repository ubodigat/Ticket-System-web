import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from './session.js';
import { routeError } from './routeError.js';
import type { ExtrasRouteDeps } from './extras.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { validateUploadedFile } from '../../domain/fileValidation.js';
import { scanIfConfigured } from '../../domain/antivirus.js';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const uploadRequestSchema = z.object({ ticket_id: z.string().uuid().optional(), article_id: z.string().uuid().optional(),
  filename: z.string().min(1).max(255), mime_type: z.string().max(255), size_bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES)
}).strict().refine(value => !!value.ticket_id !== !!value.article_id);

export function registerUploadRoutes(app: FastifyInstance, deps: ExtrasRouteDeps) {
  const ctx = (recordId: string, fieldName: string, keyVersion: number) => ({ installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION, tableName: 'file_uploads', recordId, fieldName, keyVersion });
  async function parentAccess(actor: { uid: string; role: string }, ticketId: string | null, articleId: string | null, write = true) {
    if (ticketId) {
      const ticket = await app.db.selectFrom('tickets').select('created_by_user_id').where('id', '=', ticketId).executeTakeFirst();
      if (!ticket) throw { statusCode: 404, message: 'ticket_not_found' };
      if (actor.role === 'user' && ticket.created_by_user_id !== actor.uid) throw { statusCode: 403, message: 'forbidden' };
    } else if (articleId) {
      const article = await app.db.selectFrom('kb_articles').select('id').where('id', '=', articleId).executeTakeFirst();
      if (!article) throw { statusCode: 404, message: 'article_not_found' };
      if (!write && actor.role === 'user') return;
      if (actor.role === 'superadmin') return;
      const user = await app.db.selectFrom('users').select('permissions_json').where('id', '=', actor.uid).executeTakeFirst();
      let permission; try { permission = JSON.parse(user?.permissions_json || '{}').kb; } catch { /* Deny malformed permission data. */ }
      if (actor.role !== 'admin' || !(write ? permission === 'edit' : ['read', 'edit'].includes(permission))) throw { statusCode: 403, message: 'forbidden' };
    } else throw { statusCode: 404, message: 'not_found' };
  }
  app.post('/api/v2/uploads', { config: { rateLimit: { max: 12, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
    try {
      const actor = requireSession(req); const parsed = uploadRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_upload', details: parsed.error.flatten() });
      const data = parsed.data;
      await parentAccess(actor, data.ticket_id || null, data.article_id || null);
      // Reclaim unfinished uploads. Completed data is part of the attachment and its backup.
      await app.db.deleteFrom('file_uploads').where('completed', '=', false).where('created_at', '<', new Date(Date.now() - 86400000)).execute();
      const id = randomUUID(); const dek = await ensureDek(app.db, deps.keyProvider, 'file_uploads.filename');
      await app.db.transaction().execute(async trx => {
        await trx.selectFrom('users').select('id').where('id', '=', actor.uid).forUpdate().executeTakeFirstOrThrow();
        const used = await trx.selectFrom('file_uploads').select(eb => eb.fn.sum<number>('size_bytes').as('total'))
          .where('owner_user_id', '=', actor.uid).where('created_at', '>=', new Date(Date.now() - 86400000)).executeTakeFirst();
        if (Number(used?.total || 0) + data.size_bytes > 2 * 1024 * 1024 * 1024) throw { statusCode: 429, message: 'upload_quota_exceeded' };
        await trx.insertInto('file_uploads').values({ id, owner_user_id: actor.uid, ticket_id: data.ticket_id || null,
          article_id: data.article_id || null, filename: fieldCipher.encryptField(data.filename, dek.rawDek, ctx(id, 'filename', dek.keyVersion)),
          mime_type: data.mime_type, size_bytes: data.size_bytes }).execute();
      });
      return reply.code(201).send({ id, chunk_bytes: UPLOAD_CHUNK_BYTES });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.register(async scoped => {
    scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scoped.put('/api/v2/uploads/:id/chunks/:part', { bodyLimit: UPLOAD_CHUNK_BYTES,
      onRequest: async (req, reply) => {
        try {
          const actor = requireSession(req); const { id } = req.params as { id: string };
          const upload = await app.db.selectFrom('file_uploads').select(['ticket_id', 'article_id'])
            .where('id', '=', id).where('owner_user_id', '=', actor.uid).where('completed', '=', false).executeTakeFirst();
          if (!upload) return reply.code(404).send({ error: 'upload_not_found' });
          await parentAccess(actor, upload.ticket_id, upload.article_id);
        } catch (error) { return routeError(app, reply, error); }
      },
      config: { rateLimit: { max: 300, timeWindow: '1 minute', keyGenerator: req => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
      try {
        const actor = requireSession(req); const { id, part } = req.params as { id: string; part: string };
        const index = Number(part); const buffer = req.body as Buffer;
        if (!Number.isSafeInteger(index) || index < 0 || !Buffer.isBuffer(buffer) || !buffer.length) return reply.code(400).send({ error: 'invalid_chunk' });
        const dek = await ensureDek(app.db, deps.keyProvider, 'file_uploads.data');
        await app.db.transaction().execute(async trx => {
          const upload = await trx.selectFrom('file_uploads').selectAll().where('id', '=', id).where('owner_user_id', '=', actor.uid).forUpdate().executeTakeFirst();
          if (!upload || upload.completed) throw { statusCode: 404, message: 'upload_not_found' };
          await parentAccess(actor, upload.ticket_id, upload.article_id);
          const expected = Math.min(UPLOAD_CHUNK_BYTES, upload.size_bytes - upload.received_bytes);
          if (index * UPLOAD_CHUNK_BYTES !== upload.received_bytes || buffer.length !== expected) throw { statusCode: 400, message: 'invalid_chunk_order_or_size' };
          await trx.insertInto('file_upload_chunks').values({ upload_id: id, part: index,
            data_enc: fieldCipher.encryptField(buffer.toString('base64'), dek.rawDek, ctx(`${id}:${index}`, 'data', dek.keyVersion)) }).execute();
          await trx.updateTable('file_uploads').set({ received_bytes: upload.received_bytes + buffer.length }).where('id', '=', id).execute();
        });
        return reply.send({ success: true });
      } catch (error) { return routeError(app, reply, error); }
    });
  });
  let completing = false;
  app.post('/api/v2/uploads/:id/complete', { config: { rateLimit: { max: 12, timeWindow: '10 minutes', keyGenerator: req => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
    let acquired = false;
    try {
      const actor = requireSession(req); const { id } = req.params as { id: string };
      if (completing) return reply.header('retry-after', '3').code(429).send({ error: 'upload_validation_busy' });
      completing = true; acquired = true;
      const result = await app.db.transaction().execute(async trx => {
        const upload = await trx.selectFrom('file_uploads').selectAll().where('id', '=', id).where('owner_user_id', '=', actor.uid).forUpdate().executeTakeFirst();
        if (!upload || upload.completed) throw { statusCode: 404, message: 'upload_not_found' };
        await parentAccess(actor, upload.ticket_id, upload.article_id);
        if (upload.received_bytes !== upload.size_bytes) throw { statusCode: 400, message: 'upload_incomplete' };
        if (!Number.isSafeInteger(upload.size_bytes) || upload.size_bytes < 1 || upload.size_bytes > MAX_UPLOAD_BYTES) throw new Error('invalid_stored_upload_size');
        const fileDek = await ensureDek(trx, deps.keyProvider, 'file_uploads.filename');
        const chunkDek = await ensureDek(trx, deps.keyProvider, 'file_uploads.data');
        const filename = fieldCipher.decryptField(upload.filename, fileDek.rawDek, ctx(id, 'filename', fileDek.keyVersion));
        // A single bounded validation buffer, never a 667 MB base64/JSON string.
        const bytes = Buffer.allocUnsafe(upload.size_bytes);
        for (let part = 0, offset = 0; offset < bytes.length; part++) {
          const chunk = await trx.selectFrom('file_upload_chunks').select('data_enc').where('upload_id', '=', id).where('part', '=', part).executeTakeFirstOrThrow();
          const decoded = Buffer.from(fieldCipher.decryptField(chunk.data_enc, chunkDek.rawDek, ctx(`${id}:${part}`, 'data', chunkDek.keyVersion)), 'base64');
          if (decoded.length !== Math.min(UPLOAD_CHUNK_BYTES, bytes.length - offset)) throw new Error('invalid_stored_chunk');
          decoded.copy(bytes, offset); offset += decoded.length;
        }
        const validated = await validateUploadedFile({ filename, declaredMimeType: upload.mime_type, data: bytes, maxSizeBytes: MAX_UPLOAD_BYTES });
        await scanIfConfigured(deps.env, bytes);
        const table = upload.ticket_id ? 'attachments' : 'kb_article_attachments';
        const nameDek = await ensureDek(trx, deps.keyProvider, `${table}.filename`);
        const dataDek = await ensureDek(trx, deps.keyProvider, `${table}.data`);
        const context = (fieldName: string, keyVersion: number) => ({ ...ctx(id, fieldName, keyVersion), tableName: table });
        const common = { id, uploaded_by_user_id: actor.uid, uploaded_by_username: actor.username, mime_type: validated.mimeType,
          size_bytes: bytes.length, filename: fieldCipher.encryptField(filename, nameDek.rawDek, context('filename', nameDek.keyVersion)),
          data_b64: fieldCipher.encryptField(JSON.stringify({ storage: 'chunks-v1', size: bytes.length,
            chunks: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) }), dataDek.rawDek, context('data', dataDek.keyVersion)) };
        if (upload.ticket_id) await trx.insertInto('attachments').values({ ...common, ticket_id: upload.ticket_id }).execute();
        else await trx.insertInto('kb_article_attachments').values({ ...common, kb_article_id: upload.article_id! }).execute();
        await trx.updateTable('file_uploads').set({ completed: true, mime_type: validated.mimeType }).where('id', '=', id).execute();
        return { id, filename, mime_type: validated.mimeType, size_bytes: bytes.length };
      });
      return reply.code(201).send(result);
    } catch (error) { return routeError(app, reply, error); }
    finally { if (acquired) completing = false; }
  });
  app.delete('/api/v2/uploads/:id', async (req, reply) => {
    try {
      const actor = requireSession(req); const { id } = req.params as { id: string };
      const pending = await app.db.selectFrom('file_uploads').select('ticket_id').where('id', '=', id).where('owner_user_id', '=', actor.uid).executeTakeFirst();
      if (pending?.ticket_id) req.auditDetail = { ticketId: pending.ticket_id };
      await app.db.deleteFrom('file_uploads').where('id', '=', id).where('owner_user_id', '=', actor.uid).where('completed', '=', false).execute();
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.get('/api/v2/uploads/:id/content', async (req, reply) => {
    try {
      const actor = requireSession(req); const { id } = req.params as { id: string };
      const upload = await app.db.selectFrom('file_uploads').selectAll().where('id', '=', id).where('completed', '=', true).executeTakeFirst();
      if (!upload) return reply.code(404).send({ error: 'not_found' });
      await parentAccess(actor, upload.ticket_id, upload.article_id, false);
      const table = upload.ticket_id ? 'attachments' : 'kb_article_attachments';
      const attachment = await app.db.selectFrom(table).select(['id', 'data_b64']).where('id', '=', id).executeTakeFirst();
      if (!attachment) return reply.code(404).send({ error: 'not_found' });
      const dataDek = await ensureDek(app.db, deps.keyProvider, `${table}.data`);
      const manifest = JSON.parse(fieldCipher.decryptField(attachment.data_b64, dataDek.rawDek,
        { ...ctx(id, 'data', dataDek.keyVersion), tableName: table }));
      if (manifest.storage !== 'chunks-v1' || manifest.size !== upload.size_bytes || manifest.chunks !== Math.ceil(upload.size_bytes / UPLOAD_CHUNK_BYTES)) throw new Error('invalid_upload_manifest');
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'file_uploads.filename');
      const dek = await ensureDek(app.db, deps.keyProvider, 'file_uploads.data');
      const filename = fieldCipher.decryptField(upload.filename, nameDek.rawDek, ctx(id, 'filename', nameDek.keyVersion));
      async function* content() {
        for (let part = 0; part * UPLOAD_CHUNK_BYTES < upload!.size_bytes; part++) {
          const chunk = await app.db.selectFrom('file_upload_chunks').select('data_enc').where('upload_id', '=', id).where('part', '=', part).executeTakeFirstOrThrow();
          yield Buffer.from(fieldCipher.decryptField(chunk.data_enc, dek.rawDek, ctx(`${id}:${part}`, 'data', dek.keyVersion)), 'base64');
        }
      }
      return reply.header('cache-control', 'no-store').header('content-length', upload.size_bytes)
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`).type(upload.mime_type).send(Readable.from(content()));
    } catch (error) { return routeError(app, reply, error); }
  });
}
