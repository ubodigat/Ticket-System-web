#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/ticket-web-tls.XXXXXXXX")
case "$fixture" in */ticket-web-tls.*) ;; *) exit 1;; esac
trap 'rm -rf -- "$fixture"' EXIT
for fn in set_env_var public_env_value valid_ipv4 valid_public_host ensure_public_env_defaults probe_public_asset configure_web_only assert_clean_install_checkout; do
  sed -n "/^${fn}() {/,/^}/p" "$root/install.sh" >> "$fixture/functions.sh"
done
source "$fixture/functions.sh"
log() { :; }; warn() { :; }
detect_primary_ip() { printf '192.0.2.55\n'; }
PUBLIC_DOMAIN_ARG=''; ACME_EMAIL_ARG=''; TLS_MODE_ARG=''; DEV_MODE=false
ENV_FILE="$fixture/.env"
# Fresh installation: no saved configuration, ports or TLS policy.
touch "$ENV_FILE"
ensure_public_env_defaults
[[ "$(public_env_value PUBLIC_DOMAIN)" == 192.0.2.55 ]]
[[ "$(public_env_value PUBLIC_URL)" == https://192.0.2.55 ]]
[[ "$(public_env_value TLS_POLICY)" == internal ]]
[[ "$(public_env_value HTTP_PORT)" == 80 && "$(public_env_value HTTPS_PORT)" == 443 ]]
[[ "$(public_env_value BIND_ADDRESS)" == 0.0.0.0 ]]
: > "$ENV_FILE"
PUBLIC_DOMAIN_ARG=ticket.ubodigat.com; TLS_MODE_ARG=internal
ensure_public_env_defaults
[[ "$(public_env_value PUBLIC_URL)" == https://ticket.ubodigat.com ]]
[[ "$(public_env_value TLS_POLICY)" == internal ]]
: > "$ENV_FILE"
PUBLIC_DOMAIN_ARG=support.example.com; TLS_MODE_ARG=acme; ACME_EMAIL_ARG=operator@example.org
ensure_public_env_defaults
[[ "$(public_env_value PUBLIC_URL)" == https://support.example.com ]]
[[ "$(public_env_value TLS_POLICY)" == operator@example.org ]]
PUBLIC_DOMAIN_ARG=''; ACME_EMAIL_ARG=''; TLS_MODE_ARG=''
cat > "$ENV_FILE" <<'ENV'
PUBLIC_DOMAIN=192.0.2.55
HTTP_PORT=8080
HTTPS_PORT=8443
BIND_ADDRESS=192.0.2.55
ACME_EMAIL=admin@example.invalid
TLS_POLICY=internal
DB_PASSWORD=preserve-secret==
COOKIE_SECRET=preserve-cookie
INSTALLATION_ID=preserve-id
ENV
chmod 0600 "$ENV_FILE"
PUBLIC_DOMAIN_ARG=ticket.ubodigat.com; TLS_MODE_ARG=internal
ensure_public_env_defaults
[[ "$(public_env_value PUBLIC_DOMAIN)" == ticket.ubodigat.com ]]
[[ "$(public_env_value TLS_MODE)" == internal ]]
[[ "$(public_env_value TLS_POLICY)" == internal ]]
[[ "$(public_env_value PUBLIC_URL)" == https://ticket.ubodigat.com:8443 ]]
[[ "$(public_env_value HTTP_PORT)" == 8080 && "$(public_env_value BIND_ADDRESS)" == 192.0.2.55 ]]
grep -q '^DB_PASSWORD=preserve-secret==$' "$ENV_FILE"
grep -q '^COOKIE_SECRET=preserve-cookie$' "$ENV_FILE"
grep -q '^INSTALLATION_ID=preserve-id$' "$ENV_FILE"
ACME_EMAIL_ARG=operator@example.org; TLS_MODE_ARG=internal
ensure_public_env_defaults
ACME_EMAIL_ARG=''; TLS_MODE_ARG=''; PUBLIC_DOMAIN_ARG=''
ensure_public_env_defaults
[[ "$(public_env_value TLS_POLICY)" == internal ]] # Internal mode survives an email and rerun.
TLS_MODE_ARG=acme; ensure_public_env_defaults
[[ "$(public_env_value TLS_POLICY)" == operator@example.org ]]
TLS_MODE_ARG=internal; ensure_public_env_defaults
cp "$ENV_FILE" "$fixture/before"
for bad_host in 'https://ticket.example.org' 'ticket.example.org:443' 'ticket.example.org/path' 'ticket.example.org { respond injected }' '256.1.1.1' '001.2.3.4' $'ticket.example.org\nTLS_POLICY=attacker'; do
  PUBLIC_DOMAIN_ARG="$bad_host"
  if ensure_public_env_defaults >/dev/null 2>&1; then echo "Accepted invalid hostname: $bad_host" >&2; exit 1; fi
  cmp "$fixture/before" "$ENV_FILE"
done
PUBLIC_DOMAIN_ARG=ticket.ubodigat.com
HTTPS_PORT=65536
if ensure_public_env_defaults >/dev/null 2>&1; then echo 'Invalid port accepted' >&2; exit 1; fi
cmp "$fixture/before" "$ENV_FILE"; unset HTTPS_PORT
ACME_EMAIL_ARG=$'attacker@example.org\nTLS_POLICY=other'
if ensure_public_env_defaults >/dev/null 2>&1; then echo 'Injected email accepted' >&2; exit 1; fi
cmp "$fixture/before" "$ENV_FILE"; ACME_EMAIL_ARG=''
PUBLIC_DOMAIN_ARG=192.0.2.55; TLS_MODE_ARG=acme
if ensure_public_env_defaults >/dev/null 2>&1; then echo 'ACME with IP accepted' >&2; exit 1; fi
cmp "$fixture/before" "$ENV_FILE"
PUBLIC_DOMAIN_ARG=ticket.ubodigat.com; TLS_MODE_ARG=internal

# Local probes must preserve SNI and verify a certificate; no -k / --insecure.
WEB_PROBE_CA_FILE="$fixture/root.crt"; WEB_PROBE_RESOLVE=ticket.ubodigat.com:8443:127.0.0.1
curl() { printf '%s\n' "$@" > "$fixture/curl-args"; [[ "${REJECT_CERT:-0}" == 0 ]] || return 60; printf '200 text/html; charset=utf-8'; }
probe_public_asset https://ticket.ubodigat.com:8443/index.html text/html
grep -Fxq -- --cacert "$fixture/curl-args"
grep -Fxq -- --resolve "$fixture/curl-args"
grep -Fxq -- https://ticket.ubodigat.com:8443/index.html "$fixture/curl-args"
! grep -Exq -- '-k|--insecure' "$fixture/curl-args"
if REJECT_CERT=1 probe_public_asset https://ticket.ubodigat.com:8443/index.html text/html; then echo 'Certificate failure ignored' >&2; exit 1; fi

# Exercise the narrow repair path with command test doubles (not real Docker).
mkdir -p "$fixture/repo/ops/docker"
cp "$ENV_FILE" "$fixture/repo/ops/docker/.env"
SCRIPT_DIR="$fixture/repo"
docker() { :; }
run_root() { printf '%s\n' "$*" >> "$fixture/docker-commands"; if [[ "${BAD_CADDY:-0}" == 1 && "$*" == *'caddy validate'* ]]; then return 1; fi; }
prepare_web_probe() { WEB_PROBE_CA_FILE=''; }
verify_public_web() { [[ "$1" == https://ticket.ubodigat.com:8443 ]]; }
web_failure_help() { :; }
configure_web_only > "$fixture/repair-output"
grep -q -- 'up -d --no-deps --force-recreate app caddy' "$fixture/docker-commands"
! grep -Eq -- 'schema|migrate|backup.sh|build|down|volume|mariadb' "$fixture/docker-commands"
[[ "$(public_env_value HTTPS_PORT)" == 8443 ]]
cp "$ENV_FILE" "$fixture/repair-before"
PUBLIC_DOMAIN_ARG=changed.example.org
if BAD_CADDY=1 configure_web_only > /dev/null 2>&1; then echo 'Bad Caddy configuration accepted' >&2; exit 1; fi
cmp "$fixture/repair-before" "$ENV_FILE"

# A bootstrap update must preserve source edits, staged changes and untracked inputs.
unset -f run_root
run_root() { "$@"; }
checkout="$fixture/checkout"
git init -q "$checkout"
printf '.env\n' > "$checkout/.gitignore"
printf 'reviewed\n' > "$checkout/source.txt"
git -C "$checkout" add .
git -C "$checkout" -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -qm fixture
printf 'secret\n' > "$checkout/.env"
assert_clean_install_checkout "$checkout"
printf 'local change\n' >> "$checkout/source.txt"
if assert_clean_install_checkout "$checkout" >/dev/null 2>&1; then echo 'Source change accepted' >&2; exit 1; fi
grep -q 'local change' "$checkout/source.txt"
git -C "$checkout" add source.txt
if assert_clean_install_checkout "$checkout" >/dev/null 2>&1; then echo 'Staged change accepted' >&2; exit 1; fi
git -C "$checkout" -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -qm fixture-change
printf 'untracked input\n' > "$checkout/new-source.txt"
if assert_clean_install_checkout "$checkout" >/dev/null 2>&1; then echo 'Untracked source accepted' >&2; exit 1; fi
grep -q 'untracked input' "$checkout/new-source.txt"
bash -n "$root/install.sh"
echo 'Web TLS: hostname/SNI configuration, LAN mode, port/secret preservation, strict probes and repair rollback: OK'
