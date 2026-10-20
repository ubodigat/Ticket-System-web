/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import { verifyAndConsumeTotp } from '../../domain/totp.js';
import { ensureDek } from '../../crypto/dekService.js';
import { fieldCipher } from '../../crypto/fieldCrypto.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';

export interface UpdateRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

// Auf Wunsch gehärtet statt entfernt: die In-App-Update-Funktion bleibt bestehen (kein
// Host-systemd-Umbau, siehe CHANGES.md N3), bekommt aber mehrere unabhängige
// Verteidigungsschichten zusätzlich zu "nur Superadmin":
// 1. Step-up (aktuelles Passwort + TOTP-Code bei aktiver 2FA) direkt vor jeder Aktion, die Code
//    ausführt (/run, /migrate, /rollback) -- eine gekaperte Session/ein offen gelassener Browser
//    reicht dann allein nicht mehr.
// 2. Commit-Pinning ("Prüfsumme"): /run verlangt den exakten, zuvor in der Oberfläche
//    angezeigten Ziel-Commit-Hash und lehnt ab, wenn GitHub zwischenzeitlich einen anderen
//    Commit liefert (verhindert ein stillschweigend untergeschobenes Ziel zwischen Ansehen und
//    Bestätigen).
// 2.1. Zusätzlich optional: UPDATE_REQUIRE_SIGNED_COMMITS verlangt eine gültige GPG-Signatur auf
//    dem Ziel-Commit (siehe updater-server.mjs).
// 3. HMAC-signierte, zeitlich begrenzte Anfragen an den Updater-Dienst (statt nur des nackten
//    Bearer-Tokens) -- ein Mitschnitt des internen Docker-Netzwerkverkehrs lässt sich dadurch
//    nicht wiederholen (Replay-Schutz über Zeitstempel + Einmal-Nonce).
// 4. Jede Aktion landet mit Akteur, Zeitpunkt und Ziel-Commit im globalen Audit-Log.
// 5. Rollback-Fähigkeit: der Updater merkt sich den Commit vor jedem erfolgreichen Update und
//    kann gezielt (wieder mit Commit-Pinning + Step-up) dorthin zurückgesetzt werden.

const HMAC_FRESHNESS_MS = 30_000;

function signUpdaterRequest(token: string, method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', token).update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}`).digest('hex');
  return { timestamp, nonce, signature };
}

async function callUpdater(
  env: Env,
  path: '/status' | '/run' | '/migrate' | '/rollback',
  method: 'GET' | 'POST',
  bodyObj?: Record<string, unknown>
) {
  if (!env.UPDATE_SERVICE_URL || !env.UPDATE_TOKEN) {
    return { ok: false, status: method === 'GET' ? 200 : 503, payload: { enabled: false, error: 'update_service_not_configured' } };
  }
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const { timestamp, nonce, signature } = signUpdaterRequest(env.UPDATE_TOKEN, method, path, body);
  try {
    const res = await fetch(`${env.UPDATE_SERVICE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.UPDATE_TOKEN}`,
        'content-type': 'application/json',
        'x-update-timestamp': timestamp,
        'x-update-nonce': nonce,
        'x-update-signature': signature
      },
      ...(body ? { body } : {}),
      // /migrate darf laenger dauern (Migrationen koennen Schema-Aenderungen auf grossen
      // Tabellen enthalten), daher ein eigenes, grosszuegigeres Zeitlimit statt der 25s fuer
      // Status/Run/Rollback.
      signal: AbortSignal.timeout(path === '/migrate' ? 130000 : 25000)
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, payload };
  } catch {
    return { ok: false, status: 503, payload: { error: 'update_service_unreachable' } };
  }
}

const stepUpSchema = z.object({
  password: z.string().min(1),
  totp_code: z.string().trim().length(6).optional()
});

