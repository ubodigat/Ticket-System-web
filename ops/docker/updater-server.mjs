import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 3099);
const token = process.env.UPDATE_TOKEN || '';
const repoDir = process.env.REPO_DIR || '/workspace';
const branch = process.env.UPDATE_BRANCH || 'main';
const allowMainDeploy = process.env.UPDATE_ALLOW_MAIN_DEPLOY === 'true';
// Security-Audit N3/R-Nachfolge: verlangt eine gueltige GPG-Signatur auf dem Ziel-Commit, bevor
// gemergt wird. Ohne dies koennte ein kompromittiertes GitHub-Konto (oder ein kompromittierter
// Push-Zugang) beliebigen Code einschleusen, den der Updater unbesehen auf jede aktualisierende
// Installation ausrollt. UPDATE_REQUIRE_SIGNED_COMMITS=true/false erzwingt das Verhalten explizit;
// ohne gesetzten Wert wird beim Start selbst geprueft, ob bereits ein oeffentlicher Schluessel
// importiert wurde (z.B. per gemountetem Keyring-Verzeichnis + "gpg --import") -- ist einer
// vorhanden, gilt die Pruefung automatisch als Pflicht (sicher by default, sobald ein Schluessel
// konfiguriert ist), sonst bleibt sie aus (Ruecksicht auf Installationen ohne Schluessel, die
// sonst nie mehr updaten koennten). Kein importierter Schluessel bedeutet IMMER, dass eine
// aktivierte Pruefung fehlschlaegt -- kein stiller Fallback auf "ungeprueft".
let requireSignedCommits = process.env.UPDATE_REQUIRE_SIGNED_COMMITS === 'true';
if (process.env.UPDATE_REQUIRE_SIGNED_COMMITS === undefined) {
  const keyCheck = await run('gpg', ['--list-keys', '--with-colons'], { timeoutMs: 10000 });
  requireSignedCommits = keyCheck.code === 0 && keyCheck.out.split('\n').some(line => line.startsWith('pub:'));
  if (requireSignedCommits) {
    console.log('UPDATE_REQUIRE_SIGNED_COMMITS nicht gesetzt, aber ein GPG-Schluessel ist importiert -- Signaturpruefung automatisch aktiviert.');
  }
}
const composeFile = `${repoDir}/ops/docker/docker-compose.yml`;
const envFile = `${repoDir}/ops/docker/.env`;

// Security-Audit N9/R-4: der laufende App-Container hat DB_USER/DB_PASSWORD (volle DDL-Rechte)
// nicht mehr in seiner staendigen Umgebung (siehe docker-compose.yml) -- fuer den kurzlebigen
// Migrations-Aufruf aus der EIGENEN Umgebung des Updater-Containers eingespielt. "-e KEY=VALUE"
// an "docker compose run" waere wieder ein Passwort als Kommandozeilenargument (R-4-Begruendung
// gilt hier genauso) -- stattdessen liest der gestartete Container die Werte selbst per stdin aus
// einer temporaeren Datei, genau wie beim DB-Dump in backup.sh.
async function runMigrate() {
  return run('docker', [
    'compose', '-f', composeFile, '--env-file', envFile, 'run', '--rm', '--no-deps', '-T', 'app', 'sh', '-c',
    'set -e; envf="$(mktemp)"; trap "rm -f \\"$envf\\"" EXIT; cat > "$envf"; set -a; . "$envf"; set +a; node dist/db/migrate.js'
  ], {
    timeoutMs: 120000,
    input: `DB_USER=${process.env.DB_USER || ''}\nDB_PASSWORD=${process.env.DB_PASSWORD || ''}\n`
  });
}
// Ausserhalb des Arbeitsverzeichnisses (innerhalb von .git statt im Working Tree), damit sie nie
// als "lokale Aenderung" in "git status --porcelain" auftaucht und dadurch faelschlich ein
// zukuenftiges Update blockiert.
const historyFile = `${repoDir}/.git/ticket-system-update-history.json`;

