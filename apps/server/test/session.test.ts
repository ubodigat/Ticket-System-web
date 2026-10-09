import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getSession, requireSession, requireAdmin, requireSuperadmin } from '../src/http/routes/session.js';

// getSession liest kein rohes JSON, sondern das von @fastify/cookie entsignierte Cookie --
// hier wird nur dessen Rückgabeform ({valid, value}) nachgebildet, nicht die echte HMAC-Prüfung
// selbst (die liegt in der Verantwortung von @fastify/cookie, nicht dieses Moduls).
function fakeRequest(payload: Record<string, unknown> | null, cookieName = '__Host-ticket_session'): FastifyRequest {
  const raw = payload ? 'signed-value' : undefined;
  return {
    cookies: raw ? { [cookieName]: raw } : {},
    unsignCookie: (_value: string) => {
      if (!payload) return { valid: false, value: null } as any;
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      return { valid: true, value: encoded } as any;
    }
  } as unknown as FastifyRequest;
}

describe('getSession', () => {
  it('liefert null ohne Session-Cookie', () => {
    expect(getSession(fakeRequest(null))).toBeNull();
  });

  it('liefert null, wenn das Cookie nicht gültig signiert ist', () => {
    const req = { cookies: { ticket_session: 'tampered' }, unsignCookie: () => ({ valid: false, value: null }) } as unknown as FastifyRequest;
    expect(getSession(req)).toBeNull();
  });

  it('liefert null für eine abgelaufene Session (älter als 8 Stunden)', () => {
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
    const req = fakeRequest({ uid: 'u1', username: 'alice', role: 'admin', iat: nineHoursAgo });
    expect(getSession(req)).toBeNull();
  });

  it('liefert die Session für ein gültiges, frisches Cookie', () => {
    const req = fakeRequest({ uid: 'u1', username: 'alice', role: 'admin', iat: Date.now() });
    expect(getSession(req)).toEqual({ uid: 'u1', username: 'alice', role: 'admin' });
  });

  it('fängt eine fehlende/ungültige Rolle im Cookie auf "user" ab, statt sie zu übernehmen', () => {
    const req = fakeRequest({ uid: 'u1', username: 'alice', role: 'hacker-eingeschleust', iat: Date.now() });
    expect(getSession(req)?.role).toBe('user');
  });

  it('liefert null, wenn uid fehlt oder keine Zeichenkette ist', () => {
    const req = fakeRequest({ username: 'alice', role: 'admin', iat: Date.now() });
    expect(getSession(req)).toBeNull();
  });
});

describe('requireSession/requireAdmin/requireSuperadmin', () => {
  it('requireSession wirft 401 ohne Session', () => {
    expect(() => requireSession(fakeRequest(null))).toThrow();
  });

  it('requireAdmin lehnt eine normale Benutzer-Rolle ab (403)', () => {
    const req = fakeRequest({ uid: 'u1', username: 'bob', role: 'user', iat: Date.now() });
    try {
      requireAdmin(req);
      throw new Error('sollte werfen');
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
    }
  });

  it('requireAdmin lässt admin und superadmin durch', () => {
    expect(requireAdmin(fakeRequest({ uid: 'u1', username: 'a', role: 'admin', iat: Date.now() })).role).toBe('admin');
    expect(requireAdmin(fakeRequest({ uid: 'u1', username: 'a', role: 'superadmin', iat: Date.now() })).role).toBe('superadmin');
  });

  it('requireSuperadmin lehnt admin ab, nur superadmin wird durchgelassen', () => {
    const adminReq = fakeRequest({ uid: 'u1', username: 'a', role: 'admin', iat: Date.now() });
    expect(() => requireSuperadmin(adminReq)).toThrow();
    const superReq = fakeRequest({ uid: 'u1', username: 'a', role: 'superadmin', iat: Date.now() });
    expect(requireSuperadmin(superReq).role).toBe('superadmin');
  });
});
