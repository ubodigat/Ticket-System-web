#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
#
# Schluesselrotation nach einem (moeglichen) Leak (Review 11/2026, Punkt 3), als root auf dem Server:
#   rotate-keys.sh kek    neue KEK, alle DEKs neu umhuellen, alte KEK entfernen
#   rotate-keys.sh dek    neue DEK-Versionen, alle Werte neu verschluesseln, alte Versionen entfernen
#   rotate-keys.sh status Stand anzeigen
# Vorher wird gesichert; die App ist waehrend der Rotation kurz angehalten. Danach unbedingt ein neues
# Wiederherstellungs-Kit erzeugen (das Skript fragt danach).
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$SCRIPT_DIR/.env")
KEK="$SCRIPT_DIR/../secrets/app.kek"
die() { echo "$*" >&2; exit 1; }
[[ "${1:-}" =~ ^(kek|dek|status)$ ]] || die "Verwendung: $0 kek|dek|status"
[[ -f "$KEK" ]] || die "KEK nicht gefunden: $KEK"

# Arbeitskopie des Schluesselbunds, beschreibbar fuer den App-Benutzer (uid 10001) im Container.
WORK="$(mktemp -d "$SCRIPT_DIR/../secrets/.rotate.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cp -p "$KEK" "$WORK/app.kek"
chown -R 10001 "$WORK"; chmod 0700 "$WORK"; chmod 0600 "$WORK/app.kek"

keys() { # Befehle des CLI nacheinander, volle DB-Zugangsdaten nur per stdin
  printf '%s\n%s\n' "$(grep '^DB_USER=' "$SCRIPT_DIR/.env" | cut -d= -f2-)" "$(grep '^DB_PASSWORD=' "$SCRIPT_DIR/.env" | cut -d= -f2-)" \
    | "${COMPOSE[@]}" run --rm --no-deps -T -v "$WORK:/run/keyring" -e KEK_FILE_PATH=/run/keyring/app.kek app sh -c \
      'set -eu; IFS= read -r DB_USER; IFS= read -r DB_PASSWORD; export DB_USER DB_PASSWORD; for c in "$@"; do node dist/cli/keys.js $c; done' _ "$@"
}

if [[ "$1" == status ]]; then keys status; exit 0; fi

echo "==> Sicherung vor der Rotation..."
if [[ -f "$SCRIPT_DIR/../secrets/backup-recipient.asc" ]]; then bash "$SCRIPT_DIR/backup.sh"; else echo "HINWEIS: kein Sicherungsschluessel eingerichtet -- keine Sicherung."; fi

echo "==> Halte die Anwendung an..."
"${COMPOSE[@]}" stop --timeout 30 app
restart() { "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 180 app; }
adopt_keyring() { install -m 0600 -o 10001 "$WORK/app.kek" "$KEK.new"; mv -f "$KEK.new" "$KEK"; }
# Bis "retire-kek" enthaelt die Arbeitskopie alle KEK-Versionen (alt + ggf. neu). Bricht ein Schritt
# ab, wird sie trotzdem uebernommen -- teilweise neu umhuellte DEKs bleiben so lesbar.
RETIRED=0
on_error() {
  echo "Fehler -- die Anwendung wird mit einem vollstaendigen Schluesselbund neu gestartet." >&2
  [[ "$RETIRED" == 1 ]] || adopt_keyring || true
  rm -rf "$WORK"
  restart || true
}
trap on_error ERR
if [[ "$1" == kek ]]; then
  # Reihenfolge ist wichtig: der Schluesselbund mit alter UND neuer KEK wird uebernommen, sobald die
  # DEKs neu umhuellt sind -- erst danach wird die alte KEK entfernt. So passt die Datei zu jedem
  # Zwischenstand der Datenbank, auch wenn ein Schritt abbricht.
  keys rotate-kek
  adopt_keyring
  keys retire-kek status
  RETIRED=1
  adopt_keyring
else
  keys "rotate-dek --all" reencrypt prune-deks status
fi
trap - ERR

echo "==> Starte die Anwendung..."
restart
echo
echo "==> Rotation abgeschlossen. Jetzt ein neues Wiederherstellungs-Kit erzeugen und sicher ablegen:"
echo "    bash ops/docker/backup.sh --recovery-kit"
