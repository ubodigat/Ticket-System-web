import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerStaticAssetRoutes } from '../src/http/routes/staticAssets.js';

const root = new URL('../../../', import.meta.url);
// Discover modules independently of the allowlist to catch missing deployment routes.
const modules = ['/script.js', ...readdirSync(new URL('js/', root))
  .filter(name => name.endsWith('.js')).map(name => `/js/${name}`)];

describe('public frontend module delivery', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    registerStaticAssetRoutes(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it.each(modules)('serves %s without requiring a login', async path => {
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/javascript\b/);
    expect(response.body).toBe(readFileSync(new URL(path.slice(1), root), 'utf8'));
  });

  it.each(['/package.json', '/.env', '/apps/server/src/config/env.ts', '/js/not-allowlisted.js'])(
    'does not expose non-public files at %s', async path => {
      expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    }
  );
});
