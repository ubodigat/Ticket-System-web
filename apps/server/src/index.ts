/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { loadEnv } from './config/env.js';
import { createDb } from './db/connection.js';
import { createFileKeyProvider } from './crypto/keyProvider.js';
import { buildApp } from './http/app.js';
import { startMaintenanceScheduler } from './jobs/maintenance.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const keyProvider = createFileKeyProvider(env.KEK_FILE_PATH);
  const app = await buildApp({ env, db, keyProvider });

  // Siehe jobs/maintenance.ts: einfacher In-Prozess-Timer statt echter Job-Queue -- korrekt für
  // genau eine laufende Instanz, nicht für horizontale Skalierung.
  const maintenanceTimer = startMaintenanceScheduler({ db, env, keyProvider });

  const closeGracefully = async (signal: string): Promise<void> => {
    app.log.info(`${signal} empfangen, fahre herunter...`);
    clearInterval(maintenanceTimer);
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void closeGracefully('SIGTERM'));
  process.on('SIGINT', () => void closeGracefully('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch(err => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
