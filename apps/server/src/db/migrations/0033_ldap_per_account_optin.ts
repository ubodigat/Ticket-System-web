/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N7: LDAP war bisher ein Fallback fuer JEDES lokal existierende Konto (ausser
// Superadmins, siehe auth.ts) -- jetzt Opt-in pro Konto, Standard AUS. Ein Superadmin muss LDAP
// fuer ein Konto explizit freischalten (users.ts PATCH, nur Superadmin).
export const migration_0033_ldap_per_account_optin: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .addColumn('ldap_login_enabled', 'boolean', col => col.notNull().defaultTo(false))
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users')
      .dropColumn('ldap_login_enabled')
      .execute();
  }
};
