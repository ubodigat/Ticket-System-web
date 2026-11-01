// Security-Audit R-25: Ist der zweite Faktor Pflicht und hat ein Konto noch keinen, durfte ihn
// bisher einrichten, wer nur das Passwort kannte -- nach dem Einschalten einer MFA-Pflicht konnten
// Angreifer mit geleakten Passwoertern den echten Personen zuvorkommen. Die Ersteinrichtung braucht
// jetzt zusaetzlich einen von zwei Nachweisen:
// - einen Bestaetigungscode per E-Mail an die hinterlegte Adresse (8 Ziffern, 15 Minuten gueltig,
//   hoechstens 5 Versuche je Code), oder
// - einen Einrichtungscode, den eine berechtigte Admin-Person erzeugt (24 Stunden gueltig, einmalig)
//   -- fuer Installationen ohne Mailversand oder Personen ohne Zugriff auf ihr Postfach.
// Gespeichert werden nur HMACs der Codes, nie die Codes selbst.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const MAIL_CODE_TTL_MS = 15 * 60 * 1000;
export const MAIL_CODE_MAX_ATTEMPTS = 5;
export const MAIL_CODE_RESEND_MS = 60 * 1000;
export const MAIL_CODE_MAX_SENDS = 5;
export const ADMIN_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeEnrollCode(code: string): string {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function enrollCodeHash(secret: string, userId: string, code: string, kind: 'mail' | 'admin'): string {
  return createHmac('sha256', secret).update(`mfa-enroll-${kind}:${userId}:${normalizeEnrollCode(code)}`).digest('hex');
}

export function enrollCodeMatches(expectedHex: string | null | undefined, actualHex: string): boolean {
  if (!expectedHex || expectedHex.length !== actualHex.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
}

export function generateMailEnrollCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}

// 12 Zeichen aus 32 eindeutigen Zeichen (60 Bit), lesbar gruppiert: XXXX-XXXX-XXXX.
export function generateAdminEnrollCode(): string {
  const chars = Array.from({ length: 12 }, () => ADMIN_ALPHABET[randomInt(0, ADMIN_ALPHABET.length)]).join('');
  return chars.match(/.{4}/g)!.join('-');
}
