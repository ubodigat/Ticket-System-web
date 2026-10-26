import type { FastifyInstance } from 'fastify';
import type { UsersRouteDeps } from './users.js';
import { requireSession } from './session.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import { preferencePatchSchema, mergePreferences } from '../../domain/personalPreferences.js';
import { routeError } from './routeError.js';

export function registerPreferenceRoutes(app: FastifyInstance, deps: UsersRouteDeps) {
  async function cipher(userId: string) {
    const dek = await ensureDek(app.db, deps.keyProvider, 'users.preferences');
    const context = { installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'user_preferences', recordId: userId, fieldName: 'value', keyVersion: dek.keyVersion };
    return {
      read: (value: Buffer) => JSON.parse(fieldCipher.decryptField(value, dek.rawDek, context)),
      write: (value: unknown) => fieldCipher.encryptField(JSON.stringify(value), dek.rawDek, context)
    };
  }
  app.get('/api/v2/users/me/preferences', async (req, reply) => {
    try {
      const { uid } = requireSession(req);
      const row = await app.db.selectFrom('user_preferences').select('value_enc').where('user_id', '=', uid).executeTakeFirst();
      reply.header('Cache-Control', 'no-store');
      return { preferences: row ? (await cipher(uid)).read(row.value_enc) : {} };
    } catch (error) { return routeError(app, reply, error); }
  });
  app.patch('/api/v2/users/me/preferences', { bodyLimit: 5_700_000 }, async (req, reply) => {
    try {
      const { uid } = requireSession(req);
      const parsed = preferencePatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_preferences' });
      const crypt = await cipher(uid);
      const preferences = await app.db.transaction().execute(async trx => {
        // Lock the parent, including the first save, to serialize concurrent partial updates.
        await trx.selectFrom('users').select('id').where('id', '=', uid).forUpdate().executeTakeFirstOrThrow();
        const row = await trx.selectFrom('user_preferences').select('value_enc').where('user_id', '=', uid).executeTakeFirst();
        const merged = mergePreferences(row ? crypt.read(row.value_enc) : {}, parsed.data);
        if (!preferencePatchSchema.safeParse(merged).success) throw { statusCode: 400, message: 'preferences_limit_exceeded' };
        const value = { user_id: uid, value_enc: crypt.write(merged) };
        await trx.insertInto('user_preferences').values(value).onDuplicateKeyUpdate({ value_enc: value.value_enc }).execute();
        return merged;
      });
      reply.header('Cache-Control', 'no-store');
      return { success: true };
    } catch (error) { return routeError(app, reply, error); }
  });
}
