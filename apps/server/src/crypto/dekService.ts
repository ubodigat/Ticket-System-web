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
