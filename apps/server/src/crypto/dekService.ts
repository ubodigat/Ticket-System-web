/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { KeyProvider } from './keyProvider.js';
import { generateRawDek } from './fieldCrypto.js';

// Verwaltet DEKs je Zweck (docs/CRYPTOGRAPHY.md §1/§5): legt bei Bedarf eine neue, KEK-
// umwickelte DEK in data_encryption_keys an, oder liefert die aktive Version zurück. Rotation
// (mehrere gleichzeitig aktive Versionen) ist hier bewusst noch nicht abgedeckt -- Phase 1
// kennt nur "die eine aktuelle Version pro Zweck", siehe docs/PROGRESS.md Phase 2.
export interface ResolvedDek {
  readonly rawDek: Buffer;
  readonly keyVersion: number;
}

export async function ensureDek(
  db: Kysely<Database>,
  provider: KeyProvider,
  purpose: string
): Promise<ResolvedDek> {
  const existing = await db
    .selectFrom('data_encryption_keys')
    .select(['key_version', 'wrapped_dek'])
    .where('purpose', '=', purpose)
    .where('active', '=', true)
    .orderBy('key_version', 'desc')
    .executeTakeFirst();

  if (existing) {
    const rawDek = await provider.unwrapDek(existing.wrapped_dek);
    return { rawDek, keyVersion: existing.key_version };
  }

  const rawDek = generateRawDek();
  const wrapped = await provider.wrapDek(rawDek);
  const keyVersion = 1;

  try {
    await db
      .insertInto('data_encryption_keys')
      .values({ purpose, key_version: keyVersion, wrapped_dek: wrapped, active: true })
      .execute();
  } catch {
    // Zwei gleichzeitige erste Requests können beide "keine DEK vorhanden" gesehen haben --
    // der UNIQUE-Constraint (uq_dek_purpose_version) lässt nur einen Insert durch. Der Verlierer
    // liest die nun existierende Zeile erneut, statt mit einem unklaren Fehler abzubrechen.
    const row = await db
      .selectFrom('data_encryption_keys')
      .select(['key_version', 'wrapped_dek'])
      .where('purpose', '=', purpose)
      .where('active', '=', true)
      .orderBy('key_version', 'desc')
      .executeTakeFirstOrThrow();
    return { rawDek: await provider.unwrapDek(row.wrapped_dek), keyVersion: row.key_version };
  }

  return { rawDek, keyVersion };
}
