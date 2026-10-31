/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// V2 Wiederkehrende Tickets - Verwaltung (CRUD) der Regeln. Die tatsächliche Ausführung
// fälliger Regeln (next_run_at <= jetzt) läuft im selben In-Prozess-Timer wie die
// Auto-Archivierung (siehe jobs/maintenance.ts, runRecurringTickets) -- keine echte
// Job-Queue mit Sperren zwischen mehreren Instanzen, siehe Kommentar dort.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from './session.js';
import { routeError } from './routeError.js';
import { mysqlTimestamp } from '../../db/date.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher, decryptFieldTolerant } from '../../crypto/fieldCrypto.js';

export interface RecurringRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

const createRuleSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(50000),
  category: z.string().trim().max(128).optional(),
  priority: z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch']).default('Normal'),
  interval_unit: z.enum(['day', 'week', 'month']),
  interval_count: z.number().int().positive().max(365).default(1),
  next_run_at: z.string().datetime()
});

// Bearbeiten: alle Felder optional (ohne Standardwerte, damit nichts ungewollt ueberschrieben wird).
const updateRuleSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(50000).optional(),
  category: z.string().trim().max(128).nullable().optional(),
  priority: z.enum(['Niedrig', 'Normal', 'Hoch', 'Kritisch']).optional(),
  interval_unit: z.enum(['day', 'week', 'month']).optional(),
  interval_count: z.number().int().positive().max(365).optional(),
  next_run_at: z.string().datetime().optional(),
  active: z.boolean().optional()
}).strict();

