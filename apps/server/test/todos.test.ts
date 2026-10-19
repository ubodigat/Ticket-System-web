import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTodoRoutes, createAdminTodoSchema } from '../src/http/routes/todos.js';
import { advanceTodoDate } from '../src/domain/adminTodos.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/http/routes/extras.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.clearAllMocks());

const creator = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

function database(results: unknown[] = []) {
  const calls: { table: string; operation: string; conditions: unknown[][]; values?: unknown }[] = [];
  const query = (operation: string, table: string) => {
    const call = { table, operation, conditions: [] as unknown[][], values: undefined as unknown };
    calls.push(call);
    const chain: any = {
      select: () => chain, selectAll: () => chain, innerJoin: () => chain,
      where: (...args: unknown[]) => { call.conditions.push(args); return chain; },
      values: (values: unknown) => { call.values = values; return chain; },
      set: (values: unknown) => { call.values = values; return chain; },
      execute: async () => operation === 'select' ? results.shift() : [],
      executeTakeFirst: async () => results.shift()
    };
    return chain;
  };
  const db: any = {
    selectFrom: (table: string) => query('select', table),
    insertInto: (table: string) => query('insert', table),
    updateTable: (table: string) => query('update', table),
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  return { db, calls };
}

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', db: any, payload?: unknown, role: 'user' | 'admin' = 'admin') {
  const app = Fastify();
  app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: creator, username: 'creator', role }; });
  registerTodoRoutes(app, { env: { INSTALLATION_ID: creator, SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  try { return await app.inject({ method, url: `/api/v2/todos${method === 'PATCH' || method === 'DELETE' ? '/task-id' : ''}`, payload }); }
  finally { await app.close(); }
}

describe('admin todos', () => {
  it('validates optional deadlines and rejects extra ownership fields', () => {
    expect(createAdminTodoSchema.safeParse({ content: 'Task' }).success).toBe(true);
    expect(createAdminTodoSchema.safeParse({ content: 'Task', due_at: 'not a date' }).success).toBe(false);
    expect(createAdminTodoSchema.safeParse({ content: 'Task', created_by_user_id: recipient }).success).toBe(false);
  });

  it('denies ordinary users access to every todo operation before any database access', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      const { db, calls } = database();
      expect((await request(method, db, undefined, 'user')).statusCode).toBe(403);
      expect(calls).toHaveLength(0);
    }
  });

  it('keeps the creator and recipient on the same encrypted task and notifies only the recipient', async () => {
    const { db, calls } = database([[{ id: creator, username: 'creator' }, { id: recipient, username: 'recipient' }]]);
    const response = await request('POST', db, { content: 'Shared task', recipient_ids: [recipient, recipient], due_at: '2026-10-20T12:30:00.000Z' });
    expect(response.statusCode).toBe(201);
    const task = calls.find(c => c.table === 'admin_todos' && c.operation === 'insert')!.values as any;
    expect(Buffer.isBuffer(task.content)).toBe(true);
    expect(task.due_at).toBe('2026-10-20 12:30:00');
    expect(calls.find(c => c.table === 'admin_todo_members')!.values).toEqual([
      { todo_id: task.id, user_id: creator, hidden: false }, { todo_id: task.id, user_id: recipient, hidden: false }
    ]);
    const notifications = calls.find(c => c.table === 'notifications')!.values as any[];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ recipient_user_id: recipient, type: 'todo_assigned' });
    expect(Buffer.isBuffer(notifications[0].message)).toBe(true);
  });

  it('rejects recipients outside the active admin directory without creating a task', async () => {
    const { db, calls } = database([[{ id: creator, username: 'creator' }]]);
    expect((await request('POST', db, { content: 'Task', recipient_ids: [recipient] })).statusCode).toBe(400);
    expect(calls.some(c => c.operation === 'insert')).toBe(false);
  });

  it('hides a task only for the caller without deleting the shared task', async () => {
    const { db, calls } = database();
    expect((await request('DELETE', db)).statusCode).toBe(200);
    expect(calls).toEqual([{ table: 'admin_todo_members', operation: 'update', values: { hidden: true },
      conditions: [['todo_id', '=', 'task-id'], ['user_id', '=', creator]] }]);
  });

  it('updates the shared completion state only for visible members', async () => {
    const { db, calls } = database([{ todo_id: 'task-id' }]);
    expect((await request('PATCH', db, { done: true })).statusCode).toBe(200);
    expect(calls[0].conditions).toContainEqual(['hidden', '=', false]);
    expect(calls[1]).toEqual({ table: 'admin_todos', operation: 'update', values: { done: true }, conditions: [['id', '=', 'task-id']] });
    const denied = database([undefined]);
    expect((await request('PATCH', denied.db, { done: false })).statusCode).toBe(404);
    expect(denied.calls.some(c => c.operation === 'update')).toBe(false);
  });

  it('allows only the creator to edit content or deadline', async () => {
    const own = database([{ todo_id: 'task-id' }, { created_by_user_id: creator }]);
    expect((await request('PATCH', own.db, { content: 'Edited task', due_at: null })).statusCode).toBe(200);
    expect(own.calls.at(-1)?.values).toMatchObject({ due_at: null });
    const received = database([{ todo_id: 'task-id' }, { created_by_user_id: recipient }]);
    expect((await request('PATCH', received.db, { content: 'Not mine' })).statusCode).toBe(403);
    expect(received.calls.some(c => c.operation === 'update')).toBe(false);
  });

  it('advances monthly recurrences without overflowing short months', () => {
    expect(advanceTodoDate(new Date('2028-01-31T12:30:00Z'), 'month', 1).toISOString()).toBe('2028-02-29T12:30:00.000Z');
    expect(advanceTodoDate(new Date('2026-10-19T12:30:00Z'), 'week', 2).toISOString()).toBe('2026-11-02T12:30:00.000Z');
  });
});
