// Datenbank-Sicherung erstellen und einspielen (Systemeinstellungen > Info & Updates).
// Schutzschichten, alle serverseitig erzwungen:
// 1. Nur Superadmin; der Upload wird schon vor dem Einlesen des Bodys abgewiesen.
// 2. Step-up mit aktuellem Passwort UND eingerichteter Zwei-Faktor-Authentifizierung (TOTP).
// 3. Sicherungs-Passphrase (mind. 16 Zeichen): die Datei ist mit AES-256-GCM verschluesselt,
//    der Schluessel entsteht per scrypt und wird nirgends gespeichert.
// 4. SHA-256-Hash der Datei: beim Erstellen angezeigt, beim Einspielen exakt wieder anzugeben.
// 5. Bindung an diese Installation und an den aktuellen Datenbank-Schema-Stand.
// 6. Schriftliche Bestaetigung ("WIEDERHERSTELLEN"), Ratenbegrenzung, nur ein Vorgang gleichzeitig.
// 7. Vollstaendige Pruefung des Inhalts vor dem ersten Schreibzugriff; das Einspielen selbst
//    laeuft in einer Transaktion -- bei jedem Fehler bleibt der bisherige Stand unveraendert.
// 8. Danach werden alle Sitzungen, gemerkten MFA-Geraete und offenen Auftraege verworfen.
// 9. Jede Aktion (auch abgelehnte Versuche) landet im globalen Audit-Log.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import { requireStepUp } from './stepUp.js';
import {
  BACKUP_MAX_BYTES, BACKUP_PASSPHRASE_MIN, BackupError, type BackupTableMeta, createBackupWriter, decodeValue,
  encodeValue, hashMatches, openBackup, readBackupHeader, sha256Hex
} from '../../domain/backup.js';
import type { Database } from '../../db/types.js';
import { appliedSchemaFingerprint } from '../../db/schemaSync.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';

export interface BackupRouteDeps { env: Env; keyProvider: KeyProvider }

export const RESTORE_CONFIRMATION = 'WIEDERHERSTELLEN';
// Nicht Teil der Sicherung: Schemastand (gehoert zum laufenden Code), Fortschritt der
// Neuverschluesselung, Sitzungen, gemerkte MFA-Geraete/-Ablaeufe (sonst lebten alte Anmeldungen wieder
// auf), Auftragswarteschlange und Sperr-/Zaehlerstaende der Anmeldedrosselung.
export const BACKUP_EXCLUDED_TABLES = new Set(['schema_state', 'crypto_jobs', 'sessions', 'mfa_flows', 'mfa_devices',
  'jobs', 'job_dead_letter', 'rate_limit_counters', 'login_failure_sources']);
const CLEARED_AFTER_RESTORE = ['sessions', 'mfa_flows', 'mfa_devices', 'jobs'] as const;
const STAGE_TTL_MS = 15 * 60 * 1000;
const INSERT_BATCH_ROWS = 200;
const INSERT_BATCH_BYTES = 2 * 1024 * 1024;

const passphraseSchema = z.string().min(BACKUP_PASSPHRASE_MIN).max(1024);
const createSchema = z.object({ passphrase: passphraseSchema }).passthrough();
const restoreSchema = z.object({
  passphrase: passphraseSchema,
  sha256: z.string().trim().min(64).max(200),
  confirm: z.literal(RESTORE_CONFIRMATION)
}).passthrough();

// required: Spalten ohne Standardwert, die NOT NULL sind -- muessen in einer Sicherung vorkommen.
interface TableSchema { name: string; columns: string[]; primaryKey: string[]; required: string[] }

// Aktuelle Tabellen/Spalten der Datenbank (ohne berechnete Spalten) -- Grundlage fuer Export und
// fuer den Abgleich beim Einspielen.
export async function loadTableSchemas(db: Kysely<Database>): Promise<TableSchema[]> {
  const rows = (await sql<{ table_name: string; column_name: string; column_key: string; extra: string; nullable: string; def: string | null }>`
    SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.COLUMN_KEY AS column_key, c.EXTRA AS extra,
      c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS def
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`.execute(db)).rows;
  const tables = new Map<string, TableSchema>();
  for (const row of rows) {
    if (BACKUP_EXCLUDED_TABLES.has(row.table_name) || /GENERATED|VIRTUAL|PERSISTENT|STORED/i.test(row.extra || '')) continue;
    const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [], primaryKey: [], required: [] };
    table.columns.push(row.column_name);
    if (row.nullable !== 'YES' && row.def === null && !/auto_increment/i.test(row.extra || '')) table.required.push(row.column_name);
    if (row.column_key === 'PRI') table.primaryKey.push(row.column_name);
    tables.set(row.table_name, table);
  }
  return [...tables.values()];
}

