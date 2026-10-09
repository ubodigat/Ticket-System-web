/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher, computeBlindIndex } from '../../crypto/fieldCrypto.js';
import { SETUP_HTML, SETUP_CSS, SETUP_JS } from '../assets/setupPage.js';

// Setup-Wizard gemäß docs/SPEC.md §5: erscheint einmalig nach der Installation, fragt
// Unternehmenseinstellungen + ersten (superadmin-)Benutzer ab. Danach ist die Seite gesperrt
// (409), sie lässt sich nicht erneut ausführen, um ein bestehendes System zu übernehmen.
const setupRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(255),
  portalName: z.string().trim().min(1).max(255),
  adminUsername: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich erlaubt.'),
  adminEmail: z.string().trim().toLowerCase().email().max(255),
  adminName: z.string().trim().min(1).max(255),
  // Argon2id-Passwortrichtlinie für admin/superadmin: mindestens 14 Zeichen (docs/SPEC.md §8).
  adminPassword: z.string().min(14).max(256)
});

export interface SetupRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

export function registerSetupRoutes(app: FastifyInstance, deps: SetupRouteDeps): void {
  app.get('/setup', async (_req, reply) => {
    return reply.type('text/html; charset=utf-8').send(SETUP_HTML);
  });
  app.get('/setup/setup.css', async (_req, reply) => {
    return reply.type('text/css; charset=utf-8').send(SETUP_CSS);
  });
  app.get('/setup/setup.js', async (_req, reply) => {
    return reply.type('application/javascript; charset=utf-8').send(SETUP_JS);
  });

  app.get('/api/v1/setup/status', async (_req, reply) => {
    const row = await app.db
      .selectFrom('app_settings')
      .select('setup_completed_at')
      .where('id', '=', 1)
      .executeTakeFirst();
    return reply.send({ completed: Boolean(row?.setup_completed_at) });
  });

  app.post(
    '/api/v1/setup/complete',
    // Strengeres Limit als der globale Standard -- Brute-Force/DoS gegen den offenen,
    // unauthentifizierten Setup-Endpunkt vor dem ersten echten Abschluss eindämmen.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const parsed = setupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        type: 'about:blank',
        title: 'Ungültige Eingabe',
        status: 400,
        detail: parsed.error.issues.map(i => i.message).join('; ')
      });
    }
    const input = parsed.data;

    try {
      const result = await app.db.transaction().execute(async trx => {
        // Zeile sperren, solange die Transaktion läuft -- verhindert, dass zwei parallele
        // Einrichtungsversuche beide durchlaufen (docs/SPEC.md §7.1 "serverseitige Prüfung").
        const settingsRow = await trx
          .selectFrom('app_settings')
          .select(['setup_completed_at'])
          .where('id', '=', 1)
          .forUpdate()
          .executeTakeFirstOrThrow();

        if (settingsRow.setup_completed_at) {
          return { alreadyCompleted: true as const };
        }

        await trx
          .insertInto('installations')
          .values({ id: deps.env.INSTALLATION_ID, schema_version: deps.env.SCHEMA_VERSION })
          .onDuplicateKeyUpdate({ schema_version: deps.env.SCHEMA_VERSION })
          .execute();

        const nameDek = await ensureDek(trx, deps.keyProvider, 'users.name');
        const emailDek = await ensureDek(trx, deps.keyProvider, 'users.email');
        const blindIndexDek = await ensureDek(trx, deps.keyProvider, 'blind-index.users.email');

        const groupId = randomUUID();
        await trx
          .insertInto('groups')
          .values({ id: groupId, name: 'Admins', is_default: true })
          .execute();

        const userId = randomUUID();
        const passwordHash = await argon2.hash(input.adminPassword, { type: argon2.argon2id });

        const nameCtx = {
          installationId: deps.env.INSTALLATION_ID,
          schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users',
          recordId: userId,
          fieldName: 'name',
          keyVersion: nameDek.keyVersion
        };
        const emailCtx = { ...nameCtx, fieldName: 'email', keyVersion: emailDek.keyVersion };

        const nameEnc = fieldCipher.encryptField(input.adminName, nameDek.rawDek, nameCtx);
        const emailEnc = fieldCipher.encryptField(input.adminEmail, emailDek.rawDek, emailCtx);
        const emailBlindIdx = computeBlindIndex(blindIndexDek.rawDek, input.adminEmail);

        await trx
          .insertInto('users')
          .values({
            id: userId,
            username: input.adminUsername,
            name_enc: nameEnc,
            email_enc: emailEnc,
            email_blind_idx: emailBlindIdx,
            password_hash: passwordHash,
            role: 'superadmin',
            department_group_id: groupId,
            account_archived: false,
            locked_permanent: false,
            totp_enabled: false,
            installation_id: deps.env.INSTALLATION_ID
          })
          .execute();

        await trx
          .updateTable('app_settings')
          .set({
            company_name: input.companyName,
            portal_name: input.portalName,
            setup_completed_at: new Date()
          })
          .where('id', '=', 1)
          .execute();

        return { alreadyCompleted: false as const };
      });

      if (result.alreadyCompleted) {
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Bereits eingerichtet',
          status: 409,
          detail: 'Die Einrichtung wurde bereits abgeschlossen.'
        });
      }

      return reply.code(201).send({ success: true });
    } catch (err) {
      app.log.error({ err }, 'Einrichtung fehlgeschlagen');
      return reply.code(500).send({
        type: 'about:blank',
        title: 'Interner Fehler',
        status: 500,
        detail: 'Die Einrichtung konnte nicht abgeschlossen werden.'
      });
    }
    }
  );

  app.get('/', async (_req, reply) => {
    const row = await app.db
      .selectFrom('app_settings')
      .select('setup_completed_at')
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!row?.setup_completed_at) {
      return reply.redirect('/setup', 302);
    }
    return reply.redirect('/app', 302);
  });
}
