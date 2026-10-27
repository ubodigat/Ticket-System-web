/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Users & Groups API - Sichere Benutzerverwaltung mit RBAC
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { requireSession, requireAdmin } from './session.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher, computeBlindIndex, decryptFieldTolerant } from '../../crypto/fieldCrypto.js';
import { queueMailIfConfigured } from '../../mail/queue.js';
import { routeError } from './routeError.js';
import { mysqlTimestamp } from '../../db/date.js';
import { isAccountExpired, isValidAccountDate } from '../../domain/accountValidity.js';
import { loadSecurityPolicy } from '../../domain/securityPolicy.js';
import { isSourceLocked, recordSourceFailure, clearSourceFailures } from '../../domain/loginThrottle.js';
import { loadPasswordPolicy, passwordFailures, generatePolicyPassword } from '../../domain/passwordPolicy.js';

export interface UsersRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

function safeUserProfileFields(app: FastifyInstance, deps: UsersRouteDeps, row: Record<string, any>, nameDek: { rawDek: Buffer; keyVersion: number }, emailDek: { rawDek: Buffer; keyVersion: number }): { name: string; email: string } {
  const ctx = (fieldName: string, keyVersion: number) => ({
    installationId: deps.env.INSTALLATION_ID,
    schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users',
    recordId: row.id,
    fieldName,
    keyVersion
  });
  try {
    return {
      name: fieldCipher.decryptField(row.name_enc, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
      email: fieldCipher.decryptField(row.email_enc, emailDek.rawDek, ctx('email', emailDek.keyVersion))
    };
  } catch (err) {
    app.log.error({ err, userId: row.id }, 'Benutzerprofil konnte nicht entschluesselt werden');
    return { name: row.username, email: '' };
  }
}

// Security-Audit N10: Telefon/Mobilnummer/Position/Standort sind jetzt genauso AES-256-GCM-
// verschlüsselt wie name/email -- dieselbe Pro-Zweck-DEK-Struktur wie TicketDeks in tickets.ts.
interface ContactDeks {
  phone: { rawDek: Buffer; keyVersion: number };
  mobile: { rawDek: Buffer; keyVersion: number };
  jobTitle: { rawDek: Buffer; keyVersion: number };
  officeLocation: { rawDek: Buffer; keyVersion: number };
}

async function loadContactDeks(app: FastifyInstance, keyProvider: KeyProvider): Promise<ContactDeks> {
  const [phone, mobile, jobTitle, officeLocation] = await Promise.all([
    ensureDek(app.db, keyProvider, 'users.phone'),
    ensureDek(app.db, keyProvider, 'users.mobile'),
    ensureDek(app.db, keyProvider, 'users.job_title'),
    ensureDek(app.db, keyProvider, 'users.office_location')
  ]);
  return { phone, mobile, jobTitle, officeLocation };
}

function encryptContactField(value: string, dek: { rawDek: Buffer; keyVersion: number }, deps: UsersRouteDeps, recordId: string, fieldName: string): Buffer {
  return fieldCipher.encryptField(value, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users', recordId, fieldName, keyVersion: dek.keyVersion
  });
}

// Security-Audit R-2: tolerant entschlüsseln (siehe fieldCrypto.ts decryptFieldTolerant) -- diese
// vier Felder wurden per Migration 0035 nachträglich auf verschlüsselt umgestellt, ohne
// vorhandene Klartextwerte selbst zu verschlüsseln. db/reencryptLegacy.ts behebt das automatisch
// bei jedem migrate.js-Lauf; dieser tolerante Fallback ist nur das zusätzliche Sicherheitsnetz.
function decryptContactField(stored: Buffer, dek: { rawDek: Buffer; keyVersion: number }, deps: UsersRouteDeps, recordId: string, fieldName: string): string {
  return decryptFieldTolerant(stored, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'users', recordId, fieldName, keyVersion: dek.keyVersion
  });
}

function decryptContactFields(
  row: { id: string; phone?: Buffer | null; mobile?: Buffer | null; job_title?: Buffer | null; office_location?: Buffer | null },
  deks: ContactDeks,
  deps: UsersRouteDeps
): { phone: string | null; mobile: string | null; job_title: string | null; office_location: string | null } {
  return {
    phone: row.phone ? decryptContactField(row.phone, deks.phone, deps, row.id, 'phone') : null,
    mobile: row.mobile ? decryptContactField(row.mobile, deks.mobile, deps, row.id, 'mobile') : null,
    job_title: row.job_title ? decryptContactField(row.job_title, deks.jobTitle, deps, row.id, 'job_title') : null,
    office_location: row.office_location ? decryptContactField(row.office_location, deks.officeLocation, deps, row.id, 'office_location') : null
  };
}

// Granulare Zusatzrechte fuer normale Admin-Konten -- gab es in der lokalen Version vom
// 07.10.2026 im Benutzer-Editor ("Verwaltung"/"Zusatzfunktionen"), war in der Serverversion
// zwischenzeitlich komplett entfernt statt wie das ueberall sonst in diesem Projekt uebliche
// Muster real angebunden zu werden (siehe z.B. department/ticketNumberFormat).
const userPermissionsSchema = z.object({
  canManageRequests: z.boolean().optional(),
  canManageUsers: z.boolean().optional(),
  canViewLogs: z.boolean().optional(),
  canManage2FA: z.boolean().optional(),
  textBlocks: z.boolean().optional(),
  reports: z.boolean().optional(),
  approvals: z.boolean().optional(),
  recurring: z.boolean().optional(),
  kb: z.enum(['none', 'read', 'edit']).optional()
});

const createUserSchema = z.object({
  account_valid_until: z.string().refine(isValidAccountDate, 'invalid_date').nullable().optional(),
  username: z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N}_.-]+$/u, 'Nur Buchstaben, Zahlen, _, ., - erlaubt'),
  // Security-Audit N4: einheitlich 14 Zeichen wie beim Setup-Assistenten (setup.ts) -- vorher
  // galten für Admin-angelegte Konten/Passwortänderungen abweichend nur 12 Zeichen.
  password: z.string().min(14).max(512),
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(255),
  role: z.enum(['user', 'admin', 'superadmin']),
  department_group_id: z.string().nullable().optional(),
  department: z.string().trim().max(255).nullable().optional(),
  // Weitere, typischerweise aus einem AD synchronisierbare Kontakt-/Organisationsfelder
  // (telephoneNumber/mobile/title/physicalDeliveryOfficeName) -- gleiches Muster wie department:
  // Klartext, keine Pflichtfelder.
  phone: z.string().trim().max(64).nullable().optional(),
  mobile: z.string().trim().max(64).nullable().optional(),
  job_title: z.string().trim().max(255).nullable().optional(),
  office_location: z.string().trim().max(255).nullable().optional(),
  supervisor_user_id: z.string().nullable().optional(),
  permissions: userPermissionsSchema.optional(),
  // Security-Audit N7: LDAP-Login ist Opt-in je Konto, Standard false (siehe migration 0033).
  ldap_login_enabled: z.boolean().optional()
});

