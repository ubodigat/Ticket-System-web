/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { Kysely } from 'kysely';
import { isIPv6 } from 'node:net';
import type { Database } from '../db/types.js';
import type { SecurityPolicy } from './securityPolicy.js';

// Security-Audit R-11: Der bisherige Fehlversuchszähler hing allein am Konto -- wer einen
// Benutzernamen kennt (admin, vorname.nachname, ...), konnte mit fünf falschen Passwörtern
// JEDES Konto sperren, auch Superadmins, ohne selbst angemeldet zu sein. Fix: die automatische
// Sperre läuft jetzt pro (Konto, Quellnetz) -- nur wiederholte Fehlversuche AUS DEMSELBEN Netz
// sperren diese Kombination, und zwar immer nur befristet, nie dauerhaft. users.locked_permanent/
// locked_until bleiben unverändert für die bewusste, manuelle Sperre durch eine Admin-Person
// (siehe users.ts PATCH) -- dieser Mechanismus hier ist zusätzlich, kein Ersatz.
//
// Für das Konto INSGESAMT (über alle Quellen hinweg) gibt es nur noch eine wachsende Wartezeit
// (accountBackoffSecondsRemaining), keine Sperre -- verhindert, dass verteilte Fehlversuche aus
// vielen verschiedenen Netzen (z.B. über ein Botnet) den gleichen Effekt wie eine gezielte Sperre
// erzielen, ohne selbst wieder zu einem Konto-weiten DoS-Hebel für Dritte zu werden.

// Security-Audit R-11: IPv4-mapped-Adressen (::ffff:a.b.c.d) werden vor der Gruppenbildung auf
// einfaches IPv4 zurueckgefuehrt -- ohne das wuerden alle IPv4-Nutzer hinter Caddy in dasselbe
// Quellnetz \"0:0:0:0\" fallen und sich gegenseitig ihre Login-Sperren teilen.
export function sourcePrefix(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (isIPv6(ip)) {
    return ipv6FirstFourGroups(ip).join(':');
  }
  return ip;
}

// Entfaltet "::" korrekt auf 8 Gruppen (statt nur Leerstrings herauszufiltern -- das würde "::"
// in der Mitte einer Adresse falsch behandeln, siehe loginThrottle.test.ts) und normalisiert
// jede der ersten vier Gruppen auf eine führungsnullenfreie Kleinschreibweise, damit
// unterschiedliche Schreibweisen derselben Adresse (z.B. "0db8" vs. "db8") denselben Präfix
// ergeben.
function ipv6FirstFourGroups(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  // Ein IPv4-eingebetteter letzter Teil (z.B. "::ffff:192.168.1.1") belegt zwei Gruppen (32 Bit) --
  // der genaue Wert ist für die ersten vier Gruppen irrelevant, nur die Anzahl zählt.
  const tailGroupCount = tailGroups.length > 0 && tailGroups[tailGroups.length - 1]!.includes('.')
    ? tailGroups.length + 1
    : tailGroups.length;
  const hasDoubleColon = ip.includes('::');
  const missing = hasDoubleColon ? Math.max(0, 8 - headGroups.length - tailGroupCount) : 0;
  const full = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  return full.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16));
}

export async function isSourceLocked(db: Kysely<Database>, userId: string, ip: string): Promise<boolean> {
  const row = await db.selectFrom('login_failure_sources')
    .select('locked_until')
    .where('user_id', '=', userId)
    .where('source_prefix', '=', sourcePrefix(ip))
    .executeTakeFirst();
  if (!row?.locked_until) return false;
  return new Date(row.locked_until).getTime() > Date.now();
}

// Läuft in einer Transaktion mit Zeilensperre, analog zum bisherigen recordFailedLogin --
// parallele Fehlversuche aus demselben Netz dürfen sich nicht gegenseitig überschreiben.
export async function recordSourceFailure(db: Kysely<Database>, userId: string, ip: string, policy: SecurityPolicy): Promise<void> {
  const prefix = sourcePrefix(ip);
  await db.transaction().execute(async trx => {
    const row = await trx.selectFrom('login_failure_sources')
      .select('failure_count').where('user_id', '=', userId).where('source_prefix', '=', prefix)
      .forUpdate().executeTakeFirst();
    const nextCount = (row?.failure_count ?? 0) + 1;
    const limitReached = policy.maxLoginAttempts > 0 && nextCount >= policy.maxLoginAttempts;
    // Security-Audit R-11: anders als bei der frueheren, globalen Sperre gibt es hier KEINE
    // "lock" (dauerhaft)-Eskalationsstufe mehr -- eine automatische, durch Dritte ausloesbare
    // Sperre ist grundsaetzlich immer befristet, egal was policy.lockoutAction sagt. "none"
    // bleibt weiterhin "keine automatische Sperre".
    const failureCount = limitReached ? 0 : nextCount;
    const lockedUntil = limitReached && policy.lockoutAction !== 'none'
      ? new Date(Date.now() + policy.lockoutMinutes * 60 * 1000)
      : null;
    if (row) {
      await trx.updateTable('login_failure_sources')
        .set({ failure_count: failureCount, ...(lockedUntil ? { locked_until: lockedUntil } : {}) })
        .where('user_id', '=', userId).where('source_prefix', '=', prefix).execute();
    } else {
      await trx.insertInto('login_failure_sources')
        .values({ user_id: userId, source_prefix: prefix, failure_count: failureCount, locked_until: lockedUntil })
        .execute();
    }
  });
}

export async function clearSourceFailures(db: Kysely<Database>, userId: string): Promise<void> {
  await db.deleteFrom('login_failure_sources').where('user_id', '=', userId).execute();
}

// Kontoweiter Backoff: ab der Schwelle wächst die Wartezeit exponentiell mit jedem weiteren
// Fehlversuch (2^k Sekunden), gedeckelt auf 5 Minuten -- siehe Audit-Beispiel F.2.
const BACKOFF_THRESHOLD = 10;
const BACKOFF_MAX_SECONDS = 300;

export function accountBackoffSecondsRemaining(failedCount: number, lastFailureAt: Date | string | null | undefined): number {
  if (failedCount < BACKOFF_THRESHOLD || !lastFailureAt) return 0;
  const waitSeconds = Math.min(2 ** (failedCount - BACKOFF_THRESHOLD + 1), BACKOFF_MAX_SECONDS);
  const elapsedSeconds = (Date.now() - new Date(lastFailureAt).getTime()) / 1000;
  const remaining = Math.ceil(waitSeconds - elapsedSeconds);
  return remaining > 0 ? remaining : 0;
}
