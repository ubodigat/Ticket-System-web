#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
#
# Vollsicherung: MariaDB-Dump (alle Geschäftsdaten, liegen dort bereits AES-256-GCM-verschlüsselt)
# + der KEK (ops/secrets/app.kek), ohne den der Dump wertlos ist (Schlüsselverschlüsselungsschlüssel
# für alle Datenentschlüsselungsschlüssel, siehe apps/server/src/crypto/keyProvider.ts).
#
# Das fertige Archiv wird selbst noch einmal mit einer eigenen Passphrase verschlüsselt
# (openssl enc, AES-256-CBC + PBKDF2) -- ein Backup, das DB-Dump UND Schlüssel im Klartext
# zusammen enthält, wäre sonst selbst die "Sicherheitslücke offene Backup-Dateien" aus der
# Anforderungsliste. Ohne Passphrase ist das Archiv nutzlos, auch wenn es irgendwo offen liegt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Nicht gefunden: $ENV_FILE -- zuerst ./install.sh ausführen." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

KEK_PATH="$SCRIPT_DIR/../secrets/app.kek"
if [[ ! -f "$KEK_PATH" ]]; then
  echo "Nicht gefunden: $KEK_PATH -- ohne den Schlüssel ist jedes Backup wertlos." >&2
  exit 1
fi

PASSPHRASE="${BACKUP_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then
  read -rsp "Passphrase zur Verschlüsselung des Backups (wird für Restore erneut benötigt): " PASSPHRASE
  echo
  if [[ -z "$PASSPHRASE" ]]; then
    echo "Leere Passphrase nicht erlaubt." >&2
    exit 1
  fi
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Sichere MariaDB (konsistenter Dump, eine Transaktion)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb \
  sh -c "exec mariadb-dump --single-transaction --routines --triggers -u'$DB_USER' -p'$DB_PASSWORD' '$DB_NAME'" \
  > "$WORK_DIR/database.sql"

echo "==> Kopiere Schlüssel (KEK) und TLS-Zertifikate..."
mkdir -p "$WORK_DIR/secrets" "$WORK_DIR/tls"
cp "$KEK_PATH" "$WORK_DIR/secrets/app.kek"
if [[ -d "$SCRIPT_DIR/../tls/mariadb" ]]; then
  cp -r "$SCRIPT_DIR/../tls/mariadb" "$WORK_DIR/tls/"
fi
cp "$ENV_FILE" "$WORK_DIR/env.backup"

mkdir -p "$BACKUP_DIR"
ARCHIVE_PATH="$BACKUP_DIR/ticket-system-backup-$TIMESTAMP.tar.gz.enc"

echo "==> Packe und verschlüssele Archiv..."
tar -C "$WORK_DIR" -czf - . | \
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass "pass:$PASSPHRASE" -out "$ARCHIVE_PATH"
unset PASSPHRASE

chmod 600 "$ARCHIVE_PATH"
echo
echo "==> Backup erstellt: $ARCHIVE_PATH"
echo "    Diese Datei UND die Passphrase werden für ./restore.sh gebraucht -- getrennt aufbewahren"
echo "    (3-2-1-Regel: mindestens eine Kopie an einem anderen Ort als dieser Server)."
