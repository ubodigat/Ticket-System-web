#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
# One-command installer for the ticket system.
# Works in two modes:
# 1. Inside a cloned repository: configure secrets, TLS and Docker stack.
# 2. As downloaded standalone script: install base packages, clone repository, re-run from clone.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ubodigat/Ticket-System-web.git}"
INSTALL_MANIFEST_SHA256="${INSTALL_MANIFEST_SHA256:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ticket-system}"
DEV_MODE=false
ASSUME_YES=true
ENABLE_UPDATES=false
DISABLE_UPDATES=false
ENABLE_ANTIVIRUS=false
ENABLE_OFFICE_VIEWER=false
PUBLIC_DOMAIN_ARG=""
ACME_EMAIL_ARG=""

for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    --no-assume-yes) ASSUME_YES=false ;;
    --enable-updates) ENABLE_UPDATES=true ;;
    --disable-updates) DISABLE_UPDATES=true ;;
    --enable-antivirus) ENABLE_ANTIVIRUS=true ;;
    --enable-office-viewer) ENABLE_OFFICE_VIEWER=true ;;
    --domain=*) PUBLIC_DOMAIN_ARG="${arg#--domain=}" ;;
    --acme-email=*) ACME_EMAIL_ARG="${arg#--acme-email=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
if [[ "$ENABLE_UPDATES" == "true" && "$DISABLE_UPDATES" == "true" ]]; then
  echo "--enable-updates and --disable-updates cannot be combined." >&2
  exit 1
fi

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR="$PWD"
fi

log() {
  printf '\n==> %s\n' "$1"
}

warn() {
  printf '\nWARN: %s\n' "$1" >&2
}

print_installation_summary() {
  local reset='' bold='' green='' cyan='' dim='' setup_token
  if [[ -t 1 && "${TERM:-dumb}" != 'dumb' && -z "${NO_COLOR+x}" ]]; then
    reset=$'\033[0m'
    bold=$'\033[1m'
    green=$'\033[32m'
    cyan=$'\033[36m'
    dim=$'\033[2m'
  fi
  setup_token=$(grep '^SETUP_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  printf '\n%s%s%s\n' "$dim" '------------------------------------------------------------------------' "$reset"
  printf '  %s%sTICKET-SYSTEM%s\n' "$bold" "$cyan" "$reset"
  printf '  %s[OK] Installation abgeschlossen%s\n' "$green" "$reset"
  printf '  Container und lokale Webdateien erfolgreich geprüft.\n'
  printf '%s%s%s\n' "$dim" '------------------------------------------------------------------------' "$reset"

  printf '\n  %sZUGANG%s\n' "$bold" "$reset"
  printf '  Portal    %s%s%s\n' "$cyan" "$PUBLIC_URL" "$reset"
  printf '  Setup     %s%s/setup%s\n' "$cyan" "$PUBLIC_URL" "$reset"

  printf '\n  %sERSTE EINRICHTUNG%s\n' "$bold" "$reset"
  printf '  1. Setup-Adresse im Browser öffnen.\n'
  printf '  2. Setup-Token eingeben und das erste Superadmin-Konto anlegen.\n'
  printf '\n  Setup-Token (vertraulich):\n'
  printf '  %s%s%s\n' "$bold" "$setup_token" "$reset"
  printf '  Bis zum Abschluss der Einrichtung geheim halten.\n'

  printf '\n  %sBEI VERBINDUNGSPROBLEMEN%s\n' "$bold" "$reset"
  printf '  Die vollständige HTTPS-Adresse verwenden, nicht nur die IP.\n'
  printf '  Firewall auf Server, Proxmox/VM und Router prüfen (Ports 80/443\n'
  printf '  bzw. die in der Konfiguration festgelegten Ports).\n'
  printf '\n  Auf Server und Arbeitsplatz testen:\n'
  printf '    curl -k -I %s/index.html\n' "$PUBLIC_URL"
  printf '\n  Bei internen Zertifikaten die Caddy-CA auf den Endgeräten\n'
  printf '  als vertrauenswürdig installieren. -k überspringt nur im\n'
  printf '  Diagnosebefehl die Zertifikatsprüfung.\n'
  printf '  /health ist öffentlich absichtlich gesperrt (404).\n'

  printf '\n  %sINSTALLATIONSPFADE%s\n' "$bold" "$reset"
  printf '  Verzeichnis    %s\n' "$SCRIPT_DIR"
  printf '  Konfiguration  %s\n' "$ENV_FILE"
  printf '%s%s%s\n\n' "$dim" '------------------------------------------------------------------------' "$reset"
}

probe_public_asset() {
  local response
  # Internal Caddy certificates may not be trusted by the server itself yet. This is
  # only a readiness probe; browsers must still trust the CA for secure features.
  response=$(curl --insecure --silent --show-error --noproxy '*' --connect-timeout 3 --max-time 10 \
    --output /dev/null --write-out '%{http_code} %{content_type}' "$1" 2>/dev/null) || return 1
  [[ "$response" == "200 $2"* ]]
}

verify_public_web() {
  local base_url="$1" attempt file
  for ((attempt = 1; attempt <= 20; attempt++)); do
    if probe_public_asset "${base_url}/index.html" 'text/html'; then break; fi
    if [[ "$attempt" -eq 20 ]]; then
      echo "Public login page is not ready: ${base_url}/index.html" >&2
      return 1
    fi
    sleep 3
  done
  for file in script.js vendor/lucide.min.js; do
    if ! probe_public_asset "${base_url}/${file}" 'application/javascript'; then
      echo "Required JavaScript asset unavailable: ${base_url}/${file}" >&2
      return 1
    fi
  done
  for file in "$SCRIPT_DIR"/js/*.js; do
    [[ -f "$file" ]] || continue
    if ! probe_public_asset "${base_url}/js/${file##*/}" 'application/javascript'; then
      echo "Required frontend module unavailable: ${base_url}/js/${file##*/}" >&2
      return 1
    fi
  done
  probe_public_asset "${base_url}/style.css" 'text/css' || {
    echo "Required stylesheet unavailable: ${base_url}/style.css" >&2
    return 1
  }
}

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This step needs root permissions. Run the installer as root or install sudo." >&2
    exit 1
  fi
}

