#!/usr/bin/env bash
# Signierte Releases fuer Maintainer (Security-Audit R-14). Laeuft auf dem eigenen Rechner, nicht auf
# dem Server; der private Signaturschluessel verlaesst diesen Rechner nie.
#
#   bash ops/release/create-release.sh init <SCHLUESSEL-ID>
#       Exportiert den oeffentlichen Schluessel nach ops/release-signing-key.asc und zeigt den
#       Fingerabdruck. Danach: Datei committen, Fingerabdruck unabhaengig veroeffentlichen (eigene
#       Website) und den Schluessel auf keys.openpgp.org hochladen.
#
#   bash ops/release/create-release.sh tag <vJJJJ.MM.N>
#       Prueft sauberen Stand, Manifest und Schluessel, legt den signierten Tag auf HEAD an und erzeugt
#       die Release-Assets unter release-assets/<version>/ (install.sh, install.sh.asc,
#       install-manifest.sha256.txt). Gepusht wird nichts -- die Befehle dafuer werden angezeigt.
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY_FILE="$REPO_DIR/ops/release-signing-key.asc"
die() { echo "FEHLER: $*" >&2; exit 1; }
git_repo() { git -C "$REPO_DIR" "$@"; }

primary_fingerprint() {
  gpg --batch --with-colons --import-options show-only --import "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'
}
primary_count() {
  gpg --batch --with-colons --import-options show-only --import "$1" 2>/dev/null | awk -F: '$1 == "pub" { n++ } END { print n + 0 }'
}

cmd_init() {
  local key_id="${1:-}" tmp fpr
  [[ -n "$key_id" ]] || die "Verwendung: $0 init <SCHLUESSEL-ID>"
  gpg --batch --list-secret-keys "$key_id" >/dev/null 2>&1 || die "Kein privater Schluessel fuer $key_id in diesem Schluesselbund."
  tmp="$(mktemp)"
  gpg --batch --armor --export-options export-minimal --export "$key_id" >"$tmp"
  [[ "$(primary_count "$tmp")" == 1 ]] || { rm -f "$tmp"; die "Die Schluessel-ID muss genau einen Schluessel bezeichnen."; }
  fpr="$(primary_fingerprint "$tmp")"
  mv -f "$tmp" "$KEY_FILE"
  cat <<EOF
==> ops/release-signing-key.asc geschrieben.
    Fingerabdruck: $fpr

Naechste Schritte:
  1. git add ops/release-signing-key.asc && git commit
  2. Fingerabdruck an einer vom Repository unabhaengigen Stelle veroeffentlichen (eigene Website).
  3. gpg --keyserver hkps://keys.openpgp.org --send-keys $fpr
  4. git config user.signingkey $fpr
EOF
}

cmd_tag() {
  local version="${1:-}" signing fpr out hash
  [[ "$version" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]+$ ]] || die "Version im Format vJJJJ.MM.N angeben, z. B. v2026.11.1."
  [[ -f "$KEY_FILE" ]] || die "ops/release-signing-key.asc fehlt -- zuerst: $0 init <SCHLUESSEL-ID>"
  [[ -z "$(git_repo status --porcelain)" ]] || die "Arbeitsverzeichnis ist nicht sauber."
  git_repo ls-files --error-unmatch ops/release-signing-key.asc >/dev/null 2>&1 || die "ops/release-signing-key.asc ist nicht committet."
  [[ "$(primary_count "$KEY_FILE")" == 1 ]] || die "ops/release-signing-key.asc muss genau einen Schluessel enthalten."
  fpr="$(primary_fingerprint "$KEY_FILE")"
  signing="$(git_repo config user.signingkey || true)"
  [[ -n "$signing" ]] || die "git config user.signingkey ist nicht gesetzt (Fingerabdruck $fpr)."
  [[ "$(gpg --batch --with-colons --fingerprint "$signing" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')" == "$fpr" ]] \
    || die "user.signingkey ist nicht der Schluessel aus ops/release-signing-key.asc ($fpr)."
  git_repo rev-parse -q --verify "refs/tags/$version" >/dev/null && die "Tag $version existiert bereits."
  hash="$(cd "$REPO_DIR" && node ops/create-install-manifest.mjs --check | sed -n 's/^INSTALL_MANIFEST_SHA256=//p')" \
    || die "install-manifest.sha256 ist veraltet: node ops/create-install-manifest.mjs, dann committen."
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "Manifest-Hash konnte nicht ermittelt werden."

  git_repo tag -s "$version" -m "Release $version"
  git_repo verify-tag --raw "$version" 2>&1 | grep -q "VALIDSIG .* $fpr\$" || die "Signatur des Tags konnte nicht mit $fpr bestaetigt werden."

  out="$REPO_DIR/release-assets/$version"
  mkdir -p "$out"
  # Genau der Inhalt aus dem Tag (Zeilenenden wie im Repository), nicht die lokale Arbeitskopie.
  git_repo show "$version:install.sh" >"$out/install.sh"
  gpg --batch --yes --armor --local-user "$fpr" --detach-sign --output "$out/install.sh.asc" "$out/install.sh"
  printf '%s\n' "$hash" >"$out/install-manifest.sha256.txt"
  cat <<EOF
==> Signierter Tag $version auf $(git_repo rev-parse --short HEAD) angelegt.
    Release-Assets: $out

Veroeffentlichen:
  git push origin main $version
  GitHub-Release zu $version anlegen und die drei Dateien aus $out anhaengen.

Installation dieses Releases:
  INSTALL_REF=$version INSTALL_SIGNER_FINGERPRINT=$fpr bash install.sh
EOF
}

case "${1:-}" in
  init) shift; cmd_init "$@" ;;
  tag) shift; cmd_tag "$@" ;;
  *) die "Verwendung: $0 init <SCHLUESSEL-ID> | tag <vJJJJ.MM.N>" ;;
esac
