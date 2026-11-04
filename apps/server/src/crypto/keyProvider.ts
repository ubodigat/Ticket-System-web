/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';

// Die KEK-Datei ist ein Schluesselbund: je Zeile "<version>:<base64>", die hoechste Version ist die
// aktuelle. Eine Datei mit nur einer base64-Zeile (Format der Ersteinrichtung bis 11/2026) gilt als
// Version 1. Die KEKs verlassen dieses Modul nie -- nach aussen gibt es nur wrap/unwrap.
export interface KeyProvider {
  currentKekVersion(): Promise<number>;
  kekVersions(): Promise<number[]>;
  // Umhuellt eine DEK mit der aktuellen KEK, gebunden an aad (Zweck + DEK-Version, siehe dekService).
  wrapDek(rawDek: Buffer, aad: Buffer): Promise<Buffer>;
  // aad = null nur fuer DEKs, die vor der AAD-Bindung umhuellt wurden (wrap_format 0).
  unwrapDek(wrapped: Buffer, kekVersion: number, aad: Buffer | null): Promise<Buffer>;
}

const KEK_LENGTH_BYTES = 32; // AES-256
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

export function parseKekFile(text: string): Map<number, Buffer> {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const keys = new Map<number, Buffer>();
  if (lines.length === 1 && !lines[0]!.includes(':')) {
    keys.set(1, Buffer.from(lines[0]!, 'base64'));
  } else {
    for (const line of lines) {
      const match = /^(\d{1,6}):([A-Za-z0-9+/=]+)$/.exec(line);
      if (!match) throw new Error('KEK-Datei hat ein ungueltiges Format (erwartet "<version>:<base64>" je Zeile).');
      const version = Number(match[1]);
      if (version < 1 || keys.has(version)) throw new Error(`KEK-Datei enthaelt die Version ${version} ungueltig oder doppelt.`);
      keys.set(version, Buffer.from(match[2]!, 'base64'));
    }
  }
  if (!keys.size) throw new Error('KEK-Datei ist leer.');
  for (const [version, key] of keys) {
    if (key.length !== KEK_LENGTH_BYTES) {
      throw new Error(`KEK-Datei enthält für Version ${version} keinen gültigen 256-Bit-Schlüssel (erhalten: ${key.length} Byte).`);
    }
  }
  return keys;
}

export function formatKekFile(keys: ReadonlyMap<number, Buffer>): string {
  return [...keys.entries()].sort((a, b) => a[0] - b[0]).map(([version, key]) => `${version}:${key.toString('base64')}`).join('\n') + '\n';
}

class FileKeyProvider implements KeyProvider {
  #keys: Map<number, Buffer> | undefined;
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async #load(): Promise<Map<number, Buffer>> {
    if (this.#keys) return this.#keys;
    const info = await stat(this.#filePath).catch(() => {
      throw new Error(`KEK-Datei nicht gefunden: ${this.#filePath}. Lief install.sh vollständig durch?`);
    });
    // Auf POSIX-Systemen muss die Datei exakt 0400/0600 sein -- sonst Start verweigern statt mit einer
    // zu offen lesbaren KEK weiterzulaufen. Unter Windows (nur Entwicklung) ist der Modus nicht aussagekräftig.
    if (process.platform !== 'win32') {
      const mode = info.mode & 0o777;
      if (mode !== 0o400 && mode !== 0o600) {
        throw new Error(`KEK-Datei ${this.#filePath} hat unsichere Rechte (${mode.toString(8)}). Erwartet: 0400 oder 0600.`);
      }
    }
    this.#keys = parseKekFile(await readFile(this.#filePath, 'utf8'));
    return this.#keys;
  }

  async currentKekVersion(): Promise<number> {
    return Math.max(...(await this.#load()).keys());
  }

  async kekVersions(): Promise<number[]> {
    return [...(await this.#load()).keys()].sort((a, b) => a - b);
  }

  async wrapDek(rawDek: Buffer, aad: Buffer): Promise<Buffer> {
    const keys = await this.#load();
    const kek = keys.get(Math.max(...keys.keys()))!;
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', kek, iv, { authTagLength: GCM_TAG_LENGTH });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(rawDek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  async unwrapDek(wrapped: Buffer, kekVersion: number, aad: Buffer | null): Promise<Buffer> {
    const kek = (await this.#load()).get(kekVersion);
    if (!kek) throw new Error(`KEK-Version ${kekVersion} fehlt in der KEK-Datei -- wurde sie zu frueh entfernt?`);
    const iv = wrapped.subarray(0, GCM_IV_LENGTH);
    const tag = wrapped.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const ciphertext = wrapped.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv, { authTagLength: GCM_TAG_LENGTH });
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function createFileKeyProvider(kekFilePath: string): KeyProvider {
  return new FileKeyProvider(kekFilePath);
}

// Für install.sh / Setup: erzeugt den Inhalt einer neuen KEK-Datei (Version 1).
export function generateNewKekMaterial(): string {
  return formatKekFile(new Map([[1, randomBytes(KEK_LENGTH_BYTES)]]));
}

// KEK-Rotation, Schritt 1: neue Version an den Schluesselbund anhaengen (atomar, Rechte 0600).
// Die alten Versionen bleiben stehen, bis rewrapAllDeks (rotation.ts) jede DEK neu umhuellt hat.
export async function appendKekVersion(kekFilePath: string): Promise<number> {
  const keys = parseKekFile(await readFile(kekFilePath, 'utf8'));
  const version = Math.max(...keys.keys()) + 1;
  keys.set(version, randomBytes(KEK_LENGTH_BYTES));
  await writeKekFile(kekFilePath, keys);
  return version;
}

// KEK-Rotation, letzter Schritt: nicht mehr benoetigte Versionen entfernen.
export async function retireKekVersions(kekFilePath: string, keep: ReadonlySet<number>): Promise<number[]> {
  const keys = parseKekFile(await readFile(kekFilePath, 'utf8'));
  const removed = [...keys.keys()].filter(version => !keep.has(version));
  for (const version of removed) keys.delete(version);
  if (!keys.size) throw new Error('Es muss mindestens eine KEK-Version erhalten bleiben.');
  await writeKekFile(kekFilePath, keys);
  return removed;
}

async function writeKekFile(kekFilePath: string, keys: ReadonlyMap<number, Buffer>): Promise<void> {
  const tmp = `${kekFilePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, formatKekFile(keys), { mode: 0o600, flag: 'wx' });
  await rename(tmp, kekFilePath);
}
