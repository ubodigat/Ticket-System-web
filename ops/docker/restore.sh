#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
#
# Stellt ein mit backup.sh erstelltes Archiv wieder her: entschlüsselt, ersetzt den KEK
# (ops/secrets/app.kek) und importiert den MariaDB-Dump. ÜBERSCHREIBT die aktuelle Datenbank
# und den aktuellen Schlüssel vollständig -- nur für Wiederherstellung auf einem leeren/zu
# ersetzenden System gedacht, nicht zum Zusammenführen mit vorhandenen Daten.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"

ARCHIVE_PATH="${1:-}"
if [[ -z "$ARCHIVE_PATH" || ! -f "$ARCHIVE_PATH" ]]; then
  echo "Nutzung: $0 <pfad-zum-backup.tar.gz.enc>" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Nicht gefunden: $ENV_FILE -- zuerst ./install.sh ausführen." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "WARNUNG: Dies überschreibt die aktuelle Datenbank und den aktuellen Verschlüsselungsschlüssel"
echo "dieser Installation vollständig und unwiderruflich."
read -rp "Fortfahren? Tippe GENAU 'ja': " CONFIRM
if [[ "$CONFIRM" != "ja" ]]; then
  echo "Abgebrochen."
  exit 1
fi

PASSPHRASE="${BACKUP_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then
  read -rsp "Passphrase des Backups: " PASSPHRASE
  echo
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Entschlüssele Archiv..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "pass:$PASSPHRASE" -in "$ARCHIVE_PATH" | \
  tar -C "$WORK_DIR" -xzf -
unset PASSPHRASE

if [[ ! -f "$WORK_DIR/database.sql" || ! -f "$WORK_DIR/secrets/app.kek" ]]; then
  echo "Archiv unvollständig oder falsche Passphrase (database.sql/secrets/app.kek fehlen)." >&2
  exit 1
fi

echo "==> Stoppe Anwendung (Datenbank bleibt für den Import erreichbar)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop app

echo "==> Spiele Datenbank-Dump ein..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb \
  sh -c "exec mariadb -u'$DB_USER' -p'$DB_PASSWORD' '$DB_NAME'" \
  < "$WORK_DIR/database.sql"

echo "==> Stelle Schlüssel (KEK) und TLS-Zertifikate wieder her..."
mkdir -p "$SCRIPT_DIR/../secrets" "$SCRIPT_DIR/../tls"
cp "$WORK_DIR/secrets/app.kek" "$SCRIPT_DIR/../secrets/app.kek"
chmod 600 "$SCRIPT_DIR/../secrets/app.kek"
if [[ -d "$WORK_DIR/tls/mariadb" ]]; then
  cp -r "$WORK_DIR/tls/mariadb" "$SCRIPT_DIR/../tls/"
fi

echo "==> Starte Anwendung neu..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d app

echo
echo "==> Wiederherstellung abgeschlossen."
