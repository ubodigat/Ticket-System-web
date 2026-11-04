import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_MAX_BYTES, BackupError, createBackupWriter, decodeValue, encodeValue, hashMatches, normalizeHash, openBackup, readBackupHeader, sha256Hex
} from '../src/domain/backup.js';
import { registerBackupRoutes } from '../src/http/routes/backup.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { testDek } from './helpers/testDek.js';

vi.mock('argon2', () => ({ verify: async (_hash: string, password: string) => password === 'correct-password' }));
vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ purpose: 'test', keyVersion: 1, rawDek: Buffer.alloc(32, 7), keys: new Map([[1, Buffer.alloc(32, 7)]]) }) }));
vi.mock('../src/domain/totp.js', () => ({ verifyAndConsumeTotp: async (_db: unknown, _uid: string, _secret: string, code: string) => code === '123456' }));

const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASS = 'a very long backup passphrase';
const meta = { installationId: 'install-a', schemaFingerprint: 'fp-1', createdBy: 'root' };

async function sampleBackup(passphrase = PASS, header = meta) {
  const writer = await createBackupWriter(passphrase, header, FAST);
  await writer.write({ kind: 'meta', tables: [{ name: 'groups', columns: ['id', 'name', 'blob', 'created_at'] }] });
  await writer.write({ t: 'groups', r: ['g1', 'IT', Buffer.from([1, 2, 3]), new Date('2026-10-31T10:00:00Z')].map(encodeValue) });
  const sealed = await writer.finish();
  const file = Buffer.concat(sealed.chunks);
  expect(sealed.size).toBe(file.length);
  expect(sealed.sha256).toBe(sha256Hex(file));
  return file;
}

