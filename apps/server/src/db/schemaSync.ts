/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { OBSOLETE_TABLES, SEED_ROWS, TABLES, type ForeignKeyDefinition, type IndexDefinition, type TableDefinition } from './schema.js';

// Gleicht die Datenbank mit db/schema.ts ab. Grundsaetze:
// - Es wird nie eine Tabelle mit Daten, eine Spalte oder eine Zeile geloescht.
// - Spalten werden nur verlustfrei geaendert (groesserer Typ derselben Familie, NOT NULL -> NULL,
//   NULL -> NOT NULL nur ohne NULL-Werte). Jede andere Abweichung bricht den Abgleich ab, BEVOR
//   irgendetwas geaendert wurde -- die Datenbank bleibt dann unveraendert und lesbar.
// - Spalten, die das Schema nicht mehr kennt, bleiben mit ihren Daten erhalten; ein NOT NULL ohne
//   Standardwert wird gelockert, damit neue Zeilen ohne sie geschrieben werden koennen.
// - Laeuft beliebig oft hintereinander; ein zweiter Lauf findet nichts mehr zu tun.

export const SCHEMA_FINGERPRINT = createHash('sha256').update(JSON.stringify({ TABLES, SEED_ROWS })).digest('hex');

export interface SchemaSyncReport {
  readonly fingerprint: string;
  readonly actions: string[];
  readonly warnings: string[];
}

export class SchemaDriftError extends Error {
  constructor(readonly problems: string[]) {
    super(`Datenbankschema weicht ab und kann nicht verlustfrei angepasst werden:\n- ${problems.join('\n- ')}`);
    this.name = 'SchemaDriftError';
  }
}

interface ColumnInfo { name: string; type: string; nullable: boolean; hasDefault: boolean; extra: string }
interface IndexInfo { name: string; unique: boolean; columns: string[] }
interface ForeignKeyInfo { name: string; columns: string[]; references: string; referencedColumns: string[] }
interface Step { phase: number; sql: string; label: string }

const ident = (name: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Ungueltiger Bezeichner im Schema: ${name}`);
  return `\`${name}\``;
};
const list = (names: readonly string[]) => names.map(ident).join(', ');

// Familien, innerhalb derer ein groesserer Typ alle Werte des kleineren aufnehmen kann.
const RANKED: readonly (readonly string[])[] = [
  ['tinyint', 'smallint', 'mediumint', 'int', 'bigint'],
  ['tinytext', 'text', 'mediumtext', 'longtext'],
  ['tinyblob', 'blob', 'mediumblob', 'longblob']
];

function parseType(definition: string): { base: string; length: number | null; full: string } {
  const match = /^([a-z]+)(?:\(([^)]*)\))?( unsigned)?/i.exec(definition.trim());
  if (!match) throw new Error(`Unlesbare Spaltendefinition: ${definition}`);
  const base = match[1]!.toLowerCase();
  const length = match[2] && /^\d+$/.test(match[2]) ? Number(match[2]) : null;
  return { base, length, full: match[0].toLowerCase().replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1') };
}

function normalizedType(type: string): string {
  return parseType(type).full;
}

// Liegt der neue Typ verlustfrei ueber dem alten?
export function isLosslessWidening(fromType: string, toType: string): boolean {
  const from = parseType(fromType);
  const to = parseType(toType);
  if (from.full === to.full) return true;
  for (const family of RANKED) {
    const a = family.indexOf(from.base);
    const b = family.indexOf(to.base);
    if (a >= 0 && b >= 0) return b >= a && /unsigned/.test(from.full) === /unsigned/.test(to.full);
  }
  const sized = (names: string[]) => names.includes(from.base) && names.includes(to.base);
  if (sized(['char', 'varchar']) || sized(['binary', 'varbinary'])) {
    return to.length !== null && from.length !== null && to.length >= from.length && !(from.base === 'varchar' && to.base === 'char');
  }
  // Begrenzte Laenge -> unbegrenzter Typ derselben Art.
  if (['char', 'varchar'].includes(from.base) && ['text', 'mediumtext', 'longtext'].includes(to.base)) return true;
  if (['binary', 'varbinary'].includes(from.base) && ['blob', 'mediumblob', 'longblob'].includes(to.base)) return true;
  return false;
}

