#!/bin/sh
# Run from the installer or updater before migrating/recreating the app. No DDL
# credentials are passed to the long-running app, and secrets never appear in argv.
set -eu
umask 077
repo=${1:?repository directory required}
env_file="$repo/ops/docker/.env"
compose() { docker compose -f "$repo/ops/docker/docker-compose.yml" --env-file "$env_file" "$@"; }
value() { sed -n "s/^$1=//p" "$env_file" | head -n 1; }
db=$(value DB_NAME)
if [ -z "$db" ]; then echo 'DB_NAME missing' >&2; exit 1; fi
user=$(value DB_RUNTIME_USER)
password=$(value DB_RUNTIME_PASSWORD)
if [ -z "$user" ]; then user="$(value DB_USER)_rt"; fi
if [ -z "$password" ]; then password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); fi
case "$db:$user" in *[!a-zA-Z0-9_:]*|'':*) echo 'Invalid database/account identifier' >&2; exit 1;; esac
case "$password" in *[!a-zA-Z0-9+/=_-]*|'') echo 'Invalid runtime password format' >&2; exit 1;; esac
root=$(value DB_ROOT_PASSWORD)
if [ -z "$root" ]; then
  # Existing installations used the official image's generated root password.
  root=$(compose logs --no-color mariadb | sed -n 's/.*GENERATED ROOT PASSWORD: //p' | head -n 1 | tr -d '\r')
fi
if [ -z "$root" ]; then
  echo 'Cannot provision database: set DB_ROOT_PASSWORD in ops/docker/.env to the existing MariaDB root password. No volume/data was removed.' >&2
  exit 1
fi
if [ "${2:-}" = '--recover-only' ]; then
  next=$(mktemp "${env_file}.XXXXXX")
  awk '!/^DB_ROOT_PASSWORD=/' "$env_file" > "$next"
  printf 'DB_ROOT_PASSWORD=%s\n' "$root" >> "$next"
  chmod 600 "$next"
  mv "$next" "$env_file"
  exit 0
fi
cnf=$(mktemp)
trap 'rm -f "$cnf"' EXIT HUP INT TERM
# MariaDB option-file quoting protects metacharacters in existing root passwords.
escaped=$(printf '%s' "$root" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '[client]\nuser=root\npassword="%s"\n' "$escaped" > "$cnf"
{
  cat "$cnf"
  printf '\n--END-CREDENTIALS--\n'
  printf "CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s';\n" "$user" "$password"
  printf "ALTER USER '%s'@'%%' IDENTIFIED BY '%s';\n" "$user" "$password"
  printf "REVOKE ALL PRIVILEGES, GRANT OPTION FROM '%s'@'%%';\n" "$user"
  printf 'GRANT SELECT, INSERT, UPDATE, DELETE ON `%s`.* TO '\''%s'\''@'\''%%'\'';\n' "$db" "$user"
} | compose exec -T mariadb sh -c '
  set -eu; umask 077; cnf=$(mktemp); trap '\''rm -f "$cnf"'\'' EXIT HUP INT TERM
  while IFS= read -r line; do
    [ "$line" = "--END-CREDENTIALS--" ] && break
    printf "%s\n" "$line" >> "$cnf"
  done
  mariadb --defaults-extra-file="$cnf"
'
# Verify the exact password over TLS before persisting it or restarting the app.
printf '[client]\nuser=%s\npassword="%s"\n' "$user" "$password" | compose exec -T mariadb sh -c '
  set -eu; umask 077; cnf=$(mktemp); trap '\''rm -f "$cnf"'\'' EXIT HUP INT TERM
  cat > "$cnf"
  mariadb --defaults-extra-file="$cnf" --protocol=tcp --host=mariadb --ssl-ca=/etc/mysql/tls/ca.pem --ssl-verify-server-cert -e "SELECT 1" >/dev/null
'
# Atomic rewrite; preserve every unrelated setting and every equals sign.
next=$(mktemp "${env_file}.XXXXXX")
awk '!/^DB_RUNTIME_USER=/ && !/^DB_RUNTIME_PASSWORD=/ && !/^DB_ROOT_PASSWORD=/' "$env_file" > "$next"
printf 'DB_RUNTIME_USER=%s\nDB_RUNTIME_PASSWORD=%s\nDB_ROOT_PASSWORD=%s\n' "$user" "$password" "$root" >> "$next"
chmod 600 "$next"
mv "$next" "$env_file"
echo 'Restricted runtime database account verified.'
