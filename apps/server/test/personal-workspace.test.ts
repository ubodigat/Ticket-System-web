import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, it, expect, vi } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { registerPreferenceRoutes } from '../src/http/routes/preferences.js';
import { registerWorkTimerRoutes, timerMinutes } from '../src/http/routes/workTimers.js';
import { beginAdvancedMfa, registerPasskeyRoutes } from '../src/http/routes/passkeys.js';
import { mfaSatisfied } from '../src/domain/mfaPolicy.js';
import { signOfficeSource, verifyOfficeSource } from '../src/documents/officeTokens.js';
import { registerOfficeViewerRoutes } from '../src/http/routes/officeViewer.js';
import { memoryDb } from './helpers/memoryDb.js';
import { ensureDek } from '../src/crypto/dekService.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { jwtVerify } from 'jose';
import { TOTP } from 'otpauth';
import { createRequire } from 'node:module';
import { validateUploadedFile } from '../src/domain/fileValidation.js';
const uid = '11111111-1111-4111-8111-111111111111', tid = '22222222-2222-4222-8222-222222222222';
const secret = 'test-cookie-secret-'.repeat(4);
async function fixture() {
  const tables: Record<string, any[]> = { users: [{ id: uid, role: 'admin', username: 'admin', totp_enabled: false, totp_last_step: null }],
    tickets: [{ id: tid, created_by_user_id: uid, archived_at: null }], app_settings: [{ id: 1, config_json: JSON.stringify({ securityConfig: { mfaMode: 'both' } }) }] };
  const app = Fastify(); await app.register(cookie); const db = memoryDb(tables); app.decorate('db', db);
  const actor = { uid, role: 'admin' as 'admin' | 'user', username: 'admin' }; let authenticated = true; let finished = 0;
  app.addHook('onRequest', async req => { req.ticketSession = authenticated ? actor : null; });
  const deps = { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1, COOKIE_SECRET: secret, WEBAUTHN_ORIGIN: 'http://localhost' } as any,
    keyProvider: { wrapDek: async (value: Buffer) => value, unwrapDek: async (value: Buffer) => value } as any };
  registerPreferenceRoutes(app, deps); registerWorkTimerRoutes(app, deps); registerOfficeViewerRoutes(app, deps);
  registerPasskeyRoutes(app, deps, async () => { finished++; return { success: true }; });
  const post = (url: string, payload: any = {}) => app.inject({ method: 'POST', url, payload });
  return { app, db, tables, actor, deps, post, finished: () => finished, anonymous: () => { authenticated = false; } };
}

