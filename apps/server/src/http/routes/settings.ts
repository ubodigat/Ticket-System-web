/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Settings & Categories API - Systemeinstellungen (nur Superadmin schreibend) + Kategorien
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireSession, requireAdmin, requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { sendMail, isSmtpConfigured } from '../../mail/mailer.js';
import { authenticateLdap, isLdapEnabled } from '../../auth/ldap.js';

export interface SettingsRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const customFieldSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(128),
  type: z.enum(['text', 'number', 'select']),
  required: z.boolean().default(false),
  options: z.array(z.string().max(128)).max(50).optional()
});

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(128),
  auto_assign_group_id: z.string().nullable().optional(),
  custom_fields: z.array(customFieldSchema).max(50).default([])
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  auto_assign_group_id: z.string().nullable().optional(),
  custom_fields: z.array(customFieldSchema).max(50).optional(),
  locked: z.boolean().optional(),
  archived: z.boolean().optional()
});

// Freiform, aber mit sinnvollen Grenzen -- entspricht dem bisherigen generalConfig/slaConfig/
// notificationPolicy/accountConfig-Nest aus der alten Oberfläche, nur jetzt serverseitig
// validiert statt ungeprüft aus dem Browser übernommen.
// Je Wochentag (0=Sonntag..6=Samstag) individuelle Zeiten statt einer einzigen globalen
// Start/Ende-Zeit -- entspricht der ursprünglichen, lokalen Version (vor der Datenbank-Anbindung).
const businessHoursDaySchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/)
});

