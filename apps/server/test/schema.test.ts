import { describe, expect, it } from 'vitest';
import { TABLES } from '../src/db/schema.js';
import { isLosslessWidening } from '../src/db/schemaSync.js';
import { ENCRYPTED_COLUMNS } from '../src/crypto/rotation.js';
import { BACKUP_EXCLUDED_TABLES, backupFitsSchema } from '../src/http/routes/backup.js';

const tables = new Map(TABLES.map(table => [table.name, table]));
const columnsOf = (name: string) => new Set(tables.get(name)?.columns.map(([column]) => column) ?? []);

describe('Datenbankschema ohne Migrationen', () => {
  it('ist in sich stimmig: Schluessel, Indizes und Fremdschluessel verweisen auf vorhandene Spalten', () => {
    expect(new Set(TABLES.map(t => t.name)).size).toBe(TABLES.length);
    for (const table of TABLES) {
      const columns = columnsOf(table.name);
      expect(columns.size, table.name).toBe(table.columns.length);
      for (const column of table.primaryKey) expect(columns.has(column), `${table.name} PK ${column}`).toBe(true);
      for (const index of table.indexes ?? []) for (const column of index.columns) expect(columns.has(column), `${table.name}.${index.name}`).toBe(true);
      for (const fk of table.foreignKeys ?? []) {
        for (const column of fk.columns) expect(columns.has(column), `${table.name} FK ${column}`).toBe(true);
        for (const column of fk.referencedColumns) expect(columnsOf(fk.references).has(column), `${table.name} -> ${fk.references}.${column}`).toBe(true);
      }
    }
  });

  it('kennt jede verschluesselte Spalte des Rotationsverzeichnisses', () => {
    for (const column of ENCRYPTED_COLUMNS) {
      expect(columnsOf(column.table).has(column.column), `${column.table}.${column.column}`).toBe(true);
      for (const key of column.key ?? ['id']) expect(columnsOf(column.table).has(key), `${column.table} key ${key}`).toBe(true);
    }
  });

  it('erweitert Spalten nur verlustfrei', () => {
    expect(isLosslessWidening('varbinary(512)', 'varbinary(1024) NOT NULL')).toBe(true);
    expect(isLosslessWidening('varchar(64)', 'varchar(255) DEFAULT NULL')).toBe(true);
    expect(isLosslessWidening('varchar(64)', 'text')).toBe(true);
    expect(isLosslessWidening('varbinary(2048)', 'mediumblob DEFAULT NULL')).toBe(true);
    expect(isLosslessWidening('int(11)', 'bigint(20) NOT NULL')).toBe(true);
    expect(isLosslessWidening('blob', 'longblob')).toBe(true);
    expect(isLosslessWidening('varchar(255)', 'varchar(64)')).toBe(false);
    expect(isLosslessWidening('mediumblob', 'blob')).toBe(false);
    expect(isLosslessWidening('bigint(20)', 'int(11)')).toBe(false);
    expect(isLosslessWidening('varchar(32)', 'int(11)')).toBe(false);
    expect(isLosslessWidening('int(11)', 'int(11) unsigned')).toBe(false);
  });
});

describe('Wiederherstellung aelterer Sicherungen nach einem Update', () => {
  const live = new Map([
    ['users', { name: 'users', columns: ['id', 'name_enc', 'profile_enc'], primaryKey: ['id'], required: ['id', 'name_enc'] }],
    ['tickets', { name: 'tickets', columns: ['id', 'title'], primaryKey: ['id'], required: ['id', 'title'] }]
  ]);

  it('nimmt eine Sicherung ohne spaeter hinzugekommene Spalten/Tabellen an', () => {
    expect(backupFitsSchema([{ name: 'users', columns: ['id', 'name_enc'] }], live)).toBe(true);
  });

  it('lehnt Sicherungen ab, deren Daten nicht vollstaendig uebernommen werden koennten', () => {
    expect(backupFitsSchema([{ name: 'users', columns: ['id', 'name_enc', 'removed'] }], live)).toBe(false);
    expect(backupFitsSchema([{ name: 'gone', columns: ['id'] }], live)).toBe(false);
    expect(backupFitsSchema([{ name: 'tickets', columns: ['id'] }], live)).toBe(false);
    expect(backupFitsSchema([{ name: 'users', columns: ['id', 'name_enc'] }, { name: 'users', columns: ['id', 'name_enc'] }], live)).toBe(false);
  });

  it('sichert weder Schemastand noch Rotationsfortschritt', () => {
    expect(BACKUP_EXCLUDED_TABLES.has('schema_state')).toBe(true);
    expect(BACKUP_EXCLUDED_TABLES.has('crypto_jobs')).toBe(true);
  });
});
