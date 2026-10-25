import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Persönlicher Outlook-Kalender pro Benutzer (delegierte OAuth-Berechtigung, siehe
// domain/graphClient.ts getAuthorizationUrl/exchangeAuthCodeForTokens) -- getrennt von der
// bestehenden App-only-Integration (ein gemeinsames Postfach, siehe 0037). Der Refresh-Token ist
// ein langlebiges Zugangsdatum und wird deshalb genauso wie name_enc/email_enc per fieldCipher
// verschlüsselt, nicht wie bei app_settings als Einzeilen-Secret, sondern pro Benutzerzeile.
export const migration_0048_outlook_personal_calendar: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_refresh_token_enc MEDIUMBLOB`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_account_email VARCHAR(320)`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_connected_at DATETIME`.execute(db);
  },
  async down() { throw new Error('Encrypted secrets require a forward-only migration'); }
};
