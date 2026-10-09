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
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL_CA_PATH: z.string().min(1).optional(),
  DB_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),

  KEK_FILE_PATH: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),

  INSTALLATION_ID: z.string().uuid(),
  SCHEMA_VERSION: z.coerce.number().int().positive().default(1),

  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1)
});

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