const settingsConfigSchema = z.object({
  slaHoursByPriority: z.record(z.string(), z.number().int().positive().max(24 * 365)).optional(),
  // "Frist auch Benutzern anzeigen" -- dezenter SLA-Hinweis im Benutzer-Dashboard (ohne Alarmfarben).
  showSlaToUsers: z.boolean().optional(),
  defaultPrio: z.enum(['Niedrig', 'Normal', 'Hoch']).optional(),
  businessHours: z.object({
    enabled: z.boolean().optional(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().int().min(0).max(6)),
    // Individuelle Zeiten je Wochentag (überschreibt start/end für den jeweiligen Tag, wenn
    // vorhanden) und Feiertage (YYYY-MM-DD) -- an diesen Tagen läuft keine Lösungsfrist.
    perDay: z.record(z.string(), businessHoursDaySchema).optional(),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional()
  }).optional(),
  // format: Vorlage mit {prefix}/{category}/{number}, muss {number} enthalten -- validiert in
  // buildTicketNumber (tickets.ts), nicht hier, da der Platzhalter-Check dort mit derselben
  // Logik wie beim tatsächlichen Erzeugen der Nummer laufen soll.
  ticketNumberFormat: z.object({
    prefix: z.string().max(16).default(''),
    padding: z.number().int().min(1).max(12).default(5),
    format: z.string().trim().max(64).optional()
  }).optional(),
  // Pro Kategorie ein eigenes Format (überschreibt ticketNumberFormat.format für diese Kategorie).
  ticketNumberCategoryFormats: z.record(z.string(), z.string().trim().max(64)).optional(),
  accountSelfServiceFields: z.array(z.enum(['name', 'email', 'department'])).optional(),
  autoArchiveClosedAfterDays: z.number().int().min(0).max(3650).optional(),
  waitingReminderDays: z.number().int().min(1).max(365).optional(),
  waitingAutoCloseDays: z.number().int().min(1).max(365).optional(),
  approvalWorkflow: z.object({
    enabled: z.boolean().default(false),
    priorities: z.array(z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch'])).default([]),
    fallbackApproverUserId: z.string().nullable().optional()
  }).optional(),
  // Feldnamen/-werte entsprechen exakt der lokalen Version vom 07.10.2026 (vorher ein eigenes,
  // abweichendes Feldset) -- 0 bei sessionTimeout/maxLoginAttempts bedeutet bewusst "kein
  // Limit", siehe apps/server/src/domain/securityPolicy.ts fuer die serverseitige Auswertung.
  securityConfig: z.object({
    force2FA: z.enum(['none', 'all', 'admin', 'user']).optional(),
    sessionTimeout: z.number().int().min(5).max(10080).optional(),
    maxLoginAttempts: z.number().int().min(1).max(50).optional(),
    lockoutAction: z.enum(['lock', 'temp', 'none']).optional(),
    lockoutMinutes: z.number().int().min(1).max(10080).optional()
  }).optional(),
  // Je Ereignistyp (newTicket/mention/statusChange/...) und Rolle (user/admin): Standardwert
  // für App/E-Mail und ob die Person das selbst anpassen darf (appLocked/emailLocked) -- siehe
  // Store.resolveNotifPref im Frontend, das genau diese Struktur mit den persönlichen
  // Einstellungen der jeweiligen Person kombiniert.
  notifPolicy: z.record(z.string(), z.record(z.string(), z.object({
    defaultApp: z.boolean().optional(),
    defaultEmail: z.boolean().optional(),
    appLocked: z.boolean().optional(),
    emailLocked: z.boolean().optional()
  }))).optional(),
  emailAdvancedConfig: z.object({
    replyTo: z.string().trim().max(255).nullable().optional(),
    bccArchive: z.string().trim().max(255).nullable().optional(),
    template: z.string().max(20000).optional(),
    htmlEnabled: z.boolean().optional(),
    htmlSignature: z.string().max(10000).optional(),
    // Werte wie in der lokalen Version vom 07.10.2026 -- "opportunistic" gehoert zur
    // Transportverschluesselung (nicht zur Zertifikatspruefung wie zuvor hier abweichend
    // modelliert), Zertifikatspruefung hat dort drei eigene Stufen.
    transportSecurity: z.enum(['starttls', 'tls', 'opportunistic']).optional(),
    certificateValidation: z.enum(['strict', 'allow-self-signed', 'disabled']).optional(),
    smimeCertificatePem: z.string().max(20000).optional(),
    smimePrivateKeyPem: z.string().max(20000).optional(),
    smimePassphrase: z.string().max(512).optional(),
    dkimSelector: z.string().trim().max(128).optional(),
    dkimDomain: z.string().trim().max(255).optional(),
    dkimPrivateKeyPem: z.string().max(20000).optional()
  }).optional(),
  outlookConfig: z.object({
    enabled: z.boolean().optional(),
    tenantId: z.string().trim().max(255).optional(),
    clientId: z.string().trim().max(255).optional(),
    mailbox: z.string().trim().max(255).optional(),
    syncIncoming: z.boolean().optional(),
    createTicketsFromMail: z.boolean().optional()
  }).optional(),
  companyBrandingConfig: z.object({
    logoDataUrl: z.string().max(1024 * 1024).optional(),
    supportEmail: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(80).optional(),
    address: z.string().max(1000).optional(),
    imprintUrl: z.string().trim().max(500).optional(),
    privacyUrl: z.string().trim().max(500).optional(),
    // Felder aus der lokalen Version vom 07.10.2026, die bisher auf dieser Seite fehlten.
    department: z.string().trim().max(255).optional(),
    timezone: z.string().trim().max(100).optional(),
    location: z.string().trim().max(255).optional(),
    signature: z.string().max(5000).optional(),
    htmlSignature: z.string().max(10000).optional()
  }).optional(),
  // "Konto genehmigt"-Automail -- bisher komplett ohne Gegenstueck im Backend (siehe
  // account-requests.ts: die Genehmigungs-Mail ging immer unbedingt raus).
  notifConfig: z.object({
    accountApproved: z.boolean().optional()
  }).optional()
}).partial();

const smtpConfigSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().trim().max(255).nullable().optional(),
  password: z.string().max(512).optional(), // leer/weggelassen = unverändert lassen
  from: z.string().trim().email().max(255),
  fromName: z.string().trim().max(255).nullable().optional()
});

const ldapConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().trim().min(1).max(255), // z.B. ldap://dc.example.com:389 oder ldaps://...
  bindDn: z.string().trim().min(1).max(255),
  bindPassword: z.string().max(512).optional(), // leer/weggelassen = unverändert lassen
  baseDn: z.string().trim().min(1).max(255),
  userFilter: z.string().trim().min(1).max(255).default('(uid={username})')
});

function removeWriteOnlyMailSecrets(config: Record<string, any>): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(config || {}));
  if (clone.emailAdvancedConfig) {
    delete clone.emailAdvancedConfig.smimePrivateKeyPem;
    delete clone.emailAdvancedConfig.smimePassphrase;
    delete clone.emailAdvancedConfig.dkimPrivateKeyPem;
  }
  return clone;
}

