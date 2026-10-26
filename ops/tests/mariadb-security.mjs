// Destructive ONLY inside the explicitly named disposable CI test database.
import assert from 'node:assert/strict';
import { readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Migrator } from '../../node_modules/kysely/dist/migration/index.js';
import { loadEnv } from '../../apps/server/dist/config/env.js';
import { createDb } from '../../apps/server/dist/db/connection.js';
import { createFileKeyProvider, generateNewKekMaterial } from '../../apps/server/dist/crypto/keyProvider.js';
import { ensureDek } from '../../apps/server/dist/crypto/dekService.js';
import { fieldCipher } from '../../apps/server/dist/crypto/fieldCrypto.js';
import { reencryptLegacyPlaintext } from '../../apps/server/dist/db/reencryptLegacy.js';
import { migrateMailSecrets, readMailSecrets } from '../../apps/server/dist/mail/secrets.js';
import { queueMail, drainMailQueue } from '../../apps/server/dist/mail/queue.js';
import { isAccountExpired } from '../../apps/server/dist/domain/accountValidity.js';

assert.equal(process.env.DB_NAME, 'ticketsystem_security_ci', 'Use only the disposable CI database');
const temp = await mkdtemp(join(tmpdir(), 'ticket-security-ci-'));
process.env.KEK_FILE_PATH = join(temp, 'app.kek');
await writeFile(process.env.KEK_FILE_PATH, generateNewKekMaterial(), { mode: 0o600 });
const env = loadEnv();
const db = createDb(env, 'migrate');
const keyProvider = createFileKeyProvider(env.KEK_FILE_PATH);
const deps = { db, env, keyProvider };
const migrations = {};
for (const name of (await readdir(new URL('../../apps/server/dist/db/migrations/', import.meta.url))).filter(n => /^\d+.*\.js$/.test(n))) {
  const module = await import(new URL('../../apps/server/dist/db/migrations/' + name, import.meta.url));
  migrations[name.slice(0, -3)] = Object.values(module)[0];
}
const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
const migrate = async target => { const result = target ? await migrator.migrateTo(target) : await migrator.migrateToLatest(); if (result.error) throw result.error; };
const encrypt = async (tableName, recordId, fieldName, value, purpose = `${tableName}.${fieldName}`) => {
  const dek = await ensureDek(db, keyProvider, purpose);
  return fieldCipher.encryptField(value, dek.rawDek, { installationId: env.INSTALLATION_ID, schemaVersion: env.SCHEMA_VERSION,
    tableName, recordId, fieldName, keyVersion: dek.keyVersion });
};
const decrypt = async (tableName, recordId, fieldName, value) => {
  const dek = await ensureDek(db, keyProvider, `${tableName}.${fieldName}`);
  return fieldCipher.decryptField(value, dek.rawDek, { installationId: env.INSTALLATION_ID, schemaVersion: env.SCHEMA_VERSION,
    tableName, recordId, fieldName, keyVersion: dek.keyVersion });
};
try {
  await migrate('0037_outlook_calendar_events');
  const uid = '11111111-1111-4111-8111-111111111111';
  const ticketId = '22222222-2222-4222-8222-222222222222';
  await db.insertInto('installations').values({ id: env.INSTALLATION_ID, schema_version: env.SCHEMA_VERSION }).execute();
  await db.insertInto('users').values({ id: uid, username: 'legacy', name_enc: await encrypt('users', uid, 'name', 'Legacy'),
    email_enc: await encrypt('users', uid, 'email', 'legacy@example.org'), email_blind_idx: 'a'.repeat(64), password_hash: 'unused', role: 'superadmin', installation_id: env.INSTALLATION_ID,
    phone: Buffer.from('0123456789') }).execute();
  await db.insertInto('tickets').values({ id: ticketId, ticket_number: '00001',
    title: await encrypt('tickets', ticketId, 'title', 'Legacy title'), description: await encrypt('tickets', ticketId, 'description', 'Description'),
    created_by_user_id: uid, created_by_username: 'legacy', status: 'Neu', priority: 'Normal', type: 'ticket',
    custom_fields_json: JSON.stringify({ private: 'Sensitive custom field' }), waiting_message: Buffer.from('Legacy pending question'),
    installation_id: env.INSTALLATION_ID }).execute();
  await db.insertInto('recurring_ticket_rules').values({ id: 'rule', title: 'Legacy rule', description: 'Legacy rule description',
    interval_unit: 'day', interval_count: 1, next_run_at: new Date(), created_by_user_id: uid }).execute();
  await db.insertInto('account_requests').values({ id: 'request', name: await encrypt('account_requests', 'request', 'name', 'Legacy'),
    email: await encrypt('account_requests', 'request', 'email', 'legacy@example.org'), company: 'Private company', reason: 'Sensitive reason',
    status: 'pending', installation_id: env.INSTALLATION_ID }).execute();
  await db.updateTable('app_settings').set({ config_json: JSON.stringify({ emailAdvancedConfig: {
    smimePrivateKeyPem: 'PRIVATE KEY', smimePassphrase: 'Passphrase', dkimPrivateKeyPem: 'DKIM KEY'
  } }) }).where('id', '=', 1).execute();
  await migrate();
  // Exercise the actual MariaDB types/constraints introduced for personal workspace/MFA.
  const pref = await encrypt('user_preferences', uid, 'value', JSON.stringify({ bgType: 'image', bgValue: 'private image', collapsedSections: { 'sys-security:0': true } }), 'users.preferences');
  await db.insertInto('user_preferences').values({ user_id: uid, value_enc: pref }).execute();
  assert.ok(Buffer.isBuffer((await db.selectFrom('user_preferences').selectAll().where('user_id', '=', uid).executeTakeFirstOrThrow()).value_enc));
  const timerId = '33333333-3333-4333-8333-333333333333';
  await db.insertInto('ticket_work_timers').values({ id: timerId, user_id: uid, ticket_id: ticketId, started_at: new Date(), stopped_at: null }).execute();
  await assert.rejects(db.insertInto('ticket_work_timers').values({ id: 'duplicate', user_id: uid, ticket_id: ticketId, started_at: new Date(), stopped_at: null }).execute());
  await db.updateTable('ticket_work_timers').set({ stopped_at: new Date() }).where('id', '=', timerId).execute();
  assert.ok((await db.selectFrom('ticket_work_timers').selectAll().where('id', '=', timerId).executeTakeFirstOrThrow()).stopped_at instanceof Date);
  await db.deleteFrom('ticket_work_timers').where('id', '=', timerId).execute();
  await db.insertInto('user_passkeys').values({ id: 'case-Sensitive-Key', user_id: uid, public_key: Buffer.from('test'), counter: 0, label: 'CI key', transports_json: '[]' }).execute();
  assert.equal(await db.selectFrom('user_passkeys').select('id').where('id', '=', 'case-sensitive-key').executeTakeFirst(), undefined);
  await db.deleteFrom('user_passkeys').where('user_id', '=', uid).execute();
  await db.updateTable('users').set({ account_valid_until: '2026-10-22' }).where('id', '=', uid).execute();
  const limitedUser = await db.selectFrom('users').select('account_valid_until').where('id', '=', uid).executeTakeFirstOrThrow();
  assert.equal(isAccountExpired(limitedUser.account_valid_until, new Date('2026-10-22T21:59:59Z')), false);
  assert.equal(isAccountExpired(limitedUser.account_valid_until, new Date('2026-10-22T22:00:00Z')), true);
  await db.updateTable('users').set({ account_valid_until: null }).where('id', '=', uid).execute();
  // Verify the chunk schema on a real upgraded MariaDB, including retention after
  // deletion of an uploader and cleanup of blocks when an upload is removed.
  const uploadOwner = '44444444-4444-4444-8444-444444444444';
  const uploadId = '77777777-7777-4777-8777-777777777777';
  await db.insertInto('users').values({ id: uploadOwner, username: 'upload-owner',
    name_enc: await encrypt('users', uploadOwner, 'name', 'Upload Owner'),
    email_enc: await encrypt('users', uploadOwner, 'email', 'upload-owner@example.org'),
    email_blind_idx: 'b'.repeat(64), password_hash: 'unused', role: 'user', installation_id: env.INSTALLATION_ID }).execute();
  const uploadBytes = Buffer.alloc(8 * 1024 * 1024, 65);
  uploadBytes.write('Private chunked attachment');
  await db.insertInto('file_uploads').values({ id: uploadId, owner_user_id: uploadOwner, ticket_id: ticketId, article_id: null,
    filename: await encrypt('file_uploads', uploadId, 'filename', 'private.txt'), mime_type: 'text/plain',
    size_bytes: uploadBytes.length, received_bytes: uploadBytes.length, completed: true }).execute();
  await db.insertInto('file_upload_chunks').values({ upload_id: uploadId, part: 0,
    data_enc: await encrypt('file_uploads', uploadId + ':0', 'data', uploadBytes.toString('base64')) }).execute();
  await db.deleteFrom('users').where('id', '=', uploadOwner).execute();
  assert.equal((await db.selectFrom('file_uploads').select('owner_user_id').where('id', '=', uploadId).executeTakeFirstOrThrow()).owner_user_id, null);
  const uploadChunk = await db.selectFrom('file_upload_chunks').select('data_enc').where('upload_id', '=', uploadId).executeTakeFirstOrThrow();
  assert.ok(Buffer.isBuffer(uploadChunk.data_enc));
  assert.deepEqual(Buffer.from(await decrypt('file_uploads', uploadId + ':0', 'data', uploadChunk.data_enc), 'base64'), uploadBytes);
  await db.deleteFrom('file_uploads').where('id', '=', uploadId).execute();
  assert.equal((await db.selectFrom('file_upload_chunks').select('part').where('upload_id', '=', uploadId).execute()).length, 0);
  await migrateMailSecrets(deps);
  const first = await reencryptLegacyPlaintext(db, env, keyProvider);
  assert.ok(first.reencrypted >= 6);
  const row = await db.selectFrom('tickets').selectAll().where('id', '=', ticketId).executeTakeFirstOrThrow();
  assert.equal(await decrypt('tickets', ticketId, 'custom_fields_json', row.custom_fields_json), JSON.stringify({ private: 'Sensitive custom field' }));
  assert.equal(await decrypt('tickets', ticketId, 'waiting_message', row.waiting_message), 'Legacy pending question');
  const settings = await db.selectFrom('app_settings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  assert.equal(typeof settings.config_json, 'string', 'JSON columns must follow the application string contract');
  assert.ok(!settings.config_json.includes('PRIVATE KEY'));
  assert.equal((await readMailSecrets(deps, settings.mail_secrets_enc)).smimePassphrase, 'Passphrase');
  const second = await reencryptLegacyPlaintext(db, env, keyProvider);
  assert.equal(second.reencrypted, 0);
  await db.updateTable('tickets').set({ waiting_message: Buffer.from('Tampered after migration') }).where('id', '=', ticketId).execute();
  await assert.rejects(reencryptLegacyPlaintext(db, env, keyProvider));
  await db.updateTable('app_settings').set({ smtp_host: '127.0.0.1', smtp_port: 1, smtp_from: 'test@example.org',
    config_json: JSON.stringify({ emailAdvancedConfig: { transportSecurity: 'opportunistic' } }) }).where('id', '=', 1).execute();
  await queueMail(deps, 'test@example.org', 'Queued subject', 'Private queued body');
  await drainMailQueue(deps);
  const job = await db.selectFrom('jobs').selectAll().where('type', '=', 'smtp.delivery').executeTakeFirstOrThrow();
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 1);
  assert.equal(typeof job.payload_json, 'string', 'Mail queue JSON must be returned as a string');
  assert.ok(!job.payload_json.includes('Private queued body'));
  const envelope = JSON.parse(job.payload_json);
  assert.equal(typeof envelope.ciphertext, 'string');
  const mail = JSON.parse(await decrypt('jobs', job.idempotency_key, 'mail_payload', Buffer.from(envelope.ciphertext, 'base64')));
  assert.deepEqual(mail, { to: 'test@example.org', subject: 'Queued subject', text: 'Private queued body' });
  console.log('MariaDB upgrade, encryption, authenticated migration checkpoints and durable mail retry: OK');
} finally {
  await db.destroy(); await rm(temp, { recursive: true, force: true });
}
