/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Weitere Kontakt-/Organisationsfelder je Person, wie sie typischerweise aus einem Active
// Directory synchronisiert wuerden (telephoneNumber/mobile/title/physicalDeliveryOfficeName).
// Plaintext wie "department" (keine personenbezogenen Pflichtfelder wie Name/E-Mail, siehe
// users.ts), nicht AES-256-GCM-verschluesselt.
export const migration_0029_user_contact_fields: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .addColumn('phone', 'varchar(64)')
      .addColumn('mobile', 'varchar(64)')
      .addColumn('job_title', 'varchar(255)')
      .addColumn('office_location', 'varchar(255)')
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .dropColumn('phone')
      .dropColumn('mobile')
      .dropColumn('job_title')
      .dropColumn('office_location')
      .execute();
  }
};