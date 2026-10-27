/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { verifyAndConsumeTotp } from '../../domain/totp.js';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { APP_JS, AUTH_CSS, LOGIN_JS } from '../assets/authPage.js';
import { authenticateLdap } from '../../auth/ldap.js';
import { loadSecurityPolicy, force2faAppliesToRole, type SecurityPolicy } from '../../domain/securityPolicy.js';
import { isAccountExpired } from '../../domain/accountValidity.js';
import { beginAdvancedMfa, registerPasskeyRoutes } from './passkeys.js';
import { isSourceLocked, recordSourceFailure, clearSourceFailures, accountBackoffSecondsRemaining } from '../../domain/loginThrottle.js';

const PROD_SESSION_COOKIE = '__Host-ticket_session';
const DEV_SESSION_COOKIE = 'ticket_session';
const PROD_CSRF_COOKIE = '__Host-csrf_token';
const DEV_CSRF_COOKIE = 'csrf_token';
// Security-Audit R-11 (Rest): markiert einen Browser, der sich bereits einmal erfolgreich
// angemeldet hat -- nur BEKANNTE Geraete werden vom kontoweiten Backoff ausgenommen, die
// Pro-Quellnetz-Sperre (isSourceLocked) gilt unveraendert fuer alle. Ohne diese Ausnahme sperrt
// der kontoweite Backoff auch die echte Person aus, sobald irgendjemand (auch unangemeldet,
// verteilt ueber mehrere Netze) genug Fehlversuche fuer das Konto erzeugt hat.
const PROD_DEVICE_COOKIE = '__Host-ticket_device';
const DEV_DEVICE_COOKIE = 'ticket_device';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512)
});

interface AuthRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

interface SessionPayload {
  sid: string;
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
// Werte <= 0 werden in securityPolicy.ts auf sichere Defaults abgebildet. Die Alterspruefung
// bleibt hier defensiv formuliert, falls eine Altinstallation noch einen solchen Wert traegt.
function decodeSession(value: string, sessionTimeoutMinutes: number): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (!parsed.sid || typeof parsed.sid !== 'string' || !parsed.uid || typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (sessionTimeoutMinutes > 0 && Date.now() - parsed.iat > sessionTimeoutMinutes * 60 * 1000) return null;
    const role = parsed.role === 'superadmin' ? 'superadmin' : parsed.role === 'admin' ? 'admin' : 'user';
    return { sid: parsed.sid, uid: parsed.uid, username: typeof parsed.username === 'string' ? parsed.username : '', role, iat: parsed.iat };
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

function isHttpsRequest(req: FastifyRequest): boolean {
  return req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookieName(req: FastifyRequest): string {
  return isHttpsRequest(req) ? PROD_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function csrfCookieName(req: FastifyRequest): string {
  return isHttpsRequest(req) ? PROD_CSRF_COOKIE : DEV_CSRF_COOKIE;
}

function deviceCookieName(req: FastifyRequest): string {
  return isHttpsRequest(req) ? PROD_DEVICE_COOKIE : DEV_DEVICE_COOKIE;
}

// Security-Audit R-11 (Rest): prueft, ob DIESER Browser bereits erfolgreich fuer DIESES Konto
// angemeldet war. Signiert (faelschungssicher) und httpOnly; ein Angreifer ohne gueltige Session
// kann sich damit nicht selbst von der Sperre ausnehmen.
function isKnownDevice(req: FastifyRequest, userId: string): boolean {
  const raw = req.cookies[deviceCookieName(req)] ?? req.cookies[PROD_DEVICE_COOKIE] ?? req.cookies[DEV_DEVICE_COOKIE];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return !!unsigned.valid && typeof unsigned.value === 'string' && unsigned.value.startsWith(`${userId}.`);
}

function timestampMillis(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const millis = new Date(normalized).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

// Browser-Cookie-maxAge in Sekunden. Das echte Zeitlimit prueft decodeSession() serverseitig bei
// jeder Anfrage; der Fallback fuer <= 0 ist nur fuer Altkonfigurationen defensiv.
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
  let name = user.username;
  let email = '';
  try {
    const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
    const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
    name = fieldCipher.decryptField(user.name_enc, nameDek.rawDek, {
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'users',
      recordId: user.id,
      fieldName: 'name',
      keyVersion: nameDek.keyVersion
    });
    email = fieldCipher.decryptField(user.email_enc, emailDek.rawDek, {
      installationId: deps.env.INSTALLATION_ID,
      schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'users',
      recordId: user.id,
      fieldName: 'email',
      keyVersion: emailDek.keyVersion
    });
  } catch (err) {
    app.log.error({ err, userId: user.id }, 'Benutzerprofil konnte nicht entschluesselt werden');
  }
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
  const dbSession = await app.db.selectFrom('sessions')
    .select(['id', 'revoked_at', 'expires_at'])
    .where('id', '=', session.sid)
    .where('user_id', '=', session.uid)
    .executeTakeFirst();
  if (!dbSession || dbSession.revoked_at || timestampMillis(dbSession.expires_at) <= Date.now()) return null;
  const user = await app.db
    .selectFrom('users')
    .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'locked_until', 'account_valid_until'])
    .where('id', '=', session.uid)
    .executeTakeFirst();
  if (!user || user.account_archived || user.locked_permanent || isAccountExpired(user.account_valid_until)) return null;
  if (timestampMillis(user.locked_until) > Date.now()) return null;
  return decryptUser(app, deps, user);
}

// Gegen Account Enumeration per Zeitmessung: ein unbekannter Benutzername durchläuft sonst
// keinen argon2.verify()-Aufruf und wäre dadurch messbar schneller als ein bekannter Benutzername
// mit falschem Passwort. Einmalig berechneter Dummy-Hash wird in diesem Fall ebenfalls verifiziert,
// damit beide Pfade eine vergleichbare Laufzeit haben.
let dummyPasswordHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = argon2.hash(randomUUID(), { type: argon2.argon2id });
  }
  return dummyPasswordHashPromise;
}

