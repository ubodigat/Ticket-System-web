import { describe, expect, it, vi } from 'vitest';
// Native frontend module, deliberately independent of the server and DOM libraries.
// @ts-ignore JavaScript module is served without a bundler.
import { BrowserNotificationChannel } from '../../../js/browser-notifications.js';

function fixture(shared = new Map<string, string>()) {
  const shown: any[] = [];
  class Notification {
    static permission = 'granted';
    static requestPermission = vi.fn(async () => Notification.permission);
    close = vi.fn();
    onclick?: () => void;
    constructor(public title: string, public options: any) { shown.push(this); }
  }
  const env: any = { Notification, isSecureContext: true, navigator: {},
    localStorage: { getItem: (key: string) => shared.get(key) || null,
      setItem: (key: string, value: string) => shared.set(key, value) },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), focus: vi.fn(),
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
  const channel = new BrowserNotificationChannel(env);
  const open = vi.fn();
  const batch = vi.fn();
  const load = vi.fn(async (): Promise<any[]> => []);
  channel.start({ user: { id: 'alice' }, load, onBatch: batch, onOpen: open, title: () => 'Notifications' });
  return { channel, env, shown, shared, open, batch, load };
}
const item = (id: string, extra = {}) => ({ id, recipientUserId: 'alice', read: false,
  date: '2026-10-22T12:00:00Z', message: 'Private message', ticketId: 'ticket', ...extra });

describe('device browser notifications', () => {
  it('does not request permission during startup or replay the initial inbox', async () => {
    const f = fixture();
    await Promise.resolve(); await Promise.resolve();
    expect(f.env.Notification.requestPermission).not.toHaveBeenCalled();
    await f.channel.deliver([item('old')]);
    expect(f.shown).toHaveLength(0);
    f.load.mockResolvedValue([item('old')]);
    expect(await f.channel.configure(true)).toBe(true);
    await f.channel.deliver([item('old'), item('new')]);
    expect(f.shown).toHaveLength(1);
    expect(f.shown[0].options.body).toContain('Private message');
    expect([...f.shared.values()].join('')).not.toContain('Private message');
    f.channel.stop();
  });

  it('deduplicates IDs across tabs and reloads, even with identical timestamps', async () => {
    const f = fixture();
    await Promise.resolve(); await Promise.resolve();
    await f.channel.configure(true);
    await f.channel.deliver([item('one')]);
    await f.channel.deliver([item('one'), item('two')]);
    const other = fixture(f.shared);
    await other.channel.deliver([item('one'), item('two')]);
    expect(f.shown).toHaveLength(2);
    expect(other.shown).toHaveLength(0);
    f.channel.stop(); other.channel.stop();
  });

  it('only delivers unread notifications belonging to this account', async () => {
    const f = fixture();
    await f.channel.configure(true);
    await f.channel.deliver([item('read', { read: true }), item('foreign', { recipientUserId: 'bob' }),
      item('bad-date', { date: 'invalid' }), item('ok')]);
    expect(f.shown).toHaveLength(1);
    f.shown[0].onclick();
    expect(f.env.focus).toHaveBeenCalledOnce();
    expect(f.open).toHaveBeenCalledWith(item('ok'));
    f.channel.stop();
    expect(f.shown[0].close).toHaveBeenCalled();
  });

  it('handles denied permission and insecure contexts without prompting on load', async () => {
    const f = fixture();
    f.env.Notification.permission = 'denied';
    expect(await f.channel.configure(true)).toBe(false);
    f.env.isSecureContext = false;
    expect(f.channel.supported()).toBe(false);
    expect(await f.channel.configure(true)).toBe(false);
    f.channel.stop();
  });

  it('fails closed when storage is blocked and stops delivery when disabled', async () => {
    const f = fixture();
    await f.channel.configure(true);
    await f.channel.configure(false);
    await f.channel.deliver([item('disabled')]);
    expect(f.shown).toHaveLength(0);
    f.env.localStorage.setItem = () => { throw new Error('blocked'); };
    expect(await f.channel.configure(true)).toBe(false);
    await f.channel.deliver([item('blocked')]);
    expect(f.shown).toHaveLength(0);
    f.channel.stop();
  });

  it('backs off after failed requests without losing the delivery baseline', async () => {
    const f = fixture();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await f.channel.configure(true);
    const before = f.channel.read();
    f.channel.load = async () => { throw new Error('offline'); };
    f.channel.busy = false;
    await f.channel.poll();
    expect(f.channel.delay).toBe(60000);
    expect(f.channel.read()).toEqual(before);
    f.channel.stop();
  });

  it('does not process a batch while another tab owns the delivery lock', async () => {
    const f = fixture();
    await f.channel.configure(true);
    f.env.navigator.locks = { request: vi.fn(async (_key, _options, fn) => fn(null)) };
    await f.channel.deliver([item('locked')]);
    expect(f.shown).toHaveLength(0);
    f.env.navigator.locks.request = async (_key, _options, fn) => fn({});
    await f.channel.deliver([item('locked')]);
    expect(f.shown).toHaveLength(1);
    f.channel.stop();
  });
});
