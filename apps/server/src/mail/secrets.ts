import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import type { MailDeps } from './mailer.js';

export const MAIL_SECRET_KEYS = ['smimePrivateKeyPem', 'smimePassphrase', 'dkimPrivateKeyPem'] as const;
const context = (deps: MailDeps) => ({
  installationId: deps.env.INSTALLATION_ID,
  tableName: 'app_settings', recordId: '1', fieldName: 'mail_secrets'
});
export async function readMailSecrets(deps: MailDeps, stored: Buffer | null): Promise<Record<string, string>> {
  if (!stored) return {};
  const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.mail_secrets');
  return JSON.parse(fieldCipher.decryptField(stored, dek, context(deps)));
}
export async function encryptMailSecrets(deps: MailDeps, secrets: Record<string, string>): Promise<Buffer> {
  const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.mail_secrets');
  return fieldCipher.encryptField(JSON.stringify(secrets), dek, context(deps));
}

