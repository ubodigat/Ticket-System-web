import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { KeyProvider } from './keyProvider.js';

// Kanonisches AAD-Format gemäß docs/CRYPTOGRAPHY.md §3 (bindend):
// installation_id || schema_version || table_name || record_id || field_name || key_version
// Trennzeichen 0x1F (Unit Separator), da in keinem der Bestandteile zu erwarten.
const AAD_SEPARATOR = '\x1f';

export interface AadContext {
  readonly installationId: string;
  readonly schemaVersion: number;
  readonly tableName: string;
  readonly recordId: string;
  readonly fieldName: string;
  readonly keyVersion: number;
}

export function buildAad(ctx: AadContext): Buffer {
  const parts = [
    ctx.installationId,
    String(ctx.schemaVersion),
    ctx.tableName,
    ctx.recordId,
    ctx.fieldName,
    String(ctx.keyVersion)
  ];
  return Buffer.from(parts.join(AAD_SEPARATOR), 'utf8');
}

const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

export interface FieldCipher {
  encryptField(plaintext: string, dek: Buffer, ctx: AadContext): Buffer;
  decryptField(stored: Buffer, dek: Buffer, ctx: AadContext): string;
}

// Layout der gespeicherten VARBINARY-Spalte: iv(12) || tag(16) || ciphertext.
// Die AAD selbst wird NICHT mitgespeichert -- sie wird bei jedem Zugriff aus dem bekannten
// Tabellen-/Feldkontext neu aufgebaut; ein Mismatch (z.B. falsche record_id) lässt GCM die
// Authentifizierung fehlschlagen, statt stillschweigend falsche Daten zu liefern.
export const fieldCipher: FieldCipher = {
  encryptField(plaintext, dek, ctx) {
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(buildAad(ctx));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  },

  decryptField(stored, dek, ctx) {
    const iv = stored.subarray(0, GCM_IV_LENGTH);
    const tag = stored.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const ciphertext = stored.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(buildAad(ctx));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
};

// Erzeugt eine neue, zufällige DEK (roh, 256 Bit) -- Aufrufer ist dafür verantwortlich, sie
// über den KeyProvider zu wrappen, bevor sie in data_encryption_keys gespeichert wird.
export function generateRawDek(): Buffer {
  return randomBytes(32);
}

export async function unwrapDekOrThrow(provider: KeyProvider, wrapped: Buffer): Promise<Buffer> {
  return provider.unwrapDek(wrapped);
}

// Blind-Index für Exact-Match-Suche (docs/adr/0005): eigener Schlüsselraum, getrennt von den
// Feld-DEKs (docs/CRYPTOGRAPHY.md §1), damit ein Leak des einen nicht automatisch den anderen
// kompromittiert. Normalisierung (lowercase/trim) muss bei Schreiben UND Lesen identisch sein.
export function computeBlindIndex(blindIndexKey: Buffer, normalizedValue: string): string {
  return createHmac('sha256', blindIndexKey).update(normalizedValue, 'utf8').digest('hex');
}
