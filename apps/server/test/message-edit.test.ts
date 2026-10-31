import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/http/routes/extras.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));

const dek = Buffer.alloc(32, 7);
const enc = (text: string, tableName: string, recordId: string, fieldName: string) =>
  fieldCipher.encryptField(text, dek, { installationId: 'test', schemaVersion: 1, tableName, recordId, fieldName, keyVersion: 1 });

function fixture() {
  const message = { id: 'm1', ticket_id: 't1', sender_user_id: 'admin-1', sender_username: 'mmuster', sender_name: 'mmuster',
    sender_role: 'admin', content: enc('Hallo', 'ticket_messages', 'm1', 'content'), content_html: null, has_attachments: false,
    edited_at: null as string | null, created_at: new Date('2026-10-31T10:00:00Z') };
  const ticket = { id: 't1', created_by_user_id: 'user-1', archived_at: null };
  const users = [{ id: 'admin-1', name_enc: enc('Max Mustermann', 'users', 'admin-1', 'name') }];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = { select: () => chain, selectAll: () => chain, where: () => chain, orderBy: () => chain,
        executeTakeFirst: async () => table === 'ticket_messages' ? message : ticket,
        executeTakeFirstOrThrow: async () => table === 'ticket_messages' ? message : ticket,
        execute: async () => table === 'ticket_messages' ? [message] : table === 'users' ? users : [] };
      return chain;
    },
    updateTable: () => ({ set: (value: any) => ({ where: () => ({ execute: async () => { Object.assign(message, value); } }) }) })
  };
  const app = Fastify(); app.decorate('db', db);
  const actor = { uid: 'admin-1', username: 'mmuster', role: 'admin' };
  app.addHook('onRequest', async req => { req.ticketSession = actor; });
  registerTicketsV2Routes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  return { app, message, actor };
}

describe('chat messages', () => {
  it('shows the full name of the sender instead of the username', async () => {
    const f = fixture();
    try {
      const response = await f.app.inject('/api/v2/tickets/t1/messages');
      expect(response.json().messages[0]).toMatchObject({ sender_name: 'Max Mustermann', sender_username: 'mmuster', content: 'Hallo' });
      expect(JSON.stringify(response.json())).not.toContain('name_enc');
    } finally { await f.app.close(); }
  });
  it('marks a message as edited only when its content actually changes', async () => {
    const f = fixture();
    try {
      const patchMessage = (content: string) => f.app.inject({ method: 'PATCH', url: '/api/v2/tickets/t1/messages/m1', payload: { content } });
      expect((await patchMessage('Hallo')).statusCode).toBe(200);
      expect(f.message.edited_at).toBeNull();
      expect((await patchMessage('Hallo zusammen')).statusCode).toBe(200);
      expect(f.message.edited_at).toEqual(expect.any(String));
      f.actor.uid = 'someone-else';
      expect((await patchMessage('Fremd')).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
});
