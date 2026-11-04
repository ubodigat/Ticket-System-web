#!/usr/bin/env bash
# Belegt die Dateiverschluesselung von MariaDB (Review 11/2026, Punkt 7) mit genau der Konfiguration
# und Haertung aus ops/docker: ein Klartext-Marker darf in keiner Datei des Datenvolumes auftauchen,
# und ohne die Schluesseldateien laesst sich die Tabelle nicht mehr lesen. Braucht docker (oder
# podman-docker) und openssl; aendert nichts ausserhalb der eigenen Wegwerf-Container/-Volumes.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="$(awk '/^  mariadb:/{f=1} f&&/image:/{print $2; exit}' "$root/ops/docker/docker-compose.yml")"
name="ts-at-rest-$$"; volume="ts-at-rest-$$"
work="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm -f "$volume" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
marker="KLARTEXTMARKER$(openssl rand -hex 8)"

mkdir -p "$work/keys" "$work/conf"
openssl rand -hex 64 > "$work/keys/keyfile.key"
printf '1;%s\n2;%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" \
  | openssl enc -aes-256-cbc -md sha1 -pass "file:$work/keys/keyfile.key" -out "$work/keys/keyfile.enc"
chmod 0755 "$work/keys"; chmod 0444 "$work/keys"/*
cp "$root/ops/docker/mariadb/conf.d/encryption.cnf" "$work/conf/"
chmod 0755 "$work/conf"; chmod 0644 "$work/conf"/*

hardening=(--cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID --security-opt no-new-privileges)
start() { # mit/ohne Schluessel
  local mounts=(-v "$volume:/var/lib/mysql")
  if [[ "$1" == with-keys ]]; then mounts+=(-v "$work/conf:/etc/mysql/conf.d:ro" -v "$work/keys:/etc/mysql/encryption:ro"); fi
  docker run -d --name "$name" "${hardening[@]}" -e MARIADB_ROOT_PASSWORD=at-rest-root "${mounts[@]}" "$image" >/dev/null
}
sql() { docker exec "$name" mariadb -uroot -pat-rest-root -N -e "$1"; }
wait_ready() {
  for _ in $(seq 1 60); do
    docker exec "$name" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 && return 0
    docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true || return 1
    sleep 2
  done
  return 1
}

start with-keys
wait_ready || { docker logs "$name" | tail -30; echo "MariaDB startet mit Verschluesselung nicht" >&2; exit 1; }
sql "CREATE DATABASE probe; CREATE TABLE probe.t (id INT PRIMARY KEY AUTO_INCREMENT, v VARCHAR(200)) ENGINE=InnoDB;
     INSERT INTO probe.t (v) SELECT CONCAT('$marker', seq) FROM probe.seq_1_to_2000;"
[[ "$(sql "SELECT COUNT(*) FROM information_schema.INNODB_TABLESPACES_ENCRYPTION WHERE NAME = 'probe/t' AND ENCRYPTION_SCHEME = 1")" == 1 ]] \
  || { echo "Tabelle ist nicht verschluesselt" >&2; exit 1; }
[[ "$(sql "SELECT @@innodb_encrypt_log, @@encrypt_tmp_files, @@aria_encrypt_tables, @@encrypt_binlog")" == $'1\t1\t1\t1' ]] \
  || { echo "Log-/Temp-/Aria-/Binlog-Verschluesselung nicht aktiv" >&2; exit 1; }
docker stop -t 60 "$name" >/dev/null; docker rm "$name" >/dev/null

# Rohdateien durchsuchen: der Marker darf nirgends im Klartext stehen.
if docker run --rm --entrypoint grep -v "$volume:/var/lib/mysql:ro" "$image" -r -a -l "$marker" /var/lib/mysql; then
  echo "Klartext im Datenvolume gefunden" >&2; exit 1
fi

# Ohne Schluessel: Server startet ggf., die Tabelle ist aber nicht lesbar.
start without-keys
if wait_ready && docker exec "$name" mariadb -uroot -pat-rest-root -N -e "SELECT v FROM probe.t LIMIT 1" 2>/dev/null | grep -q "$marker"; then
  echo "Daten ohne Schluessel lesbar" >&2; exit 1
fi
echo "MariaDB encryption at rest (tables, redo log, temp files, Aria, binlog) with container hardening: OK"
