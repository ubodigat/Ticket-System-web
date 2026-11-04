#!/usr/bin/env bash
# Prueft ops/online-updates.sh ohne Systemeingriff (eigenes Wurzelverzeichnis, kein systemd).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/ticket-online-updates.XXXXXXXX")
case "$fixture" in */ticket-online-updates.*) ;; *) exit 1;; esac
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/repo/ops/docker" "$fixture/repo/ops/host-updater" "$fixture/sys" "$fixture/gpg"
cp "$root/ops/online-updates.sh" "$fixture/repo/ops/"
cp "$root/ops/host-updater/"* "$fixture/repo/ops/host-updater/"
printf 'DB_NAME=ticketsystem\nUPDATE_ALLOW_MAIN_DEPLOY=false\n' > "$fixture/repo/ops/docker/.env"
export ONLINE_UPDATES_ROOT="$fixture/sys" ONLINE_UPDATES_NO_SYSTEMD=1
chmod 0700 "$fixture/gpg"
key() { GNUPGHOME="$fixture/gpg" gpg --batch --quiet --passphrase '' --quick-gen-key "$1" ed25519 sign 1y; GNUPGHOME="$fixture/gpg" gpg --batch --with-colons --fingerprint "$1" | awk -F: '/^fpr:/ {print $10; exit}'; }
fpr="$(key 'Release <release@example.invalid>')"
other="$(key 'Other <other@example.invalid>')"
GNUPGHOME="$fixture/gpg" gpg --batch --armor --export "$fpr" > "$fixture/repo/ops/release-signing-key.asc"
GNUPGHOME="$fixture/gpg" gpg --batch --armor --export "$fpr" "$other" > "$fixture/two-keys.asc"
run() { bash "$fixture/repo/ops/online-updates.sh" "$@" </dev/null; }
expect_fail() { if run "$@" >"$fixture/out" 2>&1; then echo "expected failure: $*" >&2; cat "$fixture/out" >&2; exit 1; fi; }

# Ohne Terminal und ohne Fingerabdruck: Abbruch, nichts eingerichtet.
expect_fail enable
grep -q 'fingerprint' "$fixture/out"
[[ ! -e "$fixture/sys/etc/ticket-system-updater.conf" ]]
# Falscher Fingerabdruck und Datei mit zwei Schluesseln werden abgelehnt.
expect_fail enable "--fingerprint=$other"
grep -q 'passt NICHT' "$fixture/out"
expect_fail enable "--key=$fixture/two-keys.asc" "--fingerprint=$fpr"
grep -q 'genau einen' "$fixture/out"
[[ ! -e "$fixture/sys/var/lib/ticket-system-update/state/agent.env" ]]

# Richtiger Fingerabdruck: alles eingerichtet.
run enable "--fingerprint=${fpr,,}" > "$fixture/out"
grep -q 'AKTIV' "$fixture/out"
grep -qx 'enabled=1' "$fixture/sys/var/lib/ticket-system-update/state/agent.env"
grep -q '^ALLOW_MAIN_DEPLOY=true$' "$fixture/sys/etc/ticket-system-updater.conf"
grep -q '^KEY_DIR=/etc/ticket-system-updater/keys$' "$fixture/sys/etc/ticket-system-updater.conf"
[[ "$(stat -c %a "$fixture/sys/etc/ticket-system-updater.conf")" == 600 ]]
[[ "$(stat -c %a "$fixture/sys/etc/ticket-system-updater/keys")" == 700 ]]
[[ -x "$fixture/sys/usr/local/libexec/ticket-system-updater" ]]
[[ -f "$fixture/sys/etc/systemd/system/ticket-system-updater.path" ]]
GNUPGHOME="$fixture/sys/etc/ticket-system-updater/keys" gpg --batch --with-colons --fingerprint | grep -q "$fpr"
! GNUPGHOME="$fixture/sys/etc/ticket-system-updater/keys" gpg --batch --with-colons --fingerprint | grep -q "$other"
grep -q '^UPDATE_ALLOW_MAIN_DEPLOY=true$' "$fixture/repo/ops/docker/.env"
[[ "$(grep -c '^UPDATE_ALLOW_MAIN_DEPLOY=' "$fixture/repo/ops/docker/.env")" == 1 ]]
grep -q '^DB_NAME=ticketsystem$' "$fixture/repo/ops/docker/.env"
run status > "$fixture/out"; grep -q 'AKTIV' "$fixture/out"

# Ausschalten entfernt Dienst, Konfiguration und Schluessel.
run disable > "$fixture/out"
grep -q 'AUS' "$fixture/out"
[[ ! -e "$fixture/sys/var/lib/ticket-system-update/state/agent.env" ]]
[[ ! -e "$fixture/sys/etc/ticket-system-updater.conf" ]]
[[ ! -e "$fixture/sys/etc/ticket-system-updater/keys" ]]
[[ ! -e "$fixture/sys/usr/local/libexec/ticket-system-updater" ]]
[[ ! -e "$fixture/sys/etc/systemd/system/ticket-system-updater.path" ]]
grep -q '^UPDATE_ALLOW_MAIN_DEPLOY=false$' "$fixture/repo/ops/docker/.env"
run status > "$fixture/out"; grep -q 'AUS' "$fixture/out"
echo 'online-updates: ok'
