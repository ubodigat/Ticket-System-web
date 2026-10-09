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

// SMTP-Konfiguration fuer echten E-Mail-Versand (Benachrichtigungen). Das Passwort wird wie jedes
// andere Secret AES-256-GCM-verschluesselt abgelegt (smtp_password_enc), nie im Klartext und nie
// ueber die API zurueckgegeben -- siehe settings.ts GET /api/v2/settings/smtp.
export const migration_0018_smtp_config: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings').addColumn('smtp_host', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_port', 'integer').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_secure', 'boolean').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_user', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_password_enc', 'varbinary(1024)').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_from', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('smtp_from_name', 'varchar(255)').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings').dropColumn('smtp_host').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_port').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_secure').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_user').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_password_enc').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_from').execute();
    await db.schema.alterTable('app_settings').dropColumn('smtp_from_name').execute();
  }
};