retry_root() {
  local max_attempts="$1"
  shift
  local attempt=1
  local delay=3
  until run_root "$@"; do
    if [[ "$attempt" -ge "$max_attempts" ]]; then
      return 1
    fi
    warn "Command failed; retrying in ${delay}s (${attempt}/${max_attempts}): $*"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

apt_install() {
  if [[ "$ASSUME_YES" == "true" ]]; then
    run_root apt-get install -y "$@"
  else
    run_root apt-get install "$@"
  fi
}

ensure_apt_system() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Automatic bootstrap currently supports Debian/Ubuntu systems with apt-get." >&2
    echo "Manual path: install git, docker, docker compose and openssl, then run ./install.sh." >&2
    exit 1
  fi
}

ensure_base_packages() {
  ensure_apt_system
  log "Installing base packages"
  run_root apt-get update
  apt_install ca-certificates curl git openssl gnupg lsb-release
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && run_root docker compose version >/dev/null 2>&1; then
    return
  fi

  ensure_apt_system
  log "Installing Docker and Docker Compose plugin"

  if ! command -v docker >/dev/null 2>&1 || ! run_root docker compose version >/dev/null 2>&1; then
    # Use Docker's signed apt repository instead of piping a downloaded shell script into sh.
    # This keeps the bootstrap auditable and lets apt verify package signatures.
    . /etc/os-release
    local distro="${ID:-debian}"
    local codename="${VERSION_CODENAME:-}"
    if [[ -z "$codename" && -r /etc/debian_version ]]; then
      codename="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-}")"
    fi
    if [[ "$distro" != "ubuntu" ]]; then
      distro="debian"
    fi
    if [[ -z "$codename" ]]; then
      echo "Could not detect Debian/Ubuntu codename for Docker repository." >&2
      exit 1
    fi

    run_root install -m 0755 -d /etc/apt/keyrings
    run_root rm -f /etc/apt/keyrings/docker.asc
    curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o /tmp/docker.asc
    run_root install -m 0644 /tmp/docker.asc /etc/apt/keyrings/docker.asc
    rm -f /tmp/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${distro} ${codename} stable" \
      | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
    run_root apt-get update
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  if ! run_root docker compose version >/dev/null 2>&1; then
    echo "Docker was installed, but 'docker compose' is still unavailable." >&2
    echo "Please install the Docker Compose plugin and run this installer again." >&2
    exit 1
  fi

  run_root systemctl enable --now docker >/dev/null 2>&1 || true
}

