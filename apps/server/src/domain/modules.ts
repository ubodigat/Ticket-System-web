import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

// Optionale Funktionsbereiche (Systemeinstellungen > Module). Ein deaktiviertes Modul ist fuer die
// Oberflaeche nicht vorhanden: seine Felder fehlen in den Antworten, seine Endpunkte lehnen ab.
// Fehlt ein Eintrag, gilt das Modul als aktiv -- bestehende Installationen verhalten sich wie bisher.
export const MODULE_KEYS = ['sla', 'approvals', 'outlook'] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
export type ModuleState = Record<ModuleKey, boolean>;

// Outlook ist nur mit eingerichteter Microsoft-Anbindung sinnvoll: ohne ausdrueckliche Auswahl
// gilt das Modul deshalb nur als aktiv, wenn die Integration bereits eingeschaltet ist.
export function modulesFromConfig(config: Record<string, any> | null | undefined): ModuleState {
  const stored = config?.modules ?? {};
  return {
    sla: stored.sla !== false,
    approvals: stored.approvals !== false,
    outlook: typeof stored.outlook === 'boolean' ? stored.outlook : config?.outlookConfig?.enabled === true
  };
}

// Wirft 403 module_disabled, wenn das Modul ausgeschaltet ist (fuer Routen eines Moduls).
export async function requireModule(db: Kysely<Database>, key: ModuleKey): Promise<void> {
  if (!(await loadModules(db))[key]) throw { statusCode: 403, message: 'module_disabled' };
}

export async function loadModules(db: Kysely<Database>): Promise<ModuleState> {
  const row = await db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  let config: Record<string, any> = {};
  try { config = row?.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  return modulesFromConfig(config);
}

// Entfernt Felder deaktivierter Module aus einer Ticket-Antwort.
export function maskTicketModules<T extends Record<string, any>>(ticket: T, modules: ModuleState): T {
  const masked: Record<string, any> = { ...ticket };
  if (!modules.sla) { masked.sla_due_at = null; masked.custom_due_at = null; }
  if (!modules.approvals) {
    masked.approval_status = null; masked.approval_requested_by = null; masked.approval_reviewer_id = null; masked.approval_text = null;
  }
  return masked as T;
}
