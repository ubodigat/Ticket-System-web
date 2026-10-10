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
INSTALL_DIR="${INSTALL_DIR:-/opt/ticket-system}"
DEV_MODE=false
ASSUME_YES=true

for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    --no-assume-yes) ASSUME_YES=false ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

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

  if ! grep -q '^PUBLIC_DOMAIN=' "$ENV_FILE" || grep -Eq '^PUBLIC_DOMAIN=(localhost|127\.0\.0\.1)?$' "$ENV_FILE"; then
    set_env_var "PUBLIC_DOMAIN" "$primary_ip" "$ENV_FILE"
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

rerun_from_clone_if_needed() {
  if [[ -f "$SCRIPT_DIR/ops/docker/docker-compose.yml" && -f "$SCRIPT_DIR/package.json" ]]; then
    return
  fi

  ensure_base_packages
  ensure_docker

  log "Cloning repository"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    retry_root 5 git -C "$INSTALL_DIR" pull --ff-only || { print_clone_help; exit 1; }
  else
    run_root mkdir -p "$(dirname "$INSTALL_DIR")"
    if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
      echo "Installation directory exists but is not a Git repository: $INSTALL_DIR" >&2
      exit 1
    fi
    retry_root 5 git clone "$REPO_URL" "$INSTALL_DIR" || { print_clone_help; exit 1; }
  fi

  run_root chown -R "$(id -u):$(id -g)" "$INSTALL_DIR" 2>/dev/null || true
  run_root chmod +x "$INSTALL_DIR/install.sh"
  log "Continuing installation from $INSTALL_DIR"
  exec "$INSTALL_DIR/install.sh" "$@"
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
  COOKIE_SECRET="$(openssl rand -base64 48)"
  INSTALLATION_ID="$(make_uuid)"

  DEFAULT_IP=$(detect_primary_ip)
  cat > "$ENV_FILE" <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
COOKIE_SECRET=$COOKIE_SECRET
INSTALLATION_ID=$INSTALLATION_ID
HTTP_PORT=80
HTTPS_PORT=443
BIND_ADDRESS=0.0.0.0
PUBLIC_DOMAIN=${DEFAULT_IP:-localhost}
ACME_EMAIL=admin@example.invalid
EOF
  chmod 600 "$ENV_FILE"
fi

ensure_public_env_defaults

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
  log "Development mode active; using localhost HTTP"
fi

open_firewall_ports

log "Building and starting Docker stack"
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" build --no-cache app
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --force-recreate

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

log "Running database migrations"
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" exec -T app node dist/db/migrate.js

# shellcheck disable=SC1090
source "$ENV_FILE"
PUBLIC_URL="https://${PUBLIC_DOMAIN}"
if [[ "$DEV_MODE" == "true" || "$PUBLIC_DOMAIN" == "localhost" ]]; then
  PUBLIC_URL="http://localhost:${HTTP_PORT}"
fi

log "Checking local web reachability"
if ! curl -kfsS --max-time 10 "https://${PUBLIC_DOMAIN}/health" >/dev/null 2>&1; then
  warn "Local HTTPS check for https://${PUBLIC_DOMAIN}/health failed. The containers may still be starting; check Docker logs if the browser cannot connect."
fi

cat <<EOF

================================================================================
  Installation completed.
  Ticket system URL: $PUBLIC_URL
  Setup URL:         ${PUBLIC_URL}/setup
  Open the URL in your browser and complete the setup assistant.

  If the browser on another device shows ERR_CONNECTION_REFUSED:
    1. Check that you open the HTTPS URL above, not only the bare IP address.
    2. Check host/provider/VM/router firewall rules for TCP ports 80 and 443.
    3. Test from the server:
       curl -k -I https://${PUBLIC_DOMAIN}/health
    4. Test from the client:
       curl -k -I https://${PUBLIC_DOMAIN}/health

  Install directory: $SCRIPT_DIR
  Docker env file:   $ENV_FILE
================================================================================
EOF