// Brute-Force-Schutz (Anforderungsliste "Brute-Force-Angriffe": Hoch). Wird bei jedem
// fehlgeschlagenen Passwort- ODER TOTP-Versuch aufgerufen.
// Security-Audit R-11: die eigentliche (immer nur befristete) Sperre läuft jetzt pro
// (Konto, Quellnetz) über domain/loginThrottle.ts -- wer nur den Benutzernamen kennt, kann ein
// fremdes Konto damit nicht mehr sperren, da die Sperre an das eigene Quellnetz des Angreifers
// gebunden bleibt. Der hier weiter mitgezählte, kontoweite failed_login_count treibt nur noch
// einen wachsenden Backoff (accountBackoffSecondsRemaining), nie mehr eine Sperre.
// maxLoginAttempts === 0 bedeutet "kein Limit" -- der Zähler läuft zu Audit-Zwecken trotzdem mit.
async function recordFailedLogin(app: FastifyInstance, userId: string, ip: string, policy: SecurityPolicy): Promise<void> {
  await recordSourceFailure(app.db, userId, ip, policy);
  await app.db.updateTable('users')
    .set(eb => ({ failed_login_count: eb('failed_login_count', '+', 1), failed_login_last_at: new Date() }))
    .where('id', '=', userId).execute();
}

async function resetFailedLogins(app: Pick<FastifyInstance, 'db'>, userId: string): Promise<void> {
  await clearSourceFailures(app.db, userId);
  await app.db.updateTable('users').set({ failed_login_count: 0, failed_login_last_at: null }).where('id', '=', userId).execute();
}

