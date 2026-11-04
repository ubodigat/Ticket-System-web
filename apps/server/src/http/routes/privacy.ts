/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSession, requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import { requireStepUp } from './stepUp.js';
import { buildPersonalDataExport } from '../../domain/personalDataExport.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';

export interface PrivacyRouteDeps { env: Env; keyProvider: KeyProvider }

// Auskunft und Datenexport (DSGVO Art. 15 und 20). Der Export buendelt alle Daten einer Person --
// deshalb nur mit Passwort (und zweitem Faktor, falls eingerichtet), eng begrenzt und protokolliert.
export function registerPrivacyRoutes(app: FastifyInstance, deps: PrivacyRouteDeps): void {
  const rateLimit = { max: 5, timeWindow: '1 hour', keyGenerator: (req: { ticketSession?: { uid: string } | null; ip: string }) => req.ticketSession?.uid ?? req.ip };

  async function send(reply: FastifyReply, actor: { uid: string; username: string }, subject: string, action: string) {
    const data = await buildPersonalDataExport({ db: app.db, keyProvider: deps.keyProvider, installationId: deps.env.INSTALLATION_ID }, subject);
    await app.db.insertInto('global_audit_log').values({
      id: randomUUID(), actor_user_id: actor.uid, actor_username: actor.username, action, target_type: 'user', target_id: subject,
      detail_json: JSON.stringify({ truncated: data.truncated })
    }).execute();
    const stamp = new Date().toISOString().slice(0, 10);
    return reply.header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="personenbezogene-daten-${stamp}.json"`)
      .type('application/json; charset=utf-8').send(JSON.stringify(data, null, 2));
  }

  // Eigene Daten.
  app.post('/api/v2/users/me/export', { config: { rateLimit } }, async (req, reply) => {
    try {
      const session = requireSession(req);
      await requireStepUp(app, deps, req, session.uid);
      return await send(reply, session, session.uid, 'privacy.export_self');
    } catch (error) { return routeError(app, reply, error); }
  });

  // Auskunftsersuchen fuer eine andere Person (z.B. ohne eigenen Zugang mehr): nur Superadmin, mit
  // Passwort und TOTP.
  app.post('/api/v2/users/:id/export', { config: { rateLimit } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid, { requireTotp: true });
      const { id } = req.params as { id: string };
      const subject = await app.db.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst();
      if (!subject) return reply.code(404).send({ error: 'not_found' });
      return await send(reply, session, subject.id, 'privacy.export_subject');
    } catch (error) { return routeError(app, reply, error); }
  });
}
