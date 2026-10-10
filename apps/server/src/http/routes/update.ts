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

async function callUpdater(env: Env, path: '/status' | '/run', method: 'GET' | 'POST') {
  if (!env.UPDATE_SERVICE_URL || !env.UPDATE_TOKEN) {
    return { ok: false, status: 503, payload: { error: 'update_service_not_configured' } };
  }
  const res = await fetch(`${env.UPDATE_SERVICE_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.UPDATE_TOKEN}` }
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload };
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
}
