import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainMailQueue, queueMail, queueUserMail } from '../src/mail/queue.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';

const { send, configured } = vi.hoisted(() => ({ send: vi.fn(), configured: vi.fn() }));
vi.mock('../src/mail/mailer.js', () => ({ sendMail: send, isSmtpConfigured: configured }));
vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));

function database() {
  const millis = (value: any) => new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} /.test(value)
    ? value.replace(' ', 'T') + 'Z' : value).getTime();
  const rows: any[] = [];
  const locks: string[] = [];
  const query = (operation: string) => {
    const filters: any[] = []; let update: any;
    const matches = (row: any) => filters.every(([key, op, value]) => {
      const a = row[key] instanceof Date ? row[key].getTime() : row[key];
      const b = value instanceof Date ? value.getTime() : value;
      if (op === '=') return a === b;
      if (op === '<') return a !== null && millis(a) < millis(b);
      if (op === '<=') return millis(a) <= millis(b);
      if (op === 'in') return value.includes(a);
      throw new Error('Unsupported test operation: ' + op);
    });
    const q: any = { selectAll: () => q, orderBy: () => q,
      where: (...args: any[]) => { filters.push(args); return q; },
      forUpdate: () => { locks.push('forUpdate'); return q; },
      skipLocked: () => { locks.push('skipLocked'); return q; },
      set: (value: any) => { update = value; return q; },
        executeTakeFirst: async () => { const row = rows.find(matches); return row ? { ...row } : undefined; },
      execute: async () => {
        if (operation === 'update') rows.filter(matches).forEach(row => Object.assign(row, update));
        if (operation === 'delete') for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1);
      }
    }; return q;
  };
  const db: any = { selectFrom: () => query('select'), updateTable: () => query('update'), deleteFrom: () => query('delete'),
    insertInto: () => ({ values: (value: any) => ({ execute: async () => rows.push({ id: rows.length + 1, attempts: 0,
      run_after: new Date(0), updated_at: new Date(), ...value }) }) }),
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  return { deps: { db, env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any }, rows, locks };
}

beforeEach(() => { send.mockReset(); configured.mockReset().mockResolvedValue(true); });
describe('durable SMTP outbox', () => {
  it('persists an encrypted mail without waiting for or attempting SMTP', async () => {
    const { deps, rows } = database();
    await queueMail(deps, 'private@example.org', 'Private subject', 'Secret text');
    expect(send).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('queued');
    expect(rows[0].payload_json).not.toContain('private@example.org');
    expect(rows[0].payload_json).not.toContain('Secret text');
    const decrypted = fieldCipher.decryptField(Buffer.from(JSON.parse(rows[0].payload_json).ciphertext, 'base64'), Buffer.alloc(32, 7), {
      installationId: 'test', schemaVersion: 1, tableName: 'jobs', recordId: rows[0].idempotency_key, fieldName: 'mail_payload', keyVersion: 1
    });
    expect(JSON.parse(decrypted).text).toBe('Secret text');
  });
  it('delivers through a separate worker using a locked claim, then removes sensitive payload', async () => {
    const { deps, rows, locks } = database();
    await queueMail(deps, 'private@example.org', 'Subject', 'Text');
    await drainMailQueue(deps);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(deps, 'private@example.org', 'Subject', 'Text');
    expect(locks).toContain('forUpdate'); expect(locks).toContain('skipLocked');
    expect(rows[0]).toMatchObject({ status: 'done', payload_json: '{}', attempts: 1, locked_by: null });
    await drainMailQueue(deps);
    expect(send).toHaveBeenCalledOnce();
  });
  it('retries transient failures with a delay and exhausts after five attempts', async () => {
    const { deps, rows } = database();
    send.mockRejectedValue(new Error('SMTP secret credentials must never enter logs'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await queueMail(deps, 'private@example.org', 'Subject', 'Text');
      let now = new Date();
      for (let attempt = 1; attempt <= 5; attempt++) {
        await drainMailQueue(deps, now);
        expect(rows[0].attempts).toBe(attempt);
        expect(rows[0].status).toBe(attempt === 5 ? 'dead' : 'queued');
        const scheduled = new Date(rows[0].run_after.replace(' ', 'T') + 'Z').getTime();
        expect(scheduled).toBeGreaterThan(now.getTime());
        now = new Date(scheduled + 1000);
      }
      expect(send).toHaveBeenCalledTimes(5);
      expect(JSON.stringify(log.mock.calls)).not.toContain('credentials');
    } finally { log.mockRestore(); }
  });
  it('recovers a stale lease after a process restart', async () => {
    const { deps, rows } = database();
    await queueMail(deps, 'private@example.org', 'Subject', 'Text');
    Object.assign(rows[0], { status: 'running', locked_at: new Date(Date.now() - 600_000), locked_by: 'crashed-worker' });
    await drainMailQueue(deps);
    expect(send).toHaveBeenCalledOnce(); expect(rows[0].status).toBe('done');
  });
  it('does not queue mail when SMTP is not configured', async () => {
    const { deps, rows } = database(); configured.mockResolvedValue(false);
    await expect(queueMail(deps, 'private@example.org', 'Subject', 'Text')).rejects.toThrow('smtp_not_configured');
    expect(rows).toHaveLength(0);
  });
  it.each([false, true])('respects personal mail opt-out unless policy is locked (%s)', async locked => {
    const { deps, rows } = database();
    const selectJobs = deps.db.selectFrom;
    const email = fieldCipher.encryptField('person@example.org', Buffer.alloc(32, 7), {
      installationId: 'test', schemaVersion: 1, tableName: 'users', recordId: 'person', fieldName: 'email', keyVersion: 1
    });
    deps.db.selectFrom = (table: string) => {
      if (table === 'jobs') return selectJobs(table);
      const q: any = { select: () => q, where: () => q, executeTakeFirst: async () => table === 'users'
        ? { email_enc: email, role: 'user', account_archived: false, notif_prefs_json: JSON.stringify({ newMessage: { email: false } }) }
        : { config_json: JSON.stringify({ notifPolicy: { newMessage: { user: { emailLocked: locked, defaultEmail: true } } } }) } };
      return q;
    };
    await queueUserMail(deps, 'person', 'Subject', 'Text', 'newMessage');
    expect(rows).toHaveLength(locked ? 1 : 0);
    expect(send).not.toHaveBeenCalled();
  });
});
