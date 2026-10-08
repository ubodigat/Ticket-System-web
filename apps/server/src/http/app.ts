import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import type { Database } from '../db/types.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLegacyRoutes } from './routes/legacy.js';

// Der Server liefert den bestehenden Browser-Prototyp mit aus. Die CDN-Hosts sind bewusst
// eng auf die dort bereits verwendeten Bibliotheken begrenzt; kein 'unsafe-inline'/'unsafe-eval'.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'", 'blob:'],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"]
};

export interface AppDeps {
  env: Env;
  db: Kysely<Database>;
  keyProvider: KeyProvider;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 20 * 1024 * 1024,
    logger: {
      level: deps.env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Strukturiertes Logging ohne Rohdaten verschlüsselter Felder -- siehe docs/THREAT_MODEL.md
      // Abschnitt "App-Container" (Information Disclosure über Logs).
      redact: ['req.headers.cookie', 'req.headers.authorization']
    },
    // Nur dem einzigen konfigurierten Proxy-Hop (Caddy) wird X-Forwarded-For vertraut --
    // docs/ARCHITECTURE.md §3. Fastifys Typdefinitionen kennen keine Hop-Zahl, daher boolean:
    // "vertraue dem unmittelbaren Hop" -- ausreichend für die vorgesehene Topologie mit genau
    // einem Reverse Proxy davor.
    trustProxy: deps.env.TRUSTED_PROXY_HOPS > 0
  });

  app.decorate('db', deps.db);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: CSP_DIRECTIVES },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
  });

  await app.register(cookie, {
    secret: deps.env.COOKIE_SECRET
  });

  // Phase-1-Hinweis (kein stiller Mangel, sondern dokumentiert): dieser In-Memory-Store reicht
  // für den Setup-Wizard (ein einziger App-Prozess, einmaliger Vorgang pro Installation), ist
  // aber NICHT für die horizontal skalierenden Auth-/Schreib-Endpunkte aus Phase 2 geeignet --
  // dafür MUSS vorher der gemeinsame, MariaDB-gestützte Store aus
  // docs/adr/0008-rate-limit-storage.md angebunden werden, siehe docs/PROGRESS.md Phase 2.
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute'
  });

  registerHealthRoutes(app);
  registerLegacyRoutes(app);
  registerSetupRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerAuthRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>;
  }
}