async function issueSession(app: Pick<FastifyInstance, 'db'>, req: FastifyRequest, reply: FastifyReply, user: { id: string; username: string; role: string }, policy: SecurityPolicy): Promise<void> {
  const role = user.role === 'superadmin' ? 'superadmin' : user.role === 'admin' ? 'admin' : 'user';
  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + policy.sessionTimeoutMinutes * 60 * 1000);
  await app.db.insertInto('sessions').values({
    id: sid,
    user_id: user.id,
    user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null,
    ip_address: req.ip?.slice(0, 64) ?? null,
    expires_at: expiresAt,
    revoked_at: null,
    last_seen_at: new Date()
  }).execute();
  reply.setCookie(
    sessionCookieName(req),
    encodeSession({ sid, uid: user.id, username: user.username, role, iat: Date.now() }),
    cookieOptions(req, policy.sessionTimeoutMinutes)
  );
  // CSRF-Schutz (Double-Submit-Cookie): bewusst NICHT httpOnly, da das Frontend den Wert lesen
  // und als x-csrf-token-Header auf jede mutierende Anfrage legen muss (siehe js/utils.js
  // installCsrfFetch()). SameSite=Lax allein schützt moderne Browser bereits gegen die meisten
  // CSRF-Fälle, ist aber ein Single Point of Failure -- dieses Token ist die zweite,
  // unabhängige Verteidigungsschicht (siehe app.ts onRequest-Hook, der ihn gegenprüft).
  reply.setCookie(csrfCookieName(req), randomUUID(), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: isHttpsRequest(req),
    maxAge: cookieOptions(req, policy.sessionTimeoutMinutes).maxAge
  });
  // Security-Audit R-11 (Rest): langlebiges Geraete-Cookie, unabhaengig vom Session-Timeout --
  // markiert diesen Browser fuer diese Person als "bereits erfolgreich angemeldet" (siehe
  // isKnownDevice), damit der kontoweite Backoff sie nach einem verteilten Angriff auf den
  // Benutzernamen nicht mit aussperrt.
  reply.setCookie(deviceCookieName(req), `${user.id}.${randomBytes(16).toString('hex')}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(req),
    signed: true,
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS
  });
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

function loginFailure(reply: FastifyReply) {
  return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  registerPasskeyRoutes(app, deps, async (req, reply, user, db) => {
    await resetFailedLogins({ db }, user.id);
    await issueSession({ db }, req, reply, user, await loadSecurityPolicy(db));
    return { success: true, user: await decryptUser(app, deps, user) };
  });
  app.get('/auth/auth.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(AUTH_CSS));
  app.get('/auth/login.js', async (_req, reply) => reply.type('application/javascript; charset=utf-8').send(LOGIN_JS));
  app.get('/auth/app.js', async (_req, reply) => reply.type('application/javascript; charset=utf-8').send(APP_JS));

  app.get('/login', async (req, reply) => {
    if (!(await setupCompleted(app))) return reply.redirect('/setup', 302);
    const user = await currentUser(req, app, deps);
    if (user) return reply.redirect('/app', 302);
    return reply.redirect('/index.html', 302);
  });

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
    if (!(await setupCompleted(app))) return authProblem(reply, 409, 'Einrichtung erforderlich', 'Die Einrichtung wurde noch nicht abgeschlossen.');
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return authProblem(reply, 400, 'Ungültige Eingabe', 'Benutzername und Passwort sind erforderlich.');
    const input = parsed.data;
    const policy = await loadSecurityPolicy(app.db);
    const user = await app.db
      .selectFrom('users')
      .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'password_hash', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'failed_login_count', 'failed_login_last_at', 'ldap_login_enabled', 'account_valid_until'])
      .where('username', '=', input.username)
      .executeTakeFirst();

    // Security-Audit R-11: Sperre jetzt zusätzlich pro (Konto, Quellnetz) prüfen (siehe
    // domain/loginThrottle.ts) -- users.locked_permanent/locked_until bleiben die manuelle
    // Admin-Sperre, isSourceLocked ist die automatische, nur das Quellnetz des Angreifers
    // betreffende Sperre.
    const sourceLocked = user ? await isSourceLocked(app.db, user.id, req.ip) : false;
    const lockedUntil = timestampMillis(user?.locked_until);
    if (!user || user.account_archived || user.locked_permanent || lockedUntil > Date.now() || sourceLocked || isAccountExpired(user.account_valid_until)) {
      // Absichtlich dieselbe Fehlermeldung wie bei falschem Passwort (kein Account-Enumeration
      // über unterschiedliche Fehlertexte, siehe Anforderungsliste "Account Enumeration").
      if (user) {
        await logSecurityEvent(app, 'login.rejected_locked_or_archived', input.username);
        // Security-Audit M-4: ohne diesen Vergleich läuft für gesperrte/archivierte Konten KEIN
        // argon2.verify() -- die Antwort kommt dadurch messbar schneller als bei "falsches
        // Passwort" und verrät per Zeitmessung, dass das Konto existiert und gesperrt ist.
        await argon2.verify(user.password_hash, input.password).catch(() => false);
      } else {
        // Dummy-Verify gegen Timing-basierte Enumeration unbekannter Benutzernamen (siehe oben).
        await argon2.verify(await getDummyPasswordHash(), input.password).catch(() => false);
      }
      return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
    }
    // Security-Audit R-11: kontoweiter Backoff (quellenunabhängig) -- verhindert, dass verteilte
    // Fehlversuche aus vielen Netzen die Pro-Quelle-Sperre umgehen, ohne selbst wieder zu einer
    // durch Dritte auslösbaren harten Sperre zu werden (nur eine wachsende Wartezeit, max. 5 min).
    const backoffSeconds = isKnownDevice(req, user.id) ? 0
      : accountBackoffSecondsRemaining(user.failed_login_count, user.failed_login_last_at);
    if (backoffSeconds > 0) {
      reply.header('retry-after', String(backoffSeconds));
      return authProblem(reply, 429, 'Zu viele Fehlversuche', `Bitte in ${backoffSeconds} Sekunden erneut versuchen.`);
    }
    let ok = false;
    try {
      ok = await argon2.verify(user.password_hash, input.password);
    } catch (err) {
      app.log.warn({ err, username: input.username }, 'Passwort-Hash konnte nicht geprueft werden');
      await logSecurityEvent(app, 'login.invalid_password_hash', input.username);
      return loginFailure(reply);
    }
    // LDAP ist eine ERGÄNZUNG zum lokalen Passwort, kein Ersatz: nur versucht, wenn das lokale
    // Passwort nicht passt, und nur für ein bereits lokal existierendes Konto (siehe auth/ldap.ts).
    // Security-Audit N7: LDAP ist standardmäßig für jedes Konto AUS (Opt-in durch eine
    // Superadmin-Person je Konto, "ldap_login_enabled") und für Superadmin-Konten zusätzlich
    // hart ausgeschlossen -- ein kompromittiertes/fehlkonfiguriertes LDAP-Verzeichnis darf
    // niemals ausreichen, um die höchste Berechtigungsstufe der Anwendung zu erlangen.
    if (!ok && user.role !== 'superadmin' && user.ldap_login_enabled) {
      ok = await authenticateLdap({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }, input.username, input.password);
      if (ok) await logSecurityEvent(app, 'login.ldap_success', input.username);
    }
    if (!ok) {
      await recordFailedLogin(app, user.id, req.ip, policy);
      await logSecurityEvent(app, 'login.wrong_password', input.username);
      return loginFailure(reply);
    }
    const role = user.role === 'superadmin' ? 'superadmin' : user.role === 'admin' ? 'admin' : 'user';
    const advancedMfa = await beginAdvancedMfa(app, user);
    if (advancedMfa) return reply.send(advancedMfa);
    if (!user.totp_enabled && force2faAppliesToRole(policy, role)) {
      await logSecurityEvent(app, 'login.rejected_mfa_required', input.username);
      return authProblem(reply, 403, '2FA erforderlich', 'Für dieses Konto ist 2FA verpflichtend. Bitte lasse 2FA durch einen Superadmin einrichten oder zurücksetzen.');
    }
    if (user.totp_enabled) {
      // Noch KEIN Session-Cookie und noch KEIN Zurücksetzen der Fehlversuche -- der Login ist
      // erst nach erfolgreicher TOTP-Prüfung abgeschlossen (siehe /api/v1/auth/mfa-verify).
      // Ein falscher TOTP-Code zählt bewusst ebenfalls zum Sperr-Zähler, sonst wäre der zweite
      // Faktor selbst nicht gegen Brute-Force geschützt.
      return reply.send({ mfaRequired: true, mfaToken: signMfaPendingToken(deps.env, user.id) });
    }

    await resetFailedLogins(app, user.id);
    await issueSession(app, req, reply, user, policy);
    return reply.send({ success: true, user: await decryptUser(app, deps, user), mfaSetupRequired: false });
    } catch (err) {
      app.log.error({ err }, 'Login fehlgeschlagen');
      return authProblem(reply, 500, 'Anmeldung fehlgeschlagen', 'Der Login konnte wegen eines Serverfehlers nicht abgeschlossen werden.');
    }
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
        .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'totp_secret_enc', 'failed_login_count', 'failed_login_last_at', 'account_valid_until'])
        .where('id', '=', pending.uid)
        .executeTakeFirst();
      // Security-Audit R-11: siehe Kommentar beim Login-Endpunkt oben.
      const sourceLocked = user ? await isSourceLocked(app.db, user.id, req.ip) : false;
      const lockedUntil = timestampMillis(user?.locked_until);
      if (!user || user.account_archived || user.locked_permanent || lockedUntil > Date.now() || sourceLocked || isAccountExpired(user.account_valid_until) || !user.totp_enabled || !user.totp_secret_enc) {
        return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Bitte erneut anmelden.');
      }
      const backoffSeconds = accountBackoffSecondsRemaining(user.failed_login_count, user.failed_login_last_at);
      if (backoffSeconds > 0) {
        reply.header('retry-after', String(backoffSeconds));
        return authProblem(reply, 429, 'Zu viele Fehlversuche', `Bitte in ${backoffSeconds} Sekunden erneut versuchen.`);
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

      if (!(await verifyAndConsumeTotp(app.db, user.id, secret, parsed.data.code))) {
        await recordFailedLogin(app, user.id, req.ip, policy);
        await logSecurityEvent(app, 'login.wrong_totp_code', user.username);
        return authProblem(reply, 401, 'Code ungültig', 'Der eingegebene Code ist falsch, abgelaufen oder wurde bereits verwendet.');
      }
      await resetFailedLogins(app, user.id);

      const advancedMfa = await beginAdvancedMfa(app, user, true);
      if (advancedMfa) return reply.send(advancedMfa);
      await issueSession(app, req, reply, user, policy);
      return reply.send({ success: true, user: await decryptUser(app, deps, user) });
    }
  );

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const raw = req.cookies[sessionCookieName(req)] || req.cookies[PROD_SESSION_COOKIE] || req.cookies[DEV_SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const session = decodeSession(unsigned.value, 365 * 24 * 60);
        if (session) {
          await app.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', session.sid).execute();
        }
      }
    }
    // __Host-ticket_session ist ein "__Host-"-Cookie: der Browser akzeptiert dafür NUR
    // Set-Cookie-Antworten mit dem Secure-Attribut, auch zum Löschen -- ohne "secure: true" hier
    // verwirft der Browser die Löschung still und die Sitzung bleibt bestehen (Logout wirkungslos
    // in Produktion/HTTPS). clearCookie() setzt das nicht automatisch, anders als setCookie()
    // über cookieOptions().
    reply.clearCookie(PROD_SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    reply.clearCookie(DEV_SESSION_COOKIE, { path: '/', secure: isHttpsRequest(req), httpOnly: true, sameSite: 'lax' });
    reply.clearCookie(PROD_CSRF_COOKIE, { path: '/', secure: true, httpOnly: false, sameSite: 'lax' });
    reply.clearCookie(DEV_CSRF_COOKIE, { path: '/', secure: isHttpsRequest(req), httpOnly: false, sameSite: 'lax' });
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