describe('backup file format', () => {
  it('round-trips the encrypted payload and keeps the header readable', async () => {
    const file = await sampleBackup();
    expect(readBackupHeader(file).header).toMatchObject({ installationId: 'install-a', schemaFingerprint: 'fp-1', createdBy: 'root' });
    expect(file.includes(Buffer.from('IT'))).toBe(false);
    const opened = await openBackup(file, PASS);
    // Jeder Durchlauf entschluesselt erneut (Pruefen, dann Schreiben).
    for (let pass = 0; pass < 2; pass++) {
      const lines = [];
      for await (const line of opened.lines()) lines.push(line);
      expect(lines).toHaveLength(2);
    }
    const lines = [];
    for await (const line of opened.lines()) lines.push(line);
    const row = (lines[1] as { r: unknown[] }).r.map(decodeValue);
    expect(row[2]).toEqual(Buffer.from([1, 2, 3]));
    expect((row[3] as Date).toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });

  it('rejects a wrong passphrase, a modified header and a modified body', async () => {
    const file = await sampleBackup();
    await expect(openBackup(file, 'another long passphrase!!')).rejects.toMatchObject({ code: 'backup_decrypt_failed' });
    const header = Buffer.from(file);
    const at = header.indexOf(Buffer.from('install-a'));
    header[at] = 'X'.charCodeAt(0);
    await expect(openBackup(header, 'a very long backup passphrase')).rejects.toMatchObject({ code: 'backup_decrypt_failed' });
    const body = Buffer.from(file);
    body[body.length - 20] ^= 0xff;
    await expect(openBackup(body, 'a very long backup passphrase')).rejects.toMatchObject({ code: 'backup_decrypt_failed' });
  });

  it('refuses short passphrases, foreign files and expensive key-derivation headers', async () => {
    await expect(createBackupWriter('short', meta, FAST)).rejects.toBeInstanceOf(BackupError);
    expect(() => readBackupHeader(Buffer.from('not a backup at all, definitely not'))).toThrow(BackupError);
    const file = await sampleBackup();
    const tampered = Buffer.from(file.toString('latin1').replace('"N":16384', '"N":1048577'), 'latin1');
    expect(() => readBackupHeader(tampered)).toThrow(BackupError);
  });

  it('stops at the size limit instead of collecting an oversized file (R-29)', async () => {
    const limit = 4 * 1024 * 1024;
    const writer = await createBackupWriter(PASS, meta, FAST, limit);
    await writer.write({ kind: 'meta', tables: [{ name: 'blobs', columns: ['data'] }] });
    const noise = Buffer.alloc(1024 * 1024);
    let rejected: unknown = null;
    try {
      for (let written = 0; written <= 2 * limit; written += noise.length) {
        // Zufallsdaten lassen sich nicht komprimieren -- die Datei waechst wie der Inhalt.
        (await import('node:crypto')).randomFillSync(noise);
        await writer.write({ t: 'blobs', r: [encodeValue(noise)] });
      }
      await writer.finish();
    } catch (error) { rejected = error; }
    expect(rejected).toMatchObject({ code: 'backup_too_large' });
    expect(BACKUP_MAX_BYTES).toBe(512 * 1024 * 1024);
  });

  it('compares the SHA-256 hash exactly, ignoring only formatting', async () => {
    const file = Buffer.from('backup');
    const hash = sha256Hex(file);
    expect(hashMatches(file, hash.toUpperCase().match(/.{1,8}/g)!.join(' '))).toBe(true);
    expect(hashMatches(file, hash.slice(0, 63) + (hash.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(normalizeHash('xyz')).toBeNull();
  });

  it('only accepts the known value encodings', () => {
    expect(() => decodeValue({ $x: 'a' })).toThrow(BackupError);
    expect(() => decodeValue({ $b: 'a', $d: 'b' })).toThrow(BackupError);
    expect(() => decodeValue([1])).toThrow(BackupError);
    expect(() => encodeValue({ nested: true })).toThrow(BackupError);
    expect(decodeValue({ $n: '12345678901234567890' })).toBe('12345678901234567890');
  });
});

function backupApp(role: 'user' | 'admin' | 'superadmin', totpEnabled: boolean) {
  const audit: any[] = [];
  const totpSecret = fieldCipher.encryptField('SECRET', testDek(), {
    installationId: 'install-a', tableName: 'users', recordId: 'root-id', fieldName: 'totp_secret'
  });
  const db: any = {
    selectFrom: () => {
      const chain: any = { select: () => chain, where: () => chain, forUpdate: () => chain, executeTakeFirst: async () => undefined,
        executeTakeFirstOrThrow: async () => ({ password_hash: 'x', totp_enabled: totpEnabled, totp_secret_enc: totpEnabled ? totpSecret : null }) };
      return chain;
    },
    insertInto: (table: string) => ({ values: (values: any) => ({ execute: async () => { if (table === 'global_audit_log') audit.push(values); } }) }),
    updateTable: () => { const update: any = { set: () => update, where: () => update, execute: async () => [] }; return update; },
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  const app = Fastify();
  app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'root-id', username: 'root', role }; });
  registerBackupRoutes(app, { env: { INSTALLATION_ID: 'install-a' } as any, keyProvider: {} as any });
  return { app, audit };
}

describe('backup routes', () => {
  const stepUp = { password: 'correct-password', totp_code: '123456' };

  it('is reserved for superadmins, also before an upload body is read', async () => {
    for (const role of ['user', 'admin'] as const) {
      const { app } = backupApp(role, true);
      expect((await app.inject({ method: 'POST', url: '/api/v2/system/backup', payload: { ...stepUp, passphrase: 'a very long backup passphrase' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: '/api/v2/system/backup/upload', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v2/system/backup/restore', payload: {} })).statusCode).toBe(403);
      await app.close();
    }
  });

  it('requires the current password and an enabled two-factor authentication', async () => {
    const withoutMfa = backupApp('superadmin', false);
    const noMfa = await withoutMfa.app.inject({ method: 'POST', url: '/api/v2/system/backup', payload: { password: 'correct-password', passphrase: 'a very long backup passphrase' } });
    expect(noMfa.statusCode).toBe(403);
    expect(noMfa.json().error).toBe('mfa_required');
    await withoutMfa.app.close();
    const { app } = backupApp('superadmin', true);
    expect((await app.inject({ method: 'POST', url: '/api/v2/system/backup', payload: { password: 'wrong', totp_code: '123456', passphrase: 'a very long backup passphrase' } })).json().error).toBe('wrong_password');
    expect((await app.inject({ method: 'POST', url: '/api/v2/system/backup', payload: { password: 'correct-password', totp_code: '000000', passphrase: 'a very long backup passphrase' } })).json().error).toBe('invalid_totp_code');
    expect((await app.inject({ method: 'POST', url: '/api/v2/system/backup', payload: { ...stepUp, passphrase: 'short' } })).json().error).toBe('passphrase_too_short');
    await app.close();
  });

  it('refuses a restore without the exact hash, confirmation and matching installation -- and logs each attempt', async () => {
    const { app, audit } = backupApp('superadmin', true);
    const file = await sampleBackup(PASS, { ...meta, installationId: 'install-b' });
    const upload = await app.inject({ method: 'PUT', url: '/api/v2/system/backup/upload', headers: { 'content-type': 'application/octet-stream' }, payload: file });
    expect(upload.statusCode).toBe(200);
    expect(upload.body).not.toContain(sha256Hex(file));
    const base = { ...stepUp, passphrase: 'a very long backup passphrase', confirm: 'WIEDERHERSTELLEN' };
    const restore = (payload: any) => app.inject({ method: 'POST', url: '/api/v2/system/backup/restore', payload });
    expect((await restore({ ...base, confirm: 'ja', sha256: sha256Hex(file) })).json().error).toBe('confirmation_required');
    expect((await restore({ ...base, sha256: 'f'.repeat(64) })).json().error).toBe('backup_hash_mismatch');
    expect((await restore({ ...base, sha256: sha256Hex(file) })).json().error).toBe('backup_installation_mismatch');
    expect(audit.map(entry => JSON.parse(entry.detail_json).reason)).toEqual(['confirmation_required', 'backup_hash_mismatch', 'backup_installation_mismatch']);
    await app.close();
  });

  it('rejects uploads that are not backup files', async () => {
    const { app } = backupApp('superadmin', true);
    const response = await app.inject({ method: 'PUT', url: '/api/v2/system/backup/upload', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('<html>no backup</html>') });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('backup_invalid_file');
    await app.close();
  });
});
