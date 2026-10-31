import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';
import { registerExtrasV2Routes } from '../src/http/routes/extras.js';
import { registerRecurringRoutes } from '../src/http/routes/recurring.js';
import { fieldCipher, decryptFieldTolerant } from '../src/crypto/fieldCrypto.js';
import { encryptMailSecrets, readMailSecrets } from '../src/mail/secrets.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
const deps = { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any };

function database(owner: string | null = 'owner') {
  const operations: any[] = [];
  const db: any = {
    selectFrom(table: string) {
      const filters: any[] = [];
      const chain: any = {
        select: () => chain, selectAll: () => chain, forUpdate: () => chain,
        orderBy: () => chain, limit: () => chain,
        where: (...args: any[]) => { filters.push(args); operations.push({ table, where: args }); return chain; },
        executeTakeFirst: async () => table === 'tickets' ? { id: filters[0]?.[2], ticket_number: '1',
          created_by_user_id: filters[0]?.[2] === 'source' ? owner : owner === null ? null : 'owner', merged_into_ticket_id: null }
          : table === 'users' ? undefined : {},
        execute: async () => []
      }; return chain;
    },
    insertInto: (table: string) => ({ values: (values: any) => ({ execute: async () => { operations.push({ table, values }); } }) }),
    updateTable: (table: string) => {
      const chain: any = { set: (set: any) => { operations.push({ table, set }); return chain; },
        where: (...where: any[]) => { operations.push({ table, where }); return chain; }, execute: async () => [] };
      return chain;
    },
    deleteFrom: (table: string) => { const chain: any = { where: (...where: any[]) => {
      operations.push({ table, where }); return chain;
    }, execute: async () => [] }; return chain; },
    transaction: () => ({ execute: (callback: any) => callback(db) })
  }; return { db, operations };
}

async function request(role: 'user' | 'admin' | 'superadmin', method: 'GET' | 'POST' | 'DELETE', url: string, payload?: any, owner?: string | null) {
  const { db, operations } = database(owner);
  const app = Fastify(); app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'caller-id', username: 'reused-name', role }; });
  registerTicketsV2Routes(app, deps); registerExtrasV2Routes(app, deps); registerRecurringRoutes(app, deps);
  try { return { response: await app.inject({ method, url, payload }), operations }; }
  finally { await app.close(); }
}

describe('audit authorization regressions', () => {
  it.each(['admin', 'superadmin'] as const)('rejects cross-owner merges for %s without moving private data', async role => {
    const { response, operations } = await request(role, 'POST', '/api/v2/tickets/source/merge', { target_ticket_id: 'target' }, 'foreign');
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('cross_user_merge_forbidden');
    expect(operations.some(op => op.set)).toBe(false);
  });
  it('rejects merges where both historical creator IDs are unknown', async () => {
    const result = await request('superadmin', 'POST', '/api/v2/tickets/source/merge', { target_ticket_id: 'target' }, null);
    expect(result.response.statusCode).toBe(403);
  });
  it('allows a merge of two tickets belonging to the same known creator', async () => {
    const result = await request('admin', 'POST', '/api/v2/tickets/source/merge', { target_ticket_id: 'target' });
    expect(result.response.statusCode).toBe(200);
    expect(result.operations).toContainEqual({ table: 'ticket_messages', set: { ticket_id: 'target' } });
  });
  it('does not let ordinary users create calendar invitations', async () => {
    const result = await request('user', 'POST', '/api/v2/tickets/source/calendar-event', {});
    expect(result.response.statusCode).toBe(403);
    expect(result.operations).toHaveLength(0);
  });
  it('edits recurring ticket rules with encrypted texts and rejects unknown fields', async () => {
    const result = await request('superadmin', 'PATCH', '/api/v2/recurring-rules/r1',
      { title: 'Backup prüfen', priority: 'Hoch', interval_unit: 'month', interval_count: 2, next_run_at: '2026-11-02T08:00:00.000Z' });
    expect(result.response.statusCode).toBe(200);
    const update = result.operations.find(op => op.table === 'recurring_ticket_rules' && op.set)!.set;
    expect(update).toMatchObject({ priority: 'Hoch', interval_unit: 'month', interval_count: 2 });
    expect(Buffer.isBuffer(update.title)).toBe(true);
    expect(update.title.toString()).not.toContain('Backup');
    expect(update).not.toHaveProperty('description');
    for (const payload of [{}, { created_by_user_id: 'x' }, { priority: 'Egal' }, { interval_count: 0 }]) {
      expect((await request('superadmin', 'PATCH', '/api/v2/recurring-rules/r1', payload)).response.statusCode).toBe(400);
    }
    expect((await request('user', 'PATCH', '/api/v2/recurring-rules/r1', { title: 'X' })).response.statusCode).toBe(403);
  });
  it.each(['admin', 'superadmin'] as const)('allows external recipients past validation but still requires Outlook configuration for %s', async role => {
    const result = await request(role, 'POST', '/api/v2/tickets/source/calendar-event', {
      subject: 'Spam', start_at: '2026-11-01T10:00:00Z', end_at: '2026-11-01T11:00:00Z', attendee_emails: ['outsider@example.org']
    });
    expect(result.response.statusCode).toBe(409);
    expect(result.response.json().error).toBe('outlook_not_configured');
    expect(result.operations.some(op => op.values)).toBe(false);
  });
  it.each([['GET', '/api/v2/notifications'], ['POST', '/api/v2/notifications/read-all'],
    ['POST', '/api/v2/notifications/one/read'], ['DELETE', '/api/v2/notifications/one'], ['DELETE', '/api/v2/notifications']] as const)
    ('scopes %s %s by immutable identity, not a reused username', async (method, url) => {
      const result = await request('user', method, url);
      expect(result.response.statusCode).toBe(200);
      expect(result.operations).toContainEqual({ table: 'notifications', where: ['recipient_user_id', '=', 'caller-id'] });
      expect(result.operations.some(op => op.where?.[0] === 'recipient_username')).toBe(false);
    });
  it('denies ordinary users an attachment that has no owning ticket (fail-closed)', async () => {
    const result = await request('user', 'GET', '/api/v2/attachments/orphan');
    expect(result.response.statusCode).toBe(403);
  });
  it('does not let ordinary users attach files to internal notes', async () => {
    const result = await request('user', 'POST', '/api/v2/attachments', {
      ticket_id: 'source', note_id: 'internal-note', filename: 'a.txt', mime_type: 'text/plain', size_bytes: 1, data_b64: 'YQ=='
    }, 'caller-id');
    expect(result.response.statusCode).toBe(403);
    expect(result.operations.some(op => op.table === 'attachments' && op.values)).toBe(false);
  });
});

