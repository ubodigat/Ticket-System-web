/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { Socket } from 'node:net';

// Security-Audit B7 ("kein Virenscan"): spricht das clamd-INSTREAM-Protokoll direkt über TCP --
// bewusst ohne npm-Zusatzpaket (das Protokoll ist winzig: Laenge-praefixierte Chunks, siehe
// https://docs.clamav.net/manual/Usage/Scanning.html#stream-scanning), um keine weitere
// Abhaengigkeit mit eigenem CVE-Risiko einzufuehren. Nur aktiv, wenn CLAMAV_HOST gesetzt ist
// (env.ts) -- ohne das optionale "antivirus"-Compose-Profil bleibt das Verhalten unveraendert.
const CHUNK_SIZE = 64 * 1024;
const SCAN_TIMEOUT_MS = 300_000;

export interface AntivirusResult {
  clean: boolean;
  signature?: string | undefined;
}

export async function scanBuffer(host: string, port: number, buffer: Buffer): Promise<AntivirusResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('clamav_timeout')));
    }, SCAN_TIMEOUT_MS);

    socket.on('error', err => finish(() => reject(err)));
    socket.on('data', chunk => { response += chunk.toString('utf8'); });
    socket.on('close', () => {
      finish(() => {
        // clamd antwortet z.B. "stream: OK" oder "stream: Eicar-Test-Signature FOUND".
        const trimmed = response.trim();
        if (trimmed.endsWith('OK')) return resolve({ clean: true });
        const match = trimmed.match(/:\s*(.+)\s+FOUND$/);
        if (match) return resolve({ clean: false, signature: match[1] });
        reject(new Error(`clamav_unexpected_response: ${trimmed}`));
      });
    });

    socket.connect(port, host, async () => {
      try {
      socket.write('zINSTREAM\0');
      let offset = 0;
      while (offset < buffer.length) {
        const end = Math.min(offset + CHUNK_SIZE, buffer.length);
        const chunk = buffer.subarray(offset, end);
        const sizeHeader = Buffer.alloc(4);
        sizeHeader.writeUInt32BE(chunk.length, 0);
        socket.write(sizeHeader);
        await new Promise<void>((resolve, reject) => socket.write(chunk, error => error ? reject(error) : resolve()));
        offset = end;
      }
      // Null-Laenge-Chunk signalisiert clamd das Ende des Streams.
      const endHeader = Buffer.alloc(4);
      endHeader.writeUInt32BE(0, 0);
      socket.write(endHeader);
      } catch (error) { finish(() => reject(error)); }
    });
  });
}

// Wird aus extras.ts/knowledge.ts NACH validateUploadedFile() aufgerufen (Magic-Bytes/Inhalts-
// prüfung läuft immer zuerst und ist billiger). Wenn CLAMAV_HOST nicht konfiguriert ist, tut
// diese Funktion nichts -- Upload läuft wie vor diesem Feature. Ist es konfiguriert, ist der
// Scan verbindlich: ein nicht erreichbarer ClamAV-Dienst lässt den Upload fehlschlagen (503),
// statt den Scan still zu überspringen -- eine Person, die den Scan aktiviert hat, erwartet,
// dass er auch greift.
export async function scanIfConfigured(env: { CLAMAV_HOST?: string | undefined; CLAMAV_PORT: number }, buffer: Buffer): Promise<void> {
  if (!env.CLAMAV_HOST) return;
  let result: AntivirusResult;
  try {
    result = await scanBuffer(env.CLAMAV_HOST, env.CLAMAV_PORT, buffer);
  } catch {
    throw { statusCode: 503, message: 'antivirus_unavailable' };
  }
  if (!result.clean) {
    throw { statusCode: 400, message: 'infected_file', signature: result.signature };
  }
}
