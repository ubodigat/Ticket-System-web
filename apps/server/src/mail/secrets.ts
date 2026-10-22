import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import type { MailDeps } from './mailer.js';

export const MAIL_SECRET_KEYS = ['smimePrivateKeyPem', 'smimePassphrase', 'dkimPrivateKeyPem'] as const;
const context = (deps: MailDeps, keyVersion: number) => ({
  installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
  tableName: 'app_settings', recordId: '1', fieldName: 'mail_secrets', keyVersion
});
export async function readMailSecrets(deps: MailDeps, stored: Buffer | null): Promise<Record<string, string>> {
  if (!stored) return {};
  const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.mail_secrets');
  return JSON.parse(fieldCipher.decryptField(stored, dek.rawDek, context(deps, dek.keyVersion)));
}
export async function encryptMailSecrets(deps: MailDeps, secrets: Record<string, string>): Promise<Buffer> {
  const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.mail_secrets');
  return fieldCipher.encryptField(JSON.stringify(secrets), dek.rawDek, context(deps, dek.keyVersion));
}

export async function migrateMailSecrets(deps: MailDeps): Promise<void> {
  await deps.db.transaction().execute(async trx => {
    const scoped = { ...deps, db: trx };
    const row = await trx.selectFrom('app_settings').select(['config_json', 'mail_secrets_enc'])
      .where('id', '=', 1).forUpdate().executeTakeFirst();
    if (!row?.config_json) return;
    const config = JSON.parse(row.config_json);
    const email = config.emailAdvancedConfig;
    if (!email || !MAIL_SECRET_KEYS.some(key => Object.hasOwn(email, key))) return;
    const secrets = await readMailSecrets(scoped, row.mail_secrets_enc);
    for (const key of MAIL_SECRET_KEYS) {
      if (typeof email[key] === 'string' && email[key]) secrets[key] = email[key];
      delete email[key];
    }
    await trx.updateTable('app_settings').set({ config_json: JSON.stringify(config),
      mail_secrets_enc: await encryptMailSecrets(scoped, secrets) }).where('id', '=', 1).execute();
  });
}
