/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import { loadEnv } from '../config/env.js';
import { createDb } from './connection.js';
import { migration_0001_installations } from './migrations/0001_installations.js';
import { migration_0002_key_management } from './migrations/0002_key_management.js';
import { migration_0003_users_and_groups } from './migrations/0003_users_and_groups.js';
import { migration_0004_jobs_and_rate_limit } from './migrations/0004_jobs_and_rate_limit.js';
import { migration_0005_app_settings } from './migrations/0005_app_settings.js';
import { migration_0008_full_schema } from './migrations/0008_full_schema.js';
import { migration_0009_categories_absence_time } from './migrations/0009_categories_absence_time.js';
import { migration_0010_mfa } from './migrations/0010_mfa.js';
import { migration_0011_login_lockout } from './migrations/0011_login_lockout.js';
import { migration_0012_ticket_todos } from './migrations/0012_ticket_todos.js';
import { migration_0013_incident_notice } from './migrations/0013_incident_notice.js';
import { migration_0014_ticket_participants } from './migrations/0014_ticket_participants.js';
import { migration_0015_ticket_filed_by } from './migrations/0015_ticket_filed_by.js';
import { migration_0016_ticket_waiting } from './migrations/0016_ticket_waiting.js';
import { migration_0017_user_supervisor } from './migrations/0017_user_supervisor.js';
import { migration_0018_smtp_config } from './migrations/0018_smtp_config.js';
import { migration_0019_ldap_config } from './migrations/0019_ldap_config.js';
import { migration_0020_ticket_relations } from './migrations/0020_ticket_relations.js';
import { migration_0021_user_department } from './migrations/0021_user_department.js';
import { migration_0022_ticket_archived_author_ack } from './migrations/0022_ticket_archived_author_ack.js';
import { migration_0023_kb_article_attachments } from './migrations/0023_kb_article_attachments.js';
import { migration_0024_user_permissions } from './migrations/0024_user_permissions.js';

// Programmatischer MigrationProvider statt dateisystembasiertem Scan -- Reihenfolge ist
// explizit und versioniert, nicht abhängig von Dateinamens-Sortierung zur Laufzeit.
const migrations: Record<string, Migration> = {
  '0001_installations': migration_0001_installations,
  '0002_key_management': migration_0002_key_management,
  '0003_users_and_groups': migration_0003_users_and_groups,
  '0004_jobs_and_rate_limit': migration_0004_jobs_and_rate_limit,
  '0005_app_settings': migration_0005_app_settings,
  '0008_full_schema': migration_0008_full_schema,
  '0009_categories_absence_time': migration_0009_categories_absence_time,
  '0010_mfa': migration_0010_mfa,
  '0011_login_lockout': migration_0011_login_lockout,
  '0012_ticket_todos': migration_0012_ticket_todos,
  '0013_incident_notice': migration_0013_incident_notice,
  '0014_ticket_participants': migration_0014_ticket_participants,
  '0015_ticket_filed_by': migration_0015_ticket_filed_by,
  '0016_ticket_waiting': migration_0016_ticket_waiting,
  '0017_user_supervisor': migration_0017_user_supervisor,
  '0018_smtp_config': migration_0018_smtp_config,
  '0019_ldap_config': migration_0019_ldap_config,
  '0020_ticket_relations': migration_0020_ticket_relations,
  '0021_user_department': migration_0021_user_department,
  '0022_ticket_archived_author_ack': migration_0022_ticket_archived_author_ack,
  '0023_kb_article_attachments': migration_0023_kb_article_attachments,
  '0024_user_permissions': migration_0024_user_permissions
};

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  }
};

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const migrator = new Migrator({ db, provider });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`Migration erfolgreich: ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`Migration fehlgeschlagen: ${result.migrationName}`);
    }
  }

  await db.destroy();

  if (error) {
    console.error('Migration abgebrochen.', error);
    process.exit(1);
  }
  console.log('Alle Migrationen auf dem neuesten Stand.');
}

main().catch(err => {
  console.error('Unerwarteter Fehler bei der Migration:', err);
  process.exit(1);
});
