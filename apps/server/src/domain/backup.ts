// Datenbank-Sicherung (Systemeinstellungen > Info & Updates, nur Superadmin): Dateiformat,
// Verschluesselung und Zeilen-Kodierung -- ohne Datenbankzugriff, damit es einzeln testbar ist.
//
// Aufbau einer Sicherungsdatei:
//   MAGIC | uint32 (Laenge des Kopfes) | Kopf (JSON) | Chiffrat | GCM-Tag (16 Byte)
// Der Kopf ist unverschluesselt lesbar (Installation, Schema-Stand, Zeitpunkt), aber als AAD
// authentifiziert -- eine Veraenderung faellt beim Entschluesseln auf. Das Chiffrat ist der
// gzip-komprimierte Inhalt (NDJSON), verschluesselt mit AES-256-GCM; der Schluessel entsteht per
// scrypt aus der Sicherungs-Passphrase, die nie gespeichert wird. Zusaetzlich verlangt das
// Einspielen den SHA-256-Hash der gesamten Datei, der beim Erstellen angezeigt wurde.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';

export const BACKUP_MAGIC = Buffer.from('TICKETSYSTEM-BACKUP-1\n', 'ascii');
export const BACKUP_MAX_BYTES = 512 * 1024 * 1024;
export const BACKUP_PASSPHRASE_MIN = 16;
// Schutz vor Dekompressionsbomben und uebergrossen Einzelzeilen beim Einlesen.
const MAX_INFLATED_BYTES = 6 * 1024 * 1024 * 1024;
const MAX_LINE_BYTES = 96 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };

export interface BackupHeader {
  format: 1;
  installationId: string;
  latestMigration: string | null;
  createdAt: string;
  createdBy: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  iv: string;
}

export class BackupError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// Eingabe aus der Oberflaeche: Leerzeichen/Bindestriche erlaubt, Gross-/Kleinschreibung egal.
export function normalizeHash(input: string): string | null {
  const value = String(input || '').replace(/[\s:-]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function hashMatches(file: Buffer, expected: string): boolean {
  const normalized = normalizeHash(expected);
  if (!normalized) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(file), 'hex'), Buffer.from(normalized, 'hex'));
}

function deriveKey(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase.normalize('NFC'), salt, 32, { ...params, maxmem: 512 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key));
  });
}

function headerBlock(header: BackupHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([BACKUP_MAGIC, length, json]);
}

export async function sealBackup(payload: Buffer, passphrase: string,
  meta: Pick<BackupHeader, 'installationId' | 'latestMigration' | 'createdBy'>,
  params: { N: number; r: number; p: number } = SCRYPT): Promise<Buffer> {
  if (passphrase.length < BACKUP_PASSPHRASE_MIN) throw new BackupError('passphrase_too_short');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: BackupHeader = {
    format: 1, ...meta, createdAt: new Date().toISOString(),
    kdf: { name: 'scrypt', ...params, salt: salt.toString('base64') }, iv: iv.toString('base64')
  };
  const prefix = headerBlock(header);
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(passphrase, salt, params), iv);
  cipher.setAAD(prefix);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  const file = Buffer.concat([prefix, body, cipher.getAuthTag()]);
  if (file.length > BACKUP_MAX_BYTES) throw new BackupError('backup_too_large');
  return file;
}