export function registerRecurringRoutes(app: FastifyInstance, deps: RecurringRouteDeps): void {
  async function hasRecurringPermission(session: { uid: string; role: string }): Promise<boolean> {
    if (session.role === 'superadmin') return true;
    if (session.role !== 'admin') return false;
    const row = await app.db.selectFrom('users').select('permissions_json').where('id', '=', session.uid).executeTakeFirst();
    let permissions: Record<string, unknown> = {};
    try { permissions = row?.permissions_json ? JSON.parse(row.permissions_json) : {}; } catch { permissions = {}; }
    return permissions.recurring === true;
  }

  // Security-Audit N10-Rest: title/description waren bisher Klartext, obwohl derselbe Inhalt im
  // tatsächlich erzeugten Ticket (jobs/maintenance.ts) verschlüsselt landet. Tolerant statt strikt,
  // weil vorhandene Regeln aus der Zeit vor Migration 0038 nach der Spaltentyp-Umstellung erst
  // durch db/reencryptLegacy.ts nachverschlüsselt werden (Timing wie bei approval_text/
  // waiting_message, siehe R-2).
  async function loadRuleDeks() {
    const [titleDek, descriptionDek] = await Promise.all([
      ensureDek(app.db, deps.keyProvider, 'recurring_ticket_rules.title'),
      ensureDek(app.db, deps.keyProvider, 'recurring_ticket_rules.description')
    ]);
    return { titleDek, descriptionDek };
  }

  function decryptRule<T extends { id: string; title: Buffer; description: Buffer }>(
    row: T,
    deks: { titleDek: Awaited<ReturnType<typeof ensureDek>>; descriptionDek: Awaited<ReturnType<typeof ensureDek>> }
  ) {
    return {
      ...row,
      title: decryptFieldTolerant(row.title, deks.titleDek.rawDek, {
        installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'recurring_ticket_rules', recordId: row.id, fieldName: 'title', keyVersion: deks.titleDek.keyVersion
      }),
      description: decryptFieldTolerant(row.description, deks.descriptionDek.rawDek, {
        installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
        tableName: 'recurring_ticket_rules', recordId: row.id, fieldName: 'description', keyVersion: deks.descriptionDek.keyVersion
      })
    };
  }

  app.get('/api/v2/recurring-rules', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasRecurringPermission(session))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('recurring_ticket_rules').selectAll().orderBy('next_run_at', 'asc').execute();
      const deks = await loadRuleDeks();
      const rules = rows.map(row => decryptRule(row, deks));
      return reply.send({ rules });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.post('/api/v2/recurring-rules', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasRecurringPermission(session))) return reply.code(403).send({ error: 'forbidden' });
      const parsed = createRuleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const id = randomUUID();
      const { titleDek, descriptionDek } = await loadRuleDeks();
      await app.db.insertInto('recurring_ticket_rules').values({
        id,
        title: fieldCipher.encryptField(parsed.data.title, titleDek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'recurring_ticket_rules', recordId: id, fieldName: 'title', keyVersion: titleDek.keyVersion
        }),
        description: fieldCipher.encryptField(parsed.data.description, descriptionDek.rawDek, {
          installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'recurring_ticket_rules', recordId: id, fieldName: 'description', keyVersion: descriptionDek.keyVersion
        }),
        category: parsed.data.category ?? null,
        priority: parsed.data.priority,
        interval_unit: parsed.data.interval_unit,
        interval_count: parsed.data.interval_count,
        next_run_at: mysqlTimestamp(new Date(parsed.data.next_run_at)),
        active: true,
        created_by_user_id: session.uid
      }).execute();
      return reply.code(201).send({ id });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.patch('/api/v2/recurring-rules/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasRecurringPermission(session))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      const parsed = updateRuleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const existing = await app.db.selectFrom('recurring_ticket_rules').select('id').where('id', '=', id).executeTakeFirst();
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      const data = parsed.data;
      const updates: Record<string, unknown> = {};
      if (data.title !== undefined || data.description !== undefined) {
        const { titleDek, descriptionDek } = await loadRuleDeks();
        const ctx = (fieldName: string, keyVersion: number) => ({ installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
          tableName: 'recurring_ticket_rules', recordId: id, fieldName, keyVersion });
        if (data.title !== undefined) updates.title = fieldCipher.encryptField(data.title, titleDek.rawDek, ctx('title', titleDek.keyVersion));
        if (data.description !== undefined) updates.description = fieldCipher.encryptField(data.description, descriptionDek.rawDek, ctx('description', descriptionDek.keyVersion));
      }
      if (data.category !== undefined) updates.category = data.category || null;
      if (data.priority !== undefined) updates.priority = data.priority;
      if (data.interval_unit !== undefined) updates.interval_unit = data.interval_unit;
      if (data.interval_count !== undefined) updates.interval_count = data.interval_count;
      if (data.next_run_at !== undefined) updates.next_run_at = mysqlTimestamp(new Date(data.next_run_at));
      if (data.active !== undefined) updates.active = data.active;
      if (!Object.keys(updates).length) return reply.code(400).send({ error: 'invalid_body' });
      await app.db.updateTable('recurring_ticket_rules').set(updates).where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  app.delete('/api/v2/recurring-rules/:id', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasRecurringPermission(session))) return reply.code(403).send({ error: 'forbidden' });
      const { id } = req.params as { id: string };
      await app.db.deleteFrom('recurring_ticket_rules').where('id', '=', id).execute();
      return reply.send({ success: true });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });

  // GET /api/v2/recurring-rules/due - zeigt nur, was fällig wäre (next_run_at <= jetzt).
  // Erzeugt noch KEINE Tickets -- siehe Datei-Kommentar oben.
  app.get('/api/v2/recurring-rules/due', async (req, reply) => {
    try {
      const session = requireAdmin(req);
      if (!(await hasRecurringPermission(session))) return reply.code(403).send({ error: 'forbidden' });
      const rows = await app.db.selectFrom('recurring_ticket_rules')
        .selectAll()
        .where('active', '=', true)
        .where('next_run_at', '<=', new Date())
        .execute();
      const deks = await loadRuleDeks();
      const due = rows.map(row => decryptRule(row, deks));
      return reply.send({ due });
    } catch (e: any) {
      return routeError(app, reply, e);
    }
  });
}
