/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';

// /health wird von Caddy/Docker-Healthcheck abgefragt, nicht öffentlich im Internet exponiert
// (Proxy-Konfiguration regelt das außerhalb dieses Codes) -- docs/ARCHITECTURE.md §2/§4.
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    try {
      await sql`SELECT 1`.execute(app.db);
      return reply.send({ status: 'ok' });
    } catch (err) {
      app.log.error({ err }, 'Healthcheck: Datenbank nicht erreichbar');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
