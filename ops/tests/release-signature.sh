#!/usr/bin/env bash
# Security-Audit R-14: signierte Releases. Prueft ops/release/create-release.sh (Tag + Assets) und die
# Tag-Pruefung des Installers (verify_release_tag) gegen Fremdschluessel -- auch gegen einen an
# ops/release-signing-key.asc angehaengten zweiten Schluessel.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'gpgconf --homedir "$WORK/gnupg" --kill all >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
export GNUPGHOME="$WORK/gnupg"
mkdir -m 0700 "$GNUPGHOME"
fail() { echo "FAIL: $*" >&2; exit 1; }
refute() { if "$@"; then fail "erwarteter Fehlschlag: $*"; fi; }

gpg --batch --passphrase '' --quick-gen-key 'Release Maintainer <release@example.org>' ed25519 sign never 2>/dev/null
gpg --batch --passphrase '' --quick-gen-key 'Attacker <attacker@example.org>' ed25519 sign never 2>/dev/null
fpr_of() { gpg --batch --with-colons --fingerprint "$1" | awk -F: '$1 == "fpr" { print $10; exit }'; }
GOOD="$(fpr_of release@example.org)"
EVIL="$(fpr_of attacker@example.org)"

# Minimales Repository mit Installer, Manifest-Werkzeug und Release-Skript.
REPO="$WORK/repo"
mkdir -p "$REPO/ops/release"
cp "$ROOT/install.sh" "$REPO/install.sh"
cp "$ROOT/ops/create-install-manifest.mjs" "$REPO/ops/create-install-manifest.mjs"
cp "$ROOT/ops/release/create-release.sh" "$REPO/ops/release/create-release.sh"
printf '# Test\n' >"$REPO/README.md"
cp "$ROOT/.gitignore" "$REPO/.gitignore"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email release@example.org
git -C "$REPO" config user.name 'Release Maintainer'
git -C "$REPO" config commit.gpgsign false

bash "$REPO/ops/release/create-release.sh" init release@example.org >/dev/null
[[ "$(gpg --batch --with-colons --import-options show-only --import "$REPO/ops/release-signing-key.asc" | awk -F: '$1 == "pub"' | wc -l)" == 1 ]] || fail "init exportiert genau einen Schluessel"
(cd "$REPO" && node ops/create-install-manifest.mjs >/dev/null)
git -C "$REPO" add -A && git -C "$REPO" commit -qm 'Release vorbereiten'
git -C "$REPO" config user.signingkey "$GOOD"

expect_error() { local message="$1"; shift; local out; if out="$("$@" 2>&1)"; then fail "erwarteter Fehlschlag: $*"; fi; grep -q "$message" <<<"$out" || fail "erwartet '$message', erhalten: $out"; }
expect_error 'Format vJJJJ.MM.N' bash "$REPO/ops/release/create-release.sh" tag 2026.11.1
bash "$REPO/ops/release/create-release.sh" tag v2026.11.1 >/dev/null
gpg --batch --verify "$REPO/release-assets/v2026.11.1/install.sh.asc" "$REPO/release-assets/v2026.11.1/install.sh" 2>/dev/null || fail "install.sh.asc ungueltig"
cmp -s "$REPO/release-assets/v2026.11.1/install.sh" "$REPO/install.sh" || fail "Asset entspricht nicht install.sh aus dem Tag"
[[ "$(cat "$REPO/release-assets/v2026.11.1/install-manifest.sha256.txt")" =~ ^[0-9a-f]{64}$ ]] || fail "Manifest-Hash fehlt"
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || fail "release-assets/ muss ignoriert werden"
expect_error 'existiert bereits' bash "$REPO/ops/release/create-release.sh" tag v2026.11.1
echo dirty >>"$REPO/README.md"; expect_error 'nicht sauber' bash "$REPO/ops/release/create-release.sh" tag v2026.11.2; git -C "$REPO" checkout -q README.md
git -C "$REPO" config user.signingkey "$EVIL"; expect_error 'nicht der Schluessel' bash "$REPO/ops/release/create-release.sh" tag v2026.11.2
git -C "$REPO" config user.signingkey "$GOOD"

# Funktionen des Installers laden (ohne ihn auszufuehren).
eval "$(awk '/^release_key_matches\(\) \{/,/^\}/' "$ROOT/install.sh")"
eval "$(awk '/^verify_release_tag\(\) \{/,/^\}/' "$ROOT/install.sh")"
declare -F verify_release_tag >/dev/null && declare -F release_key_matches >/dev/null || fail "Installer-Funktionen nicht gefunden"
check() { INSTALL_REF="$1" INSTALL_SIGNER_FINGERPRINT="$2" verify_release_tag "$REPO" 2>/dev/null; }

check v2026.11.1 "$GOOD" || fail "gueltiger Release-Tag abgelehnt"
check v2026.11.1 "${GOOD,,}" || fail "Fingerabdruck in Kleinbuchstaben abgelehnt"
refute check v2026.11.1 "$EVIL"
refute check v2026.11.1 "kein-fingerabdruck"

# Angriff 1: Fremdschluessel an die Schluesseldatei anhaengen und den Tag damit signieren.
git -C "$REPO" checkout -q main
gpg --batch --armor --export "$EVIL" >>"$REPO/ops/release-signing-key.asc"
git -C "$REPO" commit -qam 'Schluessel ergaenzt'
git -C "$REPO" tag -s -u "$EVIL" -m 'evil' v2026.11.66
git -C "$REPO" checkout -q v2026.11.66
refute check v2026.11.66 "$GOOD"

# Angriff 2: richtige Schluesseldatei, aber Tag vom Fremdschluessel.
git -C "$REPO" checkout -q main
git -C "$REPO" checkout -q HEAD~1 -- ops/release-signing-key.asc
git -C "$REPO" commit -qam 'Schluessel wiederhergestellt'
git -C "$REPO" tag -s -u "$EVIL" -m 'evil' v2026.11.67
git -C "$REPO" checkout -q v2026.11.67
refute check v2026.11.67 "$GOOD"

# Angriff 3: Schluesseldatei ausgetauscht.
git -C "$REPO" checkout -q main
gpg --batch --armor --export "$EVIL" >"$REPO/ops/release-signing-key.asc"
git -C "$REPO" commit -qam 'Schluessel ausgetauscht'
git -C "$REPO" tag -s -u "$EVIL" -m 'evil' v2026.11.68
git -C "$REPO" checkout -q v2026.11.68
refute check v2026.11.68 "$GOOD"

# Gueltiger Tag, aber ausgecheckt ist ein anderer Stand.
git -C "$REPO" checkout -q main
refute check v2026.11.1 "$GOOD"

echo "release signature regressions passed"
