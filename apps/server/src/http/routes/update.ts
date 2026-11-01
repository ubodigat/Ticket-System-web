/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { requireSuperadmin } from './session.js';
import { routeError } from './routeError.js';
import { requireStepUp } from './stepUp.js';
import type { Env } from '../../config/env.js';
import type { KeyProvider } from '../../crypto/keyProvider.js';

export interface UpdateRouteDeps {
  env: Env;
  keyProvider: KeyProvider;
}

// Security-Audit N-3: Updates laufen nicht mehr in einem Container mit Docker-Socket (Host-Root),
// sondern im Host-Dienst ops/host-updater (systemd). Die App legt nur noch eng begrenzte Anfragen
// in einem Austauschverzeichnis ab und liest Statusdateien zurueck:
//   <UPDATE_BRIDGE_DIR>/requests/*.req   eine Zeile "<aktion> <nonce> <commit|->"
//   <UPDATE_BRIDGE_DIR>/state/*.env      key=value-Dateien des Host-Dienstes (nur lesbar)
// Weitere Schutzschichten wie bisher: nur Superadmin, Step-up (Passwort + TOTP) vor jeder Aktion,
// Commit-Pinning (der zuvor angezeigte Ziel-Commit muss exakt passen), Signaturpruefung des
// Ziel-Commits bzw. Release-Tags auf dem Host und ein Audit-Eintrag je Aktion.

type Action = 'status' | 'run' | 'migrate' | 'rollback';
interface UpdateStatus { enabled: boolean; error?: string; remoteCommit?: string | null; [key: string]: unknown }
const POLL_MS = 250;

function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

export function createUpdateBridge(dir: string | undefined) {
  const read = async (file: string) => {
    if (!dir) return null;
    try { return parseEnvFile(await readFile(join(dir, 'state', file), 'utf8')); } catch { return null; }
  };
  const request = async (action: Action, commit?: string) => {
    if (!dir) throw { statusCode: 503, message: 'update_service_not_configured' };
    const nonce = randomBytes(16).toString('hex');
    const name = `${Date.now()}-${nonce}`;
    const tmp = join(dir, 'requests', `.${name}.tmp`);
    try {
      await writeFile(tmp, `${action} ${nonce} ${commit ?? '-'}\n`, { mode: 0o600, flag: 'wx' });
      await rename(tmp, join(dir, 'requests', `${name}.req`));
    } catch {
      throw { statusCode: 503, message: 'update_service_unreachable' };
    }
    return nonce;
  };
  const waitFor = async (file: string, nonce: string, timeoutMs: number, done: (state: Record<string, string>) => boolean = () => true) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const state = await read(file);
      if (state?.nonce === nonce && done(state)) return state;
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    return null;
  };
  return { read, request, waitFor };
}

async function readJobLog(dir: string | undefined): Promise<string[]> {
  if (!dir) return [];
  try {
    return (await readFile(join(dir, 'state', 'job.log'), 'utf8')).split('\n').filter(Boolean).slice(-400);
  } catch {
    return [];
  }
}

function jobFrom(state: Record<string, string> | null, log: string[]) {
  if (!state) return null;
  return {
    action: state.action || null, running: state.running === '1', ok: state.ok === '1', failed: state.failed === '1',
    step: state.step || null, needsInstaller: state.needsInstaller === '1',
    startedAt: state.startedAt || null, finishedAt: state.finishedAt || null, log
  };
}

async function logUpdateAction(app: FastifyInstance, session: { uid: string; username: string }, action: string, detail: Record<string, unknown>): Promise<void> {
  await app.db.insertInto('global_audit_log').values({
    id: randomUUID(), actor_user_id: session.uid, actor_username: session.username,
    action, target_type: 'update', target_id: null, detail_json: JSON.stringify(detail)
  }).execute().catch(err => app.log.error({ err }, 'Update-Aktion konnte nicht geloggt werden'));
}

