-- Schema einer Installation vom Stand 11/2026 (vor dem Wegfall der Migrationen), erzeugt mit
-- mariadb-dump --no-data. Ausgangslage fuer den Upgrade-Test in ops/tests/mariadb-security.mjs.
CREATE TABLE `account_requests` (
  `id` char(36) NOT NULL,
  `name` varbinary(1024) NOT NULL,
  `email` varbinary(1024) NOT NULL,
  `company` varbinary(2048) DEFAULT NULL,
  `reason` mediumblob DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `reviewed_by_user_id` char(36) DEFAULT NULL,
  `installation_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `admin_todo_members` (
  `todo_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`todo_id`,`user_id`),
  KEY `admin_todo_member_user_idx` (`user_id`,`hidden`),
  CONSTRAINT `1` FOREIGN KEY (`todo_id`) REFERENCES `admin_todos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `admin_todos` (
  `id` char(36) NOT NULL,
  `content` mediumblob NOT NULL,
  `created_by_user_id` char(36) DEFAULT NULL,
  `due_at` datetime DEFAULT NULL,
  `done` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `done_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `created_by_user_id` (`created_by_user_id`),
  CONSTRAINT `1` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `app_settings` (
  `id` int(11) NOT NULL,
  `company_name` varchar(255) NOT NULL DEFAULT '',
  `portal_name` varchar(255) NOT NULL DEFAULT '',
  `setup_completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `config_json` mediumtext DEFAULT NULL,
  `smtp_host` varchar(255) DEFAULT NULL,
  `smtp_port` int(11) DEFAULT NULL,
  `smtp_secure` tinyint(1) DEFAULT NULL,
  `smtp_user` varchar(255) DEFAULT NULL,
  `smtp_password_enc` varbinary(1024) DEFAULT NULL,
  `smtp_from` varchar(255) DEFAULT NULL,
  `smtp_from_name` varchar(255) DEFAULT NULL,
  `ldap_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `ldap_url` varchar(255) DEFAULT NULL,
  `ldap_bind_dn` varchar(255) DEFAULT NULL,
  `ldap_bind_password_enc` varbinary(1024) DEFAULT NULL,
  `ldap_base_dn` varchar(255) DEFAULT NULL,
  `ldap_user_filter` varchar(255) DEFAULT NULL,
  `outlook_client_secret_enc` varbinary(2048) DEFAULT NULL,
  `mail_secrets_enc` mediumblob DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `attachments` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) DEFAULT NULL,
  `message_id` char(36) DEFAULT NULL,
  `note_id` char(36) DEFAULT NULL,
  `uploaded_by_user_id` char(36) DEFAULT NULL,
  `uploaded_by_username` varchar(64) NOT NULL,
  `filename` varbinary(1024) NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` int(11) NOT NULL,
  `data_b64` longblob NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `categories` (
  `id` char(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `auto_assign_group_id` char(36) DEFAULT NULL,
  `custom_fields_json` text DEFAULT NULL,
  `locked` tinyint(1) NOT NULL DEFAULT 0,
  `archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `data_encryption_keys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `purpose` varchar(128) NOT NULL,
  `key_version` int(11) NOT NULL,
  `wrapped_dek` varbinary(255) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dek_purpose_version` (`purpose`,`key_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `encryption_checkpoints` (
  `purpose` varchar(128) NOT NULL,
  PRIMARY KEY (`purpose`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `file_upload_chunks` (
  `upload_id` char(36) NOT NULL,
  `part` int(11) NOT NULL,
  `data_enc` longblob NOT NULL,
  PRIMARY KEY (`upload_id`,`part`),
  CONSTRAINT `1` FOREIGN KEY (`upload_id`) REFERENCES `file_uploads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `file_uploads` (
  `id` char(36) NOT NULL,
  `owner_user_id` char(36) DEFAULT NULL,
  `ticket_id` char(36) DEFAULT NULL,
  `article_id` char(36) DEFAULT NULL,
  `filename` blob NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` int(11) NOT NULL,
  `received_bytes` int(11) NOT NULL DEFAULT 0,
  `completed` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `message_id` char(36) DEFAULT NULL,
  `note_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  KEY `article_id` (`article_id`),
  KEY `file_uploads_owner_created` (`owner_user_id`,`created_at`),
  CONSTRAINT `1` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `2` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `3` FOREIGN KEY (`article_id`) REFERENCES `kb_articles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `global_audit_log` (
  `id` char(36) NOT NULL,
  `actor_user_id` char(36) DEFAULT NULL,
  `actor_username` varchar(64) NOT NULL,
  `action` varchar(128) NOT NULL,
  `target_type` varchar(64) DEFAULT NULL,
  `target_id` varchar(128) DEFAULT NULL,
  `detail_json` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_global_audit_log_created` (`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `groups` (
  `id` char(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `parent_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_groups_parent` (`parent_id`),
  CONSTRAINT `fk_groups_parent` FOREIGN KEY (`parent_id`) REFERENCES `groups` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `installations` (
  `id` char(36) NOT NULL,
  `schema_version` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `job_dead_letter` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_id` int(11) NOT NULL,
  `type` varchar(64) NOT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`)),
  `last_error` text NOT NULL,
  `attempts` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `jobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(64) NOT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`)),
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `max_attempts` int(11) NOT NULL DEFAULT 5,
  `idempotency_key` varchar(255) NOT NULL,
  `run_after` timestamp NOT NULL DEFAULT current_timestamp(),
  `locked_by` varchar(64) DEFAULT NULL,
  `locked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `idx_jobs_status_run_after` (`status`,`run_after`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `kb_article_attachments` (
  `id` char(36) NOT NULL,
  `kb_article_id` char(36) NOT NULL,
  `uploaded_by_user_id` char(36) DEFAULT NULL,
  `uploaded_by_username` varchar(64) NOT NULL,
  `filename` varbinary(1024) NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` int(11) NOT NULL,
  `data_b64` longblob NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `kb_article_attachments_article_idx` (`kb_article_id`),
  CONSTRAINT `1` FOREIGN KEY (`kb_article_id`) REFERENCES `kb_articles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `kb_articles` (
  `id` char(36) NOT NULL,
  `title` varbinary(1024) NOT NULL,
  `content` mediumblob NOT NULL,
  `source_ticket_id` char(36) DEFAULT NULL,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `category` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kb_articles_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `kb_categories` (
  `id` char(36) NOT NULL,
  `name` varchar(128) NOT NULL,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `key_rotation_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `purpose` varchar(128) NOT NULL,
  `old_key_version` int(11) DEFAULT NULL,
  `new_key_version` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `kysely_migration` (
  `name` varchar(255) NOT NULL,
  `timestamp` varchar(255) NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `kysely_migration_lock` (
  `id` varchar(255) NOT NULL,
  `is_locked` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `list_views` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `owner_user_id` char(36) NOT NULL,
  `filters_json` text NOT NULL,
  `is_shared` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `login_failure_sources` (
  `user_id` char(36) NOT NULL,
  `source_prefix` varchar(64) NOT NULL,
  `failure_count` int(11) NOT NULL DEFAULT 0,
  `locked_until` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`source_prefix`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `mfa_devices` (
  `token_hash` char(64) NOT NULL,
  `user_id` char(36) NOT NULL,
  `verified_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `mfa_flows` (
  `token_hash` char(64) NOT NULL,
  `user_id` char(36) NOT NULL,
  `purpose` varchar(16) NOT NULL,
  `state_json` text NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `mfa_recovery_codes` (
  `user_id` char(36) NOT NULL,
  `code_hash` char(64) NOT NULL,
  PRIMARY KEY (`user_id`,`code_hash`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `notifications` (
  `id` char(36) NOT NULL,
  `recipient_user_id` char(36) DEFAULT NULL,
  `recipient_username` varchar(64) NOT NULL,
  `type` varchar(64) NOT NULL,
  `ticket_id` char(36) DEFAULT NULL,
  `ticket_number` varchar(32) DEFAULT NULL,
  `message` mediumblob DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_notification_recipient` (`recipient_user_id`),
  CONSTRAINT `fk_notification_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `rate_limit_counters` (
  `rate_key` varchar(255) NOT NULL,
  `window_start` timestamp NOT NULL,
  `count` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`rate_key`,`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `recurring_admin_todos` (
  `id` char(36) NOT NULL,
  `content` mediumblob NOT NULL,
  `created_by_user_id` char(36) NOT NULL,
  `recipient_ids_json` text NOT NULL,
  `interval_unit` varchar(10) NOT NULL,
  `interval_count` int(11) NOT NULL,
  `due_after_hours` int(11) DEFAULT NULL,
  `next_run_at` datetime NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `recurring_admin_todos_due` (`active`,`next_run_at`),
  CONSTRAINT `1` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `recurring_ticket_rules` (
  `id` char(36) NOT NULL,
  `title` varbinary(2048) DEFAULT NULL,
  `description` mediumblob DEFAULT NULL,
  `category` varchar(128) DEFAULT NULL,
  `priority` varchar(32) NOT NULL DEFAULT 'Normal',
  `interval_unit` varchar(16) NOT NULL,
  `interval_count` int(11) NOT NULL DEFAULT 1,
  `next_run_at` timestamp NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `sessions` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `expires_at` timestamp NOT NULL,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `text_blocks` (
  `id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` mediumblob NOT NULL,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_approvals` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `requested_by_user_id` char(36) DEFAULT NULL,
  `requested_by_username` varchar(255) DEFAULT NULL,
  `approver_user_id` char(36) DEFAULT NULL,
  `approver_username` varchar(255) DEFAULT NULL,
  `request_text_enc` mediumblob DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `decided_by_user_id` char(36) DEFAULT NULL,
  `decided_by_username` varchar(255) DEFAULT NULL,
  `decision_text_enc` mediumblob DEFAULT NULL,
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `decided_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_approvals_ticket` (`ticket_id`,`requested_at`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_audit_log` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `actor_user_id` char(36) DEFAULT NULL,
  `actor_username` varchar(64) NOT NULL,
  `action` varchar(128) NOT NULL,
  `field` varchar(64) DEFAULT NULL,
  `old_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_calendar_events` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `graph_event_id` varchar(512) NOT NULL,
  `web_link` varchar(1024) DEFAULT NULL,
  `subject` varchar(512) NOT NULL,
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `ticket_calendar_events_ticket_idx` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `2` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_kb_links` (
  `ticket_id` char(36) NOT NULL,
  `article_id` char(36) NOT NULL,
  `linked_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`ticket_id`,`article_id`),
  KEY `idx_ticket_kb_links_article` (`article_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `2` FOREIGN KEY (`article_id`) REFERENCES `kb_articles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_messages` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `sender_user_id` char(36) DEFAULT NULL,
  `sender_username` varchar(64) NOT NULL,
  `sender_name` varchar(255) NOT NULL,
  `sender_role` varchar(16) NOT NULL,
  `content` mediumblob NOT NULL,
  `content_html` mediumblob DEFAULT NULL,
  `has_attachments` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `edited_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_notes` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `author_user_id` char(36) DEFAULT NULL,
  `author_username` varchar(64) NOT NULL,
  `author_name` varchar(255) NOT NULL,
  `stream` varchar(32) NOT NULL,
  `note_type` varchar(64) NOT NULL,
  `content` mediumblob NOT NULL,
  `is_pinned` tinyint(1) NOT NULL DEFAULT 0,
  `is_resolution` tinyint(1) NOT NULL DEFAULT 0,
  `has_attachments` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `edited_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_participants` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `username` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_ticket_participants_unique` (`ticket_id`,`user_id`),
  KEY `idx_ticket_participants_ticket` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_relations` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `related_ticket_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_ticket_relations_unique` (`ticket_id`,`related_ticket_id`),
  KEY `idx_ticket_relations_ticket` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_time_entries` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `username` varchar(64) NOT NULL,
  `minutes` int(11) NOT NULL,
  `note` varchar(512) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `note_enc` mediumblob DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_todos` (
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `content` mediumblob NOT NULL,
  `assignee_user_id` char(36) DEFAULT NULL,
  `assignee_username` varchar(64) DEFAULT NULL,
  `done` tinyint(1) NOT NULL DEFAULT 0,
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `done_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ticket_todos_ticket` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ticket_work_timers` (
  `user_id` char(36) NOT NULL,
  `id` char(36) NOT NULL,
  `ticket_id` char(36) NOT NULL,
  `started_at` datetime NOT NULL,
  `stopped_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `id` (`id`),
  KEY `ticket_id` (`ticket_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `2` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `tickets` (
  `id` char(36) NOT NULL,
  `ticket_number` varchar(32) NOT NULL,
  `title` varbinary(512) NOT NULL,
  `description` mediumblob NOT NULL,
  `status` varchar(64) NOT NULL DEFAULT 'Neu',
  `priority` varchar(32) NOT NULL DEFAULT 'Normal',
  `category` varchar(128) DEFAULT NULL,
  `type` varchar(32) NOT NULL DEFAULT 'ticket',
  `created_by_user_id` char(36) DEFAULT NULL,
  `created_by_username` varchar(64) NOT NULL,
  `assigned_to_user_id` char(36) DEFAULT NULL,
  `assigned_to_username` varchar(64) DEFAULT NULL,
  `assigned_group_id` char(36) DEFAULT NULL,
  `sla_due_at` datetime DEFAULT NULL,
  `custom_due_at` datetime DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `approval_status` varchar(32) DEFAULT NULL,
  `approval_requested_by` varchar(64) DEFAULT NULL,
  `approval_text` mediumblob DEFAULT NULL,
  `approval_reviewer_id` char(36) DEFAULT NULL,
  `incident_id` char(36) DEFAULT NULL,
  `custom_fields_json` mediumblob DEFAULT NULL,
  `installation_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `incident_notice` varbinary(2048) DEFAULT NULL,
  `filed_by_user_id` char(36) DEFAULT NULL,
  `filed_by_username` varchar(64) DEFAULT NULL,
  `waiting_since` timestamp NULL DEFAULT NULL,
  `waiting_message` mediumblob DEFAULT NULL,
  `waiting_reminder_sent` tinyint(1) NOT NULL DEFAULT 0,
  `merged_into_ticket_id` char(36) DEFAULT NULL,
  `archived_author_ack` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ticket_number` (`ticket_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_absences` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `from_at` timestamp NULL DEFAULT NULL,
  `until_at` timestamp NULL DEFAULT NULL,
  `substitute_user_id` char(36) DEFAULT NULL,
  `visible` tinyint(1) NOT NULL DEFAULT 0,
  `ended_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_absences_user_active` (`user_id`,`active`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_groups` (
  `user_id` char(36) NOT NULL,
  `group_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`group_id`),
  KEY `idx_user_groups_group` (`group_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `2` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_passkeys` (
  `id` varchar(700) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` char(36) NOT NULL,
  `public_key` blob NOT NULL,
  `counter` bigint(20) NOT NULL,
  `label` varchar(100) NOT NULL,
  `transports_json` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_preferences` (
  `user_id` char(36) NOT NULL,
  `value_enc` mediumblob NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `users` (
  `id` char(36) NOT NULL,
  `username` varchar(64) NOT NULL,
  `name_enc` varbinary(512) NOT NULL,
  `email_enc` varbinary(512) NOT NULL,
  `email_blind_idx` char(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(16) NOT NULL,
  `account_archived` tinyint(1) NOT NULL DEFAULT 0,
  `locked_until` timestamp NULL DEFAULT NULL,
  `locked_permanent` tinyint(1) NOT NULL DEFAULT 0,
  `installation_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `totp_secret_enc` varbinary(512) DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `failed_login_count` int(11) NOT NULL DEFAULT 0,
  `supervisor_user_id` char(36) DEFAULT NULL,
  `department` varchar(255) DEFAULT NULL,
  `permissions_json` text DEFAULT NULL,
  `notif_prefs_json` text DEFAULT NULL,
  `phone` varbinary(2048) DEFAULT NULL,
  `mobile` varbinary(2048) DEFAULT NULL,
  `job_title` varbinary(2048) DEFAULT NULL,
  `office_location` varbinary(2048) DEFAULT NULL,
  `totp_pending_secret_enc` varbinary(512) DEFAULT NULL,
  `totp_last_step` bigint(20) DEFAULT NULL,
  `ldap_login_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `account_valid_until` date DEFAULT NULL,
  `failed_login_last_at` timestamp NULL DEFAULT NULL,
  `outlook_refresh_token_enc` mediumblob DEFAULT NULL,
  `outlook_account_email` varchar(320) DEFAULT NULL,
  `outlook_connected_at` datetime DEFAULT NULL,
  `avatar_preset` tinyint(4) DEFAULT NULL,
  `avatar_image_enc` mediumblob DEFAULT NULL,
  `avatar_mime` varchar(32) DEFAULT NULL,
  `avatar_updated_at` datetime DEFAULT NULL,
  `mfa_failed_count` int(11) NOT NULL DEFAULT 0,
  `mfa_failed_last_at` timestamp NULL DEFAULT NULL,
  `mfa_enroll_code_hash` char(64) DEFAULT NULL,
  `mfa_enroll_code_expires_at` timestamp NULL DEFAULT NULL,
  `profile_enc` mediumblob DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email_blind_idx` (`email_blind_idx`),
  KEY `installation_id` (`installation_id`),
  CONSTRAINT `2` FOREIGN KEY (`installation_id`) REFERENCES `installations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
