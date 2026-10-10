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
import { fieldCipher, computeBlindIndex } from '../../crypto/fieldCrypto.js';
import { routeError } from './routeError.js';

export interface UsersRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.\-]+$/, 'Nur Buchstaben, Zahlen, _, ., - erlaubt'),
  password: z.string().min(12).max(512), // Mindestlänge 12 Zeichen erzwingen
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(255),
  role: z.enum(['user', 'admin']),
  department_group_id: z.string().nullable().optional(),
  supervisor_user_id: z.string().nullable().optional()
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(['user', 'admin']).optional(),
  department_group_id: z.string().nullable().optional(),
  // Freitext-Einrichtung/Abteilung (nicht zu verwechseln mit department_group_id, der
  // Gruppenzugehörigkeit) -- die UI-seitige Sichtbarkeit beim Selbst-Bearbeiten regelt
  // accountConfig.editable.department (Systemeinstellungen), nicht diese Schema-Prüfung hier;
  // dasselbe Muster wie bei name/email oben.
  department: z.string().trim().max(255).nullable().optional(),
  supervisor_user_id: z.string().nullable().optional(),
  account_archived: z.boolean().optional(),
  locked_permanent: z.boolean().optional()
});

const changePasswordSchema = z.object({
  old_password: z.string().min(1).optional(), // nicht required bei Admin-Reset
  new_password: z.string().min(12).max(512)
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

const setAbsenceSchema = z.object({
  active: z.boolean(),
  from_at: z.string().datetime().nullable().optional(),
  until_at: z.string().datetime().nullable().optional(),
  substitute_user_id: z.string().nullable().optional(),
  visible: z.boolean().default(false)
});

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
      requireAdmin(req);
      const rows = await app.db.selectFrom('users')
        .select(eb => [
          'id', 'username', 'name_enc', 'email_enc', 'role', 'department_group_id', 'department', 'supervisor_user_id', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'created_at',
          ...absenceSelects(eb)
        ])
        .orderBy('created_at', 'asc')
        .execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const users = rows.map(row => {
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID,
          schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users',
          recordId: row.id,
          fieldName,
          keyVersion
        });
        return {
          ...row,
          name_enc: undefined,
          email_enc: undefined,
          name: fieldCipher.decryptField(row.name_enc, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
          email: fieldCipher.decryptField(row.email_enc, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
          absence: buildAbsence(row as any)
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
          'id', 'username', 'name_enc', 'email_enc', 'role', 'department_group_id', 'department', 'supervisor_user_id', 'account_archived', 'locked_permanent', 'locked_until', 'totp_enabled', 'created_at', 'updated_at',
          ...absenceSelects(eb)
        ])
        .where('id', '=', session.uid)
        .executeTakeFirst();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const ctx = (fieldName: string, keyVersion: number) => ({
        installationId: deps.env.INSTALLATION_ID,
        schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'users',
        recordId: row.id,
        fieldName,
        keyVersion
      });
      const user = {
        ...row,
        name_enc: undefined,
        email_enc: undefined,
        name: fieldCipher.decryptField(row.name_enc, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
        email: fieldCipher.decryptField(row.email_enc, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
        absence: buildAbsence(row as any)
      };
      return reply.send({ user });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // POST /api/v2/users - Benutzer erstellen (nur Admin)
  app.post('/api/v2/users', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

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

      await app.db.insertInto('users').values({
        id: newId,
        username: parsed.data.username,
        name_enc,
        email_enc,
        email_blind_idx,
        password_hash,
        role: parsed.data.role,
        department_group_id: parsed.data.department_group_id ?? null,
        supervisor_user_id: parsed.data.supervisor_user_id ?? null,
        account_archived: false,
        locked_permanent: false,
        totp_enabled: false,
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

      // User kann nur sich selbst ändern (nur Name/Email), Admin kann alles
      if (!isAdmin && session.uid !== id) return reply.code(403).send({ error: 'forbidden' });

      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
      }
      // department ist Klartext (kein personenbezogenes Pflichtfeld wie Name/E-Mail, keine
      // Verschlüsselung dafür vorgesehen) -- gleiche Selbst-/Admin-Berechtigung wie Name/E-Mail.
      if (parsed.data.department !== undefined) updates.department = parsed.data.department;

      // Nur Admin darf Rolle, Gruppe, Vorgesetzte Person, Archivierung und Sperrung ändern
      if (isAdmin) {
        if (parsed.data.role !== undefined) updates.role = parsed.data.role;
        if (parsed.data.department_group_id !== undefined) updates.department_group_id = parsed.data.department_group_id;
        if (parsed.data.supervisor_user_id !== undefined) updates.supervisor_user_id = parsed.data.supervisor_user_id;
        if (parsed.data.account_archived !== undefined) updates.account_archived = parsed.data.account_archived;
        if (parsed.data.locked_permanent !== undefined) updates.locked_permanent = parsed.data.locked_permanent;
      }

      await app.db.updateTable('users').set(updates).where('id', '=', id).execute();

      if (isAdmin && (parsed.data.role !== undefined || parsed.data.account_archived !== undefined || parsed.data.locked_permanent !== undefined)) {
        await app.db.insertInto('global_audit_log').values({
          id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
          action: 'user.updated', target_type: 'user', target_id: id,
          detail_json: JSON.stringify({
            role: parsed.data.role, account_archived: parsed.data.account_archived, locked_permanent: parsed.data.locked_permanent
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
      const { id } = req.params as { id: string };
      if (id === session.uid) return reply.code(400).send({ error: 'cannot_delete_self' });

      const target = await app.db.selectFrom('users').select(['username', 'role']).where('id', '=', id).executeTakeFirst();
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (target.role === 'superadmin' && session.role !== 'superadmin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const parsed = deleteUserQuerySchema.safeParse(req.query);
      const ticketDisposition = parsed.success ? parsed.data.tickets : 'archive';
      if (ticketDisposition === 'delete') {
        await app.db.deleteFrom('tickets').where('created_by_user_id', '=', id).execute();
      } else {
        await app.db.updateTable('tickets').set({ archived_at: new Date().toISOString() })
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
      const { id } = req.params as { id: string };
      await app.db.updateTable('users').set({ totp_enabled: false, totp_secret_enc: null }).where('id', '=', id).execute();
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
  app.post('/api/v2/users/:id/change-password', async (req, reply) => {
    try {
      const session = requireSession(req);
      const { id } = req.params as { id: string };
      const isAdmin = session.role === 'admin' || session.role === 'superadmin';
      if (!isAdmin && session.uid !== id) return reply.code(403).send({ error: 'forbidden' });

      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      // Bei normalem User: altes Passwort prüfen
      if (!isAdmin || session.uid === id) {
        const user = await app.db.selectFrom('users').select('password_hash').where('id', '=', id).executeTakeFirst();
        if (!user) return reply.code(404).send({ error: 'not_found' });
        if (parsed.data.old_password) {
          const ok = await argon2.verify(user.password_hash, parsed.data.old_password);
          if (!ok) return reply.code(401).send({ error: 'wrong_password' });
        }
      }

      const password_hash = await argon2.hash(parsed.data.new_password, { type: argon2.argon2id });
      await app.db.updateTable('users').set({ password_hash, updated_at: new Date().toISOString() }).where('id', '=', id).execute();

      // Alle Sessions des Users invalidieren (Sicherheit)
      await app.db.updateTable('sessions').set({ revoked_at: new Date().toISOString() }).where('user_id', '=', id).execute();

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
    // Laufende Abwesenheit derselben Person beenden, bevor eine neue beginnt -- nie zwei
    // gleichzeitig aktive Zeilen für dieselbe Person.
    await app.db.updateTable('user_absences')
      .set({ active: false, ended_at: new Date().toISOString() })
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
      from_at: data.from_at ?? null,
      until_at: data.until_at ?? null,
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
          .set({ assigned_to_user_id: data.substitute_user_id, assigned_to_username: substitute?.username ?? null, updated_at: new Date().toISOString() })
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
      requireAdmin(req);
      const rows = await app.db.selectFrom('users')
        .select(['id', 'username', 'name_enc', 'email_enc', 'role', 'account_archived', 'locked_permanent', 'totp_enabled', 'created_at'])
        .orderBy('username', 'asc')
        .execute();
      const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
      const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
      const header = ['username', 'name', 'email', 'role', 'account_archived', 'locked_permanent', 'totp_enabled', 'created_at'];
      const lines = [header.map(csvSafeCell).join(',')];
      for (const row of rows) {
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users', recordId: row.id, fieldName, keyVersion
        });
        const name = fieldCipher.decryptField(row.name_enc, nameDek.rawDek, ctx('name', nameDek.keyVersion));
        const email = fieldCipher.decryptField(row.email_enc, emailDek.rawDek, ctx('email', emailDek.keyVersion));
        lines.push([
          row.username, name, email, row.role,
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
    username: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.\-]+$/),
    name: z.string().trim().min(1).max(255),
    email: z.string().email().max(255),
    role: z.enum(['user', 'admin']).default('user')
  });

  // POST /api/v2/users/import.csv - nur Admin. Erwartet Spalten username,name,email,role.
  // Neue Benutzer bekommen ein zufälliges Einmal-Passwort (muss separat mitgeteilt/geändert
  // werden) -- es gibt keinen Import von Klartext-Passwörtern.
  app.post('/api/v2/users/import.csv', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      const parsed = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

      const rawLines = parsed.data.csv.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (rawLines.length < 2) return reply.code(400).send({ error: 'empty_csv' });
      const header = parseCsvLine(rawLines[0]!).map(h => h.trim().toLowerCase());
      const results: Array<{ username: string; status: string }> = [];

      for (const line of rawLines.slice(1)) {
        const cells = parseCsvLine(line);
        const record: Record<string, string> = {};
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
        const tempPassword = randomUUID() + randomUUID();
        const password_hash = await argon2.hash(tempPassword, { type: argon2.argon2id });
        const nameDek = await ensureDek(app.db, deps.keyProvider, 'users.name');
        const emailDek = await ensureDek(app.db, deps.keyProvider, 'users.email');
        const blindIndexDek = await ensureDek(app.db, deps.keyProvider, 'blind-index.users.email');
        const ctx = (fieldName: string, keyVersion: number) => ({
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'users', recordId: newId, fieldName, keyVersion
        });
        await app.db.insertInto('users').values({
          id: newId,
          username: rowParsed.data.username,
          name_enc: fieldCipher.encryptField(rowParsed.data.name, nameDek.rawDek, ctx('name', nameDek.keyVersion)),
          email_enc: fieldCipher.encryptField(rowParsed.data.email, emailDek.rawDek, ctx('email', emailDek.keyVersion)),
          email_blind_idx: computeBlindIndex(blindIndexDek.rawDek, rowParsed.data.email.trim().toLowerCase()),
          password_hash,
          role: rowParsed.data.role,
          department_group_id: null,
          account_archived: false,
          locked_permanent: false,
          totp_enabled: false,
          installation_id: deps.env.INSTALLATION_ID
        }).execute();
        results.push({ username: rowParsed.data.username, status: 'created' });
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
