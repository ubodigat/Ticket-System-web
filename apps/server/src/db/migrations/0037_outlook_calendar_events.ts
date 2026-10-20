/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Macht die Outlook/Graph-Integration tatsächlich funktionsfähig: client_secret für den
// App-only-OAuth-Flow (verschlüsselt, wie smtp_password_enc/ldap_bind_password_enc) sowie eine
// Tabelle, in der pro Ticket die über Graph angelegten Kalendertermine protokolliert werden.
export const migration_0037_outlook_calendar_events: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('app_settings')
      .addColumn('outlook_client_secret_enc', 'varbinary(2048)')
      .execute();
    await db.schema.createTable('ticket_calendar_events')
      .addColumn('id', 'char(36)', c => c.primaryKey())
      .addColumn('ticket_id', 'char(36)', c => c.notNull().references('tickets.id').onDelete('cascade'))
      .addColumn('graph_event_id', 'varchar(512)', c => c.notNull())
      .addColumn('web_link', 'varchar(1024)')
      .addColumn('subject', 'varchar(512)', c => c.notNull())
      .addColumn('start_at', 'datetime', c => c.notNull())
      .addColumn('end_at', 'datetime', c => c.notNull())
      .addColumn('created_by_user_id', 'char(36)', c => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamp', c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
    await db.schema.createIndex('ticket_calendar_events_ticket_idx').on('ticket_calendar_events').column('ticket_id').execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('ticket_calendar_events').execute();
    await db.schema.alterTable('app_settings').dropColumn('outlook_client_secret_enc').execute();
  }
};
