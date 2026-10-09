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

// Vollständiges normalisiertes Schema für alle Ticket-System Entitäten.
// Ersetzt den unsicheren JSON-Blob in legacy_data komplett.
export const migration_0008_full_schema: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // Tickets - vollständige Struktur mit allen Feldern
    await db.schema
      .createTable('tickets')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_number', 'varchar(32)', col => col.notNull().unique())
      // title/description: AES-256-GCM-verschlüsselt (siehe fieldCrypto.ts) -- daher VARBINARY/
      // MEDIUMBLOB statt VARCHAR/TEXT, nicht nur ein Kommentar, der Verschlüsselung behauptet.
      .addColumn('title', 'varbinary(512)', col => col.notNull())
      .addColumn('description', sql`mediumblob`, col => col.notNull())
      .addColumn('status', 'varchar(64)', col => col.notNull().defaultTo('Neu'))
      .addColumn('priority', 'varchar(32)', col => col.notNull().defaultTo('Normal'))
      .addColumn('category', 'varchar(128)')
      .addColumn('type', 'varchar(32)', col => col.notNull().defaultTo('ticket')) // ticket | incident
      .addColumn('created_by_user_id', 'char(36)') // null = deleted user
      .addColumn('created_by_username', 'varchar(64)', col => col.notNull())
      .addColumn('assigned_to_user_id', 'char(36)')
      .addColumn('assigned_to_username', 'varchar(64)')
      .addColumn('assigned_group_id', 'char(36)')
      .addColumn('sla_due_at', 'datetime')
      .addColumn('custom_due_at', 'datetime')
      .addColumn('archived_at', 'datetime')
      .addColumn('closed_at', 'datetime')
      .addColumn('approval_status', 'varchar(32)') // pending | approved | rejected | null
      .addColumn('approval_requested_by', 'varchar(64)')
      .addColumn('approval_text', 'text')
      .addColumn('approval_reviewer_id', 'char(36)')
      .addColumn('incident_id', 'char(36)') // linked major incident
      .addColumn('custom_fields_json', 'text') // JSON for extensible custom fields
      .addColumn('installation_id', 'char(36)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Chat-Nachrichten (Benutzer-Chat, verschlüsselt)
    await db.schema
      .createTable('ticket_messages')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('sender_user_id', 'char(36)')
      .addColumn('sender_username', 'varchar(64)', col => col.notNull())
      .addColumn('sender_name', 'varchar(255)', col => col.notNull())
      .addColumn('sender_role', 'varchar(16)', col => col.notNull())
      .addColumn('content', sql`mediumblob`, col => col.notNull()) // AES-256-GCM-verschlüsselt
      .addColumn('content_html', sql`mediumblob`) // AES-256-GCM-verschlüsselt (sanitized HTML)
      .addColumn('has_attachments', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Interne Kommentare (Admin-Chat, Lösungsweg - nicht für Benutzer sichtbar)
    await db.schema
      .createTable('ticket_notes')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('author_user_id', 'char(36)')
      .addColumn('author_username', 'varchar(64)', col => col.notNull())
      .addColumn('author_name', 'varchar(255)', col => col.notNull())
      .addColumn('stream', 'varchar(32)', col => col.notNull()) // admin-chat | solution
      .addColumn('note_type', 'varchar(64)', col => col.notNull()) // Abstimmung | Analyse | etc.
      .addColumn('content', sql`mediumblob`, col => col.notNull()) // AES-256-GCM-verschlüsselt
      .addColumn('is_pinned', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('is_resolution', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('has_attachments', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Anhänge (Datei-Metadaten + Base64-Inhalt)
    await db.schema
      .createTable('attachments')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.references('tickets.id').onDelete('cascade'))
      .addColumn('message_id', 'char(36)') // null = ticket-level attachment
      .addColumn('note_id', 'char(36)')
      .addColumn('uploaded_by_user_id', 'char(36)')
      .addColumn('uploaded_by_username', 'varchar(64)', col => col.notNull())
      // filename/data_b64: AES-256-GCM-verschlüsselt (siehe fieldCrypto.ts) -- mime_type bleibt
      // Klartext (für Vorschau/Content-Type nötig, nicht als geheim eingestuft, docs-Entscheidung
      // "Größe/MIME bewusst im Klartext").
      .addColumn('filename', 'varbinary(1024)', col => col.notNull())
      .addColumn('mime_type', 'varchar(255)', col => col.notNull())
      .addColumn('size_bytes', 'integer', col => col.notNull())
      .addColumn('data_b64', sql`longblob`, col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Ticket-Verlaufsprotokoll (Audit Log)
    await db.schema
      .createTable('ticket_audit_log')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('ticket_id', 'char(36)', col => col.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('actor_user_id', 'char(36)')
      .addColumn('actor_username', 'varchar(64)', col => col.notNull())
      .addColumn('action', 'varchar(128)', col => col.notNull())
      .addColumn('field', 'varchar(64)')
      .addColumn('old_value', 'text')
      .addColumn('new_value', 'text')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Konto-Anfragen (Account-Requests von der Benutzerseite)
    await db.schema
      .createTable('account_requests')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      // name/email: AES-256-GCM-verschlüsselt, genau wie bei users (docs §6.8 Pflichtfeld
      // "E-Mail-Adressen/Namen"). company/reason enthalten potenziell personenbezogene Freitext-
      // Angaben, bleiben aber für Phase 1 unverschlüsselt -- siehe Hinweis im Abschlussbericht.
      .addColumn('name', 'varbinary(1024)', col => col.notNull())
      .addColumn('email', 'varbinary(1024)', col => col.notNull())
      .addColumn('company', 'varchar(255)')
      .addColumn('reason', 'text')
      .addColumn('status', 'varchar(32)', col => col.notNull().defaultTo('pending')) // pending | approved | rejected
      .addColumn('reviewed_by_user_id', 'char(36)')
      .addColumn('installation_id', 'char(36)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Benachrichtigungen
    await db.schema
      .createTable('notifications')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('recipient_user_id', 'char(36)')
      .addColumn('recipient_username', 'varchar(64)', col => col.notNull())
      .addColumn('type', 'varchar(64)', col => col.notNull()) // newTicket | newMessage | statusChange | etc.
      .addColumn('ticket_id', 'char(36)')
      .addColumn('ticket_number', 'varchar(32)')
      .addColumn('message', sql`mediumblob`) // AES-256-GCM-verschlüsselt (Pflichtfeld "Benachrichtigungstexte")
      .addColumn('is_read', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Gespeicherte Listen-Ansichten (Admin-Konfiguration)
    await db.schema
      .createTable('list_views')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('owner_user_id', 'char(36)', col => col.notNull())
      .addColumn('filters_json', 'text', col => col.notNull()) // JSON-Filtervorlagen
      .addColumn('is_shared', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Globales System-Protokoll
    await db.schema
      .createTable('global_audit_log')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('actor_user_id', 'char(36)')
      .addColumn('actor_username', 'varchar(64)', col => col.notNull())
      .addColumn('action', 'varchar(128)', col => col.notNull())
      .addColumn('target_type', 'varchar(64)') // user | group | setting | ticket
      .addColumn('target_id', 'varchar(128)')
      .addColumn('detail_json', 'text')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Sessions (für serverseitige Session-Verwaltung / Invalidierung)
    await db.schema
      .createTable('sessions')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('user_id', 'char(36)', col => col.notNull())
      .addColumn('user_agent', 'varchar(512)')
      .addColumn('ip_address', 'varchar(64)')
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('expires_at', 'timestamp', col => col.notNull())
      .addColumn('revoked_at', 'timestamp')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('sessions').ifExists().execute();
    await db.schema.dropTable('global_audit_log').ifExists().execute();
    await db.schema.dropTable('list_views').ifExists().execute();
    await db.schema.dropTable('notifications').ifExists().execute();
    await db.schema.dropTable('account_requests').ifExists().execute();
    await db.schema.dropTable('ticket_audit_log').ifExists().execute();
    await db.schema.dropTable('attachments').ifExists().execute();
    await db.schema.dropTable('ticket_notes').ifExists().execute();
    await db.schema.dropTable('ticket_messages').ifExists().execute();
    await db.schema.dropTable('tickets').ifExists().execute();
  }
};
