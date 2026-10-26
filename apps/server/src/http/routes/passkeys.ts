import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { MfaRouteDeps } from './mfa.js';
import { verifyStepUpPassword } from './mfa.js';
import { requireSession } from './session.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { verifyAndConsumeTotp } from '../../domain/totp.js';
import { loadSecurityPolicy, force2faAppliesToRole } from '../../domain/securityPolicy.js';
import { isSourceLocked, recordSourceFailure, clearSourceFailures } from '../../domain/loginThrottle.js';
import { isAccountExpired } from '../../domain/accountValidity.js';
import { mfaSatisfied, type MfaMode } from '../../domain/mfaPolicy.js';
import { routeError } from './routeError.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const deviceCookie = '__Host-ticket_mfa_device';
type Proof = { totp: boolean; passkey: boolean; passwordVersion?: string; recovering?: boolean; challenge?: string; operation?: 'register' | 'authenticate'; pendingSecret?: string };
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).passthrough();
const limits = { config: { rateLimit: { max: 15, timeWindow: '5 minutes' } } };

async function policyFor(app: FastifyInstance, user: { role: string; totp_enabled: boolean }, count: number) {
  const row = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const sec = JSON.parse(row?.config_json || '{}').securityConfig || {};
  const applies = !sec.mfaRoles || sec.mfaRoles === 'all' || (sec.mfaRoles === 'admin' ? user.role !== 'user' : user.role === 'user');
  const configured: MfaMode = applies && ['totp', 'passkey', 'either', 'both'].includes(sec.mfaMode) ? sec.mfaMode : 'disabled';
  const policy = await loadSecurityPolicy(app.db);
  const forceTotp = force2faAppliesToRole(policy, user.role as 'user' | 'admin' | 'superadmin');
  return { mode: configured === 'disabled' ? (count ? 'either' : (user.totp_enabled || forceTotp ? 'totp' : 'disabled')) as MfaMode : configured,
    forceTotp, days: Number.isInteger(sec.passkeyEveryDays) ? Math.max(0, Math.min(365, sec.passkeyEveryDays)) : 14, configured };
}
async function newFlow(app: FastifyInstance, uid: string, purpose: string, state: Proof) {
  const user = await app.db.selectFrom('users').select('password_hash').where('id', '=', uid).executeTakeFirstOrThrow();
  const passwordVersion = hash(String(user.password_hash ?? ''));
  if (state.passwordVersion && state.passwordVersion !== passwordVersion) throw { statusCode: 401, message: 'password_changed_sign_in_again' };
  state.passwordVersion = passwordVersion;
  const token = randomBytes(32).toString('base64url');
  await app.db.deleteFrom('mfa_flows').where('expires_at', '<', new Date()).execute();
  await app.db.insertInto('mfa_flows').values({ token_hash: hash(token), user_id: uid, purpose,
    state_json: JSON.stringify(state), expires_at: new Date(Date.now() + 5 * 60000) }).execute();
  return token;
}
export async function beginAdvancedMfa(app: FastifyInstance, user: { id: string; role: string; totp_enabled: boolean; password_hash?: string }, totp = false) {
  const keys = await app.db.selectFrom('user_passkeys').select('id').where('user_id', '=', user.id).execute();
  const policy = await policyFor(app, user, keys.length);
  // All enrolled accounts use the same flow so recovery is also available to TOTP-only users.
  if (!keys.length && policy.configured === 'disabled' && !policy.forceTotp && !user.totp_enabled) return null;
  return { mfaRequired: true, advancedMfa: true, mfaToken: await newFlow(app, user.id, 'login', { totp, passkey: false,
    ...(user.password_hash ? { passwordVersion: hash(user.password_hash) } : {}) }) };
}

