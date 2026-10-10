/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Wissensdatenbank & Textbausteine - Inhalte serverseitig AES-256-GCM-verschlüsselt,
// genau wie Ticket-Titel/-Beschreibung (siehe tickets.ts).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireSession, requireAdmin } from './session.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { routeError } from './routeError.js';

// Gleiche Blockliste wie Ticket-Anhaenge (extras.ts): image/svg+xml/.html etc. koennen beim
// direkten Oeffnen im Browser same-origin Skripte ausfuehren (gespeicherte XSS).
const KB_ATTACHMENT_BLOCKED_MIME = ['text/html', 'application/javascript', 'application/x-php', 'application/x-sh', 'image/svg+xml'];
const KB_ATTACHMENT_BLOCKED_EXT = ['.exe', '.php', '.sh', '.bat', '.cmd', '.ps1', '.py', '.rb', '.js', '.html', '.svg', '.svgz', '.htm', '.xhtml'];

const createKbAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255).refine(
    name => !/[<>:"/\\|?*\x00-\x1F]/.test(name),
    'Ungültiger Dateiname'
  ),
  mime_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().nonnegative().max(15 * 1024 * 1024),
  data_b64: z.string().min(1)
});

export interface KnowledgeRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(200000),
  source_ticket_id: z.string().nullable().optional()
});

const createTextBlockSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(50000)
});

function ctx(deps: KnowledgeRouteDeps, tableName: string, recordId: string, fieldName: string, keyVersion: number) {
  return { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION, tableName, recordId, fieldName, keyVersion };
}

