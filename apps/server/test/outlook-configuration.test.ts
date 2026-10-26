import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerOutlookPersonalRoutes } from '../src/http/routes/outlookPersonal.js';
import { createMyCalendarEvent } from '../src/domain/graphClient.js';

const state = vi.hoisted(() => ({ credentials: null as any }));
vi.mock('../src/domain/graphClient.js', async original => ({ ...await original<any>(), loadOutlookAppCredentials: async () => state.credentials }));
afterEach(() => { state.credentials = null; vi.unstubAllGlobals(); });
async function request(path: string) {
  const app = Fastify({ trustProxy: '127.0.0.1' }); await app.register(cookie, { secret: 'test-cookie-signing-secret-long-enough' });
  const q: any = { select: () => q, where: () => q, executeTakeFirst: async () => ({ outlook_connected_at: null, outlook_account_email: null }) };
  app.decorate('db', { selectFrom: () => q } as any);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'person', username: 'person', role: 'user' }; });
  registerOutlookPersonalRoutes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  try { return await app.inject({ method: 'GET', url: path, headers: { host: 'localhost:8443', 'x-forwarded-proto': 'https' } }); }
  finally { await app.close(); }
}
describe('personal Outlook setup and external invitations', () => {
  it('reports missing app configuration without requiring a failed navigation', async () => {
    const response = await request('/api/v2/outlook/status');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: false, connected: false, accountEmail: null });
  });
  it('preserves custom HTTPS ports and constrains OAuth return paths', async () => {
    state.credentials = { tenantId: 'tenant', clientId: 'client', clientSecret: 'private-secret' };
    const status = await request('/api/v2/outlook/status');
    expect(status.json().configured).toBe(true); expect(status.body).not.toContain('private-secret');
    const response = await request('/api/v2/outlook/connect?returnTo=' + encodeURIComponent('/\\evil.example'));
    expect(response.statusCode).toBe(302);
    expect(new URL(response.headers.location!).searchParams.get('redirect_uri')).toBe('https://localhost:8443/api/v2/outlook/callback');
    const cookies = decodeURIComponent(String(response.headers['set-cookie']));
    expect(cookies).toContain('/dashboard.html'); expect(cookies).not.toContain('evil.example');
  });
  it('passes validated external recipients to the delegated Graph event', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'event' }), { status: 201 })); vi.stubGlobal('fetch', fetch);
    await createMyCalendarEvent('token', { subject: 'Appointment', bodyText: 'Details', startAt: new Date('2026-10-26T09:00:00Z'),
      endAt: new Date('2026-10-26T10:00:00Z'), attendeeEmails: ['external@example.org'] });
    const payload = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(payload.attendees).toEqual([{ emailAddress: { address: 'external@example.org' }, type: 'required' }]);
  });
});
