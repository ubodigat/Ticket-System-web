/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Security-Audit N-2: S/MIME-Zertifikat/-Schlüssel wurden bisher in den Systemeinstellungen
// entgegengenommen und verschlüsselt gespeichert, aber NIE tatsächlich zum Signieren einer Mail
// verwendet -- die Einstellung hatte keine Wirkung. nodemailer unterstützt kein PKCS#7/S-MIME,
// daher hier über die openssl-CLI (RFC 8551 "multipart/signed" via `openssl smime -sign`) statt
// über ein zusätzliches npm-Paket -- zum Prüfzeitpunkt hatte das einzige verbreitete reine-JS-CMS-
// Paket (node-forge) einen offenen, ungepatchten High-Schwachstellen-Eintrag (GHSA-86w9-cpqp-85rv).
// openssl läuft wie beim Updater (ops/docker/updater-server.mjs) mit shell:false und
// Array-Argumenten -- kein Shell-Injection-Risiko, auch wenn Betreff/Text spaeter einmal
// Sonderzeichen enthalten.
export interface SmimeSignParams {
  certificatePem: string;
  privateKeyPem: string;
  passphrase?: string | undefined;
  fromAddress: string;
  toAddress: string;
  subject: string;
  text: string;
  html?: string | undefined;
}

function runOpenssl(args: string[], extraStdio: { fd3?: string | undefined }): Promise<{ code: number | null; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    const child = spawn('openssl', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    const outChunks: Buffer[] = [];
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => outChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    // Passphrase wird NIE als Kommandozeilenargument übergeben (sonst in `ps aux` fuer jeden
    // lokalen Prozess auf demselben Host sichtbar, siehe analoge Begruendung bei N14/Backups) --
    // stattdessen ueber einen zusaetzlichen, nicht-stdout/-stderr Dateideskriptor (fd 3), den
    // `-passin fd:3` referenziert.
    const fd3 = child.stdio[3] as Writable | null;
    fd3?.end(extraStdio.fd3 ?? '');
    child.on('close', code => resolve({ code, out: Buffer.concat(outChunks), err: err.trim() }));
    child.on('error', error => resolve({ code: 1, out: Buffer.alloc(0), err: String(error?.message || error) }));
  });
}

// Baut die vollstaendige, bereits signierte MIME-Nachricht (inkl. From/To/Subject-Header) --
// wird von mailer.ts unveraendert als `raw` an nodemailer uebergeben, da nodemailer selbst keine
// S/MIME-Umschlaege bauen kann.
export async function buildSignedMimeMessage(params: SmimeSignParams): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'smime-'));
  try {
    const certPath = join(dir, 'cert.pem');
    const keyPath = join(dir, 'key.pem');
    const msgPath = join(dir, 'message.eml');

    // Nur dieser Prozess (ticketapp im Container) kann die Dateien im eigenen mkdtemp-Verzeichnis
    // lesen; beide werden im finally-Block wieder entfernt, auch bei einem Fehler.
    await writeFile(certPath, params.certificatePem, { mode: 0o600 });
    await writeFile(keyPath, params.privateKeyPem, { mode: 0o600 });

    const boundary = `mime-body-${randomBytes(16).toString('hex')}`;
    const bodyLines: string[] = [];
    if (params.html) {
      bodyLines.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        params.text,
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        params.html,
        `--${boundary}--`
      );
    } else {
      bodyLines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', params.text);
    }
    await writeFile(msgPath, bodyLines.join('\r\n'), 'utf8');

    const args = [
      'smime', '-sign',
      '-in', msgPath,
      '-signer', certPath,
      '-inkey', keyPath,
      '-outform', 'SMIME'
    ];
    if (params.passphrase) args.push('-passin', 'fd:3');

    const result = await runOpenssl(args, { fd3: params.passphrase });
    if (result.code !== 0 || result.out.length === 0) {
      throw new Error(`S/MIME-Signatur fehlgeschlagen: ${result.err || 'unbekannter openssl-Fehler'}`);
    }

    // `openssl smime -sign -outform SMIME` liefert bereits einen vollstaendigen MIME-Teil
    // (multipart/signed mit Content-Type/MIME-Version-Headern) -- nur noch die eigentlichen
    // Mail-Header (From/To/Subject) davorsetzen.
    const header = [
      `From: ${params.fromAddress}`,
      `To: ${params.toAddress}`,
      `Subject: ${params.subject}`,
      ''
    ].join('\r\n');
    return Buffer.concat([Buffer.from(header, 'utf8'), result.out]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
