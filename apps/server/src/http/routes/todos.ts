import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './session.js';
import { routeError } from './routeError.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../../db/date.js';
import { createNotification, type ExtrasRouteDeps } from './extras.js';

export const createAdminTodoSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  due_at: z.string().datetime().nullable().optional(),
  recipient_ids: z.array(z.string().uuid()).max(50).default([])
}).strict();

export function registerTodoRoutes(app: FastifyInstance, deps: ExtrasRouteDeps) {
  const context = (tableName: string, fieldName: string, recordId: string, keyVersion: number) => ({
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName, fieldName, recordId, keyVersion
  });
  app.get('/api/v2/todos', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const own = await app.db.selectFrom('admin_todos as t')
        .innerJoin('admin_todo_members as m', 'm.todo_id', 't.id')
        .selectAll('t').where('m.user_id', '=', actor.uid).where('m.hidden', '=', false).execute();
      const tasks = await app.db.selectFrom('ticket_todos as t').innerJoin('tickets as k', 'k.id', 't.ticket_id')
        .select(['t.id', 't.content', 't.done', 't.ticket_id', 'k.title', 'k.ticket_number', 'k.custom_due_at', 'k.sla_due_at'])
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
      const decrypt = (value: Buffer, table: string, field: string, id: string, dek: typeof personalDek) =>
        fieldCipher.decryptField(value, dek.rawDek, context(table, field, id, dek.keyVersion));
      return reply.send({ todos: [
        ...own.map(t => ({ id: t.id, kind: 'personal', content: decrypt(t.content, 'admin_todos', 'content', t.id, personalDek),
          done: !!t.done, due_at: t.due_at, creator_id: t.created_by_user_id })),
        ...tasks.map(t => ({ id: t.id, kind: 'ticket', content: decrypt(t.content, 'ticket_todos', 'content', t.id, taskDek),
          done: !!t.done, due_at: t.custom_due_at || t.sla_due_at, ticket_id: t.ticket_id, ticket_number: t.ticket_number,
          ticket_title: decrypt(t.title, 'tickets', 'title', t.ticket_id, titleDek) }))
      ] });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/todos', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const parsed = createAdminTodoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const ids = [...new Set([actor.uid, ...parsed.data.recipient_ids])];
      const recipients = await app.db.selectFrom('users').select(['id', 'username'])
        .where('id', 'in', ids).where('role', 'in', ['admin', 'superadmin'])
        .where('account_archived', '=', false).execute();
      if (recipients.length !== ids.length) return reply.code(400).send({ error: 'invalid_recipient' });
      const id = randomUUID();
      const dek = await ensureDek(app.db, deps.keyProvider, 'admin_todos.content');
      await app.db.transaction().execute(async trx => {
        await trx.insertInto('admin_todos').values({ id, created_by_user_id: actor.uid, done: false,
          due_at: parsed.data.due_at ? mysqlTimestamp(new Date(parsed.data.due_at)) : null,
          content: fieldCipher.encryptField(parsed.data.content, dek.rawDek, context('admin_todos', 'content', id, dek.keyVersion)) }).execute();
        await trx.insertInto('admin_todo_members').values(ids.map(user_id => ({ todo_id: id, user_id, hidden: false }))).execute();
      });
      for (const recipient of recipients.filter(r => r.id !== actor.uid)) {
        await createNotification(app, deps, { recipientUserId: recipient.id, recipientUsername: recipient.username,
          type: 'todo_assigned', message: `${actor.username} hat dir eine Aufgabe zugewiesen: ${parsed.data.content.slice(0, 1000)}` });
      }
      return reply.code(201).send({ id });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.patch('/api/v2/todos/:id', async (req, reply) => {
    try {
      const actor = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = z.object({ done: z.boolean() }).strict().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const member = await app.db.selectFrom('admin_todo_members').select('todo_id')
        .where('todo_id', '=', id).where('user_id', '=', actor.uid).where('hidden', '=', false).executeTakeFirst();
      if (!member) return reply.code(404).send({ error: 'not_found' });
      await app.db.updateTable('admin_todos').set({ done: parsed.data.done }).where('id', '=', id).execute();
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
