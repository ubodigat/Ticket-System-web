import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createFileKeyProvider, generateNewKekMaterial } from '../src/crypto/keyProvider.js';
import { buildAad, fieldCipher, generateRawDek } from '../src/crypto/fieldCrypto.js';

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

async function writeKekFile(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'kek-test-'));
  const path = join(tmpDir, 'test.kek');
  await writeFile(path, generateNewKekMaterial(), 'utf8');
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return path;
}

describe('FileKeyProvider', () => {
  it('wrapt und entwickelt eine DEK verlustfrei', async () => {
    const path = await writeKekFile();
    const provider = createFileKeyProvider(path);
    const rawDek = generateRawDek();

    const wrapped = await provider.wrapDek(rawDek);
    const unwrapped = await provider.unwrapDek(wrapped);

    expect(unwrapped.equals(rawDek)).toBe(true);
  });

  it('lehnt eine zu kurze KEK-Datei ab', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kek-test-'));
    const path = join(tmpDir, 'bad.kek');
    await writeFile(path, Buffer.from('too-short').toString('base64'), 'utf8');
    if (process.platform !== 'win32') await chmod(path, 0o600);
    const provider = createFileKeyProvider(path);

    await expect(provider.getCurrentKek()).rejects.toThrow(/256-Bit/);
  });
});

describe('fieldCipher', () => {
  it('verschlüsselt und entschlüsselt mit korrektem AAD', async () => {
    const path = await writeKekFile();
    const provider = createFileKeyProvider(path);
    const dek = generateRawDek();
    const ctx = {
      installationId: 'inst-123',
      schemaVersion: 1,
      tableName: 'users',
      recordId: 'user-1',
      fieldName: 'email',
      keyVersion: 1
    };

    const ciphertext = fieldCipher.encryptField('max@example.com', dek, ctx);
    const plaintext = fieldCipher.decryptField(ciphertext, dek, ctx);

    expect(plaintext).toBe('max@example.com');
    void provider; // Provider wird hier nur zur Konsistenz des Setups verwendet
  });

  it('schlägt fehl, wenn record_id im AAD nicht zum Ciphertext passt (Anti-Replay)', () => {
    const dek = generateRawDek();
    const baseCtx = {
      installationId: 'inst-123',
      schemaVersion: 1,
      tableName: 'users',
      recordId: 'user-1',
      fieldName: 'email',
      keyVersion: 1
    };
    const ciphertext = fieldCipher.encryptField('max@example.com', dek, baseCtx);

    const wrongCtx = { ...baseCtx, recordId: 'user-2' };
    expect(() => fieldCipher.decryptField(ciphertext, dek, wrongCtx)).toThrow();
  });

  it('baut das AAD in der kanonischen Reihenfolge aus docs/CRYPTOGRAPHY.md §3 auf', () => {
    const aad = buildAad({
      installationId: 'inst',
      schemaVersion: 2,
      tableName: 'tickets',
      recordId: 'rec',
      fieldName: 'title',
      keyVersion: 3
    });
    expect(aad.toString('utf8')).toBe('inst\x1f2\x1ftickets\x1frec\x1ftitle\x1f3');
  });
});
