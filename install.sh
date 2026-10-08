#!/usr/bin/env bash
# Ein-Befehl-Installation gemäß docs/SPEC.md §4. Erzeugt alle Secrets, TLS-Zertifikate für die
# App<->MariaDB-Verbindung und die KEK, startet den Stack über docker compose, wartet auf den
# Healthcheck und gibt am Ende eine Erfolgsmeldung mit dem Link zur Einrichtungsseite aus.
#
# Phase-1-Stand: deckt das Grundgerüst ab (DB-Verschlüsselung, Secrets, Healthcheck). Der
# Einrichtungsassistent (Web-UI für Unternehmenseinstellungen/Anfangsbenutzer, docs/SPEC.md §5)
# folgt in einer späteren Phase gemäß docs/PROGRESS.md -- dieses Skript legt dafür bereits die
# INSTALLATION_ID und den initialen DB-Zustand an.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/ops/docker"
SECRETS_DIR="$SCRIPT_DIR/ops/secrets"
TLS_DIR="$SCRIPT_DIR/ops/tls/mariadb"
ENV_FILE="$COMPOSE_DIR/.env"
DEV_MODE=false

for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Fehler: '$1' wird benötigt, ist aber nicht installiert." >&2
    exit 1
  fi
}

require_cmd docker
require_cmd openssl
if ! docker compose version >/dev/null 2>&1; then
  echo "Fehler: 'docker compose' (Plugin) wird benötigt." >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR" "$TLS_DIR"

# -- Secrets: nur erzeugen, wenn noch nicht vorhanden (Idempotenz, docs/SPEC.md §4.2) ----------
if [[ -f "$ENV_FILE" ]]; then
  echo "Vorhandene Installation gefunden ($ENV_FILE) -- bestehende Secrets werden wiederverwendet."
else
  echo "Erzeuge neue Secrets..."
  DB_NAME="ticketsystem"
  DB_USER="ticketapp"
  DB_PASSWORD="$(openssl rand -base64 32)"
  COOKIE_SECRET="$(openssl rand -base64 48)"
  INSTALLATION_ID="$(
    if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr '[:upper:]' '[:lower:]'
    else node -e "console.log(require('crypto').randomUUID())"
    fi
  )"

  cat > "$ENV_FILE" <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
COOKIE_SECRET=$COOKIE_SECRET
INSTALLATION_ID=$INSTALLATION_ID
HTTP_PORT=80
HTTPS_PORT=443
PUBLIC_DOMAIN=localhost
EOF
  chmod 600 "$ENV_FILE"
fi

# -- KEK (App-seitige Schlüsselverschlüsselungsschlüssel) --------------------------------------
# docs/CRYPTOGRAPHY.md §1/§6, docs/adr/0002: niemals in der Datenbank, niemals im normalen
# Backup. Datei bekommt restriktive Rechte; Container-UID/GID siehe Dockerfile.server (10001).
KEK_PATH="$SECRETS_DIR/app.kek"
if [[ -f "$KEK_PATH" ]]; then
  echo "Vorhandene KEK gefunden -- wird nicht überschrieben."
else
  echo "Erzeuge neuen KEK (256 Bit)..."
  openssl rand -base64 32 > "$KEK_PATH"
  chmod 600 "$KEK_PATH"
fi

# -- TLS für App<->MariaDB (docs/CRYPTOGRAPHY.md §8) --------------------------------------------
CA_KEY="$TLS_DIR/ca-key.pem"
CA_CERT="$TLS_DIR/ca.pem"
SERVER_KEY="$TLS_DIR/server-key.pem"
SERVER_CERT="$TLS_DIR/server-cert.pem"

if [[ -f "$CA_CERT" && -f "$SERVER_CERT" ]]; then
  echo "Vorhandene MariaDB-TLS-Zertifikate gefunden -- werden nicht neu erzeugt."
else
  echo "Erzeuge selbstsignierte TLS-Zertifikatskette für die App<->MariaDB-Verbindung..."
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
  echo "Hinweis: --dev aktiv. ACME/öffentliches TLS für Caddy wird übersprungen (localhost)."
fi

# -- Stack starten --------------------------------------------------------------------------
echo "Baue und starte den Stack (docker compose)..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --build

echo "Warte auf Healthcheck der Anwendung..."
ATTEMPTS=0
MAX_ATTEMPTS=40
until docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" ps app --format json \
  | grep -q '"Health":"healthy"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; then
    echo "Fehler: Die Anwendung wurde nach ${MAX_ATTEMPTS} Versuchen nicht gesund (healthy)." >&2
    echo "Prüfe die Logs mit: docker compose -f '$COMPOSE_DIR/docker-compose.yml' logs app" >&2
    exit 1
  fi
  sleep 3
done

echo "Führe Datenbankmigrationen aus..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$ENV_FILE" exec -T app node dist/db/migrate.js

source "$ENV_FILE"
PUBLIC_URL="https://${PUBLIC_DOMAIN}"
if [[ "$DEV_MODE" == "true" || "$PUBLIC_DOMAIN" == "localhost" ]]; then
  PUBLIC_URL="http://localhost:${HTTP_PORT}"
fi

cat <<EOF

================================================================================
  Installation abgeschlossen.
  Ticket-System ist erreichbar unter: $PUBLIC_URL
  Öffne die Adresse im Browser, um den Einrichtungsassistenten zu starten.
================================================================================
EOF
