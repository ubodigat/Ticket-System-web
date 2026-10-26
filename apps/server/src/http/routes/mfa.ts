/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 MFA-Selbstverwaltung (TOTP). QR-Code wird serverseitig erzeugt (qrcode-Paket) -- es gibt
// keinen Aufruf an einen externen Dienst wie api.qrserver.com (Altsystem-Mangel, siehe README).
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { requireSession } from './session.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { verifyAndConsumeTotp } from '../../domain/totp.js';
import { loadSecurityPolicy } from '../../domain/securityPolicy.js';
import { isSourceLocked, recordSourceFailure, clearSourceFailures } from '../../domain/loginThrottle.js';
import { queueUserMail } from '../../mail/queue.js';
import { routeError } from './routeError.js';

export interface MfaRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

function totpCtx(deps: MfaRouteDeps, userId: string, keyVersion: number) {
  return {
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users',
    recordId: userId,
    fieldName: 'totp_secret',
    keyVersion
  };
}

// Security-Audit R-12: Passwortwechsel und 2FA-Setup/-Abschaltung prüften das aktuelle Passwort
// bisher ohne eigenes Rate-Limit und ohne Fehlversuchszähler -- wer eine Session übernimmt
// (z.B. an einem unbeaufsichtigten Rechner), konnte das Passwort dort beliebig oft pro Minute
// raten. Gleiche Bausteine wie beim Login (R-11): eigenes Rate-Limit pro Session/IP UND eine
// Pro-Quellnetz-Sperre über denselben Mechanismus wie recordFailedLogin.
const stepUpRateLimit = { config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req: any) => req.ticketSession?.uid ?? req.ip } } };

export async function verifyStepUpPassword(app: FastifyInstance, userId: string, ip: string, passwordHash: string, password: string): Promise<'ok' | 'locked' | 'wrong'> {
  if (await isSourceLocked(app.db, userId, ip)) return 'locked';
  const ok = await argon2.verify(passwordHash, password);
  if (!ok) {
    const policy = await loadSecurityPolicy(app.db);
    await recordSourceFailure(app.db, userId, ip, policy);
    return 'wrong';
  }
  await clearSourceFailures(app.db, userId);
  return 'ok';
}

