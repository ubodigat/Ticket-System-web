import * as argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { APP_JS, AUTH_CSS, LOGIN_HTML, LOGIN_JS } from '../assets/authPage.js';

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
  iat: number;
}

function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSession(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (!parsed.uid || typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (Date.now() - parsed.iat > 8 * 60 * 60 * 1000) return null;
    return { uid: parsed.uid, iat: parsed.iat };
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

function cookieOptions(req: FastifyRequest) {
  const secure = isHttpsRequest(req);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    signed: true,
    maxAge: 8 * 60 * 60
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
  const session = decodeSession(unsigned.value);
  if (!session) return null;
  if (session.uid.startsWith('legacy:')) {
    const username = session.uid.slice('legacy:'.length);
    const legacyUsers = await readLegacyUsers(app);
    const user = legacyUsers.find(item => item.username === username);
    if (!user || user.accountArchived || user.accountLocked) return null;
    if (user.lockedUntil && Number(user.lockedUntil) > Date.now()) return null;
    return publicLegacyUser(user);
  }
  const user = await app.db
    .selectFrom('users')
    .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'locked_until'])
    .where('id', '=', session.uid)
    .executeTakeFirst();
  if (!user || user.account_archived || user.locked_permanent) return null;
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return null;
  return decryptUser(app, deps, user);
}

async function readLegacyUsers(app: FastifyInstance): Promise<Array<Record<string, unknown>>> {
  const row = await app.db
    .selectFrom('legacy_data')
    .select('value_json')
    .where('data_key', '=', 'users')
    .executeTakeFirst();
  if (!row) return [];
  const value = typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json;
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function publicLegacyUser(user: Record<string, unknown>) {
  return {
    id: String(user.id || user.username || ''),
    username: String(user.username || ''),
    name: String(user.name || user.username || ''),
    email: String(user.email || ''),
    role: user.role === 'superadmin' ? 'superadmin' : user.role === 'admin' ? 'admin' : 'user',
    canManageUsers: Boolean(user.canManageUsers),
    canManage2FA: Boolean(user.canManage2FA),
    canManageRequests: Boolean(user.canManageRequests),
    canViewLogs: Boolean(user.canViewLogs),
    permissions: typeof user.permissions === 'object' && user.permissions ? user.permissions : undefined
  };
}

async function legacyLogin(app: FastifyInstance, username: string, password: string) {
  const users = await readLegacyUsers(app);
  const user = users.find(item => item.username === username);
  if (!user || user.accountArchived || user.accountLocked) return null;
  if (user.lockedUntil && Number(user.lockedUntil) > Date.now()) return null;
  if (String(user.password || '') !== password) return null;
  return publicLegacyUser(user);
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
    const user = await app.db
      .selectFrom('users')
      .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'password_hash', 'account_archived', 'locked_permanent', 'locked_until'])
      .where('username', '=', input.username)
      .executeTakeFirst();

    const lockedUntil = user?.locked_until ? new Date(user.locked_until).getTime() : 0;
    if (!user || user.account_archived || user.locked_permanent || lockedUntil > Date.now()) {
      const legacyUser = await legacyLogin(app, input.username, input.password);
      if (legacyUser) {
        reply.setCookie(sessionCookieName(req), encodeSession({ uid: `legacy:${legacyUser.username}`, iat: Date.now() }), cookieOptions(req));
        return reply.send({ success: true, user: legacyUser });
      }
      return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
    }
    const ok = await argon2.verify(user.password_hash, input.password);
    if (!ok) {
      const legacyUser = await legacyLogin(app, input.username, input.password);
      if (legacyUser) {
        reply.setCookie(sessionCookieName(req), encodeSession({ uid: `legacy:${legacyUser.username}`, iat: Date.now() }), cookieOptions(req));
        return reply.send({ success: true, user: legacyUser });
      }
      return authProblem(reply, 401, 'Anmeldung fehlgeschlagen', 'Benutzername oder Passwort ist falsch.');
    }

    reply.setCookie(sessionCookieName(req), encodeSession({ uid: user.id, iat: Date.now() }), cookieOptions(req));
    return reply.send({ success: true, user: await decryptUser(app, deps, user) });
  });

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

  app.get('/app', async (req, reply) => {
    if (!(await setupCompleted(app))) return reply.redirect('/setup', 302);
    const user = await currentUser(req, app, deps);
    if (!user) return reply.redirect('/login', 302);
    await publicSettings(app);
    return reply.redirect(user.role === 'user' ? '/dashboard.html' : '/admin.html', 302);
  });
}
