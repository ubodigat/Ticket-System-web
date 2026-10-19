import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { mysqlTimestamp } from '../db/date.js';

export interface TodoDeps { env: Env; keyProvider: KeyProvider }
export function todoContext(deps: TodoDeps, tableName: string, fieldName: string, recordId: string, keyVersion: number) {
  return { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION, tableName, fieldName, recordId, keyVersion };
}

// Call within a transaction: the task, shared lists and notifications must commit together.
export async function insertAdminTodo(db: Kysely<Database>, deps: TodoDeps,
  actor: { uid: string; username: string }, data: { content: string; due_at?: string | null | undefined; recipient_ids: string[] }, strict = true) {
  const ids = [...new Set([actor.uid, ...data.recipient_ids])];
  const recipients = await db.selectFrom('users').select(['id', 'username']).where('id', 'in', ids)
    .where('role', 'in', ['admin', 'superadmin']).where('account_archived', '=', false).execute();
  if ((strict && recipients.length !== ids.length) || !recipients.some(r => r.id === actor.uid)) {
    throw { statusCode: 400, message: 'invalid_recipient' };
  }
  const id = randomUUID();
  const dek = await ensureDek(db, deps.keyProvider, 'admin_todos.content');
  await db.insertInto('admin_todos').values({ id, created_by_user_id: actor.uid, done: false,
    due_at: data.due_at ? mysqlTimestamp(new Date(data.due_at)) : null,
    content: fieldCipher.encryptField(data.content, dek.rawDek, todoContext(deps, 'admin_todos', 'content', id, dek.keyVersion)) }).execute();
  await db.insertInto('admin_todo_members').values(recipients.map(r => ({ todo_id: id, user_id: r.id, hidden: false }))).execute();
  const others = recipients.filter(r => r.id !== actor.uid);
  if (others.length) {
    const notificationDek = await ensureDek(db, deps.keyProvider, 'notifications.message');
    await db.insertInto('notifications').values(others.map(r => {
      const notificationId = randomUUID();
      return { id: notificationId, recipient_user_id: r.id, recipient_username: r.username,
        type: 'todo_assigned', ticket_id: null, ticket_number: null, is_read: false,
        message: fieldCipher.encryptField(`${actor.username} hat dir eine Aufgabe zugewiesen: ${data.content.slice(0, 1000)}`,
          notificationDek.rawDek, todoContext(deps, 'notifications', 'message', notificationId, notificationDek.keyVersion)) };
    })).execute();
  }
  return id;
}

export function advanceTodoDate(date: Date, unit: 'day' | 'week' | 'month', count: number): Date {
  const next = new Date(date);
  if (unit === 'month') {
    const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + count);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  } else next.setUTCDate(next.getUTCDate() + count * (unit === 'week' ? 7 : 1));
  return next;
}