export function registerMfaRoutes(app: FastifyInstance, deps: MfaRouteDeps): void {
  // POST /api/v2/mfa/setup - erzeugt ein neues Secret für das EIGENE Konto. Solange 2FA noch
  // nicht aktiv ist, läuft das wie bisher direkt über totp_secret_enc. Ist 2FA aber bereits
  // aktiv, verlangt der Request zusätzlich das aktuelle Passwort (Step-up, Security-Audit B3 --
  // sonst könnte eine kurz entwendete Session die bestehende 2FA lautlos abschalten, da
  // totp_secret_enc sofort überschrieben und totp_enabled sofort auf false gesetzt würde) und
  // das neue Secret landet nur in totp_pending_secret_enc, bis /confirm es per gültigem Code
  // übernimmt -- das aktive Secret bleibt bis dahin unverändert in Kraft.
  app.post('/api/v2/mfa/setup', stepUpRateLimit, async (req, reply) => {
    try {
      const session = requireSession(req);
      const user = await app.db.selectFrom('users')
        .select(['username', 'totp_enabled', 'password_hash'])
        .where('id', '=', session.uid).executeTakeFirstOrThrow();

      if (user.totp_enabled) {
        const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
        if (!parsed.success) return reply.code(401).send({ error: 'password_required' });
        const result = await verifyStepUpPassword(app, session.uid, req.ip, user.password_hash, parsed.data.password);
        if (result !== 'ok') return reply.code(401).send({ error: result === 'locked' ? 'too_many_attempts' : 'password_required' });
      }

      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: 'Ticket-System',
        label: user.username,
        secret
      });

      const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const encrypted = fieldCipher.encryptField(secret.base32, dek.rawDek, totpCtx(deps, session.uid, dek.keyVersion));
      if (user.totp_enabled) {
        await app.db.updateTable('users').set({ totp_pending_secret_enc: encrypted }).where('id', '=', session.uid).execute();
      } else {
        await app.db.updateTable('users').set({ totp_secret_enc: encrypted, totp_pending_secret_enc: null, totp_enabled: false }).where('id', '=', session.uid).execute();
      }

      const qrDataUrl = await QRCode.toDataURL(totp.toString(), { margin: 1, width: 240 });
      return reply.send({ secret: secret.base32, qrDataUrl });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/mfa/confirm - erster Code nach dem Setup bestätigt die Einrichtung. Liegt ein
  // Secret in totp_pending_secret_enc (Neueinrichtung bei bereits aktiver 2FA, siehe /setup
  // oben), wird DAS bestätigt und übernimmt das aktive Secret -- sonst wie bisher das frisch
  // erzeugte, noch nicht aktive totp_secret_enc.
  app.post('/api/v2/mfa/confirm', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = z.object({ code: z.string().trim().length(6) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const user = await app.db.selectFrom('users').select(['totp_secret_enc', 'totp_pending_secret_enc']).where('id', '=', session.uid).executeTakeFirst();
      const pendingEnc = user?.totp_pending_secret_enc ?? null;
      const targetEnc = pendingEnc ?? user?.totp_secret_enc ?? null;
      if (!targetEnc) return reply.code(409).send({ error: 'no_pending_setup' });

      const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const secret = fieldCipher.decryptField(targetEnc, dek.rawDek, totpCtx(deps, session.uid, dek.keyVersion));
      if (!(await verifyAndConsumeTotp(app.db, session.uid, secret, parsed.data.code))) {
        return reply.code(401).send({ error: 'invalid_code' });
      }

      if (pendingEnc) {
        await app.db.updateTable('users').set({ totp_secret_enc: pendingEnc, totp_pending_secret_enc: null, totp_enabled: true }).where('id', '=', session.uid).execute();
      } else {
        await app.db.updateTable('users').set({ totp_enabled: true }).where('id', '=', session.uid).execute();
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/mfa/disable - erfordert Passwort UND gültigen TOTP-Code (Step-up, docs/SPEC.md
  // §8). Security-Audit R-12: bisher reichte allein das Passwort -- eine übernommene Session
  // konnte den zweiten Faktor damit selbst abschalten, ohne ihn je besessen zu haben, und ohne
  // jede Spur im Audit-Log. Jetzt zusätzlich ein gültiger TOTP-Code, ein Audit-Eintrag und eine
  // Warn-Mail an das eigene Konto.
  app.post('/api/v2/mfa/disable', stepUpRateLimit, async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = z.object({ password: z.string().min(1), code: z.string().trim().length(6) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const passkey = await app.db.selectFrom('user_passkeys').select('id').where('user_id', '=', session.uid).executeTakeFirst();
      if (passkey) return reply.code(409).send({ error: 'remove_passkeys_before_disabling_totp' });
      const config = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
      const sec = JSON.parse(config?.config_json || '{}').securityConfig || {};
      const applies = !sec.mfaRoles || sec.mfaRoles === 'all' || (sec.mfaRoles === 'admin' ? session.role !== 'user' : session.role === 'user');
      if (applies && ['totp', 'both'].includes(sec.mfaMode)) return reply.code(409).send({ error: 'totp_required_by_policy' });

      const user = await app.db.selectFrom('users').select(['password_hash', 'totp_secret_enc']).where('id', '=', session.uid).executeTakeFirstOrThrow();
      const result = await verifyStepUpPassword(app, session.uid, req.ip, user.password_hash, parsed.data.password);
      if (result !== 'ok') return reply.code(401).send({ error: result === 'locked' ? 'too_many_attempts' : 'wrong_password' });

      if (!user.totp_secret_enc) return reply.code(409).send({ error: 'mfa_not_enabled' });
      const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const secret = fieldCipher.decryptField(user.totp_secret_enc, dek.rawDek, totpCtx(deps, session.uid, dek.keyVersion));
      if (!(await verifyAndConsumeTotp(app.db, session.uid, secret, parsed.data.code))) {
        return reply.code(401).send({ error: 'invalid_code' });
      }

      await app.db.updateTable('users').set({ totp_enabled: false, totp_secret_enc: null, totp_pending_secret_enc: null }).where('id', '=', session.uid).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'mfa.disabled', target_type: 'user', target_id: session.uid, detail_json: null
      }).execute();
      await queueUserMail(
        { db: app.db, env: deps.env, keyProvider: deps.keyProvider }, session.uid,
        'Zwei-Faktor-Anmeldung deaktiviert',
        'Für dein Konto wurde die Zwei-Faktor-Anmeldung deaktiviert. Warst du das nicht, melde dich sofort beim Support.',
        'security'
      );
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
