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
import { mysqlTimestamp } from '../../db/date.js';
import { MAIL_SECRET_KEYS, readMailSecrets, encryptMailSecrets } from '../../mail/secrets.js';

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
  // format: Vorlage mit {prefix}/{category}/{number}. {number} MUSS enthalten sein, sonst wären
  // Ticketnummern nicht mehr eindeutig unterscheidbar (buildTicketNumber in tickets.ts fiel
  // bisher nur beim tatsächlichen Erzeugen still auf die reine Zahl zurück -- das Problem war in
  // den Systemeinstellungen selbst nie sichtbar). Jetzt bereits hier beim Speichern hart
  // abgelehnt, damit die Person sofort merkt, dass die Vorlage so nicht funktioniert.
  ticketNumberFormat: z.object({
    prefix: z.string().max(16).default(''),
    padding: z.number().int().min(1).max(12).default(5),
    format: z.string().trim().max(64).optional().refine(
      value => !value || value.includes('{number}'),
      'Das Format muss den Platzhalter {number} enthalten, sonst sind Ticketnummern nicht mehr eindeutig.'
    )
  }).optional(),
  // Pro Kategorie ein eigenes Format (überschreibt ticketNumberFormat.format für diese Kategorie)
  // -- derselbe {number}-Zwang wie oben gilt hier genauso.
  ticketNumberCategoryFormats: z.record(
    z.string(),
    z.string().trim().max(64).refine(value => value.includes('{number}'), 'Das Format muss den Platzhalter {number} enthalten.')
  ).optional(),
  accountSelfServiceFields: z.array(z.enum(['name', 'email', 'department', 'phone', 'mobile', 'jobTitle', 'officeLocation'])).optional(),
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
    idleTimeoutMinutes: z.number().int().min(1).max(10080).optional(),
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
    // Einzige Signatur-Einstellung im System (vorher zusätzlich doppelt in
    // companyBrandingConfig.signature/htmlSignature -- selber Zweck, zwei Orte, keine davon
    // tatsächlich beim Versand genutzt). "signature" ist die Klartext-Fallback-Variante für
    // Mails ohne HTML, "htmlSignature" wird nur angehängt, wenn htmlEnabled aktiv ist.
    signature: z.string().max(5000).optional(),
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
    location: z.string().trim().max(255).optional()
    // signature/htmlSignature gibt es hier bewusst nicht mehr -- siehe emailAdvancedConfig
    // (einzige E-Mail-Signatur-Einstellung, war vorher sinnlos doppelt).
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

