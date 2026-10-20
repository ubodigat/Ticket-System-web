/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit B3: /mfa/setup darf ein bereits aktives TOTP-Secret nicht direkt überschreiben
// (sonst könnte eine kurz entwendete Session die 2FA des Opfers lautlos abschalten). Das neue
// Secret landet erst hier, bis /mfa/confirm es per gültigem Code bestätigt und übernimmt.
export const migration_0030_mfa_pending_secret: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .addColumn('totp_pending_secret_enc', 'varbinary(512)')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .dropColumn('totp_pending_secret_enc')
      .execute();
  }
};
