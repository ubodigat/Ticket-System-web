/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Echter SMTP-Versand (nodemailer) fuer Benachrichtigungen. Konfiguration liegt in
// app_settings (siehe Migration 0018); das Passwort ist AES-256-GCM-verschluesselt wie jedes
// andere Secret und wird nie ueber die API zurueckgegeben (siehe settings.ts).
import type { Kysely } from 'kysely';
import nodemailer from 'nodemailer';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';

export interface MailDeps {
  db: Kysely<Database>;
  env: Env;
  keyProvider: KeyProvider;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  fromName: string | null;
}

async function loadSmtpConfig(deps: MailDeps): Promise<{ config: SmtpConfig; password: string | null } | null> {
  const row = await deps.db.selectFrom('app_settings')
    .select(['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password_enc', 'smtp_from', 'smtp_from_name'])
    .where('id', '=', 1).executeTakeFirst();
  if (!row?.smtp_host || !row.smtp_port || !row.smtp_from) return null;

  let password: string | null = null;
  if (row.smtp_password_enc) {
    const dek = await ensureDek(deps.db, deps.keyProvider, 'app_settings.smtp_password');
    password = fieldCipher.decryptField(row.smtp_password_enc, dek.rawDek, {
      installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'app_settings', recordId: '1', fieldName: 'smtp_password', keyVersion: dek.keyVersion
    });
  }
  return {
    config: {
      host: row.smtp_host, port: row.smtp_port, secure: !!row.smtp_secure,
      user: row.smtp_user, from: row.smtp_from, fromName: row.smtp_from_name
    },
    password
  };
}

export async function isSmtpConfigured(deps: MailDeps): Promise<boolean> {
  return (await loadSmtpConfig(deps)) !== null;
}

// Best-effort: wird aus createNotification() aufgerufen, darf eine Benachrichtigung niemals
// blockieren, wenn SMTP nicht konfiguriert ist oder der Versand fehlschlaegt (Netzwerk, falsche
// Zugangsdaten, ...) -- deshalb fängt jeder Aufrufer selbst ab bzw. nutzt sendMailSafe.
export async function sendMail(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  const loaded = await loadSmtpConfig(deps);
  if (!loaded) throw new Error('smtp_not_configured');
  const transport = nodemailer.createTransport({
    host: loaded.config.host,
    port: loaded.config.port,
    secure: loaded.config.secure,
    // Ohne secure (TLS/SMTPS von Anfang an, Port 465) MUSS STARTTLS gelingen -- sonst würde
    // nodemailer sonst klaglos auf eine unverschlüsselte Verbindung zurückfallen, falls der
    // SMTP-Server STARTTLS nicht anbietet. Das widerspricht der Anforderung "E-Mail verschlüsselt".
    requireTLS: !loaded.config.secure,
    auth: loaded.config.user ? { user: loaded.config.user, pass: loaded.password ?? undefined } : undefined
  });
  await transport.sendMail({
    from: loaded.config.fromName ? `${loaded.config.fromName} <${loaded.config.from}>` : loaded.config.from,
    to,
    subject,
    text
  });
}

export async function sendMailSafe(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail(deps, to, subject, text);
  } catch (err) {
    // E-Mail-Zustellung ist best-effort -- die eigentliche In-App-Benachrichtigung bleibt davon
    // unberührt. Fehlerdetails landen im Server-Log, nicht beim Benutzer.
    if (err instanceof Error && err.message !== 'smtp_not_configured') {
      console.error('E-Mail-Versand fehlgeschlagen:', err.message);
    }
  }
}
