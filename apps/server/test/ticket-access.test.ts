import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { canAccessTicket, canReadAttachment, scopeAllowsTicket, visibleGroupIds } from '../src/domain/ticketAccess.js';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';
import { testDek } from './helpers/testDek.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ purpose: 'test', keyVersion: 1, rawDek: Buffer.alloc(32, 7), keys: new Map([[1, Buffer.alloc(32, 7)]]) }) }));
const notifications: any[] = [];
vi.mock('../src/http/routes/extras.js', () => ({ createNotification: vi.fn(async (_app: unknown, _deps: unknown, params: unknown) => { notifications.push(params); }) }));

// Minimaler Kysely-Ersatz: liefert je Tabelle feste Zeilen und merkt sich Schreibzugriffe.
function fakeDb(tables: Record<string, any[]>) {
  const writes: Array<{ op: string; table: string; value: any }> = [];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = {
        select: () => chain, selectAll: () => chain, where: () => chain, orderBy: () => chain, innerJoin: () => chain, limit: () => chain, forUpdate: () => chain,
        executeTakeFirst: async () => (tables[table] || [])[0],
        executeTakeFirstOrThrow: async () => { const row = (tables[table] || [])[0]; if (!row) throw new Error('no row'); return row; },
        execute: async () => tables[table] || []
      };
      return chain;
    },
    insertInto: (table: string) => ({ values: (value: any) => ({ execute: async () => { writes.push({ op: 'insert', table, value }); } }) }),
    updateTable: (table: string) => {
      const chain: any = { set: (value: any) => { writes.push({ op: 'update', table, value }); return chain; }, where: () => chain, execute: async () => undefined };
      return chain;
    }
  };
  return { db, writes };
}

const admin = { uid: 'admin-1', role: 'admin' };
const groups = [
  { id: 'it', parent_id: null }, { id: 'net', parent_id: 'it' }, { id: 'wifi', parent_id: 'net' },
  { id: 'hr', parent_id: null }, { id: 'it-sec', parent_id: 'it' }
];

describe('ticket visibility rules', () => {
  it('covers own groups, their parents and their subgroups -- but not sibling groups', () => {
    const visible = visibleGroupIds(['net'], groups);
    expect([...visible].sort()).toEqual(['it', 'net', 'wifi']);
    expect(visible.has('it-sec')).toBe(false);
    expect(visible.has('hr')).toBe(false);
  });

  it('lets admins see unassigned, own, assigned, participated, group and general tickets only', () => {
    const scope = { all: false, uid: 'admin-1', role: 'admin', visibleGroupIds: new Set(['net']), participantTicketIds: new Set(['p']) };
    const foreign = { assigned_to_user_id: 'other', category: 'Hardware' };
    expect(scopeAllowsTicket(scope, { id: 'a', ...foreign, assigned_to_user_id: null })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'b', ...foreign, assigned_to_user_id: 'admin-1' })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'p', ...foreign })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'c', ...foreign, assigned_group_id: 'net' })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'd', ...foreign, category: 'Allgemein' })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'e', ...foreign, created_by_user_id: 'admin-1' })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'f', ...foreign, assigned_group_id: 'hr' })).toBe(false);
    expect(scopeAllowsTicket(scope, { id: 'g', ...foreign })).toBe(false);
  });

  it('keeps normal accounts on their own tickets', () => {
    const scope = { all: false, uid: 'user-1', role: 'user', visibleGroupIds: new Set<string>(), participantTicketIds: new Set<string>() };
    expect(scopeAllowsTicket(scope, { id: 'a', created_by_user_id: 'user-1' })).toBe(true);
    expect(scopeAllowsTicket(scope, { id: 'b', created_by_user_id: 'other', assigned_to_user_id: null })).toBe(false);
  });

  it('checks single tickets against group membership on the server', async () => {
    const ticket = { id: 't1', created_by_user_id: 'u', assigned_to_user_id: 'other', assigned_group_id: 'hr', category: 'Hardware' };
    const outsider = fakeDb({ tickets: [ticket], user_groups: [{ group_id: 'net' }], groups, ticket_participants: [] });
    expect(await canAccessTicket(outsider.db, admin, 't1')).toBe(false);
    const member = fakeDb({ tickets: [{ ...ticket, assigned_group_id: 'wifi' }], user_groups: [{ group_id: 'net' }], groups, ticket_participants: [] });
    expect(await canAccessTicket(member.db, admin, 't1')).toBe(true);
    expect(await canAccessTicket(fakeDb({ tickets: [ticket] }).db, { uid: 's', role: 'superadmin' }, 't1')).toBe(true);
    expect(await canAccessTicket(fakeDb({ tickets: [] }).db, admin, 'missing')).toBeNull();
  });
});

