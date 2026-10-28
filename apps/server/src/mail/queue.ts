import { randomUUID } from 'node:crypto';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../db/date.js';
import { isSmtpConfigured, sendMail, type MailDeps } from './mailer.js';
import { isAccountExpired } from '../domain/accountValidity.js';

const MAIL_TYPE = 'smtp.delivery';
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const context = (deps: MailDeps, id: string, keyVersion: number) => ({
  installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
  tableName: 'jobs', recordId: id, fieldName: 'mail_payload', keyVersion
});

export async function queueMail(deps: MailDeps, to: string, subject: string, text: string, variables?: Record<string, string>): Promise<void> {
  if (!await isSmtpConfigured(deps)) throw new Error('smtp_not_configured');
  const id = randomUUID();
  const dek = await ensureDek(deps.db, deps.keyProvider, 'jobs.mail_payload');
  const encrypted = fieldCipher.encryptField(JSON.stringify({ to, subject, text, ...(variables ? { variables } : {}) }), dek.rawDek, context(deps, id, dek.keyVersion));
  await deps.db.insertInto('jobs').values({
    type: MAIL_TYPE, idempotency_key: id, payload_json: JSON.stringify({ ciphertext: encrypted.toString('base64') }),
    status: 'queued', max_attempts: MAX_ATTEMPTS, locked_by: null, locked_at: null
  }).execute();
}

export async function queueMailIfConfigured(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  if (await isSmtpConfigured(deps)) await queueMail(deps, to, subject, text);
}

// Spiegelt Store.defaultNotifPolicy() im Frontend: wer welchen Kanal selbst abschalten darf und
// was gilt, solange weder Richtlinie noch persoenliche Einstellung etwas festlegen.
type NotifRule = { appLocked?: boolean; emailLocked?: boolean; defaultApp?: boolean; defaultEmail?: boolean };
const DEFAULT_NOTIF_POLICY: Record<string, Partial<Record<'user' | 'admin', NotifRule>>> = {
  newTicket: { admin: { appLocked: true, emailLocked: false, defaultApp: true, defaultEmail: true } },
  ticketAssigned: { admin: { appLocked: true, emailLocked: false, defaultApp: true, defaultEmail: true } },
  mention: { admin: { appLocked: true, emailLocked: false, defaultApp: true, defaultEmail: false } },
  statusChange: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true } },
  newMessage: {
    user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true },
    admin: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false }
  },
  ticketClosed: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true } },
  ticketEdited: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false } }
};

export async function resolveNotificationPrefs(db: MailDeps['db'], user: { role: string; notif_prefs_json: string | null },
  type: string): Promise<{ app: boolean; email: boolean }> {
  let prefs: Record<string, { app?: unknown; email?: unknown }> = {};
  try { prefs = user.notif_prefs_json ? JSON.parse(user.notif_prefs_json) : {}; } catch { prefs = {}; }
  const settings = await db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  let config: { notifPolicy?: Record<string, Record<string, NotifRule>> } = {};
  try { config = settings?.config_json ? JSON.parse(settings.config_json) : {}; } catch { config = {}; }
  const role = user.role === 'user' ? 'user' : 'admin';
  const base = DEFAULT_NOTIF_POLICY[type]?.[role];
  const saved = config.notifPolicy?.[type]?.[role];
  // Nicht personalisierbare Ereignisse (Genehmigungen, Aufgaben, Abwesenheit, ...) immer zustellen.
  if (!base && !saved) return { app: true, email: true };
  const rule: NotifRule = { ...base, ...saved };
  const pick = (channel: 'app' | 'email') => {
    const locked = channel === 'app' ? rule.appLocked : rule.emailLocked;
    const fallback = (channel === 'app' ? rule.defaultApp : rule.defaultEmail) ?? true;
    if (locked) return fallback;
    const personal = prefs[type]?.[channel];
    return typeof personal === 'boolean' ? personal : fallback;
  };
  return { app: pick('app'), email: pick('email') };
}

export async function queueUserMail(deps: MailDeps, userId: string, subject: string, text: string, type = 'statusChange'): Promise<void> {
  if (!await isSmtpConfigured(deps)) return;
  const user = await deps.db.selectFrom('users').select(['email_enc', 'name_enc', 'username', 'account_archived', 'locked_permanent', 'account_valid_until', 'notif_prefs_json', 'role'])
    .where('id', '=', userId).executeTakeFirst();
  // Security-Audit R-15: bisher ging eine Benachrichtigung mit Ticketinhalten auch an dauerhaft
  // gesperrte oder per Ablaufdatum beendete Konten (z.B. ausgeschiedene Mitarbeiter, deren
  // private Adresse hinterlegt war) -- archiviert war bisher der einzige geprüfte Zustand.
  if (!user?.email_enc || user.account_archived || user.locked_permanent || isAccountExpired(user.account_valid_until)) return;
  const enabled = (await resolveNotificationPrefs(deps.db, user, type)).email;
  // Sicherheitshinweise (2FA-Geraetewechsel, E-Mail-Aenderung, ...) duerfen weder per eigener
  // Einstellung noch per Richtlinie abschaltbar sein -- sonst koennte eine uebernommene Sitzung sie
  // zuerst deaktivieren und danach unbemerkt Faktoren austauschen.
  if (!enabled && type !== 'security') return;
  const dek = await ensureDek(deps.db, deps.keyProvider, 'users.email');
  const email = fieldCipher.decryptField(user.email_enc, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users', recordId: userId, fieldName: 'email', keyVersion: dek.keyVersion
  });
  let name = user.username || email;
  if (user.name_enc) {
    const nameDek = await ensureDek(deps.db, deps.keyProvider, 'users.name');
    name = fieldCipher.decryptField(user.name_enc, nameDek.rawDek, { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'users', recordId: userId, fieldName: 'name', keyVersion: nameDek.keyVersion });
  }
  await queueMail(deps, email, subject, text, { recipientName: name, username: user.username || '' });
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
      if (payload.variables) await sendMail(deps, payload.to, payload.subject, payload.text, payload.variables);
      else await sendMail(deps, payload.to, payload.subject, payload.text);
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
