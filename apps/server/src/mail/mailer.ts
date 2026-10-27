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
import { buildSignedMimeMessage } from '../domain/smime.js';
import { readMailSecrets } from './secrets.js';

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

interface EmailAdvancedConfig {
  template?: string;
  replyTo?: string | null;
  bccArchive?: string | null;
  signature?: string;
  htmlEnabled?: boolean;
  htmlSignature?: string;
  // Security-Audit N-2: standen bisher ungenutzt in app_settings -- werden jetzt tatsächlich
  // angewendet (siehe sendMail unten).
  transportSecurity?: 'starttls' | 'tls';
  certificateValidation?: 'strict';
  smimeCertificatePem?: string;
  smimePrivateKeyPem?: string;
  smimePassphrase?: string;
  dkimSelector?: string;
  dkimDomain?: string;
  dkimPrivateKeyPem?: string;
}

// Systemeinstellungen > E-Mail > "Vorlage und Signatur" (replyTo/bccArchive/signature/
// htmlSignature) standen bisher nur in app_settings, wurden aber beim tatsaechlichen Versand nie
// gelesen -- die gespeicherte Signatur erschien nie in einer echten Mail. htmlSignature war
// zusaetzlich sinnlos doppelt in companyBrandingConfig vorhanden (jetzt entfernt, siehe
// settings.ts); das hier ist die einzige verbleibende, jetzt auch tatsaechlich genutzte Stelle.
async function loadEmailAdvancedConfig(deps: MailDeps): Promise<EmailAdvancedConfig> {
  const row = await deps.db.selectFrom('app_settings').select(['config_json', 'mail_secrets_enc']).where('id', '=', 1).executeTakeFirst();
  if (!row?.config_json) return {};
  const parsed = JSON.parse(row.config_json);
  return { ...((parsed && typeof parsed === 'object' && parsed.emailAdvancedConfig) || {}),
    ...await readMailSecrets(deps, row.mail_secrets_enc) };
}

// Immediate transport for the queue worker and explicit SMTP connection tests only.
export function renderMailTemplate(template: string, values: { subject: string; message: string; recipient: string }): string {
  return template.replace(/\{\{(subject|message|recipient)\}\}/g, (_match, key: keyof typeof values) => values[key]);
}

export async function sendMail(deps: MailDeps, to: string, subject: string, text: string): Promise<void> {
  const loaded = await loadSmtpConfig(deps);
  if (!loaded) throw new Error('smtp_not_configured');
  const emailConfig = await loadEmailAdvancedConfig(deps);
  if (emailConfig.template?.trim()) text = renderMailTemplate(emailConfig.template, { subject, message: text, recipient: to });

  // Verschluesselung und Zertifikatspruefung sind nicht abschaltbar: ohne requireTLS faellt
  // nodemailer still auf Klartext zurueck, ohne Zertifikatspruefung sind SMTP-Passwort und
  // Mailinhalte per Man-in-the-Middle mitlesbar. Gespeicherte Altwerte ("opportunistic",
  // "allow-self-signed", "disabled") werden ignoriert.
  const requireTLS = !loaded.config.secure;
  const rejectUnauthorized = true;

  const dkim = emailConfig.dkimDomain && emailConfig.dkimSelector && emailConfig.dkimPrivateKeyPem
    ? { domainName: emailConfig.dkimDomain, keySelector: emailConfig.dkimSelector, privateKey: emailConfig.dkimPrivateKeyPem }
    : undefined;

  const transport = nodemailer.createTransport({
    host: loaded.config.host,
    port: loaded.config.port,
    secure: loaded.config.secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    requireTLS,
    tls: { rejectUnauthorized, minVersion: 'TLSv1.2' },
    auth: loaded.config.user ? { user: loaded.config.user, pass: loaded.password ?? undefined } : undefined,
    ...(dkim ? { dkim } : {})
  });
  const textSignature = emailConfig.signature?.trim();
  const finalText = textSignature ? `${text}\n\n${textSignature}` : text;
  // Security-Audit M-2: "text" kann Nutzereingaben enthalten (z.B. Genehmigungsbegründungen,
  // Ticket-Titel in Benachrichtigungen) -- ohne Escaping würde eingeschleustes HTML/Links im
  // HTML-Teil der Mail ausgeführt. Nur die Signatur (von Admins in den Einstellungen gepflegt,
  // bewusst als HTML gedacht) bleibt ungeändert.
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string));
  const html = emailConfig.htmlEnabled
    ? `${escapeHtml(text).replace(/\n/g, '<br>')}${emailConfig.htmlSignature ? `<br><br>${emailConfig.htmlSignature}` : ''}`
    : undefined;
  const fromHeader = loaded.config.fromName ? `${loaded.config.fromName} <${loaded.config.from}>` : loaded.config.from;

  // S/MIME: nodemailer kann selbst keinen PKCS#7-Umschlag bauen -- ist ein Zertifikat+Schlüssel
  // hinterlegt, wird die komplette, bereits signierte MIME-Nachricht extern gebaut (openssl,
  // siehe domain/smime.ts) und unverändert als `raw` übergeben. replyTo/bcc gehen dabei als
  // zusätzliche Envelope-Angaben mit, DKIM (falls konfiguriert) signiert nodemailer trotzdem
  // automatisch über den fertigen Rohtext.
  if (emailConfig.smimeCertificatePem && emailConfig.smimePrivateKeyPem) {
    const raw = await buildSignedMimeMessage({
      certificatePem: emailConfig.smimeCertificatePem,
      privateKeyPem: emailConfig.smimePrivateKeyPem,
      passphrase: emailConfig.smimePassphrase,
      fromAddress: fromHeader,
      toAddress: to,
      subject,
      text: finalText,
      html,
      replyTo: emailConfig.replyTo ?? undefined
    });
    // Security-Audit R-5: nodemailer baut bei "raw" (fertige, bereits signierte MIME-Nachricht)
    // KEINE Header/Umschlag mehr aus `to`/`bcc` -- nur noch `envelope` bestimmt, an wen die
    // Nachricht tatsächlich per SMTP ausgeliefert wird. Ein `bcc`-Feld neben `raw` wird von
    // nodemailer stillschweigend ignoriert; das BCC-Archiv ging dadurch bisher bei jeder
    // S/MIME-signierten Mail verloren, ohne dass das sichtbar gewesen wäre.
    await transport.sendMail({
      envelope: { from: loaded.config.from, to: emailConfig.bccArchive ? [to, emailConfig.bccArchive] : to },
      raw: raw ?? undefined
    });
    return;
  }

  await transport.sendMail({
    from: fromHeader,
    to,
    ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
    ...(emailConfig.bccArchive ? { bcc: emailConfig.bccArchive } : {}),
    subject,
    text: finalText,
    ...(html ? { html } : {})
  });
}