describe('personal workspace routes', () => {
  it('encrypts appearance, merges partial changes and isolates two users', async () => {
    const f = await fixture();
    try {
      const image = 'data:image/png;base64,aW1hZ2U=';
      expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/users/me/preferences', payload: { bgType: 'image', bgValue: image } })).statusCode).toBe(200);
      expect(f.tables.user_preferences![0].value_enc.toString()).not.toContain(image);
      await f.app.inject({ method: 'PATCH', url: '/api/v2/users/me/preferences', payload: { accentColor: '#123456', collapsedSections: { 'sys-security:0': true } } });
      const result = (await f.app.inject('/api/v2/users/me/preferences')).json().preferences;
      expect(result).toMatchObject({ bgValue: image, accentColor: '#123456', collapsedSections: { 'sys-security:0': true } });
      f.actor.uid = 'other'; expect((await f.app.inject('/api/v2/users/me/preferences')).json().preferences).toEqual({});
    } finally { await f.app.close(); }
  });
  it('rejects CSS/script backgrounds and unrecognized profile fields', async () => {
    const f = await fixture();
    try {
      for (const payload of [{ bgValue: 'url(javascript:alert(1))' }, { bgValue: 'data:image/svg+xml;base64,PHN2Zz4=' }, { role: 'superadmin' }]) {
        expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/users/me/preferences', payload })).statusCode).toBe(400);
      }
      f.anonymous(); expect((await f.app.inject('/api/v2/users/me/preferences')).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('uses server timestamps, persists stopped timers and requires activity before writing', async () => {
    const f = await fixture();
    try {
      const timer = (await f.post('/api/v2/work-timer', { ticketId: tid })).json().timer;
      expect((await f.post('/api/v2/work-timer', { ticketId: tid })).statusCode).toBe(409);
      expect((await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: '   ' })).statusCode).toBe(400);
      expect((await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: 'Fixed' })).statusCode).toBe(409);
      const stopped = (await f.post(`/api/v2/work-timer/${timer.id}/stop`)).json().timer;
      expect((await f.post(`/api/v2/work-timer/${timer.id}/stop`)).json().timer.stopped_at).toBe(stopped.stopped_at);
      expect((await f.app.inject('/api/v2/work-timer')).json().timer.id).toBe(timer.id);
      expect((await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: 'Diagnosed printer', solution: 'Replaced cable' })).statusCode).toBe(201);
      expect(f.tables.ticket_time_entries).toHaveLength(1); expect(f.tables.ticket_notes).toHaveLength(1);
      expect(f.tables.ticket_time_entries![0].note).toBeNull(); expect(f.tables.ticket_time_entries![0].note_enc.toString()).not.toContain('Diagnosed');
      expect(f.tables.ticket_notes![0].content.toString()).not.toContain('Replaced');
      expect((await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: 'Duplicate' })).statusCode).toBe(409);
      expect(f.tables.ticket_time_entries).toHaveLength(1);
    } finally { await f.app.close(); }
  });
  it('accepts an adjusted duration within limits and records the deviation in the ticket log', async () => {
    const f = await fixture();
    try {
      const timer = (await f.post('/api/v2/work-timer', { ticketId: tid })).json().timer;
      await f.post(`/api/v2/work-timer/${timer.id}/stop`);
      for (const minutes of [0, 20161, 1.5, '30']) {
        expect((await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: 'Fixed', minutes })).statusCode).toBe(400);
      }
      const done = await f.post(`/api/v2/work-timer/${timer.id}/complete`, { activity: 'Fixed', minutes: 45 });
      expect(done.statusCode).toBe(201);
      expect(done.json()).toMatchObject({ minutes: 45, measured: 1 });
      expect(f.tables.ticket_time_entries![0].minutes).toBe(45);
      expect(f.tables.ticket_audit_log).toEqual([expect.objectContaining({ ticket_id: tid, actor_user_id: uid,
        action: 'work_time_adjusted', field: 'work_minutes', old_value: '1', new_value: '45' })]);
    } finally { await f.app.close(); }
  });
  it('restricts timers to admins and their own timer IDs', async () => {
    const f = await fixture();
    try {
      const timer = (await f.post('/api/v2/work-timer', { ticketId: tid })).json().timer;
      f.actor.uid = 'other'; expect((await f.post(`/api/v2/work-timer/${timer.id}/stop`)).statusCode).toBe(404);
      f.actor.role = 'user'; expect((await f.post('/api/v2/work-timer', { ticketId: tid })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
  it('refuses unavailable and archived tickets', async () => {
    const f = await fixture();
    try { f.tables.tickets![0].archived_at = new Date(); expect((await f.post('/api/v2/work-timer', { ticketId: tid })).statusCode).toBe(404); }
    finally { await f.app.close(); }
  });
  it('rounds elapsed durations up to minutes without accepting client durations', () => {
    expect(timerMinutes(new Date(0), new Date(1))).toBe(1);
    expect(timerMinutes(new Date(0), new Date(60001))).toBe(2);
  });
});
describe('MFA policy enforcement', () => {
  it('enrolls TOTP inside the password-proven flow and rejects code reuse', async () => {
    const f = await fixture();
    try {
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      const setup = await f.post('/api/v2/mfa/login/totp-setup', { token }); expect(setup.statusCode).toBe(200);
      const code = new TOTP({ secret: setup.json().secret }).generate();
      expect((await f.post('/api/v2/mfa/login/totp', { token, code })).statusCode).toBe(200);
      expect(f.tables.users![0].totp_enabled).toBe(true);
      expect((await f.post('/api/v2/mfa/login/totp', { token, code })).statusCode).toBe(401);
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
  it('invalidates pending login and management proofs when the password changes', async () => {
    const f = await fixture();
    try {
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      f.tables.users![0].password_hash = 'new-password-hash';
      expect((await f.post('/api/v2/mfa/login/status', { token })).statusCode).toBe(401);
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('requires both proofs and only relaxes the extra passkey for a fresh device', () => {
    expect(mfaSatisfied('both', { totp: true, passkey: false })).toBe(false);
    expect(mfaSatisfied('both', { totp: true, passkey: false }, true)).toBe(true);
    expect(mfaSatisfied('both', { totp: false, passkey: true }, true)).toBe(false);
    expect(mfaSatisfied('passkey', { totp: false, passkey: false }, true)).toBe(false);
    expect(mfaSatisfied('either', { totp: true, passkey: false })).toBe(true);
  });
  it('never issues a session for incomplete, expired or reused flows', async () => {
    const f = await fixture();
    try {
      const start = await beginAdvancedMfa(f.app, f.tables.users![0]); const token = start!.mfaToken;
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(403); expect(f.finished()).toBe(0);
      f.tables.mfa_flows![0].state_json = JSON.stringify({ ...JSON.parse(f.tables.mfa_flows![0].state_json), totp: true, passkey: true });
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(200);
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(401); expect(f.finished()).toBe(1);
      const again = (await beginAdvancedMfa(f.app, f.tables.users![0]))!;
      f.tables.mfa_flows![0].expires_at = new Date(0);
      expect((await f.post('/api/v2/mfa/login/status', { token: again.mfaToken })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('binds the 14-day device proof to the correct account and rejects expired proof', async () => {
    const f = await fixture();
    try {
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      f.tables.mfa_flows![0].state_json = JSON.stringify({ ...JSON.parse(f.tables.mfa_flows![0].state_json), totp: true, passkey: false });
      const device = randomBytes(32).toString('base64url');
      f.tables.mfa_devices = [{ token_hash: createHash('sha256').update(device).digest('hex'), user_id: uid, verified_at: new Date() }];
      const status = () => f.app.inject({ method: 'POST', url: '/api/v2/mfa/login/status', payload: { token }, cookies: { '__Host-ticket_mfa_device': device } });
      expect((await status()).json().satisfied).toBe(true);
      f.tables.mfa_devices![0].user_id = 'other'; expect((await status()).json().satisfied).toBe(false);
      f.tables.mfa_devices![0].user_id = uid; f.tables.mfa_devices![0].verified_at = new Date(Date.now() - 15 * 86400000);
      expect((await status()).json().satisfied).toBe(false);
    } finally { await f.app.close(); }
  });
  it('consumes failed WebAuthn challenges and never treats an invalid assertion as proof', async () => {
    const f = await fixture();
    try {
      f.tables.user_passkeys = [{ id: 'existing-key', user_id: uid, transports_json: '[]' }];
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      const options = await f.post('/api/v2/mfa/passkeys/options', { token }); expect(options.statusCode).toBe(200);
      expect((await f.post('/api/v2/mfa/passkeys/verify', { token, credential: { id: 'missing' } })).statusCode).toBe(401);
      expect((await f.post('/api/v2/mfa/passkeys/verify', { token, credential: { id: 'missing' } })).statusCode).toBe(409);
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
  it('prevents adding methods until an existing factor has been proven', async () => {
    const f = await fixture();
    try {
      f.tables.users![0].totp_enabled = true;
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      expect((await f.post('/api/v2/mfa/passkeys/options', { token, register: true })).statusCode).toBe(403);
      f.tables.users![0].locked_permanent = true;
      expect((await f.post('/api/v2/mfa/login/status', { token })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('stores only hashed recovery codes, consumes them once and requires new enrollment', async () => {
    const f = await fixture();
    try {
      const managementToken = randomBytes(32).toString('base64url');
      f.tables.mfa_flows = [{ token_hash: createHash('sha256').update(managementToken).digest('hex'), user_id: uid, purpose: 'manage',
        state_json: JSON.stringify({ totp: true, passkey: false, passwordVersion: createHash('sha256').update('').digest('hex') }), expires_at: new Date(Date.now() + 60000) }];
      const generated = await f.post('/api/v2/mfa/recovery/generate', { token: managementToken });
      expect(generated.statusCode).toBe(200); const code = generated.json().codes[0];
      expect(f.tables.mfa_recovery_codes).toHaveLength(10); expect(JSON.stringify(f.tables.mfa_recovery_codes)).not.toContain(code.replaceAll('-', ''));
      const token = (await beginAdvancedMfa(f.app, f.tables.users![0]))!.mfaToken;
      const recovered = await f.post('/api/v2/mfa/login/recovery', { token, code }); expect(recovered.statusCode).toBe(200);
      expect(f.tables.mfa_recovery_codes).toHaveLength(9);
      const newToken = recovered.json().token;
      expect((await f.post('/api/v2/mfa/login/finish', { token: newToken })).statusCode).toBe(403);
      expect((await f.post('/api/v2/mfa/login/recovery', { token: newToken, code })).statusCode).toBe(401);
      expect((await f.post('/api/v2/mfa/login/finish', { token })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
});
describe('read-only Office capabilities', () => {
  it('accepts detected presentation/OpenDocument packages and rejects spoofed extensions', async () => {
    const JSZip = createRequire(import.meta.url)('../../../vendor/jszip.min.js');
    for (const [extension, mime] of [['odt', 'application/vnd.oasis.opendocument.text'], ['ods', 'application/vnd.oasis.opendocument.spreadsheet'], ['odp', 'application/vnd.oasis.opendocument.presentation']]) {
      const zip = new JSZip(); zip.file('mimetype', mime, { compression: 'STORE' }); zip.file('content.xml', '<?xml version="1.0"?><document/>');
      const data = await zip.generateAsync({ type: 'nodebuffer' });
      expect((await validateUploadedFile({ filename: `Office.${extension}`, declaredMimeType: mime!, data })).mimeType).toBe(mime);
    }
    const presentation = new JSZip(); presentation.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'); presentation.file('ppt/presentation.xml', '<?xml version="1.0"?><presentation/>');
    const data = await presentation.generateAsync({ type: 'nodebuffer' });
    expect((await validateUploadedFile({ filename: 'Office.pptx', declaredMimeType: '', data })).mimeType).toContain('presentationml');
    await expect(validateUploadedFile({ filename: 'Fake.pptx', declaredMimeType: '', data: Buffer.from('not an Office file') })).rejects.toMatchObject({ message: 'content_mismatch' });
  });
  it('signs a read-only configuration and rechecks access when the service fetches the file', async () => {
    const f = await fixture(); const health = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('true'));
    try {
      f.deps.env.ONLYOFFICE_ENABLED = true; f.deps.env.ONLYOFFICE_JWT_SECRET = secret;
      const encrypt = async (field: string, content: string) => {
        const dek = await ensureDek(f.db, f.deps.keyProvider, `attachments.${field}`);
        return fieldCipher.encryptField(content, dek.rawDek, { installationId: 'test', schemaVersion: 1, tableName: 'attachments', recordId: 'file', fieldName: field, keyVersion: 1 });
      };
      f.tables.attachments = [{ id: 'file', ticket_id: tid, size_bytes: 6, filename: await encrypt('filename', 'Book.xlsx'), data_b64: await encrypt('data', Buffer.from('Office').toString('base64')) }];
      const config = (await f.app.inject('/api/v2/attachments/file/office-config')).json();
      expect(config.enabled).toBe(true); expect(config.config.editorConfig.mode).toBe('view'); expect(config.config.document.permissions.edit).toBe(false);
      const verified = await jwtVerify(config.config.token, Buffer.from(secret), { algorithms: ['HS256'] });
      expect((verified.payload.document as any).permissions.edit).toBe(false);
      const source = new URL(config.config.document.url);
      expect((await f.app.inject(source.pathname + source.search)).body).toBe('Office');
      f.tables.users![0].locked_permanent = true;
      expect((await f.app.inject(source.pathname + source.search)).statusCode).toBe(403);
    } finally { health.mockRestore(); await f.app.close(); }
  });
  it('rejects forged, substituted and wrong-secret download tokens', async () => {
    const token = await signOfficeSource(secret, tid, uid);
    expect(await verifyOfficeSource(secret, token, tid)).toBe(uid);
    await expect(verifyOfficeSource(secret, token, 'other')).rejects.toThrow();
    await expect(verifyOfficeSource('wrong-secret', token, tid)).rejects.toThrow();
    await expect(verifyOfficeSource(secret, token + 'broken', tid)).rejects.toThrow();
  });
  it('does not expose a configuration for another user’s ticket', async () => {
    const f = await fixture();
    try {
      f.tables.attachments = [{ id: 'file', ticket_id: tid, size_bytes: 100 }];
      f.actor.uid = 'other'; f.actor.role = 'user'; f.tables.users!.push({ id: 'other', role: 'user' });
      expect((await f.app.inject('/api/v2/attachments/file/office-config')).statusCode).toBe(403);
      expect((await f.app.inject('/api/v2/office/source/file?token=forged')).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
});