detect_primary_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s\n' "${ip:-localhost}"
}

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" 'BEGIN { prefix=key "=" } index($0, prefix) == 1 { print key "=" value; next } { print }' "$file" > "$tmp_file"
    cat "$tmp_file" > "$file"
    rm -f "$tmp_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

ensure_public_env_defaults() {
  local primary_ip
  primary_ip="$(detect_primary_ip)"

  set_env_var "HTTP_PORT" "${HTTP_PORT:-80}" "$ENV_FILE"
  set_env_var "HTTPS_PORT" "${HTTPS_PORT:-443}" "$ENV_FILE"
  set_env_var "BIND_ADDRESS" "${BIND_ADDRESS:-0.0.0.0}" "$ENV_FILE"
  if ! grep -q '^UPDATE_TOKEN=' "$ENV_FILE"; then
    set_env_var "UPDATE_TOKEN" "$(openssl rand -base64 48)" "$ENV_FILE"
  fi

  if [[ -n "$PUBLIC_DOMAIN_ARG" ]]; then
    set_env_var "PUBLIC_DOMAIN" "$PUBLIC_DOMAIN_ARG" "$ENV_FILE"
  elif ! grep -q '^PUBLIC_DOMAIN=' "$ENV_FILE" || grep -Eq '^PUBLIC_DOMAIN=(localhost|127\.0\.0\.1)?$' "$ENV_FILE"; then
    set_env_var "PUBLIC_DOMAIN" "$primary_ip" "$ENV_FILE"
  fi

  if [[ -n "$ACME_EMAIL_ARG" ]]; then
    set_env_var "ACME_EMAIL" "$ACME_EMAIL_ARG" "$ENV_FILE"
  fi

  # Security-Audit B5: "tls internal" (selbstsigniertes Caddy-CA-Zertifikat, löst
  # Browser-Zertifikatswarnungen aus) ist nur für IP-Adressen/localhost/--dev sinnvoll -- Let's
  # Encrypt kann dafür ohnehin kein öffentlich vertrauenswürdiges Zertifikat ausstellen. Wurde
  # eine echte Domain per --domain übergeben (oder steht bereits eine in .env), nutzt Caddy
  # automatisch ACME/Let's Encrypt (siehe Caddyfile: "tls {$TLS_POLICY:internal}").
  local current_domain
  current_domain="$(grep '^PUBLIC_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  local current_acme_email
  current_acme_email="$(grep '^ACME_EMAIL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  if [[ "$DEV_MODE" == "true" || -z "$current_domain" || "$current_domain" == "localhost" \
        || "$current_domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$current_domain" == "127.0.0.1" ]]; then
    set_env_var "TLS_POLICY" "internal" "$ENV_FILE"
  else
    if [[ -z "$current_acme_email" || "$current_acme_email" == "admin@example.invalid" ]]; then
      warn "PUBLIC_DOMAIN ($current_domain) looks like a real domain, but no --acme-email was given and ACME_EMAIL in .env is still the placeholder. Falling back to tls internal (browser warnings) until a real ACME_EMAIL is set."
      set_env_var "TLS_POLICY" "internal" "$ENV_FILE"
    else
      set_env_var "TLS_POLICY" "$current_acme_email" "$ENV_FILE"
    fi
  fi
}

open_firewall_ports() {
  local opened=false

  if command -v ufw >/dev/null 2>&1 && run_root ufw status 2>/dev/null | grep -qi '^Status: active'; then
    log "Opening firewall ports 80/tcp and 443/tcp with ufw"
    run_root ufw allow 80/tcp >/dev/null || true
    run_root ufw allow 443/tcp >/dev/null || true
    opened=true
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && run_root firewall-cmd --state >/dev/null 2>&1; then
    log "Opening firewall ports 80/tcp and 443/tcp with firewalld"
    run_root firewall-cmd --permanent --add-service=http >/dev/null || true
    run_root firewall-cmd --permanent --add-service=https >/dev/null || true
    run_root firewall-cmd --reload >/dev/null || true
    opened=true
  fi

  if [[ "$opened" == "false" ]]; then
    warn "No active ufw/firewalld detected. If the site is unreachable from another device, allow TCP ports 80 and 443 in the server, VM, router or provider firewall."
  fi
}

repo_host() {
  local without_scheme="${REPO_URL#*://}"
  printf '%s\n' "${without_scheme%%/*}"
}

