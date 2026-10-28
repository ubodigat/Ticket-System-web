import { describe, expect, it, vi } from 'vitest';
import { notifyUser } from '../src/domain/notifications.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/mail/mailer.js', () => ({ isSmtpConfigured: async () => false, sendMail: async () => undefined }));

function fakeDb(user: Record<string, unknown> | undefined, policy: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = { select: () => chain, where: () => chain,
        executeTakeFirst: async () => table === 'users' ? user : { config_json: JSON.stringify({ notifPolicy: policy }) } };
      return chain;
    },
    insertInto: (table: string) => ({ values: (values: any) => ({ execute: async () => { inserted.push({ table, ...values }); } }) })
  };
  return { db, inserted };
}
const deps = (db: any) => ({ db, env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
const person = (extra: Record<string, unknown> = {}) => ({ id: 'u1', username: 'anna', role: 'user', account_archived: false,
  locked_permanent: false, account_valid_until: null, notif_prefs_json: null, ...extra });

describe('central notification delivery', () => {
  it('delivers by default and never notifies the acting person', async () => {
    const a = fakeDb(person());
    await notifyUser(deps(a.db), { recipientUserId: 'u1', type: 'statusChange', message: 'x' });
    expect(a.inserted.filter(r => r.table === 'notifications')).toHaveLength(1);
    const b = fakeDb(person());
    await notifyUser(deps(b.db), { recipientUserId: 'u1', type: 'statusChange', message: 'x', actorUserId: 'u1' });
    expect(b.inserted).toHaveLength(0);
  });
  it('respects a personal "app off" preference', async () => {
    const { db, inserted } = fakeDb(person({ notif_prefs_json: JSON.stringify({ statusChange: { app: false } }) }));
    await notifyUser(deps(db), { recipientUserId: 'u1', type: 'statusChange', message: 'x' });
    expect(inserted).toHaveLength(0);
  });
  it('ignores a personal preference where the policy locks the channel', async () => {
    const { db, inserted } = fakeDb(person({ role: 'admin', notif_prefs_json: JSON.stringify({ newTicket: { app: false } }) }));
    await notifyUser(deps(db), { recipientUserId: 'u1', type: 'newTicket', message: 'x' });
    expect(inserted).toHaveLength(1);
  });
  it.each([{ account_archived: true }, { locked_permanent: true }, { account_valid_until: '2000-01-01' }])
    ('sends nothing to unavailable accounts (%j)', async extra => {
      const { db, inserted } = fakeDb(person(extra));
      await notifyUser(deps(db), { recipientUserId: 'u1', type: 'statusChange', message: 'x' });
      expect(inserted).toHaveLength(0);
    });
});
