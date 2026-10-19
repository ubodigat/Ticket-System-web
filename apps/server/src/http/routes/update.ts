/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { FastifyInstance } from 'fastify';
import { requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import type { Env } from '../../config/env.js';

export interface UpdateRouteDeps {
  env: Env;
}

async function callUpdater(env: Env, path: '/status' | '/run' | '/migrate', method: 'GET' | 'POST') {
  if (!env.UPDATE_SERVICE_URL || !env.UPDATE_TOKEN) {
    return { ok: false, status: method === 'GET' ? 200 : 503, payload: { enabled: false, error: 'update_service_not_configured' } };
  }
  try {
    // Allow the updater's bounded Git fetch (15s) to finish before timing out the proxy.
    // /migrate darf laenger dauern (Migrationen koennen Schema-Aenderungen auf grossen Tabellen
    // enthalten), daher ein eigenes, grosszuegigeres Zeitlimit statt der 25s fuer Status/Run.
    const res = await fetch(`${env.UPDATE_SERVICE_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${env.UPDATE_TOKEN}` },
      signal: AbortSignal.timeout(path === '/migrate' ? 130000 : 25000)
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, payload };
  } catch {
    return { ok: false, status: 503, payload: { error: 'update_service_unreachable' } };
  }
}

export function registerUpdateRoutes(app: FastifyInstance, deps: UpdateRouteDeps): void {
  app.get('/api/v2/update/status', async (req, reply) => {
    try {
      await requireSuperadmin(req);
      const result = await callUpdater(deps.env, '/status', 'GET');
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  app.post('/api/v2/update/run', async (req, reply) => {
    try {
      await requireSuperadmin(req);
      const result = await callUpdater(deps.env, '/run', 'POST');
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Unabhaengig vom vollen Update-Zyklus: gleicht die Datenbank wieder mit dem bereits
  // laufenden Code ab, falls ein frueherer Update-Lauf vor dem Migrations-Schritt abgebrochen
  // ist. Genau dieser Zustand aeusserte sich zuletzt als generischer 500er auf vielen,
  // scheinbar unzusammenhaengenden Routen (Systemeinstellungen speichern, Chat, Ticket-Status).
  app.post('/api/v2/update/migrate', async (req, reply) => {
    try {
      await requireSuperadmin(req);
      const result = await callUpdater(deps.env, '/migrate', 'POST');
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });
}