describe('encrypted data boundaries', () => {
  const ctx = { installationId: 'test', schemaVersion: 1, tableName: 'tickets', recordId: 'one', fieldName: 'waiting_message', keyVersion: 1 };
  it('never returns raw bytes on authentication failure or wrong AAD', () => {
    const key = Buffer.alloc(32, 7);
    const ciphertext = fieldCipher.encryptField('Private message', key, ctx);
    expect(decryptFieldTolerant(ciphertext, key, ctx)).toBe('Private message');
    expect(() => decryptFieldTolerant(ciphertext, key, { ...ctx, recordId: 'two' })).toThrow();
    ciphertext[ciphertext.length - 1]! ^= 1;
    expect(() => decryptFieldTolerant(ciphertext, key, ctx)).toThrow();
    expect(() => decryptFieldTolerant(Buffer.from('legacy plaintext'), key, ctx)).toThrow();
  });
  it('encrypts private mail keys and passphrases in a separate authenticated envelope', async () => {
    const input = { smimePrivateKeyPem: 'PRIVATE-KEY-SECRET', smimePassphrase: 'secret-passphrase', dkimPrivateKeyPem: 'DKIM-SECRET' };
    const encrypted = await encryptMailSecrets({ ...deps, db: {} as any }, input);
    expect(encrypted.toString()).not.toContain('SECRET');
    expect(await readMailSecrets({ ...deps, db: {} as any }, encrypted)).toEqual(input);
    encrypted[0]! ^= 1;
    await expect(readMailSecrets({ ...deps, db: {} as any }, encrypted)).rejects.toThrow();
  });
  it('encrypts company and reason text when creating a public account request', async () => {
    const { response, operations } = await request('user', 'POST', '/api/v2/account-requests', {
      name: 'Example', email: 'example@example.org', company: 'Private company', reason: 'Sensitive reason'
    });
    expect(response.statusCode).toBe(201);
    const row = operations.find(op => op.table === 'account_requests' && op.values).values;
    for (const [field, plaintext] of [['company', 'Private company'], ['reason', 'Sensitive reason']]) {
      expect(Buffer.isBuffer(row[field!])).toBe(true);
      expect(fieldCipher.decryptField(row[field!], Buffer.alloc(32, 7), { ...ctx, tableName: 'account_requests', recordId: row.id, fieldName: field! })).toBe(plaintext);
    }
  });
  it('encrypts recurring ticket titles and descriptions before persistence', async () => {
    const { response, operations } = await request('superadmin', 'POST', '/api/v2/recurring-rules', {
      title: 'Private recurring task', description: 'Sensitive description', interval_unit: 'day', next_run_at: '2026-11-01T10:00:00Z'
    });
    expect(response.statusCode).toBe(201);
    const row = operations.find(op => op.table === 'recurring_ticket_rules' && op.values).values;
    for (const field of ['title', 'description']) {
      expect(Buffer.isBuffer(row[field])).toBe(true);
      expect(fieldCipher.decryptField(row[field], Buffer.alloc(32, 7), { ...ctx, tableName: 'recurring_ticket_rules', recordId: row.id, fieldName: field })).toBe(field === 'title' ? 'Private recurring task' : 'Sensitive description');
    }
  });
});
