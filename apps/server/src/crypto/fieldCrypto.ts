/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// Gespeichertes Format eines verschluesselten Feldes (Formatversion 1):
//   format (1 Byte) || key_version (4 Byte, big endian) || iv (12) || ciphertext || tag (16)
// Die Schluesselversion im Kopf waehlt beim Entschluesseln die passende DEK, alte Versionen bleiben
// dadurch nach einer Rotation lesbar. Formatversion und Schluesselversion sind zusaetzlich Teil der
// AAD: ein ausgetauschter Kopf laesst die GCM-Pruefung scheitern.
//
// Altformat ohne Kopf (iv || tag || ciphertext): wird weiterhin gelesen, bis die Neuverschluesselung
// (crypto/rotation.ts) jeden Wert ins aktuelle Format gebracht hat. Dessen AAD enthielt an zweiter
// Stelle einen festen Wert "1" und am Ende die damals aktive Schluesselversion.
export const FIELD_FORMAT_VERSION = 1;
const HEADER_LENGTH = 5;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const AAD_SEPARATOR = '\x1f';
const LEGACY_AAD_MARKER = '1';

// AAD-Bindung: ein Wert ist nur an genau dieser Stelle (Installation, Tabelle, Datensatz, Feld) gueltig.
export interface AadContext {
  readonly installationId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly fieldName: string;
}

// Alle bekannten Versionen der DEK eines Zwecks; keyVersion/rawDek ist die aktive zum Verschluesseln.
export interface ResolvedDek {
  readonly purpose: string;
  readonly keyVersion: number;
  readonly rawDek: Buffer;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface StoredFieldInfo {
  readonly format: 0 | 1;
  readonly keyVersion: number | null;
}

function aad(ctx: AadContext, format: number, keyVersion: number): Buffer {
  return Buffer.from([ctx.installationId, ctx.tableName, ctx.recordId, ctx.fieldName, `f${format}`, String(keyVersion)].join(AAD_SEPARATOR), 'utf8');
}

function legacyAad(ctx: AadContext, keyVersion: number): Buffer {
  return Buffer.from([ctx.installationId, LEGACY_AAD_MARKER, ctx.tableName, ctx.recordId, ctx.fieldName, String(keyVersion)].join(AAD_SEPARATOR), 'utf8');
}

function open(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, additional: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LENGTH });
  decipher.setAAD(additional);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// Kopf lesen, ohne zu entschluesseln. Ein Altwert kann zufaellig mit 0x01 beginnen -- deshalb
// probiert decryptField bei fehlgeschlagener Pruefung zusaetzlich das Altformat.
export function describeStoredField(stored: Buffer): StoredFieldInfo {
  if (stored.length >= HEADER_LENGTH + GCM_IV_LENGTH + GCM_TAG_LENGTH && stored[0] === FIELD_FORMAT_VERSION) {
    return { format: 1, keyVersion: stored.readUInt32BE(1) };
  }
  return { format: 0, keyVersion: null };
}

function decryptLegacy(stored: Buffer, dek: ResolvedDek, ctx: AadContext): string {
  if (stored.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) throw new Error('Invalid encrypted field');
  const iv = stored.subarray(0, GCM_IV_LENGTH);
  const tag = stored.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
  const ciphertext = stored.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
  for (const [version, key] of [...dek.keys.entries()].sort((a, b) => b[0] - a[0])) {
    try { return open(key, iv, ciphertext, tag, legacyAad(ctx, version)); } catch { /* naechste Version */ }
  }
  throw new Error('Encrypted field could not be authenticated');
}

export const fieldCipher = {
  encryptField(plaintext: string, dek: ResolvedDek, ctx: AadContext): Buffer {
    const header = Buffer.alloc(HEADER_LENGTH);
    header[0] = FIELD_FORMAT_VERSION;
    header.writeUInt32BE(dek.keyVersion, 1);
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', dek.rawDek, iv, { authTagLength: GCM_TAG_LENGTH });
    cipher.setAAD(aad(ctx, FIELD_FORMAT_VERSION, dek.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([header, iv, ciphertext, cipher.getAuthTag()]);
  },

  // Schlaegt jede Pruefung fehl (falscher Kontext, manipulierter Wert, unbekannte Version, Klartext),
  // wird ein Fehler geworfen -- nie ein Klartext-Rueckfall.
  decryptField(stored: Buffer, dek: ResolvedDek, ctx: AadContext): string {
    const info = describeStoredField(stored);
    if (info.format === 1 && info.keyVersion !== null) {
      const key = dek.keys.get(info.keyVersion);
      if (key) {
        const iv = stored.subarray(HEADER_LENGTH, HEADER_LENGTH + GCM_IV_LENGTH);
        const ciphertext = stored.subarray(HEADER_LENGTH + GCM_IV_LENGTH, stored.length - GCM_TAG_LENGTH);
        const tag = stored.subarray(stored.length - GCM_TAG_LENGTH);
        try { return open(key, iv, ciphertext, tag, aad(ctx, FIELD_FORMAT_VERSION, info.keyVersion)); } catch { /* evtl. Altwert mit 0x01 am Anfang */ }
      }
    }
    return decryptLegacy(stored, dek, ctx);
  }
};

// Entspricht der Wert bereits dem aktuellen Format und der aktiven Schluesselversion?
export function isCurrentField(stored: Buffer, dek: ResolvedDek): boolean {
  const info = describeStoredField(stored);
  return info.format === FIELD_FORMAT_VERSION && info.keyVersion === dek.keyVersion;
}

// Erzeugt eine neue, zufällige DEK (roh, 256 Bit) -- wird vor dem Speichern über den KeyProvider
// mit der KEK umwickelt (dekService.ts).
export function generateRawDek(): Buffer {
  return randomBytes(32);
}

// Blind-Index für Exact-Match-Suche: eigener Schlüsselraum, getrennt von den Feld-DEKs, damit ein
// Leak des einen nicht automatisch den anderen kompromittiert. Normalisierung (lowercase/trim) muss
// bei Schreiben UND Lesen identisch sein.
export function computeBlindIndex(blindIndexKey: Buffer, normalizedValue: string): string {
  return createHmac('sha256', blindIndexKey).update(normalizedValue, 'utf8').digest('hex');
}

// Alle Blind-Index-Werte ueber saemtliche bekannten Schluesselversionen -- Suchen bleiben waehrend
// einer Rotation treffsicher, auch wenn ein Datensatz noch den Index der alten Version traegt.
export function blindIndexCandidates(dek: ResolvedDek, normalizedValue: string): string[] {
  return [...new Set([...dek.keys.values()].map(key => computeBlindIndex(key, normalizedValue)))];
}