export function registerUpdateRoutes(app: FastifyInstance, deps: UpdateRouteDeps): void {
  const dir = deps.env.UPDATE_BRIDGE_DIR;
  const bridge = createUpdateBridge(dir);
  const agentConfigured = async () => (await bridge.read('agent.env'))?.enabled === '1';

  async function freshStatus(): Promise<UpdateStatus> {
    if (!await agentConfigured()) return { enabled: false, error: 'update_service_not_configured' };
    const nonce = await bridge.request('status');
    const state = await bridge.waitFor('status.env', nonce, 25_000);
    const job = jobFrom(await bridge.read('job.env'), await readJobLog(dir));
    if (!state) return { enabled: true, error: 'update_service_unreachable', job };
    const enabled = state.enabled === '1';
    if (enabled && state.signingKeys !== '1') return { enabled: false, error: 'update_signature_not_configured', job };
    const commit = (value: string | undefined) => (value && /^[0-9a-f]{40}$/.test(value) ? value : null);
    const localCommit = commit(state.localCommit);
    const remoteCommit = commit(state.remoteCommit);
    return {
      enabled, branch: state.branch || null, localCommit, remoteCommit,
      localSubject: state.localSubject || null, remoteSubject: state.remoteSubject || null,
      updateAvailable: !!localCommit && !!remoteCommit && localCommit !== remoteCommit,
      commitsBehind: Number(state.commitsBehind) || 0,
      rollbackAvailable: !!commit(state.rollbackCommit), rollbackCommit: commit(state.rollbackCommit),
      job, ...(state.error ? { error: state.error } : {})
    };
  }

  // Startet eine lange Aktion auf dem Host; wartet nur auf die Annahme, nicht auf das Ende.
  async function startJob(action: Exclude<Action, 'status'>, commit?: string) {
    if (!await agentConfigured()) throw { statusCode: 503, message: 'update_service_not_configured' };
    const nonce = await bridge.request(action, commit);
    const accepted = await bridge.waitFor('accepted.env', nonce, 15_000);
    if (!accepted) throw { statusCode: 503, message: 'update_service_unreachable' };
    if (accepted.result !== 'started') {
      throw { statusCode: accepted.result === 'update_already_running' ? 409 : accepted.result === 'update_runner_disabled' ? 403 : 409, message: accepted.result || 'update_failed' };
    }
    return nonce;
  }

  app.get('/api/v2/update/status', async (req, reply) => {
    try {
      requireSuperadmin(req);
      return reply.send(await freshStatus());
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  app.post('/api/v2/update/run', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);

      // Commit-Pinning: nur der Commit, den die Person zuletzt angezeigt bekommen und bestaetigt hat.
      const parsed = z.object({ expected_commit: z.string().regex(/^[0-9a-f]{40}$/) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'expected_commit_required' });

      const status = await freshStatus();
      if (status.error || !status.enabled) return reply.code(status.error === 'update_service_unreachable' ? 503 : 409).send(status);
      if (!status.remoteCommit || status.remoteCommit !== parsed.data.expected_commit) {
        await logUpdateAction(app, session, 'update.run_rejected_commit_mismatch', { expected: parsed.data.expected_commit, actual: status.remoteCommit ?? null });
        return reply.code(409).send({ error: 'commit_mismatch', expected: parsed.data.expected_commit, actual: status.remoteCommit ?? null });
      }
      await startJob('run', parsed.data.expected_commit);
      await logUpdateAction(app, session, 'update.run_triggered', { target_commit: parsed.data.expected_commit });
      return reply.code(202).send({ ok: true, job: jobFrom(await bridge.read('job.env'), []) });
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Gleicht die Datenbank mit dem laufenden Code ab (z.B. nach einem abgebrochenen Update).
  app.post('/api/v2/update/migrate', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);
      const nonce = await startJob('migrate');
      await logUpdateAction(app, session, 'update.migrate_triggered', {});
      const finished = await bridge.waitFor('job.env', nonce, 150_000, state => state.running === '0');
      const log = (await readJobLog(dir)).join('\n');
      if (!finished) return reply.code(202).send({ ok: false, running: true, log });
      return reply.code(finished.ok === '1' ? 200 : 500).send({ ok: finished.ok === '1', log });
    } catch (error) {
      return routeError(app, reply, error);
    }
  });

  // Rollback auf den Commit vor dem letzten erfolgreichen Update (Commit-Pinning + Step-up).
  app.post('/api/v2/update/rollback', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    try {
      const session = requireSuperadmin(req);
      await requireStepUp(app, deps, req, session.uid);
      const parsed = z.object({ expected_commit: z.string().regex(/^[0-9a-f]{40}$/) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'expected_commit_required' });
      await startJob('rollback', parsed.data.expected_commit);
      await logUpdateAction(app, session, 'update.rollback_triggered', { target_commit: parsed.data.expected_commit });
      return reply.code(202).send({ ok: true, job: jobFrom(await bridge.read('job.env'), []) });
    } catch (error) {
      return routeError(app, reply, error);
    }
  });
}
