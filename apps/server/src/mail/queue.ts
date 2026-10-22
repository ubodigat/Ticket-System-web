import { randomUUID } from 'node:crypto';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../db/date.js';
import { isSmtpConfigured, sendMail, type MailDeps } from './mailer.js';

const MAIL_TYPE = 'smtp.delivery';
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const context = (deps: MailDeps, id: string, keyVersion: number) => ({
  installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
  tableName: 'jobs', recordId: id, fieldName: 'mail_payload', keyVersion
});

export async function queueMail(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  if (!await isSmtpConfigured(deps)) throw new Error('smtp_not_configured');
  const id = randomUUID();
  const dek = await ensureDek(deps.db, deps.keyProvider, 'jobs.mail_payload');
  const encrypted = fieldCipher.encryptField(JSON.stringify({ to, subject, text }), dek.rawDek, context(deps, id, dek.keyVersion));
  await deps.db.insertInto('jobs').values({
    type: MAIL_TYPE, idempotency_key: id, payload_json: JSON.stringify({ ciphertext: encrypted.toString('base64') }),
    status: 'queued', max_attempts: MAX_ATTEMPTS, locked_by: null, locked_at: null
  }).execute();
}

export async function queueMailIfConfigured(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  if (await isSmtpConfigured(deps)) await queueMail(deps, to, subject, text);
}

export async function queueUserMail(deps: MailDeps, userId: string, subject: string, text: string, type = 'statusChange'): Promise<void> {
  if (!await isSmtpConfigured(deps)) return;
  const user = await deps.db.selectFrom('users').select(['email_enc', 'account_archived', 'notif_prefs_json', 'role'])
    .where('id', '=', userId).executeTakeFirst();
  if (!user?.email_enc || user.account_archived) return;
  const prefs = user.notif_prefs_json ? JSON.parse(user.notif_prefs_json) : {};
  const settings = await deps.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const config = settings?.config_json ? JSON.parse(settings.config_json) : {};
  const role = user.role === 'user' ? 'user' : 'admin';
  const defaults: Record<string, Partial<Record<'user' | 'admin', boolean>>> = {
    newTicket: { admin: true }, mention: { admin: false }, statusChange: { user: true },
    newMessage: { user: true, admin: false }, ticketClosed: { user: true }, ticketEdited: { user: false }
  };
  const rule = config.notifPolicy?.[type]?.[role] ?? {};
  const enabled = rule.emailLocked ? rule.defaultEmail
    : prefs[type]?.email ?? rule.defaultEmail ?? defaults[type]?.[role] ?? true;
  if (!enabled) return;
  const dek = await ensureDek(deps.db, deps.keyProvider, 'users.email');
  const email = fieldCipher.decryptField(user.email_enc, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users', recordId: userId, fieldName: 'email', keyVersion: dek.keyVersion
  });
  await queueMail(deps, email, subject, text);
}

// A crashed worker's lease is reclaimed. SMTP is at-least-once: a crash after SMTP acceptance
// but before commit can cause a duplicate; no SMTP protocol can provide exactly-once delivery.
export async function drainMailQueue(deps: MailDeps, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LEASE_MS);
  await deps.db.updateTable('jobs').set({ status: 'queued', locked_at: null, locked_by: null })
    .where('type', '=', MAIL_TYPE).where('status', '=', 'running').where('locked_at', '<', cutoff).execute();
  let processed = 0;
  for (let i = 0; i < 20; i++) {
    const owner = randomUUID();
    const job = await deps.db.transaction().execute(async trx => {
      const row = await trx.selectFrom('jobs').selectAll().where('type', '=', MAIL_TYPE)
        .where('status', '=', 'queued').where('run_after', '<=', now)
        .orderBy('id').forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      await trx.updateTable('jobs').set({ status: 'running', locked_by: owner,
        locked_at: mysqlTimestamp(now), attempts: row.attempts + 1, updated_at: mysqlTimestamp(now) })
        .where('id', '=', row.id).execute();
      return row;
    });
    if (!job) break;
    try {
      const dek = await ensureDek(deps.db, deps.keyProvider, 'jobs.mail_payload');
      const envelope = JSON.parse(job.payload_json);
      const payload = JSON.parse(fieldCipher.decryptField(Buffer.from(envelope.ciphertext, 'base64'), dek.rawDek,
        context(deps, job.idempotency_key, dek.keyVersion)));
      await sendMail(deps, payload.to, payload.subject, payload.text);
      await deps.db.updateTable('jobs').set({ status: 'done', payload_json: '{}', locked_at: null, locked_by: null,
        updated_at: mysqlTimestamp() }).where('id', '=', job.id).where('locked_by', '=', owner).execute();
    } catch {
      const attempts = job.attempts + 1;
      await deps.db.updateTable('jobs').set({ status: attempts >= job.max_attempts ? 'dead' : 'queued',
        locked_at: null, locked_by: null, updated_at: mysqlTimestamp(),
        run_after: mysqlTimestamp(new Date(now.getTime() + Math.min(3600, 30 * 2 ** attempts) * 1000)) })
        .where('id', '=', job.id).where('locked_by', '=', owner).execute();
      console.error('SMTP queue delivery failed', { jobId: job.id, attempts });
    }
    processed++;
  }
  // Retain exhausted encrypted payloads seven days for diagnosis, never indefinitely.
  await deps.db.deleteFrom('jobs').where('type', '=', MAIL_TYPE).where('status', 'in', ['done', 'dead'])
    .where('updated_at', '<', new Date(now.getTime() - 7 * 86400_000)).execute();
  return processed;
}

export function startMailQueue(deps: MailDeps): () => Promise<void> {
  let current: Promise<unknown> | undefined;
  const tick = () => {
    if (current) return;
    current = drainMailQueue(deps).catch(() => console.error('SMTP queue unavailable'))
      .finally(() => { current = undefined; });
  };
  const timer = setInterval(tick, 5000);
  tick();
  return async () => { clearInterval(timer); await current; };
}
