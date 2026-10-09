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
import { z } from 'zod';
import * as argon2 from 'argon2';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { requireSession } from './session.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
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

export function registerMfaRoutes(app: FastifyInstance, deps: MfaRouteDeps): void {
  // POST /api/v2/mfa/setup - erzeugt ein neues Secret für das EIGENE Konto. Wird noch NICHT
  // aktiv (totp_enabled bleibt false), bis /confirm den ersten Code bestätigt -- verhindert,
  // dass ein nie abgeschlossener Setup-Versuch versehentlich als aktiver Schutz zählt.
  app.post('/api/v2/mfa/setup', async (req, reply) => {
    try {
      const session = requireSession(req);
      const user = await app.db.selectFrom('users').select('username').where('id', '=', session.uid).executeTakeFirstOrThrow();

      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: 'Ticket-System',
        label: user.username,
        secret
      });

      const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const encrypted = fieldCipher.encryptField(secret.base32, dek.rawDek, totpCtx(deps, session.uid, dek.keyVersion));
      await app.db.updateTable('users').set({ totp_secret_enc: encrypted, totp_enabled: false }).where('id', '=', session.uid).execute();

      const qrDataUrl = await QRCode.toDataURL(totp.toString(), { margin: 1, width: 240 });
      return reply.send({ secret: secret.base32, qrDataUrl });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/mfa/confirm - erster Code nach dem Setup bestätigt die Einrichtung.
  app.post('/api/v2/mfa/confirm', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = z.object({ code: z.string().trim().length(6) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const user = await app.db.selectFrom('users').select(['totp_secret_enc']).where('id', '=', session.uid).executeTakeFirst();
      if (!user?.totp_secret_enc) return reply.code(409).send({ error: 'no_pending_setup' });

      const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
      const secret = fieldCipher.decryptField(user.totp_secret_enc, dek.rawDek, totpCtx(deps, session.uid, dek.keyVersion));
      const totp = new TOTP({ secret, digits: 6, period: 30 });
      if (totp.validate({ token: parsed.data.code, window: 1 }) === null) {
        return reply.code(401).send({ error: 'invalid_code' });
      }

      await app.db.updateTable('users').set({ totp_enabled: true }).where('id', '=', session.uid).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/mfa/disable - erfordert das aktuelle Passwort (Step-up für eine
  // sicherheitsrelevante Aktion, docs/SPEC.md §8).
  app.post('/api/v2/mfa/disable', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const user = await app.db.selectFrom('users').select(['password_hash']).where('id', '=', session.uid).executeTakeFirstOrThrow();
      const ok = await argon2.verify(user.password_hash, parsed.data.password);
      if (!ok) return reply.code(401).send({ error: 'wrong_password' });

      await app.db.updateTable('users').set({ totp_enabled: false, totp_secret_enc: null }).where('id', '=', session.uid).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
