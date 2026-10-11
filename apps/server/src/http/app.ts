/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
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
import { registerTicketsV2Routes } from './routes/tickets.js';
import { registerUsersV2Routes } from './routes/users.js';
import { registerExtrasV2Routes } from './routes/extras.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerKnowledgeRoutes } from './routes/knowledge.js';
import { registerRecurringRoutes } from './routes/recurring.js';
import { registerMfaRoutes } from './routes/mfa.js';
import { registerUpdateRoutes } from './routes/update.js';
import { registerStaticAssetRoutes } from './routes/staticAssets.js';
import { loadSecurityPolicy } from '../domain/securityPolicy.js';

// Strikte CSP, keine CDN-Hosts, kein 'unsafe-inline'/'unsafe-eval' (verbindlich, siehe
// Anforderungsliste "Fehlende Content Security Policy"/"XSS"/"DOM-Based XSS"). Die alte,
// inline-onclick-basierte Oberfläche wird NICHT mehr ausgeliefert -- genau deshalb kann diese
// CSP wieder streng sein, statt für sie aufgeweicht zu werden.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
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
      redact: ['req.headers.cookie', 'req.headers.authorization']
    },
    trustProxy: deps.env.TRUSTED_PROXY_HOPS > 0
  });

  app.decorate('db', deps.db);
  app.decorateRequest('ticketSession', null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: CSP_DIRECTIVES },
    crossOriginEmbedderPolicy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
  });

  await app.register(cookie, {
    secret: deps.env.COOKIE_SECRET
  });

  // Rollen/Sperr-/Archiv-Status standen bisher nur im signierten Cookie (bis zu 8h gueltig) und
  // wurden nie erneut gegen die Datenbank geprueft -- eine Rollenaenderung, Sperrung oder
  // Archivierung griff dadurch erst nach Ablauf/Neu-Login, nicht sofort. Dieser Hook laedt den
  // aktuellen Stand bei jeder authentifizierten Anfrage einmal nach; requireSession/-Admin/
  // -Superadmin (session.ts) lesen nur noch das bereits gepruefte Ergebnis.
  // Muss NACH app.register(cookie, ...) eingehaengt werden -- sonst existieren req.cookies/
  // req.unsignCookie (vom cookie-Plugin bereitgestellt) bei Ausfuehrung noch nicht und jede
  // einzelne Anfrage (auch /health) wirft sofort einen ungefangenen Fehler.
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies?.['__Host-ticket_session'] || req.cookies?.ticket_session;
    if (!raw) { req.ticketSession = null; return; }
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) { req.ticketSession = null; return; }
    try {
      const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as { sid?: unknown; uid?: unknown; iat?: unknown };
      if (typeof parsed.sid !== 'string' || typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') {
        req.ticketSession = null;
        return;
      }
      const policy = await loadSecurityPolicy(deps.db);
      if (Date.now() - parsed.iat > policy.sessionTimeoutMinutes * 60 * 1000) {
        req.ticketSession = null;
        return;
      }
      const dbSession = await deps.db.selectFrom('sessions')
        .select(['revoked_at', 'expires_at'])
        .where('id', '=', parsed.sid)
        .where('user_id', '=', parsed.uid)
        .executeTakeFirst();
      if (!dbSession || dbSession.revoked_at || new Date(dbSession.expires_at).getTime() <= Date.now()) {
        req.ticketSession = null;
        return;
      }
      const row = await deps.db.selectFrom('users')
        .select(['username', 'role', 'account_archived', 'locked_until', 'locked_permanent'])
        .where('id', '=', parsed.uid)
        .executeTakeFirst();
      const isLocked = !!row && (row.locked_permanent || (!!row.locked_until && new Date(row.locked_until).getTime() > Date.now()));
      if (!row || row.account_archived || isLocked) {
        req.ticketSession = null;
        return;
      }
      req.ticketSession = { uid: parsed.uid, username: row.username, role: row.role };
    } catch {
      req.ticketSession = null;
    }
  });

  await app.register(rateLimit, {
    global: true,
    // Die Oberfläche lädt beim Start mehrere JS-/Vendor-Assets und danach parallel Settings,
    // Benutzer, Tickets, Logs und Benachrichtigungen. 100/min war dafür zu knapp und führte
    // bei normaler Nutzung zu 429 auf /api/v2/settings, /api/v2/users usw. Kritische Routen
    // wie Setup/Login/MFA behalten eigene engere Limits in den jeweiligen Route-Configs.
    max: 1000,
    timeWindow: '1 minute'
  });

  registerHealthRoutes(app);
  registerSetupRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerAuthRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });

  // V2 API - vollständig sicher, RBAC, normalisiert
  registerTicketsV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerUsersV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerExtrasV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerSettingsRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerKnowledgeRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerRecurringRoutes(app);
  registerMfaRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerUpdateRoutes(app, { env: deps.env });
  registerStaticAssetRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>;
  }
  interface FastifyRequest {
    ticketSession: { uid: string; username: string; role: 'user' | 'admin' | 'superadmin' } | null;
  }
}
