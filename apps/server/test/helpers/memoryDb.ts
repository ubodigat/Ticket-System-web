// Route test double, not a replacement for the MariaDB migration/integration job.
export function memoryDb(tables: Record<string, any[]>) {
  const expression: any = (key: string, op: string, value: any) => (row: any) => {
    if (op === '=' || op === 'is') return row[key] === value;
    if (op === '<') return row[key] < value;
    if (op === '>') return row[key] > value;
    if (op === '>=') return row[key] >= value;
    if (op === '!=') return row[key] !== value;
    throw new Error('Unsupported test operator ' + op);
  };
  expression.or = (parts: any[]) => (row: any) => parts.some(part => part(row));
  expression.and = (parts: any[]) => (row: any) => parts.every(part => part(row));
  function query(table: string, operation: string) {
    tables[table] ||= []; const predicates: any[] = []; let values: any; let duplicate: any;
    const rows = () => tables[table]!.filter(row => predicates.every(predicate => predicate(row)));
    const execute = async () => {
      if (operation === 'select') return rows();
      if (operation === 'insert') {
        const previous = duplicate && tables[table]!.find(row => table === 'user_preferences' ? row.user_id === values.user_id : row.id === values.id);
        if (previous) Object.assign(previous, duplicate);
        else tables[table]!.push({ created_at: new Date(), ...values });
        return [{ numInsertedOrUpdatedRows: 1n }];
      }
      const selected = rows();
      if (operation === 'update') selected.forEach(row => Object.assign(row, values));
      if (operation === 'delete') tables[table] = tables[table]!.filter(row => !selected.includes(row));
      return [{ numUpdatedRows: BigInt(selected.length), numDeletedRows: BigInt(selected.length) }];
    };
    const chain: any = { select: () => chain, selectAll: () => chain, orderBy: () => chain, forUpdate: () => chain,
      where: (...args: any[]) => { predicates.push(typeof args[0] === 'function' ? args[0](expression) : expression(...args)); return chain; },
      values: (value: any) => { values = value; return chain; }, set: (value: any) => { values = value; return chain; },
      onDuplicateKeyUpdate: (value: any) => { duplicate = value; return chain; }, execute,
      executeTakeFirst: async () => (await execute())[0], executeTakeFirstOrThrow: async () => { const row = (await execute())[0]; if (!row) throw new Error('Row missing'); return row; } };
    return chain;
  }
  const db: any = { selectFrom: (table: string) => query(table, 'select'), insertInto: (table: string) => query(table, 'insert'),
    updateTable: (table: string) => query(table, 'update'), deleteFrom: (table: string) => query(table, 'delete') };
  let tail = Promise.resolve();
  db.transaction = () => ({ execute: (fn: any) => {
    const operation = tail.then(async () => {
      const snapshot = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.map(row => ({ ...row }))]));
      try { return await fn(db); } catch (error) { Object.keys(tables).forEach(key => delete tables[key]); Object.assign(tables, snapshot); throw error; }
    }); tail = operation.catch(() => {}); return operation;
  } });
  return db;
}
