/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N6: speichert den zuletzt akzeptierten TOTP-Zeitschritt pro Konto, damit
// derselbe Code nicht mehrfach innerhalb seines Gültigkeitsfensters verwendet werden kann
// (siehe domain/totp.ts verifyAndConsumeTotp).
export const migration_0031_totp_replay_protection: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .addColumn('totp_last_step', 'bigint')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .dropColumn('totp_last_step')
      .execute();
  }
};
