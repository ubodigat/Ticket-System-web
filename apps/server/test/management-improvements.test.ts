import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { memoryDb } from './helpers/memoryDb.js';
import { registerUsersV2Routes } from '../src/http/routes/users.js';
import { registerKnowledgeRoutes } from '../src/http/routes/knowledge.js';
import { runAbsenceSchedules, runWaitingTickets } from '../src/jobs/maintenance.js';
import { renderMailTemplate } from '../src/mail/mailer.js';
const uid = '11111111-1111-4111-8111-111111111111', sid = '22222222-2222-4222-8222-222222222222';
async function fixture() {
  const tables: Record<string, any[]> = { users: [{ id: uid, username: 'admin', role: 'superadmin' }, { id: sid, username: 'substitute', role: 'admin' }], app_settings: [{ id: 1, config_json: '{}' }] };
  const db = memoryDb(tables), app = Fastify(); app.decorate('db', db);
  const actor = { uid, username: 'admin', role: 'superadmin' as 'superadmin' | 'user' }; let authenticated = true;
  app.addHook('onRequest', async req => { req.ticketSession = authenticated ? actor : null; });
  const deps = { db, env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any,
    keyProvider: { wrapDek: async (value: Buffer) => value, unwrapDek: async (value: Buffer) => value } as any };
  registerUsersV2Routes(app, deps); registerKnowledgeRoutes(app, deps);
  const plan = (start: number, end: number, substitute = sid) => app.inject({ method: 'POST', url: '/api/v2/users/me/absence', payload: {
    active: true, append: true, from_at: new Date(Date.now() + start * 86400000).toISOString(), until_at: new Date(Date.now() + end * 86400000).toISOString(), substitute_user_id: substitute, visible: true } });
  return { tables, db, app, deps, actor, plan, anonymous: () => { authenticated = false; } };
}
describe('management improvements', () => {
  it('renders additional mail variables exactly once and keeps unknown placeholders intact', () => {
    expect(renderMailTemplate('{{company}} / {{recipientName}} / {{date}} / {{unknown}}', { company: 'Example', recipientName: '{{company}}', date: '29.10.2026' })).toBe('Example / {{company}} / 29.10.2026 / {{unknown}}');
  });
  it('edits text blocks with encrypted content and enforces administrator access', async () => {
    const f = await fixture();
    try {
      const created = await f.app.inject({ method: 'POST', url: '/api/v2/text-blocks', payload: { title: 'Old', content: 'Private text' } }); expect(created.statusCode).toBe(201);
      const id = created.json().id;
      expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/text-blocks/' + id, payload: { title: 'Updated', content: 'New confidential text' } })).statusCode).toBe(200);
      expect(f.tables.text_blocks![0].content.toString()).not.toContain('confidential');
      expect((await f.app.inject('/api/v2/text-blocks')).json().blocks[0].content).toBe('New confidential text');
      f.actor.role = 'user'; expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/text-blocks/' + id, payload: { title: 'Attack', content: 'No' } })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
  it('stores several planned periods without transferring tickets prematurely', async () => {
    const f = await fixture();
    try {
      f.tables.tickets = [{ id: 'ticket', assigned_to_user_id: uid, status: 'Neu', archived_at: null }];
      expect((await f.plan(10, 12)).statusCode).toBe(200); expect((await f.plan(20, 22)).statusCode).toBe(200);
      expect((await f.app.inject('/api/v2/users/me/absences')).json().absences).toHaveLength(2);
      expect(f.tables.tickets[0].assigned_to_user_id).toBe(uid);
      expect((await f.plan(11, 13)).statusCode).toBe(409); expect(f.tables.user_absences).toHaveLength(2);
    } finally { await f.app.close(); }
  });
  it('does not permit deleting another admin’s period', async () => {
    const f = await fixture();
    try {
      await f.plan(10, 12); const id = f.tables.user_absences![0].id; f.actor.uid = sid;
      expect((await f.app.inject({ method: 'DELETE', url: '/api/v2/users/me/absences/' + id })).statusCode).toBe(404);
      expect(f.tables.user_absences![0].active).toBe(true);
      f.anonymous(); expect((await f.app.inject('/api/v2/users/me/absences')).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('immediately returns only open tickets to the team when absence starts without a substitute', async () => {
    const f = await fixture();
    try {
      f.tables.tickets = [{ id: 'open', assigned_to_user_id: uid, status: 'Neu', archived_at: null }, { id: 'closed', assigned_to_user_id: uid, status: 'Geschlossen', archived_at: null }];
      const response = await f.app.inject({ method: 'POST', url: '/api/v2/users/me/absence', payload: { active: true, append: true, substitute_user_id: null } });
      expect(response.statusCode).toBe(200); expect(f.tables.tickets[0].assigned_to_user_id).toBeNull(); expect(f.tables.tickets[1].assigned_to_user_id).toBe(uid);
    } finally { await f.app.close(); }
  });
  it('activates a due period once and automatically ends expired periods', async () => {
    const f = await fixture();
    try {
      f.tables.user_absences = [{ id: 'period', user_id: uid, active: true, from_at: new Date(Date.now() - 1000), until_at: new Date(Date.now() + 60000), substitute_user_id: sid }];
      f.tables.tickets = [{ id: 'ticket', assigned_to_user_id: uid, archived_at: null, status: 'Neu' }];
      expect((await runAbsenceSchedules(f.deps)).reassigned).toBe(1);
      expect(f.tables.tickets[0].assigned_to_user_id).toBe(sid);
      expect((await runAbsenceSchedules(f.deps)).reassigned).toBe(0);
      f.tables.users![1].account_valid_until = '1000-01-01';
      f.tables.tickets.push({ id: 'new-ticket', assigned_to_user_id: uid, archived_at: null, status: 'Neu' });
      expect((await runAbsenceSchedules(f.deps)).reassigned).toBe(1);
      expect(f.tables.tickets[1].assigned_to_user_id).toBeNull();
      f.tables.user_absences[0].until_at = new Date(0); expect((await runAbsenceSchedules(f.deps)).ended).toBe(1);
    } finally { await f.app.close(); }
  });
  it('leaves waiting tickets untouched when reminder and automatic closing are disabled', async () => {
    const f = await fixture();
    try {
      f.tables.app_settings![0].config_json = JSON.stringify({ waitingAfterAction: 'keep_open', waitingReminderEnabled: false });
      f.tables.tickets = [{ id: 'ticket', status: 'Wartet', waiting_since: new Date(0), waiting_reminder_sent: false, archived_at: null }];
      expect(await runWaitingTickets(f.deps)).toEqual({ reminded: 0, closed: 0 });
      expect(f.tables.tickets[0].status).toBe('Wartet'); expect(f.tables.ticket_audit_log || []).toHaveLength(0);
    } finally { await f.app.close(); }
  });
});
