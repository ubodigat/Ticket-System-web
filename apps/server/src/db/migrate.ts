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
import { createFileKeyProvider } from '../crypto/keyProvider.js';
import { reencryptLegacyPlaintext } from './reencryptLegacy.js';
import { migrateMailSecrets } from '../mail/secrets.js';
import { migration_0041_mail_secrets } from './migrations/0041_mail_secrets.js';
import { migration_0042_notification_identity } from './migrations/0042_notification_identity.js';
import { migration_0043_encryption_checkpoints } from './migrations/0043_encryption_checkpoints.js';
import { migration_0044_contact_ciphertext_capacity } from './migrations/0044_contact_ciphertext_capacity.js';
import { migration_0045_account_valid_until } from './migrations/0045_account_valid_until.js';
import { migration_0046_login_failure_sources } from './migrations/0046_login_failure_sources.js';
import { migration_0047_audit_log_redact } from './migrations/0047_audit_log_redact.js';
import { migration_0048_outlook_personal_calendar } from './migrations/0048_outlook_personal_calendar.js';
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
import { migration_0025_app_settings_config_mediumtext } from './migrations/0025_app_settings_config_mediumtext.js';
import { migration_0026_user_notification_preferences } from './migrations/0026_user_notification_preferences.js';
import { migration_0027_admin_todos } from './migrations/0027_admin_todos.js';
import { migration_0028_recurring_admin_todos } from './migrations/0028_recurring_admin_todos.js';
import { migration_0029_user_contact_fields } from './migrations/0029_user_contact_fields.js';
import { migration_0030_mfa_pending_secret } from './migrations/0030_mfa_pending_secret.js';
import { migration_0031_totp_replay_protection } from './migrations/0031_totp_replay_protection.js';
import { migration_0032_session_idle_timeout } from './migrations/0032_session_idle_timeout.js';
import { migration_0033_ldap_per_account_optin } from './migrations/0033_ldap_per_account_optin.js';
import { migration_0034_encrypt_approval_waiting_text } from './migrations/0034_encrypt_approval_waiting_text.js';
import { migration_0035_encrypt_contact_fields } from './migrations/0035_encrypt_contact_fields.js';
import { migration_0036_todo_completed_at } from './migrations/0036_todo_completed_at.js';
import { migration_0037_outlook_calendar_events } from './migrations/0037_outlook_calendar_events.js';
import { migration_0038_encrypt_recurring_rules } from './migrations/0038_encrypt_recurring_rules.js';
import { migration_0039_encrypt_account_request_text } from './migrations/0039_encrypt_account_request_text.js';
import { migration_0040_encrypt_ticket_custom_fields } from './migrations/0040_encrypt_ticket_custom_fields.js';

// Programmatischer MigrationProvider statt dateisystembasiertem Scan -- Reihenfolge ist
// explizit und versioniert, nicht abhängig von Dateinamens-Sortierung zur Laufzeit.
import { migration_0049_chunked_uploads } from './migrations/0049_chunked_uploads.js';
import { migration_0050_personal_workspace } from './migrations/0050_personal_workspace.js';
import { migration_0051_passkeys } from './migrations/0051_passkeys.js';
const migrations: Record<string, Migration> = {
  '0051_passkeys': migration_0051_passkeys,
  '0050_personal_workspace': migration_0050_personal_workspace,
  '0049_chunked_uploads': migration_0049_chunked_uploads,
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
  '0024_user_permissions': migration_0024_user_permissions,
  '0025_app_settings_config_mediumtext': migration_0025_app_settings_config_mediumtext,
  '0026_user_notification_preferences': migration_0026_user_notification_preferences,
  '0027_admin_todos': migration_0027_admin_todos,
  '0028_recurring_admin_todos': migration_0028_recurring_admin_todos,
  '0029_user_contact_fields': migration_0029_user_contact_fields,
  '0030_mfa_pending_secret': migration_0030_mfa_pending_secret,
  '0031_totp_replay_protection': migration_0031_totp_replay_protection,
  '0032_session_idle_timeout': migration_0032_session_idle_timeout,
  '0033_ldap_per_account_optin': migration_0033_ldap_per_account_optin,
  '0034_encrypt_approval_waiting_text': migration_0034_encrypt_approval_waiting_text,
  '0035_encrypt_contact_fields': migration_0035_encrypt_contact_fields,
  '0036_todo_completed_at': migration_0036_todo_completed_at,
  '0037_outlook_calendar_events': migration_0037_outlook_calendar_events,
  '0038_encrypt_recurring_rules': migration_0038_encrypt_recurring_rules,
  '0039_encrypt_account_request_text': migration_0039_encrypt_account_request_text,
  '0040_encrypt_ticket_custom_fields': migration_0040_encrypt_ticket_custom_fields,
  '0041_mail_secrets': migration_0041_mail_secrets,
  '0042_notification_identity': migration_0042_notification_identity,
  '0043_encryption_checkpoints': migration_0043_encryption_checkpoints,
  '0044_contact_ciphertext_capacity': migration_0044_contact_ciphertext_capacity,
  '0045_account_valid_until': migration_0045_account_valid_until,
  '0046_login_failure_sources': migration_0046_login_failure_sources,
  '0047_audit_log_redact': migration_0047_audit_log_redact,
  '0048_outlook_personal_calendar': migration_0048_outlook_personal_calendar
};

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  }
};

async function main(): Promise<void> {
  const env = loadEnv();
  // Security-Audit N9: Migrationen brauchen DDL-Rechte (ALTER/CREATE TABLE) -- immer das volle
  // DB_USER/DB_PASSWORD-Konto, nie das eingeschränkte Laufzeit-Konto.
  const db = createDb(env, 'migrate');
  const migrator = new Migrator({ db, provider });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`Migration erfolgreich: ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`Migration fehlgeschlagen: ${result.migrationName}`);
    }
  }

  if (error) {
    await db.destroy();
    console.error('Migration abgebrochen.', error);
    process.exit(1);
  }
  console.log('Alle Migrationen auf dem neuesten Stand.');

  // Security-Audit R-2: läuft bei JEDER Ausführung von migrate.js (neue und bestehende
  // Installationen) -- idempotent, erkennt und überspringt bereits verschlüsselte Werte. Schließt
  // die Lücke, dass 0034/0035 den Spaltentyp umgestellt, aber vorhandene Klartextwerte nie
  // tatsächlich verschlüsselt hatten (siehe reencryptLegacy.ts). Läuft bewusst NACH
  // migrateToLatest(), damit die Spalten bereits den neuen (verschlüsselten) Typ haben.
  try {
    const keyProvider = createFileKeyProvider(env.KEK_FILE_PATH);
    await migrateMailSecrets({ db, env, keyProvider });
    const { reencrypted, checked } = await reencryptLegacyPlaintext(db, env, keyProvider);
    if (reencrypted > 0) {
      console.log(`Altwerte nachtraeglich verschluesselt: ${reencrypted} von ${checked} geprueften Werten (Security-Audit R-2).`);
    }
  } catch (err) {
    // Do not deploy with partially migrated plaintext or failed authentication checks.
    console.error('Nachtraegliche Verschluesselung von Altwerten fehlgeschlagen (R-2) -- bitte manuell pruefen/erneut ausfuehren:', err);
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
}

main().catch(err => {
  console.error('Unerwarteter Fehler bei der Migration:', err);
  process.exit(1);
});
