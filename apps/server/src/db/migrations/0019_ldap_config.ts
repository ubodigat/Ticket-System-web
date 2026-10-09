/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// LDAP-Konfiguration fuer optionalen Login per Verzeichnisdienst-Bind (Ergänzung, kein Ersatz
// fuer das lokale Passwort -- siehe auth/ldap.ts). Das Bind-Passwort des Service-Accounts ist
// wie jedes andere Secret AES-256-GCM-verschluesselt, nie im Klartext und nie ueber die API
// zurueckgegeben.
export const migration_0019_ldap_config: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings').addColumn('ldap_enabled', 'boolean', col => col.notNull().defaultTo(sql`false`)).execute();
    await db.schema.alterTable('app_settings').addColumn('ldap_url', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('ldap_bind_dn', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('ldap_bind_password_enc', 'varbinary(1024)').execute();
    await db.schema.alterTable('app_settings').addColumn('ldap_base_dn', 'varchar(255)').execute();
    await db.schema.alterTable('app_settings').addColumn('ldap_user_filter', 'varchar(255)').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings').dropColumn('ldap_enabled').execute();
    await db.schema.alterTable('app_settings').dropColumn('ldap_url').execute();
    await db.schema.alterTable('app_settings').dropColumn('ldap_bind_dn').execute();
    await db.schema.alterTable('app_settings').dropColumn('ldap_bind_password_enc').execute();
    await db.schema.alterTable('app_settings').dropColumn('ldap_base_dn').execute();
    await db.schema.alterTable('app_settings').dropColumn('ldap_user_filter').execute();
  }
};
