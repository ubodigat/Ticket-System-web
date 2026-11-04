#!/usr/bin/env bash
# Regressionstest fuer die Server-Sicherung (Review 11/2026, Punkt 4) mit einem Fake-"docker", der
# einen Dump liefert: Schluesselerzeugung, Wiederherstellungs-Kit, asymmetrische Datensicherung ohne
# KEK/.env, kein privater Schluessel und kein Klartext auf dem Server, Restore-Test mit dem Kit.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v gpg >/dev/null || { echo "gpg fehlt" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# "! cmd" bricht unter set -e nicht ab -- deshalb ausdruecklich pruefen.
refute() { if "$@" >/dev/null 2>&1; then echo "Unerwartet erfolgreich: $*" >&2; exit 1; fi; }
fake="$work/repo"; mkdir -p "$fake/ops/docker" "$fake/ops/secrets" "$work/bin" "$work/state"
cp "$root/ops/docker/backup.sh" "$root/ops/docker/restore.sh" "$fake/ops/docker/"
printf 'DB_NAME=ticketsystem\nDB_USER=ticketapp\nDB_PASSWORD=Secret-DB-Password==\nCOOKIE_SECRET=cookie-secret-value-cookie-secret-value\n' > "$fake/ops/docker/.env"
touch "$fake/ops/docker/docker-compose.yml"
printf '1:%s\n' "$(head -c 32 /dev/urandom | base64)" > "$fake/ops/secrets/app.kek"
kek="$(cut -d: -f2 "$fake/ops/secrets/app.kek")"
cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
# Fake: "docker compose ... exec -T mariadb sh -c <script> _ <db>" liefert einen Dump;
# die Zugangsdaten muessen ueber stdin kommen, nie als Argument.
args="$*"
if [[ "$args" == *"Secret-DB-Password"* ]]; then echo "password on command line" >&2; exit 9; fi
if [[ "$args" == *"exec -T mariadb"* ]]; then
  cnf="$(cat)"; [[ "$cnf" == *"password=Secret-DB-Password=="* ]] || { echo "no credentials on stdin" >&2; exit 8; }
  printf 'CREATE TABLE `users` (id int);\n'
  for i in $(seq 1 20); do printf 'CREATE TABLE `t%s` (id int);\nINSERT INTO `t%s` VALUES (%s);\n' "$i" "$i" "$i"; done
  printf 'INSERT INTO `users` VALUES (424242);\n'
  exit 0
fi
exit 0
EOF
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" UPDATE_BRIDGE_HOST_DIR="$work" BACKUP_DIR="$fake/ops/backups"
mkdir -p "$work/state"

# 1. Schluessel + Kit: nur der oeffentliche Schluessel bleibt auf dem Server.
BACKUP_KIT_PASSPHRASE='kit-passphrase-1234567890' bash "$fake/ops/docker/backup.sh" --init-keys > "$work/init.log"
kit="$(sed -n 's/^==> Wiederherstellungs-Kit: //p' "$work/init.log")"
[[ -f "$kit" && -f "$fake/ops/secrets/backup-recipient.asc" ]]
grep -q 'BEGIN PGP PUBLIC KEY BLOCK' "$fake/ops/secrets/backup-recipient.asc"
refute grep -rl 'PRIVATE KEY BLOCK' "$fake/ops" --exclude="$(basename "$kit")"
refute grep -a -q "$kek" "$kit"

# 2. Datensicherung: verschluesselt, ohne KEK/.env, kein Klartext-Rest, Status fuer die Oberflaeche.
bash "$fake/ops/docker/backup.sh" > "$work/backup.log"
data="$(ls "$fake/ops/backups"/ticket-system-data-*.sql.gz.gpg)"
refute grep -a -q 'CREATE TABLE' "$data"
refute gpg --batch --quiet --decrypt "$data"   # ohne privaten Schluessel nicht lesbar
[[ -z "$(find "$fake/ops/backups" -name '.work.*' -o -name '*.partial')" ]]
grep -q '^offsite=none$' "$work/state/backup.env"
grep -q '^lastBackupAt=20' "$work/state/backup.env"
grep -q 'Keine externe Kopie' "$work/backup.log"

# 3. Restore-Test mit Kit: entschluesseln und Inhalt pruefen, ohne etwas zu veraendern.
BACKUP_KIT_PASSPHRASE='kit-passphrase-1234567890' bash "$fake/ops/docker/restore.sh" --verify "$kit" "$data" > "$work/verify.log"
grep -q 'Restore-Test erfolgreich' "$work/verify.log"
refute env BACKUP_KIT_PASSPHRASE='falsche-passphrase-123456' bash "$fake/ops/docker/restore.sh" --verify "$kit" "$data"

# 4. Das Kit enthaelt KEK, .env und den privaten Sicherungsschluessel.
mkdir "$work/kit"
gpg --batch --quiet --pinentry-mode loopback --passphrase 'kit-passphrase-1234567890' --decrypt "$kit" | tar -C "$work/kit" -xzf -
[[ -f "$work/kit/secrets/app.kek" && -f "$work/kit/env" && -f "$work/kit/backup-private.asc" ]]
echo "Backup: asymmetric data backups, separate recovery kit, no secrets or plaintext left on the server, restore test: OK"
