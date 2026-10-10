/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { TOTP } from 'otpauth';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { APP_JS, AUTH_CSS, LOGIN_HTML, LOGIN_JS } from '../assets/authPage.js';
import { authenticateLdap } from '../../auth/ldap.js';
import { loadSecurityPolicy, force2faAppliesToRole, type SecurityPolicy } from '../../domain/securityPolicy.js';

const PROD_SESSION_COOKIE = '__Host-ticket_session';
const DEV_SESSION_COOKIE = 'ticket_session';
const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512)
});

interface AuthRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

interface SessionPayload {
  uid: string;
  username: string;
  role: 'user' | 'admin' | 'superadmin';
  iat: number;
}

function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

// Rolle/Benutzername werden in der SIGNIERTEN Cookie-Nutzlast mitgeführt (fastify/cookie HMAC,
// nicht clientseitig fälschbar) -- Grund: die v2-API (session.ts) liest die Rolle direkt aus
// dem Cookie, ohne pro Request erneut die Datenbank abzufragen. Bekannte Einschränkung: eine
// Rollenänderung wirkt erst nach erneutem Login, nicht sofort (vgl. die in der Spezifikation
// geforderte "sofortige Wirkung" -- das ist hier NICHT erfüllt und müsste über eine
// serverseitige Session-Tabelle mit Invalidierung nachgerüstet werden).
// sessionTimeoutMinutes === 0 bedeutet "kein Timeout" (Systemeinstellungen > Sicherheit, siehe
// securityPolicy.ts) -- die Sitzung läuft dann nur über Logout/Cookie-Ablauf aus, nie über
// dieses Alters-Limit.
function decodeSession(value: string, sessionTimeoutMinutes: number): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (!parsed.uid || typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (sessionTimeoutMinutes > 0 && Date.now() - parsed.iat > sessionTimeoutMinutes * 60 * 1000) return null;
    const role = parsed.role === 'superadmin' ? 'superadmin' : parsed.role === 'admin' ? 'admin' : 'user';
    return { uid: parsed.uid, username: typeof parsed.username === 'string' ? parsed.username : '', role, iat: parsed.iat };
  } catch {
    return null;
  }
}

const MFA_PENDING_TTL_MS = 5 * 60 * 1000;

// Kurzlebiges, signiertes Zwischentoken für den zweiten Faktor -- NICHT die normale
// Session-Cookie-Signierung (fastify/cookie), sondern ein eigenständiges HMAC über
// COOKIE_SECRET, da dieser Wert dem Client im Response-Body (nicht als Cookie) mitgegeben
// wird und bis zur erfolgreichen TOTP-Prüfung ausdrücklich NICHT als Login gilt.
function signMfaPendingToken(env: Env, uid: string): string {
  const payload = { uid, iat: Date.now() };
  const json = JSON.stringify(payload);
  const mac = createHmac('sha256', env.COOKIE_SECRET).update(json).digest('base64url');
  return Buffer.from(json, 'utf8').toString('base64url') + '.' + mac;
}

function verifyMfaPendingToken(env: Env, token: string): { uid: string } | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const json = Buffer.from(body, 'base64url').toString('utf8');
  const expectedMac = createHmac('sha256', env.COOKIE_SECRET).update(json).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(json) as { uid?: unknown; iat?: unknown };
    if (typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (Date.now() - parsed.iat > MFA_PENDING_TTL_MS) return null;
    return { uid: parsed.uid };
  } catch {
    return null;
  }
}

function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new TOTP({ secret: secretBase32, digits: 6, period: 30 });
  // window: 1 erlaubt eine Zeitschritt-Toleranz (+-30s) für Uhrabweichungen zwischen
  // Server und Authenticator-App, ohne die Angriffsfläche nennenswert zu vergrößern.
  return totp.validate({ token: code, window: 1 }) !== null;
}

