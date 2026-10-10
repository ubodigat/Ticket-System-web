import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getSession, requireSession, requireAdmin, requireSuperadmin } from '../src/http/routes/session.js';

// Cookie-Parsing und die Gegenprobe gegen den aktuellen Rollen-/Sperr-/Archiv-Status in der
// Datenbank laufen seit dem onRequest-Hook in app.ts (nicht hier) -- dort wird einmal pro
// Anfrage req.ticketSession gesetzt. session.ts liest dieses Ergebnis nur noch durch, deshalb
// bilden diese Tests direkt req.ticketSession nach, statt ein signiertes Cookie zu simulieren.
function fakeRequest(session: { uid: string; username: string; role: 'user' | 'admin' | 'superadmin' } | null): FastifyRequest {
  return { ticketSession: session } as unknown as FastifyRequest;
}

describe('getSession', () => {
  it('liefert null ohne aufgelöste Session', () => {
    expect(getSession(fakeRequest(null))).toBeNull();
  });

  it('liefert die vom onRequest-Hook aufgelöste Session unverändert durch', () => {
    const req = fakeRequest({ uid: 'u1', username: 'alice', role: 'admin' });
    expect(getSession(req)).toEqual({ uid: 'u1', username: 'alice', role: 'admin' });
  });
});

describe('requireSession/requireAdmin/requireSuperadmin', () => {
  it('requireSession wirft 401 ohne Session', () => {
    try {
      requireSession(fakeRequest(null));
      throw new Error('sollte werfen');
    } catch (e: any) {
      expect(e.statusCode).toBe(401);
    }
  });

  it('requireAdmin lehnt eine normale Benutzer-Rolle ab (403)', () => {
    const req = fakeRequest({ uid: 'u1', username: 'bob', role: 'user' });
    try {
      requireAdmin(req);
      throw new Error('sollte werfen');
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
    }
  });

  it('requireAdmin lässt admin und superadmin durch', () => {
    expect(requireAdmin(fakeRequest({ uid: 'u1', username: 'a', role: 'admin' })).role).toBe('admin');
    expect(requireAdmin(fakeRequest({ uid: 'u1', username: 'a', role: 'superadmin' })).role).toBe('superadmin');
  });

  it('requireSuperadmin lehnt admin ab, nur superadmin wird durchgelassen', () => {
    const adminReq = fakeRequest({ uid: 'u1', username: 'a', role: 'admin' });
    expect(() => requireSuperadmin(adminReq)).toThrow();
    const superReq = fakeRequest({ uid: 'u1', username: 'a', role: 'superadmin' });
    expect(requireSuperadmin(superReq).role).toBe('superadmin');
  });
});