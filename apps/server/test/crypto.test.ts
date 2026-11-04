import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendKekVersion, createFileKeyProvider, generateNewKekMaterial, parseKekFile, retireKekVersions } from '../src/crypto/keyProvider.js';
import { blindIndexCandidates, computeBlindIndex, describeStoredField, fieldCipher, generateRawDek, isCurrentField, type ResolvedDek } from '../src/crypto/fieldCrypto.js';
import { dekWrapAad } from '../src/crypto/dekService.js';

const ctx = { installationId: '11111111-1111-4111-8111-111111111111', tableName: 'users', recordId: 'user-1', fieldName: 'email' };
const dekOf = (keys: [number, Buffer][], active = keys[keys.length - 1]![0]): ResolvedDek =>
  ({ purpose: 'users.email', keyVersion: active, rawDek: new Map(keys).get(active)!, keys: new Map(keys) });

// Bildet das Feldformat bis 11/2026 nach (ohne Kopf, AAD mit festem "1" und Schluesselversion).
function legacyEncrypt(value: string, key: Buffer, version = 1): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from([ctx.installationId, '1', ctx.tableName, ctx.recordId, ctx.fieldName, String(version)].join('\x1f')));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

describe('KEK-Schluesselbund (Review 11/2026, Punkt 3)', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kek-')); path = join(dir, 'app.kek'); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('liest das alte Einzeilenformat als Version 1 und das neue Format mit Versionen', () => {
    const one = randomBytes(32).toString('base64');
    expect([...parseKekFile(`${one}\n`).keys()]).toEqual([1]);
    expect([...parseKekFile(generateNewKekMaterial()).keys()]).toEqual([1]);
    expect(() => parseKekFile(`1:${randomBytes(16).toString('base64')}`)).toThrow(/256-Bit/);
    expect(() => parseKekFile('1:abc\n1:abc')).toThrow();
  });

  it('bindet die umhuellte DEK an Zweck und Version', async () => {
    await writeFile(path, generateNewKekMaterial(), { mode: 0o600 });
    const provider = createFileKeyProvider(path);
    const raw = generateRawDek();
    const wrapped = await provider.wrapDek(raw, dekWrapAad('users.email', 1));
    expect((await provider.unwrapDek(wrapped, 1, dekWrapAad('users.email', 1))).equals(raw)).toBe(true);
    await expect(provider.unwrapDek(wrapped, 1, dekWrapAad('tickets.title', 1))).rejects.toThrow();
    await expect(provider.unwrapDek(wrapped, 1, dekWrapAad('users.email', 2))).rejects.toThrow();
  });

  it('rotiert die KEK: neue Version anhaengen, alte lesbar bis zum Entfernen', async () => {
    await writeFile(path, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
    const raw = generateRawDek();
    const oldWrapped = await createFileKeyProvider(path).wrapDek(raw, dekWrapAad('p', 1));
    expect(await appendKekVersion(path)).toBe(2);
    const rotated = createFileKeyProvider(path);
    expect(await rotated.currentKekVersion()).toBe(2);
    expect((await rotated.unwrapDek(oldWrapped, 1, dekWrapAad('p', 1))).equals(raw)).toBe(true);
    const newWrapped = await rotated.wrapDek(raw, dekWrapAad('p', 1));
    expect(await retireKekVersions(path, new Set([2]))).toEqual([1]);
    const retired = createFileKeyProvider(path);
    await expect(retired.unwrapDek(oldWrapped, 1, dekWrapAad('p', 1))).rejects.toThrow(/KEK-Version 1 fehlt/);
    expect((await retired.unwrapDek(newWrapped, 2, dekWrapAad('p', 1))).equals(raw)).toBe(true);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readFile(path, 'utf8')).startsWith('2:')).toBe(true);
  });

  it('verweigert eine KEK-Datei mit falscher Schluessellaenge', async () => {
    await writeFile(path, randomBytes(16).toString('base64'), { mode: 0o600 });
    await expect(createFileKeyProvider(path).currentKekVersion()).rejects.toThrow(/256-Bit/);
  });
});

describe('Feldverschluesselung mit versioniertem Kopf', () => {
  const v1 = randomBytes(32);
  const v2 = randomBytes(32);

  it('schreibt Formatversion und Schluesselversion in den Kopf', () => {
    const stored = fieldCipher.encryptField('max@example.com', dekOf([[1, v1], [2, v2]]), ctx);
    expect(stored[0]).toBe(1);
    expect(describeStoredField(stored)).toEqual({ format: 1, keyVersion: 2 });
    expect(fieldCipher.decryptField(stored, dekOf([[1, v1], [2, v2]]), ctx)).toBe('max@example.com');
  });

  it('liest nach einer Rotation weiterhin Werte der alten Version', () => {
    const old = fieldCipher.encryptField('alt', dekOf([[1, v1]]), ctx);
    const rotated = dekOf([[1, v1], [2, v2]]);
    expect(fieldCipher.decryptField(old, rotated, ctx)).toBe('alt');
    expect(isCurrentField(old, rotated)).toBe(false);
    expect(isCurrentField(fieldCipher.encryptField('neu', rotated, ctx), rotated)).toBe(true);
    expect(() => fieldCipher.decryptField(old, dekOf([[2, v2]]), ctx)).toThrow();
  });

  it('liest das alte Format ohne Kopf und meldet es als Altformat', () => {
    const legacy = legacyEncrypt('legacy@example.org', v1);
    expect(fieldCipher.decryptField(legacy, dekOf([[1, v1]]), ctx)).toBe('legacy@example.org');
    expect(isCurrentField(legacy, dekOf([[1, v1]]))).toBe(false);
  });

  it('erkennt Kontextwechsel, ausgetauschte Kopfdaten und Klartext', () => {
    const dek = dekOf([[1, v1], [2, v2]]);
    const stored = fieldCipher.encryptField('geheim', dek, ctx);
    expect(() => fieldCipher.decryptField(stored, dek, { ...ctx, recordId: 'user-2' })).toThrow();
    const swapped = Buffer.from(stored);
    swapped.writeUInt32BE(1, 1);
    expect(() => fieldCipher.decryptField(swapped, dek, ctx)).toThrow();
    expect(() => fieldCipher.decryptField(Buffer.from('legacy plaintext value 1234567890'), dek, ctx)).toThrow();
  });

  it('liefert Blind-Index-Kandidaten fuer alle Schluesselversionen', () => {
    const candidates = blindIndexCandidates(dekOf([[1, v1], [2, v2]]), 'a@b.de');
    expect(candidates).toEqual([computeBlindIndex(v1, 'a@b.de'), computeBlindIndex(v2, 'a@b.de')]);
  });
});
