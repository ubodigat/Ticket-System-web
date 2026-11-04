// Step-up vor besonders folgenreichen Superadmin-Aktionen (Update, Rollback, Migration,
// Datenbank-Sicherung): aktuelles Passwort plus TOTP-Code bei aktiver 2FA -- eine gekaperte
// Session oder ein offen gelassener Browser reicht allein nicht.
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyAndConsumeTotp } from '../../domain/totp.js';
import { isSourceLocked, recordSourceFailure } from '../../domain/loginThrottle.js';
import { loadSecurityPolicy } from '../../domain/securityPolicy.js';
import { secondFactorWait, noteSecondFactorFailure, clearSecondFactorFailures } from '../../domain/secondFactorThrottle.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';

const stepUpSchema = z.object({
  password: z.string().min(1).max(512),
  totp_code: z.string().trim().length(6).optional()
});

// Wirft { statusCode, message } bei fehlgeschlagenem Step-up -- vom Aufrufer per routeError
// behandelt. requireTotp: Aktion nur mit eingerichteter 2FA erlaubt (z.B. Datenbank-Sicherung).
export async function requireStepUp(app: FastifyInstance, deps: { env: Env; keyProvider: KeyProvider }, req: FastifyRequest,
  uid: string, options: { requireTotp?: boolean } = {}): Promise<void> {
  const parsed = stepUpSchema.safeParse(req.body);
  if (!parsed.success) throw { statusCode: 401, message: 'step_up_required' };

  const user = await app.db.selectFrom('users')
    .select(['password_hash', 'totp_enabled', 'totp_secret_enc'])
    .where('id', '=', uid).executeTakeFirstOrThrow();

  if (await isSourceLocked(app.db, uid, req.ip)) throw { statusCode: 429, message: 'too_many_attempts' };
  const passwordOk = await argon2.verify(user.password_hash, parsed.data.password).catch(() => false);
  if (!passwordOk) {
    await recordSourceFailure(app.db, uid, req.ip, await loadSecurityPolicy(app.db));
    throw { statusCode: 401, message: 'wrong_password' };
  }

  if (options.requireTotp && !user.totp_enabled) throw { statusCode: 403, message: 'mfa_required' };
  if (user.totp_enabled) {
    if (!parsed.data.totp_code) throw { statusCode: 401, message: 'totp_code_required' };
    if (!user.totp_secret_enc) throw { statusCode: 401, message: 'totp_code_required' };
    if (await secondFactorWait(app.db, uid)) throw { statusCode: 429, message: 'too_many_attempts' };
    const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
    const secret = fieldCipher.decryptField(user.totp_secret_enc, dek, {
      installationId: deps.env.INSTALLATION_ID,
      tableName: 'users', recordId: uid, fieldName: 'totp_secret'
    });
    const totpOk = await verifyAndConsumeTotp(app.db, uid, secret, parsed.data.totp_code);
    if (!totpOk) {
      await noteSecondFactorFailure({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }, uid, req.ip);
      throw { statusCode: 401, message: 'invalid_totp_code' };
    }
    await clearSecondFactorFailures(app.db, uid);
  }
}
