/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';

// Zaehler-Speicher fuer @fastify/rate-limit (Review 11/2026, Punkt 10):
// - Routen mit eigenem, engem Limit (Anmeldung, MFA, Setup, Passwort, Update, Sicherung ...) zaehlen
//   in rate_limit_counters -- ein Neustart setzt diese Zaehler nicht zurueck.
// - Das grobe globale Limit (1000/min je Adresse gegen Ueberlastung) bleibt im Speicher; es auf
//   jede Anfrage in die Datenbank zu schreiben, kostete zwei Abfragen pro Aufruf. Bei einem
//   Neustart beginnt nur dieses grobe Limit neu.
// Feste Zeitfenster; der Schluessel wird gehasht (IP-Adressen landen nicht im Klartext in der DB).
type Callback = (error: Error | null, result: { current: number; ttl: number } | null) => void;
interface RouteOptions { routeInfo: { method: string; url: string } }

export function createRateLimitStore(db: Kysely<Database>) {
  class MemoryWindowStore {
    readonly #counters = new Map<string, { count: number; resetAt: number }>();
    incr(key: string, callback: Callback, timeWindow: number) {
      const now = Date.now();
      let entry = this.#counters.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + timeWindow };
        this.#counters.set(key, entry);
        if (this.#counters.size > 50_000) for (const [k, v] of this.#counters) if (v.resetAt <= now) this.#counters.delete(k);
      }
      entry.count++;
      callback(null, { current: entry.count, ttl: entry.resetAt - now });
    }
    child(routeOptions: RouteOptions) {
      return new DatabaseWindowStore(`${routeOptions.routeInfo.method} ${routeOptions.routeInfo.url}`);
    }
  }

  class DatabaseWindowStore {
    constructor(readonly prefix: string) {}
    incr(key: string, callback: Callback, timeWindow: number) {
      const now = Date.now();
      const windowStart = new Date(Math.floor(now / timeWindow) * timeWindow);
      const rateKey = createHash('sha256').update(`${this.prefix}\0${key}`).digest('hex');
      (async () => {
        await sql`INSERT INTO rate_limit_counters (rate_key, window_start, count) VALUES (${rateKey}, ${windowStart}, 1)
          ON DUPLICATE KEY UPDATE count = count + 1`.execute(db);
        const row = await db.selectFrom('rate_limit_counters').select('count')
          .where('rate_key', '=', rateKey).where('window_start', '=', windowStart).executeTakeFirst();
        return { current: Number(row?.count ?? 1), ttl: windowStart.getTime() + timeWindow - now };
      })().then(result => callback(null, result), error => callback(error, null));
    }
    child(routeOptions: RouteOptions) {
      return new DatabaseWindowStore(`${routeOptions.routeInfo.method} ${routeOptions.routeInfo.url}`);
    }
  }

  return MemoryWindowStore;
}
