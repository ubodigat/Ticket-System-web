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
import { registerAuthRoutes, csrfCookieName } from './routes/auth.js';
import { registerTicketsV2Routes } from './routes/tickets.js';
import { registerUsersV2Routes } from './routes/users.js';
import { registerOutlookPersonalRoutes } from './routes/outlookPersonal.js';
import { registerExtrasV2Routes } from './routes/extras.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerKnowledgeRoutes } from './routes/knowledge.js';
import { registerRecurringRoutes } from './routes/recurring.js';
import { registerMfaRoutes } from './routes/mfa.js';
import { registerUpdateRoutes } from './routes/update.js';
import { registerTodoRoutes } from './routes/todos.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerPreferenceRoutes } from './routes/preferences.js';
import { registerWorkTimerRoutes } from './routes/workTimers.js';
import { registerOfficeViewerRoutes } from './routes/officeViewer.js';
import { registerStaticAssetRoutes } from './routes/staticAssets.js';
import { loadSecurityPolicy } from '../domain/securityPolicy.js';
import { isAccountExpired } from '../domain/accountValidity.js';

function timestampMillis(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const millis = new Date(normalized).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

// Strikte CSP, keine CDN-Hosts, kein 'unsafe-inline'/'unsafe-eval' (verbindlich, siehe
// Anforderungsliste "Fehlende Content Security Policy"/"XSS"/"DOM-Based XSS"). Die alte,
// inline-onclick-basierte Oberfläche wird NICHT mehr ausgeliefert -- genau deshalb kann diese
// CSP wieder streng sein, statt für sie aufgeweicht zu werden.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
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
    // Security-Audit N2: 20MB galt bisher global, auch für unauthentifizierte Endpunkte
    // (Login, Setup) -- ein beliebiger Absender konnte so jede Anfrage mit bis zu 20MB Body
    // aufblähen, bevor überhaupt Auth/Validierung greift. 2MB deckt alle normalen JSON-Bodies
    // mit Marge ab; die einzelnen Upload-Routen (Anhänge, CSV-Import) setzen ihr eigenes,
    // höheres bodyLimit in der Route-Config.
    bodyLimit: 2 * 1024 * 1024,
    logger: {
      level: deps.env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization']
    },
    // Security-Audit R-1 (Regression, vorher N1): "true" vertraut der GESAMTEN
    // X-Forwarded-For-Kette unbedingt -- req.ip könnte dadurch auf eine vom Client
    // vorgetäuschte Adresse zeigen und IP-basiertes Rate-Limiting/Logging umgehbar machen.
    // EINE ZAHL hier waere falsch: Fastify 5.12.5 behandelt eine Hop-Zahl absichtlich als
    // "keinem Proxy vertrauen" (fail-closed), wodurch req.ip auf die Caddy-IP fuer JEDE Anfrage
    // zeigen wuerde und sich z.B. alle Nutzer ein einziges Login-Rate-Limit teilen. Eine
    // CIDR-Angabe (das Docker-Netz, in dem Caddy laeuft) prueft dagegen korrekt nur die Adresse
    // des direkten Gegenuebers; Caddy selbst ueberschreibt X-Forwarded-For bereits, Clients
    // koennen den Wert also nicht faelschen.
    trustProxy: deps.env.TRUSTED_PROXY_CIDR ?? false
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
        .select(['revoked_at', 'expires_at', 'last_seen_at'])
        .where('id', '=', parsed.sid)
        .where('user_id', '=', parsed.uid)
        .executeTakeFirst();
      if (!dbSession || dbSession.revoked_at || timestampMillis(dbSession.expires_at) <= Date.now()) {
        req.ticketSession = null;
        return;
      }
      // Idle-Timeout (Security-Audit): unabhaengig von der absoluten Sitzungsdauer oben --
      // eine Sitzung ohne jede Aktivitaet seit mehr als idleTimeoutMinutes wird endgueltig
      // widerrufen (nicht nur fuer diese eine Anfrage verworfen), damit ein gestohlenes, lange
      // ungenutztes Cookie nicht beliebig spaeter doch noch funktioniert.
      const lastSeen = timestampMillis(dbSession.last_seen_at);
      if (lastSeen > 0 && Date.now() - lastSeen > policy.idleTimeoutMinutes * 60 * 1000) {
        await deps.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', parsed.sid).execute();
        req.ticketSession = null;
        return;
      }
      // Nur alle ~60s tatsaechlich schreiben (nicht bei jeder einzelnen Anfrage) -- reduziert
      // Schreiblast bei sehr aktiven Sitzungen (z.B. Polling), ohne die Idle-Erkennung oben
      // nennenswert zu verzoegern.
      if (Date.now() - lastSeen > 60 * 1000) {
        await deps.db.updateTable('sessions').set({ last_seen_at: new Date() }).where('id', '=', parsed.sid).execute();
      }
      const row = await deps.db.selectFrom('users')
        .select(['username', 'role', 'account_archived', 'locked_until', 'locked_permanent', 'account_valid_until'])
        .where('id', '=', parsed.uid)
        .executeTakeFirst();
      const isLocked = !!row && (row.locked_permanent || timestampMillis(row.locked_until) > Date.now());
      if (!row || row.account_archived || isLocked || isAccountExpired(row.account_valid_until)) {
        req.ticketSession = null;
        return;
      }
      req.ticketSession = { uid: parsed.uid, username: row.username, role: row.role };
    } catch {
      req.ticketSession = null;
    }
  });

  // CSRF-Schutz (Double-Submit-Cookie), zweite Verteidigungsschicht zusätzlich zu
  // SameSite=Lax/fehlender CORS-Freigabe: jede mutierende Anfrage einer angemeldeten Person muss
  // den Wert aus dem (nicht-httpOnly) CSRF-Cookie als x-csrf-token-Header zurückgeben. Eine
  // fremde Seite kann diesen Header nicht mitschicken (kein Zugriff auf das Cookie wegen
  // Same-Origin-Policy), selbst wenn SameSite künftig umgangen würde. Gilt nur, wenn bereits eine
  // gültige Session erkannt wurde -- Login/Setup/MFA-Verify sind unauthentifiziert und daher
  // ausgenommen (für sie greift stattdessen das Rate-Limit + der Account-Lockout).
  const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.ticketSession || !CSRF_PROTECTED_METHODS.has(req.method)) return;
    const cookieToken = req.cookies?.[csrfCookieName(req)];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
      reply.code(403).send({ error: 'csrf_failed' });
    }
  });

  await app.register(rateLimit, {
    global: true,
    // Die Oberfläche lädt beim Start mehrere JS-/Vendor-Assets und danach parallel Settings,
    // Benutzer, Tickets, Logs und Benachrichtigungen. 100/min war dafür zu knapp und führte
    // bei normaler Nutzung zu 429 auf /api/v2/settings, /api/v2/users usw. Kritische Routen
    // wie Setup/Login/MFA behalten eigene engere Limits in den jeweiligen Route-Configs.
    max: 1000,
    timeWindow: '1 minute',
    // Security-Audit R-10 / CVE-2026-15144: Vor 11.2.0 bildete @fastify/rate-limit den Zähler
    // aus dem rohen Text von req.ip -- eine IPv6-Adresse hat beliebig viele gültige
    // Schreibweisen und ein Anschluss verfügt meist über ein ganzes /64-Netz, wodurch jede neue
    // Adresse ein frisches Kontingent bekam (Password-Spraying trotz Limit). ipv6Subnet fasst
    // IPv6-Clients ausdrücklich auf das /64-Netz zusammen, statt sich auf den (ohnehin ab
    // 11.2.0 geltenden) Default zu verlassen.
    ipv6Subnet: 64
  });

  registerHealthRoutes(app);
  registerSetupRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerAuthRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });

  // V2 API - vollständig sicher, RBAC, normalisiert
  registerTicketsV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerUsersV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerOutlookPersonalRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerExtrasV2Routes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerSettingsRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerKnowledgeRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerRecurringRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerTodoRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerUploadRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerPreferenceRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerWorkTimerRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerOfficeViewerRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerMfaRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
  registerUpdateRoutes(app, { env: deps.env, keyProvider: deps.keyProvider });
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
