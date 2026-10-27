/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { z } from 'zod';

// Alle Secrets kommen ausschließlich aus Umgebungsvariablen (vom install.sh-Skript generiert
// und in die Container-Umgebung injiziert). Es gibt bewusst keine Default-Werte für Secrets --
// ein fehlender Wert muss den Start verhindern, nicht stillschweigend einen unsicheren Default liefern.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  // Security-Audit N9: DB_USER/DB_PASSWORD (volle DDL-Rechte) sind jetzt OPTIONAL -- der lang
  // laufende App-Prozess bekommt sie seit diesem Update gar nicht mehr (nur noch DB_RUNTIME_*,
  // siehe docker-compose.yml); nur der kurzlebige Migrations-Aufruf ("docker compose run ...
  // migrate.js") bekommt sie noch injiziert. createDb() in connection.ts wirft einen klaren
  // Fehler, wenn das für den jeweiligen Zweck (migrate/runtime) nötige Konto fehlt, statt mit
  // einer kryptischen mysql2-Fehlermeldung über eine undefinierte Verbindung zu scheitern.
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().min(1).optional(),
  DB_SSL_CA_PATH: z.string().min(1).optional(),
  // Nicht abschaltbar: z.coerce.boolean() machte aus einem leeren Wert "false" (keine
  // Zertifikatspruefung). Jeder andere Wert als "true" verhindert jetzt den Start.
  DB_SSL_REJECT_UNAUTHORIZED: z.preprocess(value => value === undefined || value === '' || value === true ? 'true' : value,
    z.literal('true', { message: 'DB_SSL_REJECT_UNAUTHORIZED darf nur "true" sein' })).transform(() => true),
  // Eingeschränktes DB-Konto für den Laufzeitbetrieb (nur SELECT/INSERT/UPDATE/DELETE, kein
  // ALTER/CREATE/DROP) -- für den normalen App-Betrieb jetzt die einzigen DB-Zugangsdaten, die
  // der App-Container überhaupt zu sehen bekommt.
  DB_RUNTIME_USER: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  DB_RUNTIME_PASSWORD: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),

  KEK_FILE_PATH: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),

  INSTALLATION_ID: z.string().uuid(),
  SCHEMA_VERSION: z.coerce.number().int().positive().default(1),

  // Security-Audit R-1: Fastify 5.12.5 behandelt eine reine Hop-Zahl absichtlich als "keinem
  // Proxy vertrauen" (fail-closed, siehe node_modules/fastify/lib/request.js
  // getTrustProxyFn) -- eine frühere Annahme, eine Zahl würde wie eine Hop-Anzahl funktionieren,
  // war mit dieser Fastify-Version falsch und führte dazu, dass ALLE Anfragen serverseitig wie
  // von der Caddy-IP kommend behandelt wurden (geteiltes Login-Rate-Limit für alle Benutzer).
  // Eine CIDR-Angabe (das Docker-Netz, in dem Caddy läuft) prüft dagegen korrekt nur die Adresse
  // des direkten Gegenübers. Leer/nicht gesetzt = kein Proxy vertrauen (sicherer Default).
  TRUSTED_PROXY_CIDR: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  OFFICE_PREVIEW_URL: z.string().url().optional(),
  WEBAUTHN_ORIGIN: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  ONLYOFFICE_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  ONLYOFFICE_JWT_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  UPDATE_SERVICE_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  UPDATE_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  SETUP_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(16).optional()),
  // Security-Audit R-21: Feste Basis-URL der Anwendung fuer den Outlook-OAuth-Callback -- verhindert,
  // dass ein manipulierter Host-Header eine abweichende redirect_uri erzeugt. Leer/fehlend = OAuth-
  // Callback nicht verfuegbar (Outlook-Integration gibt 409 zurueck, da creds fehlen); in der
  // Produktion sollte dies immer gesetzt sein, wenn die Outlook-Integration konfiguriert ist.
  PUBLIC_BASE_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  // Security-Audit B7: optionaler ClamAV-Virenscan für Anhänge (siehe domain/antivirus.ts).
  // Leer/fehlend = Scan deaktiviert.
  CLAMAV_HOST: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310)
}).refine(
  env => (env.DB_USER && env.DB_PASSWORD) || (env.DB_RUNTIME_USER && env.DB_RUNTIME_PASSWORD),
  { message: 'Weder DB_USER/DB_PASSWORD noch DB_RUNTIME_USER/DB_RUNTIME_PASSWORD gesetzt -- mindestens eines der beiden Kontopaare wird gebraucht.' }
).refine(
  env => env.NODE_ENV !== 'production' || !!env.DB_SSL_CA_PATH,
  { message: 'In Produktion ist DB_SSL_CA_PATH Pflicht -- die Datenbankverbindung muss TLS-verschluesselt sein.' }
);

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Wirft beim ersten fehlerhaften/fehlenden Wert -- der Prozess darf mit unvollständiger
// Konfiguration nicht hochfahren (verhindert "Start mit unsicherem Default").
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige/fehlende Konfiguration: ${details}`);
  }
  cached = parsed.data;
  return cached;
}
