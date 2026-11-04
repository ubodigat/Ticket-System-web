#!/usr/bin/env bash
# The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
# Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
# The Original Code is Ticket-System-web.
# The Original Developer is the Initial Developer: U:Bodigat.
# The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
# Contributors: see CONTRIBUTORS.md and CHANGES.md.
#
# Server-Sicherung in zwei getrennten Teilen (Review 11/2026, Punkt 4):
#
#   backup.sh                  Datensicherung: MariaDB-Dump, direkt gestreamt (kein Klartext auf der
#                              Platte), komprimiert und ASYMMETRISCH mit dem oeffentlichen
#                              Sicherungsschluessel verschluesselt. Der private Schluessel liegt NICHT
#                              auf dem Server -- ein Angreifer mit Serverzugriff kann alte Sicherungen
#                              nicht lesen. Laeuft automatisch vor jedem Update und taeglich (Timer).
#   backup.sh --init-keys      Einmalig: erzeugt das Sicherungs-Schluesselpaar und das
#                              Wiederherstellungs-Kit. Nur der oeffentliche Schluessel bleibt hier.
#   backup.sh --recovery-kit   Wiederherstellungs-Kit neu erzeugen (nach einer KEK-Rotation): KEK,
#                              .env-Geheimnisse und TLS-Material, symmetrisch mit einer Passphrase.
#
# Datensicherungen enthalten weder KEK noch .env. Fuer eine Wiederherstellung braucht man die
# Datensicherung UND das Wiederherstellungs-Kit samt Passphrase (restore.sh).
#
# Externe Kopie (dringend empfohlen, sonst warnt die Oberflaeche):
#   BACKUP_RESTIC_REPOSITORY + BACKUP_RESTIC_PASSWORD_FILE   restic, z.B. rest-server --append-only
#   BACKUP_S3_URI (s3://bucket/pfad)                          aws CLI; Bucket mit Object Lock
# Beides in ops/docker/.env eintragen.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
SECRETS_DIR="$SCRIPT_DIR/../secrets"
RECIPIENT_KEY="$SECRETS_DIR/backup-recipient.asc"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"
STATE_DIR="${UPDATE_BRIDGE_HOST_DIR:-/var/lib/ticket-system-update}/state"

die() { echo "$*" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || die "Nicht gefunden: $ENV_FILE -- zuerst install.sh ausführen."
command -v gpg >/dev/null 2>&1 || die "gpg nicht gefunden -- 'apt-get install -y gnupg' und erneut versuchen."
env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
# Aufbewahrung lokal (Loeschkonzept, docs/OPERATIONS.md): die neuesten N Datensicherungen.
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-$(env_value BACKUP_KEEP_LOCAL)}"
KEEP_LOCAL="${KEEP_LOCAL:-14}"
[[ "$KEEP_LOCAL" =~ ^[1-9][0-9]{0,3}$ ]] || die "BACKUP_KEEP_LOCAL muss eine Zahl von 1 bis 9999 sein."

# Privates Arbeitsverzeichnis neben den Sicherungen statt im gemeinsam genutzten /tmp.
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
WORK_DIR="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
PARTIAL=""
trap 'rm -rf "$WORK_DIR"; [[ -z "$PARTIAL" ]] || rm -f "$PARTIAL"' EXIT

write_state() {
  [[ -d "$STATE_DIR" ]] || return 0
  local tmp
  tmp="$(mktemp "$STATE_DIR/.backup.XXXXXX")"
  local pair
  for pair in "$@"; do printf '%s\n' "$pair" >>"$tmp"; done
  chmod 0644 "$tmp"
  mv -f "$tmp" "$STATE_DIR/backup.env"
}
previous_state() { grep -m1 "^$1=" "$STATE_DIR/backup.env" 2>/dev/null | cut -d= -f2- || true; }