describe('attachment access', () => {
  const ticket = { id: 't1', created_by_user_id: 'owner', assigned_to_user_id: 'other', assigned_group_id: 'hr', category: 'Hardware',
    approval_status: 'pending', approval_reviewer_id: 'boss' };
  const tables = { tickets: [ticket], user_groups: [], groups, ticket_participants: [] };

  it('keeps internal note attachments away from normal accounts, even on their own ticket', async () => {
    const { db } = fakeDb(tables);
    expect(await canReadAttachment(db, { uid: 'owner', role: 'user' }, { ticket_id: 't1', note_id: 'n1' })).toBe(false);
    expect(await canReadAttachment(db, { uid: 'owner', role: 'user' }, { ticket_id: 't1' })).toBe(true);
  });

  it('lets the pending approver read direct attachments only', async () => {
    const { db } = fakeDb(tables);
    const boss = { uid: 'boss', role: 'user' };
    expect(await canReadAttachment(db, boss, { ticket_id: 't1' })).toBe(true);
    expect(await canReadAttachment(db, boss, { ticket_id: 't1', message_id: 'm1' })).toBe(false);
    expect(await canReadAttachment(db, { uid: 'someone', role: 'user' }, { ticket_id: 't1' })).toBe(false);
  });

  it('denies admins without ticket access', async () => {
    const { db } = fakeDb(tables);
    expect(await canReadAttachment(db, admin, { ticket_id: 't1' })).toBe(false);
  });
});

describe('approvals', () => {
  const deps = { env: { INSTALLATION_ID: 'test' } as any, keyProvider: {} as any };
  const enc = (id: string, field: string, value: string) => fieldCipher.encryptField(value, testDek(), {
    installationId: 'test', tableName: 'tickets', recordId: id, fieldName: field });
  async function call(session: { uid: string; username: string; role: string }, tables: Record<string, any[]>, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const { db, writes } = fakeDb({ app_settings: [{ config_json: '{}' }], ...tables });
    const app = Fastify(); app.decorate('db', db);
    app.addHook('onRequest', async req => { req.ticketSession = session as any; });
    registerTicketsV2Routes(app, deps);
    try { return { response: await app.inject({ method, url, payload: payload as any }), writes }; } finally { await app.close(); }
  }
  const pendingTicket = { id: 't1', ticket_number: 'TS-1', approval_status: 'pending', approval_reviewer_id: 'boss', approval_requested_by: 'admin',
    created_by_user_id: 'owner', created_by_username: 'owner' };

  it('lets a normal account decide when it is the registered approver and keeps the decision in the history', async () => {
    notifications.length = 0;
    const { response, writes } = await call({ uid: 'boss', username: 'boss', role: 'user' },
      { tickets: [pendingTicket], ticket_approvals: [{ id: 'a1', requested_by_user_id: 'admin-1', requested_by_username: 'admin' }] },
      'POST', '/api/v2/tickets/t1/approval-decision', { decision: 'approved', reason: 'Passt so.' });
    expect(response.statusCode).toBe(200);
    const history = writes.find(w => w.op === 'update' && w.table === 'ticket_approvals');
    expect(history?.value).toMatchObject({ status: 'approved', decided_by_user_id: 'boss' });
    expect(history?.value.decision_text_enc).toBeInstanceOf(Buffer);
    expect(notifications.map(n => n.recipientUserId).sort()).toEqual(['admin-1', 'owner']);
  });

  it('rejects decisions by anyone else and rejections without a reason', async () => {
    const other = await call({ uid: 'someone', username: 'someone', role: 'user' }, { tickets: [pendingTicket] },
      'POST', '/api/v2/tickets/t1/approval-decision', { decision: 'approved' });
    expect(other.response.statusCode).toBe(403);
    const noReason = await call({ uid: 'boss', username: 'boss', role: 'user' }, { tickets: [pendingTicket] },
      'POST', '/api/v2/tickets/t1/approval-decision', { decision: 'rejected' });
    expect(noReason.response.statusCode).toBe(400);
  });

  it('accepts normal accounts as approvers but never archived accounts, the requester or the ticket author', async () => {
    const admin = { uid: 'admin-1', username: 'admin', role: 'superadmin' };
    const ticket = { ticket_number: 'TS-1', created_by_user_id: 'owner', archived_at: null };
    const ok = await call(admin, { tickets: [ticket], users: [{ id: 'boss', username: 'boss', account_archived: false }] },
      'POST', '/api/v2/tickets/t1/request-approval', { approver_user_id: 'boss', text: 'Bitte freigeben' });
    expect(ok.response.statusCode).toBe(200);
    expect(ok.writes.find(w => w.op === 'insert' && w.table === 'ticket_approvals')?.value).toMatchObject({ approver_user_id: 'boss', requested_by_user_id: 'admin-1' });
    const archived = await call(admin, { tickets: [ticket], users: [{ id: 'boss', username: 'boss', account_archived: true }] },
      'POST', '/api/v2/tickets/t1/request-approval', { approver_user_id: 'boss' });
    expect(archived.response.statusCode).toBe(400);
    const author = await call(admin, { tickets: [ticket] }, 'POST', '/api/v2/tickets/t1/request-approval', { approver_user_id: 'owner' });
    expect(author.response.json().error).toBe('approver_must_not_be_requester');
  });

  it('lists pending approvals with the request but without a way into a ticket the approver may not open', async () => {
    const row = { ...pendingTicket, title: enc('t1', 'title', 'Neuer Laptop'), description: enc('t1', 'description', 'Bitte bestellen'),
      priority: 'Hoch', category: 'Hardware', status: 'Offen', assigned_to_user_id: 'other', assigned_group_id: null, custom_fields_json: null, created_at: new Date() };
    const { response } = await call({ uid: 'boss', username: 'boss', role: 'user' }, { tickets: [row], ticket_approvals: [], attachments: [] }, 'GET', '/api/v2/approvals');
    expect(response.statusCode).toBe(200);
    const [approval] = response.json().approvals;
    expect(approval).toMatchObject({ ticket_id: 't1', title: 'Neuer Laptop', description: 'Bitte bestellen', can_open: false, attachments: [] });
  });
});
