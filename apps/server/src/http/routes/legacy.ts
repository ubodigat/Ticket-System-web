import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const allowedKeys = new Set([
  'users',
  'app_settings',
  'user_groups',
  'list_views',
  'tickets',
  'account_requests',
  'global_logs',
  'notifications'
]);

const bodySchema = z.object({
  value: z.unknown()
});

const attachmentSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(15 * 1024 * 1024),
  data: z.string().min(1)
});

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png'
};

function hasValidSession(req: FastifyRequest): boolean {
  const raw = req.cookies['__Host-ticket_session'] || req.cookies.ticket_session;
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as {
      uid?: unknown;
      iat?: unknown;
    };
    return typeof parsed.uid === 'string' &&
      typeof parsed.iat === 'number' &&
      Date.now() - parsed.iat <= 8 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function webRoot(): string {
  const defaultRoot = normalize(join(process.cwd(), 'public'));
  const candidates = [
    defaultRoot,
    normalize(join(process.cwd(), '..', '..')),
    normalize(process.cwd())
  ];
  return candidates.find(candidate => existsSync(join(candidate, 'index.html'))) || defaultRoot;
}

async function sendStatic(app: FastifyInstance, reply: FastifyReply, file: string) {
  const root = webRoot();
  const full = normalize(join(root, file));
  if (!full.startsWith(root)) return reply.code(404).send('Nicht gefunden');
  try {
    const data = await readFile(full);
    return reply.type(contentTypes[extname(full)] || 'application/octet-stream').send(data);
  } catch (err) {
    app.log.warn({ err, file }, 'Statische Datei nicht gefunden');
    return reply.code(404).send('Nicht gefunden');
  }
}

export function registerLegacyRoutes(app: FastifyInstance): void {
  app.get('/index.html', async (_req, reply) => sendStatic(app, reply, 'index.html'));
  app.get('/dashboard.html', async (_req, reply) => sendStatic(app, reply, 'dashboard.html'));
  app.get('/admin.html', async (_req, reply) => sendStatic(app, reply, 'admin.html'));
  app.get('/style.css', async (_req, reply) => sendStatic(app, reply, 'style.css'));
  app.get('/script.js', async (_req, reply) => sendStatic(app, reply, 'script.js'));
  app.get('/picture/favicon.png', async (_req, reply) => sendStatic(app, reply, 'picture/favicon.png'));

  app.get('/api/v1/legacy-data/:key', async (req, reply) => {
    if (!hasValidSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    const key = (req.params as { key: string }).key;
    if (!allowedKeys.has(key)) return reply.code(404).send({ error: 'unknown_key' });
    const row = await app.db
      .selectFrom('legacy_data')
      .select('value_json')
      .where('data_key', '=', key)
      .executeTakeFirst();
    const value = row
      ? (typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json)
      : null;
    return reply.send({ value });
  });

  app.put('/api/v1/legacy-data/:key', async (req, reply) => {
    if (!hasValidSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    const key = (req.params as { key: string }).key;
    if (!allowedKeys.has(key)) return reply.code(404).send({ error: 'unknown_key' });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const valueJson = JSON.stringify(parsed.data.value);
    await app.db
      .insertInto('legacy_data')
      .values({ data_key: key, value_json: valueJson })
      .onDuplicateKeyUpdate({ value_json: valueJson, updated_at: new Date() })
      .execute();
    if (key === 'app_settings' && parsed.data.value && typeof parsed.data.value === 'object') {
      const settings = parsed.data.value as {
        generalConfig?: { portalName?: unknown };
        companyConfig?: { name?: unknown };
      };
      const portalName = typeof settings.generalConfig?.portalName === 'string' ? settings.generalConfig.portalName.trim() : '';
      const companyName = typeof settings.companyConfig?.name === 'string' ? settings.companyConfig.name.trim() : '';
      if (portalName || companyName) {
        await app.db
          .updateTable('app_settings')
          .set({
            ...(portalName ? { portal_name: portalName } : {}),
            ...(companyName ? { company_name: companyName } : {}),
            updated_at: new Date()
          })
          .where('id', '=', 1)
          .execute();
      }
    }
    return reply.send({ success: true });
  });

  app.get('/api/v1/attachments/:id', async (req, reply) => {
    if (!hasValidSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    const id = (req.params as { id: string }).id;
    const row = await app.db
      .selectFrom('legacy_attachments')
      .select('value_json')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const value = typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json;
    return reply.send({ value });
  });

  app.put('/api/v1/attachments/:id', async (req, reply) => {
    if (!hasValidSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    const id = (req.params as { id: string }).id;
    const parsed = attachmentSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.id !== id) return reply.code(400).send({ error: 'invalid_body' });
    const valueJson = JSON.stringify(parsed.data);
    await app.db
      .insertInto('legacy_attachments')
      .values({ id, value_json: valueJson })
      .onDuplicateKeyUpdate({ value_json: valueJson, updated_at: new Date() })
      .execute();
    return reply.send({
      id: parsed.data.id,
      name: parsed.data.name,
      type: parsed.data.type,
      size: parsed.data.size
    });
  });
}
