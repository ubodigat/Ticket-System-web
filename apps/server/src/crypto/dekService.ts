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
import { generateRawDek, type ResolvedDek } from './fieldCrypto.js';

export type { ResolvedDek } from './fieldCrypto.js';

// DEKs je Zweck in data_encryption_keys: jede Version bleibt gespeichert (aeltere Werte bleiben
// lesbar), genau eine ist aktiv und wird zum Verschluesseln benutzt. Jede DEK ist mit der KEK
// umhuellt und dabei an Zweck und Version gebunden (wrap_format 1) -- eine umkopierte Zeile laesst
// sich so nicht als DEK eines anderen Zwecks ausgeben.
export const DEK_WRAP_FORMAT = 1;

export function dekWrapAad(purpose: string, keyVersion: number): Buffer {
  return Buffer.from(['dek', purpose, String(keyVersion)].join('\x1f'), 'utf8');
}

interface DekRow { key_version: number; wrapped_dek: Buffer; active: number | boolean; kek_version: number; wrap_format: number }

async function loadRows(db: Kysely<Database>, purpose: string): Promise<DekRow[]> {
  return db.selectFrom('data_encryption_keys')
    .select(['key_version', 'wrapped_dek', 'active', 'kek_version', 'wrap_format'])
    .where('purpose', '=', purpose)
    .orderBy('key_version', 'desc')
    .execute() as Promise<DekRow[]>;
}

export async function unwrapDekRow(provider: KeyProvider, purpose: string, row: DekRow): Promise<Buffer> {
  return provider.unwrapDek(row.wrapped_dek, row.kek_version ?? 1, row.wrap_format === DEK_WRAP_FORMAT ? dekWrapAad(purpose, row.key_version) : null);
}

async function resolve(provider: KeyProvider, purpose: string, rows: DekRow[]): Promise<ResolvedDek | null> {
  const active = rows.find(row => !!row.active);
  if (!active) return null;
  const keys = new Map<number, Buffer>();
  for (const row of rows) keys.set(row.key_version, await unwrapDekRow(provider, purpose, row));
  return { purpose, keyVersion: active.key_version, rawDek: keys.get(active.key_version)!, keys };
}

export async function insertDekVersion(db: Kysely<Database>, provider: KeyProvider, purpose: string, keyVersion: number, rawDek: Buffer): Promise<void> {
  await db.insertInto('data_encryption_keys').values({
    purpose, key_version: keyVersion, active: true,
    wrapped_dek: await provider.wrapDek(rawDek, dekWrapAad(purpose, keyVersion)),
    kek_version: await provider.currentKekVersion(), wrap_format: DEK_WRAP_FORMAT
  }).execute();
}

export async function ensureDek(db: Kysely<Database>, provider: KeyProvider, purpose: string): Promise<ResolvedDek> {
  const existing = await resolve(provider, purpose, await loadRows(db, purpose));
  if (existing) return existing;
  try {
    await insertDekVersion(db, provider, purpose, 1, generateRawDek());
  } catch {
    // Zwei gleichzeitige erste Requests koennen beide "keine DEK" gesehen haben -- der UNIQUE-Index
    // (purpose, key_version) laesst nur einen Insert durch; der andere liest danach die Zeile.
  }
  const created = await resolve(provider, purpose, await loadRows(db, purpose));
  if (!created) throw new Error(`DEK fuer ${purpose} konnte nicht angelegt werden`);
  return created;
}