function isHttpsRequest(req: FastifyRequest): boolean {
  return req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookieName(req: FastifyRequest): string {
  return isHttpsRequest(req) ? PROD_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

// Browser-Cookie-maxAge in Sekunden: 0/kein Timeout wird als ein Jahr abgebildet (das echte
// Zeitlimit prüft ohnehin decodeSession() serverseitig bei jeder Anfrage) -- ein echtes
// "niemals abgelaufenes" Cookie unterstützt kein Browser zuverlässig.
function cookieOptions(req: FastifyRequest, sessionTimeoutMinutes: number) {
  const secure = isHttpsRequest(req);
  const maxAge = sessionTimeoutMinutes > 0 ? sessionTimeoutMinutes * 60 : 365 * 24 * 60 * 60;
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    signed: true,
    maxAge
  };
}

async function setupCompleted(app: FastifyInstance): Promise<boolean> {
  const row = await app.db
    .selectFrom('app_settings')
    .select('setup_completed_at')
    .where('id', '=', 1)
    .executeTakeFirst();
  return Boolean(row?.setup_completed_at);
}

async function publicSettings(app: FastifyInstance) {
  return app.db
    .selectFrom('app_settings')
    .select(['company_name', 'portal_name', 'setup_completed_at'])
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
}

async function decryptUser(app: FastifyInstance, deps: AuthRouteDeps, user: {
  id: string;
  username: string;
  name_enc: Buffer;
  email_enc: Buffer;
  role: string;
}) {
  const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
  const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
  const name = fieldCipher.decryptField(user.name_enc, nameDek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users',
    recordId: user.id,
    fieldName: 'name',
    keyVersion: nameDek.keyVersion
  });
  const email = fieldCipher.decryptField(user.email_enc, emailDek.rawDek, {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users',
    recordId: user.id,
    fieldName: 'email',
    keyVersion: emailDek.keyVersion
  });
  return {
    id: user.id,
    username: user.username,
    name,
    email,
    role: user.role
  };
}

async function currentUser(req: FastifyRequest, app: FastifyInstance, deps: AuthRouteDeps) {
  const raw = req.cookies[sessionCookieName(req)] || req.cookies[PROD_SESSION_COOKIE] || req.cookies[DEV_SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const policy = await loadSecurityPolicy(app.db);
  const session = decodeSession(unsigned.value, policy.sessionTimeoutMinutes);
  if (!session) return null;
  const user = await app.db
    .selectFrom('users')
    .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'locked_until'])
    .where('id', '=', session.uid)
    .executeTakeFirst();
  if (!user || user.account_archived || user.locked_permanent) return null;
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return null;
  return decryptUser(app, deps, user);
}

// Brute-Force-Schutz (Anforderungsliste "Brute-Force-Angriffe": Hoch). Wird bei jedem
// fehlgeschlagenen Passwort- ODER TOTP-Versuch aufgerufen; Schwelle, Aktion (dauerhaft sperren/
// zeitweise sperren/nur protokollieren) und Sperrdauer kommen aus Systemeinstellungen >
// Sicherheit (securityPolicy.ts) statt wie zuvor fest einprogrammiert zu sein.
// maxLoginAttempts === 0 bedeutet "kein Limit" -- der Zähler läuft zu Audit-Zwecken trotzdem
// mit, löst aber nie eine Sperre aus.
async function recordFailedLogin(app: FastifyInstance, userId: string, currentCount: number, policy: SecurityPolicy): Promise<void> {
  const nextCount = currentCount + 1;
  const updates: Record<string, unknown> = { failed_login_count: nextCount };
  const limitReached = policy.maxLoginAttempts > 0 && nextCount >= policy.maxLoginAttempts;
  if (limitReached && policy.lockoutAction !== 'none') {
    if (policy.lockoutAction === 'lock') {
      updates.locked_permanent = true;
    } else {
      updates.locked_until = new Date(Date.now() + policy.lockoutMinutes * 60 * 1000).toISOString();
    }
    updates.failed_login_count = 0;
  }
  await app.db.updateTable('users').set(updates).where('id', '=', userId).execute();
}

async function resetFailedLogins(app: FastifyInstance, userId: string): Promise<void> {
  await app.db.updateTable('users').set({ failed_login_count: 0 }).where('id', '=', userId).execute();
}

