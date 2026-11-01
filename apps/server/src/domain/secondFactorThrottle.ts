// Security-Audit R-23: kontoweite Bremse fuer den zweiten Faktor. Falsche TOTP-, Wiederherstellungs-
// und Passkey-Nachweise zaehlten bisher nur pro (Konto, Quellnetz) -- mit vielen Adressen liess sich
// ein TOTP-Code so in Stunden erraten. Jetzt zusaetzlich ein Zaehler am Konto mit wachsender
// Wartezeit, die fuer JEDE Quelle gilt (keine Geraete-Ausnahme), und eine Warn-Mail an die Person.
//
// Der Zaehler ist bewusst getrennt vom Passwort-Zaehler (users.failed_login_count): falsche Codes
// kann nur senden, wer das Passwort bereits kennt -- Dritte ohne Passwort koennen den zweiten Faktor
// einer Person damit nicht ausbremsen.
//
// Rechnung: ab 5 Fehlversuchen 2^(n-4) Sekunden Wartezeit, hoechstens 15 Minuten -- danach sind
// insgesamt nur noch 4 Versuche pro Stunde moeglich. Bei 3 von 1.000.000 gueltigen Codes braeuchte
// ein Angreifer fuer 50 % Trefferwahrscheinlichkeit rund 230.000 Versuche, also ueber 6 Jahre.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadSecurityPolicy, type SecurityPolicy } from './securityPolicy.js';
import { recordSourceFailure } from './loginThrottle.js';
import { queueUserMail } from '../mail/queue.js';

const THRESHOLD = 5;
const MAX_WAIT_SECONDS = 15 * 60;
export const SECOND_FACTOR_WARN_EVERY = 10;

export function secondFactorBackoffSeconds(failedCount: number, lastFailureAt: Date | string | null | undefined, now = Date.now()): number {
  if (failedCount < THRESHOLD || !lastFailureAt) return 0;
  const wait = Math.min(2 ** (failedCount - THRESHOLD + 1), MAX_WAIT_SECONDS);
  const remaining = Math.ceil(wait - (now - new Date(lastFailureAt).getTime()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export async function secondFactorWait(db: Kysely<Database>, userId: string): Promise<number> {
  const row = await db.selectFrom('users').select(['mfa_failed_count', 'mfa_failed_last_at']).where('id', '=', userId).executeTakeFirst();
  return secondFactorBackoffSeconds(Number(row?.mfa_failed_count) || 0, row?.mfa_failed_last_at ?? null);
}

// Erhoeht Quell- und Kontozaehler; liefert den neuen Kontostand (fuer die Warn-Mail).
export async function recordSecondFactorFailure(db: Kysely<Database>, userId: string, ip: string, policy: SecurityPolicy): Promise<number> {
  await recordSourceFailure(db, userId, ip, policy);
  return db.transaction().execute(async trx => {
    await trx.updateTable('users')
      .set(eb => ({ mfa_failed_count: eb('mfa_failed_count', '+', 1), mfa_failed_last_at: new Date() }))
      .where('id', '=', userId).execute();
    const row = await trx.selectFrom('users').select('mfa_failed_count').where('id', '=', userId).executeTakeFirst();
    return Number(row?.mfa_failed_count) || 0;
  });
}

export async function clearSecondFactorFailures(db: Kysely<Database>, userId: string): Promise<void> {
  await db.updateTable('users').set({ mfa_failed_count: 0, mfa_failed_last_at: null }).where('id', '=', userId).execute();
}

export function shouldWarnAboutSecondFactor(count: number): boolean {
  return count > 0 && count % SECOND_FACTOR_WARN_EVERY === 0;
}

export const SECOND_FACTOR_WARNING = {
  subject: 'Viele falsche Anmeldecodes',
  text: 'Fuer dein Konto wurden wiederholt falsche Zwei-Faktor-Codes eingegeben. Das bedeutet, dass jemand dein Passwort kennt. '
    + 'Bitte aendere sofort dein Passwort und melde dich beim Support, falls du das nicht selbst warst.'
};

// Fehlschlag zaehlen und bei jedem zehnten Fehlversuch die Person per Sicherheits-Mail warnen.
export async function noteSecondFactorFailure(deps: Parameters<typeof queueUserMail>[0], userId: string, ip: string): Promise<void> {
  const count = await recordSecondFactorFailure(deps.db, userId, ip, await loadSecurityPolicy(deps.db));
  if (shouldWarnAboutSecondFactor(count)) {
    await queueUserMail(deps, userId, SECOND_FACTOR_WARNING.subject, SECOND_FACTOR_WARNING.text, 'security').catch(() => undefined);
  }
}
