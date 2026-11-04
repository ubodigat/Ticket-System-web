/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/connection.js';
import { SchemaDriftError, syncSchema } from '../db/schemaSync.js';

// Bringt die Datenbank auf den Stand von db/schema.ts (Installer und Update rufen das auf, bevor die
// App startet). Braucht das volle DB_USER/DB_PASSWORD-Konto; vorhandene Daten bleiben unangetastet.
// "--check" zeigt nur an, was zu tun waere.
async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env, 'schema');
  try {
    if (process.argv.includes('--check')) {
      const { planSchemaSync } = await import('../db/schemaSync.js');
      const { steps, warnings } = await db.connection().execute(conn => planSchemaSync(conn));
      for (const step of steps) console.log(`ausstehend: ${step.label}`);
      for (const warning of warnings) console.log(`Hinweis: ${warning}`);
      console.log(steps.length ? `${steps.length} Schritt(e) ausstehend.` : 'Datenbank entspricht dem Schema.');
      return;
    }
    const report = await syncSchema(db, line => console.log(line));
    console.log(report.actions.length
      ? `Datenbank aktualisiert (${report.actions.length} Aenderung(en)), vorhandene Daten unveraendert.`
      : 'Datenbank war bereits auf dem aktuellen Stand.');
  } catch (error) {
    if (error instanceof SchemaDriftError) {
      console.error(error.message);
      console.error('Es wurde nichts geaendert. Bitte die genannten Spalten pruefen oder eine Sicherung einspielen.');
    } else {
      console.error('Datenbank konnte nicht vorbereitet werden:', error);
    }
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

await main();
