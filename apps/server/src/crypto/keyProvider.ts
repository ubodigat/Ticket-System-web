/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

// KeyProvider-Abstraktion gemäß docs/CRYPTOGRAPHY.md §7 und docs/adr/0002. Die KEK selbst
// verlässt diese Datei niemals nach außen -- nur wrap/unwrap-Operationen sind exportiert.
export interface KekHandle {
  readonly version: number;
}

export interface KeyProvider {
  getCurrentKek(): Promise<KekHandle>;
  wrapDek(rawDek: Buffer): Promise<Buffer>;
  unwrapDek(wrapped: Buffer): Promise<Buffer>;
}

const KEK_LENGTH_BYTES = 32; // AES-256
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

class FileKeyProvider implements KeyProvider {
  #kek: Buffer | undefined;
  readonly #filePath: string;
  readonly #version = 1; // Rotation führt in Phase 2 eine neue Version + neue KEK-Datei ein

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async #load(): Promise<Buffer> {
    if (this.#kek) return this.#kek;

    const info = await stat(this.#filePath).catch(() => {
      throw new Error(`KEK-Datei nicht gefunden: ${this.#filePath}. Lief install.sh vollständig durch?`);
    });

    // Auf POSIX-Systemen muss die Datei exakt 0400/0600 sein -- sonst Start verweigern statt
    // stillschweigend mit einer zu offen lesbaren KEK weiterzulaufen. Unter Windows (Entwicklung,
    // kein Produktionsziel laut docs/SPEC.md §3) ist der POSIX-Modus nicht aussagekräftig; dort
    // wird die Prüfung bewusst übersprungen, siehe docs/adr/0002 Annahmen.
    if (process.platform !== 'win32') {
      const mode = info.mode & 0o777;
      if (mode !== 0o400 && mode !== 0o600) {
        throw new Error(`KEK-Datei ${this.#filePath} hat unsichere Rechte (${mode.toString(8)}). Erwartet: 0400 oder 0600.`);
      }
    }

    const raw = await readFile(this.#filePath);
    const keyBytes = Buffer.from(raw.toString('utf8').trim(), 'base64');
    if (keyBytes.length !== KEK_LENGTH_BYTES) {
      throw new Error(`KEK-Datei ${this.#filePath} enthält keinen gültigen 256-Bit-Schlüssel (erhalten: ${keyBytes.length} Byte).`);
    }
    this.#kek = keyBytes;
    return keyBytes;
  }

  async getCurrentKek(): Promise<KekHandle> {
    await this.#load();
    return { version: this.#version };
  }

  async wrapDek(rawDek: Buffer): Promise<Buffer> {
    const kek = await this.#load();
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    const ciphertext = Buffer.concat([cipher.update(rawDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  async unwrapDek(wrapped: Buffer): Promise<Buffer> {
    const kek = await this.#load();
    const iv = wrapped.subarray(0, GCM_IV_LENGTH);
    const tag = wrapped.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const ciphertext = wrapped.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function createFileKeyProvider(kekFilePath: string): KeyProvider {
  return new FileKeyProvider(kekFilePath);
}

// Für install.sh / Setup-Assistenten: erzeugt einen neuen, zufälligen 256-Bit-Schlüssel,
// base64-kodiert, exakt im Format, das FileKeyProvider erwartet.
export function generateNewKekMaterial(): string {
  return randomBytes(KEK_LENGTH_BYTES).toString('base64');
}
