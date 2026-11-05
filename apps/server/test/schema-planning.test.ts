import { describe, expect, it } from 'vitest';
import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, type DatabaseConnection } from 'kysely';
import { TABLES } from '../src/db/schema.js';
import { planSchemaSync } from '../src/db/schemaSync.js';

// Execute the real planner against an information_schema snapshot. No DDL/database is used.
function fixture({ fresh = false, todoColumn = false, orphanCount = 0, parentId = true } = {}) {
  const existing = fresh ? [] : TABLES.filter(table => ['ticket_work_timers', 'admin_todos'].includes(table.name));
  const columns = existing.flatMap(table => table.columns
    .filter(([name]) => !(table.name === 'ticket_work_timers' && name === 'todo_id' && !todoColumn)
      && !(table.name === 'admin_todos' && name === 'id' && !parentId))
    .map(([name, definition]) => ({ t: table.name, c: name,
      type: /^[a-z]+(?:\([^)]*\))?(?: unsigned)?/i.exec(definition)![0],
      nullable: /NOT NULL/i.test(definition) ? 'NO' : 'YES',
      def: /DEFAULT/i.test(definition) ? 'NULL' : null, extra: '' })));
  const indexes = existing.flatMap(table => (table.indexes || []).flatMap(index => index.columns.map(c => ({
    t: table.name, name: index.name, nonUnique: index.unique ? 0 : 1, c
  }))));
  const foreignKeys = existing.flatMap(table => (table.foreignKeys || [])
    .filter(fk => !(table.name === 'ticket_work_timers' && fk.columns.includes('todo_id')))
    .flatMap((fk, i) => fk.columns.map((c, n) => ({ t: table.name, name: `existing_${i}`, c, rt: fk.references, rc: fk.referencedColumns[n] }))));
  const queries: string[] = [];
  class SnapshotDriver extends DummyDriver {
    async acquireConnection(): Promise<DatabaseConnection> {
      return {
        async executeQuery(query: any): Promise<any> {
          queries.push(query.sql);
          if (query.sql.includes('information_schema.TABLES')) return { rows: existing.map(table => ({ name: table.name })) };
          if (query.sql.includes('information_schema.COLUMNS')) return { rows: columns };
          if (query.sql.includes('information_schema.STATISTICS')) return { rows: indexes };
          if (query.sql.includes('information_schema.KEY_COLUMN_USAGE')) return { rows: foreignKeys };
          if (/SELECT COUNT\(\*\)/.test(query.sql)) {
            if (query.sql.includes('c.`todo_id`') && (!todoColumn || !parentId)) throw new Error('Unknown column in pre-DDL probe');
            return { rows: [{ n: orphanCount }] };
          }
          throw new Error(`Unexpected planner query: ${query.sql}`);
        },
        async *streamQuery(): AsyncIterableIterator<any> { throw new Error('Not used'); }
      };
    }
  }
  const db = new Kysely<any>({ dialect: {
    createAdapter: () => new MysqlAdapter(), createDriver: () => new SnapshotDriver(),
    createIntrospector: db => new MysqlIntrospector(db), createQueryCompiler: () => new MysqlQueryCompiler()
  } });
  return { db, queries };
}

describe('foreign key planning before column creation', () => {
  it('plans a missing Todo column before its FK without querying the absent column', async () => {
    const f = fixture();
    try {
      const plan = await planSchemaSync(f.db);
      const column = plan.steps.findIndex(step => step.sql.includes('ADD COLUMN `todo_id`'));
      const fk = plan.steps.findIndex(step => step.sql.includes('fk_ticket_work_timers_todo_id'));
      expect(column).toBeGreaterThanOrEqual(0); expect(fk).toBeGreaterThan(column);
      expect(f.queries.some(query => query.includes('c.`todo_id`'))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it('does not pre-query a referenced column that is also still being added', async () => {
    const f = fixture({ todoColumn: true, parentId: false });
    try {
      const plan = await planSchemaSync(f.db);
      expect(plan.steps.some(step => step.sql.includes('fk_ticket_work_timers_todo_id'))).toBe(true);
      expect(f.queries.some(query => query.includes('c.`todo_id`'))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it('still probes existing columns and preserves orphaned rows by omitting their FK', async () => {
    const f = fixture({ todoColumn: true, orphanCount: 2 });
    try {
      const plan = await planSchemaSync(f.db);
      expect(f.queries.some(query => query.includes('c.`todo_id`'))).toBe(true);
      expect(plan.warnings.some(warning => warning.includes('2 Zeilen verweisen ins Leere'))).toBe(true);
      expect(plan.steps.some(step => step.sql.includes('fk_ticket_work_timers_todo_id'))).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it('adds the FK when existing columns have no orphaned values', async () => {
    const f = fixture({ todoColumn: true });
    try {
      const plan = await planSchemaSync(f.db);
      expect(f.queries.some(query => query.includes('c.`todo_id`'))).toBe(true);
      expect(plan.steps.some(step => step.sql.includes('fk_ticket_work_timers_todo_id'))).toBe(true);
    } finally { await f.db.destroy(); }
  });
  it('keeps new-installation CREATE steps before foreign keys without querying nonexistent tables', async () => {
    const f = fixture({ fresh: true });
    try {
      const plan = await planSchemaSync(f.db);
      const create = plan.steps.findIndex(step => step.sql.includes('CREATE TABLE IF NOT EXISTS `ticket_work_timers`'));
      const fk = plan.steps.findIndex(step => step.sql.includes('fk_ticket_work_timers_todo_id'));
      expect(create).toBeGreaterThanOrEqual(0); expect(fk).toBeGreaterThan(create);
      expect(f.queries.some(query => query.includes('SELECT COUNT(*)'))).toBe(false);
    } finally { await f.db.destroy(); }
  });
});
