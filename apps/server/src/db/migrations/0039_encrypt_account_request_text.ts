/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N10-Rest: company/reason einer Kontoanfrage sind Freitextfelder (koennen
// personenbezogene Angaben enthalten, z.B. Begruendung) und waren bisher -- anders als name/email
// auf derselben Tabelle -- unverschluesselt. Gleiche Behandlung wie name/email.
export const migration_0039_encrypt_account_request_text: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('account_requests')
      .modifyColumn('company', sql`varbinary(2048)`)
      .execute();
    await db.schema.alterTable('account_requests')
      .modifyColumn('reason', sql`mediumblob`)
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('account_requests')
      .modifyColumn('company', sql`varchar(255)`)
      .execute();
    await db.schema.alterTable('account_requests')
      .modifyColumn('reason', sql`text`)
      .execute();
  }
};
