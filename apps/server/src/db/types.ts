/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { ColumnType, Generated } from 'kysely';

// Vollständige Typ-Definitionen für alle normalisierten Tabellen. Es gibt keinen Legacy-/
// Kompatibilitätsspeicher mehr -- alle Daten liegen ausschließlich in diesen Tabellen.

type CreatedAt = ColumnType<Date, string | Date | undefined, never>;
type UpdatedAt = ColumnType<Date, string | Date | undefined, string | Date>;
type NullableTimestamp = ColumnType<Date | null, string | Date | null | undefined, string | Date | null>;
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface InstallationsTable {
  id: string;
  schema_version: number;
  created_at: CreatedAt;
}

export interface DataEncryptionKeysTable {
  id: Generated<number>;
  purpose: string;
  key_version: number;
  wrapped_dek: Buffer;
  active: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface KeyRotationLogTable {
  id: Generated<number>;
  purpose: string;
  old_key_version: number | null;
  new_key_version: number;
  reason: string;
  created_at: CreatedAt;
}

export interface GroupsTable {
  id: string;
  name: string;
  is_default: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface UsersTable {
  id: string;
  username: string;
  name_enc: Buffer;
  email_enc: Buffer;
  email_blind_idx: string;
  password_hash: string;
  role: 'user' | 'admin' | 'superadmin';
  department_group_id: string | null;
  supervisor_user_id: Nullable<string>;
  account_archived: ColumnType<boolean, boolean, boolean>;
  locked_until: NullableTimestamp;
  locked_permanent: ColumnType<boolean, boolean, boolean>;
  installation_id: string;
  // TOTP-Zweitfaktor: Secret AES-256-GCM-verschlüsselt, nie im Klartext (docs/CRYPTOGRAPHY.md).
  // totp_enabled bleibt false, bis der erste Code nach der Einrichtung bestätigt wurde.
  totp_secret_enc: Buffer | null;
  totp_enabled: ColumnType<boolean, boolean, boolean>;
  // Brute-Force-Schutz (auth.ts): Fehlversuche in Folge; nach Schwelle setzt auth.ts
  // locked_until. Generated, da beim Insert immer der DB-Default (0) gilt.
  failed_login_count: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: CreatedAt;
  expires_at: ColumnType<Date, string | Date, never>;
  revoked_at: NullableTimestamp;
}

export interface JobsTable {
  id: Generated<number>;
  type: string;
  payload_json: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead';
  attempts: Generated<number>;
  max_attempts: number;
  idempotency_key: string;
  run_after: UpdatedAt;
  locked_by: string | null;
  locked_at: NullableTimestamp;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface JobDeadLetterTable {
  id: Generated<number>;
  job_id: number;
  type: string;
  payload_json: string;
  last_error: string;
  attempts: number;
  created_at: CreatedAt;
}

export interface RateLimitCountersTable {
  rate_key: string;
  window_start: ColumnType<Date, string | Date, string | Date>;
  count: Generated<number>;
}

export interface AppSettingsTable {
  id: number;
  company_name: string;
  portal_name: string;
  setup_completed_at: NullableTimestamp;
  // Erweiterbare Einstellungen (SLA-Stunden, Geschäftszeiten, Benachrichtigungs-Policy,
  // Konto-Selbstverwaltung, Ticketnummernformat, ...) als JSON-String -- siehe settings.ts.
  config_json: Nullable<string>;
  smtp_host: Nullable<string>;
  smtp_port: Nullable<number>;
  smtp_secure: Nullable<boolean>;
  smtp_user: Nullable<string>;
  smtp_password_enc: Nullable<Buffer>;
  smtp_from: Nullable<string>;
  smtp_from_name: Nullable<string>;
  ldap_enabled: Generated<boolean>;
  ldap_url: Nullable<string>;
  ldap_bind_dn: Nullable<string>;
  ldap_bind_password_enc: Nullable<Buffer>;
  ldap_base_dn: Nullable<string>;
  ldap_user_filter: Nullable<string>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CategoriesTable {
  id: string;
  name: string;
  auto_assign_group_id: Nullable<string>;
  custom_fields_json: Nullable<string>;
  locked: ColumnType<boolean, boolean, boolean>;
  archived: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UserAbsencesTable {
  id: string;
  user_id: string;
  active: ColumnType<boolean, boolean, boolean>;
  from_at: NullableTimestamp;
  until_at: NullableTimestamp;
  substitute_user_id: Nullable<string>;
  visible: ColumnType<boolean, boolean, boolean>;
  ended_at: NullableTimestamp;
  created_at: CreatedAt;
}

export interface TicketTimeEntriesTable {
  id: string;
  ticket_id: string;
  user_id: Nullable<string>;
  username: string;
  minutes: number;
  note: Nullable<string>;
  created_at: CreatedAt;
}

export interface TextBlocksTable {
  id: string;
  title: string;
  content: Buffer;
  created_by_user_id: Nullable<string>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface KbArticlesTable {
  id: string;
  title: Buffer;
  content: Buffer;
  source_ticket_id: Nullable<string>;
  created_by_user_id: Nullable<string>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface RecurringTicketRulesTable {
  id: string;
  title: string;
  description: string;
  category: Nullable<string>;
  priority: string;
  interval_unit: 'day' | 'week' | 'month';
  interval_count: number;
  next_run_at: ColumnType<Date, string | Date, string | Date>;
  active: ColumnType<boolean, boolean, boolean>;
  created_by_user_id: Nullable<string>;
  created_at: CreatedAt;
}

// Vollständig normalisierte Ticket-Tabellen
export interface TicketsTable {
  id: string;
  ticket_number: string;
  title: Buffer;
  description: Buffer;
  status: string;
  priority: string;
  category: Nullable<string>;
  type: string;
  created_by_user_id: Nullable<string>;
  created_by_username: string;
  assigned_to_user_id: Nullable<string>;
  assigned_to_username: Nullable<string>;
  assigned_group_id: Nullable<string>;
  sla_due_at: NullableTimestamp;
  custom_due_at: NullableTimestamp;
  archived_at: NullableTimestamp;
  closed_at: NullableTimestamp;
  approval_status: Nullable<string>;
  approval_requested_by: Nullable<string>;
  approval_text: Nullable<string>;
  approval_reviewer_id: Nullable<string>;
  incident_id: Nullable<string>;
  incident_notice: Nullable<Buffer>;
  filed_by_user_id: Nullable<string>;
  filed_by_username: Nullable<string>;
  waiting_since: NullableTimestamp;
  waiting_message: Nullable<string>;
  waiting_reminder_sent: Generated<boolean>;
  merged_into_ticket_id: Nullable<string>;
  custom_fields_json: Nullable<string>;
  installation_id: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TicketMessagesTable {
  id: string;
  ticket_id: string;
  sender_user_id: Nullable<string>;
  sender_username: string;
  sender_name: string;
  sender_role: string;
  content: Buffer;
  content_html: Nullable<Buffer>;
  has_attachments: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface TicketNotesTable {
  id: string;
  ticket_id: string;
  author_user_id: Nullable<string>;
  author_username: string;
  author_name: string;
  stream: string;
  note_type: string;
  content: Buffer;
  is_pinned: ColumnType<boolean, boolean, boolean>;
  is_resolution: ColumnType<boolean, boolean, boolean>;
  has_attachments: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface TicketTodosTable {
  id: string;
  ticket_id: string;
  content: Buffer;
  assignee_user_id: Nullable<string>;
  assignee_username: Nullable<string>;
  done: ColumnType<boolean, boolean, boolean>;
  created_by_user_id: Nullable<string>;
  created_at: CreatedAt;
}

export interface TicketParticipantsTable {
  id: string;
  ticket_id: string;
  user_id: string;
  username: string;
  created_at: CreatedAt;
}

export interface TicketRelationsTable {
  id: string;
  ticket_id: string;
  related_ticket_id: string;
}

export interface AttachmentsTable {
  id: string;
  ticket_id: Nullable<string>;
  message_id: Nullable<string>;
  note_id: Nullable<string>;
  uploaded_by_user_id: Nullable<string>;
  uploaded_by_username: string;
  filename: Buffer;
  mime_type: string;
  size_bytes: number;
  data_b64: Buffer;
  created_at: CreatedAt;
}

export interface TicketAuditLogTable {
  id: string;
  ticket_id: string;
  actor_user_id: Nullable<string>;
  actor_username: string;
  action: string;
  field: Nullable<string>;
  old_value: Nullable<string>;
  new_value: Nullable<string>;
  created_at: CreatedAt;
}

export interface AccountRequestsTable {
  id: string;
  name: Buffer;
  email: Buffer;
  company: Nullable<string>;
  reason: Nullable<string>;
  status: string;
  reviewed_by_user_id: Nullable<string>;
  installation_id: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface NotificationsTable {
  id: string;
  recipient_user_id: Nullable<string>;
  recipient_username: string;
  type: string;
  ticket_id: Nullable<string>;
  ticket_number: Nullable<string>;
  message: Nullable<Buffer>;
  is_read: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface ListViewsTable {
  id: string;
  name: string;
  owner_user_id: string;
  filters_json: string;
  is_shared: ColumnType<boolean, boolean, boolean>;
  created_at: CreatedAt;
}

export interface GlobalAuditLogTable {
  id: string;
  actor_user_id: Nullable<string>;
  actor_username: string;
  action: string;
  target_type: Nullable<string>;
  target_id: Nullable<string>;
  detail_json: Nullable<string>;
  created_at: CreatedAt;
}

export interface Database {
  // Kern
  installations: InstallationsTable;
  data_encryption_keys: DataEncryptionKeysTable;
  key_rotation_log: KeyRotationLogTable;
  groups: GroupsTable;
  users: UsersTable;
  sessions: SessionsTable;
  jobs: JobsTable;
  job_dead_letter: JobDeadLetterTable;
  rate_limit_counters: RateLimitCountersTable;
  app_settings: AppSettingsTable;
  categories: CategoriesTable;

  // Normalisiert
  tickets: TicketsTable;
  ticket_messages: TicketMessagesTable;
  ticket_notes: TicketNotesTable;
  ticket_todos: TicketTodosTable;
  ticket_participants: TicketParticipantsTable;
  ticket_relations: TicketRelationsTable;
  ticket_time_entries: TicketTimeEntriesTable;
  attachments: AttachmentsTable;
  ticket_audit_log: TicketAuditLogTable;
  account_requests: AccountRequestsTable;
  notifications: NotificationsTable;
  list_views: ListViewsTable;
  global_audit_log: GlobalAuditLogTable;
  user_absences: UserAbsencesTable;
  text_blocks: TextBlocksTable;
  kb_articles: KbArticlesTable;
  recurring_ticket_rules: RecurringTicketRulesTable;
}
