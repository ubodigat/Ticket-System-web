// Regressionstests zur Review vom 02.11.2026 (Punkte ohne eigene Testdatei; Schema, Krypto,
// Sicherung, Zeitzone und Dateiverschluesselung siehe schema.test.ts, crypto.test.ts,
// db-connection.test.ts und ops/tests/*).
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerUsersV2Routes } from '../src/http/routes/users.js';
import { registerSetupRoutes } from '../src/http/routes/setup.js';
import { backupStateFrom } from '../src/http/routes/update.js';
import { SETUP_MFA_POLICY } from '../src/domain/securityPolicy.js';
import { signOfficeSource, verifyOfficeSource } from '../src/documents/officeTokens.js';
import { derivedKey } from '../src/crypto/derivedKeys.js';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ purpose: 'test', keyVersion: 1, rawDek: Buffer.alloc(32, 7), keys: new Map([[1, Buffer.alloc(32, 7)]]) }) }));

// Datenbank-Attrappe: jede Kette liefert je Tabelle ein festes Ergebnis und protokolliert Schreibzugriffe.
function recorder(rowFor: (table: string) => unknown) {
  const writes: { op: string; table: string; values: any }[] = [];
  const chain = (op: string, table: string): any => {
    const state = { op, table, values: undefined as any };
    const proxy: any = new Proxy(() => {}, {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'execute') return async () => { if (op !== 'select') writes.push(state); return op === 'select' ? [] : [{ numAffectedRows: 1n }]; };
        if (prop === 'executeTakeFirst' || prop === 'executeTakeFirstOrThrow') return async () => { if (op !== 'select') writes.push(state); return rowFor(table); };
        return (...args: any[]) => { if (prop === 'values' || prop === 'set') state.values = args[0]; return proxy; };
      }
    });
    return proxy;
  };
  const db: any = {
    selectFrom: (table: string) => chain('select', table), insertInto: (table: string) => chain('insert', table),
    updateTable: (table: string) => chain('update', table), deleteFrom: (table: string) => chain('delete', table),
    transaction: () => ({ execute: async (fn: (trx: unknown) => unknown) => fn(db) })
  };
  return { db, writes };
}

async function usersApp(session: { uid: string; username: string; role: string }, permissions: Record<string, boolean>, targetRole = 'user') {
  const app = Fastify();
  const { db, writes } = recorder(table => table === 'users'
    ? { id: 'target', role: targetRole, permissions_json: JSON.stringify(permissions), account_valid_until: null }
    : table === 'app_settings' ? { config_json: JSON.stringify({ securityConfig: { passwordPolicy: { minUppercase: 5 } } }) } : undefined);
  app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = session as any; });
  registerUsersV2Routes(app, { env: { INSTALLATION_ID: 'test', COOKIE_SECRET: 'c'.repeat(32) } as any, keyProvider: {} as any });
  return { app, writes };
}

describe('Punkt 1: Rechte entstehen nur durch Superadmins', () => {
  const admin = { uid: 'admin-1', username: 'helpdesk', role: 'admin' };
  const create = (payload: Record<string, unknown>) => ({ method: 'POST' as const, url: '/api/v2/users',
    payload: { username: 'neu', name: 'Neue Person', email: 'neu@example.org', password: 'sehr langes passwort ohne grossbuchstaben', ...payload } });

  it('lehnt Zusatzrechte und Admin-Konten beim Anlegen durch einen Admin mit nur "Benutzerverwaltung" ab', async () => {
    const { app, writes } = await usersApp(admin, { canManageUsers: true });
    try {
      for (const payload of [
        { role: 'user', permissions: { canViewLogs: true, canManage2FA: true, canManageRequests: true } },
        { role: 'admin' },
        { role: 'admin', permissions: { canManageUsers: true } }
      ]) {
        const response = await app.inject(create(payload));
        expect(response.statusCode, JSON.stringify(payload)).toBe(403);
        expect(response.json().error).toBe('privileged_account_superadmin_only');
      }
      expect(writes.filter(w => w.table === 'users')).toEqual([]);
      // Ein normales Konto ohne Rechte darf er weiterhin anlegen (hier scheitert erst die Passwortregel).
      const plain = await app.inject(create({ role: 'user' }));
      expect(plain.json().error).toBe('password_policy_failed');
    } finally { await app.close(); }
  });

  it('erlaubt einem Superadmin, Admin-Konten mit Rechten anzulegen', async () => {
    const { app } = await usersApp({ uid: 'root', username: 'root', role: 'superadmin' }, {});
    try {
      const response = await app.inject(create({ role: 'admin', permissions: { canViewLogs: true } }));
      expect(response.json().error).toBe('password_policy_failed'); // Rechtepruefung bestanden
    } finally { await app.close(); }
  });

  it('verhindert das Befoerdern eines Benutzerkontos durch einen Admin', async () => {
    const { app, writes } = await usersApp(admin, { canManageUsers: true }, 'user');
    try {
      const response = await app.inject({ method: 'PATCH', url: '/api/v2/users/target', payload: { role: 'admin' } });
      expect(response.statusCode).toBe(403);
      expect(writes.filter(w => w.op === 'update' && w.table === 'users')).toEqual([]);
    } finally { await app.close(); }
  });

  it('legt beim CSV-Import keine Admin-Konten an', async () => {
    const { app, writes } = await usersApp(admin, { canManageUsers: true });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v2/users/import.csv',
        payload: { csv: 'username,name,email,role\nchef,Chef Person,chef@example.org,admin\n' } });
      expect(response.json().results).toEqual([{ username: 'chef', status: 'privileged_account_superadmin_only' }]);
      expect(writes.filter(w => w.op === 'insert' && w.table === 'users')).toEqual([]);
    } finally { await app.close(); }
  });
});

