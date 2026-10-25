#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/ticket-installer-test.XXXXXXXX")
# Only the explicit mktemp-created directory may be recursively removed.
case "$fixture" in */ticket-installer-test.*) ;; *) exit 1;; esac
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/repo/ops/docker"
cp "$root/ops/tests/fixtures/docker" "$root/ops/tests/fixtures/mariadb" "$fixture/bin/"
chmod +x "$fixture/bin/docker" "$fixture/bin/mariadb"
export PATH="$fixture/bin:$PATH"
export FIXTURE_LOG="$fixture/commands"
envfile="$fixture/repo/ops/docker/.env"
printf 'DB_NAME=ticketsystem\nDB_USER=ticketapp\nDB_PASSWORD=MigrationPassword==\nDB_RUNTIME_USER=ticketapp_rt\nDB_RUNTIME_PASSWORD=RuntimePassword==\nDB_ROOT_PASSWORD=RootPassword==\n' > "$envfile"
sh "$root/ops/docker/provision-db.sh" "$fixture/repo"
grep -q "IDENTIFIED BY 'RuntimePassword=='" "$FIXTURE_LOG"
grep -q 'password="RuntimePassword=="' "$FIXTURE_LOG"
grep -q 'REVOKE ALL PRIVILEGES' "$FIXTURE_LOG"
grep -q -- '--ssl-verify-server-cert' "$FIXTURE_LOG.args"
! grep -q 'Password' "$FIXTURE_LOG.args"
grep -q '^DB_PASSWORD=MigrationPassword==$' "$envfile"
grep -q '^DB_RUNTIME_PASSWORD=RuntimePassword==$' "$envfile"
sed '/^DB_ROOT_PASSWORD=/d; /^DB_RUNTIME_/d' "$envfile" > "$envfile.next"
mv "$envfile.next" "$envfile"
sh "$root/ops/docker/provision-db.sh" "$fixture/repo" --recover-only
grep -q '^DB_ROOT_PASSWORD=recovered-root$' "$envfile"
sh "$root/ops/docker/provision-db.sh" "$fixture/repo"
grep -q '^DB_RUNTIME_USER=ticketapp_rt$' "$envfile"
cp "$envfile" "$fixture/before"
if MOCK_DB_FAIL=1 sh "$root/ops/docker/provision-db.sh" "$fixture/repo"; then echo 'Expected account verification failure' >&2; exit 1; fi
cmp "$envfile" "$fixture/before"
sed '/^DB_ROOT_PASSWORD=/d' "$envfile" > "$envfile.next"
mv "$envfile.next" "$envfile"
if MOCK_ROOT_MISSING=1 sh "$root/ops/docker/provision-db.sh" "$fixture/repo" --recover-only; then echo 'Missing root password must fail closed' >&2; exit 1; fi
# Test the real verification function without running the installer's system operations.
sed -n '/^verify_installation() {/,/^}/p' "$root/install.sh" > "$fixture/verify.sh"
source "$fixture/verify.sh"
mkdir "$fixture/verified"
(
  cd "$fixture/verified"
  git init -q
  printf 'reviewed source\n' > app.txt
  printf 'documentation\n' > README.md
  sha256sum --text app.txt > install-manifest.sha256
  git add -- app.txt README.md install-manifest.sha256
)
INSTALL_MANIFEST_SHA256=$(sha256sum "$fixture/verified/install-manifest.sha256" | cut -d' ' -f1)
verify_installation "$fixture/verified"
printf 'injected source\n' >> "$fixture/verified/app.txt"
if verify_installation "$fixture/verified" >/dev/null 2>&1; then echo 'Modified source must fail verification' >&2; exit 1; fi
printf 'reviewed source\n' > "$fixture/verified/app.txt"
printf 'unexpected execution input\n' > "$fixture/verified/injected.txt"
git -C "$fixture/verified" add -- injected.txt
if verify_installation "$fixture/verified" >/dev/null 2>&1; then echo 'Additional tracked source must fail verification' >&2; exit 1; fi
bash -n "$root/install.sh"
# Probe public pages, never the intentionally blocked /health path. Simulate Caddy
# starting late, a missing module and a misleading HTML fallback for JavaScript.
sed -n '/^probe_public_asset() {/,/^}/p; /^verify_public_web() {/,/^}/p' "$root/install.sh" > "$fixture/web-probe.sh"
source "$fixture/web-probe.sh"
mkdir -p "$fixture/web/js"
touch "$fixture/web/js/outlook-calendar.js"
SCRIPT_DIR="$fixture/web"
curl() {
  local url="${!#}"
  printf '%s\n' "$url" >> "$fixture/web-requests"
  if [[ "$url" == */health ]]; then return 1; fi
  if [[ "$url" == */index.html ]]; then
    if [[ "$WEB_MODE" == 'starting' && ! -f "$fixture/started" ]]; then
      touch "$fixture/started"; return 7
    fi
    if [[ "$WEB_MODE" == 'unreachable' ]]; then return 7; fi
    printf '200 text/html; charset=utf-8'
  elif [[ "$url" == */style.css ]]; then printf '200 text/css; charset=utf-8'
  elif [[ "$url" == */outlook-calendar.js && "$WEB_MODE" == 'missing' ]]; then printf '404 text/plain'
  elif [[ "$url" == */outlook-calendar.js && "$WEB_MODE" == 'html-fallback' ]]; then printf '200 text/html'
  else printf '200 application/javascript; charset=utf-8'; fi
}
sleep() { :; }
WEB_MODE=starting
verify_public_web 'https://192.0.2.1:8443'
grep -q 'https://192.0.2.1:8443/js/outlook-calendar.js' "$fixture/web-requests"
! grep -q '/health' "$fixture/web-requests"
for WEB_MODE in missing html-fallback unreachable; do
  if verify_public_web 'https://192.0.2.1' >/dev/null 2>&1; then
    echo "Public website verification must fail for $WEB_MODE" >&2; exit 1
  fi
done
unset -f curl sleep
sh -n "$root/ops/docker/provision-db.sh"
echo 'Installer credential preservation, root recovery, TLS verification and failure handling: OK'
