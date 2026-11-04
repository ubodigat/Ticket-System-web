#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
#
# Wiederherstellung einer mit backup.sh erstellten Datensicherung. Gebraucht werden die
# Datensicherung und das Wiederherstellungs-Kit samt Passphrase (enthaelt den privaten
# Sicherungsschluessel und die KEK).
#
#   restore.sh --verify  <kit> <datensicherung>   Restore-Test: entschluesseln, Integritaet und Inhalt
#                                                  pruefen -- die Datenbank bleibt unveraendert.
#   restore.sh           <kit> <datensicherung>   Datenbank ersetzen (fragt nach "ja").
#   restore.sh --with-secrets <kit> <datensicherung>  zusaetzlich KEK, .env und TLS aus dem Kit
#                                                  zurueckspielen (neuer, leerer Server).
# Danach bringt "node dist/cli/schema.js" (macht der Installer) eine aeltere Sicherung auf das
# aktuelle Schema -- vorhandene Daten bleiben erhalten.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
die() { echo "$*" >&2; exit 1; }

MODE=restore
case "${1:-}" in
  --verify) MODE=verify; shift ;;
  --with-secrets) MODE=secrets; shift ;;
esac
KIT="${1:-}"; DATA="${2:-}"
[[ -f "$KIT" && -f "$DATA" ]] || die "Verwendung: $0 [--verify|--with-secrets] <wiederherstellungs-kit.tar.gz.gpg> <ticket-system-data-*.sql.gz.gpg>"
command -v gpg >/dev/null 2>&1 || die "gpg nicht gefunden -- 'apt-get install -y gnupg' und erneut versuchen."

WORK_PARENT="$SCRIPT_DIR/../backups"
mkdir -p "$WORK_PARENT"; chmod 0700 "$WORK_PARENT"
WORK_DIR="$(mktemp -d "$WORK_PARENT/.restore.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

PASSPHRASE="${BACKUP_KIT_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then read -rsp "Passphrase des Wiederherstellungs-Kits: " PASSPHRASE; echo; fi

echo "==> Öffne Wiederherstellungs-Kit..."
mkdir "$WORK_DIR/kit"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$KIT" 3<<<"$PASSPHRASE" | tar -C "$WORK_DIR/kit" -xzf - \
  || die "Kit konnte nicht entschlüsselt werden (falsche Passphrase oder beschädigt)."
unset PASSPHRASE
[[ -f "$WORK_DIR/kit/backup-private.asc" ]] || die "Das Kit enthält keinen privaten Sicherungsschlüssel -- das Kit aus 'backup.sh --init-keys' verwenden."
[[ -f "$WORK_DIR/kit/secrets/app.kek" ]] || die "Das Kit enthält keine KEK."
HOME_DIR="$WORK_DIR/gnupg"; mkdir -m 0700 "$HOME_DIR"
GNUPGHOME="$HOME_DIR" gpg --batch --quiet --import "$WORK_DIR/kit/backup-private.asc"

decrypt_data() { GNUPGHOME="$HOME_DIR" gpg --batch --quiet --decrypt "$DATA" | gunzip -c; }

echo "==> Prüfe Datensicherung (Signatur der Verschlüsselung, Kompression, Inhalt)..."
TABLES="$(decrypt_data | grep -c '^CREATE TABLE ' || true)"
[[ "$TABLES" -gt 10 ]] || die "Die Datensicherung ist unvollständig oder beschädigt ($TABLES Tabellen gefunden)."
decrypt_data | grep -q '^CREATE TABLE `users`' || die "Die Datensicherung enthält keine Benutzertabelle."
echo "    $TABLES Tabellen, lesbar und vollständig."
if [[ "$MODE" == verify ]]; then
  echo "==> Restore-Test erfolgreich. Es wurde nichts verändert."
  exit 0
fi

[[ -f "$ENV_FILE" ]] || die "Nicht gefunden: $ENV_FILE -- zuerst install.sh ausführen (bei einem neuen Server mit --with-secrets wiederherstellen)."
echo "WARNUNG: Dies ersetzt die aktuelle Datenbank dieser Installation vollständig."
read -rp "Fortfahren? Tippe GENAU 'ja': " CONFIRM
[[ "$CONFIRM" == "ja" ]] || die "Abgebrochen."

if [[ "$MODE" == secrets ]]; then
  echo "==> Stelle KEK, .env und TLS-Material aus dem Kit wieder her..."
  mkdir -p "$SCRIPT_DIR/../secrets" "$SCRIPT_DIR/../tls"
  install -m 0600 "$WORK_DIR/kit/secrets/app.kek" "$SCRIPT_DIR/../secrets/app.kek"
  install -m 0600 "$WORK_DIR/kit/env" "$ENV_FILE"
  [[ -f "$WORK_DIR/kit/backup-recipient.asc" ]] && install -m 0644 "$WORK_DIR/kit/backup-recipient.asc" "$SCRIPT_DIR/../secrets/backup-recipient.asc"
  [[ -d "$WORK_DIR/kit/tls-mariadb" ]] && { rm -rf "$SCRIPT_DIR/../tls/mariadb"; cp -r "$WORK_DIR/kit/tls-mariadb" "$SCRIPT_DIR/../tls/mariadb"; }
fi
env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }

echo "==> Stoppe Anwendung (Datenbank bleibt für den Import erreichbar)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop app

echo "==> Spiele Datensicherung ein..."
# Zugangsdaten nie als Kommandozeilenargument: erster Aufruf legt eine nur im Container lesbare
# Optionsdatei an (stdin), der zweite streamt den entschluesselten Dump hinein.
CNF_PATH="$(printf '[client]\nuser=%s\npassword=%s\n' "$(env_value DB_USER)" "$(env_value DB_PASSWORD)" \
  | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb sh -c 'umask 077; cnf="$(mktemp)"; cat > "$cnf"; printf "%s" "$cnf"')"
decrypt_data | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb sh -c '
  cnf="$1"; db="$2"; trap "rm -f \"$cnf\"" EXIT
  mariadb --defaults-extra-file="$cnf" "$db"
' _ "$CNF_PATH" "$(env_value DB_NAME)"

echo "==> Datenbank wiederhergestellt. Jetzt 'bash install.sh' ausführen: bringt das Schema auf den"
echo "    aktuellen Stand (ohne Datenverlust) und startet die Anwendung."
