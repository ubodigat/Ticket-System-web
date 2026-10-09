/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Optionaler LDAP-Login als ERGÄNZUNG zum lokalen Passwort, kein Ersatz: das Konto muss bereits
// lokal existieren (gleicher Benutzername) -- Rolle/Rechte kommen weiterhin ausschließlich aus
// der eigenen Datenbank, nicht aus LDAP-Gruppen. Das vermeidet automatische Rechte-Vergabe durch
// einen externen, hier nicht weiter geprüften Verzeichnisdienst.
//
// Ablauf: 1) Bind mit Service-Account (ldap_bind_dn/-password), 2) Suche nach der Person per
// ldap_user_filter (Platzhalter {username}, serverseitig escaped), 3) Bind als deren DN mit dem
// vom Login-Formular übergebenen Passwort. Nur wenn alle drei Schritte gelingen, gilt der Login
// als erfolgreich. Jeder Fehler (Netzwerk, falsche Zugangsdaten, kein Treffer, ...) führt zu
// "false" -- nie zu einer Exception, die den Login-Endpunkt zum Absturz bringen könnte.
import { Client } from 'ldapts';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';

export interface LdapDeps {
  db: Kysely<Database>;
  env: Env;
  keyProvider: KeyProvider;
}

interface LdapConfig {
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
}

// Escaped nach RFC 4515, damit der eingegebene Benutzername keine LDAP-Filter-Injection erlaubt
// (z.B. "*)(uid=*" als Benutzername).
function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\x00]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

async function loadLdapConfig(deps: LdapDeps): Promise<LdapConfig | null> {
  const row = await deps.db.selectFrom('app_settings')
    .select(['ldap_enabled', 'ldap_url', 'ldap_bind_dn', 'ldap_bind_password_enc', 'ldap_base_dn', 'ldap_user_filter'])
    .where('id', '=', 1).executeTakeFirst();
  if (!row?.ldap_enabled || !row.ldap_url || !row.ldap_bind_dn || !row.ldap_bind_password_enc || !row.ldap_base_dn) return null;

  const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.ldap_bind_password');
  const bindPassword = fieldCipher.decryptField(row.ldap_bind_password_enc, dek.rawDek, {
    installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
    tableName: 'app_settings', recordId: '1', fieldName: 'ldap_bind_password', keyVersion: dek.keyVersion
  });
  return {
    url: row.ldap_url,
    bindDn: row.ldap_bind_dn,
    bindPassword,
    baseDn: row.ldap_base_dn,
    userFilter: row.ldap_user_filter || '(uid={username})'
  };
}

export async function isLdapEnabled(deps: LdapDeps): Promise<boolean> {
  return (await loadLdapConfig(deps)) !== null;
}

export async function authenticateLdap(deps: LdapDeps, username: string, password: string): Promise<boolean> {
  if (!password) return false;
  const config = await loadLdapConfig(deps);
  if (!config) return false;

  const client = new Client({ url: config.url, connectTimeout: 5000 });
  try {
    await client.bind(config.bindDn, config.bindPassword);

    const filter = config.userFilter.replace('{username}', escapeLdapFilterValue(username));
    const { searchEntries } = await client.search(config.baseDn, { scope: 'sub', filter, sizeLimit: 1 });
    const entry = searchEntries[0];
    if (!entry) return false;
    const userDn = String(entry.dn);

    // Neuer Client für den Bind als die Zielperson -- ein fehlgeschlagener Bind darf die
    // Service-Account-Verbindung nicht in einen unklaren Zustand bringen.
    const userClient = new Client({ url: config.url, connectTimeout: 5000 });
    try {
      await userClient.bind(userDn, password);
      return true;
    } catch {
      return false;
    } finally {
      await userClient.unbind().catch(() => {});
    }
  } catch {
    return false;
  } finally {
    await client.unbind().catch(() => {});
  }
}