// Unzureichendes Security Logging (Anforderungsliste: Mittel) -- fehlgeschlagene Logins landen
// im selben globalen Audit-Log wie alle anderen sicherheitsrelevanten Aktionen.
async function logSecurityEvent(app: FastifyInstance, action: string, username: string, detail?: string): Promise<void> {
  await app.db.insertInto('global_audit_log').values({
    id: randomUUID(),
    actor_user_id: null,
    actor_username: username,
    action,
    target_type: 'auth',
    target_id: null,
    detail_json: detail ?? null
  }).execute();
}

function authProblem(reply: FastifyReply, status: number, title: string, detail: string) {
  return reply.code(status).send({
    type: 'about:blank',
    title,
    status,
    detail
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.get('/auth/auth.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(AUTH_CSS));
  app.get('/auth/login.js', async (_req, reply) => reply.type('application/javascript; charset=utf-8').send(LOGIN_JS));
  app.get('/auth/app.js', async (_req, reply) => reply.type('application/javascript; charset=utf-8').send(APP_JS));

  app.get('/login', async (req, reply) => {
    if (!(await setupCompleted(app))) return reply.redirect('/setup', 302);
    const user = await currentUser(req, app, deps);
    if (user) return reply.redirect('/app', 302);
    return reply.type('text/html; charset=utf-8').send(LOGIN_HTML);
  });

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!(await setupCompleted(app))) return authProblem(reply, 409, 'Einrichtung erforderlich', 'Die Einrichtung wurde noch nicht abgeschlossen.');
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return authProblem(reply, 400, 'Ungültige Eingabe', 'Benutzername und Passwort sind erforderlich.');
    const input = parsed.data;
    const policy = await loadSecurityPolicy(app.db);
    const user = await app.db
      .selectFrom('users')
      .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'password_hash', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'failed_login_count'])
      .where('username', '=', input.username)
      .executeTakeFirst();

    const lockedUntil = user?.locked_until ? new Date(user.locked_until).getTime() : 0;
    if (!user || user.account_archived || user.locked_permanent || lockedUntil > Date.now()) {
      // Absichtlich dieselbe Fehlermeldung wie bei falschem Passwort (kein Account-Enumeration
      // über unterschiedliche Fehlertexte, siehe Anforderungsliste "Account Enumeration").
      if (user) await logSecurityEvent(app, 'login.rejected_locked_or_archived', input.username);
      return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
    }
    let ok = await argon2.verify(user.password_hash, input.password);
    // LDAP ist eine ERGÄNZUNG zum lokalen Passwort, kein Ersatz: nur versucht, wenn das lokale
    // Passwort nicht passt, und nur für ein bereits lokal existierendes Konto (siehe auth/ldap.ts).
    if (!ok) {
      ok = await authenticateLdap({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }, input.username, input.password);
      if (ok) await logSecurityEvent(app, 'login.ldap_success', input.username);
    }
    if (!ok) {
      await recordFailedLogin(app, user.id, user.failed_login_count, policy);
      await logSecurityEvent(app, 'login.wrong_password', input.username);
      return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
    }
    if (user.totp_enabled) {
      // Noch KEIN Session-Cookie und noch KEIN Zurücksetzen der Fehlversuche -- der Login ist
      // erst nach erfolgreicher TOTP-Prüfung abgeschlossen (siehe /api/v1/auth/mfa-verify).
      // Ein falscher TOTP-Code zählt bewusst ebenfalls zum Sperr-Zähler, sonst wäre der zweite
      // Faktor selbst nicht gegen Brute-Force geschützt.
      return reply.send({ mfaRequired: true, mfaToken: signMfaPendingToken(deps.env, user.id) });
    }

    await resetFailedLogins(app, user.id);
    const role = user.role === 'superadmin' ? 'superadmin' : user.role === 'admin' ? 'admin' : 'user';
    reply.setCookie(
      sessionCookieName(req),
      encodeSession({ uid: user.id, username: user.username, role, iat: Date.now() }),
      cookieOptions(req, policy.sessionTimeoutMinutes)
    );
    // "2FA erzwingen" (Systemeinstellungen > Sicherheit): betroffene Personen ohne eingerichtete
    // 2FA werden beim Login darauf hingewiesen, der Zugang selbst wird dadurch nicht blockiert --
    // entspricht dem Hinweistext der lokalen Version vom 07.10.2026 ("...werden beim Login
    // aufgefordert, 2FA einzurichten, wenn sie betroffen sind").
    const mfaSetupRequired = !user.totp_enabled && force2faAppliesToRole(policy, role);
    return reply.send({ success: true, user: await decryptUser(app, deps, user), mfaSetupRequired });
  });

  app.post(
    '/api/v1/auth/mfa-verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = z.object({ mfaToken: z.string().min(1), code: z.string().trim().length(6) }).safeParse(req.body);
      if (!parsed.success) return authProblem(reply, 400, 'Ungültige Eingabe', 'Code ist erforderlich.');

      const pending = verifyMfaPendingToken(deps.env, parsed.data.mfaToken);
      if (!pending) return authProblem(reply, 401, 'Abgelaufen', 'Bitte erneut anmelden.');

      const policy = await loadSecurityPolicy(app.db);
      const user = await app.db
        .selectFrom('users')
        .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'totp_secret_enc', 'failed_login_count'])
        .where('id', '=', pending.uid)
        .executeTakeFirst();
      const lockedUntil = user?.locked_until ? new Date(user.locked_until).getTime() : 0;
      if (!user || user.account_archived || user.locked_permanent || lockedUntil > Date.now() || !user.totp_enabled || !user.totp_secret_enc) {
        return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Bitte erneut anmelden.');
      }

      const totpDek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const secret = fieldCipher.decryptField(user.totp_secret_enc, totpDek.rawDek, {
        installationId: deps.env.INSTALLATION_ID,
        schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'users',
        recordId: user.id,
        fieldName: 'totp_secret',
        keyVersion: totpDek.keyVersion
      });

      if (!verifyTotpCode(secret, parsed.data.code)) {
        await recordFailedLogin(app, user.id, user.failed_login_count, policy);
        await logSecurityEvent(app, 'login.wrong_totp_code', user.username);
        return authProblem(reply, 401, 'Code ungültig', 'Der eingegebene Code ist falsch oder abgelaufen.');
      }
      await resetFailedLogins(app, user.id);

      const role = user.role === 'superadmin' ? 'superadmin' : user.role === 'admin' ? 'admin' : 'user';
      reply.setCookie(
        sessionCookieName(req),
        encodeSession({ uid: user.id, username: user.username, role, iat: Date.now() }),
        cookieOptions(req, policy.sessionTimeoutMinutes)
      );
      return reply.send({ success: true, user: await decryptUser(app, deps, user) });
    }
  );

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(PROD_SESSION_COOKIE, { path: '/' });
    reply.clearCookie(DEV_SESSION_COOKIE, { path: '/' });
    return reply.send({ success: true });
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    const user = await currentUser(req, app, deps);
    if (!user) return authProblem(reply, 401, 'Nicht angemeldet', 'Bitte melde dich an.');
    return reply.send({ user });
  });

  app.get('/api/v1/public-settings', async (_req, reply) => {
    const settings = await publicSettings(app);
    return reply.send({
      companyName: settings.company_name,
      portalName: settings.portal_name
    });
  });

  // Es gibt aktuell noch keine neue Oberfläche (die alte Legacy-Brücke wurde bewusst entfernt,
  // siehe README "Was noch fehlt") -- ehrlicher Platzhalter statt einer Weiterleitung auf eine
  // nicht mehr existierende Seite.
  // Platzhalterseite bis die eigentliche (am alten Design orientierte) Oberfläche gebaut ist --
  // bestätigt ehrlich, dass Login/Session funktionieren, ohne eine fertige Anwendung zu simulieren.
  // Weiterleitung auf die (als Design-Basis weiterverwendete) Oberfläche -- diese spricht
  // inzwischen für Benutzer/Login/Sitzung die echte v2-API an (siehe script.js Store.getUsers/
  // Auth.login). Andere Bereiche (Tickets, Gruppen, Einstellungen, ...) sind noch nicht
  // umgestellt und funktionieren dort entsprechend noch nicht zuverlässig.
  app.get('/app', async (req, reply) => {
    if (!(await setupCompleted(app))) return reply.redirect('/setup', 302);
    const user = await currentUser(req, app, deps);
    if (!user) return reply.redirect('/login', 302);
    return reply.redirect(user.role === 'user' ? '/dashboard.html' : '/admin.html', 302);
  });
}
