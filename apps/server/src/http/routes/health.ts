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
