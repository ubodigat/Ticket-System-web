/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Persönlicher Outlook-Kalender pro Benutzer -- delegierte OAuth-Berechtigung (Authorization Code
// Flow), getrennt von der App-only-Integration in domain/graphClient.ts (gemeinsames Postfach).
// Jede Person verbindet höchstens ihr eigenes Konto; der Refresh-Token wird verschlüsselt an der
// eigenen Benutzerzeile gespeichert (Migration 0048), nie im Klartext an den Client zurückgegeben.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'node:crypto';
import { requireSession } from './session.js';
import { routeError } from './routeError.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher, decryptFieldTolerant } from '../../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../../db/date.js';
import {
  loadOutlookAppCredentials, getAuthorizationUrl, exchangeAuthCodeForTokens,
  refreshDelegatedAccessToken, getMyProfile, getMyCalendarView, createMyCalendarEvent,
  GraphApiError
} from '../../domain/graphClient.js';

export interface OutlookPersonalRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const STATE_COOKIE = 'ticket_outlook_oauth_state';

function isHttpsRequest(req: FastifyRequest): boolean {
  return req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
}

function redirectUriFor(req: FastifyRequest): string {
  return `${req.protocol}://${req.host}/api/v2/outlook/callback`;
}

// Nur ein serverseitig bekannter, relativer Pfad wird als Rücksprungziel akzeptiert -- verhindert
// einen Open Redirect über einen manipulierten returnTo-Wert.
function sanitizeReturnTo(value: unknown): string {
  return value === '/admin.html' || value === '/dashboard.html' ? value : '/dashboard.html';
}

async function refreshDek(app: FastifyInstance, keyProvider: KeyProvider) {
  return ensureDek(app.db, keyProvider, 'users.outlook_refresh_token');
}

function tokenCtx(deps: OutlookPersonalRouteDeps, userId: string, keyVersion: number) {
  return {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users', recordId: userId, fieldName: 'outlook_refresh_token', keyVersion
  };
}

// Holt einen frischen Access-Token für die eingeloggte Person und rotiert den gespeicherten
// Refresh-Token, falls Microsoft einen neuen ausstellt (sonst schlägt der nächste Aufruf fehl).
// Gibt null zurück, wenn die Person nicht verbunden ist oder die App-Zugangsdaten fehlen.
async function getFreshAccessToken(app: FastifyInstance, deps: OutlookPersonalRouteDeps, userId: string): Promise<string | null> {
  const creds = await loadOutlookAppCredentials(app.db, deps.env, deps.keyProvider);
  if (!creds) return null;
  const row = await app.db.selectFrom('users').select(['outlook_refresh_token_enc']).where('id', '=', userId).executeTakeFirst();
  if (!row?.outlook_refresh_token_enc) return null;

  const dek = await refreshDek(app, deps.keyProvider);
  const storedRefreshToken = decryptFieldTolerant(row.outlook_refresh_token_enc, dek.rawDek, tokenCtx(deps, userId, dek.keyVersion));
  const tokens = await refreshDelegatedAccessToken(creds.tenantId, creds.clientId, creds.clientSecret, storedRefreshToken);
  if (tokens.refreshToken && tokens.refreshToken !== storedRefreshToken) {
    const newEnc = fieldCipher.encryptField(tokens.refreshToken, dek.rawDek, tokenCtx(deps, userId, dek.keyVersion));
    await app.db.updateTable('users').set({ outlook_refresh_token_enc: newEnc }).where('id', '=', userId).execute();
  }
  return tokens.accessToken;
}

export function registerOutlookPersonalRoutes(app: FastifyInstance, deps: OutlookPersonalRouteDeps): void {
  app.get('/api/v2/outlook/status', async (req, reply) => {
    try {
      const session = requireSession(req);
      const row = await app.db.selectFrom('users').select(['outlook_account_email', 'outlook_connected_at']).where('id', '=', session.uid).executeTakeFirst();
      const configured = !!await loadOutlookAppCredentials(app.db, deps.env, deps.keyProvider);
      return reply.send({ configured, connected: !!row?.outlook_connected_at, accountEmail: row?.outlook_account_email ?? null });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.get('/api/v2/outlook/connect', { config: { rateLimit: {
    max: 10, timeWindow: '10 minutes', keyGenerator: req => req.ticketSession?.uid ?? req.ip
  } } }, async (req, reply) => {
    try {
      const session = requireSession(req);
      const creds = await loadOutlookAppCredentials(app.db, deps.env, deps.keyProvider);
      if (!creds) return reply.code(409).send({ error: 'outlook_not_configured' });

      const nonce = randomBytes(24).toString('hex');
      const returnTo = sanitizeReturnTo((req.query as { returnTo?: string })?.returnTo);
      reply.setCookie(STATE_COOKIE, `${nonce}:${returnTo}`, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: isHttpsRequest(req), signed: true, maxAge: 600
      });
      const url = getAuthorizationUrl(creds.tenantId, creds.clientId, redirectUriFor(req), `${nonce}:${session.uid}`);
      return reply.redirect(url);
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.get('/api/v2/outlook/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const raw = req.cookies[STATE_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    const [cookieNonce, returnTo] = (unsigned?.valid && unsigned.value ? unsigned.value : ':').split(':', 2);
    const safeReturnTo = sanitizeReturnTo(returnTo);

    try {
      const session = requireSession(req);
      if (query.error || !query.code || !query.state) return reply.redirect(`${safeReturnTo}?outlook=failed`);
      const [stateNonce, stateUserId] = query.state.split(':', 2);
      if (!cookieNonce || stateNonce !== cookieNonce || stateUserId !== session.uid) {
        return reply.redirect(`${safeReturnTo}?outlook=failed`);
      }

      const creds = await loadOutlookAppCredentials(app.db, deps.env, deps.keyProvider);
      if (!creds) return reply.redirect(`${safeReturnTo}?outlook=failed`);

      const tokens = await exchangeAuthCodeForTokens(creds.tenantId, creds.clientId, creds.clientSecret, redirectUriFor(req), query.code);
      if (!tokens.refreshToken) return reply.redirect(`${safeReturnTo}?outlook=failed`);
      const profile = await getMyProfile(tokens.accessToken).catch(() => ({ email: null }));

      const dek = await refreshDek(app, deps.keyProvider);
      const enc = fieldCipher.encryptField(tokens.refreshToken, dek.rawDek, tokenCtx(deps, session.uid, dek.keyVersion));
      await app.db.updateTable('users').set({
        outlook_refresh_token_enc: enc,
        outlook_account_email: profile.email,
        outlook_connected_at: mysqlTimestamp()
      }).where('id', '=', session.uid).execute();

      return reply.redirect(`${safeReturnTo}?outlook=connected`);
    } catch {
      return reply.redirect(`${safeReturnTo}?outlook=failed`);
    }
  });

  app.post('/api/v2/outlook/disconnect', async (req, reply) => {
    try {
      const session = requireSession(req);
      await app.db.updateTable('users').set({
        outlook_refresh_token_enc: null, outlook_account_email: null, outlook_connected_at: null
      }).where('id', '=', session.uid).execute();
      return reply.send({ ok: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const calendarQuerySchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

  app.get('/api/v2/outlook/calendar', async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = calendarQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });

      const accessToken = await getFreshAccessToken(app, deps, session.uid);
      if (!accessToken) return reply.code(409).send({ error: 'outlook_not_connected' });

      try {
        const events = await getMyCalendarView(accessToken, parsed.data.from, parsed.data.to);
        return reply.send({ events });
      } catch (err) {
        if (err instanceof GraphApiError) return reply.code(502).send({ error: 'outlook_calendar_fetch_failed' });
        throw err;
      }
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const createEventSchema = z.object({
    subject: z.string().trim().min(1).max(512),
    notes: z.string().trim().max(5000).optional(),
    attendee_emails: z.array(z.string().trim().email().max(255)).max(20).optional(),
    start_at: z.string().min(1),
    end_at: z.string().min(1)
  });

  app.post('/api/v2/outlook/events', { config: { rateLimit: {
    max: 20, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip
  } } }, async (req, reply) => {
    try {
      const session = requireSession(req);
      const parsed = createEventSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const startAt = new Date(parsed.data.start_at);
      const endAt = new Date(parsed.data.end_at);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        return reply.code(400).send({ error: 'invalid_time_range' });
      }

      const accessToken = await getFreshAccessToken(app, deps, session.uid);
      if (!accessToken) return reply.code(409).send({ error: 'outlook_not_connected' });

      try {
        const created = await createMyCalendarEvent(accessToken, {
          subject: parsed.data.subject,
          bodyText: parsed.data.notes || '',
          attendeeEmails: parsed.data.attendee_emails,
          startAt, endAt
        });
        return reply.code(201).send({ id: created.graphEventId, webLink: created.webLink });
      } catch (err) {
        if (err instanceof GraphApiError) return reply.code(502).send({ error: 'outlook_event_create_failed' });
        throw err;
      }
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
