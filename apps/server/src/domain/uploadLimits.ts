import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

// Maximale Dateigroesse je Anhang (Systemeinstellungen > Allgemein). Der Superadmin waehlt einen Wert
// zwischen 500 MB und 2000 MB; ohne Auswahl gilt 1 GB. Die Obergrenze bleibt unter 2 GiB, weil ClamAV
// groessere Streams nicht mehr vollstaendig prueft (ops/docker/clamav/clamd.conf). Die Pruefung beim
// Abschluss streamt die Teilstuecke und haelt nie die ganze Datei im Speicher (Security-Audit R-29).
export const MB = 1024 * 1024;
export const MIN_UPLOAD_LIMIT_MB = 500;
export const MAX_UPLOAD_LIMIT_MB = 2000;
export const DEFAULT_UPLOAD_LIMIT_MB = 1024;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_LIMIT_MB * MB;

export function uploadLimitBytesFromConfig(config: Record<string, any> | null | undefined): number {
  const value = Number(config?.uploadConfig?.maxFileMb);
  const mb = Number.isInteger(value) && value >= MIN_UPLOAD_LIMIT_MB && value <= MAX_UPLOAD_LIMIT_MB ? value : DEFAULT_UPLOAD_LIMIT_MB;
  return mb * MB;
}

export async function loadUploadLimitBytes(db: Kysely<Database>): Promise<number> {
  const row = await db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  let config: Record<string, any> = {};
  try { config = row?.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  return uploadLimitBytesFromConfig(config);
}

// Security-Audit R-26: Tageskontingent je Konto waechst mit der erlaubten Dateigroesse (eine Datei in
// voller Groesse passt immer), bleibt fuer normale Konten aber deutlich kleiner als fuer Admins. Die
// gesamte Installation ist zusaetzlich begrenzt, damit die Datenbank-Platte nicht volllaeuft.
export function dailyUploadQuota(role: string, limitBytes: number): number {
  return role === 'user' ? limitBytes : 4 * limitBytes;
}
export function installationDailyUploadQuota(limitBytes: number): number {
  return Math.max(20 * 1024 * MB, 10 * limitBytes);
}