read_passphrase() {
  local value="${BACKUP_KIT_PASSPHRASE:-}"
  if [[ -z "$value" ]]; then
    [[ -t 0 ]] || die "Keine Passphrase: BACKUP_KIT_PASSPHRASE setzen oder interaktiv ausführen."
    read -rsp "Passphrase für das Wiederherstellungs-Kit (mind. 16 Zeichen): " value; echo
  fi
  [[ ${#value} -ge 16 ]] || die "Die Passphrase muss mindestens 16 Zeichen lang sein."
  printf '%s' "$value"
}

# Wiederherstellungs-Kit: KEK, .env, TLS-Material und (bei --init-keys) der private
# Sicherungsschluessel. Symmetrisch, authentifiziert (gpg MDC), Passphrase nur ueber einen Deskriptor.
write_recovery_kit() {
  local passphrase="$1" private_key="${2:-}" kit
  kit="$REPO_DIR/ops/recovery-kit-$(date +%Y%m%d-%H%M%S).tar.gz.gpg"
  mkdir -p "$WORK_DIR/kit/secrets"
  cp "$SECRETS_DIR/app.kek" "$WORK_DIR/kit/secrets/app.kek"
  cp "$ENV_FILE" "$WORK_DIR/kit/env"
  [[ -d "$SCRIPT_DIR/../tls/mariadb" ]] && cp -r "$SCRIPT_DIR/../tls/mariadb" "$WORK_DIR/kit/tls-mariadb"
  [[ -d "$SECRETS_DIR/mariadb-encryption" ]] && cp -r "$SECRETS_DIR/mariadb-encryption" "$WORK_DIR/kit/mariadb-encryption"
  [[ -f "$RECIPIENT_KEY" ]] && cp "$RECIPIENT_KEY" "$WORK_DIR/kit/backup-recipient.asc"
  [[ -n "$private_key" ]] && cp "$private_key" "$WORK_DIR/kit/backup-private.asc"
  tar -C "$WORK_DIR/kit" -czf - . | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --output "$kit" 3<<<"$passphrase"
  rm -rf "$WORK_DIR/kit"
  chmod 600 "$kit"
  echo "$kit"
}

init_keys() {
  [[ -f "$RECIPIENT_KEY" ]] && die "Sicherungsschlüssel existiert bereits ($RECIPIENT_KEY)."
  local passphrase home
  passphrase="$(read_passphrase)"
  home="$WORK_DIR/gnupg"; mkdir -m 0700 "$home"
  GNUPGHOME="$home" gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key \
    "Ticket-System Datensicherung <backup@ticket-system.invalid>" cv25519 encr never >/dev/null 2>&1 \
    || GNUPGHOME="$home" gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key \
      "Ticket-System Datensicherung <backup@ticket-system.invalid>" rsa4096 encr never >/dev/null
  mkdir -p "$SECRETS_DIR"
  GNUPGHOME="$home" gpg --batch --armor --export > "$RECIPIENT_KEY"
  GNUPGHOME="$home" gpg --batch --armor --pinentry-mode loopback --passphrase '' --export-secret-keys > "$WORK_DIR/backup-private.asc"
  chmod 0644 "$RECIPIENT_KEY"
  local kit
  kit="$(write_recovery_kit "$passphrase" "$WORK_DIR/backup-private.asc")"
  rm -rf "$home" "$WORK_DIR/backup-private.asc"
  echo "==> Wiederherstellungs-Kit: $kit"
  echo "    Enthält den einzigen privaten Sicherungsschlüssel. JETZT vom Server herunterladen,"
  echo "    getrennt von der Passphrase aufbewahren und danach hier löschen."
}

data_backup() {
  [[ -f "$RECIPIENT_KEY" ]] || die "Kein Sicherungsschlüssel vorhanden -- einmalig 'bash ops/docker/backup.sh --init-keys' ausführen."
  local stamp archive tmp home db_name db_user db_password
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="$BACKUP_DIR/ticket-system-data-$stamp.sql.gz.gpg"
  tmp="$archive.partial"
  PARTIAL="$tmp"
  home="$WORK_DIR/gnupg"; mkdir -m 0700 "$home"
  GNUPGHOME="$home" gpg --batch --quiet --import "$RECIPIENT_KEY"
  local fingerprint
  fingerprint="$(GNUPGHOME="$home" gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ {print $10; exit}')"
  db_name="$(env_value DB_NAME)"; db_user="$(env_value DB_USER)"; db_password="$(env_value DB_PASSWORD)"
  echo "==> Datensicherung (konsistenter Dump, direkt verschlüsselt)..."
  # Zugangsdaten als Optionsdatei ueber stdin in den Container -- nie als Kommandozeilenargument.
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mariadb sh -c '
    set -e; umask 077; cnf="$(mktemp)"; trap "rm -f \"$cnf\"" EXIT
    cat > "$cnf"
    exec mariadb-dump --defaults-extra-file="$cnf" --single-transaction --routines --triggers --hex-blob "$1"
  ' _ "$db_name" < <(printf '[client]\nuser=%s\npassword=%s\n' "$db_user" "$db_password") \
    | gzip -9 \
    | GNUPGHOME="$home" gpg --batch --yes --trust-model always --encrypt --recipient "$fingerprint" --output "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$archive"
  PARTIAL=""
  echo "==> Gesichert: $archive"

  # Alte lokale Datensicherungen entfernen (die neuesten KEEP_LOCAL bleiben).
  ls -1t "$BACKUP_DIR"/ticket-system-data-*.sql.gz.gpg 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f --

  local offsite="none" offsite_at error=""
  offsite_at="$(previous_state lastOffsiteAt)"
  local restic_repo s3_uri
  restic_repo="$(env_value BACKUP_RESTIC_REPOSITORY)"; s3_uri="$(env_value BACKUP_S3_URI)"
  if [[ -n "$restic_repo" ]]; then
    offsite="restic"
    if RESTIC_REPOSITORY="$restic_repo" RESTIC_PASSWORD_FILE="$(env_value BACKUP_RESTIC_PASSWORD_FILE)" \
      restic backup --quiet --tag ticket-system "$archive"; then offsite_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else error="offsite_failed"; fi
  elif [[ -n "$s3_uri" ]]; then
    offsite="s3"
    if aws s3 cp --only-show-errors "$archive" "${s3_uri%/}/$(basename "$archive")"; then offsite_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else error="offsite_failed"; fi
  fi
  write_state "lastBackupAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "lastBackupFile=$(basename "$archive")" \
    "offsite=$offsite" "lastOffsiteAt=$offsite_at" "error=$error"
  if [[ "$offsite" == none ]]; then
    echo "HINWEIS: Keine externe Kopie eingerichtet (BACKUP_RESTIC_REPOSITORY oder BACKUP_S3_URI)."
    echo "         Eine Sicherung nur auf diesem Server schützt nicht vor Ausfall oder Kompromittierung."
  elif [[ -n "$error" ]]; then
    echo "WARNUNG: Externe Kopie fehlgeschlagen -- die lokale Sicherung ist vorhanden." >&2
    return 1
  fi
}

case "${1:-}" in
  "") data_backup ;;
  --init-keys) init_keys ;;
  --recovery-kit)
    kit="$(write_recovery_kit "$(read_passphrase)")"
    echo "==> Wiederherstellungs-Kit: $kit (vom Server herunterladen und hier löschen)" ;;
  *) die "Verwendung: $0 [--init-keys | --recovery-kit]" ;;
esac