// Wirft { statusCode, message } bei fehlgeschlagenem Step-up -- vom Aufrufer per routeError
// behandelt, gleiche Fehlerform wie überall sonst im Projekt.
async function requireStepUp(app: FastifyInstance, deps: UpdateRouteDeps, req: FastifyRequest, uid: string): Promise<void> {
  const parsed = stepUpSchema.safeParse(req.body);
  if (!parsed.success) throw { statusCode: 401, message: 'step_up_required' };

  const user = await app.db.selectFrom('users')
    .select(['password_hash', 'totp_enabled', 'totp_secret_enc'])
    .where('id', '=', uid).executeTakeFirstOrThrow();

  const passwordOk = await argon2.verify(user.password_hash, parsed.data.password).catch(() => false);
  if (!passwordOk) throw { statusCode: 401, message: 'wrong_password' };

  if (user.totp_enabled) {
    if (!parsed.data.totp_code) throw { statusCode: 401, message: 'totp_code_required' };
    if (!user.totp_secret_enc) throw { statusCode: 401, message: 'totp_code_required' };
    const dek = await ensureDek(app.db, deps.keyProvider, 'users.totp_secret');
    const secret = fieldCipher.decryptField(user.totp_secret_enc, dek.rawDek, {
      installationId: deps.env.INSTALLATION_ID, schemaVersion: deps.env.SCHEMA_VERSION,
      tableName: 'users', recordId: uid, fieldName: 'totp_secret', keyVersion: dek.keyVersion
    });
    const totpOk = await verifyAndConsumeTotp(app.db, uid, secret, parsed.data.totp_code);
    if (!totpOk) throw { statusCode: 401, message: 'invalid_totp_code' };
  }
}

async function logUpdateAction(app: FastifyInstance, session: { uid: string; username: string }, action: string, detail: Record<string, unknown>): Promise<void> {
  await app.db.insertInto('global_audit_log').values({
    id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
    action, target_type: 'update', target_id: null, detail_json: JSON.stringify(detail)
  }).execute().catch(err => app.log.error({ err }, 'Update-Aktion konnte nicht geloggt werden'));
}

export function registerUpdateRoutes(app: FastifyInstance, deps: UpdateRouteDeps): void {
  app.get('/api/v2/update/status', async (req, reply) => {
    try {
      requireSuperadmin(req);
      const result = await callUpdater(deps.env, '/status', 'GET');
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  app.post('/api/v2/update/run', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);

      // Commit-Pinning: die Oberfläche muss den Commit-Hash mitschicken, den sie der Person
      // zuletzt angezeigt hat -- weicht der aktuelle Stand bei GitHub davon ab (z.B. weil
      // zwischenzeitlich ein neuer Commit gepusht wurde), wird NICHT blind der neueste Stand
      // genommen, sondern abgebrochen, damit niemand ungesehen einen anderen Commit bestätigt.
      const parsed = z.object({ expected_commit: z.string().regex(/^[0-9a-f]{40}$/) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'expected_commit_required' });

      const status = await callUpdater(deps.env, '/status', 'GET');
      const remoteCommit = (status.payload as { remoteCommit?: string } | undefined)?.remoteCommit;
      if (!remoteCommit || remoteCommit !== parsed.data.expected_commit) {
        await logUpdateAction(app, session, 'update.run_rejected_commit_mismatch', { expected: parsed.data.expected_commit, actual: remoteCommit ?? null });
        return reply.code(409).send({ error: 'commit_mismatch', expected: parsed.data.expected_commit, actual: remoteCommit ?? null });
      }

      const result = await callUpdater(deps.env, '/run', 'POST', { expected_commit: parsed.data.expected_commit });
      await logUpdateAction(app, session, 'update.run_triggered', { target_commit: parsed.data.expected_commit });
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Unabhaengig vom vollen Update-Zyklus: gleicht die Datenbank wieder mit dem bereits
  // laufenden Code ab, falls ein frueherer Update-Lauf vor dem Migrations-Schritt abgebrochen
  // ist. Genau dieser Zustand aeusserte sich zuletzt als generischer 500er auf vielen,
  // scheinbar unzusammenhaengenden Routen (Systemeinstellungen speichern, Chat, Ticket-Status).
  app.post('/api/v2/update/migrate', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);
      const result = await callUpdater(deps.env, '/migrate', 'POST');
      await logUpdateAction(app, session, 'update.migrate_triggered', {});
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Rollback: setzt gezielt auf den Commit zurueck, der vor dem letzten erfolgreichen Update
  // aktiv war (vom Updater selbst in .git/ticket-system-update-history.json gefuehrt, siehe
  // updater-server.mjs) -- ebenfalls mit Commit-Pinning + Step-up, da das genauso folgenreich
  // ist wie ein Update selbst.
  app.post('/api/v2/update/rollback', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);
      const parsed = z.object({ expected_commit: z.string().regex(/^[0-9a-f]{40}$/) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'expected_commit_required' });

      const result = await callUpdater(deps.env, '/rollback', 'POST', { expected_commit: parsed.data.expected_commit });
      await logUpdateAction(app, session, 'update.rollback_triggered', { target_commit: parsed.data.expected_commit });
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      return routeError(app, reply, error);
    }
  });
}
