import type { FastifyInstance } from 'fastify';
import { loadModules } from '../../domain/modules.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './session.js';
import { routeError } from './routeError.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../../db/date.js';
import type { ExtrasRouteDeps } from './extras.js';
import { insertAdminTodo } from '../../domain/adminTodos.js';

export const createAdminTodoSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  due_at: z.string().datetime().nullable().optional(),
  recipient_ids: z.array(z.string().uuid()).max(50).default([])
}).strict();

export const recurringAdminTodoSchema = createAdminTodoSchema.omit({ due_at: true }).extend({
  interval_unit: z.enum(['day', 'week', 'month', 'year']), interval_count: z.number().int().min(1).max(365),
  next_run_at: z.string().datetime(), due_after_hours: z.number().int().min(1).max(87600).nullable().default(null)
});

export function registerTodoRoutes(app: FastifyInstance, deps: ExtrasRouteDeps) {
  const context = (tableName: string, fieldName: string, recordId: string, keyVersion: number) => ({
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName, fieldName, recordId, keyVersion
  });
  app.get('/api/v2/todos/recurring', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const rows = await app.db.selectFrom('recurring_admin_todos').selectAll().where('created_by_user_id', '=', actor.uid).orderBy('next_run_at', 'asc').execute();
      const dek = await ensureDek(app.db, deps.keyProvider, 'recurring_admin_todos.content');
      return reply.send({ rules: rows.map(r => ({ ...r, active: !!r.active,
        content: fieldCipher.decryptField(r.content, dek.rawDek, context('recurring_admin_todos', 'content', r.id, dek.keyVersion)),
        recipient_ids: JSON.parse(r.recipient_ids_json), recipient_ids_json: undefined })) });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/todos/recurring', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const parsed = recurringAdminTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const ids = [...new Set([actor.uid, ...parsed.data.recipient_ids])];
      const recipients = await app.db.selectFrom('users').select('id').where('id', 'in', ids)
        .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false).execute();
      if (recipients.length !== ids.length) return reply.code(400).send({ error: 'invalid_recipient' });
      const id = randomUUID();
      const dek = await ensureDek(app.db, deps.keyProvider, 'recurring_admin_todos.content');
      await app.db.insertInto('recurring_admin_todos').values({ id, created_by_user_id: actor.uid,
        content: fieldCipher.encryptField(parsed.data.content, dek.rawDek, context('recurring_admin_todos', 'content', id, dek.keyVersion)),
        recipient_ids_json: JSON.stringify(ids.filter(uid => uid !== actor.uid)), interval_unit: parsed.data.interval_unit,
        interval_count: parsed.data.interval_count, due_after_hours: parsed.data.due_after_hours,
        next_run_at: mysqlTimestamp(new Date(parsed.data.next_run_at)), active: true }).execute();
      return reply.code(201).send({ id });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.patch('/api/v2/todos/recurring/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = z.object({ active: z.boolean() }).strict().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const rule = await app.db.selectFrom('recurring_admin_todos').select('id').where('id', '=', id).where('created_by_user_id', '=', actor.uid).executeTakeFirst();
      if (!rule) return reply.code(404).send({ error: 'not_found' });
      await app.db.updateTable('recurring_admin_todos').set({ active: parsed.data.active }).where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.delete('/api/v2/todos/recurring/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('recurring_admin_todos').where('id', '=', id).where('created_by_user_id', '=', actor.uid).execute();
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.get('/api/v2/todos', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const own = await app.db.selectFrom('admin_todos as t')
        .innerJoin('admin_todo_members as m', 'm.todo_id', 't.id')
        .selectAll('t').where('m.user_id', '=', actor.uid).where('m.hidden', '=', false).execute();
      const tasks = await app.db.selectFrom('ticket_todos as t').innerJoin('tickets as k', 'k.id', 't.ticket_id')
        .select(['t.id', 't.content', 't.done', 't.done_at', 't.ticket_id', 'k.title', 'k.ticket_number', 'k.custom_due_at', 'k.sla_due_at', 'k.status', 'k.closed_at'])
        .where('k.archived_at', 'is', null)
        .where(eb => eb.or([
          eb('t.assignee_user_id', '=', actor.uid),
          eb.and([eb('t.assignee_user_id', 'is', null), eb('t.assignee_username', '=', actor.username)]),
          eb('k.assigned_to_user_id', '=', actor.uid),
          eb.and([eb('k.assigned_to_user_id', 'is', null), eb('k.assigned_to_username', '=', actor.username)])
        ])).execute();
      const [personalDek, taskDek, titleDek] = await Promise.all([
        ensureDek(app.db, deps.keyProvider, 'admin_todos.content'),
        ensureDek(app.db, deps.keyProvider, 'ticket_todos.content'),
        ensureDek(app.db, deps.keyProvider, 'tickets.title')
      ]);
      const slaModuleActive = (await loadModules(app.db)).sla;
      const decrypt = (value: Buffer, table: string, field: string, id: string, dek: typeof personalDek) =>
        fieldCipher.decryptField(value, dek.rawDek, context(table, field, id, dek.keyVersion));
      return reply.send({ todos: [
        ...own.map(t => ({ id: t.id, kind: 'personal', content: decrypt(t.content, 'admin_todos', 'content', t.id, personalDek),
          done: !!t.done, done_at: t.done_at ?? null, due_at: t.due_at, creator_id: t.created_by_user_id })),
        ...tasks.map(t => ({ id: t.id, kind: 'ticket', content: decrypt(t.content, 'ticket_todos', 'content', t.id, taskDek),
          done: !!t.done, done_at: t.done_at ?? null, due_at: slaModuleActive ? t.custom_due_at || t.sla_due_at : null, ticket_id: t.ticket_id, ticket_number: t.ticket_number,
          ticket_closed: t.status === 'Geschlossen', ticket_closed_at: t.status === 'Geschlossen' ? t.closed_at ?? null : null,
          ticket_title: decrypt(t.title, 'tickets', 'title', t.ticket_id, titleDek) }))
      ] });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/todos', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const parsed = createAdminTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const id = await app.db.transaction().execute(trx => insertAdminTodo(trx, deps, actor, parsed.data));
      return reply.code(201).send({ id });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.patch('/api/v2/todos/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = z.object({ done: z.boolean().optional(), content: z.string().trim().min(1).max(5000).optional(),
        due_at: z.string().datetime().nullable().optional() }).strict().refine(data => Object.keys(data).length > 0).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const member = await app.db.selectFrom('admin_todo_members').select('todo_id')
        .where('todo_id', '=', id).where('user_id', '=', actor.uid).where('hidden', '=', false).executeTakeFirst();
      if (!member) return reply.code(404).send({ error: 'not_found' });
      const updates: Record<string, unknown> = {};
      if (parsed.data.done !== undefined) { updates.done = parsed.data.done; updates.done_at = parsed.data.done ? mysqlTimestamp() : null; }
      if (parsed.data.content !== undefined || parsed.data.due_at !== undefined) {
        const todo = await app.db.selectFrom('admin_todos').select('created_by_user_id').where('id', '=', id).executeTakeFirst();
        if (todo?.created_by_user_id !== actor.uid) return reply.code(403).send({ error: 'forbidden' });
        if (parsed.data.content !== undefined) {
          const dek = await ensureDek(app.db, deps.keyProvider, 'admin_todos.content');
          updates.content = fieldCipher.encryptField(parsed.data.content, dek.rawDek, context('admin_todos', 'content', id, dek.keyVersion));
        }
        if (parsed.data.due_at !== undefined) updates.due_at = parsed.data.due_at ? mysqlTimestamp(new Date(parsed.data.due_at)) : null;
      }
      await app.db.updateTable('admin_todos').set(updates).where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.delete('/api/v2/todos/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      await app.db.updateTable('admin_todo_members').set({ hidden: true })
        .where('todo_id', '=', id).where('user_id', '=', actor.uid).execute();
      return reply.send({ success: true });
    } catch (error) { return routeError(app, reply, error); }
  });
}
