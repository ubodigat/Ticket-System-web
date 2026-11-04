// Destructive ONLY inside the explicitly named disposable CI test database.
// Prueft gegen eine echte MariaDB (in CI zusaetzlich mit TZ=Europe/Berlin fuer MariaDB und Node):
// Upgrade einer bestehenden Installation ohne Datenverlust, Neuinstallation, Gleichheit beider Wege,
// Lesbarkeit und Neuverschluesselung des alten Feldformats, DEK-/KEK-Rotation, Blind-Index-Neuaufbau,
// UTC-Sitzungszeitzone und die dauerhafte Mail-Warteschlange.
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { loadEnv } from '../../apps/server/dist/config/env.js';
import { createDb } from '../../apps/server/dist/db/connection.js';
import { syncSchema, planSchemaSync, SCHEMA_FINGERPRINT, appliedSchemaFingerprint } from '../../apps/server/dist/db/schemaSync.js';
import { appendKekVersion, createFileKeyProvider, retireKekVersions } from '../../apps/server/dist/crypto/keyProvider.js';
import { ensureDek } from '../../apps/server/dist/crypto/dekService.js';
import { computeBlindIndex, describeStoredField, fieldCipher } from '../../apps/server/dist/crypto/fieldCrypto.js';
import { cryptoStatus, pruneRetiredDeks, reencryptAll, rewrapAllDeks, rotateDek } from '../../apps/server/dist/crypto/rotation.js';
import { queueMail, drainMailQueue } from '../../apps/server/dist/mail/queue.js';
import { isAccountExpired } from '../../apps/server/dist/domain/accountValidity.js';
import { createRateLimitStore } from '../../apps/server/dist/http/rateLimitStore.js';

assert.equal(process.env.DB_NAME, 'ticketsystem_security_ci', 'Use only the disposable CI database');
const temp = await mkdtemp(join(tmpdir(), 'ticket-security-ci-'));
process.env.KEK_FILE_PATH = join(temp, 'app.kek');
// Altes KEK-Format: eine einzige base64-Zeile (gilt als Version 1).
const legacyKek = randomBytes(32);
await writeFile(process.env.KEK_FILE_PATH, legacyKek.toString('base64') + '\n', { mode: 0o600 });
const env = loadEnv();
const db = createDb(env, 'schema');
const provider = () => createFileKeyProvider(env.KEK_FILE_PATH);
const inst = env.INSTALLATION_ID;

// --- Werkzeuge, die das bisherige Format nachbilden (Stand 11/2026) ---
const legacyDeks = new Map();
const gcm = (key, plaintext, aad) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
};
const legacyDek = async purpose => {
  if (!legacyDeks.has(purpose)) {
    const raw = randomBytes(32);
    legacyDeks.set(purpose, raw);
    await sql`INSERT INTO data_encryption_keys (purpose, key_version, wrapped_dek, active) VALUES (${purpose}, 1, ${gcm(legacyKek, raw, null)}, 1)`.execute(db);
  }
  return legacyDeks.get(purpose);
};
const legacyEncrypt = async (tableName, recordId, fieldName, value, purpose = `${tableName}.${fieldName}`) =>
  gcm(await legacyDek(purpose), Buffer.from(value, 'utf8'), Buffer.from([inst, '1', tableName, recordId, fieldName, '1'].join('\x1f'), 'utf8'));
const decrypt = async (purpose, tableName, recordId, fieldName, value) =>
  fieldCipher.decryptField(value, await ensureDek(db, provider(), purpose), { installationId: inst, tableName, recordId, fieldName });
const encrypt = async (purpose, tableName, recordId, fieldName, value) =>
  fieldCipher.encryptField(value, await ensureDek(db, provider(), purpose), { installationId: inst, tableName, recordId, fieldName });
