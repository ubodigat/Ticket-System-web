# Docker-Betrieb

Dieses Verzeichnis enthält den Docker-Stack mit MariaDB, Anwendung, Caddy und der isolierten
Office-Dokumentkonvertierung (`office`, Gotenberg/LibreOffice). Der Office-Dienst hat keine
Host-Ports, Secrets oder Datenbankverbindung und darf keine externen Inhalte nachladen.
Installation und Bedienung: [README](../../README.md); Update, Sicherung, Wiederherstellung und
Schlüsselrotation: [docs/OPERATIONS.md](../../docs/OPERATIONS.md).

## Installation (einmalig)

```bash
./install.sh
```

Das Skript (im Projektwurzelverzeichnis):
1. erzeugt alle Secrets (DB-Passwörter, Cookie-Secret, Installations-ID) – idempotent, vorhandene
   Secrets werden wiederverwendet;
2. erzeugt den KEK-Schlüsselbund (`ops/secrets/app.kek`), die Schlüssel der Dateiverschlüsselung
   von MariaDB (`ops/secrets/mariadb-encryption/`) und die TLS-Kette App↔MariaDB (`ops/tls/mariadb/`)
   – siehe [docs/CRYPTOGRAPHY.md](../../docs/CRYPTOGRAPHY.md);
3. erzeugt bei der Ersteinrichtung den Sicherungsschlüssel und das Wiederherstellungs-Kit (Pfad und
   Passphrase werden einmal angezeigt), bei bestehenden Installationen eine Datensicherung;
4. baut den Stack und bringt die Datenbank auf das aktuelle Schema (`node dist/cli/schema.js`,
   vorhandene Daten bleiben erhalten);
5. startet `mariadb`, `app`, `office`, `caddy`, richtet den täglichen Sicherungs-Timer ein und
   wartet auf den Healthcheck;
6. gibt die erreichbare URL aus.

Für eine lokale Entwicklungsumgebung ohne öffentliches TLS: `./install.sh --dev`.

`ops/secrets/`, `ops/tls/` und `ops/backups/` sind bewusst nicht versioniert (siehe `.gitignore`).

## Update

Über die Oberfläche: Systemeinstellungen › Info & Updates › **Jetzt aktualisieren** (Sicherung,
Signaturprüfung, Build, Schema-Abgleich, Neustart, automatisches Zurücksetzen bei Fehlern).
Manuell:

```bash
bash ops/docker/backup.sh
bash ops/verify-and-pull.sh
bash install.sh
```

## Sicherung und Wiederherstellung

```bash
bash ops/docker/backup.sh                                   # Datensicherung (auch täglich per Timer)
bash ops/docker/restore.sh --verify <kit> <datensicherung>  # Restore-Test, verändert nichts
bash ops/docker/restore.sh <kit> <datensicherung>           # Datenbank ersetzen, danach install.sh
```

Datensicherungen sind asymmetrisch verschlüsselt und enthalten weder KEK noch `.env`; beides steckt
im Wiederherstellungs-Kit, das nicht auf dem Server bleibt. Details: [docs/OPERATIONS.md](../../docs/OPERATIONS.md).

## Logs/Diagnose

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env run --rm --no-deps app node dist/cli/schema.js --check
```
