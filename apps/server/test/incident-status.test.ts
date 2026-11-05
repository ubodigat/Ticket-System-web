import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';
import { memoryDb } from './helpers/memoryDb.js';
import { TICKET_STATUSES } from '../src/domain/status.js';

async function fixture(status = 'In Bearbeitung') {
  const tables: Record<string, any[]> = { tickets: [
    { id: 'child', type: 'ticket', status: 'Neu', created_by_user_id: 'owner', archived_at: null, incident_id: null, closed_at: null },
    { id: 'incident', type: 'incident', status, created_by_user_id: 'staff', archived_at: null }
  ] };
  const db = memoryDb(tables), app = Fastify(); app.decorate('db', db);
  const actor = { uid: 'owner', username: 'owner', role: 'user' as 'user' | 'superadmin' };
  app.addHook('onRequest', async req => { req.ticketSession = actor; });
  registerTicketsV2Routes(app, { env: { INSTALLATION_ID: 'test' } as any, keyProvider: {} as any });
  const link = (id = 'child', incidentId = 'incident') => app.inject({ method: 'POST',
    url: `/api/v2/tickets/${id}/link-incident`, payload: { incident_id: incidentId } });
  return { app, db, tables, actor, link };
}

describe('status inheritance when linking an incident', () => {
  it.each(TICKET_STATUSES.filter(status => status !== 'Geschlossen'))('inherits %s for an ordinary user', async status => {
    const f = await fixture(status);
    try {
      const response = await f.link();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ success: true, status });
      expect(f.tables.tickets![0]).toMatchObject({ incident_id: 'incident', status });
      if (status !== 'Neu') expect(f.tables.ticket_audit_log).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'status', old_value: 'Neu', new_value: status })
      ]));
      if (status.startsWith('Warten auf')) {
        expect(f.tables.tickets![0].waiting_since).toMatch(/^\d{4}-\d{2}-\d{2} /);
        expect(f.tables.tickets![0].waiting_reminder_sent).toBe(false);
      }
    } finally { await f.app.close(); }
  });
  it('does not reset the waiting clock or duplicate audit entries on a repeated link', async () => {
    const f = await fixture('Warten auf interne Rückmeldung');
    try {
      await f.link(); const since = f.tables.tickets![0].waiting_since;
      const auditCount = f.tables.ticket_audit_log!.length;
      await f.link();
      expect(f.tables.tickets![0].waiting_since).toBe(since);
      expect(f.tables.ticket_audit_log).toHaveLength(auditCount);
    } finally { await f.app.close(); }
  });
  it('clears stale waiting/closing metadata, without copying private incident text', async () => {
    const f = await fixture();
    try {
      Object.assign(f.tables.tickets![0], { status: 'Warten auf Benutzer', waiting_since: '2026-01-01 00:00:00', waiting_reminder_sent: true, waiting_message: Buffer.from('old private message'), closed_at: '2026-01-01 00:00:00' });
      expect((await f.link()).statusCode).toBe(200);
      expect(f.tables.tickets![0]).toMatchObject({ status: 'In Bearbeitung', waiting_since: null, waiting_reminder_sent: false, waiting_message: null, closed_at: null });
    } finally { await f.app.close(); }
  });
  it('denies other users and unavailable incidents without changing the ticket', async () => {
    const f = await fixture();
    try {
      f.actor.uid = 'other'; expect((await f.link()).statusCode).toBe(403);
      f.actor.uid = 'owner'; f.tables.tickets![1].status = 'Geschlossen';
      expect((await f.link()).statusCode).toBe(400);
      expect(f.tables.tickets![0]).toMatchObject({ incident_id: null, status: 'Neu' });
      expect((await f.link('child', 'child')).statusCode).toBe(400);
      f.tables.tickets![0].archived_at = new Date();
      expect((await f.link()).statusCode).toBe(409);
    } finally { await f.app.close(); }
  });
  it('sets the closing timestamp when an authorized admin links to a closed incident', async () => {
    const f = await fixture('Geschlossen');
    try {
      f.actor.role = 'superadmin'; expect((await f.link()).statusCode).toBe(200);
      expect(f.tables.tickets![0].closed_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
    } finally { await f.app.close(); }
  });
  it('rolls back both the link and status if writing the history fails', async () => {
    const f = await fixture();
    try {
      f.db.insertInto = () => ({ values: () => ({ execute: async () => { throw new Error('Simulated audit failure'); } }) });
      expect((await f.link()).statusCode).toBe(500);
      expect(f.tables.tickets![0]).toMatchObject({ incident_id: null, status: 'Neu' });
    } finally { await f.app.close(); }
  });
});
