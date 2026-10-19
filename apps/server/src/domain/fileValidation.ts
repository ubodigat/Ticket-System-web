/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { fileTypeFromBuffer } from 'file-type';

export interface ValidatedFile {
  safeFilename: string;
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps',
  '.sh', '.bash', '.zsh', '.csh', '.ksh',
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
  '.py', '.pyc', '.pyo', '.rb', '.pl', '.cgi',
  '.js', '.mjs', '.cjs', '.vbs', '.vbe', '.wsf', '.wsh', '.hta',
  '.jar', '.class',
  '.html', '.htm', '.xhtml', '.shtml',
  '.svg', '.svgz',
  '.asp', '.aspx', '.jsp', '.jspx',
  '.reg', '.inf', '.msi', '.msp', '.com', '.scr'
]);

const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sharedlib',
  'application/x-shellscript',
  'application/x-bat',
  'application/x-php',
  'application/x-httpd-php',
  'application/javascript',
  'text/javascript',
  'text/html',
  'text/x-php',
  'text/x-shellscript',
  'text/x-python',
  'text/x-ruby',
  'text/x-perl',
  'image/svg+xml'
];

/**
 * Validiert Dateianhänge serverseitig nach dem Zero-Trust-Prinzip:
 * Der Server verlässt sich niemals auf vom Browser deklarierte Dateinamen oder MIME-Typen.
 * 
 * Geprüft werden:
 * 1. Base64-Integrität und maximale Dateigröße
 * 2. Pfad-Traversal und illegale Kontrollzeichen im Dateinamen
 * 3. Dateiendung gegen Blocklist (Ausführbare Dateien, Skripte, HTML, SVG)
 * 4. Magic-Bytes / Binär-Header (PE, ELF, Mach-O, Shebang, Java Bytecode)
 * 5. Text-Inhaltsanalyse auf Skripte, PHP-Tags und Web-Payloads
 * 6. Tiefe MIME-Erkennung via file-type
 */
export async function validateUploadedFile(params: {
  filename: string;
  declaredMimeType: string;
  dataB64: string;
  maxSizeBytes?: number;
}): Promise<ValidatedFile> {
  const maxBytes = params.maxSizeBytes ?? 15 * 1024 * 1024;

  // 1. Dateiname bereinigen und prüfen
  const rawFilename = (params.filename || '').trim();
  if (!rawFilename || rawFilename.length > 255) {
    throw { statusCode: 400, message: 'invalid_filename' };
  }

  // Pfad-Traversal und Kontrollzeichen strikt verbieten
  if (/[<>:"/\\|?*\x00-\x1F]/.test(rawFilename) || rawFilename.includes('..')) {
    throw { statusCode: 400, message: 'invalid_filename_characters' };
  }

  const safeFilename = rawFilename;
  const lowerName = safeFilename.toLowerCase();

  // Dateiendung ermitteln und gegen Blocklist abgleichen
  const lastDot = lowerName.lastIndexOf('.');
  const ext = lastDot >= 0 ? lowerName.slice(lastDot) : '';
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw { statusCode: 400, message: 'blocked_extension' };
  }

  // 2. Base64 dekodieren und Größenprüfung
  let buffer: Buffer;
  try {
    buffer = Buffer.from(params.dataB64, 'base64');
  } catch {
    throw { statusCode: 400, message: 'invalid_base64' };
  }

  if (buffer.length === 0) {
    throw { statusCode: 400, message: 'file_empty' };
  }

  if (buffer.length > maxBytes) {
    throw { statusCode: 413, message: 'file_too_large' };
  }

  // 3. Magic-Byte-Prüfungen auf Binärebene (unabhängig vom deklarierten Namen)
  // Windows PE (MZ)
  if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
    throw { statusCode: 400, message: 'blocked_executable_content' };
  }

  // Linux ELF (\x7fELF)
  if (buffer.length >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    throw { statusCode: 400, message: 'blocked_executable_content' };
  }

  // Mach-O (macOS Executables)
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if (magic === 0xFEEDFACE || magic === 0xFEEDFACF || magic === 0xCAFEBABE || magic === 0xBEBAFECA) {
      throw { statusCode: 400, message: 'blocked_executable_content' };
    }
  }

  // Shebang (Unix-Skripte #!)
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
    throw { statusCode: 400, message: 'blocked_script_content' };
  }

  // 4. Inhaltsanalyse auf Skripte, PHP-Tags und Web-Payloads in den ersten 8 KB
  const headText = buffer.subarray(0, 8192).toString('utf8').toLowerCase();
  if (
    headText.includes('<?php') ||
    headText.includes('<?=') ||
    headText.includes('<script') ||
    headText.includes('javascript:') ||
    headText.includes('onload=') ||
    headText.includes('onerror=') ||
    headText.includes('xmlns="http://www.w3.org/2000/svg"') ||
    headText.includes('<svg') ||
    headText.includes('<!doctype html') ||
    headText.includes('<html')
  ) {
    throw { statusCode: 400, message: 'blocked_script_content' };
  }

  // 5. Tiefe MIME-Erkennung mit file-type
  const detected = await fileTypeFromBuffer(buffer);
  let finalMime = ((params.declaredMimeType || 'application/octet-stream').toLowerCase().split(';')[0] ?? '').trim();

  if (detected) {
    // Wenn file-type einen gefährlichen Typ erkennt -> blockieren
    for (const blocked of BLOCKED_MIME_PREFIXES) {
      if (detected.mime.toLowerCase().startsWith(blocked)) {
        throw { statusCode: 400, message: 'blocked_detected_mime' };
      }
    }
    // Erkannten sicheren MIME-Typ bevorzugen
    finalMime = detected.mime;
  }

  // Auch deklarierten MIME-Typ gegen Blocklist prüfen
  for (const blocked of BLOCKED_MIME_PREFIXES) {
    if (finalMime.startsWith(blocked)) {
      throw { statusCode: 400, message: 'blocked_mime_type' };
    }
  }

  return {
    safeFilename,
    buffer,
    mimeType: finalMime,
    sizeBytes: buffer.length
  };
}