function mergeSettingsConfig(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const merged = { ...existing, ...incoming };
  if (incoming.emailAdvancedConfig) {
    const currentEmail = existing.emailAdvancedConfig || {};
    const nextEmail = { ...currentEmail, ...incoming.emailAdvancedConfig };
    for (const key of ['smimePrivateKeyPem', 'smimePassphrase', 'dkimPrivateKeyPem']) {
      if (incoming.emailAdvancedConfig[key] === '' || incoming.emailAdvancedConfig[key] === undefined) {
        if (currentEmail[key] !== undefined) nextEmail[key] = currentEmail[key];
        else delete nextEmail[key];
      }
    }
    merged.emailAdvancedConfig = nextEmail;
  }
  return merged;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): void {
  // GET /api/v2/settings - gelesen von jedem angemeldeten Benutzer (SLA/Geschäftszeiten
  // werden z.B. im Frontend für Fristanzeigen gebraucht), nicht nur Admins.
  app.get('/api/v2/settings', async (req, reply) => {
    try {
      requireSession(req);
      const row = await app.db.selectFrom('app_settings')
        .select(['company_name', 'portal_name', 'config_json'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      const config = removeWriteOnlyMailSecrets(row.config_json ? JSON.parse(row.config_json) : {});
      return reply.send({ companyName: row.company_name, portalName: row.portal_name, config });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/settings - nur Superadmin (sicherheitsrelevante/globale Einstellungen)
  app.patch('/api/v2/settings', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const body = req.body as { companyName?: string; portalName?: string; config?: unknown };
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (typeof body.companyName === 'string') updates.company_name = body.companyName.trim().slice(0, 255);
      if (typeof body.portalName === 'string') updates.portal_name = body.portalName.trim().slice(0, 255);

      if (body.config !== undefined) {
        const parsed = settingsConfigSchema.safeParse(body.config);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_config', details: parsed.error.flatten() });
        const existing = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirstOrThrow();
        const merged = mergeSettingsConfig(existing.config_json ? JSON.parse(existing.config_json) : {}, parsed.data);
        updates.config_json = JSON.stringify(merged);
      }

      await app.db.updateTable('app_settings').set(updates).where('id', '=', 1).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'settings.updated', target_type: 'settings', target_id: '1', detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- SMTP (E-Mail-Versand) ---

  // GET /api/v2/settings/smtp - nur Superadmin. Gibt NIE das Passwort zurück, nur ob eines
  // gesetzt ist (configured/hasPassword).
  app.get('/api/v2/settings/smtp', async (req, reply) => {
    try {
      requireSuperadmin(req);
      const row = await app.db.selectFrom('app_settings')
        .select(['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_from_name', 'smtp_password_enc'])
        .where('id', '=', 1).executeTakeFirstOrThrow();
      return reply.send({
        host: row.smtp_host, port: row.smtp_port, secure: !!row.smtp_secure, user: row.smtp_user,
        from: row.smtp_from, fromName: row.smtp_from_name,
        configured: !!(row.smtp_host && row.smtp_port && row.smtp_from),
        hasPassword: !!row.smtp_password_enc
      });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/settings/smtp - nur Superadmin. password weggelassen/leer = vorhandenes
  // Passwort bleibt unveraendert (verhindert, dass ein leeres Feld im UI das Passwort löscht).
  app.patch('/api/v2/settings/smtp', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const parsed = smtpConfigSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const updates: Record<string, unknown> = {
        smtp_host: parsed.data.host,
        smtp_port: parsed.data.port,
        smtp_secure: parsed.data.secure,
        smtp_user: parsed.data.user ?? null,
        smtp_from: parsed.data.from,
        smtp_from_name: parsed.data.fromName ?? null,
        updated_at: new Date().toISOString()
      };
      if (parsed.data.password) {
        const dek = await ensureDek(app.db, deps.keyProvider, 'app_settings.smtp_password');
        updates.smtp_password_enc = fieldCipher.encryptField(parsed.data.password, dek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'app_settings', recordId: '1', fieldName: 'smtp_password', keyVersion: dek.keyVersion
        });
      }

      await app.db.updateTable('app_settings').set(updates).where('id', '=', 1).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'settings.smtp_updated', target_type: 'settings', target_id: '1', detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/settings/smtp/test - nur Superadmin. Schickt eine Test-Mail an die eigene,
  // im Profil hinterlegte Adresse.
  app.post('/api/v2/settings/smtp/test', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const parsed = z.object({ to: z.string().trim().email() }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (!(await isSmtpConfigured({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }))) {
        return reply.code(409).send({ error: 'smtp_not_configured' });
      }
      await sendMail(
        { db: app.db, env: deps.env, keyProvider: deps.keyProvider },
        parsed.data.to,
        'Test-E-Mail vom Support Portal',
        `Diese Test-E-Mail bestätigt, dass die SMTP-Konfiguration funktioniert (ausgelöst von ${session.username}).`
      );
      return reply.send({ success: true });
    } catch (e: any) {
      if (e?.message === 'smtp_not_configured') return reply.code(409).send({ error: 'smtp_not_configured' });
      return routeError(app, reply, e);
    }
  });

  // --- LDAP (optionaler Login per Verzeichnisdienst-Bind, siehe auth/ldap.ts) ---

  // GET /api/v2/settings/ldap - nur Superadmin. Gibt NIE das Bind-Passwort zurück.
  app.get('/api/v2/settings/ldap', async (req, reply) => {
    try {
      requireSuperadmin(req);
      const row = await app.db.selectFrom('app_settings')
        .select(['ldap_enabled', 'ldap_url', 'ldap_bind_dn', 'ldap_base_dn', 'ldap_user_filter', 'ldap_bind_password_enc'])
        .where('id', '=', 1).executeTakeFirstOrThrow();
      return reply.send({
        enabled: !!row.ldap_enabled, url: row.ldap_url, bindDn: row.ldap_bind_dn,
        baseDn: row.ldap_base_dn, userFilter: row.ldap_user_filter,
        hasBindPassword: !!row.ldap_bind_password_enc
      });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/settings/ldap - nur Superadmin. bindPassword weggelassen/leer = vorhandenes
  // Passwort bleibt unverändert.
  app.patch('/api/v2/settings/ldap', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const parsed = ldapConfigSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

      const updates: Record<string, unknown> = {
        ldap_enabled: parsed.data.enabled,
        ldap_url: parsed.data.url,
        ldap_bind_dn: parsed.data.bindDn,
        ldap_base_dn: parsed.data.baseDn,
        ldap_user_filter: parsed.data.userFilter,
        updated_at: new Date().toISOString()
      };
      if (parsed.data.bindPassword) {
        const dek = await ensureDek(app.db, deps.keyProvider, 'app_settings.ldap_bind_password');
        updates.ldap_bind_password_enc = fieldCipher.encryptField(parsed.data.bindPassword, dek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'app_settings', recordId: '1', fieldName: 'ldap_bind_password', keyVersion: dek.keyVersion
        });
      }

      await app.db.updateTable('app_settings').set(updates).where('id', '=', 1).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'settings.ldap_updated', target_type: 'settings', target_id: '1', detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/settings/ldap/test - nur Superadmin. Prüft Service-Bind + Suche + Bind als die
  // eigene Person mit dem übergebenen Passwort (eigenes Konto muss denselben Benutzernamen in
  // LDAP wie lokal haben).
  app.post('/api/v2/settings/ldap/test', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (!(await isLdapEnabled({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }))) {
        return reply.code(409).send({ error: 'ldap_not_configured' });
      }
      const ok = await authenticateLdap({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }, session.username, parsed.data.password);
      return reply.send({ success: ok });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Kategorien ---

  app.get('/api/v2/categories', async (req, reply) => {
    try {
      requireSession(req);
      const categories = await app.db.selectFrom('categories').selectAll().orderBy('name', 'asc').execute();
      return reply.send({
        categories: categories.map(c => ({
          ...c,
          custom_fields: c.custom_fields_json ? JSON.parse(c.custom_fields_json) : []
        }))
      });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/categories', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
      const existing = await app.db.selectFrom('categories').select('id').where('name', '=', parsed.data.name).executeTakeFirst();
      if (existing) return reply.code(409).send({ error: 'name_taken' });
      const id = randomUUID();
      await app.db.insertInto('categories').values({
        id,
        name: parsed.data.name,
        auto_assign_group_id: parsed.data.auto_assign_group_id ?? null,
        custom_fields_json: JSON.stringify(parsed.data.custom_fields),
        locked: false,
        archived: false
      }).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'category.created', target_type: 'category', target_id: id, detail_json: JSON.stringify({ name: parsed.data.name })
      }).execute();
      return reply.code(201).send({ id, name: parsed.data.name });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.patch('/api/v2/categories/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.auto_assign_group_id !== undefined) updates.auto_assign_group_id = parsed.data.auto_assign_group_id;
      if (parsed.data.custom_fields !== undefined) updates.custom_fields_json = JSON.stringify(parsed.data.custom_fields);
      if (parsed.data.locked !== undefined) updates.locked = parsed.data.locked;
      if (parsed.data.archived !== undefined) updates.archived = parsed.data.archived;

      await app.db.updateTable('categories').set(updates).where('id', '=', id).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'category.updated', target_type: 'category', target_id: id,
        detail_json: JSON.stringify({ name: parsed.data.name, archived: parsed.data.archived })
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
