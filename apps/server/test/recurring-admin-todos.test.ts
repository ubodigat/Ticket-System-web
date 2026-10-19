import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runRecurringAdminTodos } from '../src/jobs/adminTodos.js';
import { insertAdminTodo, todoContext } from '../src/domain/adminTodos.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/domain/adminTodos.js', async importOriginal => ({ ...await importOriginal<any>(), insertAdminTodo: vi.fn().mockResolvedValue('task') }));
beforeEach(() => vi.clearAllMocks());

function setup(activeActor = true) {
  const deps: any = { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 }, keyProvider: {} };
  const rule: any = { id: 'rule', created_by_user_id: 'creator', active: true, next_run_at: new Date('2026-10-01T10:00:00Z'), interval_unit: 'day', interval_count: 1,
    due_after_hours: 24, recipient_ids_json: '["recipient"]',
    content: fieldCipher.encryptField('Routine task', Buffer.alloc(32, 7), todoContext(deps, 'recurring_admin_todos', 'content', 'rule', 1)) };
  const lock = vi.fn();
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = { select: () => chain, selectAll: () => chain, where: () => chain, forUpdate: () => { lock(); return chain; },
        execute: async () => [{ id: 'rule' }], executeTakeFirst: async () => table === 'users' ? activeActor ? { id: 'creator', username: 'creator' } : undefined : rule };
      return chain;
    },
    updateTable: () => ({ set: (values: any) => ({ where: () => ({ execute: async () => { Object.assign(rule, values); } }) }) }),
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  return { deps: { ...deps, db }, rule, lock };
}

describe('recurring admin tasks', () => {
  it('creates one current task after downtime, advances the locked schedule and does not replay it', async () => {
    const { deps, rule, lock } = setup(); const now = new Date('2026-10-19T12:00:00Z');
    expect(await runRecurringAdminTodos(deps, now)).toBe(1);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(insertAdminTodo).toHaveBeenCalledWith(expect.anything(), deps, { uid: 'creator', username: 'creator' },
      { content: 'Routine task', due_at: '2026-10-20T12:00:00.000Z', recipient_ids: ['recipient'] }, false);
    expect(rule.next_run_at).toBe('2026-10-20 10:00:00');
    expect(await runRecurringAdminTodos(deps, now)).toBe(0);
    expect(insertAdminTodo).toHaveBeenCalledTimes(1);
  });
  it('pauses a schedule when its creator no longer has an active admin account', async () => {
    const { deps, rule } = setup(false);
    expect(await runRecurringAdminTodos(deps, new Date('2026-10-19T12:00:00Z'))).toBe(0);
    expect(rule.active).toBe(false); expect(insertAdminTodo).not.toHaveBeenCalled();
  });
});
