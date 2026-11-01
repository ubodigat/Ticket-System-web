#!/usr/bin/env bash
# Host-Updater (Security-Audit N-3): ersetzt den frueheren Updater-Container, der als root mit
# /var/run/docker.sock lief. Dieses Skript laeuft ausschliesslich auf dem Host (systemd), kein
# Container hat mehr Zugriff auf den Docker-Socket.
#
# Die App spricht den Updater nur ueber ein Austauschverzeichnis an:
#   $BRIDGE/requests  (gehoert dem App-Benutzer, uid 10001): je Anfrage eine Datei mit einer Zeile
#                     "<aktion> <nonce> <commit|->", aktion = status | run | migrate | rollback
#   $BRIDGE/state     (gehoert root, fuer die App nur lesbar): status.env, accepted.env, job.env, job.log
#   $BRIDGE/work      (nur root): Anfragen werden vor dem Lesen hierher verschoben (kein Symlink-/TOCTOU-Trick)
# Die Anfragen koennen nichts Beliebiges ausloesen: aktualisiert wird nur auf den aktuellen Stand von
# origin/<branch>, und nur wenn dieser Commit (oder ein darauf zeigender Release-Tag) eine gueltige
# GPG-Signatur eines vom Betreiber hinterlegten Schluessels traegt.
set -euo pipefail
umask 022