const columnsOf = async () => (await sql`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, IS_NULLABLE AS n
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, COLUMN_NAME`.execute(db)).rows;
// FOREIGN_KEY_CHECKS gilt je Verbindung -- deshalb auf einer festen Verbindung.
const withoutForeignKeys = work => db.connection().execute(async conn => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(conn);
  try { await work(conn); } finally { await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(conn); }
});
const dropAll = () => withoutForeignKeys(async conn => {
  for (const { t } of (await sql`SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`.execute(conn)).rows) {
    await sql`DROP TABLE ${sql.table(t)}`.execute(conn);
  }
});

try {
  await dropAll();
  // 1. Bestehende Installation im Stand 11/2026 mit Daten im alten Feldformat.
  const fixture = await readFile(new URL('./fixtures/legacy-schema-2026-11.sql', import.meta.url), 'utf8');
  await withoutForeignKeys(async conn => {
    for (const statement of fixture.split(/;\s*\n/).map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await sql.raw(statement).execute(conn);
  });
  await sql`INSERT INTO kysely_migration (name, timestamp) VALUES ('0064_user_profile', '2026-11-01')`.execute(db);
  await sql`INSERT INTO app_settings (id, company_name, portal_name) VALUES (1, 'Firma', 'Portal')`.execute(db);
  await sql`INSERT INTO installations (id, schema_version) VALUES (${inst}, 1)`.execute(db);
  const uid = '11111111-1111-4111-8111-111111111111';
  const ticketId = '22222222-2222-4222-8222-222222222222';
  const blindRaw = await legacyDek('blind-index.users.email');
  await sql`INSERT INTO users (id, username, name_enc, email_enc, email_blind_idx, password_hash, role, installation_id)
    VALUES (${uid}, 'legacy', ${await legacyEncrypt('users', uid, 'name', 'Legacy Person')}, ${await legacyEncrypt('users', uid, 'email', 'legacy@example.org')},
      ${computeBlindIndex(blindRaw, 'legacy@example.org')}, 'unused', 'superadmin', ${inst})`.execute(db);
  await sql`INSERT INTO tickets (id, ticket_number, title, description, created_by_user_id, created_by_username, status, priority, type, waiting_message, installation_id)
    VALUES (${ticketId}, '00001', ${await legacyEncrypt('tickets', ticketId, 'title', 'Drucker defekt')}, ${await legacyEncrypt('tickets', ticketId, 'description', 'Beschreibung')},
      ${uid}, 'legacy', 'Neu', 'Normal', 'ticket', ${await legacyEncrypt('tickets', ticketId, 'waiting_message', 'Rueckfrage')}, ${inst})`.execute(db);
  const before = { users: 1, tickets: 1 };

  // 2. Abgleich: legt Neues an, entfernt die Migrationsverwaltung, laesst Daten unangetastet.
  const report = await syncSchema(db);
  assert.ok(report.actions.some(a => a.includes('data_encryption_keys.kek_version')), 'neue Spalte angelegt');
  assert.ok(report.actions.some(a => a.includes('crypto_jobs')) && report.actions.some(a => a.includes('schema_state')));
  assert.ok(report.actions.some(a => a.includes('kysely_migration')), 'Migrationsverwaltung entfernt');
  assert.ok(report.actions.some(a => a.includes('users.name_enc angepasst')), 'zu knappe Spalte verlustfrei erweitert');
  assert.ok(report.warnings.some(w => w.includes('installations.schema_version')), 'nicht mehr genutzte Spalte bleibt erhalten');
  assert.equal(await appliedSchemaFingerprint(db), SCHEMA_FINGERPRINT);
  for (const [table, count] of Object.entries(before)) {
    assert.equal(Number((await sql`SELECT COUNT(*) AS n FROM ${sql.table(table)}`.execute(db)).rows[0].n), count, `${table} vollstaendig`);
  }
  assert.equal((await syncSchema(db)).actions.length, 0, 'zweiter Lauf findet nichts mehr');
  assert.equal((await planSchemaSync(db)).steps.length, 0);

  // 3. Altes Format bleibt lesbar (DEK ohne AAD-Bindung, KEK-Datei im alten Format).
  const ticket = await db.selectFrom('tickets').selectAll().where('id', '=', ticketId).executeTakeFirstOrThrow();
  assert.equal(describeStoredField(ticket.title).format, 0);
  assert.equal(await decrypt('tickets.title', 'tickets', ticketId, 'title', ticket.title), 'Drucker defekt');

  // 4. Neuverschluesselung bringt alles ins aktuelle Format und setzt nach einem Abbruch fort.
  const partial = await reencryptAll({ db, keyProvider: provider(), installationId: inst }, 0);
  assert.equal(partial.complete, false);
  const full = await reencryptAll({ db, keyProvider: provider(), installationId: inst });
  assert.equal(full.complete, true); assert.equal(full.failed, 0); assert.ok(full.updated >= 5);
  const converted = await db.selectFrom('tickets').selectAll().where('id', '=', ticketId).executeTakeFirstOrThrow();
  assert.deepEqual(describeStoredField(converted.title), { format: 1, keyVersion: 1 });
  assert.equal(await decrypt('tickets.title', 'tickets', ticketId, 'title', converted.title), 'Drucker defekt');
  assert.equal(await decrypt('tickets.waiting_message', 'tickets', ticketId, 'waiting_message', converted.waiting_message), 'Rueckfrage');
  assert.equal((await reencryptAll({ db, keyProvider: provider(), installationId: inst })).updated, 0);

  // 5. DEK-Rotation: alte Werte bleiben lesbar, Neuverschluesselung hebt sie auf die neue Version.
  assert.equal(await rotateDek(db, provider(), 'tickets.title', 'ci'), 2);
  assert.equal(await decrypt('tickets.title', 'tickets', ticketId, 'title', converted.title), 'Drucker defekt');
  await reencryptAll({ db, keyProvider: provider(), installationId: inst });
  const rotated = await db.selectFrom('tickets').select('title').where('id', '=', ticketId).executeTakeFirstOrThrow();
  assert.equal(describeStoredField(rotated.title).keyVersion, 2);
  assert.equal(await pruneRetiredDeks(db), 1);
  assert.equal(await decrypt('tickets.title', 'tickets', ticketId, 'title', rotated.title), 'Drucker defekt');

  // 6. Blind-Index-Rotation: Index wird neu berechnet, Suche trifft weiter.
  await rotateDek(db, provider(), 'blind-index.users.email', 'ci');
  await reencryptAll({ db, keyProvider: provider(), installationId: inst });
  const blind = await ensureDek(db, provider(), 'blind-index.users.email');
  const userRow = await db.selectFrom('users').select('email_blind_idx').where('id', '=', uid).executeTakeFirstOrThrow();
  assert.equal(userRow.email_blind_idx, computeBlindIndex(blind.rawDek, 'legacy@example.org'));

  // 7. KEK-Rotation: neue KEK, alle DEKs neu umhuellt und an Zweck/Version gebunden, alte KEK entfernt.
  assert.equal(await appendKekVersion(env.KEK_FILE_PATH), 2);
  assert.ok(await rewrapAllDeks(db, provider()) > 0);
  const status = await cryptoStatus(db, provider());
  assert.deepEqual(status.dekKekVersions, [2]); assert.equal(status.unboundWraps, 0);
  assert.deepEqual(await retireKekVersions(env.KEK_FILE_PATH, new Set([2])), [1]);
  assert.equal(await decrypt('tickets.title', 'tickets', ticketId, 'title', rotated.title), 'Drucker defekt');
  // Eine DEK-Zeile laesst sich nicht als DEK eines anderen Zwecks ausgeben (AAD-Bindung).
  const titleRow = await db.selectFrom('data_encryption_keys').select('wrapped_dek').where('purpose', '=', 'tickets.title').where('active', '=', true).executeTakeFirstOrThrow();
  const descriptionRow = await db.selectFrom('data_encryption_keys').select('wrapped_dek').where('purpose', '=', 'tickets.description').executeTakeFirstOrThrow();
  await db.updateTable('data_encryption_keys').set({ wrapped_dek: titleRow.wrapped_dek }).where('purpose', '=', 'tickets.description').execute();
  await assert.rejects(ensureDek(db, provider(), 'tickets.description'));
  await db.updateTable('data_encryption_keys').set({ wrapped_dek: descriptionRow.wrapped_dek }).where('purpose', '=', 'tickets.description').execute();

  // 8. Manipulierte Werte werden gemeldet, nie ueberschrieben.
  await db.updateTable('tickets').set({ waiting_message: Buffer.from('manipuliert') }).where('id', '=', ticketId).execute();
  await rotateDek(db, provider(), 'tickets.waiting_message', 'ci');
  const tampered = await reencryptAll({ db, keyProvider: provider(), installationId: inst });
  assert.equal(tampered.failed, 1);
  assert.equal((await db.selectFrom('tickets').select('waiting_message').where('id', '=', ticketId).executeTakeFirstOrThrow()).waiting_message.toString(), 'manipuliert');
  await assert.rejects(pruneRetiredDeks(db), /nicht neu verschluesselt/);

  // 9. Sitzungszeitzone UTC, auch wenn MariaDB/Node in Europe/Berlin laufen.
  const tz = (await sql`SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS diff`.execute(db)).rows[0];
  assert.equal(tz.tz, '+00:00'); assert.equal(Number(tz.diff), 0);
  const noteId = '55555555-5555-4555-8555-555555555555';
  await db.insertInto('notifications').values({ id: noteId, recipient_user_id: uid, recipient_username: 'legacy', type: 'ci', ticket_id: null, message: await encrypt('notifications.message', 'notifications', noteId, 'message', 'Hallo') }).execute();
  const created = (await db.selectFrom('notifications').select('created_at').where('id', '=', noteId).executeTakeFirstOrThrow()).created_at;
  assert.ok(Math.abs(created.getTime() - Date.now()) < 60_000, `DEFAULT CURRENT_TIMESTAMP in UTC (${created.toISOString()})`);

  // 10. Constraints des Schemas auf echter MariaDB.
  const timerId = '33333333-3333-4333-8333-333333333333';
  await db.insertInto('ticket_work_timers').values({ id: timerId, user_id: uid, ticket_id: ticketId, started_at: new Date(), stopped_at: null }).execute();
  await assert.rejects(db.insertInto('ticket_work_timers').values({ id: 'duplicate', user_id: uid, ticket_id: ticketId, started_at: new Date(), stopped_at: null }).execute());
  await db.deleteFrom('ticket_work_timers').where('id', '=', timerId).execute();
  await db.insertInto('user_passkeys').values({ id: 'case-Sensitive-Key', user_id: uid, public_key: Buffer.from('test'), counter: 0, label: 'CI key', transports_json: '[]' }).execute();
  assert.equal(await db.selectFrom('user_passkeys').select('id').where('id', '=', 'case-sensitive-key').executeTakeFirst(), undefined);
  await db.deleteFrom('user_passkeys').where('user_id', '=', uid).execute();
  await db.updateTable('users').set({ account_valid_until: '2026-10-22' }).where('id', '=', uid).execute();
  const limited = await db.selectFrom('users').select('account_valid_until').where('id', '=', uid).executeTakeFirstOrThrow();
  assert.equal(isAccountExpired(limited.account_valid_until, new Date('2026-10-22T21:59:59Z')), false);
  assert.equal(isAccountExpired(limited.account_valid_until, new Date('2026-10-22T22:00:00Z')), true);
  const uploadOwner = '44444444-4444-4444-8444-444444444444';
  const uploadId = '77777777-7777-4777-8777-777777777777';
  await db.insertInto('users').values({ id: uploadOwner, username: 'upload-owner',
    name_enc: await encrypt('users.name', 'users', uploadOwner, 'name', 'Upload Owner'),
    email_enc: await encrypt('users.email', 'users', uploadOwner, 'email', 'upload-owner@example.org'),
    email_blind_idx: 'b'.repeat(64), password_hash: 'unused', role: 'user', installation_id: inst }).execute();
  const uploadBytes = Buffer.alloc(8 * 1024 * 1024, 65);
  await db.insertInto('file_uploads').values({ id: uploadId, owner_user_id: uploadOwner, ticket_id: ticketId, article_id: null,
    filename: await encrypt('file_uploads.filename', 'file_uploads', uploadId, 'filename', 'private.txt'), mime_type: 'text/plain',
    size_bytes: uploadBytes.length, received_bytes: uploadBytes.length, completed: true }).execute();
  await db.insertInto('file_upload_chunks').values({ upload_id: uploadId, part: 0,
    data_enc: await encrypt('file_uploads.data', 'file_uploads', uploadId + ':0', 'data', uploadBytes.toString('base64')) }).execute();
  await db.deleteFrom('users').where('id', '=', uploadOwner).execute();
  assert.equal((await db.selectFrom('file_uploads').select('owner_user_id').where('id', '=', uploadId).executeTakeFirstOrThrow()).owner_user_id, null);
  const chunk = await db.selectFrom('file_upload_chunks').select('data_enc').where('upload_id', '=', uploadId).executeTakeFirstOrThrow();
  assert.deepEqual(Buffer.from(await decrypt('file_uploads.data', 'file_uploads', uploadId + ':0', 'data', chunk.data_enc), 'base64'), uploadBytes);
  await db.deleteFrom('file_uploads').where('id', '=', uploadId).execute();
  assert.equal((await db.selectFrom('file_upload_chunks').select('part').where('upload_id', '=', uploadId).execute()).length, 0);

  // 11. Dauerhafte Mail-Warteschlange (run_after/attempts haengen an der Sitzungszeitzone).
  const deps = { db, env, keyProvider: provider() };
  await db.updateTable('app_settings').set({ smtp_host: '127.0.0.1', smtp_port: 1, smtp_from: 'test@example.org',
    config_json: JSON.stringify({ emailAdvancedConfig: { transportSecurity: 'opportunistic' } }) }).where('id', '=', 1).execute();
  await queueMail(deps, 'test@example.org', 'Queued subject', 'Private queued body');
  await drainMailQueue(deps);
  const job = await db.selectFrom('jobs').selectAll().where('type', '=', 'smtp.delivery').executeTakeFirstOrThrow();
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 1);
  assert.ok(!job.payload_json.includes('Private queued body'));
  const mail = JSON.parse(await decrypt('jobs.mail_payload', 'jobs', job.idempotency_key, 'mail_payload', Buffer.from(JSON.parse(job.payload_json).ciphertext, 'base64')));
  assert.deepEqual(mail, { to: 'test@example.org', subject: 'Queued subject', text: 'Private queued body' });

  // 12. Enge Rate-Limits zaehlen in der Datenbank und ueberstehen einen Neustart (Review Punkt 10).
  const incr = store => new Promise((resolve, reject) => store.incr('203.0.113.7', (e, r) => e ? reject(e) : resolve(r), 60_000, 5));
  const route = { routeInfo: { method: 'POST', url: '/api/v1/auth/login' } };
  const loginLimit = new (createRateLimitStore(db))().child(route);
  await incr(loginLimit); await incr(loginLimit);
  const afterRestart = new (createRateLimitStore(db))().child(route);
  assert.equal((await incr(afterRestart)).current, 3);
  assert.ok(!(await sql`SELECT rate_key FROM rate_limit_counters`.execute(db)).rows.some(r => r.rate_key.includes('203.0.113.7')), 'IP nicht im Klartext');

  // 13. Neuinstallation ergibt exakt dasselbe Schema wie die aktualisierte Installation
  // (bis auf die bewusst behaltene, nicht mehr genutzte Spalte).
  const upgraded = (await columnsOf()).filter(c => !(c.t === 'installations' && c.c === 'schema_version'));
  await dropAll();
  await syncSchema(db);
  assert.deepEqual(await columnsOf(), upgraded);
  assert.equal(Number((await sql`SELECT COUNT(*) AS n FROM app_settings WHERE id = 1`.execute(db)).rows[0].n), 1);
  console.log(`MariaDB schema sync, upgrade without data loss, format conversion, key rotation, UTC sessions and mail retry: OK (TZ=${process.env.TZ || 'unset'})`);
} finally {
  await db.destroy(); await rm(temp, { recursive: true, force: true });
}
