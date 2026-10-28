import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import type { UsersRouteDeps } from './users.js';
import { isSmtpConfigured } from '../../mail/mailer.js';
import { isLdapEnabled } from '../../auth/ldap.js';
import { loadOutlookAppCredentials } from '../../domain/graphClient.js';

const SERVER_PACKAGES = ['fastify', 'kysely', 'mysql2', 'argon2', 'zod', 'nodemailer', 'sanitize-html', '@simplewebauthn/server', 'ldapts', 'pdfjs-dist'];

// Container: /app (package.json, node_modules, vendor). Entwicklung: apps/server mit Wurzel ../..
const roots = () => [process.cwd(), join(process.cwd(), '..', '..')];

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}
async function packageVersion(name: string): Promise<string | null> {
  for (const root of roots()) {
    const pkg = await readJson(join(root, 'node_modules', name, 'package.json'));
    if (typeof pkg?.version === 'string') return pkg.version;
  }
  return null;
}
async function appVersion(): Promise<string | null> {
  for (const root of roots()) {
    const pkg = await readJson(join(root, 'package.json'));
    if (pkg?.name === '@ticket-system/server' && typeof pkg.version === 'string') return pkg.version;
  }
  return null;
}
// Versionen der selbst gehosteten Oberflaechen-Bibliotheken stehen gepflegt in vendor/VERSIONS.md.
async function vendorVersions(): Promise<Array<{ name: string; version: string }>> {
  for (const root of roots()) {
    try {
      const text = await readFile(join(root, 'vendor', 'VERSIONS.md'), 'utf8');
      return [...text.matchAll(/^\| `([^`]+)` \| ([^|]+?) \|/gm)]
        .map(match => ({ name: match[1]!, version: (match[2]!.match(/^[0-9][0-9A-Za-z.\-]*/)?.[0]) ?? match[2]!.trim() }));
    } catch { /* naechste Wurzel */ }
  }
  return [];
}
async function safe<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch { return null; }
}

// Nur Superadmins: Versions- und Infrastrukturangaben erleichtern sonst gezielte Angriffe.
export function registerSystemInfoRoutes(app: FastifyInstance, deps: UsersRouteDeps): void {
  app.get('/api/v2/system/info', async (req, reply) => {
    try {
      requireSuperadmin(req);
      const mailDeps = { db: app.db, env: deps.env, keyProvider: deps.keyProvider };
      const count = async (query: Promise<{ n: number | string | bigint } | undefined>) => Number((await query)?.n ?? 0);
      const [databaseVersion, latestMigration, migrationCount, sslCipher, settings, smtp, ldap, outlook,
        usersActive, usersTotal, ticketsOpen, ticketsArchived, attachments, kbArticles, packages, vendor, version] = await Promise.all([
        safe(async () => (await sql<{ v: string }>`SELECT VERSION() AS v`.execute(app.db)).rows[0]?.v ?? null),
        safe(async () => (await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(app.db)).rows[0]?.name ?? null),
        safe(async () => Number((await sql<{ n: number }>`SELECT COUNT(*) AS n FROM kysely_migration`.execute(app.db)).rows[0]?.n ?? 0)),
        safe(async () => (await sql<{ Value: string }>`SHOW SESSION STATUS LIKE 'Ssl_cipher'`.execute(app.db)).rows[0]?.Value ?? ''),
        safe(() => app.db.selectFrom('app_settings').select(['setup_completed_at']).where('id', '=', 1).executeTakeFirst()),
        safe(() => isSmtpConfigured(mailDeps)),
        safe(() => isLdapEnabled(mailDeps)),
        safe(async () => !!(await loadOutlookAppCredentials(app.db, deps.env, deps.keyProvider)) && !!deps.env.PUBLIC_BASE_URL),
        safe(() => count(app.db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n')).where('account_archived', '=', false).executeTakeFirst())),
        safe(() => count(app.db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst())),
        safe(() => count(app.db.selectFrom('tickets').select(eb => eb.fn.countAll<number>().as('n')).where('archived_at', 'is', null).executeTakeFirst())),
        safe(() => count(app.db.selectFrom('tickets').select(eb => eb.fn.countAll<number>().as('n')).where('archived_at', 'is not', null).executeTakeFirst())),
        safe(() => count(app.db.selectFrom('attachments').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst())),
        safe(() => count(app.db.selectFrom('kb_articles').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst())),
        Promise.all(SERVER_PACKAGES.map(async name => ({ name, version: await packageVersion(name) }))),
        vendorVersions(),
        appVersion()
      ]);
      const commit = process.env.APP_COMMIT && process.env.APP_COMMIT !== 'unknown' ? process.env.APP_COMMIT : null;
      const builtAt = process.env.APP_BUILT_AT && process.env.APP_BUILT_AT !== 'unknown' ? process.env.APP_BUILT_AT : null;
      return reply.header('cache-control', 'no-store').send({
        app: { version, commit, builtAt },
        runtime: { node: process.version, platform: `${platform()} ${arch()}`, kernel: release(),
          uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
        database: { version: databaseVersion, latestMigration, migrationCount, tls: !!sslCipher, cipher: sslCipher || null },
        installation: { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION, environment: deps.env.NODE_ENV,
          publicUrl: deps.env.PUBLIC_BASE_URL ?? null, setupCompletedAt: settings?.setup_completed_at ?? null },
        integrations: {
          smtp: !!smtp, ldap: !!ldap, outlook: !!outlook, passkeys: !!deps.env.WEBAUTHN_ORIGIN, antivirus: !!deps.env.CLAMAV_HOST,
          officePreview: !!deps.env.OFFICE_PREVIEW_URL, onlyoffice: !!deps.env.ONLYOFFICE_ENABLED, updater: !!deps.env.UPDATE_SERVICE_URL,
          trustedProxy: deps.env.TRUSTED_PROXY_CIDR ?? null
        },
        libraries: { server: packages, client: vendor },
        counts: { usersActive, usersTotal, ticketsOpen, ticketsArchived, attachments, kbArticles }
      });
    } catch (error) { return routeError(app, reply, error); }
  });
}