CONF_FILE="${TICKET_SYSTEM_UPDATER_CONF:-/etc/ticket-system-updater.conf}"
[[ -r "$CONF_FILE" ]] || { echo "Konfiguration $CONF_FILE fehlt" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONF_FILE"
: "${REPO_DIR:?REPO_DIR fehlt}" "${BRIDGE_DIR:=/var/lib/ticket-system-update}" "${UPDATE_BRANCH:=main}"
: "${ALLOW_MAIN_DEPLOY:=false}" "${KEY_DIR:=/etc/ticket-system-updater/keys}"
REQ_DIR="$BRIDGE_DIR/requests"; STATE_DIR="$BRIDGE_DIR/state"; WORK_DIR="$BRIDGE_DIR/work"
COMPOSE=(docker compose -f "$REPO_DIR/ops/docker/docker-compose.yml" --env-file "$REPO_DIR/ops/docker/.env")
HISTORY_FILE="$REPO_DIR/.git/ticket-system-update-history"
LOCK_FILE="$BRIDGE_DIR/job.lock"
SELF="$(readlink -f "$0")"

git_repo() { git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" "$@"; }

# Werte fuer die *.env-Dateien: eine Zeile, nur druckbare Zeichen, begrenzte Laenge.
clean() { printf '%s' "${1:-}" | tr '\r\n\t' '   ' | tr -cd '[:print:]' | cut -c1-300; }

# Schreibt eine key=value-Datei atomar (erst temporaer, dann umbenennen).
write_state() {
  local file="$1"; shift
  local tmp
  tmp="$(mktemp "$STATE_DIR/.tmp.XXXXXX")"
  local pair
  for pair in "$@"; do printf '%s=%s\n' "${pair%%=*}" "$(clean "${pair#*=}")" >>"$tmp"; done
  chmod 0644 "$tmp"
  mv -f "$tmp" "$STATE_DIR/$file"
}

log_line() { clean "$1" >>"$STATE_DIR/job.log"; printf '\n' >>"$STATE_DIR/job.log"; }

# Signaturpruefung mit einer frischen, privaten Kopie des Schluesselbunds (der Bestand bleibt unveraendert).
with_keyring() {
  local home rc=0
  home="$(mktemp -d)"
  cp -a "$KEY_DIR/." "$home/" 2>/dev/null || true
  find "$home" \( -name 'S.*' -o -name '*.lock' -o -name '.#lk*' \) -delete 2>/dev/null || true
  chmod 0700 "$home"
  GNUPGHOME="$home" "$@" || rc=$?
  rm -rf "$home"
  return "$rc"
}
has_signing_keys() { with_keyring sh -c 'gpg --batch --list-keys --with-colons 2>/dev/null | grep -q "^pub:"'; }
# Gueltig ist eine Signatur auf dem Commit selbst ODER auf einem Release-Tag, der genau darauf zeigt.
verify_target() {
  local commit="$1" tag
  if with_keyring git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" verify-commit "$commit" >>"$STATE_DIR/job.log" 2>&1; then return 0; fi
  while read -r tag; do
    [[ "$tag" =~ ^(v|release-)[0-9A-Za-z._-]+$ ]] || continue
    if with_keyring git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" verify-tag "$tag" >>"$STATE_DIR/job.log" 2>&1; then
      log_line "Signierter Release-Tag: $tag"; return 0
    fi
  done < <(git_repo tag --points-at "$commit")
  return 1
}

do_status() {
  local nonce="$1" error="" local_commit remote_commit behind rollback signed=0
  [[ "$ALLOW_MAIN_DEPLOY" == "true" ]] || error="update_runner_disabled"
  has_signing_keys && signed=1
  if ! timeout 20 git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" fetch --quiet --tags origin "$UPDATE_BRANCH" 2>/dev/null; then error="${error:-github_unreachable}"; fi
  local_commit="$(git_repo rev-parse HEAD 2>/dev/null || true)"
  remote_commit="$(git_repo rev-parse "origin/$UPDATE_BRANCH" 2>/dev/null || true)"
  behind="$(git_repo rev-list --count "HEAD..origin/$UPDATE_BRANCH" 2>/dev/null || echo 0)"
  rollback="$(head -c 40 "$HISTORY_FILE" 2>/dev/null || true)"
  [[ "$rollback" =~ ^[0-9a-f]{40}$ ]] || rollback=""
  write_state status.env "nonce=$nonce" "enabled=$([[ "$ALLOW_MAIN_DEPLOY" == "true" ]] && echo 1 || echo 0)" "signingKeys=$signed" \
    "branch=$UPDATE_BRANCH" "localCommit=$local_commit" "remoteCommit=$remote_commit" \
    "localSubject=$(git_repo log -1 --pretty=%s HEAD 2>/dev/null || true)" \
    "remoteSubject=$(git_repo log -1 --pretty=%s "origin/$UPDATE_BRANCH" 2>/dev/null || true)" \
    "commitsBehind=$behind" "rollbackCommit=$rollback" "error=$error" "checkedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

job_state() { # running ok failed step [needsInstaller]
  write_state job.env "nonce=$JOB_NONCE" "action=$JOB_ACTION" "running=$1" "ok=$2" "failed=$3" "step=$4" \
    "needsInstaller=${5:-0}" "startedAt=$JOB_STARTED" "finishedAt=$([[ "$1" == 1 ]] || date -u +%Y-%m-%dT%H:%M:%SZ)"
}

step() { # label, command...
  JOB_STEP="$1"; shift
  job_state 1 0 0 "$JOB_STEP"
  log_line "\$ $*"
  "$@" >>"$STATE_DIR/job.log" 2>&1
}

migrate() {
  sh "$REPO_DIR/ops/docker/provision-db.sh" "$REPO_DIR" >>"$STATE_DIR/job.log" 2>&1 || return 1
  local env_file="$REPO_DIR/ops/docker/.env"
  # Zugangsdaten per stdin, nie als Kommandozeilenargument.
  printf '%s\n%s\n' "$(grep '^DB_USER=' "$env_file" | cut -d= -f2-)" "$(grep '^DB_PASSWORD=' "$env_file" | cut -d= -f2-)" \
    | "${COMPOSE[@]}" run --rm --no-deps -T app sh -c \
      'set -eu; IFS= read -r DB_USER; IFS= read -r DB_PASSWORD; export DB_USER DB_PASSWORD; exec node dist/db/migrate.js' >>"$STATE_DIR/job.log" 2>&1
}

run_update() {
  local expected="$1" target previous changed needs_installer=0
  step fetch git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" fetch --tags origin "$UPDATE_BRANCH" || return 1
  [[ -z "$(git_repo status --porcelain)" ]] || { log_line "Lokale Aenderungen vorhanden. Update abgebrochen; Dateien bleiben erhalten."; return 1; }
  target="$(git_repo rev-parse "origin/$UPDATE_BRANCH")"
  [[ "$target" =~ ^[0-9a-f]{40}$ && "$target" == "$expected" ]] || { log_line "Ziel-Commit hat sich geaendert (erwartet $expected, aktuell $target). Update abgebrochen."; return 1; }
  JOB_STEP=verify; job_state 1 0 0 verify
  verify_target "$target" || { log_line "Ziel-Commit hat keine gueltige Signatur eines hinterlegten Schluessels -- Update abgebrochen."; return 1; }
  previous="$(git_repo rev-parse HEAD)"
  step reset git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" merge --ff-only "$target" || return 1
  changed="$(git_repo diff --name-only "$previous" "$target")"
  step build "${COMPOSE[@]}" build --no-cache --build-arg "APP_COMMIT=$target" --build-arg "APP_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" app || return 1
  step build "${COMPOSE[@]}" up -d office || return 1
  if grep -q '^ops/docker/mariadb/' <<<"$changed"; then step migrate "${COMPOSE[@]}" up -d --force-recreate --wait --wait-timeout 180 mariadb || return 1
  else step migrate "${COMPOSE[@]}" up -d --wait --wait-timeout 180 mariadb || return 1; fi
  step migrate "${COMPOSE[@]}" stop --timeout 30 app || return 1
  JOB_STEP=migrate; log_line "\$ docker compose run --rm --no-deps app node dist/db/migrate.js (Zugangsdaten per stdin)"; migrate || return 1
  step restart "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 app || return 1
  if grep -Eq '^ops/docker/(Caddyfile|caddy-sites/)' <<<"$changed"; then step restart "${COMPOSE[@]}" up -d --no-deps --force-recreate caddy || return 1
  else step restart "${COMPOSE[@]}" up -d --no-deps caddy || return 1; fi
  if grep -Eq '^(install\.sh|ops/host-updater/|ops/docker/docker-compose\.yml|ops/docker/clamav/|ops/docker/office\.caddy)' <<<"$changed"; then
    needs_installer=1
    log_line "HINWEIS: Diese Version aendert Installer, Updater oder optionale Dienste. Bitte zusaetzlich auf dem Server \"bash install.sh\" ausfuehren."
  fi
  printf '%s\n' "$previous" >"$HISTORY_FILE"
  NEEDS_INSTALLER=$needs_installer
}

run_rollback() {
  local expected="$1" previous
  previous="$(head -c 40 "$HISTORY_FILE" 2>/dev/null || true)"
  [[ "$previous" =~ ^[0-9a-f]{40}$ && "$previous" == "$expected" ]] || { log_line "Rollback-Ziel passt nicht zum bekannten vorherigen Commit. Abgebrochen."; return 1; }
  [[ -z "$(git_repo status --porcelain)" ]] || { log_line "Lokale Aenderungen vorhanden. Rollback abgebrochen."; return 1; }
  JOB_STEP=verify; job_state 1 0 0 verify
  verify_target "$previous" || { log_line "Rollback-Ziel ist nicht gueltig signiert. Abgebrochen."; return 1; }
  if [[ -n "$(git_repo diff --name-only "$previous" HEAD -- apps/server/src/db/migrations)" ]]; then
    log_line "Rollback ueber Schemaaenderungen gesperrt. Wiederherstellung nur mit passender Datenbank-Sicherung."; return 1
  fi
  step reset git -C "$REPO_DIR" -c safe.directory="$REPO_DIR" switch --detach "$previous" || return 1
  log_line "HINWEIS: Nur der Code wurde zurueckgesetzt, nicht das Datenbank-Schema."
  step build "${COMPOSE[@]}" build --no-cache --build-arg "APP_COMMIT=$previous" --build-arg "APP_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" app || return 1
  step restart "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 app || return 1
  rm -f "$HISTORY_FILE"
}

run_job() {
  JOB_ACTION="$1"; JOB_NONCE="$2"; local commit="$3"
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
  JOB_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; JOB_STEP=starting; NEEDS_INSTALLER=0
  : >"$STATE_DIR/job.log"; chmod 0644 "$STATE_DIR/job.log"
  job_state 1 0 0 starting
  local ok=0
  case "$JOB_ACTION" in
    run) run_update "$commit" && ok=1 ;;
    rollback) run_rollback "$commit" && ok=1 ;;
    migrate) JOB_STEP=migrate; job_state 1 0 0 migrate; migrate && ok=1 ;;
  esac
  if [[ "$ok" == 1 ]]; then job_state 0 1 0 done "$NEEDS_INSTALLER"; else job_state 0 0 1 "$JOB_STEP"; fi
}

dispatch() {
  mkdir -p "$WORK_DIR"; chmod 0700 "$WORK_DIR"
  local file name entry="$WORK_DIR/entry" line action nonce commit count=0
  # Jeder Eintrag (auch Symlinks, Verzeichnisse oder falsch benannte Dateien) wird erst atomar in das
  # root-eigene Verzeichnis verschoben, dort geprueft und danach immer entfernt. So bleibt nichts liegen,
  # was den systemd-Pfad-Trigger (DirectoryNotEmpty) dauerhaft erneut ausloesen wuerde.
  while IFS= read -r -d '' file; do
    count=$((count + 1)); [[ $count -le 20 ]] || break
    name="$(basename -- "$file")"
    rm -rf -- "$entry"
    mv -fT -- "$file" "$entry" 2>/dev/null || continue
    if [[ ! "$name" =~ ^[0-9A-Za-z._-]{1,80}\.req$ || -L "$entry" || ! -f "$entry" ]]; then rm -rf -- "$entry"; continue; fi
    line="$(head -c 200 "$entry" | head -n 1)"
    rm -f -- "$entry"
    [[ "$line" =~ ^(status|run|migrate|rollback)\ ([0-9a-f]{32})\ ([0-9a-f]{40}|-)$ ]] || continue
    action="${BASH_REMATCH[1]}"; nonce="${BASH_REMATCH[2]}"; commit="${BASH_REMATCH[3]}"
    if [[ "$action" == status ]]; then do_status "$nonce"; continue; fi
    if [[ "$action" != migrate && "$ALLOW_MAIN_DEPLOY" != "true" ]]; then write_state accepted.env "nonce=$nonce" "result=update_runner_disabled"; continue; fi
    if [[ "$action" != migrate ]] && ! has_signing_keys; then write_state accepted.env "nonce=$nonce" "result=update_signature_not_configured"; continue; fi
    if ! flock -n "$LOCK_FILE" true; then write_state accepted.env "nonce=$nonce" "result=update_already_running"; continue; fi
    systemd-run --quiet --collect --unit "ticket-system-update-job-${nonce:0:12}" --property=TimeoutStartSec=3600 \
      "$SELF" job "$action" "$nonce" "$commit"
    write_state accepted.env "nonce=$nonce" "result=started"
  done < <(find "$REQ_DIR" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | sort -z)
}

case "${1:-dispatch}" in
  dispatch) dispatch ;;
  job) [[ "${2:-}" =~ ^(run|migrate|rollback)$ && "${3:-}" =~ ^[0-9a-f]{32}$ && "${4:-}" =~ ^([0-9a-f]{40}|-)$ ]] && run_job "$2" "$3" "$4" ;;
  *) echo "Verwendung: $0 [dispatch|job <aktion> <nonce> <commit>]" >&2; exit 2 ;;
esac
