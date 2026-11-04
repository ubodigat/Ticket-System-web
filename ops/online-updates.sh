#!/usr/bin/env bash
# Online-Updates mit einem Befehl ein- oder ausschalten. Danach laeuft alles ueber die Weboberflaeche
# (System > Info & Updates): pruefen, Update starten, Fortschritt, Rollback.
#
#   sudo bash ops/online-updates.sh enable [--fingerprint=<40 Hex-Zeichen>] [--key=<schluessel.asc>]
#   sudo bash ops/online-updates.sh disable
#   sudo bash ops/online-updates.sh status
#
# enable  prueft den Signaturschluessel (genau ein Schluessel, Fingerabdruck wie veroeffentlicht),
#         hinterlegt ihn fuer den Host-Dienst und richtet den Host-Updater (systemd) ein. Updates
#         werden nur eingespielt, wenn der Ziel-Commit oder ein darauf zeigender Tag von genau diesem
#         Schluessel signiert ist. Ohne --fingerprint fragt das Skript nach einer Bestaetigung.
# disable entfernt Host-Dienst, Konfiguration und hinterlegte Schluessel; die Oberflaeche zeigt dann
#         "Online-Updates deaktiviert". Daten und laufende App bleiben unberuehrt.
set -euo pipefail
umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/ops/docker/.env"
# Nur fuer Tests: alle Systempfade unter einem eigenen Wurzelverzeichnis.
ROOT_PREFIX="${ONLINE_UPDATES_ROOT:-}"
BRIDGE_DIR="$ROOT_PREFIX/var/lib/ticket-system-update"
CONF_DIR="$ROOT_PREFIX/etc/ticket-system-updater"
KEY_DIR="$CONF_DIR/keys"
CONF_FILE="$ROOT_PREFIX/etc/ticket-system-updater.conf"
BIN_FILE="$ROOT_PREFIX/usr/local/libexec/ticket-system-updater"
UNIT_DIR="$ROOT_PREFIX/etc/systemd/system"
APP_UID=10001

die() { printf 'FEHLER: %s\n' "$1" >&2; exit 1; }
info() { printf '==> %s\n' "$1"; }

usage() {
  sed -n '5,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

require_root() {
  [[ -n "$ROOT_PREFIX" || "${EUID:-$(id -u)}" -eq 0 ]] || die "Bitte mit sudo ausfuehren: sudo bash ops/online-updates.sh $1"
}

set_env_var() {
  local key="$1" value="$2" tmp
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE fehlt -- zuerst installieren (bash install.sh)."
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" 'BEGIN { prefix=key "="; done=0 }
    index($0, prefix) == 1 { if (!done) print key "=" value; done=1; next } { print }
    END { if (!done) print key "=" value }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Fingerabdruck des einzigen Hauptschluessels einer Datei; leer bei 0 oder mehreren Schluesseln.
key_fingerprint() {
  local key="$1" home pubs fpr
  home="$(mktemp -d)"; chmod 0700 "$home"
  if ! GNUPGHOME="$home" gpg --batch --quiet --import "$key" 2>/dev/null; then rm -rf "$home"; return 0; fi
  pubs="$(GNUPGHOME="$home" gpg --batch --with-colons --list-keys 2>/dev/null | awk -F: '$1=="pub" {n++} END {print n+0}')"
  fpr="$(GNUPGHOME="$home" gpg --batch --with-colons --fingerprint 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')"
  rm -rf "$home"
  [[ "$pubs" == 1 ]] && printf '%s' "${fpr^^}"
  return 0
}

systemd_call() {
  [[ -n "${ONLINE_UPDATES_NO_SYSTEMD:-}" ]] && return 0
  systemctl "$@"
}

enable_updates() {
  local key="" expected="" arg fpr answer
  for arg in "$@"; do
    case "$arg" in
      --key=*) key="${arg#--key=}" ;;
      --fingerprint=*) expected="${arg#--fingerprint=}" ;;
      *) die "Unbekannte Option: $arg" ;;
    esac
  done
  require_root enable
  [[ -n "${ONLINE_UPDATES_NO_SYSTEMD:-}" ]] || command -v systemctl >/dev/null 2>&1 || die "Online-Updates brauchen systemd auf dem Host."
  command -v gpg >/dev/null 2>&1 || die "gpg fehlt (z. B. apt install gnupg)."
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE fehlt -- zuerst installieren (bash install.sh)."
  if [[ -z "$key" ]]; then
    key="$REPO_DIR/ops/release-signing-key.asc"
    [[ -f "$key" ]] || die "Kein Signaturschluessel gefunden. Mit --key=<datei.asc> angeben (oeffentlicher Schluessel des Herausgebers)."
  fi
  [[ -f "$key" && ! -L "$key" ]] || die "Schluesseldatei $key fehlt oder ist ein Symlink."
  fpr="$(key_fingerprint "$key")"
  [[ -n "$fpr" ]] || die "$key muss genau einen oeffentlichen Schluessel enthalten."
  if [[ -n "$expected" ]]; then
    [[ "$expected" =~ ^[A-Fa-f0-9]{40}$ ]] || die "--fingerprint erwartet 40 Hex-Zeichen."
    [[ "${expected^^}" == "$fpr" ]] || die "Fingerabdruck passt NICHT: Schluessel $fpr, erwartet ${expected^^}. Abbruch."
  elif [[ -t 0 ]]; then
    printf '\nSignaturschluessel: %s\nFingerabdruck:      %s\n' "$key" "$fpr"
    printf 'Stimmt der Fingerabdruck mit dem vom Herausgeber veroeffentlichten ueberein? Zum Bestaetigen "ja" eingeben: '
    read -r answer
    [[ "$answer" == "ja" || "$answer" == "yes" ]] || die "Nicht bestaetigt -- nichts geaendert."
  else
    die "Ohne Terminal bitte --fingerprint=<40 Hex-Zeichen> angeben (Fingerabdruck aus unabhaengiger Quelle)."
  fi

  info "Austauschverzeichnis $BRIDGE_DIR"
  mkdir -p "$BRIDGE_DIR/requests" "$BRIDGE_DIR/state" "$BRIDGE_DIR/work"
  if [[ -z "$ROOT_PREFIX" ]]; then
    chown root:root "$BRIDGE_DIR" "$BRIDGE_DIR/state" "$BRIDGE_DIR/work"
    chown "$APP_UID:$APP_UID" "$BRIDGE_DIR/requests"
  fi
  chmod 0755 "$BRIDGE_DIR" "$BRIDGE_DIR/state"
  chmod 0700 "$BRIDGE_DIR/work" "$BRIDGE_DIR/requests"

  info "Signaturschluessel $fpr fuer Updates hinterlegen"
  rm -rf "$KEY_DIR"
  install -d -m 0700 "$CONF_DIR" "$KEY_DIR"
  GNUPGHOME="$KEY_DIR" gpg --batch --quiet --import "$key"

  info "Host-Updater (systemd) einrichten"
  install -d -m 0755 "$(dirname "$BIN_FILE")" "$UNIT_DIR"
  install -m 0755 "$REPO_DIR/ops/host-updater/ticket-system-updater.sh" "$BIN_FILE"
  printf 'REPO_DIR=%q\nBRIDGE_DIR=%q\nUPDATE_BRANCH=main\nALLOW_MAIN_DEPLOY=true\nKEY_DIR=%q\n' \
    "$REPO_DIR" "${BRIDGE_DIR#"$ROOT_PREFIX"}" "${KEY_DIR#"$ROOT_PREFIX"}" > "$CONF_FILE"
  chmod 0600 "$CONF_FILE"
  install -m 0644 "$REPO_DIR/ops/host-updater/ticket-system-updater.service" "$UNIT_DIR/ticket-system-updater.service"
  install -m 0644 "$REPO_DIR/ops/host-updater/ticket-system-updater.path" "$UNIT_DIR/ticket-system-updater.path"
  systemd_call daemon-reload
  systemd_call enable --now ticket-system-updater.path
  printf 'enabled=1\n' > "$BRIDGE_DIR/state/agent.env"
  chmod 0644 "$BRIDGE_DIR/state/agent.env"

  # Damit ein spaeterer Installer-Lauf den Zustand beibehaelt.
  set_env_var UPDATE_ALLOW_MAIN_DEPLOY true
  set_env_var UPDATE_BRIDGE_HOST_DIR "${BRIDGE_DIR#"$ROOT_PREFIX"}"

  cat <<EOF

