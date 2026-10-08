import type { ColumnType, Generated } from 'kysely';

// Phase-1-Teilmenge des Schemas aus docs/DATABASE_SCHEMA.md -- Grundgerüst (Installation,
// Schlüsselverwaltung, Benutzer/Gruppen, Jobs/Rate-Limit). Die vollständige Ticket-Domäne
// folgt gemäß docs/PROGRESS.md erst in Phase 3.

// DB-generierter Zeitstempel (DEFAULT CURRENT_TIMESTAMP): beim Insert optional (undefined ->
// DB-Default greift), danach nie mehr verändert.
type CreatedAt = ColumnType<Date, string | Date | undefined, never>;
// Wie CreatedAt, aber per UPDATE explizit neu setzbar.
type UpdatedAt = ColumnType<Date, string | Date | undefined, string | Date>;
// Optionaler, nullbarer Zeitstempel ohne DB-Default (z.B. "noch nicht gesperrt/abgeschlossen").
type NullableTimestamp = ColumnType<Date | null, string | Date | null | undefined, string | Date | null>;

export interface InstallationsTable {
  id: string;
  schema_version: number;
  created_at: CreatedAt;
}

export interface DataEncryptionKeysTable {
  id: Generated<number>;
  purpose: string; // z.B. "users.name", "tickets.title" -- siehe docs/DATABASE_SCHEMA.md
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
  account_archived: ColumnType<boolean, boolean, boolean>;
  locked_until: NullableTimestamp;
  locked_permanent: ColumnType<boolean, boolean, boolean>;
  installation_id: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
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

// Singleton-Zeile (id immer 1) -- Unternehmenseinstellungen + Einrichtungsstatus.
// setup_completed_at === null bedeutet: der Einrichtungsassistent wurde noch nicht
// abgeschlossen, siehe src/http/routes/setup.ts.
export interface AppSettingsTable {
  id: number;
  company_name: string;
  portal_name: string;
  setup_completed_at: NullableTimestamp;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  installations: InstallationsTable;
  data_encryption_keys: DataEncryptionKeysTable;
  key_rotation_log: KeyRotationLogTable;
  groups: GroupsTable;
  users: UsersTable;
  jobs: JobsTable;
  job_dead_letter: JobDeadLetterTable;
  rate_limit_counters: RateLimitCountersTable;
  app_settings: AppSettingsTable;
}
