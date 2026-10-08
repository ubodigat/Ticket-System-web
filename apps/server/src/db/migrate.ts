import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import { loadEnv } from '../config/env.js';
import { createDb } from './connection.js';
import { migration_0001_installations } from './migrations/0001_installations.js';
import { migration_0002_key_management } from './migrations/0002_key_management.js';
import { migration_0003_users_and_groups } from './migrations/0003_users_and_groups.js';
import { migration_0004_jobs_and_rate_limit } from './migrations/0004_jobs_and_rate_limit.js';
import { migration_0005_app_settings } from './migrations/0005_app_settings.js';
import { migration_0006_legacy_data } from './migrations/0006_legacy_data.js';

// Programmatischer MigrationProvider statt dateisystembasiertem Scan -- Reihenfolge ist
// explizit und versioniert, nicht abhängig von Dateinamens-Sortierung zur Laufzeit.
const migrations: Record<string, Migration> = {
  '0001_installations': migration_0001_installations,
  '0002_key_management': migration_0002_key_management,
  '0003_users_and_groups': migration_0003_users_and_groups,
  '0004_jobs_and_rate_limit': migration_0004_jobs_and_rate_limit,
  '0005_app_settings': migration_0005_app_settings,
  '0006_legacy_data': migration_0006_legacy_data
};

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  }
};

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env);
  const migrator = new Migrator({ db, provider });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`Migration erfolgreich: ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`Migration fehlgeschlagen: ${result.migrationName}`);
    }
  }

  await db.destroy();

  if (error) {
    console.error('Migration abgebrochen.', error);
    process.exit(1);
  }
  console.log('Alle Migrationen auf dem neuesten Stand.');
}

main().catch(err => {
  console.error('Unerwarteter Fehler bei der Migration:', err);
  process.exit(1);
});