describe('Punkt 2: Zwei-Faktor-Pflicht fuer Admins ab der Einrichtung', () => {
  it('speichert die Pflicht und gibt dem ersten Superadmin einen Einrichtungscode', async () => {
    const app = Fastify();
    const { db, writes } = recorder(table => table === 'app_settings' ? { setup_completed_at: null } : table === 'groups' ? { id: 'g' } : undefined);
    app.decorate('db', db);
    registerSetupRoutes(app, { env: { INSTALLATION_ID: '11111111-1111-4111-8111-111111111111', SETUP_TOKEN: 's'.repeat(24), COOKIE_SECRET: 'c'.repeat(32), NODE_ENV: 'production' } as any, keyProvider: {} as any });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/setup/complete', payload: {
        companyName: 'Firma', portalName: 'Portal', adminUsername: 'root', adminEmail: 'root@example.org',
        adminName: 'Root', adminPassword: 'ein sehr langes passwort', setupToken: 's'.repeat(24)
      } });
      expect(response.statusCode).toBe(201);
      const { mfaEnrollCode } = response.json();
      expect(mfaEnrollCode).toMatch(/^[A-Z0-9-]{8,}$/);
      const settings = writes.find(w => w.op === 'update' && w.table === 'app_settings');
      expect(JSON.parse(settings!.values.config_json).securityConfig).toEqual(SETUP_MFA_POLICY);
      const user = writes.find(w => w.op === 'insert' && w.table === 'users');
      expect(user!.values.role).toBe('superadmin');
      expect(user!.values.mfa_enroll_code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(user!.values.mfa_enroll_code_hash).not.toContain(mfaEnrollCode);
      expect(user!.values.mfa_enroll_code_expires_at.getTime()).toBeGreaterThan(Date.now());
    } finally { await app.close(); }
  });

  it('verlangt TOTP oder Passkey fuer Admin-Konten', () => {
    expect(SETUP_MFA_POLICY).toEqual({ mfaMode: 'either', mfaRoles: 'admin' });
  });
});

describe('Punkt 11/12/14: Oberflaeche und Transport', () => {
  it('setzt in der Druckansicht keinen Inline-Style mehr (CSP)', () => {
    const board = readFileSync(new URL('../../../js/admin-board.js', import.meta.url), 'utf8');
    expect(board).not.toMatch(/style="margin-left:/);
    expect(readFileSync(new URL('../../../js/print.css', import.meta.url), 'utf8')).toContain('.print-depth-1');
  });

  it('fragt auf oeffentlichen Seiten zuerst die Sitzung ab, statt geschuetzte Endpunkte aufzurufen', () => {
    const store = readFileSync(new URL('../../../js/store.js', import.meta.url), 'utf8');
    expect(store).toContain("fetch('/api/v1/auth/session'");
    expect(store).toMatch(/const res = signedIn \? await fetch\('\/api\/v2\/settings'/);
  });

  it('setzt HSTS ohne preload', () => {
    expect(readFileSync(new URL('../src/http/app.ts', import.meta.url), 'utf8')).toContain('preload: false');
    expect(readFileSync(new URL('../../../ops/docker/Caddyfile', import.meta.url), 'utf8')).not.toContain('preload');
  });
});

describe('Punkt 15: eigener abgeleiteter Schluessel je Zweck', () => {
  const secret = 'x'.repeat(40);
  it('signiert Office-Tokens mit einem per HKDF abgeleiteten Schluessel', async () => {
    const token = await signOfficeSource(secret, 'att-1', 'user-1');
    expect(await verifyOfficeSource(secret, token, 'att-1')).toBe('user-1');
    // Mit COOKIE_SECRET direkt oder der frueheren Ableitung signierte Tokens werden abgelehnt.
    for (const key of [Buffer.from(secret), createHash('sha256').update('ticket-office-source\0' + secret).digest()]) {
      const forged = await new SignJWT({ attachmentId: 'att-1' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('ticket-system')
        .setAudience('office-source').setSubject('user-1').setIssuedAt().setExpirationTime('30m').sign(key);
      await expect(verifyOfficeSource(secret, forged, 'att-1')).rejects.toThrow();
    }
  });

  it('liefert je Zweck einen anderen Schluessel', () => {
    const keys = (['office-source-token', 'mfa-pending-token', 'login-pseudo-account'] as const).map(purpose => derivedKey(secret, purpose).toString('hex'));
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain(Buffer.from(secret).toString('hex'));
  });
});

describe('Punkt 1 (Online-Update): Sicherungsstatus fuer die Oberflaeche', () => {
  it('liest backup.env robust und meldet fehlende externe Kopien', () => {
    expect(backupStateFrom({ lastBackupAt: '2026-11-04T02:30:00Z', offsite: 'none', lastOffsiteAt: '', error: '' }))
      .toEqual({ lastBackupAt: '2026-11-04T02:30:00Z', offsite: 'none', lastOffsiteAt: null, error: null });
    expect(backupStateFrom({ lastBackupAt: '<script>', offsite: 'ftp', error: 'offsite_failed' }))
      .toEqual({ lastBackupAt: null, offsite: 'none', lastOffsiteAt: null, error: 'offsite_failed' });
    expect(backupStateFrom(null)).toBeNull();
  });
});