print_clone_help() {
  local host
  host="$(repo_host)"
  cat >&2 <<EOF

Repository download failed.

Check these points on the server:
  - DNS/network access to: $host
  - outbound HTTPS on port 443
  - REPO_URL if you use a fork or private mirror

Manual fallback:
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  ./install.sh
EOF
}

verify_installation() {
  local dir="$1"
  (
    cd "$dir"
    printf '%s  install-manifest.sha256\n' "$INSTALL_MANIFEST_SHA256" | sha256sum -c - || exit 1
    sha256sum --strict -c install-manifest.sha256 || exit 1
    # Additional tracked files can affect a Docker build even when all known files match.
    diff -u <(git ls-files | grep -v -E '^(README.md|install-manifest.sha256)$' | LC_ALL=C sort) \
      <(sed 's/^[a-f0-9]\{64\}  //' install-manifest.sha256 | LC_ALL=C sort)
  )
}

rerun_from_clone_if_needed() {
  if [[ -f "$SCRIPT_DIR/ops/docker/docker-compose.yml" && -f "$SCRIPT_DIR/package.json" ]]; then
    if [[ -n "$INSTALL_MANIFEST_SHA256" ]]; then
      verify_installation "$SCRIPT_DIR"
    fi
    return
  fi

  if [[ ! "$INSTALL_MANIFEST_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
    echo 'Standalone installation requires INSTALL_MANIFEST_SHA256 from the reviewed README command. Unverified curl | bash is not supported.' >&2
    exit 1
  fi

  ensure_base_packages
  ensure_docker

  log "Cloning repository"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    # This clone is exclusively installer-managed; nobody is expected to hand-edit files in it
    # (secrets live outside Git in ops/docker/.env, see .gitignore). Even so, the working tree
    # can end up looking "locally modified" without anyone touching anything -- e.g. a later
    # .gitattributes change (added eol=lf normalization) makes Git re-evaluate already-checked-
    # out files against the new rule and treat them as dirty. "git pull --ff-only" then refuses
    # to merge, over and over, even though nothing meaningful actually changed. Resetting to the
    # last known commit right before every pull makes that class of failure impossible: it only
    # discards tracked-file drift (which should never be intentional here), never the untracked,
    # gitignored secrets.
    retry_root 5 bash -c 'git -C "$1" reset --hard HEAD >/dev/null && git -C "$1" pull --ff-only' _ "$INSTALL_DIR" \
      || { print_clone_help; exit 1; }
  else
    run_root mkdir -p "$(dirname "$INSTALL_DIR")"
    if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
      echo "Installation directory exists but is not a Git repository: $INSTALL_DIR" >&2
      exit 1
    fi
    retry_root 5 git clone "$REPO_URL" "$INSTALL_DIR" || { print_clone_help; exit 1; }
  fi

  run_root chown -R "$(id -u):$(id -g)" "$INSTALL_DIR" 2>/dev/null || true
  verify_installation "$INSTALL_DIR"
  export INSTALL_MANIFEST_SHA256
  log "Continuing installation from $INSTALL_DIR"
  exec bash "$INSTALL_DIR/install.sh" "$@"
}

make_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    local hex
    hex="$(openssl rand -hex 16)"
    printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
  fi
}

rerun_from_clone_if_needed "$@"
ensure_base_packages
ensure_docker

COMPOSE_DIR="$SCRIPT_DIR/ops/docker"
SECRETS_DIR="$SCRIPT_DIR/ops/secrets"
TLS_DIR="$SCRIPT_DIR/ops/tls/mariadb"
ENV_FILE="$COMPOSE_DIR/.env"

run_root mkdir -p "$SECRETS_DIR" "$TLS_DIR"
run_root chown -R "$(id -u):$(id -g)" "$SCRIPT_DIR/ops" 2>/dev/null || true

if [[ -f "$ENV_FILE" ]]; then
  log "Existing installation found; reusing secrets"
else
  log "Generating installation secrets"
  DB_NAME="ticketsystem"
  DB_USER="ticketapp"
  DB_PASSWORD="$(openssl rand -base64 32)"
  DB_ROOT_PASSWORD="$(openssl rand -hex 32)"
  DB_RUNTIME_USER="${DB_USER}_rt"
  DB_RUNTIME_PASSWORD="$(openssl rand -base64 32)"
  COOKIE_SECRET="$(openssl rand -base64 48)"
  UPDATE_TOKEN="$(openssl rand -base64 48)"
  SETUP_TOKEN="$(openssl rand -hex 32)"
  INSTALLATION_ID="$(make_uuid)"

  DEFAULT_IP=$(detect_primary_ip)
  cat > "$ENV_FILE" <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_ROOT_PASSWORD=$DB_ROOT_PASSWORD
DB_RUNTIME_USER=$DB_RUNTIME_USER
DB_RUNTIME_PASSWORD=$DB_RUNTIME_PASSWORD
COOKIE_SECRET=$COOKIE_SECRET
UPDATE_TOKEN=$UPDATE_TOKEN
SETUP_TOKEN=$SETUP_TOKEN
INSTALLATION_ID=$INSTALLATION_ID
HTTP_PORT=80
HTTPS_PORT=443
BIND_ADDRESS=0.0.0.0
PUBLIC_DOMAIN=${DEFAULT_IP:-localhost}
ACME_EMAIL=admin@example.invalid
EOF
  chmod 600 "$ENV_FILE"
fi

# Security-Audit N9: eingeschraenktes Laufzeit-DB-Konto fuer Installationen von VOR diesem
# Update nachtragen (neue Installationen bekommen es bereits oben in .env).
if ! grep -q '^DB_RUNTIME_USER=' "$ENV_FILE"; then
  EXISTING_DB_USER="$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)"
  set_env_var "DB_RUNTIME_USER" "${EXISTING_DB_USER}_rt" "$ENV_FILE"
  set_env_var "DB_RUNTIME_PASSWORD" "$(openssl rand -base64 32)" "$ENV_FILE"
fi

# Runtime accounts are provisioned after the DB healthcheck with verified root credentials.
# This also works for existing volumes; initdb.d scripts only run on empty volumes.

# Wer zwischen Installation und erstem Setup-Aufruf die Server-IP erreicht, würde sonst das
# erste (Superadmin-)Konto anlegen können (B4 im Security-Audit) -- Installationen von vor
# diesem Fix bekommen das Token bei einem erneuten install.sh-Lauf nachgetragen.
if ! grep -q '^SETUP_TOKEN=' "$ENV_FILE"; then
  set_env_var "SETUP_TOKEN" "$(openssl rand -hex 32)" "$ENV_FILE"
fi

ensure_public_env_defaults

# Fixed relying-party origin for WebAuthn, including a custom HTTPS port.
MFA_DOMAIN="$(grep '^PUBLIC_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
MFA_PORT="$(grep '^HTTPS_PORT=' "$ENV_FILE" | cut -d= -f2-)"
MFA_PUBLIC_URL="https://${MFA_DOMAIN}"
if [[ "$MFA_PORT" != "443" ]]; then MFA_PUBLIC_URL="${MFA_PUBLIC_URL}:${MFA_PORT}"; fi
set_env_var "PUBLIC_URL" "$MFA_PUBLIC_URL" "$ENV_FILE"

COMPOSE_PROFILES_LIST=""
if [[ "$ENABLE_OFFICE_VIEWER" == "true" ]] || grep -q '^ONLYOFFICE_ENABLED=true$' "$ENV_FILE"; then
  log "Enabling read-only ONLYOFFICE view (reserve an additional 4 GB RAM)"
  COMPOSE_PROFILES_LIST="office-viewer"
  set_env_var "ONLYOFFICE_ENABLED" "true" "$ENV_FILE"
  if ! grep -q '^ONLYOFFICE_JWT_SECRET=.' "$ENV_FILE"; then
    set_env_var "ONLYOFFICE_JWT_SECRET" "$(openssl rand -hex 32)" "$ENV_FILE"
  fi
fi
if [[ "$ENABLE_UPDATES" == "true" ]]; then
  log "Enabling in-app updates (the updater requires Docker host privileges)"
  COMPOSE_PROFILES_LIST="${COMPOSE_PROFILES_LIST:+$COMPOSE_PROFILES_LIST,}dangerous-updater"
  set_env_var "UPDATE_SERVICE_URL" "http://updater:3099" "$ENV_FILE"
  set_env_var "UPDATE_ALLOW_MAIN_DEPLOY" "true" "$ENV_FILE"
  set_env_var "UPDATE_REPO_DIR" "$SCRIPT_DIR" "$ENV_FILE"
  # Ohne geprueften Schluessel lehnt der Updater jedes Update ab -- frueh und deutlich warnen.
  UPDATE_KEYS="$( { command -v gpg >/dev/null 2>&1 && gpg --homedir "$COMPOSE_DIR/update-keys" --list-keys --with-colons 2>/dev/null; } || true)"
  if ! grep -q '^pub:' <<<"$UPDATE_KEYS"; then
    echo "WARNING: no trusted signing key found in ops/docker/update-keys -- every update will be rejected until a verified key is imported (README: 'Online-Updater bewusst aktivieren')." >&2
  fi
fi
if [[ "$DISABLE_UPDATES" == "true" ]]; then
  log "Disabling in-app updates (removing the updater and its Docker host access)"
  set_env_var "UPDATE_SERVICE_URL" "" "$ENV_FILE"
  set_env_var "UPDATE_ALLOW_MAIN_DEPLOY" "false" "$ENV_FILE"
  # Gemeinsames Geheimnis App<->Updater erneuern: ein frueher ausgelesener Wert gilt nirgends mehr.
  set_env_var "UPDATE_TOKEN" "$(openssl rand -base64 48)" "$ENV_FILE"
  REMAINING_PROFILES="$({ grep '^COMPOSE_PROFILES=' "$ENV_FILE" || true; } | cut -d= -f2- | tr ',' '\n' | { grep -vx 'dangerous-updater' || true; } | paste -sd, -)"
  set_env_var "COMPOSE_PROFILES" "$REMAINING_PROFILES" "$ENV_FILE"
fi
if [[ "$ENABLE_ANTIVIRUS" == "true" ]]; then
  # Security-Audit B7: ClamAV-Virenscan fuer Anhaenge, optional (deutlicher Ressourcenbedarf --
  # ca. 1-2GB RAM, erster Start dauert wegen des Signatur-Downloads mehrere Minuten).
  log "Enabling ClamAV virus scanning for attachments (several minutes on first start, ~1-2GB RAM)"
  COMPOSE_PROFILES_LIST="${COMPOSE_PROFILES_LIST:+$COMPOSE_PROFILES_LIST,}antivirus"
  set_env_var "CLAMAV_HOST" "clamav" "$ENV_FILE"
  set_env_var "CLAMAV_PORT" "3310" "$ENV_FILE"
fi
if [[ -n "$COMPOSE_PROFILES_LIST" ]]; then
  set_env_var "COMPOSE_PROFILES" "$COMPOSE_PROFILES_LIST" "$ENV_FILE"
fi

KEK_PATH="$SECRETS_DIR/app.kek"
if [[ -f "$KEK_PATH" ]]; then
  log "Existing KEK found; keeping it"
else
  log "Generating KEK"
  openssl rand -base64 32 > "$KEK_PATH"
  chmod 600 "$KEK_PATH"
fi
run_root chown 10001 "$KEK_PATH" 2>/dev/null || true

CA_KEY="$TLS_DIR/ca-key.pem"
CA_CERT="$TLS_DIR/ca.pem"
SERVER_KEY="$TLS_DIR/server-key.pem"
SERVER_CERT="$TLS_DIR/server-cert.pem"

if [[ -f "$CA_CERT" && -f "$SERVER_CERT" ]]; then
  log "Existing MariaDB TLS certificates found; keeping them"
else
  log "Generating internal MariaDB TLS certificates"
  openssl genrsa -out "$CA_KEY" 4096 >/dev/null 2>&1
  openssl req -x509 -new -nodes -key "$CA_KEY" -sha256 -days 3650 \
    -subj "/CN=TicketSystem-Internal-CA" -out "$CA_CERT" >/dev/null 2>&1

  openssl genrsa -out "$SERVER_KEY" 2048 >/dev/null 2>&1
  openssl req -new -key "$SERVER_KEY" -subj "/CN=mariadb" \
    -out "$TLS_DIR/server.csr" >/dev/null 2>&1
  openssl x509 -req -in "$TLS_DIR/server.csr" -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -CAcreateserial -out "$SERVER_CERT" -days 3650 -sha256 >/dev/null 2>&1
  rm -f "$TLS_DIR/server.csr"
  chmod 600 "$CA_KEY" "$SERVER_KEY"
  chmod 644 "$CA_CERT" "$SERVER_CERT"
fi
run_root chown 999 "$CA_KEY" "$SERVER_KEY" 2>/dev/null || true

if [[ "$DEV_MODE" == "true" ]]; then
  log "Development mode active; using internal HTTPS certificates"
fi

open_firewall_ports

log "Building and starting Docker stack"
set_env_var "APP_COMMIT" "$(git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)" "$ENV_FILE"
set_env_var "APP_BUILT_AT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENV_FILE"
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" build --no-cache app
if [[ -f "$ENV_FILE" ]] && ! grep -q '^DB_ROOT_PASSWORD=.' "$ENV_FILE"; then
  log "Recovering existing database root credential before container replacement"
  run_root sh "$SCRIPT_DIR/ops/docker/provision-db.sh" "$SCRIPT_DIR" --recover-only
fi
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --force-recreate --remove-orphans mariadb

log "Waiting for database healthcheck"
ATTEMPTS=0
MAX_ATTEMPTS=40
until run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" ps mariadb --format json \
  | grep -q '"Health":"healthy"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; then
    echo "The database did not become healthy after ${MAX_ATTEMPTS} attempts." >&2
    echo "Check logs with:" >&2
    echo "docker compose -f '$COMPOSE_DIR/docker-compose.yml' --env-file '$ENV_FILE' logs mariadb" >&2
    exit 1
  fi
  sleep 3
done

log "Provisioning and verifying runtime database credentials"
run_root sh "$SCRIPT_DIR/ops/docker/provision-db.sh" "$SCRIPT_DIR"

log "Running database migrations"
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" stop --timeout 30 app
# Security-Audit N9: DB_USER/DB_PASSWORD (volle DDL-Rechte) stehen nicht mehr in der staendigen
# Service-Umgebung von "app" (siehe docker-compose.yml) -- nur fuer diesen einen, kurzlebigen
# Migrations-Aufruf per -e injiziert.
printf '%s\n%s\n' "$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)" \
  "$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)" \
  | run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" run --rm --no-deps -T \
    app sh -c 'set -eu; IFS= read -r DB_USER; IFS= read -r DB_PASSWORD; export DB_USER DB_PASSWORD; exec node dist/db/migrate.js'

if [[ "$DISABLE_UPDATES" == "true" ]]; then
  log "Removing the updater container"
  run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" --profile dangerous-updater rm --stop --force updater
  if [[ -n "$(run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" --profile dangerous-updater ps --all --quiet updater)" ]]; then
    echo "The updater container is still present -- in-app updates were NOT fully disabled." >&2
    exit 1
  fi
fi

log "Starting application stack"
if grep -q '^ONLYOFFICE_ENABLED=true$' "$ENV_FILE"; then
  run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" --profile office-viewer up -d --force-recreate documentserver
fi
if grep -q '^UPDATE_ALLOW_MAIN_DEPLOY=true$' "$ENV_FILE"; then
  run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" --profile dangerous-updater up -d --build --force-recreate updater
fi
if [[ "$ENABLE_ANTIVIRUS" == "true" ]]; then
  run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" --profile antivirus up -d --force-recreate clamav
fi
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --force-recreate --remove-orphans app caddy

log "Waiting for app healthcheck"
ATTEMPTS=0
MAX_ATTEMPTS=40
until run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" ps app --format json \
  | grep -q '"Health":"healthy"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; then
    echo "The application did not become healthy after ${MAX_ATTEMPTS} attempts." >&2
    echo "Check logs with:" >&2
    echo "docker compose -f '$COMPOSE_DIR/docker-compose.yml' --env-file '$ENV_FILE' logs app" >&2
    exit 1
  fi
  sleep 3
done

# shellcheck disable=SC1090
source "$ENV_FILE"
PUBLIC_URL="https://${PUBLIC_DOMAIN}"
if [[ "${HTTPS_PORT:-443}" != "443" ]]; then
  PUBLIC_URL="${PUBLIC_URL}:${HTTPS_PORT}"
fi

log "Checking public login page and frontend assets"
if ! verify_public_web "$PUBLIC_URL"; then
  echo "Installation is not ready: the public website or a required asset could not be loaded." >&2
  echo "Internal app health alone does not verify the reverse proxy or login scripts." >&2
  echo "Check logs with:" >&2
  echo "docker compose -f '$COMPOSE_DIR/docker-compose.yml' --env-file '$ENV_FILE' logs --tail=80 app caddy" >&2
  exit 1
fi

print_installation_summary
