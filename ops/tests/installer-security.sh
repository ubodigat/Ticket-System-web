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
sh -n "$root/ops/docker/provision-db.sh"
echo 'Installer credential preservation, root recovery, TLS verification and failure handling: OK'