// Passt eine Sicherung ins aktuelle Schema? Jede gesicherte Tabelle und Spalte muss es noch geben
// (sonst gingen Daten verloren); neue Spalten muessen einen Standardwert haben oder NULL erlauben.
// So laesst sich auch eine Sicherung einer aelteren Version nach einem Update einspielen.
export function backupFitsSchema(meta: BackupTableMeta[], current: Map<string, TableSchema>): boolean {
  const names = new Set(meta.map(table => table.name));
  if (names.size !== meta.length) return false;
  return meta.every(table => {
    const live = current.get(table.name);
    if (!live || !Array.isArray(table.columns) || new Set(table.columns).size !== table.columns.length) return false;
    const liveColumns = new Set(live.columns);
    return table.columns.every(column => liveColumns.has(column)) && live.required.every(column => table.columns.includes(column));
  });
}

async function audit(app: FastifyInstance, session: { uid: string; username: string }, action: string, detail: Record<string, unknown>) {
  await app.db.insertInto('global_audit_log').values({
    id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
    action, target_type: 'system', target_id: null, detail_json: JSON.stringify(detail)
  }).execute().catch(err => app.log.error({ err }, 'Sicherungs-Aktion konnte nicht protokolliert werden'));
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupRouteDeps): void {
  let busy = false;
  let staged: { uid: string; file: Buffer; expiresAt: number } | null = null;
  const stagedFor = (uid: string) => {
    if (staged && staged.expiresAt < Date.now()) staged = null;
    return staged && staged.uid === uid ? staged : null;
  };
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy) throw { statusCode: 409, message: 'backup_busy' };
    busy = true;
    try { return await work(); } finally { busy = false; }
  };

  // Sicherung erstellen: verschluesselte Datei als Download, Hash im Kopf X-Backup-Sha256.
  app.post('/api/v2/system/backup', { config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid, { requireTotp: true });
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'passphrase_too_short' });
      const result = await exclusive(async () => {
        const writer = await createBackupWriter(parsed.data.passphrase, {
          installationId: deps.env.INSTALLATION_ID, schemaFingerprint: await appliedSchemaFingerprint(app.db), createdBy: session.username
        });
        let rowCount = 0;
        const tables = await loadTableSchemas(app.db);
        await app.db.transaction().setIsolationLevel('repeatable read').execute(async trx => {
          await writer.write({ kind: 'meta', tables: tables.map(({ name, columns }) => ({ name, columns })) });
          for (const table of tables) {
            const pageSize = 500;
            for (let offset = 0; ; offset += pageSize) {
              let query = (trx as Kysely<any>).selectFrom(table.name).select(table.columns.map(column => sql.ref(column).as(column)));
              // Ohne Primaerschluessel in einem Rutsch, sonst stabil sortiert seitenweise.
              if (table.primaryKey.length) query = table.primaryKey.reduce((q, column) => q.orderBy(sql.ref(column)), query).limit(pageSize).offset(offset);
              const rows = await query.execute() as Record<string, unknown>[];
              for (const row of rows) await writer.write({ t: table.name, r: table.columns.map(column => encodeValue(row[column])) });
              rowCount += rows.length;
              if (!table.primaryKey.length || rows.length < pageSize) break;
            }
          }
        });
        return { file: await writer.finish(), rowCount, tableCount: tables.length };
      });
      const hash = result.file.sha256;
      await audit(app, session, 'system.backup_created', { sha256: hash, size: result.file.size, tables: result.tableCount, rows: result.rowCount });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="ticketsystem-sicherung-${stamp}.tsbackup"`)
        .header('cache-control', 'no-store')
        .header('x-backup-sha256', hash)
        .header('content-length', result.file.size)
        .send(Readable.from(result.file.chunks));
    } catch (error) {
      if (error instanceof BackupError) return reply.code(error.code === 'backup_too_large' ? 413 : 400).send({ error: error.code });
      return routeError(app, reply, error);
    }
  });

  // Einspielen, Schritt 1: Datei hochladen (wird nur kurz im Speicher vorgehalten, nichts geaendert).
  app.register(async scoped => {
    scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: BACKUP_MAX_BYTES }, (_req, body, done) => done(null, body));
    scoped.put('/api/v2/system/backup/upload', {
      bodyLimit: BACKUP_MAX_BYTES,
      onRequest: async (req, reply) => {
        try { requireSuperadmin(req); } catch (error) { return routeError(app, reply, error); }
      },
      config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip } }
    }, async (req, reply) => {
      try {
        const session = requireSuperadmin(req);
        const file = req.body;
        if (!Buffer.isBuffer(file) || !file.length) return reply.code(400).send({ error: 'backup_invalid_file' });
        readBackupHeader(file);
        if (staged && staged.uid !== session.uid && staged.expiresAt > Date.now()) return reply.code(409).send({ error: 'backup_busy' });
        staged = { uid: session.uid, file, expiresAt: Date.now() + STAGE_TTL_MS };
        // Bewusst KEIN Hash in der Antwort: er muss aus der Erstellung bekannt sein.
        return reply.send({ size: file.length });
      } catch (error) {
        if (error instanceof BackupError) return reply.code(400).send({ error: error.code });
        return routeError(app, reply, error);
      }
    });
  });

  app.delete('/api/v2/system/backup/upload', async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      if (stagedFor(session.uid)) staged = null;
      return reply.send({ success: true });
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Einspielen, Schritt 2: alle Pruefungen, dann vollstaendiger Austausch in einer Transaktion.
  app.post('/api/v2/system/backup/restore', { config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: req => req.ticketSession?.uid ?? req.ip } } }, async (req, reply) => {
    let session: { uid: string; username: string } | null = null;
    const reject = async (code: string, status = 400) => {
      if (session) await audit(app, session, 'system.backup_restore_rejected', { reason: code });
      return reply.code(status).send({ error: code });
    };
    try {
      session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid, { requireTotp: true });
      const parsed = restoreSchema.safeParse(req.body);
      if (!parsed.success) {
        const fields = parsed.error.flatten().fieldErrors;
        return reject(fields.confirm ? 'confirmation_required' : fields.sha256 ? 'backup_hash_mismatch' : 'passphrase_too_short');
      }
      const upload = stagedFor(session.uid);
      if (!upload) return reject('backup_upload_missing', 409);
      if (!hashMatches(upload.file, parsed.data.sha256)) return reject('backup_hash_mismatch');
      const { header } = readBackupHeader(upload.file);
      if (header.installationId !== deps.env.INSTALLATION_ID) return reject('backup_installation_mismatch');

      const stats = await exclusive(async () => {
        const backup = await openBackup(upload.file, parsed.data.passphrase);
        const current = new Map((await loadTableSchemas(app.db)).map(table => [table.name, table]));
        // Durchlauf 1: nur pruefen. Die Sicherung muss ins aktuelle Schema passen (backupFitsSchema),
        // jede Zeile muss vollstaendig und dekodierbar sein.
        let meta: BackupTableMeta[] | null = null;
        let rows = 0;
        for await (const line of backup.lines()) {
          if (!meta) {
            if (!('kind' in line) || line.kind !== 'meta' || !Array.isArray(line.tables)) throw new BackupError('backup_invalid_content');
            meta = line.tables;
            if (!backupFitsSchema(meta, current)) throw new BackupError('backup_schema_mismatch');
            continue;
          }
          if (!('t' in line)) throw new BackupError('backup_invalid_content');
          const table = meta.find(item => item.name === line.t);
          if (!table || !Array.isArray(line.r) || line.r.length !== table.columns.length) throw new BackupError('backup_invalid_content');
          line.r.forEach(decodeValue);
          rows++;
        }
        if (!meta) throw new BackupError('backup_invalid_content');

        // Durchlauf 2: Austausch in einer Transaktion. Fremdschluessel-Pruefungen nur fuer diese
        // Verbindung und nur waehrend des Austauschs aus (Reihenfolge der Tabellen beliebig).
        const tableMeta = meta;
        // Tabellen, die es beim Erstellen der Sicherung noch nicht gab, werden mit geleert -- sonst
        // blieben Zeilen stehen, die auf nicht mehr vorhandene Datensaetze verweisen.
        const cleared = [...current.keys()];
        await app.db.transaction().execute(async trx => {
          await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(trx);
          try {
            for (const table of cleared) await (trx as Kysely<any>).deleteFrom(table).execute();
            let batch: Record<string, unknown>[] = [];
            let batchTable = '';
            let batchBytes = 0;
            const flush = async () => {
              if (batch.length) await (trx as Kysely<any>).insertInto(batchTable).values(batch).execute();
              batch = []; batchBytes = 0;
            };
            let first = true;
            for await (const line of backup.lines()) {
              if (first) { first = false; continue; }
              if (!('t' in line)) throw new BackupError('backup_invalid_content');
              const table = tableMeta.find(item => item.name === line.t)!;
              if (line.t !== batchTable) { await flush(); batchTable = line.t; }
              const record: Record<string, unknown> = {};
              table.columns.forEach((column, index) => {
                const value = decodeValue(line.r[index]);
                record[column] = value;
                batchBytes += Buffer.isBuffer(value) ? value.length : typeof value === 'string' ? value.length : 8;
              });
              batch.push(record);
              if (batch.length >= INSERT_BATCH_ROWS || batchBytes >= INSERT_BATCH_BYTES) await flush();
            }
            await flush();
            for (const table of CLEARED_AFTER_RESTORE) await trx.deleteFrom(table).execute();
          } finally {
            await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(trx);
          }
        });
        return { rows, tables: tableMeta.length };
      });
      staged = null;
      await audit(app, session, 'system.backup_restored', {
        sha256: sha256Hex(upload.file), backupCreatedAt: header.createdAt, backupCreatedBy: header.createdBy, ...stats
      });
      return reply.send({ success: true, ...stats });
    } catch (error) {
      if (error instanceof BackupError) return reject(error.code);
      const message = (error as { message?: unknown })?.message;
      if (session && typeof message === 'string' && (error as { statusCode?: number })?.statusCode) {
        await audit(app, session, 'system.backup_restore_rejected', { reason: message });
      }
      return routeError(app, reply, error);
    }
  });
}
