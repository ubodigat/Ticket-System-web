import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UsersRouteDeps } from './users.js';
import { requireAdmin } from './session.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { routeError } from './routeError.js';

export function timerMinutes(start: Date, stop: Date) {
  return Math.max(1, Math.ceil((stop.getTime() - start.getTime()) / 60000));
}
export const finishTimerSchema = z.object({ activity: z.string().trim().min(1).max(4000), solution: z.string().trim().max(10000).optional() }).strict();

export function registerWorkTimerRoutes(app: FastifyInstance, deps: UsersRouteDeps) {
  app.get('/api/v2/work-timer', async (req, reply) => {
    try {
      const { uid } = requireAdmin(req);
      reply.header('Cache-Control', 'no-store');
      return { timer: await app.db.selectFrom('ticket_work_timers').selectAll().where('user_id', '=', uid).executeTakeFirst() || null };
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/work-timer', async (req, reply) => {
    try {
      const { uid } = requireAdmin(req);
      const parsed = z.object({ ticketId: z.uuid() }).strict().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_ticket' });
      const result = await app.db.transaction().execute(async trx => {
        await trx.selectFrom('users').select('id').where('id', '=', uid).forUpdate().executeTakeFirstOrThrow();
        const previous = await trx.selectFrom('ticket_work_timers').selectAll().where('user_id', '=', uid).executeTakeFirst();
        if (previous) return { conflict: true, timer: previous };
        const ticket = await trx.selectFrom('tickets').select(['id', 'archived_at']).where('id', '=', parsed.data.ticketId).executeTakeFirst();
        if (!ticket || ticket.archived_at) return null;
        const timer = { id: randomUUID(), user_id: uid, ticket_id: ticket.id, started_at: new Date(), stopped_at: null };
        await trx.insertInto('ticket_work_timers').values(timer).execute();
        return { conflict: false, timer };
      });
      if (!result) return reply.code(404).send({ error: 'ticket_not_available' });
      return reply.code(result.conflict ? 409 : 201).send(result);
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/work-timer/:id/stop', async (req, reply) => {
    try {
      const { uid } = requireAdmin(req); const { id } = req.params as { id: string };
      const timer = await app.db.transaction().execute(async trx => {
        const row = await trx.selectFrom('ticket_work_timers').selectAll().where('user_id', '=', uid).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!row) return null;
        if (row.stopped_at) return row;
        const stopped_at = new Date();
        await trx.updateTable('ticket_work_timers').set({ stopped_at }).where('user_id', '=', uid).where('id', '=', id).execute();
        return { ...row, stopped_at };
      });
      return timer ? { timer } : reply.code(404).send({ error: 'timer_not_found' });
    } catch (error) { return routeError(app, reply, error); }
  });
  app.post('/api/v2/work-timer/:id/complete', async (req, reply) => {
    try {
      const session = requireAdmin(req); const { id } = req.params as { id: string };
      const parsed = finishTimerSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'activity_required' });
      const activityDek = await ensureDek(app.db, deps.keyProvider, 'ticket_time_entries.note');
      const noteDek = await ensureDek(app.db, deps.keyProvider, 'ticket_notes.content');
      const encrypt = (text: string, tableName: string, recordId: string, fieldName: string, dek: typeof noteDek) =>
        fieldCipher.encryptField(text, dek.rawDek, { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName, recordId, fieldName, keyVersion: dek.keyVersion });
      const result = await app.db.transaction().execute(async trx => {
        const timer = await trx.selectFrom('ticket_work_timers').selectAll().where('user_id', '=', session.uid).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!timer?.stopped_at) return null;
        const entryId = randomUUID(); const minutes = timerMinutes(new Date(timer.started_at), new Date(timer.stopped_at));
        await trx.insertInto('ticket_time_entries').values({ id: entryId, ticket_id: timer.ticket_id, user_id: session.uid,
          username: session.username, minutes,
          note: null, note_enc: encrypt(parsed.data.activity, 'ticket_time_entries', entryId, 'note', activityDek) }).execute();
        if (parsed.data.solution) {
          const noteId = randomUUID();
          await trx.insertInto('ticket_notes').values({ id: noteId, ticket_id: timer.ticket_id,
            author_user_id: session.uid, author_username: session.username, author_name: session.username,
            stream: 'solution', note_type: 'note', content: encrypt(parsed.data.solution, 'ticket_notes', noteId, 'content', noteDek),
            is_pinned: false, is_resolution: false, has_attachments: false }).execute();
        }
        await trx.deleteFrom('ticket_work_timers').where('user_id', '=', session.uid).where('id', '=', id).execute();
        return { entryId, ticketId: timer.ticket_id, minutes };
      });
      return result ? reply.code(201).send(result) : reply.code(409).send({ error: 'timer_not_stopped' });
    } catch (error) { return routeError(app, reply, error); }
  });
}
