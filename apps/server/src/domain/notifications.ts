import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import { isAccountExpired } from './accountValidity.js';
import { queueUserMail, resolveNotificationPrefs } from '../mail/queue.js';

export interface NotifyDeps { db: Kysely<Database>; env: Env; keyProvider: KeyProvider }
export interface NotifyParams {
  recipientUserId: string | null;
  type: string;
  message: string;
  ticketId?: string | null | undefined;
  ticketNumber?: string | null | undefined;
  actorUserId?: string | null | undefined;
}

// Einzige Stelle, an der In-App-Benachrichtigungen entstehen: niemand benachrichtigt sich selbst,
// gesperrte/archivierte/abgelaufene Konten bekommen nichts, und App- wie E-Mail-Kanal folgen
// derselben Richtlinie + persoenlichen Einstellung (resolveNotificationPrefs).
export async function notifyUser(deps: NotifyDeps, params: NotifyParams, log?: FastifyBaseLogger): Promise<void> {
  if (!params.recipientUserId || params.recipientUserId === params.actorUserId) return;
  const recipient = await deps.db.selectFrom('users')
    .select(['id', 'username', 'role', 'account_archived', 'locked_permanent', 'account_valid_until', 'notif_prefs_json'])
    .where('id', '=', params.recipientUserId).executeTakeFirst();
  if (!recipient || recipient.account_archived || recipient.locked_permanent || isAccountExpired(recipient.account_valid_until)) return;
  const prefs = await resolveNotificationPrefs(deps.db, recipient, params.type);
  if (prefs.app) {
    const id = randomUUID();
    const dek = await ensureDek(deps.db, deps.keyProvider, 'notifications.message');
    const message = fieldCipher.encryptField(params.message, dek.rawDek, {
      installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'notifications', recordId: id, fieldName: 'message', keyVersion: dek.keyVersion
    });
    await deps.db.insertInto('notifications').values({
      id, recipient_user_id: recipient.id, recipient_username: recipient.username, type: params.type,
      ticket_id: params.ticketId ?? null, ticket_number: params.ticketNumber ?? null, message, is_read: false
    }).execute();
  }
  if (prefs.email) {
    // Best-effort (Security-Audit R-15): ein Fehler beim Einreihen darf den ausloesenden Vorgang nie scheitern lassen.
    try {
      await queueUserMail(deps, recipient.id, params.ticketNumber ? `Ticket ${params.ticketNumber}` : 'Benachrichtigung', params.message, params.type);
    } catch (err) {
      log?.error({ err, recipientUserId: recipient.id }, 'Mail konnte nicht eingereiht werden');
    }
  }
}
