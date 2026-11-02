import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/http/routes/extras.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));

async function sendReply(status: string, role: 'user' | 'admin' = 'user', foreign = false, archived = false,
  payload: Record<string, unknown> = { content: 'Here are the details you requested.' }) {
  const ticket = { id: 'ticket-1', ticket_number: 'TS-1', status, archived_at: archived ? new Date() : null,
    created_by_user_id: foreign ? 'other' : 'user-1', created_by_username: 'user', assigned_to_user_id: null, assigned_to_username: null };
  let message: any;
  const changes: any[] = [];
  const audits: any[] = [];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = { select: () => chain, selectAll: () => chain, where: () => chain, forUpdate: () => chain, innerJoin: () => chain,
        executeTakeFirst: async () => ticket, executeTakeFirstOrThrow: async () => table === 'ticket_messages' ? message : ticket,
        execute: async () => [] };
      return chain;
    },
    insertInto: (table: string) => ({ values: (value: any) => ({ execute: async () => {
      if (table === 'ticket_messages') message = value;
      else if (table === 'ticket_audit_log') audits.push(value);
    } }) }),
    updateTable: () => ({ set: (value: any) => ({ where: () => ({ execute: async () => { changes.push(value); } }) }) }),
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  const app = Fastify(); app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'user-1', username: 'user', role }; });
  registerTicketsV2Routes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v2/tickets/ticket-1/messages', payload });
    return { response, changes, audits, message };
  } finally { await app.close(); }
}

describe('chat messages with attachments', () => {
  it('accepts a message that consists only of attachments and marks it', async () => {
    const { response, message } = await sendReply('In Bearbeitung', 'user', false, false, { content: '', has_attachments: true });
    expect(response.statusCode).toBe(201);
    expect(message.has_attachments).toBe(true);
  });

  it('still rejects an empty message without attachments', async () => {
    for (const payload of [{ content: '' }, { content: '   ', has_attachments: false }]) {
      const { response, message } = await sendReply('In Bearbeitung', 'user', false, false, payload);
      expect(response.statusCode).toBe(400);
      expect(message).toBeUndefined();
    }
  });
});

describe('user replies to pending ticket requests', () => {
  it('resumes the ticket and clears reminders when the owner answers', async () => {
    const { response, changes, audits } = await sendReply('Warten auf Benutzer');
    expect(response.statusCode).toBe(201);
    expect(response.json().message.content).toBe('Here are the details you requested.');
    expect(changes[0]).toMatchObject({ status: 'In Bearbeitung', waiting_since: null, waiting_message: null, waiting_reminder_sent: false });
    expect(audits[0]).toMatchObject({ field: 'status', old_value: 'Warten auf Benutzer', new_value: 'In Bearbeitung' });
  });

  it('does not resolve requests on an admin message or when waiting on a third party', async () => {
    for (const [status, role, archived] of [
      ['Warten auf Benutzer', 'admin', false], ['Warten auf externen Dienstleister', 'user', false], ['Warten auf Benutzer', 'user', true]
    ] as const) {
      const result = await sendReply(status, role, false, archived);
      expect(result.response.statusCode).toBe(201);
      expect(result.changes[0].status).toBeUndefined();
    }
  });

  it('denies a different user access without writing a message or changing status', async () => {
    const result = await sendReply('Warten auf Benutzer', 'user', true);
    expect(result.response.statusCode).toBe(403);
    expect(result.changes).toHaveLength(0);
    expect(result.message).toBeUndefined();
  });
});
