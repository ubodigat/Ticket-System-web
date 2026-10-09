/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Brute-Force-Schutz: failed_login_count zählt aufeinanderfolgende Fehlversuche (Passwort
// ODER TOTP-Code); nach einer festen Schwelle setzt auth.ts locked_until serverseitig --
// vorher existierte die Spalte locked_until zwar im Schema, wurde aber nirgends beschrieben.
export const migration_0011_login_lockout: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable('users')
      .addColumn('failed_login_count', 'integer', col => col.notNull().defaultTo(0))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users').dropColumn('failed_login_count').execute();
  }
};