export function registerPasskeyRoutes(app: FastifyInstance, deps: MfaRouteDeps,
  finishLogin: (req: FastifyRequest, reply: FastifyReply, user: any, db: Kysely<Database>) => Promise<unknown>) {
  const fail = (reply: FastifyReply, error: unknown) => error instanceof z.ZodError
    ? reply.code(400).send({ error: 'invalid_mfa_request' }) : routeError(app, reply, error);
  function relyingParty() {
    if (!deps.env.WEBAUTHN_ORIGIN) throw { statusCode: 409, message: 'Passkeys benötigen WEBAUTHN_ORIGIN und einen vertrauenswürdigen HTTPS-Domainnamen.' };
    const url = new URL(deps.env.WEBAUTHN_ORIGIN);
    if (isIP(url.hostname) || (url.protocol !== 'https:' && url.hostname !== 'localhost')) throw { statusCode: 409, message: 'Passkeys benötigen einen HTTPS-Domainnamen statt einer IP-Adresse.' };
    return { origin: url.origin, rpID: url.hostname };
  }
  async function flowFor(body: unknown) {
    const { token } = tokenSchema.parse(body);
    const flow = await app.db.selectFrom('mfa_flows').selectAll().where('token_hash', '=', hash(token)).where('expires_at', '>', new Date()).executeTakeFirst();
    if (!flow) throw Object.assign(new Error('MFA-Anmeldung abgelaufen. Bitte erneut anmelden.'), { statusCode: 401 });
    const user = await app.db.selectFrom('users').selectAll().where('id', '=', flow.user_id).executeTakeFirstOrThrow();
    if (user.account_archived || user.locked_permanent || (user.locked_until && new Date(user.locked_until) > new Date()) || isAccountExpired(user.account_valid_until)) throw Object.assign(new Error('account_unavailable'), { statusCode: 401 });
    const state = JSON.parse(flow.state_json) as Proof;
    if (state.passwordVersion !== hash(String(user.password_hash ?? ''))) throw { statusCode: 401, message: 'password_changed_sign_in_again' };
    return { flow, user, state };
  }
  async function save(flow: { token_hash: string; state_json: string }, state: Proof) {
    const result = await app.db.updateTable('mfa_flows').set({ state_json: JSON.stringify(state) })
      .where('token_hash', '=', flow.token_hash).where('state_json', '=', flow.state_json).executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw Object.assign(new Error('MFA-Anfrage wurde bereits verwendet. Bitte erneut versuchen.'), { statusCode: 409 });
    flow.state_json = JSON.stringify(state);
  }
  async function withLiveFlow<T>(flow: { token_hash: string; state_json: string; user_id: string }, state: Proof,
    work: (db: Kysely<Database>, user: any) => Promise<T>): Promise<T> {
    return app.db.transaction().execute(async trx => {
      const user = await trx.selectFrom('users').selectAll().where('id', '=', flow.user_id).forUpdate().executeTakeFirstOrThrow();
      if (state.passwordVersion !== hash(String(user.password_hash ?? '')) || user.account_archived || user.locked_permanent
        || (user.locked_until && new Date(user.locked_until) > new Date()) || isAccountExpired(user.account_valid_until)) throw { statusCode: 401, message: 'account_changed_sign_in_again' };
      const active = await trx.selectFrom('mfa_flows').select('token_hash').where('token_hash', '=', flow.token_hash)
        .where('state_json', '=', flow.state_json).where('expires_at', '>', new Date()).forUpdate().executeTakeFirst();
      if (!active) throw { statusCode: 401, message: 'mfa_expired' };
      return work(trx, user);
    });
  }
  async function secretFor(uid: string, encrypted: Buffer) {
    const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
    return { dek, context: { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'users', recordId: uid, fieldName: 'totp_secret', keyVersion: dek.keyVersion }, encrypted };
  }
  app.post('/api/v2/mfa/login/status', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body);
      const credentials = await app.db.selectFrom('user_passkeys').select(['id', 'label']).where('user_id', '=', user.id).execute();
      const policy = await policyFor(app, user, credentials.length);
      let freshDevice = false;
      const token = req.cookies[deviceCookie];
      if (token && policy.days > 0) {
        freshDevice = !!(await app.db.selectFrom('mfa_devices').select('user_id').where('token_hash', '=', hash(token)).where('user_id', '=', user.id)
          .where('verified_at', '>', new Date(Date.now() - policy.days * 86400000)).executeTakeFirst());
      }
      return { mode: policy.mode, forceTotp: policy.forceTotp, hasTotp: !!user.totp_enabled, hasPasskey: credentials.length > 0,
        proof: { totp: state.totp, passkey: state.passkey }, freshDevice, purpose: flow.purpose,
        satisfied: mfaSatisfied(policy.mode, state, freshDevice) && (!policy.forceTotp || state.totp) && (!state.recovering || state.totp),
        passkeysAvailable: !!deps.env.WEBAUTHN_ORIGIN && !isIP(new URL(deps.env.WEBAUTHN_ORIGIN).hostname) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/login/totp-setup', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body);
      if (flow.purpose !== 'login' || user.totp_enabled) return reply.code(409).send({ error: 'totp_already_enabled' });
      const secret = new Secret({ size: 20 }); const totp = new TOTP({ issuer: 'Ticket-System', label: user.username, secret });
      const { dek, context } = await secretFor(user.id, Buffer.alloc(0));
      state.pendingSecret = fieldCipher.encryptField(secret.base32, dek.rawDek, context).toString('base64');
      await save(flow, state);
      return { secret: secret.base32, qrDataUrl: await QRCode.toDataURL(totp.toString(), { margin: 1, width: 240 }) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/login/totp', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body); const code = z.string().regex(/^\d{6}$/).parse((req.body as any).code);
      if (await isSourceLocked(app.db, user.id, req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
      const verified = await withLiveFlow(flow, state, async (trx, currentUser) => {
        const encrypted = currentUser.totp_enabled ? currentUser.totp_secret_enc : state.pendingSecret ? Buffer.from(state.pendingSecret, 'base64') : null;
        if (!encrypted) throw { statusCode: 409, message: 'totp_not_configured' };
        const { dek, context } = await secretFor(user.id, encrypted);
        if (!await verifyAndConsumeTotp(trx, user.id, fieldCipher.decryptField(encrypted, dek.rawDek, context), code)) return false;
        state.totp = true; delete state.pendingSecret;
        await trx.updateTable('mfa_flows').set({ state_json: JSON.stringify(state) }).where('token_hash', '=', flow.token_hash).execute();
        if (!currentUser.totp_enabled) await trx.updateTable('users').set({ totp_secret_enc: encrypted, totp_enabled: true }).where('id', '=', user.id).execute();
        return true;
      });
      if (!verified) {
        await recordSourceFailure(app.db, user.id, req.ip, await loadSecurityPolicy(app.db));
        return reply.code(401).send({ error: 'invalid_code' });
      }
      return { success: true };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/passkeys/options', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body); const { rpID } = relyingParty();
      const keys = await app.db.selectFrom('user_passkeys').selectAll().where('user_id', '=', user.id).execute();
      const operation = (req.body as any).register ? 'register' : 'authenticate';
      if (operation === 'register' && keys.length >= 20) return reply.code(409).send({ error: 'passkey_limit_reached' });
      if (operation === 'register' && !user.totp_enabled) return reply.code(409).send({ error: 'enable_totp_first' });
      if (operation === 'register' && (keys.length > 0 || user.totp_enabled) && !state.totp && !state.passkey) return reply.code(403).send({ error: 'existing_factor_required' });
      const options = operation === 'register'
        ? await generateRegistrationOptions({ rpName: 'Ticket-System', rpID, userID: Buffer.from(user.id), userName: user.username,
          attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          excludeCredentials: keys.map(key => ({ id: key.id })) })
        : await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: keys.map(key => ({ id: key.id, transports: JSON.parse(key.transports_json) as AuthenticatorTransportFuture[] })) });
      if (operation === 'authenticate' && !keys.length) return reply.code(409).send({ error: 'no_passkey' });
      state.challenge = options.challenge; state.operation = operation; await save(flow, state);
      return { options };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/passkeys/verify', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body); const { rpID, origin } = relyingParty();
      if (!state.challenge || !state.operation) return reply.code(409).send({ error: 'challenge_required' });
      if (await isSourceLocked(app.db, user.id, req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
      const expectedChallenge = state.challenge; const operation = state.operation;
      delete state.challenge; delete state.operation; await save(flow, state); // Consume before verification; failed assertions need a new challenge.
      try {
        const response = (req.body as any).credential;
        if (operation === 'register') {
          const result = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge,
            expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
          if (!result.verified || !result.registrationInfo) throw new Error('invalid_registration');
          const credential = result.registrationInfo.credential;
          if (credential.id.length > 700) throw new Error('credential_id_too_long');
          await withLiveFlow(flow, state, async trx => {
            await trx.insertInto('user_passkeys').values({ id: credential.id, user_id: user.id, public_key: Buffer.from(credential.publicKey),
              counter: credential.counter, transports_json: JSON.stringify(credential.transports || []), label: z.string().trim().min(1).max(100).parse((req.body as any).label || 'Passkey') }).execute();
            state.passkey = true;
            await trx.updateTable('mfa_flows').set({ state_json: JSON.stringify(state) }).where('token_hash', '=', flow.token_hash).execute();
          });
        } else {
          const credential = await app.db.selectFrom('user_passkeys').selectAll().where('user_id', '=', user.id).where('id', '=', String(response?.id)).executeTakeFirstOrThrow();
          const result = await verifyAuthenticationResponse({ response: response as AuthenticationResponseJSON, expectedChallenge,
            expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
            credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: Number(credential.counter), transports: JSON.parse(credential.transports_json) } });
          if (!result.verified) throw new Error('invalid_assertion');
          await withLiveFlow(flow, state, async trx => {
            const current = await trx.selectFrom('user_passkeys').select('counter').where('id', '=', credential.id).where('user_id', '=', user.id).forUpdate().executeTakeFirst();
            if (!current || Number(current.counter) !== Number(credential.counter)) throw { statusCode: 409, message: 'credential_changed_retry' };
            await trx.updateTable('user_passkeys').set({ counter: result.authenticationInfo.newCounter }).where('id', '=', credential.id).execute();
            state.passkey = true;
            await trx.updateTable('mfa_flows').set({ state_json: JSON.stringify(state) }).where('token_hash', '=', flow.token_hash).execute();
          });
        }
        return { success: true };
      } catch (error) {
        await recordSourceFailure(app.db, user.id, req.ip, await loadSecurityPolicy(app.db));
        app.log.warn({ userId: user.id }, 'Passkey verification failed');
        return reply.code(401).send({ error: 'passkey_verification_failed' });
      }
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/login/finish', limits, async (req, reply) => {
    try {
      const { user, state, flow } = await flowFor(req.body);
      if (flow.purpose !== 'login') return reply.code(403).send({ error: 'login_flow_required' });
      const keys = await app.db.selectFrom('user_passkeys').select('id').where('user_id', '=', user.id).execute();
      const policy = await policyFor(app, user, keys.length);
      const token = req.cookies[deviceCookie];
      const fresh = token && policy.days > 0 && !!await app.db.selectFrom('mfa_devices').select('user_id').where('token_hash', '=', hash(token))
        .where('user_id', '=', user.id).where('verified_at', '>', new Date(Date.now() - policy.days * 86400000)).executeTakeFirst();
      if (!mfaSatisfied(policy.mode, state, !!fresh) || (policy.forceTotp && !state.totp) || (state.recovering && !state.totp)) return reply.code(403).send({ error: 'mfa_incomplete' });
      const result = await withLiveFlow(flow, state, async (trx, currentUser) => {
      await trx.deleteFrom('mfa_flows').where('token_hash', '=', flow.token_hash).execute();
      if (state.passkey && req.protocol === 'https') {
        const device = randomBytes(32).toString('base64url');
        await trx.deleteFrom('mfa_devices').where('verified_at', '<', new Date(Date.now() - 365 * 86400000)).execute();
        if (token) await trx.deleteFrom('mfa_devices').where('token_hash', '=', hash(token)).where('user_id', '=', user.id).execute();
        await trx.insertInto('mfa_devices').values({ token_hash: hash(device), user_id: user.id, verified_at: new Date() }).execute();
        reply.setCookie(deviceCookie, device, { secure: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: 365 * 86400 });
      }
      await clearSourceFailures(trx, user.id);
      return finishLogin(req, reply, currentUser, trx);
      });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });
  // Adding/removing methods always requires a fresh password AND an existing TOTP proof.
  app.post('/api/v2/mfa/manage', limits, async (req, reply) => {
    try {
      const session = requireSession(req); const body = z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
      const user = await app.db.selectFrom('users').selectAll().where('id', '=', session.uid).executeTakeFirstOrThrow();
      if (await verifyStepUpPassword(app, user.id, req.ip, user.password_hash, body.password) !== 'ok') return reply.code(401).send({ error: 'invalid_password' });
      if (!user.totp_enabled || !user.totp_secret_enc) return reply.code(409).send({ error: 'enable_totp_first' });
      const { dek, context } = await secretFor(user.id, user.totp_secret_enc);
      if (!await verifyAndConsumeTotp(app.db, user.id, fieldCipher.decryptField(user.totp_secret_enc, dek.rawDek, context), body.code)) {
        await recordSourceFailure(app.db, user.id, req.ip, await loadSecurityPolicy(app.db));
        return reply.code(401).send({ error: 'invalid_code' });
      }
      return { token: await newFlow(app, user.id, 'manage', { totp: true, passkey: false, passwordVersion: hash(String(user.password_hash ?? '')) }) };
    } catch (error) { return fail(reply, error); }
  });
  app.get('/api/v2/mfa/passkeys', async (req, reply) => {
    try { const { uid } = requireSession(req); return { keys: await app.db.selectFrom('user_passkeys').select(['id', 'label', 'created_at']).where('user_id', '=', uid).execute() }; }
    catch (error) { return fail(reply, error); }
  });
  const recoveryHash = (uid: string, code: string) => createHmac('sha256', deps.env.COOKIE_SECRET).update(`mfa-recovery:${uid}:${code.replace(/[^a-f0-9]/gi, '').toLowerCase()}`).digest('hex');
  app.post('/api/v2/mfa/recovery/generate', limits, async (req, reply) => {
    try {
      const session = requireSession(req); const { user, flow, state } = await flowFor(req.body);
      if (flow.purpose !== 'manage' || user.id !== session.uid) return reply.code(403).send({ error: 'step_up_required' });
      const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex').match(/.{4}/g)!.join('-'));
      await withLiveFlow(flow, state, async trx => {
        const consumed = await trx.deleteFrom('mfa_flows').where('token_hash', '=', flow.token_hash).executeTakeFirst();
        if (Number(consumed.numDeletedRows) !== 1) throw { statusCode: 401, message: 'step_up_expired' };
        await trx.deleteFrom('mfa_recovery_codes').where('user_id', '=', user.id).execute();
        for (const code of codes) await trx.insertInto('mfa_recovery_codes').values({ user_id: user.id, code_hash: recoveryHash(user.id, code) }).execute();
      });
      return reply.header('Cache-Control', 'no-store').send({ codes });
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/login/recovery', limits, async (req, reply) => {
    try {
      const { user, flow, state } = await flowFor(req.body);
      if (flow.purpose !== 'login') return reply.code(403).send({ error: 'login_flow_required' });
      const code = z.string().min(32).max(64).parse((req.body as any).code);
      if (await isSourceLocked(app.db, user.id, req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
      const valid = await withLiveFlow(flow, state, async trx => {
        const consumed = await trx.deleteFrom('mfa_recovery_codes').where('user_id', '=', user.id).where('code_hash', '=', recoveryHash(user.id, code)).executeTakeFirst();
        if (Number(consumed.numDeletedRows) !== 1) return false;
        await trx.updateTable('users').set({ totp_enabled: false, totp_secret_enc: null, totp_pending_secret_enc: null, totp_last_step: null }).where('id', '=', user.id).execute();
        await trx.deleteFrom('user_passkeys').where('user_id', '=', user.id).execute();
        await trx.deleteFrom('mfa_devices').where('user_id', '=', user.id).execute();
        await trx.deleteFrom('mfa_flows').where('user_id', '=', user.id).execute();
        await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', user.id).execute();
        await trx.insertInto('global_audit_log').values({ id: randomUUID(), actor_user_id: user.id, actor_username: user.username,
          action: 'user.mfa_recovery_used', target_type: 'user', target_id: user.id, detail_json: null }).execute();
        return true;
      });
      if (!valid) { await recordSourceFailure(app.db, user.id, req.ip, await loadSecurityPolicy(app.db)); return reply.code(401).send({ error: 'invalid_recovery_code' }); }
      return { token: await newFlow(app, user.id, 'login', { totp: false, passkey: false, recovering: true, passwordVersion: hash(String(user.password_hash ?? '')) }) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v2/mfa/passkeys/remove', limits, async (req, reply) => {
    try {
      const session = requireSession(req); const { user, flow, state } = await flowFor(req.body);
      if (flow.purpose !== 'manage' || user.id !== session.uid) return reply.code(403).send({ error: 'step_up_required' });
      const id = z.string().max(700).parse((req.body as any).id);
      await withLiveFlow(flow, state, async trx => {
        const used = await trx.deleteFrom('mfa_flows').where('token_hash', '=', flow.token_hash).executeTakeFirst();
        if (Number(used.numDeletedRows) !== 1) throw new Error('step_up_expired');
        await trx.deleteFrom('user_passkeys').where('id', '=', id).where('user_id', '=', user.id).execute();
        await trx.deleteFrom('mfa_flows').where('user_id', '=', user.id).execute();
        await trx.deleteFrom('mfa_devices').where('user_id', '=', user.id).execute();
        await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', user.id).execute();
      });
      return { success: true, signInAgain: true };
    } catch (error) { return fail(reply, error); }
  });
}
