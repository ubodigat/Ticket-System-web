import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { insertAdminTodo, advanceTodoDate, todoContext, type TodoDeps } from '../domain/adminTodos.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../db/date.js';

export async function runRecurringAdminTodos(deps: TodoDeps & { db: Kysely<Database> }, now = new Date()) {
  const rules = await deps.db.selectFrom('recurring_admin_todos').select('id').where('active', '=', true).where('next_run_at', '<=', now).execute();
  let created = 0;
  for (const candidate of rules) {
    await deps.db.transaction().execute(async trx => {
      const rule = await trx.selectFrom('recurring_admin_todos').selectAll().where('id', '=', candidate.id).forUpdate().executeTakeFirst();
      if (!rule || !rule.active || new Date(rule.next_run_at) > now) return;
      const actor = await trx.selectFrom('users').select(['id', 'username']).where('id', '=', rule.created_by_user_id)
        .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false).executeTakeFirst();
      if (!actor) { await trx.updateTable('recurring_admin_todos').set({ active: false }).where('id', '=', rule.id).execute(); return; }
      const dek = await ensureDek(trx, deps.keyProvider, 'recurring_admin_todos.content');
      const content = fieldCipher.decryptField(rule.content, dek.rawDek, todoContext(deps, 'recurring_admin_todos', 'content', rule.id, dek.keyVersion));
      await insertAdminTodo(trx, deps, { uid: actor.id, username: actor.username }, { content,
        due_at: rule.due_after_hours ? new Date(now.getTime() + rule.due_after_hours * 3600000).toISOString() : null,
        recipient_ids: JSON.parse(rule.recipient_ids_json) }, false);
      let next = advanceTodoDate(new Date(rule.next_run_at), rule.interval_unit, rule.interval_count);
      // After downtime, create one current task instead of flooding lists with missed instances.
      while (next <= now) next = advanceTodoDate(next, rule.interval_unit, rule.interval_count);
      await trx.updateTable('recurring_admin_todos').set({ next_run_at: mysqlTimestamp(next) }).where('id', '=', rule.id).execute();
      created++;
    });
  }
  return created;
}
