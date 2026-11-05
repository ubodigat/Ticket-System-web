/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Das vollstaendige Datenbankschema an einer Stelle -- es gibt keine Migrationsdateien.
// db/schemaSync.ts gleicht eine Datenbank damit ab: fehlende Tabellen, Spalten, Indizes und
// Fremdschluessel werden angelegt, Spalten nur verlustfrei erweitert, nie etwas geloescht.
// Eine Aenderung am Schema ist eine Aenderung an dieser Datei; der naechste Installer- oder
// Update-Lauf bringt jede bestehende Datenbank auf diesen Stand, ohne vorhandene Daten anzutasten.

export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

export interface IndexDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface ForeignKeyDefinition {
  readonly columns: readonly string[];
  readonly references: string;
  readonly referencedColumns: readonly string[];
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export interface TableDefinition {
  readonly name: string;
  // [Spaltenname, SQL-Definition ohne Namen]
  readonly columns: readonly (readonly [string, string])[];
  readonly primaryKey: readonly string[];
  readonly indexes?: readonly IndexDefinition[];
  readonly foreignKeys?: readonly ForeignKeyDefinition[];
}

// Pflichtzeilen, die jede Installation braucht (idempotent per INSERT IGNORE).
export const SEED_ROWS: readonly { readonly table: string; readonly values: Readonly<Record<string, string | number>> }[] = [
  { table: 'app_settings', values: { id: 1, company_name: '', portal_name: '' } }
];

// Tabellen frueherer Versionen, die keine Daten mehr tragen und beim Abgleich entfernt werden.
export const OBSOLETE_TABLES: readonly string[] = ['kysely_migration', 'kysely_migration_lock', 'encryption_checkpoints'];

export const TABLES: readonly TableDefinition[] = [
  {
    name: 'account_requests',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['name', 'varbinary(1024) NOT NULL'],
      ['email', 'varbinary(1024) NOT NULL'],
      ['company', 'varbinary(2048) DEFAULT NULL'],
      ['reason', 'mediumblob DEFAULT NULL'],
      ['status', 'varchar(32) NOT NULL DEFAULT \'pending\''],
      ['reviewed_by_user_id', 'char(36) DEFAULT NULL'],
      ['installation_id', 'char(36) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'admin_todo_members',
    columns: [
      ['todo_id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['hidden', 'tinyint(1) NOT NULL DEFAULT 0']
    ],
    primaryKey: ['todo_id', 'user_id'],
    indexes: [
      { name: 'admin_todo_member_user_idx', columns: ['user_id', 'hidden'] }
    ],
    foreignKeys: [
      { columns: ['todo_id'], references: 'admin_todos', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'admin_todos',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['due_at', 'datetime DEFAULT NULL'],
      ['done', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['done_at', 'timestamp NULL DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'created_by_user_id', columns: ['created_by_user_id'] }
    ],
    foreignKeys: [
      { columns: ['created_by_user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' }
    ]
  },
  {
    name: 'app_settings',
    columns: [
      ['id', 'int(11) NOT NULL'],
      ['company_name', 'varchar(255) NOT NULL DEFAULT \'\''],
      ['portal_name', 'varchar(255) NOT NULL DEFAULT \'\''],
      ['setup_completed_at', 'timestamp NULL DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['config_json', 'mediumtext DEFAULT NULL'],
      ['smtp_host', 'varchar(255) DEFAULT NULL'],
      ['smtp_port', 'int(11) DEFAULT NULL'],
      ['smtp_secure', 'tinyint(1) DEFAULT NULL'],
      ['smtp_user', 'varchar(255) DEFAULT NULL'],
      ['smtp_password_enc', 'varbinary(1024) DEFAULT NULL'],
      ['smtp_from', 'varchar(255) DEFAULT NULL'],
      ['smtp_from_name', 'varchar(255) DEFAULT NULL'],
      ['ldap_enabled', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['ldap_url', 'varchar(255) DEFAULT NULL'],
      ['ldap_bind_dn', 'varchar(255) DEFAULT NULL'],
      ['ldap_bind_password_enc', 'varbinary(1024) DEFAULT NULL'],
      ['ldap_base_dn', 'varchar(255) DEFAULT NULL'],
      ['ldap_user_filter', 'varchar(255) DEFAULT NULL'],
      ['outlook_client_secret_enc', 'varbinary(2048) DEFAULT NULL'],
      ['mail_secrets_enc', 'mediumblob DEFAULT NULL']
    ],
    primaryKey: ['id']
  },
  {
    name: 'attachments',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) DEFAULT NULL'],
      ['message_id', 'char(36) DEFAULT NULL'],
      ['note_id', 'char(36) DEFAULT NULL'],
      ['uploaded_by_user_id', 'char(36) DEFAULT NULL'],
      ['uploaded_by_username', 'varchar(64) NOT NULL'],
      ['filename', 'varbinary(1024) NOT NULL'],
      ['mime_type', 'varchar(255) NOT NULL'],
      ['size_bytes', 'int(11) NOT NULL'],
      ['data_b64', 'longblob NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'categories',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['name', 'varchar(128) NOT NULL'],
      ['auto_assign_group_id', 'char(36) DEFAULT NULL'],
      ['custom_fields_json', 'text DEFAULT NULL'],
      ['locked', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['archived', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      // Kachel in der Themenleiste des Benutzer-Dashboards ("Wie koennen wir helfen?").
      ['show_in_portal', 'tinyint(1) NOT NULL DEFAULT 1'],
      // Schnelle Tipps (F&A) vor dem Ticketformular, siehe domain/categoryFaq.ts.
      ['faq_json', 'mediumtext DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'name', columns: ['name'], unique: true }
    ]
  },
  {
    name: 'crypto_jobs',
    columns: [
      ['job_key', 'varchar(191) NOT NULL'],
      ['last_id', 'varchar(255) DEFAULT NULL'],
      ['processed', 'int(11) NOT NULL DEFAULT 0'],
      ['failed', 'int(11) NOT NULL DEFAULT 0'],
      ['target_version', 'int(11) NOT NULL DEFAULT 0'],
      ['done_at', 'timestamp NULL DEFAULT NULL'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()']
    ],
    primaryKey: ['job_key']
  },
  {
    name: 'data_encryption_keys',
    columns: [
      ['id', 'int(11) NOT NULL AUTO_INCREMENT'],
      ['purpose', 'varchar(128) NOT NULL'],
      ['key_version', 'int(11) NOT NULL'],
      ['wrapped_dek', 'varbinary(255) NOT NULL'],
      ['active', 'tinyint(1) NOT NULL DEFAULT 1'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['kek_version', 'int(11) NOT NULL DEFAULT 1'],
      ['wrap_format', 'tinyint(4) NOT NULL DEFAULT 0']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'uq_dek_purpose_version', columns: ['purpose', 'key_version'], unique: true }
    ]
  },
  {
    name: 'file_upload_chunks',
    columns: [
      ['upload_id', 'char(36) NOT NULL'],
      ['part', 'int(11) NOT NULL'],
      ['data_enc', 'longblob NOT NULL']
    ],
    primaryKey: ['upload_id', 'part'],
    foreignKeys: [
      { columns: ['upload_id'], references: 'file_uploads', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'file_uploads',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['owner_user_id', 'char(36) DEFAULT NULL'],
      ['ticket_id', 'char(36) DEFAULT NULL'],
      ['article_id', 'char(36) DEFAULT NULL'],
      ['filename', 'blob NOT NULL'],
      ['mime_type', 'varchar(255) NOT NULL'],
      ['size_bytes', 'int(11) NOT NULL'],
      ['received_bytes', 'int(11) NOT NULL DEFAULT 0'],
      ['completed', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['message_id', 'char(36) DEFAULT NULL'],
      ['note_id', 'char(36) DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] },
      { name: 'article_id', columns: ['article_id'] },
      { name: 'file_uploads_owner_created', columns: ['owner_user_id', 'created_at'] }
    ],
    foreignKeys: [
      { columns: ['owner_user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' },
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['article_id'], references: 'kb_articles', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'global_audit_log',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['actor_user_id', 'char(36) DEFAULT NULL'],
      ['actor_username', 'varchar(64) NOT NULL'],
      ['action', 'varchar(128) NOT NULL'],
      ['target_type', 'varchar(64) DEFAULT NULL'],
      ['target_id', 'varchar(128) DEFAULT NULL'],
      ['detail_json', 'text DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_global_audit_log_created', columns: ['created_at', 'id'] }
    ]
  },
  {
    name: 'groups',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['name', 'varchar(128) NOT NULL'],
      ['is_default', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['parent_id', 'char(36) DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'fk_groups_parent', columns: ['parent_id'] }
    ],
    foreignKeys: [
      { columns: ['parent_id'], references: 'groups', referencedColumns: ['id'], onDelete: 'SET NULL' }
    ]
  },
  {
    name: 'installations',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'job_dead_letter',
    columns: [
      ['id', 'int(11) NOT NULL AUTO_INCREMENT'],
      ['job_id', 'int(11) NOT NULL'],
      ['type', 'varchar(64) NOT NULL'],
      ['payload_json', 'longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`))'],
      ['last_error', 'text NOT NULL'],
      ['attempts', 'int(11) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'jobs',
    columns: [
      ['id', 'int(11) NOT NULL AUTO_INCREMENT'],
      ['type', 'varchar(64) NOT NULL'],
      ['payload_json', 'longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`))'],
      ['status', 'varchar(16) NOT NULL DEFAULT \'queued\''],
      ['attempts', 'int(11) NOT NULL DEFAULT 0'],
      ['max_attempts', 'int(11) NOT NULL DEFAULT 5'],
      ['idempotency_key', 'varchar(255) NOT NULL'],
      ['run_after', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['locked_by', 'varchar(64) DEFAULT NULL'],
      ['locked_at', 'timestamp NULL DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idempotency_key', columns: ['idempotency_key'], unique: true },
      { name: 'idx_jobs_status_run_after', columns: ['status', 'run_after'] }
    ]
  },
  {
    name: 'kb_article_attachments',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['kb_article_id', 'char(36) NOT NULL'],
      ['uploaded_by_user_id', 'char(36) DEFAULT NULL'],
      ['uploaded_by_username', 'varchar(64) NOT NULL'],
      ['filename', 'varbinary(1024) NOT NULL'],
      ['mime_type', 'varchar(255) NOT NULL'],
      ['size_bytes', 'int(11) NOT NULL'],
      ['data_b64', 'longblob NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'kb_article_attachments_article_idx', columns: ['kb_article_id'] }
    ],
    foreignKeys: [
      { columns: ['kb_article_id'], references: 'kb_articles', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'kb_articles',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['title', 'varbinary(1024) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['source_ticket_id', 'char(36) DEFAULT NULL'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['category', 'varchar(128) DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_kb_articles_category', columns: ['category'] }
    ]
  },
  {
    name: 'kb_categories',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['name', 'varchar(128) NOT NULL'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'name', columns: ['name'], unique: true }
    ]
  },
  {
    name: 'key_rotation_log',
    columns: [
      ['id', 'int(11) NOT NULL AUTO_INCREMENT'],
      ['purpose', 'varchar(128) NOT NULL'],
      ['old_key_version', 'int(11) DEFAULT NULL'],
      ['new_key_version', 'int(11) NOT NULL'],
      ['reason', 'varchar(255) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'list_views',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['name', 'varchar(255) NOT NULL'],
      ['owner_user_id', 'char(36) NOT NULL'],
      ['filters_json', 'text NOT NULL'],
      ['is_shared', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'login_failure_sources',
    columns: [
      ['user_id', 'char(36) NOT NULL'],
      ['source_prefix', 'varchar(64) NOT NULL'],
      ['failure_count', 'int(11) NOT NULL DEFAULT 0'],
      ['locked_until', 'timestamp NULL DEFAULT NULL'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['user_id', 'source_prefix'],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'mfa_devices',
    columns: [
      ['token_hash', 'char(64) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['verified_at', 'datetime NOT NULL']
    ],
    primaryKey: ['token_hash'],
    indexes: [
      { name: 'user_id', columns: ['user_id'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'mfa_flows',
    columns: [
      ['token_hash', 'char(64) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['purpose', 'varchar(16) NOT NULL'],
      ['state_json', 'text NOT NULL'],
      ['expires_at', 'datetime NOT NULL']
    ],
    primaryKey: ['token_hash'],
    indexes: [
      { name: 'user_id', columns: ['user_id'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'mfa_recovery_codes',
    columns: [
      ['user_id', 'char(36) NOT NULL'],
      ['code_hash', 'char(64) NOT NULL']
    ],
    primaryKey: ['user_id', 'code_hash'],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'notifications',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['recipient_user_id', 'char(36) DEFAULT NULL'],
      ['recipient_username', 'varchar(64) NOT NULL'],
      ['type', 'varchar(64) NOT NULL'],
      ['ticket_id', 'char(36) DEFAULT NULL'],
      ['ticket_number', 'varchar(32) DEFAULT NULL'],
      ['message', 'mediumblob DEFAULT NULL'],
      ['is_read', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'fk_notification_recipient', columns: ['recipient_user_id'] }
    ],
    foreignKeys: [
      { columns: ['recipient_user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'rate_limit_counters',
    columns: [
      ['rate_key', 'varchar(255) NOT NULL'],
      ['window_start', 'timestamp NOT NULL'],
      ['count', 'int(11) NOT NULL DEFAULT 1']
    ],
    primaryKey: ['rate_key', 'window_start']
  },
  {
    name: 'recurring_admin_todos',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['created_by_user_id', 'char(36) NOT NULL'],
      ['recipient_ids_json', 'text NOT NULL'],
      ['interval_unit', 'varchar(10) NOT NULL'],
      ['interval_count', 'int(11) NOT NULL'],
      ['due_after_hours', 'int(11) DEFAULT NULL'],
      ['next_run_at', 'datetime NOT NULL'],
      ['active', 'tinyint(1) NOT NULL DEFAULT 1'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'created_by_user_id', columns: ['created_by_user_id'] },
      { name: 'recurring_admin_todos_due', columns: ['active', 'next_run_at'] }
    ],
    foreignKeys: [
      { columns: ['created_by_user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'recurring_ticket_rules',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['title', 'varbinary(2048) DEFAULT NULL'],
      ['description', 'mediumblob DEFAULT NULL'],
      ['category', 'varchar(128) DEFAULT NULL'],
      ['priority', 'varchar(32) NOT NULL DEFAULT \'Normal\''],
      ['interval_unit', 'varchar(16) NOT NULL'],
      ['interval_count', 'int(11) NOT NULL DEFAULT 1'],
      ['next_run_at', 'timestamp NOT NULL'],
      ['active', 'tinyint(1) NOT NULL DEFAULT 1'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'schema_state',
    columns: [
      ['id', 'int(11) NOT NULL'],
      ['fingerprint', 'char(64) NOT NULL'],
      ['applied_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'sessions',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['user_agent', 'varchar(512) DEFAULT NULL'],
      ['ip_address', 'varchar(64) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['expires_at', 'timestamp NOT NULL'],
      ['revoked_at', 'timestamp NULL DEFAULT NULL'],
      ['last_seen_at', 'timestamp NULL DEFAULT NULL']
    ],
    primaryKey: ['id']
  },
  {
    name: 'text_blocks',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['title', 'varchar(255) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id']
  },
  {
    name: 'ticket_approvals',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['requested_by_user_id', 'char(36) DEFAULT NULL'],
      ['requested_by_username', 'varchar(255) DEFAULT NULL'],
      ['approver_user_id', 'char(36) DEFAULT NULL'],
      ['approver_username', 'varchar(255) DEFAULT NULL'],
      ['request_text_enc', 'mediumblob DEFAULT NULL'],
      ['status', 'varchar(16) NOT NULL DEFAULT \'pending\''],
      ['decided_by_user_id', 'char(36) DEFAULT NULL'],
      ['decided_by_username', 'varchar(255) DEFAULT NULL'],
      ['decision_text_enc', 'mediumblob DEFAULT NULL'],
      ['requested_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['decided_at', 'datetime DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_ticket_approvals_ticket', columns: ['ticket_id', 'requested_at'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_audit_log',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['actor_user_id', 'char(36) DEFAULT NULL'],
      ['actor_username', 'varchar(64) NOT NULL'],
      ['action', 'varchar(128) NOT NULL'],
      ['field', 'varchar(64) DEFAULT NULL'],
      ['old_value', 'text DEFAULT NULL'],
      ['new_value', 'text DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_calendar_events',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['graph_event_id', 'varchar(512) NOT NULL'],
      ['web_link', 'varchar(1024) DEFAULT NULL'],
      ['subject', 'varchar(512) NOT NULL'],
      ['start_at', 'datetime NOT NULL'],
      ['end_at', 'datetime NOT NULL'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'created_by_user_id', columns: ['created_by_user_id'] },
      { name: 'ticket_calendar_events_ticket_idx', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['created_by_user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' }
    ]
  },
  {
    name: 'ticket_kb_links',
    columns: [
      ['ticket_id', 'char(36) NOT NULL'],
      ['article_id', 'char(36) NOT NULL'],
      ['linked_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['ticket_id', 'article_id'],
    indexes: [
      { name: 'idx_ticket_kb_links_article', columns: ['article_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['article_id'], references: 'kb_articles', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_messages',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['sender_user_id', 'char(36) DEFAULT NULL'],
      ['sender_username', 'varchar(64) NOT NULL'],
      ['sender_name', 'varchar(255) NOT NULL'],
      ['sender_role', 'varchar(16) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['content_html', 'mediumblob DEFAULT NULL'],
      ['has_attachments', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['edited_at', 'timestamp NULL DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_notes',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['author_user_id', 'char(36) DEFAULT NULL'],
      ['author_username', 'varchar(64) NOT NULL'],
      ['author_name', 'varchar(255) NOT NULL'],
      ['stream', 'varchar(32) NOT NULL'],
      ['note_type', 'varchar(64) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['is_pinned', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['is_resolution', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['has_attachments', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['edited_at', 'timestamp NULL DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_participants',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['username', 'varchar(64) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_ticket_participants_unique', columns: ['ticket_id', 'user_id'], unique: true },
      { name: 'idx_ticket_participants_ticket', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_relations',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['related_ticket_id', 'char(36) NOT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_ticket_relations_unique', columns: ['ticket_id', 'related_ticket_id'], unique: true },
      { name: 'idx_ticket_relations_ticket', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_time_entries',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) DEFAULT NULL'],
      ['username', 'varchar(64) NOT NULL'],
      ['minutes', 'int(11) NOT NULL'],
      ['note', 'varchar(512) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['note_enc', 'mediumblob DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_todos',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) NOT NULL'],
      ['content', 'mediumblob NOT NULL'],
      ['assignee_user_id', 'char(36) DEFAULT NULL'],
      ['assignee_username', 'varchar(64) DEFAULT NULL'],
      ['done', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['done_at', 'timestamp NULL DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_ticket_todos_ticket', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'ticket_work_timers',
    columns: [
      ['user_id', 'char(36) NOT NULL'],
      ['id', 'char(36) NOT NULL'],
      ['ticket_id', 'char(36) DEFAULT NULL'],
      ['todo_id', 'char(36) DEFAULT NULL'],
      ['started_at', 'datetime NOT NULL'],
      ['stopped_at', 'datetime DEFAULT NULL']
    ],
    primaryKey: ['user_id'],
    indexes: [
      { name: 'id', columns: ['id'], unique: true },
      { name: 'ticket_id', columns: ['ticket_id'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['ticket_id'], references: 'tickets', referencedColumns: ['id'] },
      { columns: ['todo_id'], references: 'admin_todos', referencedColumns: ['id'] }
    ]
  },
  {
    name: 'admin_todo_time_entries',
    columns: [
      ['id', 'char(36) NOT NULL'], ['todo_id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) DEFAULT NULL'], ['username', 'varchar(64) NOT NULL'],
      ['minutes', 'int NOT NULL'], ['note_enc', 'mediumblob DEFAULT NULL'],
      ['created_at', 'datetime NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [{ name: 'todo_time_idx', columns: ['todo_id', 'created_at'] }],
    foreignKeys: [
      { columns: ['todo_id'], references: 'admin_todos', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' }
    ]
  },
  {
    name: 'tickets',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['ticket_number', 'varchar(32) NOT NULL'],
      ['title', 'varbinary(1024) NOT NULL'],
      ['description', 'mediumblob NOT NULL'],
      ['status', 'varchar(64) NOT NULL DEFAULT \'Neu\''],
      ['priority', 'varchar(32) NOT NULL DEFAULT \'Normal\''],
      ['category', 'varchar(128) DEFAULT NULL'],
      ['type', 'varchar(32) NOT NULL DEFAULT \'ticket\''],
      ['created_by_user_id', 'char(36) DEFAULT NULL'],
      ['created_by_username', 'varchar(64) NOT NULL'],
      ['assigned_to_user_id', 'char(36) DEFAULT NULL'],
      ['assigned_to_username', 'varchar(64) DEFAULT NULL'],
      ['assigned_group_id', 'char(36) DEFAULT NULL'],
      ['sla_due_at', 'datetime DEFAULT NULL'],
      ['custom_due_at', 'datetime DEFAULT NULL'],
      ['archived_at', 'datetime DEFAULT NULL'],
      ['closed_at', 'datetime DEFAULT NULL'],
      ['approval_status', 'varchar(32) DEFAULT NULL'],
      ['approval_requested_by', 'varchar(64) DEFAULT NULL'],
      ['approval_text', 'mediumblob DEFAULT NULL'],
      ['approval_reviewer_id', 'char(36) DEFAULT NULL'],
      ['incident_id', 'char(36) DEFAULT NULL'],
      ['custom_fields_json', 'mediumblob DEFAULT NULL'],
      ['installation_id', 'char(36) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['incident_notice', 'varbinary(2048) DEFAULT NULL'],
      ['filed_by_user_id', 'char(36) DEFAULT NULL'],
      ['filed_by_username', 'varchar(64) DEFAULT NULL'],
      ['waiting_since', 'timestamp NULL DEFAULT NULL'],
      ['waiting_message', 'mediumblob DEFAULT NULL'],
      ['waiting_reminder_sent', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['merged_into_ticket_id', 'char(36) DEFAULT NULL'],
      ['archived_author_ack', 'tinyint(1) NOT NULL DEFAULT 0'],
      // Angaben der anfragenden Person (1..3): wer betroffen ist und wie dringend es ist.
      ['impact', 'tinyint(1) DEFAULT NULL'],
      ['urgency', 'tinyint(1) DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'ticket_number', columns: ['ticket_number'], unique: true }
    ]
  },
  {
    name: 'user_absences',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['active', 'tinyint(1) NOT NULL DEFAULT 1'],
      ['from_at', 'timestamp NULL DEFAULT NULL'],
      ['until_at', 'timestamp NULL DEFAULT NULL'],
      ['substitute_user_id', 'char(36) DEFAULT NULL'],
      ['visible', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['ended_at', 'timestamp NULL DEFAULT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_user_absences_user_active', columns: ['user_id', 'active'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'user_groups',
    columns: [
      ['user_id', 'char(36) NOT NULL'],
      ['group_id', 'char(36) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['user_id', 'group_id'],
    indexes: [
      { name: 'idx_user_groups_group', columns: ['group_id'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' },
      { columns: ['group_id'], references: 'groups', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'user_passkeys',
    columns: [
      ['id', 'varchar(700) CHARACTER SET ascii COLLATE ascii_bin NOT NULL'],
      ['user_id', 'char(36) NOT NULL'],
      ['public_key', 'blob NOT NULL'],
      ['counter', 'bigint(20) NOT NULL'],
      ['label', 'varchar(100) NOT NULL'],
      ['transports_json', 'text NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'user_id', columns: ['user_id'] }
    ],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'user_preferences',
    columns: [
      ['user_id', 'char(36) NOT NULL'],
      ['value_enc', 'mediumblob NOT NULL']
    ],
    primaryKey: ['user_id'],
    foreignKeys: [
      { columns: ['user_id'], references: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }
    ]
  },
  {
    name: 'users',
    columns: [
      ['id', 'char(36) NOT NULL'],
      ['username', 'varchar(64) NOT NULL'],
      ['name_enc', 'varbinary(1024) NOT NULL'],
      ['email_enc', 'varbinary(1024) NOT NULL'],
      ['email_blind_idx', 'char(64) NOT NULL'],
      ['password_hash', 'varchar(255) NOT NULL'],
      ['role', 'varchar(16) NOT NULL'],
      ['account_archived', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['locked_until', 'timestamp NULL DEFAULT NULL'],
      ['locked_permanent', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['installation_id', 'char(36) NOT NULL'],
      ['created_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['updated_at', 'timestamp NOT NULL DEFAULT current_timestamp()'],
      ['totp_secret_enc', 'varbinary(1024) DEFAULT NULL'],
      ['totp_enabled', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['failed_login_count', 'int(11) NOT NULL DEFAULT 0'],
      ['supervisor_user_id', 'char(36) DEFAULT NULL'],
      ['department', 'varchar(255) DEFAULT NULL'],
      ['permissions_json', 'text DEFAULT NULL'],
      ['notif_prefs_json', 'text DEFAULT NULL'],
      ['phone', 'varbinary(2048) DEFAULT NULL'],
      ['mobile', 'varbinary(2048) DEFAULT NULL'],
      ['job_title', 'varbinary(2048) DEFAULT NULL'],
      ['office_location', 'varbinary(2048) DEFAULT NULL'],
      ['totp_pending_secret_enc', 'varbinary(1024) DEFAULT NULL'],
      ['totp_last_step', 'bigint(20) DEFAULT NULL'],
      ['ldap_login_enabled', 'tinyint(1) NOT NULL DEFAULT 0'],
      ['account_valid_until', 'date DEFAULT NULL'],
      ['failed_login_last_at', 'timestamp NULL DEFAULT NULL'],
      ['outlook_refresh_token_enc', 'mediumblob DEFAULT NULL'],
      ['outlook_account_email', 'varchar(320) DEFAULT NULL'],
      ['outlook_connected_at', 'datetime DEFAULT NULL'],
      ['avatar_preset', 'tinyint(4) DEFAULT NULL'],
      ['avatar_image_enc', 'mediumblob DEFAULT NULL'],
      ['avatar_mime', 'varchar(32) DEFAULT NULL'],
      ['avatar_updated_at', 'datetime DEFAULT NULL'],
      ['mfa_failed_count', 'int(11) NOT NULL DEFAULT 0'],
      ['mfa_failed_last_at', 'timestamp NULL DEFAULT NULL'],
      ['mfa_enroll_code_hash', 'char(64) DEFAULT NULL'],
      ['mfa_enroll_code_expires_at', 'timestamp NULL DEFAULT NULL'],
      ['profile_enc', 'mediumblob DEFAULT NULL']
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'username', columns: ['username'], unique: true },
      { name: 'email_blind_idx', columns: ['email_blind_idx'], unique: true },
      { name: 'installation_id', columns: ['installation_id'] }
    ],
    foreignKeys: [
      { columns: ['installation_id'], references: 'installations', referencedColumns: ['id'] }
    ]
  }
];
