// Eigene Profilbilder: nur PNG, JPEG oder WebP, erkannt an den Dateisignaturen (nicht an der
// Angabe des Browsers), hoechstens 300 KB und 1024 x 1024 Pixel. Die Pixelgrenze verhindert
// Bilder, die klein als Datei sind, beim Anzeigen aber riesige Speichermengen belegen wuerden.
// SVG ist bewusst ausgeschlossen (kann Skripte enthalten).
export const AVATAR_MAX_BYTES = 300 * 1024;
export const AVATAR_MAX_PIXELS = 1024;
export const AVATAR_PRESET_COUNT = 6;
export type AvatarMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface AvatarImageInfo { mime: AvatarMime; width: number; height: number }

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1]!;
    while (marker === 0xff && i + 2 < buf.length) { i++; marker = buf[i + 1]!; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [buf[21]!, buf[22]!, buf[23]!, buf[24]!];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  return null;
}

// Liefert Typ und Abmessungen eines zulaessigen Profilbilds, sonst null.
export function inspectAvatarImage(buf: Buffer): AvatarImageInfo | null {
  if (!buf.length || buf.length > AVATAR_MAX_BYTES) return null;
  let info: AvatarImageInfo | null = null;
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('ascii', 12, 16) === 'IHDR') {
    info = { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    if (size) info = { mime: 'image/jpeg', ...size };
  } else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const size = webpSize(buf);
    if (size) info = { mime: 'image/webp', ...size };
  }
  if (!info || info.width < 1 || info.height < 1 || info.width > AVATAR_MAX_PIXELS || info.height > AVATAR_MAX_PIXELS) return null;
  return info;
}

// Oeffentliche Beschreibung fuer Antworten: Vorlage oder Versionskennung des eigenen Bildes.
export function avatarDescriptor(row: { avatar_preset?: number | null; avatar_mime?: string | null; avatar_updated_at?: Date | string | null }) {
  const version = row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() || 1 : 1;
  if (row.avatar_mime) return { preset: null, custom: version };
  const preset = Number(row.avatar_preset);
  return { preset: Number.isInteger(preset) && preset >= 1 && preset <= AVATAR_PRESET_COUNT ? preset : null, custom: null };
}
