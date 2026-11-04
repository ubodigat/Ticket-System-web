import Fastify from 'fastify';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUpdateRoutes } from '../src/http/routes/update.js';
import type { Env } from '../src/config/env.js';

// Step-up (siehe stepUp.ts) prueft das Passwort echt per argon2 -- fuer die Tests reicht ein Mock,
// der "correct-password" als gueltig behandelt.
vi.mock('argon2', () => ({ verify: async (_hash: string, password: string) => password === 'correct-password' }));

const commit = 'a'.repeat(40);
const other = 'b'.repeat(40);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function buildDb() {
  const auditLogRows: any[] = [];
  const db: any = {
    selectFrom: () => {
      const chain: any = {
        select: () => chain, where: () => chain, forUpdate: () => chain,
        executeTakeFirst: async () => undefined,
        executeTakeFirstOrThrow: async () => ({ password_hash: 'irrelevant', totp_enabled: false, totp_secret_enc: null })
      };
      return chain;
    },
    insertInto: (table: string) => ({ values: (value: unknown) => ({ execute: async () => { if (table === 'global_audit_log') auditLogRows.push(value); } }) }),
    updateTable: () => { const update: any = { set: () => update, where: () => update, execute: async () => [] }; return update; },
    transaction: () => ({ execute: (callback: any) => callback(db) })
  };
  return { db, auditLogRows };
}

// Simuliert den Host-Dienst (ops/host-updater): beantwortet Anfragen aus requests/ in state/.
async function fakeHost(options: { remote?: string; accept?: string; silent?: boolean; signingKeys?: 0 | 1; extra?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'update-bridge-'));
  await mkdir(join(dir, 'requests')); await mkdir(join(dir, 'state'));
  await writeFile(join(dir, 'state', 'agent.env'), 'enabled=1\n');
  const handled: string[] = [];
  const timer = setInterval(async () => {
    if (options.silent) return;
    for (const name of (await readdir(join(dir, 'requests'))).filter(file => file.endsWith('.req'))) {
      const line = (await readFile(join(dir, 'requests', name), 'utf8')).trim();
      await rm(join(dir, 'requests', name));
      handled.push(line);
      const [action, nonce] = line.split(' ');
      if (action === 'status') {
        await writeFile(join(dir, 'state', 'status.env'), `nonce=${nonce}\nenabled=1\nsigningKeys=${options.signingKeys ?? 1}\nbranch=main\nlocalCommit=${other}\nremoteCommit=${options.remote ?? commit}\ncommitsBehind=1\n${options.extra ?? ''}`);
      } else {
        await writeFile(join(dir, 'state', 'accepted.env'), `nonce=${nonce}\nresult=${options.accept ?? 'started'}\n`);
        await writeFile(join(dir, 'state', 'job.env'), `nonce=${nonce}\naction=${action}\nrunning=0\nok=1\nfailed=0\nstep=done\n`);
      }
    }
  }, 20);
  cleanups.push(async () => { clearInterval(timer); await rm(dir, { recursive: true, force: true }); });
  return { dir, handled };
}

async function request(dir: string | undefined, role: 'user' | 'superadmin', method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>) {
  const app = Fastify();
  const { db, auditLogRows } = buildDb();
  app.decorate('db', db);
  app.addHook('onRequest', async req => { req.ticketSession = { uid: 'test-user', username: 'test', role }; });
  registerUpdateRoutes(app, { env: { INSTALLATION_ID: 'test', UPDATE_BRIDGE_DIR: dir } as Env, keyProvider: {} as any });
  try {
    return { response: await app.inject({ method, url: `/api/v2/update/${path}`, payload }), auditLogRows };
  } finally {
    await app.close();
  }
}

describe('update routes (host updater bridge, Security-Audit N-3)', () => {
  const stepUp = { password: 'correct-password' };

  it('reports a missing host updater without failing', async () => {
    const { response } = await request(undefined, 'superadmin', 'GET', 'status');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false, error: 'update_service_not_configured' });
    const run = await request(undefined, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(run.response.statusCode).toBe(409);
  });

  it('rejects ordinary users before writing any request', async () => {
    const host = await fakeHost();
    expect((await request(host.dir, 'user', 'GET', 'status')).response.statusCode).toBe(403);
    expect((await request(host.dir, 'user', 'POST', 'run', { ...stepUp, expected_commit: commit })).response.statusCode).toBe(403);
    expect(host.handled).toEqual([]);
  });

  it('reads the status the host wrote for exactly this request', async () => {
    const host = await fakeHost();
    const { response } = await request(host.dir, 'superadmin', 'GET', 'status');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, remoteCommit: commit, localCommit: other, updateAvailable: true, commitsBehind: 1 });
    expect(host.handled[0]).toMatch(/^status [0-9a-f]{32} -$/);
  });

  it('warns while a recovery kit is still on the server, also before updates are unlocked', async () => {
    const withKit = await fakeHost({ extra: 'recoveryKits=2\n' });
    expect((await request(withKit.dir, 'superadmin', 'GET', 'status')).response.json()).toMatchObject({ enabled: true, recoveryKits: 2 });
    const locked = await fakeHost({ signingKeys: 0, extra: 'recoveryKits=1\n' });
    expect((await request(locked.dir, 'superadmin', 'GET', 'status')).response.json()).toMatchObject({ error: 'update_signature_not_configured', recoveryKits: 1 });
    const clean = await fakeHost({ extra: 'recoveryKits=garbage\n' });
    expect((await request(clean.dir, 'superadmin', 'GET', 'status')).response.json()).toMatchObject({ recoveryKits: 0 });
  });

  it('requires the step-up password before anything reaches the host', async () => {
    const host = await fakeHost();
    const { response } = await request(host.dir, 'superadmin', 'POST', 'run', { password: 'wrong', expected_commit: commit });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('wrong_password');
    expect(host.handled).toEqual([]);
  });

  it('pins the confirmed commit and only then asks the host to update', async () => {
    const moved = await fakeHost({ remote: other });
    const mismatch = await request(moved.dir, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(mismatch.response.statusCode).toBe(409);
    expect(mismatch.response.json().error).toBe('commit_mismatch');
    expect(moved.handled.some(line => line.startsWith('run '))).toBe(false);

    const host = await fakeHost();
    const run = await request(host.dir, 'superadmin', 'POST', 'run', { ...stepUp, expected_commit: commit });
    expect(run.response.statusCode).toBe(202);
    expect(host.handled.find(line => line.startsWith('run '))).toMatch(new RegExp(`^run [0-9a-f]{32} ${commit}$`));
    expect(run.auditLogRows.map(row => row.action)).toContain('update.run_triggered');
  });

  it('passes on a refusal of the host', async () => {
    const busy = await fakeHost({ accept: 'update_already_running' });
    expect((await request(busy.dir, 'superadmin', 'POST', 'rollback', { ...stepUp, expected_commit: commit })).response.json().error).toBe('update_already_running');
    expect((await request(busy.dir, 'superadmin', 'POST', 'rollback', stepUp)).response.statusCode).toBe(400);
  }, 20_000);
});