Online-Updates sind AKTIV.
  - Weboberflaeche: System > Info & Updates > "Pruefen" und "Jetzt aktualisieren".
  - Eingespielt wird nur, was mit dem Schluessel $fpr signiert ist.
  - Vor jedem Update entsteht automatisch eine verschluesselte Datensicherung.
  - Ausschalten: sudo bash ops/online-updates.sh disable
EOF
}

disable_updates() {
  [[ $# -eq 0 ]] || die "disable erwartet keine Optionen."
  require_root disable
  info "Host-Updater entfernen"
  if [[ -n "${ONLINE_UPDATES_NO_SYSTEMD:-}" ]] || command -v systemctl >/dev/null 2>&1; then
    systemd_call disable --now ticket-system-updater.path >/dev/null 2>&1 || true
  fi
  rm -f "$UNIT_DIR/ticket-system-updater.path" "$UNIT_DIR/ticket-system-updater.service"
  if [[ -n "${ONLINE_UPDATES_NO_SYSTEMD:-}" ]] || command -v systemctl >/dev/null 2>&1; then
    systemd_call daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "$BIN_FILE" "$CONF_FILE" "$BRIDGE_DIR/state/agent.env"
  rm -rf "$KEY_DIR"
  if [[ -d "$BRIDGE_DIR/requests" ]]; then find "$BRIDGE_DIR/requests" -mindepth 1 -delete 2>/dev/null || true; fi
  if [[ -f "$ENV_FILE" ]]; then set_env_var UPDATE_ALLOW_MAIN_DEPLOY false; fi
  cat <<EOF

Online-Updates sind AUS. Updates nur noch manuell (README: "Manuelles Update").
  - Wieder einschalten: sudo bash ops/online-updates.sh enable
EOF
}

show_status() {
  local fpr
  if [[ -f "$BRIDGE_DIR/state/agent.env" ]] && grep -qx 'enabled=1' "$BRIDGE_DIR/state/agent.env"; then
    echo "Online-Updates: AKTIV"
    fpr="$(GNUPGHOME="$KEY_DIR" gpg --batch --with-colons --fingerprint 2>/dev/null | awk -F: '/^fpr:/ {print $10}' | paste -sd, - || true)"
    echo "Hinterlegte Schluessel: ${fpr:-keine (jedes Update wird abgelehnt)}"
  else
    echo "Online-Updates: AUS"
  fi
}

case "${1:-}" in
  enable) shift; enable_updates "$@" ;;
  disable) shift; disable_updates "$@" ;;
  status) shift; show_status ;;
  -h|--help) usage 0 ;;
  *) usage 1 ;;
esac