let job = null;
let lastStatus = null;
let statusRequest = null;
// Verhindert, dass eine mitgeschnittene, aber noch "frische" Anfrage (siehe HMAC_WINDOW_MS)
// kurz danach ein zweites Mal akzeptiert wird (Replay-Schutz). Einfache In-Memory-Menge reicht,
// da der Updater ein einzelner, nicht horizontal skalierter Prozess ist; alte Eintraege werden
// beim Pruefen periodisch verworfen.
const seenNonces = new Map();
const HMAC_WINDOW_MS = 30_000;

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

// Zusätzliche Verteidigungsschicht (Security-Audit, In-App-Update-Härtung statt Entfernung):
// ergänzt das nackte Bearer-Token um eine HMAC-SHA256-Signatur über Methode+Pfad+Zeitstempel+
// Einmal-Nonce+Body. Ein Mitschnitt des internen Docker-Netzwerkverkehrs (z.B. durch einen
// anderen kompromittierten Container im selben Netz) lässt sich dadurch nicht einfach wiederholen
// -- die Signatur ist an einen engen Zeitrahmen und eine einmal verwendbare Nonce gebunden.
function verifyHmac(req, bodyRaw, res) {
  const timestamp = Number(req.headers['x-update-timestamp']);
  const nonce = String(req.headers['x-update-nonce'] || '');
  const signature = String(req.headers['x-update-signature'] || '');
  if (!timestamp || !nonce || !signature) {
    json(res, 401, { error: 'signature_required' });
    return false;
  }
  if (Math.abs(Date.now() - timestamp) > HMAC_WINDOW_MS) {
    json(res, 401, { error: 'signature_expired' });
    return false;
  }
  const expectedSig = createHmac('sha256', token)
    .update(`${req.method}\n${new URL(req.url, 'http://x').pathname}\n${timestamp}\n${nonce}\n${bodyRaw}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(signature);
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    json(res, 401, { error: 'invalid_signature' });
    return false;
  }
  if (seenNonces.has(nonce)) {
    json(res, 401, { error: 'replayed_request' });
    return false;
  }
  seenNonces.set(nonce, timestamp);
  // Alte Nonces ausserhalb des Zeitfensters koennen ohnehin nie wieder gueltig signiert werden
  // -- regelmaessig aufraeumen, damit die Map nicht unbegrenzt waechst.
  if (seenNonces.size > 1000) {
    const cutoff = Date.now() - HMAC_WINDOW_MS * 2;
    for (const [n, t] of seenNonces) if (t < cutoff) seenNonces.delete(n);
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyFile, 'utf8'));
  } catch {
    return {};
  }
}

async function writeHistory(entry) {
  try {
    await writeFile(historyFile, JSON.stringify(entry, null, 2), 'utf8');
  } catch (err) {
    console.error('update-history write failed', err);
  }
}

// Ohne Zeitlimit konnte ein haengender "git fetch" (instabiles/langsames Internet zum GitHub-
// Host) GET /status unbegrenzt blockieren -- Caddy wartet nicht ewig auf die Antwort des
// App-Containers und gibt dann 502 Bad Gateway zurueck, obwohl der App-Container selbst laeuft.
// timeoutMs: 15s fuer /status-Abfragen (git fetch/rev-parse/rev-list), unbegrenzt fuer den
// eigentlichen Build/Deploy-Lauf (kann je nach Hardware mehrere Minuten dauern).
function run(command, args, options = {}) {
  const { timeoutMs = 0, input, ...spawnOptions } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoDir, shell: false, ...spawnOptions });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;
    if (typeof input === 'string') {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
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
  if (job?.running) return { ...lastStatus, enabled: allowMainDeploy, job };
  const fetchResult = await run('git', ['fetch', 'origin', branch, '--quiet'], { timeoutMs: 15000 });
  if (fetchResult.code !== 0) {
    // Ohne erfolgreichen fetch wäre "origin/<branch>" ein veralteter, irreführender Stand --
    // lieber ehrlich "nicht erreichbar" melden als eine falsche Diff-Anzeige.
    return {
      enabled: allowMainDeploy, branch, localCommit: null, remoteCommit: null, localSubject: null, remoteSubject: null,
      updateAvailable: false, commitsBehind: 0, job,
      error: 'github_unreachable', errorDetail: fetchResult.err || fetchResult.out
    };
  }
  const local = await run('git', ['rev-parse', 'HEAD']);
  const remote = await run('git', ['rev-parse', `origin/${branch}`]);
  const localSubject = await run('git', ['log', '-1', '--pretty=%s', 'HEAD']);
  const remoteSubject = await run('git', ['log', '-1', '--pretty=%s', `origin/${branch}`]);
  const behind = await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`]);
  const history = await readHistory();
  lastStatus = {
    enabled: allowMainDeploy,
    branch,
    localCommit: local.out,
    remoteCommit: remote.out,
    localSubject: localSubject.out,
    remoteSubject: remoteSubject.out,
    updateAvailable: local.out && remote.out && local.out !== remote.out,
    commitsBehind: Number(behind.out || 0),
    // Rollback-Ziel (siehe runRollback) -- nur gesetzt, solange seit dem letzten erfolgreichen
    // Update kein weiterer Rollback stattgefunden hat.
    rollbackAvailable: !!history.previousCommit,
    rollbackCommit: history.previousCommit || null,
    job
  };
  return lastStatus;
}

