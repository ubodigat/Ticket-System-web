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
import { mysqlTimestamp } from '../../db/date.js';
import { validateUploadedFile } from '../../domain/fileValidation.js';
import { scanIfConfigured } from '../../domain/antivirus.js';
import { sanitizeServerHtml } from '../../domain/sanitizer.js';

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
  source_ticket_id: z.string().nullable().optional(),
  category: z.string().trim().min(1).max(128).nullable().optional()
});
const kbCategorySchema = z.object({ name: z.string().trim().min(1).max(128) });

const createTextBlockSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(50000)
});

function ctx(deps: KnowledgeRouteDeps, tableName: string, recordId: string, fieldName: string, keyVersion: number) {
  return { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION, tableName, recordId, fieldName, keyVersion };
}

export function registerKnowledgeRoutes(app: FastifyInstance, deps: KnowledgeRouteDeps): void {
  async function hasPermission(session: { uid: string; role: string }, key: 'textBlocks' | 'kb', value?: string): Promise<boolean> {
    if (session.role === 'superadmin') return true;
    if (session.role !== 'admin') return false;
    const row = await app.db.selectFrom('users').select('permissions_json').where('id', '=', session.uid).executeTakeFirst();
    let permissions: Record<string, unknown> = {};
    try { permissions = row?.permissions_json ? JSON.parse(row.permissions_json) : {}; } catch { permissions = {}; }
    if (key === 'kb') return value ? permissions.kb === value : permissions.kb === 'read' || permissions.kb === 'edit';
    return permissions[key] === true;
  }

  // Erlaubte Kategorien: aktive Ticket-Kategorien plus eigene Wissensdatenbank-Kategorien.
  async function categoryExists(name: string): Promise<boolean> {
    const ticketCategory = await app.db.selectFrom('categories').select('id').where('name', '=', name).where('archived', '=', false).executeTakeFirst();
    if (ticketCategory) return true;
    return !!await app.db.selectFrom('kb_categories').select('id').where('name', '=', name).executeTakeFirst();
  }

  // --- Wissensdatenbank ---

  app.get('/api/v2/kb/articles', async (req, reply) => {
    try {
      const session = requireSession(req);
      if (session.role !== 'user' && !(await hasPermission(session, 'kb'))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('kb_articles').leftJoin('users', 'users.id', 'kb_articles.created_by_user_id')
        .selectAll('kb_articles').select('users.username as created_by_username').orderBy('kb_articles.updated_at', 'desc').execute();
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
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createArticleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (parsed.data.category && !(await categoryExists(parsed.data.category))) return reply.code(400).send({ error: 'invalid_category' });

      // Security-Audit B9: Wissensdatenbank-Inhalte werden roh im Browser gerendert (innerHTML) --
      // ohne serverseitige Bereinigung könnte jedes Konto mit KB-Schreibrecht HTML platzieren,
      // das bei allen Leserinnen und Lesern ausgeführt wird (gefälschte Login-Formulare etc.).
      const cleanContent = sanitizeServerHtml(parsed.data.content);
      if (!cleanContent) return reply.code(400).send({ error: 'empty_content' });

      const id = randomUUID();
      const titleDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.title');
      const contentDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.content');
      await app.db.insertInto('kb_articles').values({
        id,
        title: fieldCipher.encryptField(parsed.data.title, titleDek.rawDek, ctx(deps, 'kb_articles', id, 'title', titleDek.keyVersion)),
        content: fieldCipher.encryptField(cleanContent, contentDek.rawDek, ctx(deps, 'kb_articles', id, 'content', contentDek.keyVersion)),
        source_ticket_id: parsed.data.source_ticket_id ?? null,
        category: parsed.data.category ?? null,
        created_by_user_id: session.uid
      }).execute();
      return reply.code(201).send({ id });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.patch('/api/v2/kb/articles/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = createArticleSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const updates: Record<string, unknown> = { updated_at: mysqlTimestamp() };
      if (parsed.data.category !== undefined) {
        if (parsed.data.category && !(await categoryExists(parsed.data.category))) return reply.code(400).send({ error: 'invalid_category' });
        updates.category = parsed.data.category;
      }
      if (parsed.data.title !== undefined) {
        const titleDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.title');
        updates.title = fieldCipher.encryptField(parsed.data.title, titleDek.rawDek, ctx(deps, 'kb_articles', id, 'title', titleDek.keyVersion));
      }
      if (parsed.data.content !== undefined) {
        const cleanContent = sanitizeServerHtml(parsed.data.content);
        if (!cleanContent) return reply.code(400).send({ error: 'empty_content' });
        const contentDek = await ensureDek(app.db, deps.keyProvider, 'kb_articles.content');
        updates.content = fieldCipher.encryptField(cleanContent, contentDek.rawDek, ctx(deps, 'kb_articles', id, 'content', contentDek.keyVersion));
      }
      await app.db.updateTable('kb_articles').set(updates).where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/kb/articles/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('kb_articles').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Wissensdatenbank: Kategorien (Ticket-Kategorien + eigene) ---

  app.get('/api/v2/kb/categories', async (req, reply) => {
    try {
      const session = requireSession(req);
      if (session.role !== 'user' && !(await hasPermission(session, 'kb'))) return reply.code(403).send({ error: 'forbidden' });
      const ticketCategories = await app.db.selectFrom('categories').select(['id', 'name']).where('archived', '=', false).orderBy('name', 'asc').execute();
      const kbCategories = await app.db.selectFrom('kb_categories').select(['id', 'name']).orderBy('name', 'asc').execute();
      const taken = new Set(ticketCategories.map(c => c.name.toLocaleLowerCase('de-DE')));
      return reply.send({ categories: [
        ...ticketCategories.map(c => ({ id: c.id, name: c.name, source: 'ticket' })),
        ...kbCategories.filter(c => !taken.has(c.name.toLocaleLowerCase('de-DE'))).map(c => ({ id: c.id, name: c.name, source: 'kb' }))
      ] });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/kb/categories', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = kbCategorySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (await categoryExists(parsed.data.name)) return reply.code(409).send({ error: 'category_exists' });
      const id = randomUUID();
      await app.db.insertInto('kb_categories').values({ id, name: parsed.data.name, created_by_user_id: session.uid }).execute();
      return reply.code(201).send({ id, name: parsed.data.name });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/kb/categories/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const category = await app.db.selectFrom('kb_categories').select('name').where('id', '=', id).executeTakeFirst();
      if (!category) return reply.code(404).send({ error: 'not_found' });
      // Artikel bleiben erhalten und werden "ohne Kategorie" gefuehrt.
      await app.db.updateTable('kb_articles').set({ category: null }).where('category', '=', category.name).execute();
      await app.db.deleteFrom('kb_categories').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Wissensdatenbank: Datei-Anhänge (gab es lokal am 07.10.2026 bereits, server-seitig
  // bisher komplett gefehlt) ---

  app.get('/api/v2/kb/articles/:id/attachments', async (req, reply) => {
    try {
      const session = requireSession(req);
      if (session.role !== 'user' && !(await hasPermission(session, 'kb'))) return reply.code(403).send({ error: 'forbidden' });
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
      const session = requireSession(req);
      if (session.role !== 'user' && !(await hasPermission(session, 'kb'))) return reply.code(403).send({ error: 'forbidden' });
      const { attachmentId } = req.params as { attachmentId: string };
      const row = await app.db.selectFrom('kb_article_attachments').selectAll().where('id', '=', attachmentId).executeTakeFirst();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.data');
      const filename = fieldCipher.decryptField(row.filename, filenameDek.rawDek, ctx(deps, 'kb_article_attachments', row.id, 'filename', filenameDek.keyVersion));
      const chunked = !!await app.db.selectFrom('file_uploads').select('id').where('id', '=', row.id).where('completed', '=', true).executeTakeFirst();
      const data_b64 = chunked ? null : fieldCipher.decryptField(row.data_b64, dataDek.rawDek, ctx(deps, 'kb_article_attachments', row.id, 'data', dataDek.keyVersion));
      return reply.send({ attachment: { ...row, filename, data_b64, chunked } });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // bodyLimit höher als der globale 2MB-Standard (N2 im Security-Audit): Anhänge bis 15MB
  // kommen base64-kodiert im JSON-Body (~33% Overhead) plus Metadaten.
  app.post('/api/v2/kb/articles/:id/attachments', { bodyLimit: 21 * 1024 * 1024 }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const article = await app.db.selectFrom('kb_articles').select('id').where('id', '=', id).executeTakeFirst();
      if (!article) return reply.code(404).send({ error: 'article_not_found' });
      const parsed = createKbAttachmentSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const validated = await validateUploadedFile({
        filename: parsed.data.filename,
        declaredMimeType: parsed.data.mime_type,
        dataB64: parsed.data.data_b64,
        maxSizeBytes: 15 * 1024 * 1024
      });

      // Virenscan (B7, optional -- siehe domain/antivirus.ts).
      await scanIfConfigured(deps.env, validated.buffer);

      const attachmentId = randomUUID();
      const filenameDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.filename');
      const dataDek = await ensureDek(app.db, deps.keyProvider, 'kb_article_attachments.data');
      await app.db.insertInto('kb_article_attachments').values({
        id: attachmentId,
        kb_article_id: id,
        uploaded_by_user_id: session.uid,
        uploaded_by_username: session.username,
        filename: fieldCipher.encryptField(validated.safeFilename, filenameDek.rawDek, ctx(deps, 'kb_article_attachments', attachmentId, 'filename', filenameDek.keyVersion)),
        mime_type: validated.mimeType,
        size_bytes: validated.sizeBytes,
        data_b64: fieldCipher.encryptField(parsed.data.data_b64, dataDek.rawDek, ctx(deps, 'kb_article_attachments', attachmentId, 'data', dataDek.keyVersion))
      }).execute();
      return reply.code(201).send({ id: attachmentId, filename: validated.safeFilename, mime_type: validated.mimeType, size_bytes: validated.sizeBytes });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/kb/attachments/:attachmentId', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'kb', 'edit'))) return reply.code(403).send({ error: 'forbidden' });
      const { attachmentId } = req.params as { attachmentId: string };
      await app.db.deleteFrom('kb_article_attachments').where('id', '=', attachmentId).execute();
      await app.db.deleteFrom('file_uploads').where('id', '=', attachmentId).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Textbausteine ---

  app.get('/api/v2/text-blocks', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'textBlocks'))) return reply.code(403).send({ error: 'forbidden' });
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
      if (!(await hasPermission(session, 'textBlocks'))) return reply.code(403).send({ error: 'forbidden' });
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

  app.patch('/api/v2/text-blocks/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      if (!(await hasPermission(actor, 'textBlocks'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = createTextBlockSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const existing = await app.db.selectFrom('text_blocks').select('id').where('id', '=', id).executeTakeFirst();
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      const dek = await ensureDek(app.db, deps.keyProvider, 'text_blocks.content');
      await app.db.updateTable('text_blocks').set({ title: parsed.data.title,
        content: fieldCipher.encryptField(parsed.data.content, dek.rawDek, ctx(deps, 'text_blocks', id, 'content', dek.keyVersion)) }).where('id', '=', id).execute();
      return { success: true };
    } catch (error) { return routeError(app, reply, error); }
  });
  app.delete('/api/v2/text-blocks/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasPermission(session, 'textBlocks'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('text_blocks').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
