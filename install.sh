#!/usr/bin/env bash
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '\n==> %s\n' "$1"
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
  run_root apt-get update

  if ! command -v docker >/dev/null 2>&1; then
    apt_install docker.io
  fi

  if ! run_root docker compose version >/dev/null 2>&1; then
    apt_install docker-compose-plugin || true
  fi

  if ! run_root docker compose version >/dev/null 2>&1; then
    log "Docker Compose plugin not available from the default repository; installing Docker from official script"
    curl -fsSL https://get.docker.com | run_root sh
  fi

  if ! run_root docker compose version >/dev/null 2>&1; then
    echo "Docker was installed, but 'docker compose' is still unavailable." >&2
    echo "Please install the Docker Compose plugin and run this installer again." >&2
    exit 1
  fi

  run_root systemctl enable --now docker >/dev/null 2>&1 || true
}

rerun_from_clone_if_needed() {
  if [[ -f "$SCRIPT_DIR/ops/docker/docker-compose.yml" && -f "$SCRIPT_DIR/package.json" ]]; then
    return
  fi

  ensure_base_packages
  ensure_docker

  log "Cloning repository"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    run_root git -C "$INSTALL_DIR" pull --ff-only
  else
    run_root mkdir -p "$(dirname "$INSTALL_DIR")"
    if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
      echo "Installation directory exists but is not a Git repository: $INSTALL_DIR" >&2
      exit 1
    fi
    run_root git clone "$REPO_URL" "$INSTALL_DIR"
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

  cat > "$ENV_FILE" <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
COOKIE_SECRET=$COOKIE_SECRET
INSTALLATION_ID=$INSTALLATION_ID
HTTP_PORT=80
HTTPS_PORT=443
PUBLIC_DOMAIN=localhost
ACME_EMAIL=admin@example.invalid
EOF
  chmod 600 "$ENV_FILE"
fi

KEK_PATH="$SECRETS_DIR/app.kek"
if [[ -f "$KEK_PATH" ]]; then
  log "Existing KEK found; keeping it"
else
  log "Generating KEK"
  openssl rand -base64 32 > "$KEK_PATH"
  chmod 600 "$KEK_PATH"
fi

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

if [[ "$DEV_MODE" == "true" ]]; then
  log "Development mode active; using localhost HTTP"
fi

log "Building and starting Docker stack"
run_root docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --build

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

cat <<EOF

================================================================================
  Installation completed.
  Ticket system URL: $PUBLIC_URL
  Open the URL in your browser and complete the setup assistant.

  Install directory: $SCRIPT_DIR
  Docker env file:   $ENV_FILE
================================================================================
EOF