// Liest nur den (unverschluesselten) Kopf -- fuer Pruefungen vor dem teuren Entschluesseln.
export function readBackupHeader(file: Buffer): { header: BackupHeader; prefixLength: number } {
  if (file.length < BACKUP_MAGIC.length + 4 + 16 || !file.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new BackupError('backup_invalid_file');
  const headerLength = file.readUInt32BE(BACKUP_MAGIC.length);
  const prefixLength = BACKUP_MAGIC.length + 4 + headerLength;
  if (headerLength > MAX_HEADER_BYTES || prefixLength + 16 > file.length) throw new BackupError('backup_invalid_file');
  let header: BackupHeader;
  try { header = JSON.parse(file.subarray(BACKUP_MAGIC.length + 4, prefixLength).toString('utf8')); } catch { throw new BackupError('backup_invalid_file'); }
  const kdf = header?.kdf;
  const valid = header?.format === 1 && typeof header.installationId === 'string' && typeof header.iv === 'string'
    && kdf?.name === 'scrypt' && Number.isInteger(kdf.N) && kdf.N >= 2 ** 14 && kdf.N <= 2 ** 20 && (kdf.N & (kdf.N - 1)) === 0
    && Number.isInteger(kdf.r) && kdf.r >= 8 && kdf.r <= 16 && Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 4 && typeof kdf.salt === 'string';
  if (!valid) throw new BackupError('backup_invalid_file');
  return { header, prefixLength };
}

export async function openBackup(file: Buffer, passphrase: string): Promise<{ header: BackupHeader; payload: Buffer }> {
  const { header, prefixLength } = readBackupHeader(file);
  const iv = Buffer.from(header.iv, 'base64');
  const salt = Buffer.from(header.kdf.salt, 'base64');
  if (iv.length !== 12 || salt.length < 16) throw new BackupError('backup_invalid_file');
  const key = await deriveKey(passphrase, salt, header.kdf);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(file.subarray(0, prefixLength));
  decipher.setAuthTag(file.subarray(file.length - 16));
  try {
    const payload = Buffer.concat([decipher.update(file.subarray(prefixLength, file.length - 16)), decipher.final()]);
    return { header, payload };
  } catch {
    // Falsche Passphrase und manipulierte Datei sind bei GCM nicht unterscheidbar.
    throw new BackupError('backup_decrypt_failed');
  }
}

// --- Zeilen-Kodierung: Binaerdaten, Zeitpunkte und grosse Zahlen verlustfrei als JSON ---

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { $b: value.toString('base64') };
  if (value instanceof Date) return { $d: value.toISOString() };
  if (typeof value === 'bigint') return { $n: value.toString() };
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BackupError('backup_unsupported_value');
    return value;
  }
  throw new BackupError('backup_unsupported_value');
}

export function decodeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const entry = (value as Record<string, unknown>)[keys[0] ?? ''];
    if (keys.length === 1 && typeof entry === 'string') {
      if (keys[0] === '$b' && /^[A-Za-z0-9+/]*={0,2}$/.test(entry)) return Buffer.from(entry, 'base64');
      if (keys[0] === '$d') { const date = new Date(entry); if (!Number.isNaN(date.getTime())) return date; }
      if (keys[0] === '$n' && /^-?\d{1,40}$/.test(entry)) return entry;
    }
  }
  throw new BackupError('backup_invalid_content');
}

export interface BackupTableMeta { name: string; columns: string[] }
export type BackupLine = { kind: 'meta'; tables: BackupTableMeta[] } | { t: string; r: unknown[] };

// Schreibt NDJSON-Zeilen gzip-komprimiert in einen Puffer (mit Groessenlimit).
export function createPayloadWriter() {
  const gzip = createGzip({ level: 6 });
  const chunks: Buffer[] = [];
  let size = 0;
  let failed: Error | null = null;
  gzip.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > BACKUP_MAX_BYTES) { failed = new BackupError('backup_too_large'); gzip.destroy(); return; }
    chunks.push(chunk);
  });
  return {
    async write(line: BackupLine) {
      if (failed) throw failed;
      if (!gzip.write(JSON.stringify(line) + '\n')) await new Promise<void>(resolve => gzip.once('drain', () => resolve()));
      if (failed) throw failed;
    },
    async finish(): Promise<Buffer> {
      if (failed) throw failed;
      await new Promise<void>((resolve, reject) => { gzip.once('end', () => resolve()); gzip.once('error', reject); gzip.end(); });
      if (failed) throw failed;
      return Buffer.concat(chunks);
    }
  };
}

// Liest die NDJSON-Zeilen aus dem entschluesselten, gzip-komprimierten Inhalt -- gestreamt,
// damit der entpackte Inhalt nie vollstaendig im Speicher liegen muss.
export async function* readPayloadLines(payload: Buffer): AsyncGenerator<BackupLine> {
  const gunzip = Readable.from([payload]).pipe(createGunzip());
  let inflated = 0;
  let pending: Buffer[] = [];
  let pendingSize = 0;
  const parse = (raw: Buffer): BackupLine => {
    try { return JSON.parse(raw.toString('utf8')); } catch { throw new BackupError('backup_invalid_content'); }
  };
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      inflated += chunk.length;
      if (inflated > MAX_INFLATED_BYTES) throw new BackupError('backup_invalid_content');
      let start = 0;
      let index: number;
      while ((index = chunk.indexOf(0x0a, start)) !== -1) {
        pending.push(chunk.subarray(start, index));
        const line = Buffer.concat(pending);
        pending = []; pendingSize = 0;
        if (line.length) yield parse(line);
        start = index + 1;
      }
      if (start < chunk.length) {
        pending.push(chunk.subarray(start));
        pendingSize += chunk.length - start;
        if (pendingSize > MAX_LINE_BYTES) throw new BackupError('backup_invalid_content');
      }
    }
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('backup_invalid_content');
  } finally {
    gunzip.destroy();
  }
  if (pendingSize) yield parse(Buffer.concat(pending));
}
