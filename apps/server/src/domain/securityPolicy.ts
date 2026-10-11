/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export interface SecurityPolicy {
  force2FA: 'none' | 'all' | 'admin' | 'user';
  // Minuten; 0 bedeutet "kein Timeout" (Sitzung läuft nie durch Zeitablauf ab).
  sessionTimeoutMinutes: number;
  // 0 bedeutet "kein Limit" (kein Brute-Force-Lockout nach Fehlversuchen).
  maxLoginAttempts: number;
  lockoutAction: 'lock' | 'temp' | 'none';
  lockoutMinutes: number;
}

// Sichere Vorgaben, die exakt dem bisherigen, fest einprogrammierten Verhalten entsprechen --
// solange eine frische Installation securityConfig nie explizit gespeichert hat, bleibt das
// Verhalten unveraendert (5 Fehlversuche/15 Minuten Sperre/8h Sitzung). Erst ein bewusst
// gespeicherter Wert (auch 0 fuer "kein Limit"/"kein Timeout", siehe Systemeinstellungen >
// Sicherheit in der lokalen Version vom 07.10.2026) weicht davon ab.
const SAFE_DEFAULTS: SecurityPolicy = {
  force2FA: 'none',
  sessionTimeoutMinutes: 480,
  maxLoginAttempts: 5,
  lockoutAction: 'temp',
  lockoutMinutes: 15
};

export async function loadSecurityPolicy(db: Kysely<Database>): Promise<SecurityPolicy> {
  const row = await db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  const config = row?.config_json ? JSON.parse(row.config_json) : {};
  const sec = config.securityConfig ?? {};
  return {
    force2FA: ['none', 'all', 'admin', 'user'].includes(sec.force2FA) ? sec.force2FA : SAFE_DEFAULTS.force2FA,
    sessionTimeoutMinutes: typeof sec.sessionTimeout === 'number' && sec.sessionTimeout > 0 ? sec.sessionTimeout : SAFE_DEFAULTS.sessionTimeoutMinutes,
    maxLoginAttempts: typeof sec.maxLoginAttempts === 'number' && sec.maxLoginAttempts > 0 ? sec.maxLoginAttempts : SAFE_DEFAULTS.maxLoginAttempts,
    lockoutAction: ['lock', 'temp', 'none'].includes(sec.lockoutAction) ? sec.lockoutAction : SAFE_DEFAULTS.lockoutAction,
    lockoutMinutes: typeof sec.lockoutMinutes === 'number' && sec.lockoutMinutes > 0 ? sec.lockoutMinutes : SAFE_DEFAULTS.lockoutMinutes
  };
}

export function force2faAppliesToRole(policy: SecurityPolicy, role: 'user' | 'admin' | 'superadmin'): boolean {
  if (policy.force2FA === 'all') return true;
  if (policy.force2FA === 'admin') return role === 'admin' || role === 'superadmin';
  if (policy.force2FA === 'user') return role === 'user';
  return false;
}