const updateUserSchema = z.object({
  account_valid_until: z.string().refine(isValidAccountDate, 'invalid_date').nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(['user', 'admin']).optional(),
  department_group_id: z.string().nullable().optional(),
  // Freitext-Einrichtung/Abteilung (nicht zu verwechseln mit department_group_id, der
  // Gruppenzugehörigkeit) -- die UI-seitige Sichtbarkeit beim Selbst-Bearbeiten regelt
  // accountConfig.editable.department (Systemeinstellungen), nicht diese Schema-Prüfung hier;
  // dasselbe Muster wie bei name/email oben.
  department: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  mobile: z.string().trim().max(64).nullable().optional(),
  job_title: z.string().trim().max(255).nullable().optional(),
  office_location: z.string().trim().max(255).nullable().optional(),
  supervisor_user_id: z.string().nullable().optional(),
  account_archived: z.boolean().optional(),
  locked_permanent: z.boolean().optional(),
  // Security-Audit N7: LDAP-Login ist Opt-in je Konto, nur eine Superadmin-Person darf es
  // umschalten (siehe PATCH-Handler unten).
  ldap_login_enabled: z.boolean().optional(),
  permissions: userPermissionsSchema.optional(),
  notif_prefs: z.record(z.string(), z.object({
    app: z.boolean().optional(),
    email: z.boolean().optional()
  })).optional()
});

const changePasswordSchema = z.object({
  old_password: z.string().min(1).optional(), // nicht required bei Admin-Reset
  new_password: z.string().min(14).max(512) // Security-Audit N4: einheitlich 14 Zeichen (siehe oben)
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(128),
  is_default: z.boolean().default(false)
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  is_default: z.boolean().optional()
});

const deleteUserQuerySchema = z.object({
  tickets: z.enum(['archive', 'delete']).default('archive')
});

// Formel-Injektions-Neutralisierung (docs/SPEC.md §10): Excel/LibreOffice/Sheets interpretieren
// Zellen, die mit =, +, -, @ beginnen, als Formel -- eine Zelle mit z.B. "=HYPERLINK(...)" kann
// beim Öffnen des Exports in einer Tabellenkalkulation Code/Netzwerkzugriffe auslösen. Jede
// potenziell gefährliche Zelle bekommt daher ein führendes Apostroph, das die Kalkulation als
// reinen Text behandelt, ohne den sichtbaren Inhalt zu verändern. Exportiert für Tests.
export function csvSafeCell(value: string): string {
  const needsNeutralization = /^[=+\-@\t\r]/.test(value);
  const escaped = `"${value.replace(/"/g, '""')}"`;
  return needsNeutralization ? `"'${value.replace(/"/g, '""')}"` : escaped;
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') inQuotes = false;
      else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells.map(cell => (cell.startsWith("'") && /^[=+\-@]/.test(cell.slice(1)) ? cell.slice(1) : cell));
}

// Einfache Levenshtein-Distanz, nur fuer "ähnlicher Name"-Hinweise bei der Benutzeranlage
// (check-similar) -- bricht frueh ab statt die volle DP-Tabelle zu berechnen, sobald eine
// Distanz > 2 feststeht, da hier nur "<= 2" interessiert (z.B. Tippfehler), kein exakter Wert.
function levenshteinWithinTwo(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a === b) return true;
  const m = a.length, n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > 2) return false;
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n] <= 2;
}

