#!/usr/bin/env bash
# Security-Audit R-14: "git pull --ff-only" allein bringt keinerlei Integritaetspruefung --
# jeder, der in die Lage versetzt wird, den Remote zu manipulieren (kompromittiertes GitHub-Konto,
# DNS-/MITM-Angriff auf einen Fork, ...), koennte sonst unbemerkt Code einschleusen, der bei einem
# manuellen Update direkt uebernommen wird. Dieses Skript holt neue Commits, prueft den neuen
# HEAD auf eine gueltige GPG-Signatur (git verify-commit) und mergt nur bei Erfolg.
#
# Voraussetzung: der oeffentliche Schluessel der Person/des Prozesses, die main signiert, muss
# vorher lokal importiert sein (gpg --import <schluessel>.asc). Ohne importierten Schluessel
# bricht dieses Skript bewusst ab (fail-closed), statt stillschweigend ungeprueft zu aktualisieren.
set -euo pipefail

if [[ ! -d .git ]]; then
  echo "Bitte aus dem Wurzelverzeichnis des geklonten Repositories ausfuehren." >&2
  exit 1
fi

echo "==> Hole neue Commits und Release-Tags (noch kein Merge)"
git fetch --tags origin

TARGET_REF="origin/$(git rev-parse --abbrev-ref HEAD)"
NEW_HEAD="$(git rev-parse "$TARGET_REF")"
CURRENT_HEAD="$(git rev-parse HEAD)"

if [[ "$NEW_HEAD" == "$CURRENT_HEAD" ]]; then
  echo "Bereits auf dem neuesten Stand."
  exit 0
fi

# Gueltig: Signatur auf dem Commit selbst oder auf einem Release-Tag (v*, release-*), der genau darauf zeigt.
verified_tag=""
for tag in $(git tag --points-at "$NEW_HEAD"); do
  [[ "$tag" =~ ^(v|release-)[0-9A-Za-z._-]+$ ]] || continue
  if git verify-tag "$tag" >/dev/null 2>&1; then verified_tag="$tag"; break; fi
done
echo "==> Pruefe Signatur von $NEW_HEAD"
if [[ -n "$verified_tag" ]]; then
  echo "Signierter Release-Tag: $verified_tag"
elif ! git verify-commit "$NEW_HEAD" 2>&1; then
  cat >&2 <<EOF

Der neue Commit ($NEW_HEAD) ist nicht mit einem bekannten Schluessel signiert.
Kein automatischer Merge -- entweder:
  1. den richtigen oeffentlichen Schluessel importieren (gpg --import ...) und erneut versuchen, oder
  2. die Aenderungen manuell pruefen (git log HEAD..$TARGET_REF, git diff HEAD $TARGET_REF)
     und bei Vertrauen bewusst selbst mergen: git merge --ff-only "$TARGET_REF"
EOF
  exit 1
fi

echo "==> Signatur gueltig, merge (fast-forward)"
git merge --ff-only "$TARGET_REF"
echo "Fertig. Jetzt 'bash install.sh' ausfuehren, um die Anwendung zu aktualisieren."
