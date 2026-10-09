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

// Vorgesetzte Person -- genutzt vom automatischen Genehmigungsworkflow (Ticket mit bestimmter
// Priorität löst automatisch eine Genehmigungsanfrage an die Vorgesetzte Person aus, siehe
// tickets.ts POST /api/v2/tickets und settings.ts config.approvalWorkflow).
export const migration_0017_user_supervisor: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users').addColumn('supervisor_user_id', 'char(36)').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users').dropColumn('supervisor_user_id').execute();
  }
};
