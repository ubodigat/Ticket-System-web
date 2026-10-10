/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Datei-Anhaenge an Wissensdatenbank-Artikeln gab es in der lokalen Version vom 07.10.2026
// (Datei-Eingabe/Drag&Drop/Einfuegen im Artikel-Editor), aber in der Server-Version bisher gar
// nicht -- weder Spalte noch Endpunkt. Eigene, schlanke Tabelle statt Wiederverwendung von
// "attachments" (dort ist ticket_id eine Pflichtangabe, siehe extras.ts attachmentSchema).
export const migration_0023_kb_article_attachments: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('kb_article_attachments')
      .ifNotExists()
      .addColumn('id', 'char(36)', col => col.primaryKey())
      .addColumn('kb_article_id', 'char(36)', col => col.notNull().references('kb_articles.id').onDelete('cascade'))
      .addColumn('uploaded_by_user_id', 'char(36)')
      .addColumn('uploaded_by_username', 'varchar(64)', col => col.notNull())
      // filename/data_b64: AES-256-GCM-verschlüsselt (siehe fieldCrypto.ts), mime_type bleibt
      // Klartext -- gleiches Muster wie "attachments" (0008_full_schema.ts).
      .addColumn('filename', 'varbinary(1024)', col => col.notNull())
      .addColumn('mime_type', 'varchar(255)', col => col.notNull())
      .addColumn('size_bytes', 'integer', col => col.notNull())
      .addColumn('data_b64', sql`longblob`, col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
    await db.schema.createIndex('kb_article_attachments_article_idx').on('kb_article_attachments').column('kb_article_id').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('kb_article_attachments').ifExists().execute();
  }
};