const setAbsenceSchema = z.object({
  active: z.boolean(),
  from_at: z.string().datetime().nullable().optional(),
  until_at: z.string().datetime().nullable().optional(),
  substitute_user_id: z.string().nullable().optional(),
  visible: z.boolean().default(false)
});

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function registerUsersV2Routes(app: FastifyInstance, deps: UsersRouteDeps): void {

  // Korrelierte Unterabfragen für die aktuell laufende Abwesenheit (hoechstens eine Zeile mit
  // active=true pro Person, siehe POST /users/me/absence: eine laufende Abwesenheit wird immer
  // zuerst beendet, bevor eine neue beginnt). Fehlte bisher komplett in der API-Antwort --
  // AdminBoard.renderUserManager/Settings.renderAbsenceArea lasen deshalb immer "keine Abwesenheit",
  // selbst wenn in der Datenbank eine aktive Abwesenheit hinterlegt war.
  const absenceSelects = (eb: any) => [
    eb.selectFrom('user_absences').select('from_at')
      .whereRef('user_absences.user_id', '=', 'users.id').where('user_absences.active', '=', true)
      .limit(1).as('absence_from_at'),
    eb.selectFrom('user_absences').select('until_at')
      .whereRef('user_absences.user_id', '=', 'users.id').where('user_absences.active', '=', true)
      .limit(1).as('absence_until_at'),
    eb.selectFrom('user_absences').select('visible')
      .whereRef('user_absences.user_id', '=', 'users.id').where('user_absences.active', '=', true)
      .limit(1).as('absence_visible'),
    eb.selectFrom('user_absences')
      .innerJoin('users as su', 'su.id', 'user_absences.substitute_user_id')
      .select('su.username')
      .whereRef('user_absences.user_id', '=', 'users.id').where('user_absences.active', '=', true)
      .limit(1).as('absence_substitute_username')
  ];

  // Wandelt die vier absence_*-Rohspalten in das vom Frontend erwartete Objekt
  // { active, pending, substitute, visible, fromMs, untilMs } um (siehe
  // AdminBoard.absenceInfoText/renderUserManager, Settings.renderAbsenceArea). "pending" =
  // eine künftige Abwesenheit ist hinterlegt, aber ihr Beginn liegt noch in der Zukunft;
  // "active" = sie gilt bereits heute.
  // permissions_json haelt sowohl die vier "Verwaltung"-Schalter (canManageRequests/
  // canManageUsers/canViewLogs/canManage2FA, in der lokalen Version Top-Level-Felder auf dem
  // Benutzerobjekt) als auch die "Zusatzfunktionen" (permissions.textBlocks/reports/approvals/
  // recurring/kb) -- eine Spalte statt neun, aber nach aussen in exakt der Form, die die
  // Oberflaeche (AdminBoard/Settings) erwartet.
  function buildPermissionFields(permissionsJson: string | null) {
    const parsed = parseJsonObject(permissionsJson);
    const { canManageRequests, canManageUsers, canViewLogs, canManage2FA, ...rest } = parsed as Record<string, unknown>;
    return {
      canManageRequests: !!canManageRequests,
      canManageUsers: !!canManageUsers,
      canViewLogs: !!canViewLogs,
      canManage2FA: !!canManage2FA,
      permissions: rest
    };
  }

  function buildNotificationPrefs(notifPrefsJson: string | null | undefined) {
    return parseJsonObject(notifPrefsJson);
  }

  async function loadAccountSelfServiceFields(): Promise<Set<string>> {
    const row = await app.db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
    const config = parseJsonObject(row?.config_json);
    const fields = Array.isArray(config.accountSelfServiceFields)
      ? config.accountSelfServiceFields.filter(item => typeof item === 'string')
      : ['name', 'email'];
    return new Set(fields);
  }

  async function hasAdminPermission(session: { uid: string; role: string }, key: 'canManageRequests' | 'canManageUsers' | 'canViewLogs' | 'canManage2FA'): Promise<boolean> {
    if (session.role === 'superadmin') return true;
    if (session.role !== 'admin') return false;
    const row = await app.db.selectFrom('users').select('permissions_json').where('id', '=', session.uid).executeTakeFirst();
    const permissions = parseJsonObject(row?.permissions_json);
    return permissions[key] === true;
  }

  // Security-Audit M-6: ohne diese Prüfung kann der letzte aktive Superadmin sich selbst (oder
  // ein anderer Superadmin ihn) zum Admin herabstufen, sperren oder archivieren -- danach gäbe
  // es kein Konto mehr, das Systemeinstellungen/Superadmin-only-Aktionen ausführen kann.
  async function assertNotLastSuperadmin(targetId: string): Promise<void> {
    const row = await app.db.selectFrom('users')
      .select(eb => eb.fn.countAll<string>().as('n'))
      .where('role', '=', 'superadmin')
      .where('id', '!=', targetId)
      .where('account_archived', '=', false)
      .where('locked_permanent', '=', false)
      .where('account_valid_until', 'is', null)
      .executeTakeFirstOrThrow();
    if (Number(row.n) === 0) throw { statusCode: 409, message: 'last_superadmin' };
  }

  function buildAbsence(row: { absence_from_at?: Date | string | null; absence_until_at?: Date | string | null; absence_visible?: boolean | null; absence_substitute_username?: string | null }) {
    // Keine aktive Abwesenheitszeile für diese Person gefunden -- alle vier Unterabfragen
    // liefern dann NULL (absence_visible ist eine Boolean-Spalte, NULL heisst hier "keine Zeile",
    // nicht "false").
    if (row.absence_visible == null && row.absence_from_at == null && row.absence_until_at == null && row.absence_substitute_username == null) {
      return null;
    }
    const fromMs = row.absence_from_at ? new Date(row.absence_from_at).getTime() : null;
    const untilMs = row.absence_until_at ? new Date(row.absence_until_at).getTime() : null;
    const pending = !!fromMs && fromMs > Date.now();
    return {
      active: !pending,
      pending,
      substitute: row.absence_substitute_username ?? null,
      visible: !!row.absence_visible,
      fromMs,
      untilMs
    };
  }

  // GET /api/v2/users - Alle Benutzer (nur Admin)
  app.get('/api/v2/users', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers')) && !(await hasAdminPermission(session, 'canManage2FA'))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('users')
        .select(eb => [
          'id', 'username', 'name_enc', 'email_enc', 'role', 'department_group_id', 'department', 'phone', 'mobile', 'job_title', 'office_location', 'supervisor_user_id', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'created_at', 'permissions_json', 'notif_prefs_json', 'ldap_login_enabled', 'account_valid_until',
          ...absenceSelects(eb)
        ])
        .orderBy('created_at', 'asc')
        .execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const contactDeks = await loadContactDeks(app, deps.keyProvider);
      const users = rows.map(row => {
        const profile = safeUserProfileFields(app, deps, row, nameDek, emailDek);
        return {
          ...row,
          name_enc: undefined,
          email_enc: undefined,
          permissions_json: undefined,
          notif_prefs_json: undefined,
          name: profile.name,
          email: profile.email,
          ...decryptContactFields(row as any, contactDeks, deps),
          notif_prefs: buildNotificationPrefs(row.notif_prefs_json),
          absence: buildAbsence(row as any),
          ...buildPermissionFields(row.permissions_json)
        };
      });
      return reply.send({ users });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/users/directory - schlankes Personenverzeichnis fuer alle angemeldeten Rollen.
  // Normale Benutzer brauchen Namen/IDs fuer Ticket-Ansichten, Benachrichtigungen und Auswahlfelder,
  // duerfen aber keine Admin-Felder wie Sperren, Rechte oder Audit-relevante Status sehen.
  app.get('/api/v2/users/directory', async (req, reply) => {
    try {
      const session = requireSession(req);
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      const rows = await app.db.selectFrom('users')
        .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'department_group_id', 'department', 'phone', 'mobile', 'job_title', 'office_location', 'supervisor_user_id', 'account_archived'])
        .where('account_archived', '=', false)
        .orderBy('username', 'asc')
        .execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      // Security-Audit R-16: normale Nutzer bekamen bisher Kontaktdaten (E-Mail, Telefon, Mobil,
      // Funktion, Standort, Vorgesetzte) ALLER aktiven Konten inklusive aller Admins -- ein
      // einzelnes kompromittiertes Nutzerkonto lieferte damit eine vollstaendige Liste fuer
      // Phishing/Social Engineering. Fuer die Rolle "user" reicht id/username/name (fuer
      // Erwaehnungen, Zuweisungsanzeige und Auswahlfelder, siehe js/todos.js/user-dash.js) --
      // Kontaktdaten nur noch fuer Admin-/Superadmin-Konten.
      if (!isAdmin) {
        // Ohne Rolle: normale Konten muessen nicht wissen, wer Admin ist (lohnende Phishing-Ziele).
        const users = rows.map(row => ({
          id: row.id,
          username: row.username,
          name: safeUserProfileFields(app, deps, row, nameDek, emailDek).name,
          account_archived: row.account_archived
        }));
        return reply.send({ users });
      }
      const contactDeks = await loadContactDeks(app, deps.keyProvider);
      const users = rows.map(row => {
        const profile = safeUserProfileFields(app, deps, row, nameDek, emailDek);
        const contact = decryptContactFields(row, contactDeks, deps);
        return {
          id: row.id,
          username: row.username,
          name: profile.name,
          email: profile.email,
          role: row.role,
          department_group_id: row.department_group_id,
          department: row.department,
          phone: contact.phone,
          mobile: contact.mobile,
          job_title: contact.job_title,
          office_location: contact.office_location,
          supervisor_user_id: row.supervisor_user_id,
          account_archived: row.account_archived
        };
      });
      return reply.send({ users });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/users/me - Eigenes Profil
  app.get('/api/v2/users/me', async (req, reply) => {
    try {
      const session = requireSession(req);
      const row = await app.db.selectFrom('users')
        .select(eb => [
          'id', 'username', 'name_enc', 'email_enc', 'role', 'department_group_id', 'department', 'phone', 'mobile', 'job_title', 'office_location', 'supervisor_user_id', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'created_at', 'updated_at', 'permissions_json', 'notif_prefs_json', 'ldap_login_enabled', 'account_valid_until',
          ...absenceSelects(eb)
        ])
        .where('id', '=', session.uid)
        .executeTakeFirst();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const contactDeks = await loadContactDeks(app, deps.keyProvider);
      const profile = safeUserProfileFields(app, deps, row, nameDek, emailDek);
      const user = {
        ...row,
        name_enc: undefined,
        email_enc: undefined,
        permissions_json: undefined,
        notif_prefs_json: undefined,
        name: profile.name,
        email: profile.email,
        ...decryptContactFields(row as any, contactDeks, deps),
        notif_prefs: buildNotificationPrefs(row.notif_prefs_json),
        absence: buildAbsence(row as any),
        ...buildPermissionFields(row.permissions_json)
      };
      return reply.send({ user });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/users/check-similar?name=...&email=... (nur Admin) -- Hinweis beim Anlegen
  // eines neuen Benutzers, ob bereits ein gleiches oder ähnliches Konto existiert. "exact" blockt
  // das Anlegen in der Oberfläche (E-Mail wird serverseitig ohnehin zusätzlich hart per
  // Blind-Index geprüft, siehe POST /users), "similar" ist nur ein Hinweis, kein Blocker.
  app.get('/api/v2/users/check-similar', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const query = req.query as { name?: string; email?: string };
      const nameInput = (query.name || '').trim();
      const emailInput = (query.email || '').trim().toLowerCase();
      if (!nameInput && !emailInput) return reply.send({ exact: false, similar: [] });

      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
      const emailBlindIdx = emailInput ? computeBlindIndex(blindIndexDek.rawDek, emailInput) : null;

      const rows = await app.db.selectFrom('users')
        .select(['id', 'username', 'name_enc', 'email_enc', 'email_blind_idx', 'account_archived'])
        .execute();

      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedName = normalize(nameInput);
      let exact = false;
      const similar: Array<{ id: string; username: string; name: string; email: string; reason: string }> = [];

      for (const row of rows) {
        const profile = safeUserProfileFields(app, deps, row, nameDek, emailDek);
        const sameEmail = emailBlindIdx !== null && row.email_blind_idx === emailBlindIdx;
        const sameName = normalizedName.length > 0 && normalize(profile.name) === normalizedName;
        if (sameEmail && sameName) { exact = true; similar.push({ id: row.id, username: row.username, name: profile.name, email: profile.email, reason: 'name_and_email' }); continue; }
        if (sameEmail) { similar.push({ id: row.id, username: row.username, name: profile.name, email: profile.email, reason: 'email' }); continue; }
        if (sameName) { similar.push({ id: row.id, username: row.username, name: profile.name, email: profile.email, reason: 'name' }); continue; }
        if (normalizedName.length > 2 && levenshteinWithinTwo(normalize(profile.name), normalizedName)) {
          similar.push({ id: row.id, username: row.username, name: profile.name, email: profile.email, reason: 'similar_name' });
        }
      }
      return reply.send({ exact, similar: similar.slice(0, 5) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/users - Benutzer erstellen (nur Admin)
  app.post('/api/v2/users', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
      if (parsed.data.role === 'superadmin' && session.role !== 'superadmin') return reply.code(403).send({ error: 'forbidden' });
      const failures = passwordFailures(parsed.data.password, await loadPasswordPolicy(app.db));
      if (failures.length) return reply.code(400).send({ error: 'password_policy_failed', requirements: failures });

      // Doppelten Benutzernamen verhindern
      const existing = await app.db.selectFrom('users').select('id').where('username', '=', parsed.data.username).executeTakeFirst();
      if (existing) return reply.code(409).send({ error: 'username_taken' });

      const password_hash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
      const newId = randomUUID();

      // Name/E-Mail serverseitig AES-256-GCM-verschlüsselt, kanonisches AAD wie im Setup-Wizard
      // (apps/server/src/http/routes/setup.ts) -- NICHT Klartext in den *_enc-Spalten ablegen.
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
      const baseCtx = {
        installationId: deps.env.INSTALLATION_ID,
        schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'users',
        recordId: newId
      };
      const name_enc = fieldCipher.encryptField(parsed.data.name, nameDek.rawDek, { ...baseCtx, fieldName: 'name', keyVersion: nameDek.keyVersion });
      const email_enc = fieldCipher.encryptField(parsed.data.email, emailDek.rawDek, { ...baseCtx, fieldName: 'email', keyVersion: emailDek.keyVersion });
      const email_blind_idx = computeBlindIndex(blindIndexDek.rawDek, parsed.data.email.trim().toLowerCase());

      // E-Mail-Adresse muss eindeutig sein -- der Blind-Index macht einen Gleichheitsvergleich
      // moeglich, ohne die E-Mail dafuer im Klartext suchen zu muessen (siehe computeBlindIndex).
      // Zwei Konten mit derselben Adresse ergeben operativ keinen Sinn und waeren beim Login per
      // "Passwort vergessen"/Benachrichtigungen nicht eindeutig zuordenbar.
      const emailTaken = await app.db.selectFrom('users').select('id').where('email_blind_idx', '=', email_blind_idx).executeTakeFirst();
      if (emailTaken) return reply.code(409).send({ error: 'email_taken' });

      // Security-Audit N10: Kontaktfelder jetzt verschlüsselt wie name/email.
      const contactDeks = await loadContactDeks(app, deps.keyProvider);
      const phone_enc = parsed.data.phone ? encryptContactField(parsed.data.phone, contactDeks.phone, deps, newId, 'phone') : null;
      const mobile_enc = parsed.data.mobile ? encryptContactField(parsed.data.mobile, contactDeks.mobile, deps, newId, 'mobile') : null;
      const job_title_enc = parsed.data.job_title ? encryptContactField(parsed.data.job_title, contactDeks.jobTitle, deps, newId, 'job_title') : null;
      const office_location_enc = parsed.data.office_location ? encryptContactField(parsed.data.office_location, contactDeks.officeLocation, deps, newId, 'office_location') : null;

      await app.db.insertInto('users').values({
        id: newId,
        username: parsed.data.username,
        name_enc,
        email_enc,
        email_blind_idx,
        password_hash,
        role: parsed.data.role,
        department_group_id: parsed.data.department_group_id ?? null,
        department: parsed.data.department ?? null,
        phone: phone_enc,
        mobile: mobile_enc,
        job_title: job_title_enc,
        office_location: office_location_enc,
        supervisor_user_id: parsed.data.supervisor_user_id ?? null,
        // Zusatzrechte nur bei role='admin' sinnvoll (fuer 'user' zeigt der Editor das Feld gar
        // nicht an), trotzdem hier nicht erzwungen -- ein leeres Objekt bei 'user' ist harmlos.
        permissions_json: parsed.data.permissions ? JSON.stringify(parsed.data.permissions) : null,
        account_archived: false,
        account_valid_until: parsed.data.account_valid_until ?? null,
        locked_permanent: false,
        totp_enabled: false,
        // Security-Audit N7: nur eine Superadmin-Person darf LDAP-Login direkt beim Anlegen
        // freischalten; für Superadmin-Zielkonten bleibt es ohnehin immer deaktiviert (auth.ts
        // schließt sie unabhängig davon vom LDAP-Fallback aus).
        ldap_login_enabled: parsed.data.ldap_login_enabled === true && session.role === 'superadmin' && parsed.data.role !== 'superadmin',
        installation_id: deps.env.INSTALLATION_ID
      }).execute();

      // Global Audit-Log
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(),
        actor_user_id: session.uid,
        actor_username: session.username,
        action: 'user.created',
        target_type: 'user',
        target_id: newId,
        detail_json: JSON.stringify({ username: parsed.data.username, role: parsed.data.role })
      }).execute();

      return reply.code(201).send({ id: newId, username: parsed.data.username });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/users/:id - Benutzer aktualisieren (nur Admin, oder User für sich selbst)
  app.patch('/api/v2/users/:id', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      const canManageUsers = isAdmin ? await hasAdminPermission(session, 'canManageUsers') : false;

      // User kann nur sich selbst ändern (nur Name/Email), Admin kann alles
      if (!canManageUsers && session.uid !== id) return reply.code(403).send({ error: 'forbidden' });

      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      if (!canManageUsers) {
        const allowedFields = await loadAccountSelfServiceFields();
        if (parsed.data.name !== undefined && !allowedFields.has('name')) return reply.code(403).send({ error: 'field_not_editable', field: 'name' });
        if (parsed.data.email !== undefined && !allowedFields.has('email')) return reply.code(403).send({ error: 'field_not_editable', field: 'email' });
        if (parsed.data.department !== undefined && !allowedFields.has('department')) return reply.code(403).send({ error: 'field_not_editable', field: 'department' });
        if (parsed.data.phone !== undefined && !allowedFields.has('phone')) return reply.code(403).send({ error: 'field_not_editable', field: 'phone' });
        if (parsed.data.mobile !== undefined && !allowedFields.has('mobile')) return reply.code(403).send({ error: 'field_not_editable', field: 'mobile' });
        if (parsed.data.job_title !== undefined && !allowedFields.has('jobTitle')) return reply.code(403).send({ error: 'field_not_editable', field: 'job_title' });
        if (parsed.data.office_location !== undefined && !allowedFields.has('officeLocation')) return reply.code(403).send({ error: 'field_not_editable', field: 'office_location' });
        if (
          parsed.data.role !== undefined ||
          parsed.data.department_group_id !== undefined ||
          parsed.data.supervisor_user_id !== undefined ||
          parsed.data.account_archived !== undefined ||
          parsed.data.locked_permanent !== undefined ||
          parsed.data.account_valid_until !== undefined ||
          parsed.data.permissions !== undefined
        ) {
          return reply.code(403).send({ error: 'forbidden' });
        }
      }

      const updates: Record<string, unknown> = { updated_at: mysqlTimestamp() };
      let previousEmail: string | null = null;
      if (parsed.data.name !== undefined) {
        const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
        updates.name_enc = fieldCipher.encryptField(parsed.data.name, nameDek.rawDek, {
          installationId: deps.env.INSTALLATION_ID,
          schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users',
          recordId: id,
          fieldName: 'name',
          keyVersion: nameDek.keyVersion
        });
      }
      if (parsed.data.email !== undefined) {
        const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
        const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
        updates.email_enc = fieldCipher.encryptField(parsed.data.email, emailDek.rawDek, {
          installationId: deps.env.INSTALLATION_ID,
          schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users',
          recordId: id,
          fieldName: 'email',
          keyVersion: emailDek.keyVersion
        });
        updates.email_blind_idx = computeBlindIndex(blindIndexDek.rawDek, parsed.data.email.trim().toLowerCase());
        const emailTaken = await app.db.selectFrom('users').select('id')
          .where('email_blind_idx', '=', updates.email_blind_idx as string).where('id', '!=', id).executeTakeFirst();
        if (emailTaken) return reply.code(409).send({ error: 'email_taken' });
        const current = await app.db.selectFrom('users').select('email_enc').where('id', '=', id).executeTakeFirst();
        if (current?.email_enc) {
          try {
            const previous = fieldCipher.decryptField(current.email_enc, emailDek.rawDek, {
              installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
              tableName: 'users', recordId: id, fieldName: 'email', keyVersion: emailDek.keyVersion
            });
            if (previous.trim().toLowerCase() !== parsed.data.email.trim().toLowerCase()) previousEmail = previous;
          } catch (err) {
            app.log.error({ err, userId: id }, 'Bisherige E-Mail-Adresse nicht lesbar');
          }
        }
      }
      // department ist Klartext (kein personenbezogenes Pflichtfeld wie Name/E-Mail, keine
      // Verschlüsselung dafür vorgesehen) -- gleiche Selbst-/Admin-Berechtigung wie Name/E-Mail.
      if (parsed.data.department !== undefined) updates.department = parsed.data.department;
      // Security-Audit N10: Kontaktfelder jetzt verschlüsselt wie name/email.
      if (parsed.data.phone !== undefined || parsed.data.mobile !== undefined || parsed.data.job_title !== undefined || parsed.data.office_location !== undefined) {
        const contactDeks = await loadContactDeks(app, deps.keyProvider);
        if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone ? encryptContactField(parsed.data.phone, contactDeks.phone, deps, id, 'phone') : null;
        if (parsed.data.mobile !== undefined) updates.mobile = parsed.data.mobile ? encryptContactField(parsed.data.mobile, contactDeks.mobile, deps, id, 'mobile') : null;
        if (parsed.data.job_title !== undefined) updates.job_title = parsed.data.job_title ? encryptContactField(parsed.data.job_title, contactDeks.jobTitle, deps, id, 'job_title') : null;
        if (parsed.data.office_location !== undefined) updates.office_location = parsed.data.office_location ? encryptContactField(parsed.data.office_location, contactDeks.officeLocation, deps, id, 'office_location') : null;
      }
      if (parsed.data.notif_prefs !== undefined) updates.notif_prefs_json = JSON.stringify(parsed.data.notif_prefs);

      // Nur Admin darf Rolle, Gruppe, Vorgesetzte Person, Archivierung und Sperrung ändern
      if (canManageUsers) {
        const target = await app.db.selectFrom('users').select(['role', 'account_valid_until']).where('id', '=', id).executeTakeFirst();
        if (!target) return reply.code(404).send({ error: 'not_found' });
        // Security-Audit M-3: ein Admin mit nur "Benutzerverwaltung" darf kein fremdes
        // Admin-Konto (Rolle, Gruppe, Vorgesetzte, Sperre, Archivierung) verändern -- nur
        // Superadmin darf das. Die eigene Person bleibt ausgenommen (sonst könnte sich ein Admin
        // nicht einmal die eigene Abteilung/Gruppe setzen); Rolle self === 'superadmin' ist
        // durch updateUserSchema (nur 'user'|'admin' erlaubt) bereits ausgeschlossen (B1).
        if (target && id !== session.uid && (target.role === 'admin' || target.role === 'superadmin') && session.role !== 'superadmin') {
          return reply.code(403).send({ error: 'forbidden' });
        }
        // Security-Audit M-6: letzten aktiven Superadmin vor Herabstufung, Sperre und
        // Archivierung schützen (unabhängig davon, ob die Person sich selbst betrifft oder ein
        // anderer Superadmin die Änderung vornimmt).
        if (target?.role === 'superadmin') {
          // updateUserSchema erlaubt für "role" ohnehin nur 'user'|'admin' (nie 'superadmin',
          // siehe B1) -- jede gesetzte Rolle hier ist für ein Superadmin-Ziel also eine Herabstufung.
          const demotes = parsed.data.role !== undefined;
          const archives = parsed.data.account_archived === true;
          const locks = parsed.data.locked_permanent === true;
          const expires = parsed.data.account_valid_until != null;
          if (demotes || archives || locks || expires) await assertNotLastSuperadmin(id);
        }
        if (parsed.data.role !== undefined) updates.role = parsed.data.role;
        if (parsed.data.department_group_id !== undefined) updates.department_group_id = parsed.data.department_group_id;
        if (parsed.data.supervisor_user_id !== undefined) updates.supervisor_user_id = parsed.data.supervisor_user_id;
        if (parsed.data.account_archived !== undefined) updates.account_archived = parsed.data.account_archived;
        if (parsed.data.locked_permanent !== undefined) updates.locked_permanent = parsed.data.locked_permanent;
        if (parsed.data.account_valid_until !== undefined) {
          updates.account_valid_until = parsed.data.account_valid_until;
          if (isAccountExpired(target.account_valid_until) || isAccountExpired(parsed.data.account_valid_until)) {
            await app.db.updateTable('sessions').set({ revoked_at: mysqlTimestamp() }).where('user_id', '=', id).execute();
          }
        }
        // Security-Audit R-21: persoenliche Outlook-Kalender-Tokens (Calendars.ReadWrite) beim
        // Beenden des Kontos loeschen -- sonst bliebe ein gueltiger, verschluesselter Zugriff auf
        // den Kalender einer archivierten/gesperrten/ausgeschiedenen Person bestehen. Lokales
        // Loeschen allein widerruft die Freigabe nicht bei Microsoft, entfernt aber den eigenen
        // Zugriffsweg.
        const endsAccount = parsed.data.account_archived === true || parsed.data.locked_permanent === true ||
          (parsed.data.account_valid_until !== undefined && isAccountExpired(parsed.data.account_valid_until));
        if (endsAccount) {
          updates.outlook_refresh_token_enc = null;
          updates.outlook_account_email = null;
          updates.outlook_connected_at = null;
        }
        // Zusatzrechte für andere Admin-Konten zu vergeben ist selbst ein privilegierter Vorgang
        // -- nur Superadmin darf das (gleiche Einschränkung wie im Editor, "ue-man-box" war dort
        // immer nur für isSuper sichtbar).
        if (parsed.data.permissions !== undefined && session.role === 'superadmin') {
          updates.permissions_json = JSON.stringify(parsed.data.permissions);
        }
        // Security-Audit N7: LDAP-Login-Freischaltung ist ebenfalls ein privilegierter Vorgang
        // (erweitert die Angriffsfläche des Kontos um ein externes Verzeichnis) -- nur Superadmin.
        if (parsed.data.ldap_login_enabled !== undefined && session.role === 'superadmin') {
          updates.ldap_login_enabled = parsed.data.ldap_login_enabled;
        }
      }

      await app.db.updateTable('users').set(updates).where('id', '=', id).execute();

      if (previousEmail) {
        await app.db.insertInto('global_audit_log').values({
          id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
          action: 'user.email_changed', target_type: 'user', target_id: id, detail_json: null
        }).execute();
        // An die BISHERIGE Adresse: eine uebernommene Sitzung soll die Adresse nicht unbemerkt umleiten koennen.
        await queueMailIfConfigured({ db: app.db, env: deps.env, keyProvider: deps.keyProvider }, previousEmail,
          'E-Mail-Adresse geaendert',
          'Die E-Mail-Adresse deines Kontos wurde geaendert. Warst du das nicht, melde dich sofort beim Support.')
          .catch(err => app.log.error({ err }, 'Hinweis-Mail (email_changed) nicht eingereiht'));
      }

      if (canManageUsers && (parsed.data.role !== undefined || parsed.data.account_archived !== undefined || parsed.data.locked_permanent !== undefined || parsed.data.account_valid_until !== undefined)) {
        await app.db.insertInto('global_audit_log').values({
          id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
          action: 'user.updated', target_type: 'user', target_id: id,
          detail_json: JSON.stringify({
            role: parsed.data.role, account_archived: parsed.data.account_archived, locked_permanent: parsed.data.locked_permanent,
            account_valid_until: parsed.data.account_valid_until
          })
        }).execute();
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/users/:id (nur Admin) - Tickets der Person werden je nach Wunsch archiviert
  // oder gelöscht; die Person selbst kann sich nicht selbst löschen.
  app.delete('/api/v2/users/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      if (id === session.uid) return reply.code(400).send({ error: 'cannot_delete_self' });

      const target = await app.db.selectFrom('users').select(['username', 'role']).where('id', '=', id).executeTakeFirst();
      if (!target) return reply.code(404).send({ error: 'not_found' });
      // Security-Audit M-3: auch das Löschen eines fremden Admin-Kontos ist nur Superadmins
      // vorbehalten, nicht nur bei Superadmin-Zielen.
      if ((target.role === 'admin' || target.role === 'superadmin') && session.role !== 'superadmin') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (target.role === 'superadmin') await assertNotLastSuperadmin(id);

      const parsed = deleteUserQuerySchema.safeParse(req.query);
      const ticketDisposition = parsed.success ? parsed.data.tickets : 'archive';
      if (ticketDisposition === 'delete') {
        const activeTimer = await app.db.selectFrom('ticket_work_timers').innerJoin('tickets', 'tickets.id', 'ticket_work_timers.ticket_id')
          .select('ticket_work_timers.id').where('tickets.created_by_user_id', '=', id).executeTakeFirst();
        if (activeTimer) return reply.code(409).send({ error: 'finish_ticket_work_timers_before_deleting_tickets' });
        await app.db.deleteFrom('tickets').where('created_by_user_id', '=', id).execute();
      } else {
        await app.db.updateTable('tickets').set({ archived_at: mysqlTimestamp() })
          .where('created_by_user_id', '=', id).where('archived_at', 'is', null).execute();
      }

      await app.db.deleteFrom('users').where('id', '=', id).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'user.deleted', target_type: 'user', target_id: id,
        detail_json: JSON.stringify({ username: target.username, tickets: ticketDisposition })
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/users/:id/mfa-reset - Admin setzt 2FA eines anderen Kontos zurück
  // (z.B. verlorenes Gerät). Erfordert KEIN Passwort des Zielkontos -- das ist eine bewusste
  // administrative Rechte-Eskalation, deshalb nur Admin/Superadmin und im Audit-Log vermerkt.
  app.post('/api/v2/users/:id/mfa-reset', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManage2FA'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const target = await app.db.selectFrom('users').select('role').where('id', '=', id).executeTakeFirst();
      // Security-Audit M-3: nicht nur Superadmin-Ziele schützen, sondern jedes Admin-Konto --
      // sonst kann ein Admin, der nur "Benutzerverwaltung" hat, die 2FA eines anderen
      // Admin-Kontos mit ganz anderen Einzelrechten (z.B. canViewLogs/canManage2FA) zurücksetzen
      // und übernehmen. Nur Superadmin darf ein fremdes Admin-Konto zurücksetzen.
      if (target && (target.role === 'admin' || target.role === 'superadmin') && session.role !== 'superadmin') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await app.db.transaction().execute(async trx => {
        await trx.updateTable('users').set({ totp_enabled: false, totp_secret_enc: null, totp_pending_secret_enc: null, totp_last_step: null }).where('id', '=', id).execute();
        await trx.deleteFrom('user_passkeys').where('user_id', '=', id).execute();
        await trx.deleteFrom('mfa_recovery_codes').where('user_id', '=', id).execute();
        await trx.deleteFrom('mfa_devices').where('user_id', '=', id).execute();
        await trx.deleteFrom('mfa_flows').where('user_id', '=', id).execute();
        await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', id).execute();
      });
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'user.mfa_reset', target_type: 'user', target_id: id, detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/users/:id/change-password
  // Security-Audit R-12: eigenes Rate-Limit pro Session/IP (zusaetzlich zur Pro-Quellnetz-Sperre
  // unten) -- bisher griff dafuer nur das globale 1000/min-Limit.
  app.post('/api/v2/users/:id/change-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req: any) => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      const canManageUsers = isAdmin ? await hasAdminPermission(session, 'canManageUsers') : false;
      if (!canManageUsers && session.uid !== id) return reply.code(403).send({ error: 'forbidden' });
      if (canManageUsers && session.uid !== id) {
        const target = await app.db.selectFrom('users').select('role').where('id', '=', id).executeTakeFirst();
        // Security-Audit M-3: wie beim mfa-reset auch hier jedes Admin-Konto schützen, nicht nur
        // Superadmin-Ziele -- sonst setzt ein Admin mit nur "Benutzerverwaltung" das Passwort
        // jedes anderen, höher berechtigten Admin-Kontos zurück und übernimmt es.
        if (target && (target.role === 'admin' || target.role === 'superadmin') && session.role !== 'superadmin') {
          return reply.code(403).send({ error: 'forbidden' });
        }
      }

      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      // Bei jeder eigenen Passwortaenderung muss das alte Passwort erneut bestaetigt werden.
      // Nur ein berechtigter Admin-Reset fuer ein anderes Konto darf ohne Altpasswort laufen.
      if (!isAdmin || session.uid === id) {
        const user = await app.db.selectFrom('users').select('password_hash').where('id', '=', id).executeTakeFirst();
        if (!user) return reply.code(404).send({ error: 'not_found' });
        if (!parsed.data.old_password) return reply.code(400).send({ error: 'old_password_required' });
        // Security-Audit R-12: gleiche Pro-Quellnetz-Sperre wie beim Login (R-11) -- bisher
        // konnte das alte Passwort hier ohne jede Fehlversuchsgrenze geraten werden.
        if (await isSourceLocked(app.db, session.uid, req.ip)) return reply.code(401).send({ error: 'too_many_attempts' });
        const ok = await argon2.verify(user.password_hash, parsed.data.old_password);
        if (!ok) {
          const policy = await loadSecurityPolicy(app.db);
          await recordSourceFailure(app.db, session.uid, req.ip, policy);
          return reply.code(401).send({ error: 'wrong_password' });
        }
        await clearSourceFailures(app.db, session.uid);
      }

      const failures = passwordFailures(parsed.data.new_password, await loadPasswordPolicy(app.db));
      if (failures.length) return reply.code(400).send({ error: 'password_policy_failed', requirements: failures });
      const password_hash = await argon2.hash(parsed.data.new_password, { type: argon2.argon2id });
      await app.db.updateTable('users').set({ password_hash, updated_at: mysqlTimestamp() }).where('id', '=', id).execute();

      // Alle Sessions des Users invalidieren (Sicherheit)
      await app.db.updateTable('sessions').set({ revoked_at: mysqlTimestamp() }).where('user_id', '=', id).execute();
      await app.db.deleteFrom('mfa_devices').where('user_id', '=', id).execute();
      await app.db.deleteFrom('mfa_flows').where('user_id', '=', id).execute();

      // Unzureichendes Security Logging: eine Passwortänderung ist sicherheitsrelevant,
      // unabhängig davon ob sie selbst oder durch einen Admin ausgelöst wurde -- bisher blieb
      // sie im Audit-Log komplett unsichtbar. Es wird nie das Passwort selbst protokolliert.
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: session.uid === id ? 'user.password_changed_self' : 'user.password_changed_by_admin',
        target_type: 'user', target_id: id, detail_json: null
      }).execute();

      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Gruppen ---

  // GET /api/v2/groups
  app.get('/api/v2/groups', async (req, reply) => {
    try {
      requireSession(req);
      const groups = await app.db.selectFrom('groups').selectAll().orderBy('name', 'asc').execute();
      return reply.send({ groups });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/groups (nur Admin)
  app.post('/api/v2/groups', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createGroupSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const id = randomUUID();
      await app.db.insertInto('groups').values({ id, name: parsed.data.name, is_default: parsed.data.is_default }).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'group.created', target_type: 'group', target_id: id, detail_json: JSON.stringify({ name: parsed.data.name })
      }).execute();
      return reply.code(201).send({ id, name: parsed.data.name });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // PATCH /api/v2/groups/:id (nur Admin) - bisher nur Umbenennen/Default-Flag
  app.patch('/api/v2/groups/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = updateGroupSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const updates: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.is_default !== undefined) updates.is_default = parsed.data.is_default;
      if (Object.keys(updates).length) {
        await app.db.updateTable('groups').set(updates).where('id', '=', id).execute();
        await app.db.insertInto('global_audit_log').values({
          id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
          action: 'group.updated', target_type: 'group', target_id: id, detail_json: JSON.stringify(updates)
        }).execute();
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // DELETE /api/v2/groups/:id (nur Admin)
  app.delete('/api/v2/groups/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('groups').where('id', '=', id).execute();
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'group.deleted', target_type: 'group', target_id: id, detail_json: null
      }).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- Abwesenheit & Vertretung (nur Admin/Superadmin, wie im Altsystem) ---

  // Gemeinsame Logik für Self-Service- (/users/me/absence) und Admin-Endpunkt
  // (/users/:id/absence) -- vorher nur als Self-Service vorhanden; AdminBoard.setAbsence im
  // Frontend (aufgerufen aus der Benutzerverwaltung heraus, um ANDERE Personen abwesend zu
  // melden) rief diesen Endpunkt nie auf, sondern mutierte nur ein lokales JS-Objekt und
  // "speicherte" es über Store.saveUsers, das das absence-Feld gar nicht kennt -- Abwesenheiten
  // für andere Personen wurden dadurch nie tatsächlich in der Datenbank gespeichert.
  async function applyUserAbsence(targetUserId: string, actor: { uid: string; username: string }, data: z.infer<typeof setAbsenceSchema>) {
    if (data.active && data.substitute_user_id) {
      const substitute = await app.db.selectFrom('users').select(['id', 'account_archived']).where('id', '=', data.substitute_user_id).executeTakeFirst();
      if (!substitute || substitute.account_archived || substitute.id === targetUserId) throw { statusCode: 400, message: 'invalid_substitute' };
    }
    // Laufende Abwesenheit derselben Person beenden, bevor eine neue beginnt -- nie zwei
    // gleichzeitig aktive Zeilen für dieselbe Person.
    await app.db.updateTable('user_absences')
      .set({ active: false, ended_at: mysqlTimestamp() })
      .where('user_id', '=', targetUserId)
      .where('active', '=', true)
      .execute();

    if (!data.active) {
      return { success: true, active: false };
    }

    const id = randomUUID();
    await app.db.insertInto('user_absences').values({
      id,
      user_id: targetUserId,
      active: true,
      from_at: data.from_at ? mysqlTimestamp(new Date(data.from_at)) : null,
      until_at: data.until_at ? mysqlTimestamp(new Date(data.until_at)) : null,
      substitute_user_id: data.substitute_user_id ?? null,
      visible: data.visible
    }).execute();

    // Sofortige Wirkung (docs/SPEC.md §7.1): offene, zugewiesene Tickets gehen sofort an die
    // Vertretung über, nicht erst beim nächsten Login irgendeiner Person.
    if (data.substitute_user_id) {
      const reassigned = await app.db.selectFrom('tickets')
        .select('id')
        .where('assigned_to_user_id', '=', targetUserId)
        .where('archived_at', 'is', null)
        .execute();
      if (reassigned.length > 0) {
        const substitute = await app.db.selectFrom('users').select('username').where('id', '=', data.substitute_user_id).executeTakeFirst();
        await app.db.updateTable('tickets')
          .set({ assigned_to_user_id: data.substitute_user_id, assigned_to_username: substitute?.username ?? null, updated_at: mysqlTimestamp() })
          .where('assigned_to_user_id', '=', targetUserId)
          .where('archived_at', 'is', null)
          .execute();
        for (const ticket of reassigned) {
          await app.db.insertInto('ticket_audit_log').values({
            id: randomUUID(), ticket_id: ticket.id, actor_user_id: actor.uid, actor_username: actor.username,
            action: 'reassigned_absence', field: 'assigned_to_user_id', old_value: targetUserId, new_value: data.substitute_user_id
          }).execute();
        }
      }
    }

    return { success: true, active: true, id };
  }

  app.post('/api/v2/users/me/absence', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = setAbsenceSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      return reply.send(await applyUserAbsence(session.uid, session, parsed.data));
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/users/:id/absence - Admin meldet eine ANDERE Person abwesend (z.B. aus der
  // Benutzerverwaltung heraus) -- siehe Kommentar bei applyUserAbsence oben.
  app.post('/api/v2/users/:id/absence', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const { id } = req.params as { id: string };
      const parsed = setAbsenceSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const target = await app.db.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst();
      if (!target) return reply.code(404).send({ error: 'not_found' });
      return reply.send(await applyUserAbsence(id, session, parsed.data));
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/users/:id/absence/transferred-tickets - welche (noch nicht archivierten)
  // Tickets sind wegen einer Abwesenheit dieser Person an eine Vertretung übergegangen und
  // liegen jetzt noch bei jemand anderem? Aus dem Audit-Log abgeleitet (ticket_audit_log-Eintrag
  // "reassigned_absence"), statt wie im Altsystem in einer eigenen Liste auf dem Benutzerobjekt
  // nachgehalten -- die gibt es im normalisierten Schema nicht mehr.
  app.get('/api/v2/users/:id/absence/transferred-tickets', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      if (session.uid !== id && session.role !== 'admin' && session.role !== 'superadmin') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const rows = await app.db.selectFrom('ticket_audit_log')
        .innerJoin('tickets', 'tickets.id', 'ticket_audit_log.ticket_id')
        .select(['tickets.id as ticket_id'])
        .where('ticket_audit_log.action', '=', 'reassigned_absence')
        .where('ticket_audit_log.old_value', '=', id)
        .where('tickets.archived_at', 'is', null)
        .where('tickets.assigned_to_user_id', '!=', id)
        .distinct()
        .execute();
      return reply.send({ ticketIds: rows.map(r => r.ticket_id) });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/absences/overview - sichtbare, aktive Abwesenheiten (für alle angemeldeten
  // Personen, wie die Übersicht im Altsystem -- nur was "visible" markiert ist)
  app.get('/api/v2/absences/overview', async (req, reply) => {
    try {
      requireSession(req);
      const rows = await app.db.selectFrom('user_absences')
        .innerJoin('users', 'users.id', 'user_absences.user_id')
        .select([
          'user_absences.id', 'user_absences.user_id', 'users.username',
          'user_absences.from_at', 'user_absences.until_at', 'user_absences.substitute_user_id'
        ])
        .where('user_absences.active', '=', true)
        .where('user_absences.visible', '=', true)
        .execute();
      return reply.send({ absences: rows });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // --- CSV-Import/-Export (nur Admin) ---

  // GET /api/v2/users/export.csv - nur Admin
  app.get('/api/v2/users/export.csv', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('users')
        .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'department', 'phone', 'mobile', 'job_title', 'office_location', 'account_archived', 'locked_permanent', 'totp_enabled', 'created_at'])
        .orderBy('username', 'asc')
        .execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const contactDeks = await loadContactDeks(app, deps.keyProvider);
      const header = ['username', 'name', 'email', 'role', 'department', 'phone', 'mobile', 'job_title', 'office_location', 'account_archived', 'locked_permanent', 'totp_enabled', 'created_at'];
      const lines = [header.map(csvSafeCell).join(',')];
      for (const row of rows) {
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users', recordId: row.id, fieldName, keyVersion
        });
        const name = fieldCipher.decryptField(row.name_enc, nameDek.rawDek, ctx('name', nameDek.keyVersion));
        const email = fieldCipher.decryptField(row.email_enc, emailDek.rawDek, ctx('email', emailDek.keyVersion));
        const contact = decryptContactFields(row, contactDeks, deps);
        lines.push([
          row.username, name, email, row.role,
          row.department ?? '', contact.phone ?? '', contact.mobile ?? '', contact.job_title ?? '', contact.office_location ?? '',
          String(row.account_archived), String(row.locked_permanent), String(row.totp_enabled),
          new Date(row.created_at).toISOString()
        ].map(csvSafeCell).join(','));
      }
      // KEIN Passwort-Hash im Export -- Klartext-Passwörter gab es ohnehin nie serverseitig.
      return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="users-export.csv"').send(lines.join('\r\n'));
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  const importRowSchema = z.object({
    username: z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N}_.-]+$/u),
    name: z.string().trim().min(1).max(255),
    email: z.string().email().max(255),
    role: z.enum(['user', 'admin']).default('user'),
    // Optionale Spalten, leer bleibt leer -- fuer einen AD-Export, der diese Spalten nicht hat,
    // aendert sich am bisherigen Import-Verhalten dadurch nichts.
    department: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(64).optional(),
    mobile: z.string().trim().max(64).optional(),
    job_title: z.string().trim().max(255).optional(),
    office_location: z.string().trim().max(255).optional()
  });

  // POST /api/v2/users/import.csv - nur Admin. Erwartet Spalten username,name,email,role.
  // Neue Benutzer bekommen ein zufälliges Einmal-Passwort (muss separat mitgeteilt/geändert
  // werden) -- es gibt keinen Import von Klartext-Passwörtern.
  // bodyLimit höher als der globale 2MB-Standard (N2 im Security-Audit): csv-Feld selbst ist
  // bis 5MB zulässig (siehe z.string().max unten).
  app.post('/api/v2/users/import.csv', { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasAdminPermission(session, 'canManageUsers'))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const rawLines = parsed.data.csv.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (rawLines.length < 2) return reply.code(400).send({ error: 'empty_csv' });
      const header = parseCsvLine(rawLines[0]!).map(h => h.trim().toLowerCase());
      const results: Array<{ username: string; status: string; temporaryPassword?: string }> = [];

      for (const line of rawLines.slice(1)) {
        const cells = parseCsvLine(line);
        const record = Object.create(null) as Record<string, string>;
        header.forEach((key, idx) => { record[key] = cells[idx] ?? ''; });

        const rowParsed = importRowSchema.safeParse(record);
        if (!rowParsed.success) {
          results.push({ username: record.username || '?', status: 'invalid' });
          continue;
        }
        const existing = await app.db.selectFrom('users').select('id').where('username', '=', rowParsed.data.username).executeTakeFirst();
        if (existing) {
          results.push({ username: rowParsed.data.username, status: 'skipped_exists' });
          continue;
        }

        const newId = randomUUID();
        const tempPassword = generatePolicyPassword(await loadPasswordPolicy(app.db));
        const password_hash = await argon2.hash(tempPassword, { type: argon2.argon2id });
        const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
        const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
        const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
        const emailBlindIdx = computeBlindIndex(blindIndexDek.rawDek, rowParsed.data.email.trim().toLowerCase());
        if (await app.db.selectFrom('users').select('id').where('email_blind_idx', '=', emailBlindIdx).executeTakeFirst()) {
          results.push({ username: rowParsed.data.username, status: 'skipped_email_exists' });
          continue;
        }
        const contactDeks = await loadContactDeks(app, deps.keyProvider);
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users', recordId: newId, fieldName, keyVersion
        });
        await app.db.insertInto('users').values({
          id: newId,
          username: rowParsed.data.username,
          name_enc: fieldCipher.encryptField(rowParsed.data.name, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
          email_enc: fieldCipher.encryptField(rowParsed.data.email, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
          email_blind_idx: emailBlindIdx,
          password_hash,
          role: rowParsed.data.role,
          department_group_id: null,
          department: rowParsed.data.department || null,
          phone: rowParsed.data.phone ? encryptContactField(rowParsed.data.phone, contactDeks.phone, deps, newId, 'phone') : null,
          mobile: rowParsed.data.mobile ? encryptContactField(rowParsed.data.mobile, contactDeks.mobile, deps, newId, 'mobile') : null,
          job_title: rowParsed.data.job_title ? encryptContactField(rowParsed.data.job_title, contactDeks.jobTitle, deps, newId, 'job_title') : null,
          office_location: rowParsed.data.office_location ? encryptContactField(rowParsed.data.office_location, contactDeks.officeLocation, deps, newId, 'office_location') : null,
          account_archived: false,
          locked_permanent: false,
          totp_enabled: false,
          ldap_login_enabled: false,
          installation_id: deps.env.INSTALLATION_ID
        }).execute();
        results.push({ username: rowParsed.data.username, status: 'created', temporaryPassword: tempPassword });
      }
      await app.db.insertInto('global_audit_log').values({
        id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
        action: 'user.csv_import', target_type: 'user', target_id: null,
        detail_json: JSON.stringify({ created: results.filter(r => r.status === 'created').length, total: results.length })
      }).execute();
      return reply.send({ results });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