async function runUpdate(expectedCommit) {
  // job.step bleibt bei einem Fehler auf dem Namen des zuletzt gestarteten Schritts stehen
  // (job.failed zeigt getrennt an, dass er fehlgeschlagen ist) -- vorher wurde step auf die
  // generische Zeichenkette "failed" ueberschrieben, wodurch das Frontend nicht mehr wusste,
  // bei welchem der fuenf Schritte es tatsaechlich hakte, und keinen sinnvollen Fortschritt
  // mehr anzeigen konnte.
  job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: false, failed: false, step: 'starting', log: [] };
  const step = async (label, command, args) => {
    job.step = label;
    job.log.push(`$ ${command} ${args.join(' ')}`);
    const result = await run(command, args, { timeoutMs: command === 'git' ? 15000 : 1800000 });
    if (result.out) job.log.push(result.out);
    if (result.err) job.log.push(result.err);
    if (result.code !== 0) throw new Error(`${label} failed`);
  };
  // Eigene Variante fuer runMigrate() (DB-Zugangsdaten per stdin statt -e, siehe oben) statt
  // direkt "run('docker', [...])" wie bei den anderen Schritten.
  const stepResult = async (label, resultPromise) => {
    job.step = label;
    const result = await resultPromise;
    if (result.out) job.log.push(result.out);
    if (result.err) job.log.push(result.err);
    if (result.code !== 0) throw new Error(`${label} failed`);
  };

  try {
    await step('fetch', 'git', ['fetch', 'origin', branch]);
    const dirty = await run('git', ['status', '--porcelain']);
    if (dirty.code !== 0 || dirty.out) throw new Error('Lokale Aenderungen vorhanden. Update abgebrochen; Dateien bleiben erhalten.');
    const target = await run('git', ['rev-parse', `origin/${branch}`]);
    if (target.code !== 0 || !/^[0-9a-f]{40}$/.test(target.out)) throw new Error('Ungueltiger Update-Commit');
    // Commit-Pinning, serverseitig gegengeprueft (die App prueft bereits vorher, siehe update.ts
    // -- hier nochmal unabhaengig, falls sich zwischen beiden Aufrufen etwas aendert/TOCTOU):
    // es wird NIE blind "der jeweils neueste Stand" angewendet, sondern nur exakt der Commit,
    // den die aufrufende Person tatsaechlich bestaetigt hat.
    if (expectedCommit && expectedCommit !== target.out) {
      throw new Error(`Ziel-Commit hat sich geaendert (erwartet ${expectedCommit}, GitHub liefert jetzt ${target.out}). Update abgebrochen, bitte Stand erneut pruefen.`);
    }
    if (requireSignedCommits) {
      job.step = 'verify';
      job.log.push(`$ git verify-commit ${target.out}`);
      const verify = await run('git', ['verify-commit', target.out], { timeoutMs: 15000 });
      if (verify.out) job.log.push(verify.out);
      if (verify.err) job.log.push(verify.err);
      if (verify.code !== 0) throw new Error('Ziel-Commit hat keine gueltige, bekannte GPG-Signatur (UPDATE_REQUIRE_SIGNED_COMMITS=true) -- Update abgebrochen.');
    }
    const previousCommit = (await run('git', ['rev-parse', 'HEAD'])).out;
    await step('reset', 'git', ['merge', '--ff-only', target.out]);
    await step('build', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'build', '--no-cache', 'app']);
    await step('build', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'up', '-d', 'office']);
    job.log.push('$ docker compose run --rm --no-deps app node dist/db/migrate.js (Zugangsdaten per stdin)');
    await stepResult('migrate', runMigrate());
    await step('restart', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '180', 'app']);
    job.ok = true;
    job.step = 'done';
    // Fuer /rollback: nur nach einem ERFOLGREICHEN Update ueberschreiben, damit ein
    // fehlgeschlagener Lauf (der ohnehin bei "Lokale Aenderungen"/ff-only-Fehler frueh abbricht)
    // nicht versehentlich die Rollback-Zielmarke verfaelscht.
    await writeHistory({ previousCommit, updatedAt: job.finishedAt || new Date().toISOString(), updatedTo: target.out });
  } catch (error) {
    job.ok = false;
    job.failed = true;
    job.log.push(String(error?.message || error));
  } finally {
    job.running = false;
    job.finishedAt = new Date().toISOString();
  }
}

