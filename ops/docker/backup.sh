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
# Das fertige Archiv wird selbst noch einmal mit einer eigenen Passphrase verschlüsselt -- ein
# Backup, das DB-Dump UND Schlüssel im Klartext zusammen enthält, wäre sonst selbst die
# "Sicherheitslücke offene Backup-Dateien" aus der Anforderungsliste. Ohne Passphrase ist das
# Archiv nutzlos, auch wenn es irgendwo offen liegt.
#
# Security-Audit N14, zwei Punkte behoben:
# 1. gpg (symmetrisch, AES256, OpenPGP-Integritätsschutz/MDC) statt openssl AES-256-CBC: CBC
#    allein ist nicht authentifiziert -- ein verändertes Archiv würde beim Restore nicht als
#    manipuliert erkannt, nur als evtl. kaputtes tar. gpg erkennt eine Veränderung beim Entschlüsseln.
# 2. DB-Passwort und Backup-Passphrase landen nie als Kommandozeilenargument (sonst für jeden
#    lokalen Prozess auf diesem Host über "ps aux"/"/proc/<pid>/cmdline" sichtbar) -- beide werden
#    ausschließlich über Datei-Deskriptoren/stdin übergeben.
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

if ! command -v gpg >/dev/null 2>&1; then
  echo "gpg nicht gefunden -- 'apt-get install -y gnupg' und erneut versuchen." >&2
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
# DB_USER/DB_PASSWORD werden als MySQL-Optionsdatei (--defaults-extra-file) über stdin an den
# Container übergeben -- nie als "-p..."-Kommandozeilenargument (siehe Kommentar oben).
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb sh -c '
  set -e
  umask 077
  cnf="$(mktemp)"
  cat > "$cnf"
  trap "rm -f \"$cnf\"" EXIT
  exec mariadb-dump --defaults-extra-file="$cnf" --single-transaction --routines --triggers "$1"
' _ "$DB_NAME" > "$WORK_DIR/database.sql" <<EOF
[client]
user=$DB_USER
password=$DB_PASSWORD
EOF

echo "==> Kopiere Schlüssel (KEK) und TLS-Zertifikate..."
mkdir -p "$WORK_DIR/secrets" "$WORK_DIR/tls"
cp "$KEK_PATH" "$WORK_DIR/secrets/app.kek"
if [[ -d "$SCRIPT_DIR/../tls/mariadb" ]]; then
  cp -r "$SCRIPT_DIR/../tls/mariadb" "$WORK_DIR/tls/"
fi
cp "$ENV_FILE" "$WORK_DIR/env.backup"

mkdir -p "$BACKUP_DIR"
ARCHIVE_PATH="$BACKUP_DIR/ticket-system-backup-$TIMESTAMP.tar.gz.gpg"

echo "==> Packe und verschlüssele Archiv (gpg, authentifiziert)..."
# --passphrase-fd 3 (NICHT 0/stdin, das traegt den eigentlichen tar-Datenstrom): Passphrase kommt
# über einen separaten Dateideskriptor, steht nie als Kommandozeilenargument in der Prozessliste.
# s2k-count auf das Maximum erhöht den Aufwand für einen Brute-Force-Versuch gegen die Passphrase
# selbst erheblich.
tar -C "$WORK_DIR" -czf - . | \
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 \
    --output "$ARCHIVE_PATH" 3<<< "$PASSPHRASE"
unset PASSPHRASE

chmod 600 "$ARCHIVE_PATH"
echo
echo "==> Backup erstellt: $ARCHIVE_PATH"
echo "    Diese Datei UND die Passphrase werden für ./restore.sh gebraucht -- getrennt aufbewahren"
echo "    (3-2-1-Regel: mindestens eine Kopie an einem anderen Ort als dieser Server)."