// Security-Audit M-5: GET /api/v2/settings entfernte bisher nur drei private Mail-Schlüssel,
// gab aber BCC-Archivadresse, Outlook-Tenant-/Client-ID, Postfach, Mailvorlage und die komplette
// Sicherheitsrichtlinie (Sperrschwelle, Sitzungsdauer, 2FA-Pflicht) an JEDES angemeldete Konto
// heraus. Diese Blöcke sind reine Admin-Konfiguration ohne Nutzen für normale Benutzeroberflächen
// (SLA/Geschäftszeiten/Ticketnummern/Benachrichtigungsregeln/Branding bleiben erhalten).
function removeAdminOnlyConfig(config: Record<string, any>): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(config || {}));
  delete clone.emailAdvancedConfig;
  delete clone.outlookConfig;
  delete clone.securityConfig;
  return clone;
}

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
      const session = requireSession(req);
      const row = await app.db.selectFrom('app_settings')
        .select(['company_name', 'portal_name', 'config_json'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      let config = removeWriteOnlyMailSecrets(row.config_json ? JSON.parse(row.config_json) : {});
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin) config = removeAdminOnlyConfig(config);
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
      const updates: Record<string, unknown> = { updated_at: mysqlTimestamp() };

      if (typeof body.companyName === 'string') updates.company_name = body.companyName.trim().slice(0, 255);
      if (typeof body.portalName === 'string') updates.portal_name = body.portalName.trim().slice(0, 255);

      if (body.config !== undefined) {
        const parsed = settingsConfigSchema.safeParse(body.config);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_config', details: parsed.error.flatten() });

        // Die Stellenzahl darf nicht unter die Ziffernzahl der bereits höchsten vergebenen
        // Ticketnummer sinken -- technisch würde das wegen padStart() keine Kollision erzeugen
        // (eine 4-stellige Zahl bleibt 4-stellig, auch bei padding=3), aber es wirkt in der
        // Oberfläche inkonsistent/irreführend ("001"-"999" und dann plötzlich "1000" in derselben
        // Spalte). Siehe ticketNumber.ts: die Zahl selbst wird NIE abgeschnitten, nur die
        // führenden Nullen; ein höherer Zähler wird automatisch länger statt zu überlaufen.
        if (parsed.data.ticketNumberFormat?.padding !== undefined) {
          const rows = await app.db.selectFrom('tickets').select('ticket_number').execute();
          const highestSequence = rows.reduce((max, row) => {
            const digits = String(row.ticket_number || '').match(/(\d+)(?!.*\d)/);
            return Math.max(max, digits ? parseInt(digits[1]!, 10) : 0);
          }, 0);
          const minRequiredDigits = String(highestSequence).length;
          if (parsed.data.ticketNumberFormat.padding < minRequiredDigits) {
            return reply.code(400).send({
              error: 'padding_too_low',
              minRequired: minRequiredDigits,
              detail: `Die Stellenzahl darf nicht unter ${minRequiredDigits} sinken -- die höchste bisher vergebene Ticketnummer hat bereits ${minRequiredDigits} Stellen.`
            });
          }
        }

        const existing = await app.db.selectFrom('app_settings').select(['config_json', 'mail_secrets_enc']).where('id', '=', 1).executeTakeFirstOrThrow();
        const merged = mergeSettingsConfig(existing.config_json ? JSON.parse(existing.config_json) : {}, parsed.data);
        const mailDeps = { db: app.db, ...deps };
        if (merged.emailAdvancedConfig) {
          const secrets = await readMailSecrets(mailDeps, existing.mail_secrets_enc);
          let changed = false;
          for (const key of MAIL_SECRET_KEYS) {
            const value = merged.emailAdvancedConfig[key];
            if (typeof value === 'string' && value) { secrets[key] = value; changed = true; }
            delete merged.emailAdvancedConfig[key];
          }
          if (changed) updates.mail_secrets_enc = await encryptMailSecrets(mailDeps, secrets);
        }
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

      // Security-Audit B12: ein leeres Passwortfeld lässt bisher das gespeicherte Passwort auch
      // dann stehen, wenn Host oder Port auf ein ANDERES Ziel geändert werden -- wer (oder wer es
      // übernimmt) einen eigenen Server einträgt, würde so unwissentlich das SMTP-Passwort an
      // diesen neuen Server senden. Bei geändertem Host/Port ist ein neues Passwort Pflicht.
      const currentSmtp = await app.db.selectFrom('app_settings').select(['smtp_host', 'smtp_port']).where('id', '=', 1).executeTakeFirst();
      const smtpTargetChanged = !!currentSmtp && (currentSmtp.smtp_host !== parsed.data.host || currentSmtp.smtp_port !== parsed.data.port);
      if (smtpTargetChanged && !parsed.data.password) {
        return reply.code(400).send({ error: 'password_required_for_new_target' });
      }

      const updates: Record<string, unknown> = {
        smtp_host: parsed.data.host,
        smtp_port: parsed.data.port,
        smtp_secure: parsed.data.secure,
        smtp_user: parsed.data.user ?? null,
        smtp_from: parsed.data.from,
        smtp_from_name: parsed.data.fromName ?? null,
        updated_at: mysqlTimestamp()
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

  // --- Outlook/Microsoft Graph (App-only Client-Credentials-Flow, siehe domain/graphClient.ts) ---

  // GET /api/v2/settings/outlook - nur Superadmin. Gibt NIE das Client-Secret zurück.
  app.get('/api/v2/settings/outlook', async (req, reply) => {
    try {
      requireSuperadmin(req);
      const row = await app.db.selectFrom('app_settings').select(['config_json', 'outlook_client_secret_enc']).where('id', '=', 1).executeTakeFirstOrThrow();
      const config = row.config_json ? JSON.parse(row.config_json) : {};
      const outlook = config.outlookConfig || {};
      return reply.send({
        enabled: !!outlook.enabled, tenantId: outlook.tenantId || '', clientId: outlook.clientId || '',
        mailbox: outlook.mailbox || '', hasClientSecret: !!row.outlook_client_secret_enc
      });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const outlookSecretSchema = z.object({ clientSecret: z.string().min(1).max(1024).optional() });

  // PATCH /api/v2/settings/outlook/secret - nur Superadmin. Eigener Endpoint statt Teil von
  // PATCH /settings, weil das Client-Secret -- wie SMTP-/LDAP-Passwort -- verschlüsselt in einer
  // eigenen Spalte liegt und nie über config_json liest-/schreibbar sein soll.
  app.patch('/api/v2/settings/outlook/secret', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      const parsed = outlookSecretSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      if (!parsed.data.clientSecret) return reply.send({ success: true });

      const dek = await ensureDek(app.db, deps.keyProvider, 'app_settings.outlook_client_secret');
      const outlook_client_secret_enc = fieldCipher.encryptField(parsed.data.clientSecret, dek.rawDek, {
        installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'app_settings', recordId: '1', fieldName: 'outlook_client_secret', keyVersion: dek.keyVersion
      });
      await app.db.updateTable('app_settings').set({ outlook_client_secret_enc, updated_at: mysqlTimestamp() }).where('id', '=', 1).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'settings.outlook_secret_updated', target_type: 'settings', target_id: '1', detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
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

      // Security-Audit B12: nur verschlüsselte LDAP-Verbindungen zulassen -- mit ldap:// gehen
      // sowohl das Dienstkonto-Bind-Passwort als auch die Login-Passwörter der Nutzenden
      // unverschlüsselt übers Netz.
      if (!/^ldaps:\/\//i.test(parsed.data.url)) {
        return reply.code(400).send({ error: 'ldaps_required' });
      }
      // Wie bei SMTP: bei geändertem Ziel (URL) ist ein neues Bind-Passwort Pflicht, sonst würde
      // das gespeicherte Dienstkonto-Passwort an einen neuen, potenziell fremden Server gehen.
      const currentLdap = await app.db.selectFrom('app_settings').select(['ldap_url']).where('id', '=', 1).executeTakeFirst();
      const ldapTargetChanged = !!currentLdap && currentLdap.ldap_url !== parsed.data.url;
      if (ldapTargetChanged && !parsed.data.bindPassword) {
        return reply.code(400).send({ error: 'password_required_for_new_target' });
      }

      const updates: Record<string, unknown> = {
        ldap_enabled: parsed.data.enabled,
        ldap_url: parsed.data.url,
        ldap_bind_dn: parsed.data.bindDn,
        ldap_base_dn: parsed.data.baseDn,
        ldap_user_filter: parsed.data.userFilter,
        updated_at: mysqlTimestamp()
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

      const updates: Record<string, unknown> = { updated_at: mysqlTimestamp() };
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
