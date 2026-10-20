/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { TOTP } from 'otpauth';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

const PERIOD_SECONDS = 30;

// Security-Audit N6: ein TOTP-Code bleibt ohne diese Prüfung für das gesamte ±30s-Zeitfenster
// mehrfach gültig -- wer einen Code über die Schulter mitliest/abfängt (z.B. über eine
// kompromittierte Zwischenstation), kann ihn innerhalb des Fensters selbst noch verwenden. Der
// zuletzt akzeptierte Zeitschritt wird pro Konto gespeichert; ein Code aus einem bereits
// verbrauchten oder älteren Schritt wird abgelehnt. Die Prüf-und-Schreib-Operation läuft als
// eine einzige bedingte UPDATE-Anweisung (WHERE totp_last_step < step OR IS NULL), damit zwei
// parallele Versuche mit demselben Code sich nicht gegenseitig überholen können (race-sicher
// ohne eigene Transaktion/Zeilensperre).
export async function verifyAndConsumeTotp(
  db: Kysely<Database>,
  userId: string,
  secretBase32: string,
  code: string
): Promise<boolean> {
  const totp = new TOTP({ secret: secretBase32, digits: 6, period: PERIOD_SECONDS });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;

  const currentCounter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const step = currentCounter + delta;

  const row = await db.selectFrom('users').select('totp_last_step').where('id', '=', userId).executeTakeFirst();
  if (row && row.totp_last_step !== null && row.totp_last_step >= step) return false;

  const result = await db.updateTable('users')
    .set({ totp_last_step: step })
    .where('id', '=', userId)
    .where(eb => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', step)]))
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0) > 0;
}
