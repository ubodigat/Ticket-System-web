/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Zeigt an, wann eine Teilaufgabe (ticket_todos) tatsächlich als erledigt markiert wurde --
// wird neben dem Text angezeigt, sobald "done" aktiv ist.
export const migration_0036_todo_completed_at: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('ticket_todos')
      .addColumn('done_at', 'timestamp')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('ticket_todos')
      .dropColumn('done_at')
      .execute();
  }
};