const isNullable = (definition: string) => !/\bNOT NULL\b/i.test(definition);

function createTableSql(table: TableDefinition): string {
  const parts = [
    ...table.columns.map(([name, definition]) => `${ident(name)} ${definition}`),
    `PRIMARY KEY (${list(table.primaryKey)})`,
    ...(table.indexes ?? []).map(index => `${index.unique ? 'UNIQUE ' : ''}KEY ${ident(index.name)} (${list(index.columns)})`)
  ];
  return `CREATE TABLE IF NOT EXISTS ${ident(table.name)} (\n  ${parts.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

function foreignKeyName(table: string, fk: ForeignKeyDefinition): string {
  return `fk_${table}_${fk.columns.join('_')}`.slice(0, 64);
}

function foreignKeySql(table: string, fk: ForeignKeyDefinition): string {
  return `ALTER TABLE ${ident(table)} ADD CONSTRAINT ${ident(foreignKeyName(table, fk))} FOREIGN KEY (${list(fk.columns)}) `
    + `REFERENCES ${ident(fk.references)} (${list(fk.referencedColumns)})`
    + (fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '') + (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '');
}

const sameColumns = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value.toLowerCase() === b[i]!.toLowerCase());

async function rows<T>(db: Kysely<any>, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await query.execute(db)).rows as T[];
}

async function loadState(db: Kysely<any>) {
  const tables = new Set((await rows<{ name: string }>(db, sql`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`)).map(r => r.name));
  const columns = new Map<string, Map<string, ColumnInfo>>();
  for (const r of await rows<{ t: string; c: string; type: string; nullable: string; def: string | null; extra: string }>(db, sql`
      SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, EXTRA AS extra
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`)) {
    if (!columns.has(r.t)) columns.set(r.t, new Map());
    columns.get(r.t)!.set(r.c, { name: r.c, type: r.type, nullable: r.nullable === 'YES', hasDefault: r.def !== null, extra: r.extra ?? '' });
  }
  const indexes = new Map<string, IndexInfo[]>();
  for (const r of await rows<{ t: string; name: string; nonUnique: number; c: string }>(db, sql`
      SELECT TABLE_NAME AS t, INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS c
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`)) {
    const list = indexes.get(r.t) ?? [];
    let index = list.find(i => i.name === r.name);
    if (!index) { index = { name: r.name, unique: Number(r.nonUnique) === 0, columns: [] }; list.push(index); }
    index.columns.push(r.c);
    indexes.set(r.t, list);
  }
  const foreignKeys = new Map<string, ForeignKeyInfo[]>();
  for (const r of await rows<{ t: string; name: string; c: string; rt: string; rc: string }>(db, sql`
      SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS name, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`)) {
    const list = foreignKeys.get(r.t) ?? [];
    let fk = list.find(f => f.name === r.name);
    if (!fk) { fk = { name: r.name, columns: [], references: r.rt, referencedColumns: [] }; list.push(fk); }
    fk.columns.push(r.c);
    fk.referencedColumns.push(r.rc);
    foreignKeys.set(r.t, list);
  }
  return { tables, columns, indexes, foreignKeys };
}

async function countRows(db: Kysely<any>, query: ReturnType<typeof sql>): Promise<number> {
  return Number((await rows<{ n: number | string }>(db, query))[0]?.n ?? 0);
}

// Plant alle Schritte, ohne etwas zu aendern. Wirft SchemaDriftError, wenn eine Anpassung Daten kosten koennte.
export async function planSchemaSync(db: Kysely<any>): Promise<{ steps: Step[]; warnings: string[] }> {
  const state = await loadState(db);
  const steps: Step[] = [];
  const warnings: string[] = [];
  const problems: string[] = [];

  for (const table of TABLES) {
    if (!state.tables.has(table.name)) {
      steps.push({ phase: 1, sql: createTableSql(table), label: `Tabelle ${table.name} angelegt` });
      continue;
    }
    const existing = state.columns.get(table.name) ?? new Map<string, ColumnInfo>();
    for (const [name, definition] of table.columns) {
      const actual = existing.get(name);
      if (!actual) {
        steps.push({ phase: 2, sql: `ALTER TABLE ${ident(table.name)} ADD COLUMN ${ident(name)} ${definition}`, label: `Spalte ${table.name}.${name} angelegt` });
        continue;
      }
      const wanted = parseType(definition).full;
      const typeChanged = normalizedType(actual.type) !== wanted;
      const wantNullable = isNullable(definition);
      if (typeChanged && !isLosslessWidening(actual.type, definition)) {
        problems.push(`${table.name}.${name}: ${actual.type} -> ${wanted} waere nicht verlustfrei`);
        continue;
      }
      if (!wantNullable && actual.nullable) {
        const nulls = await countRows(db, sql`SELECT COUNT(*) AS n FROM ${sql.table(table.name)} WHERE ${sql.ref(name)} IS NULL`);
        if (nulls > 0) { problems.push(`${table.name}.${name}: soll NOT NULL werden, enthaelt aber ${nulls} leere Werte`); continue; }
      }
      if (typeChanged || wantNullable !== actual.nullable) {
        steps.push({ phase: 3, sql: `ALTER TABLE ${ident(table.name)} MODIFY COLUMN ${ident(name)} ${definition}`, label: `Spalte ${table.name}.${name} angepasst (${actual.type} -> ${wanted})` });
      }
    }
    const known = new Set(table.columns.map(([name]) => name));
    for (const actual of existing.values()) {
      if (known.has(actual.name)) continue;
      warnings.push(`Spalte ${table.name}.${actual.name} wird nicht mehr verwendet; die Daten bleiben erhalten.`);
      if (!actual.nullable && !actual.hasDefault && !/auto_increment/i.test(actual.extra)) {
        steps.push({ phase: 3, sql: `ALTER TABLE ${ident(table.name)} MODIFY COLUMN ${ident(actual.name)} ${actual.type} NULL DEFAULT NULL`, label: `Unbenutzte Spalte ${table.name}.${actual.name} auf NULL erlaubt gesetzt` });
      }
    }
    const actualIndexes = state.indexes.get(table.name) ?? [];
    for (const index of table.indexes ?? []) {
      const present = actualIndexes.some(i => i.name === index.name || (sameColumns(i.columns, index.columns) && (i.unique || !index.unique)));
      if (present) continue;
      if (index.unique) {
        const dupes = await countRows(db, sql`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${sql.table(table.name)} GROUP BY ${sql.join(index.columns.map(c => sql.ref(c)))} HAVING COUNT(*) > 1) d`);
        if (dupes > 0) { problems.push(`${table.name}: eindeutiger Index ${index.name} nicht moeglich, ${dupes} doppelte Werte vorhanden`); continue; }
      }
      steps.push({ phase: 4, sql: indexSql(table.name, index), label: `Index ${table.name}.${index.name} angelegt` });
    }
  }

  // Fremdschluessel zuletzt, wenn alle Tabellen und Spalten existieren.
  for (const table of TABLES) {
    const actual = state.foreignKeys.get(table.name) ?? [];
    for (const fk of table.foreignKeys ?? []) {
      if (actual.some(a => sameColumns(a.columns, fk.columns) && a.references === fk.references && sameColumns(a.referencedColumns, fk.referencedColumns))) continue;
      // Planning runs before any DDL: an existing table can still lack a newly introduced
      // FK column (e.g. ticket_work_timers.todo_id). Probe only columns in the loaded schema.
      // ADD CONSTRAINT remains in phase 5, after CREATE/ADD COLUMN, and MariaDB validates it.
      const canProbeExistingRows = state.tables.has(table.name) && state.tables.has(fk.references)
        && fk.columns.every(column => state.columns.get(table.name)?.has(column))
        && fk.referencedColumns.every(column => state.columns.get(fk.references)?.has(column));
      if (canProbeExistingRows) {
        const orphans = await countRows(db, sql`SELECT COUNT(*) AS n FROM ${sql.table(table.name)} c
          LEFT JOIN ${sql.table(fk.references)} p ON ${sql.join(fk.columns.map((col, i) => sql`c.${sql.ref(col)} = p.${sql.ref(fk.referencedColumns[i]!)}`), sql` AND `)}
          WHERE ${sql.join(fk.columns.map(col => sql`c.${sql.ref(col)} IS NOT NULL`), sql` AND `)} AND p.${sql.ref(fk.referencedColumns[0]!)} IS NULL`);
        if (orphans > 0) {
          warnings.push(`Fremdschluessel ${table.name}(${fk.columns.join(', ')}) -> ${fk.references} nicht angelegt: ${orphans} Zeilen verweisen ins Leere. Die Zeilen bleiben unveraendert.`);
          continue;
        }
      }
      steps.push({ phase: 5, sql: foreignKeySql(table.name, fk), label: `Fremdschluessel ${foreignKeyName(table.name, fk)} angelegt` });
    }
  }

  for (const obsolete of OBSOLETE_TABLES) {
    if (state.tables.has(obsolete)) steps.push({ phase: 7, sql: `DROP TABLE IF EXISTS ${ident(obsolete)}`, label: `Verwaltungstabelle ${obsolete} frueherer Versionen entfernt` });
  }

  if (problems.length) throw new SchemaDriftError(problems);
  return { steps: steps.sort((a, b) => a.phase - b.phase), warnings };
}

function indexSql(table: string, index: IndexDefinition): string {
  return `ALTER TABLE ${ident(table)} ADD ${index.unique ? 'UNIQUE ' : ''}INDEX ${ident(index.name)} (${list(index.columns)})`;
}

// GET_LOCK gilt je Verbindung -- der ganze Abgleich laeuft deshalb auf einer festen Verbindung.
export async function syncSchema(pool: Kysely<any>, log: (line: string) => void = () => {}): Promise<SchemaSyncReport> {
  return pool.connection().execute(db => syncOnConnection(db, log));
}

async function syncOnConnection(db: Kysely<any>, log: (line: string) => void): Promise<SchemaSyncReport> {
  const lock = await rows<{ ok: number | null }>(db, sql`SELECT GET_LOCK('ticket_system_schema_sync', 120) AS ok`);
  if (Number(lock[0]?.ok) !== 1) throw new Error('Ein anderer Schema-Abgleich laeuft bereits.');
  try {
    const { steps, warnings } = await planSchemaSync(db);
    const actions: string[] = [];
    for (const step of steps) {
      await sql.raw(step.sql).execute(db);
      actions.push(step.label);
      log(step.label);
    }
    for (const seed of SEED_ROWS) {
      const keys = Object.keys(seed.values);
      const result = await sql`INSERT IGNORE INTO ${sql.table(seed.table)} (${sql.join(keys.map(k => sql.ref(k)))}) VALUES (${sql.join(keys.map(k => seed.values[k]))})`.execute(db);
      if (Number(result.numAffectedRows ?? 0) > 0) { actions.push(`Grunddaten in ${seed.table} angelegt`); log(`Grunddaten in ${seed.table} angelegt`); }
    }
    await sql`INSERT INTO schema_state (id, fingerprint) VALUES (1, ${SCHEMA_FINGERPRINT})
      ON DUPLICATE KEY UPDATE fingerprint = VALUES(fingerprint), applied_at = CURRENT_TIMESTAMP`.execute(db);
    for (const warning of warnings) log(`Hinweis: ${warning}`);
    return { fingerprint: SCHEMA_FINGERPRINT, actions, warnings };
  } finally {
    await sql`SELECT RELEASE_LOCK('ticket_system_schema_sync')`.execute(db);
  }
}

// Fuer App-Start, Systeminfo und Backups: auf welchem Schemastand ist die Datenbank?
export async function appliedSchemaFingerprint(db: Kysely<any>): Promise<string | null> {
  try {
    return (await rows<{ fingerprint: string }>(db, sql`SELECT fingerprint FROM schema_state WHERE id = 1`))[0]?.fingerprint ?? null;
  } catch {
    return null;
  }
}
