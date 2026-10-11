import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 3099);
const token = process.env.UPDATE_TOKEN || '';
const repoDir = process.env.REPO_DIR || '/workspace';
const branch = process.env.UPDATE_BRANCH || 'main';
const allowMainDeploy = process.env.UPDATE_ALLOW_MAIN_DEPLOY === 'true';
const composeFile = `${repoDir}/ops/docker/docker-compose.yml`;
const envFile = `${repoDir}/ops/docker/.env`;

let job = null;

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// Konstante Vergleichszeit statt "!==" -- ein String-Vergleich bricht beim ersten
// abweichenden Byte ab und liefert dadurch ueber das Docker-interne Netzwerk ein
// (schwaches, aber unnoetiges) Zeitsignal auf das Update-Token preis.
function safeTokenEquals(expected, provided) {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function auth(req, res) {
  const expected = `Bearer ${token}`;
  if (!token || !safeTokenEquals(expected, req.headers.authorization || '')) {
    json(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

// Ohne Zeitlimit konnte ein haengender "git fetch" (instabiles/langsames Internet zum GitHub-
// Host) GET /status unbegrenzt blockieren -- Caddy wartet nicht ewig auf die Antwort des
// App-Containers und gibt dann 502 Bad Gateway zurueck, obwohl der App-Container selbst laeuft.
// timeoutMs: 15s fuer /status-Abfragen (git fetch/rev-parse/rev-list), unbegrenzt fuer den
// eigentlichen Build/Deploy-Lauf (kann je nach Hardware mehrere Minuten dauern).
function run(command, args, options = {}) {
  const { timeoutMs = 0, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoDir, shell: false, ...spawnOptions });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve(timedOut ? { code: 1, out, err: `Zeitlimit (${timeoutMs}ms) ueberschritten` } : { code, out: out.trim(), err: err.trim() });
    });
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, out, err: String(error?.message || error) });
    });
  });
}

async function collectStatus() {
  const fetchResult = await run('git', ['fetch', 'origin', branch, '--quiet'], { timeoutMs: 15000 });
  if (fetchResult.code !== 0) {
    // Ohne erfolgreichen fetch wäre "origin/<branch>" ein veralteter, irreführender Stand --
    // lieber ehrlich "nicht erreichbar" melden als eine falsche Diff-Anzeige.
    return {
      branch, localCommit: null, remoteCommit: null, localSubject: null, remoteSubject: null,
      updateAvailable: false, commitsBehind: 0, job,
      error: 'github_unreachable', errorDetail: fetchResult.err || fetchResult.out
    };
  }
  const local = await run('git', ['rev-parse', 'HEAD']);
  const remote = await run('git', ['rev-parse', `origin/${branch}`]);
  const localSubject = await run('git', ['log', '-1', '--pretty=%s', 'HEAD']);
  const remoteSubject = await run('git', ['log', '-1', '--pretty=%s', `origin/${branch}`]);
  const behind = await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`]);
  return {
    branch,
    localCommit: local.out,
    remoteCommit: remote.out,
    localSubject: localSubject.out,
    remoteSubject: remoteSubject.out,
    updateAvailable: local.out && remote.out && local.out !== remote.out,
    commitsBehind: Number(behind.out || 0),
    job
  };
}

async function runUpdate() {
  // job.step bleibt bei einem Fehler auf dem Namen des zuletzt gestarteten Schritts stehen
  // (job.failed zeigt getrennt an, dass er fehlgeschlagen ist) -- vorher wurde step auf die
  // generische Zeichenkette "failed" ueberschrieben, wodurch das Frontend nicht mehr wusste,
  // bei welchem der fuenf Schritte es tatsaechlich hakte, und keinen sinnvollen Fortschritt
  // mehr anzeigen konnte.
  job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: false, failed: false, step: 'starting', log: [] };
  const step = async (label, command, args) => {
    job.step = label;
    job.log.push(`$ ${command} ${args.join(' ')}`);
    const result = await run(command, args);
    if (result.out) job.log.push(result.out);
    if (result.err) job.log.push(result.err);
    if (result.code !== 0) throw new Error(`${label} failed`);
  };

  try {
    await step('fetch', 'git', ['fetch', 'origin', branch]);
    // reset --hard statt pull --ff-only: diese Installation wird nie von Hand bearbeitet, daher
    // ist ein deterministisches "genau wie auf GitHub" wichtiger als divergierende lokale
    // Änderungen zu erhalten -- und es kann nicht an einem abgelehnten Fast-Forward scheitern.
    await step('reset', 'git', ['reset', '--hard', `origin/${branch}`]);
    await step('build', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'build', '--no-cache', 'app']);
    await step('restart', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'up', '-d', '--force-recreate', 'app']);
    await step('migrate', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'exec', '-T', 'app', 'node', 'dist/db/migrate.js']);
    job.ok = true;
    job.step = 'done';
  } catch (error) {
    job.ok = false;
    job.failed = true;
    job.log.push(String(error?.message || error));
  } finally {
    job.running = false;
    job.finishedAt = new Date().toISOString();
  }
}

// Container läuft als root, das gemountete Repo gehört dem Host-Benutzer -- ohne diese Zeile
// verweigert Git jede Operation mit "detected dubious ownership in repository at '/workspace'".
await run('git', ['config', '--global', '--add', 'safe.directory', repoDir]);

createServer(async (req, res) => {
  try {
    if (!auth(req, res)) return;
    if (req.method === 'GET' && req.url === '/status') return json(res, 200, await collectStatus());
    if (req.method === 'POST' && req.url === '/run') {
      if (!allowMainDeploy) return json(res, 403, { error: 'update_runner_disabled', message: 'Automatische Deployments von main sind deaktiviert. Aktiviere UPDATE_ALLOW_MAIN_DEPLOY=true nur bewusst und zeitlich begrenzt.' });
      if (job?.running) return json(res, 409, { error: 'update_already_running', job });
      runUpdate();
      return json(res, 202, { ok: true, job });
    }
    json(res, 404, { error: 'not_found' });
  } catch (error) {
    json(res, 500, { error: 'update_service_error', message: String(error?.message || error), job });
  }
}).listen(port, '0.0.0.0');
