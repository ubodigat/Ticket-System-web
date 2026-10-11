/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Systemeinstellungen enthalten inzwischen HTML-Signaturen, Zertifikate, Branding und
// Benachrichtigungsregeln. TEXT ist dafuer zu klein und fuehrt in MariaDB zu 500ern beim Speichern.
export const migration_0025_app_settings_config_mediumtext: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE app_settings MODIFY COLUMN config_json MEDIUMTEXT`.execute(db);
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE app_settings MODIFY COLUMN config_json TEXT`.execute(db);
  }
};