export function registerKnowledgeRoutes(app: FastifyInstance, deps: KnowledgeRouteDeps): void {
  // --- Wissensdatenbank ---

  app.get('/api/v2/kb/articles', async (req, reply) => {
    try {
      requireSession(req);
      const rows = await app.db.selectFrom('kb_articles').selectAll().orderBy('updated_at', 'desc').execute();
      const titleDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.title');
      const contentDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.content');
      const articles = rows.map(row => ({
        ...row,
        title: fieldCipher.decryptField(row.title, titleDek.rawDek, ctx(deps, 'kb_articles', row.id, 'title', titleDek.keyVersion)),
        content: fieldCipher.decryptField(row.content, contentDek.rawDek, ctx(deps, 'kb_articles', row.id, 'content', contentDek.keyVersion))
      }));
      return reply.send({ articles });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/kb/articles', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = createArticleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const id = randomUUID();
      const titleDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.title');
      const contentDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.content');
      await app.db.insertInto('kb_articles').values({
        id,
        title: fieldCipher.encryptField(parsed.data.title, titleDek.rawDek, ctx(deps, 'kb_articles', id, 'title', titleDek.keyVersion)),
        content: fieldCipher.encryptField(parsed.data.content, contentDek.rawDek, ctx(deps, 'kb_articles', id, 'content', contentDek.keyVersion)),
        source_ticket_id: parsed.data.source_ticket_id ?? null,
        created_by_user_id: session.uid
      }).execute();
      return reply.code(201).send({ id });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.patch('/api/v2/kb/articles/:id', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = createArticleSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.title !== undefined) {
        const titleDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.title');
        updates.title = fieldCipher.encryptField(parsed.data.title, titleDek.rawDek, ctx(deps, 'kb_articles', id, 'title', titleDek.keyVersion));
      }
      if (parsed.data.content !== undefined) {
        const contentDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.content');
        updates.content = fieldCipher.encryptField(parsed.data.content, contentDek.rawDek, ctx(deps, 'kb_articles', id, 'content', contentDek.keyVersion));
      }
      await app.db.updateTable('kb_articles').set(updates).where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/kb/articles/:id', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('kb_articles').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Wissensdatenbank: Datei-Anhänge (gab es lokal am 07.10.2026 bereits, server-seitig
  // bisher komplett gefehlt) ---

  app.get('/api/v2/kb/articles/:id/attachments', async (req, reply) => {
    try {
      requireSession(req);
      const { id } = req.params as { id: string };
      const rows = await app.db.selectFrom('kb_article_attachments')
        .select(['id', 'filename', 'mime_type', 'size_bytes', 'uploaded_by_username', 'created_at'])
        .where('kb_article_id', '=', id).orderBy('created_at', 'asc').execute();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.filename');
      const attachments = rows.map(row => ({
        ...row,
        filename: fieldCipher.decryptField(row.filename, filenameDek.rawDek, ctx(deps, 'kb_article_attachments', row.id, 'filename', filenameDek.keyVersion))
      }));
      return reply.send({ attachments });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.get('/api/v2/kb/attachments/:attachmentId', async (req, reply) => {
    try {
      requireSession(req);
      const { attachmentId } = req.params as { attachmentId: string };
      const row = await app.db.selectFrom('kb_article_attachments').selectAll().where('id', '=', attachmentId).executeTakeFirst();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.data');
      const filename = fieldCipher.decryptField(row.filename, filenameDek.rawDek, ctx(deps, 'kb_article_attachments', row.id, 'filename', filenameDek.keyVersion));
      const data_b64 = fieldCipher.decryptField(row.data_b64, dataDek.rawDek, ctx(deps, 'kb_article_attachments', row.id, 'data', dataDek.keyVersion));
      return reply.send({ attachment: { ...row, filename, data_b64 } });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/kb/articles/:id/attachments', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const article = await app.db.selectFrom('kb_articles').select('id').where('id', '=', id).executeTakeFirst();
      if (!article) return reply.code(404).send({ error: 'article_not_found' });
      const parsed = createKbAttachmentSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      if (KB_ATTACHMENT_BLOCKED_MIME.includes(parsed.data.mime_type.toLowerCase())) {
        return reply.code(400).send({ error: 'blocked_mime_type' });
      }
      const ext = parsed.data.filename.toLowerCase().split('.').pop() ?? '';
      if (KB_ATTACHMENT_BLOCKED_EXT.includes('.' + ext)) {
        return reply.code(400).send({ error: 'blocked_extension' });
      }

      const attachmentId = randomUUID();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.data');
      await app.db.insertInto('kb_article_attachments').values({
        id: attachmentId,
        kb_article_id: id,
        uploaded_by_user_id: session.uid,
        uploaded_by_username: session.username,
        filename: fieldCipher.encryptField(parsed.data.filename, filenameDek.rawDek, ctx(deps, 'kb_article_attachments', attachmentId, 'filename', filenameDek.keyVersion)),
        mime_type: parsed.data.mime_type,
        size_bytes: parsed.data.size_bytes,
        data_b64: fieldCipher.encryptField(parsed.data.data_b64, dataDek.rawDek, ctx(deps, 'kb_article_attachments', attachmentId, 'data', dataDek.keyVersion))
      }).execute();
      return reply.code(201).send({ id: attachmentId, filename: parsed.data.filename, mime_type: parsed.data.mime_type, size_bytes: parsed.data.size_bytes });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/kb/attachments/:attachmentId', async (req, reply) => {
    try {
      requireAdmin(req);
      const { attachmentId } = req.params as { attachmentId: string };
      await app.db.deleteFrom('kb_article_attachments').where('id', '=', attachmentId).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Textbausteine ---

  app.get('/api/v2/text-blocks', async (req, reply) => {
    try {
      requireAdmin(req);
      const rows = await app.db.selectFrom('text_blocks').selectAll().orderBy('title', 'asc').execute();
      const contentDek = await ensureDek(app.db, deps.keyProvider, 'text_blocks.content');
      const blocks = rows.map(row => ({
        ...row,
        content: fieldCipher.decryptField(row.content, contentDek.rawDek, ctx(deps, 'text_blocks', row.id, 'content', contentDek.keyVersion))
      }));
      return reply.send({ blocks });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/text-blocks', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = createTextBlockSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const id = randomUUID();
      const contentDek = await ensureDek(app.db, deps.keyProvider, 'text_blocks.content');
      await app.db.insertInto('text_blocks').values({
        id,
        title: parsed.data.title,
        content: fieldCipher.encryptField(parsed.data.content, contentDek.rawDek, ctx(deps, 'text_blocks', id, 'content', contentDek.keyVersion)),
        created_by_user_id: session.uid
      }).execute();
      return reply.code(201).send({ id });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/text-blocks/:id', async (req, reply) => {
    try {
      requireAdmin(req);
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('text_blocks').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
