/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit (Sessions-Abschnitt): bisher gab es nur eine absolute Sitzungsdauer, kein
// Idle-Timeout -- eine vergessene, offene Session blieb bis zu 480 Minuten (Standard) gültig,
// unabhängig davon, ob sie tatsächlich benutzt wurde. last_seen_at wird bei jeder authentifizierten
// Anfrage aktualisiert (siehe app.ts) und gegen securityConfig.idleTimeoutMinutes geprüft.
export const migration_0032_session_idle_timeout: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('sessions')
      .addColumn('last_seen_at', 'timestamp')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('sessions')
      .dropColumn('last_seen_at')
      .execute();
  }
};
