# Betrieb

Alle Befehle werden als root im Installationsverzeichnis (Standard `/opt/ticket-system`) ausgeführt.

## Update

### Online (empfohlen)

Systemeinstellungen › Info & Updates › **Jetzt aktualisieren**. Voraussetzungen: Host-Updater
aktiviert (`bash install.sh --enable-updates`) und Signaturschlüssel hinterlegt. Ablauf:

1. **Prüfung**: Signatur des Ziel-Commits bzw. Release-Tags, keine lokalen Änderungen, freier Speicher.
2. **Sicherung**: verschlüsselte Datensicherung der Datenbank.
3. **Herunterladen**: Code auf den geprüften Stand bringen.
4. **Installation**: neues App-Image bauen (die App bleibt bis dahin erreichbar).
5. **Datenbank**: Schema-Abgleich – fehlende Tabellen, Spalten und Indizes werden angelegt, Spalten
   nur verlustfrei erweitert. **Es wird nie etwas gelöscht.**
6. **Neustart**: App starten und auf den Healthcheck warten (ca. eine Minute nicht erreichbar).

Schlägt ein Schritt ab „Herunterladen“ fehl, setzt der Updater automatisch auf die vorherige Version
zurück; die Daten bleiben erhalten. „Erneut ausrollen“ wiederholt den aktuellen Stand nach einem
Abbruch, „Zurücksetzen“ kehrt zur Version vor dem letzten Update zurück.

### Manuell

```bash
bash ops/docker/backup.sh
bash ops/verify-and-pull.sh
bash install.sh
```

## Datenbankschema

Es gibt keine Migrationsdateien. `apps/server/src/db/schema.ts` beschreibt das vollständige Schema,
`node dist/cli/schema.js` gleicht eine Datenbank damit ab (Installer und Updater rufen das auf).
`--check` zeigt nur an, was zu tun wäre. Weicht eine Spalte so ab, dass eine Anpassung Daten kosten
könnte, bricht der Abgleich ab, bevor irgendetwas geändert wird.

Die App startet nur, wenn die Datenbank zum Schema des Codes passt.

## Sicherung

| Teil | Inhalt | Wo |
| --- | --- | --- |
| Datensicherung | Datenbank-Dump, asymmetrisch verschlüsselt | `ops/backups/` + externe Kopie |
| Wiederherstellungs-Kit | KEK, `.env`, TLS, Schlüssel der Dateiverschlüsselung, privater Sicherungsschlüssel | **nicht auf dem Server** |

- Einmalig: `bash ops/docker/backup.sh --init-keys` (macht der Installer bei der Ersteinrichtung und
  zeigt Kit-Pfad und Passphrase einmal an).
- Täglich automatisch (systemd-Timer `ticket-system-backup.timer`) und vor jedem Update.
- Nach einer KEK-Rotation: `bash ops/docker/backup.sh --recovery-kit`.

### Externe Kopie

In `ops/docker/.env` eintragen:

```
# restic (z. B. rest-server mit --append-only)
BACKUP_RESTIC_REPOSITORY=rest:https://backup.example.com/ticket-system
BACKUP_RESTIC_PASSWORD_FILE=/root/.restic-ticket-system
# oder S3 mit Object Lock (aws CLI)
BACKUP_S3_URI=s3://firma-backups/ticket-system
```

Solange keine externe Kopie besteht, warnt die Oberfläche.

## Wiederherstellung

```bash
# Restore-Test (verändert nichts):
bash ops/docker/restore.sh --verify recovery-kit-*.tar.gz.gpg ops/backups/ticket-system-data-*.sql.gz.gpg
# Wiederherstellen auf diesem Server:
bash ops/docker/restore.sh recovery-kit-*.tar.gz.gpg ops/backups/ticket-system-data-*.sql.gz.gpg
bash install.sh
# Neuer, leerer Server: Installer ausführen, dann
bash ops/docker/restore.sh --with-secrets recovery-kit-*.tar.gz.gpg ticket-system-data-*.sql.gz.gpg
bash install.sh
```

Eine ältere Sicherung lässt sich nach einem Update einspielen; der anschließende Installer-Lauf bringt
das Schema auf den aktuellen Stand, ohne Daten zu verlieren. Restore-Test mindestens vierteljährlich
durchführen und dokumentieren.

## Schlüsselrotation

```bash
bash ops/docker/rotate-keys.sh status
bash ops/docker/rotate-keys.sh kek   # KEK möglicherweise offengelegt
bash ops/docker/rotate-keys.sh dek   # DEKs möglicherweise offengelegt
bash ops/docker/backup.sh --recovery-kit
```

Details: [Kryptografie](CRYPTOGRAPHY.md).

## Release erstellen (Maintainer)

Vertrauensanker der Installation ist ein Signaturschlüssel, dessen Fingerabdruck an einer vom
Repository unabhängigen Stelle veröffentlicht ist (z. B. eigene Website).

1. Einmalig: Schlüssel erzeugen, öffentlichen Teil als `ops/release-signing-key.asc` ins Repository
   legen, auf keys.openpgp.org hochladen und den Fingerabdruck auf der Website veröffentlichen.
2. Je Release: `node ops/create-install-manifest.mjs`, Commit, signierter Tag
   `git tag -s vJJJJ.MM.N -m "Release vJJJJ.MM.N"`, Push von Commit und Tag.
3. Release-Assets: `install.sh`, `install.sh.asc` (`gpg --armor --detach-sign install.sh`) und
   `install-manifest.sha256.txt` (nur der Manifest-Hash aus `node ops/create-install-manifest.mjs --check`).

Dieselben Schlüssel können für das Online-Update hinterlegt werden (`ops/docker/update-keys`).

## Container-Härtung

`app`, `mariadb` und `caddy` laufen ohne Linux-Capabilities (nur die nötigsten werden ergänzt), mit
`no-new-privileges`, Speicher- und CPU-Grenzen; `app` und `caddy` mit nur lesbarem Dateisystem.

## Rate-Limits

Enge Limits (Anmeldung, MFA, Setup, Passwort, Update, Sicherung) zählen in der Datenbank und gelten
über Neustarts hinweg. Das grobe globale Limit gegen Überlastung liegt im Speicher.