// Setzt gezielt auf den Commit zurueck, der vor dem letzten erfolgreichen Update aktiv war.
// Bewusst EIN eigener, enger Mechanismus statt eines allgemeinen "checkout beliebiger Commit" --
// die einzige erlaubte Zielmarke ist die zuletzt von runUpdate() hinterlegte previousCommit, und
// auch die nur nach Commit-Pinning (expectedCommit muss exakt passen, siehe update.ts).
// "git reset --hard" ist hier bewusst anders als beim normalen Update (dort "merge --ff-only",
// siehe N3-Kommentar) -- ein Rollback bewegt sich per Definition RUECKWAERTS, das kann ff-only
// nicht abbilden; das Ziel ist aber auf einen zuvor selbst erfolgreich gelaufenen Commit
// beschraenkt, nicht auf einen beliebigen, von aussen vorgegebenen Stand.
async function runRollback(expectedCommit) {
  job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: false, failed: false, step: 'starting', log: [] };
  const step = async (label, command, args) => {
    job.step = label;
    job.log.push(`$ ${command} ${args.join(' ')}`);
    const result = await run(command, args, { timeoutMs: command === 'git' ? 15000 : 1800000 });
    if (result.out) job.log.push(result.out);
    if (result.err) job.log.push(result.err);
    if (result.code !== 0) throw new Error(`${label} failed`);
  };

  try {
    const history = await readHistory();
    if (!history.previousCommit) throw new Error('Kein vorheriger Commit bekannt -- Rollback nicht moeglich (noch kein erfolgreiches In-App-Update seit dem letzten Neustart des Updater-Dienstes).');
    if (expectedCommit !== history.previousCommit) {
      throw new Error(`Rollback-Ziel stimmt nicht mit dem bekannten vorherigen Commit ueberein (erwartet ${history.previousCommit}, angefordert ${expectedCommit}). Abgebrochen.`);
    }
    const dirty = await run('git', ['status', '--porcelain']);
    if (dirty.code !== 0 || dirty.out) throw new Error('Lokale Aenderungen vorhanden. Rollback abgebrochen; Dateien bleiben erhalten.');
    job.step = 'reset';
    job.log.push(`$ git reset --hard ${history.previousCommit}`);
    const reset = await run('git', ['reset', '--hard', history.previousCommit], { timeoutMs: 15000 });
    if (reset.out) job.log.push(reset.out);
    if (reset.err) job.log.push(reset.err);
    if (reset.code !== 0) throw new Error('reset failed');
    // KEIN migrate.js hier: Migrationen sind nur vorwaerts gerichtet (kein automatisches
    // "down"). Hatte das Update, von dem zurueckgerollt wird, neue Migrationen dabei, bleibt das
    // Datenbank-Schema auf dem NEUEREN Stand, waehrend der Code jetzt wieder aelter ist -- ein
    // Lauf von migrate.js wuerde hier faelschlich "bereits aktuell" melden, obwohl der jetzt
    // aktive (aeltere) Code diese Spalten/Typen moeglicherweise gar nicht kennt. Diese
    // Inkompatibilitaet laesst sich nur durch Wiederherstellen eines Datenbank-Backups von vor
    // dem urspruenglichen Update sauber aufloesen (siehe ops/docker/restore.sh), nicht durch den
    // In-App-Updater. Der Hinweis dazu steht im Log unten.
    job.log.push('HINWEIS: Nur der Code wurde zurueckgesetzt, NICHT das Datenbank-Schema. Falls das rueckgaengig gemachte Update Migrationen enthielt, kann das zu Inkompatibilitaeten fuehren -- im Zweifel zusaetzlich ein Datenbank-Backup von vor dem Update wiederherstellen (ops/docker/restore.sh).');
    await step('build', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'build', '--no-cache', 'app']);
    await step('restart', 'docker', ['compose', '-f', composeFile, '--env-file', envFile, 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '180', 'app']);
    job.ok = true;
    job.step = 'done';
    // Nach einem Rollback gibt es (bis zum naechsten erfolgreichen Update) keinen sinnvollen
    // weiteren Rollback-Pfad mehr -- Marke entfernen statt eine falsche stehen zu lassen.
    await writeHistory({});
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
    // /health bewusst OHNE HMAC-Pflicht -- der Docker-Healthcheck (siehe docker-compose.yml)
    // ruft das ohne Signatur auf und braucht nur den ohnehin schon geprueften Bearer-Token.
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });

    const bodyRaw = await readBody(req);
    if (!verifyHmac(req, bodyRaw, res)) return;
    let body = {};
    if (bodyRaw) {
      try { body = JSON.parse(bodyRaw); } catch { return json(res, 400, { error: 'invalid_json_body' }); }
    }

    if (req.method === 'GET' && req.url === '/status') {
      if (!statusRequest) statusRequest = collectStatus().finally(() => { statusRequest = null; });
      return json(res, 200, await statusRequest);
    }
    if (req.method === 'POST' && req.url === '/run') {
      if (!allowMainDeploy) return json(res, 403, { error: 'update_runner_disabled', message: 'Automatische Deployments von main sind deaktiviert. Aktiviere UPDATE_ALLOW_MAIN_DEPLOY=true nur bewusst und zeitlich begrenzt.' });
      if (job?.running) return json(res, 409, { error: 'update_already_running', job });
      runUpdate(typeof body.expected_commit === 'string' ? body.expected_commit : null);
      return json(res, 202, { ok: true, job });
    }
    // Eigener Endpunkt, unabhaengig vom vollen Deploy-Zyklus und nicht durch "kein Update
    // verfuegbar" blockiert: holt den laufenden App-Container und die Datenbank wieder auf
    // denselben Schema-Stand, z.B. wenn ein frueherer Lauf vor dem Migrations-Schritt
    // abgebrochen ist (Container laeuft bereits mit neuem Code, DB-Spalten fehlen aber noch --
    // aeussert sich als generische 500er auf vielen, scheinbar unzusammenhaengenden Routen).
    if (req.method === 'POST' && req.url === '/migrate') {
      if (job?.running) return json(res, 409, { error: 'update_already_running', job });
      const result = await runMigrate();
      return json(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, log: [result.out, result.err].filter(Boolean).join('\n') });
    }
    if (req.method === 'POST' && req.url === '/rollback') {
      if (!allowMainDeploy) return json(res, 403, { error: 'update_runner_disabled' });
      if (job?.running) return json(res, 409, { error: 'update_already_running', job });
      if (typeof body.expected_commit !== 'string' || !/^[0-9a-f]{40}$/.test(body.expected_commit)) {
        return json(res, 400, { error: 'expected_commit_required' });
      }
      runRollback(body.expected_commit);
      return json(res, 202, { ok: true, job });
    }
    json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('update-service request failed', error);
    json(res, 500, { error: 'update_service_error', message: 'internal server error', job });
  }
}).listen(port, '0.0.0.0');
