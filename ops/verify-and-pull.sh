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

echo "==> Hole neue Commits (noch kein Merge)"
git fetch origin

TARGET_REF="origin/$(git rev-parse --abbrev-ref HEAD)"
NEW_HEAD="$(git rev-parse "$TARGET_REF")"
CURRENT_HEAD="$(git rev-parse HEAD)"

if [[ "$NEW_HEAD" == "$CURRENT_HEAD" ]]; then
  echo "Bereits auf dem neuesten Stand."
  exit 0
fi

echo "==> Pruefe Signatur von $NEW_HEAD"
if ! git verify-commit "$NEW_HEAD" 2>&1; then
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
