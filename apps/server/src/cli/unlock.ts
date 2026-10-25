/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
// Security-Audit R-11: Rettungsanker fuer den Fall, dass ein Konto (z.B. der letzte verbleibende
// Superadmin) gesperrt ist und sich niemand mehr ueber die Oberflaeche anmelden kann, um es zu
// entsperren -- setzt die manuelle Admin-Sperre, den kontoweiten Backoff-Zaehler und alle
// automatischen Pro-Quellnetz-Sperren (login_failure_sources) fuer das angegebene Konto zurueck.
// Aufruf auf dem Host/im Container: node dist/cli/unlock.js <benutzername>
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/connection.js';

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    console.error('Verwendung: node dist/cli/unlock.js <benutzername>');
    process.exit(1);
  }

  const env = loadEnv();
  const db = createDb(env, 'migrate');
  try {
    const user = await db.selectFrom('users').select(['id', 'username']).where('username', '=', username).executeTakeFirst();
    if (!user) {
      console.error(`Kein Konto mit Benutzername "${username}" gefunden.`);
      process.exit(1);
    }

    await db.updateTable('users')
      .set({ locked_permanent: false, locked_until: null, failed_login_count: 0, failed_login_last_at: null })
      .where('id', '=', user.id)
      .execute();
    await db.deleteFrom('login_failure_sources').where('user_id', '=', user.id).execute();
    await db.insertInto('global_audit_log').values({
      id: randomUUID(), actor_user_id: null, actor_username: `cli:${process.env.USER || process.env.USERNAME || 'unknown'}`,
      action: 'account.unlocked_via_cli', target_type: 'user', target_id: user.id, detail_json: null
    }).execute();

    console.log(`Konto "${username}" entsperrt (manuelle Sperre, Backoff und alle Pro-Quellnetz-Sperren zurückgesetzt).`);
  } finally {
    await db.destroy();
  }
}

main().catch(err => {
  console.error('Entsperren fehlgeschlagen:', err);
  process.exit(1);
});
