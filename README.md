# Ticket-System / Support Portal

Selbst gehostetes Ticketsystem mit Benutzerportal, Admin-Board, Aufgaben, Genehmigungen,
Benachrichtigungen und Dokumentenvorschau. Daten werden serverseitig in MariaDB gespeichert.

## Installation mit einem Befehl

Auf einem Debian-/Ubuntu-Server **als root** ausführen. Docker, Docker Compose und die
benötigten Pakete werden automatisch installiert. Empfohlen: mindestens 3 GB RAM;
für den optionalen Virenscanner zusätzlich 1-2 GB.

```bash
bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\n" "d5d41d0c00b5c07973ff14dbb20d80cc44a90d1b0027f944dd4b53a27e5fe247" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=20c86073f8a2466e9e9f754ea44a14b745b0cbd63a6be0bb0ccf60bb79c99882 bash "$f"'
```

Der Befehl prüft das Installationsskript **vor seiner Ausführung** und anschließend die
Dateien des gesamten Installationsstands gegen ein festgelegtes SHA-256-Manifest. Bei
Abweichungen wird abgebrochen. Immer den vollständigen Befehl aus diesem README verwenden,
nicht durch ein ungeprüftes `curl | bash` ersetzen. Skript, Manifest und README müssen
gemeinsam veröffentlicht sein; vor dem Push ist der neue Befehl noch nicht verwendbar.

Nach erfolgreichem Start zeigt der Installer die Adresse und das Setup-Token an.
Adresse öffnen, Token eingeben und das erste Superadmin-Konto einrichten.
Installation: `/opt/ticket-system`; Konfiguration: `ops/docker/.env`.

**Zugriff:** Ports 80/443 müssen vom Arbeitsplatz aus erreichbar sein. Bei Zugriff über
eine lokale IP verwendet Caddy ein internes Zertifikat; dessen CA muss auf den Endgeräten
als vertrauenswürdig eingerichtet werden. Ein gesunder Container allein bestätigt noch
nicht die Erreichbarkeit durch eine externe Firewall oder den Proxmox-Host.

### Mit eigener Domain

DNS muss bereits auf den Server zeigen. Beispielwerte im Befehl ersetzen:

```bash
bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\n" "d5d41d0c00b5c07973ff14dbb20d80cc44a90d1b0027f944dd4b53a27e5fe247" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=20c86073f8a2466e9e9f754ea44a14b745b0cbd63a6be0bb0ccf60bb79c99882 bash "$f" --domain=support.example.com --acme-email=admin@example.com'
```

### Was enthalten ist

- Benutzerkontoanfragen, optionale Kontogültigkeit, Rollen und serverseitige Berechtigungsprüfung.
- Ticket-Board und Listenansicht, Prioritäten, Fristen, Geschäftszeiten, Archiv und Störungen.
- Nachrichten, Anhänge, Teilaufgaben, eigene/geteilte/wiederkehrende Aufgaben und Genehmigungen.
- Office-/PDF-Vorschau über einen isolierten LibreOffice-Dienst.
- SMTP mit verschlüsselter, dauerhafter Versandqueue; LDAP und Outlook nach Einrichtung.
- Argon2id, widerrufbare Sitzungen, optionale 2FA-Pflicht, CSRF-Schutz und Feldverschlüsselung.

**Browser-Benachrichtigungen:** In den persönlichen Einstellungen unter
Benachrichtigungen einschalten und die Browser-Abfrage erlauben. Die Freigabe gilt pro
Konto und Browser-Gerät. Neue In-App-Meldungen erscheinen dann auch als Desktop-Mitteilung;
ein Klick öffnet das zugehörige Ticket bzw. die Aufgabenliste. Voraussetzung sind ein
unterstützter Desktop-Browser und vertrauenswürdiges HTTPS (bei lokalen IPs Caddy-CA installieren).
Ein Tab des Ticket-Systems muss geöffnet bleiben, auch im Hintergrund. Die Prüfung erfolgt
alle 30 Sekunden, bei Verbindungsfehlern mit längeren Abständen. Bei geschlossener App gibt
es keinen Web-Push. Alte Meldungen werden beim Aktivieren nicht nachträglich eingeblendet.

SMTP, LDAP und Microsoft Graph benötigen eigene Zugangsdaten. Für Graph muss die
Anwendungsberechtigung im Tenant auf das vorgesehene Postfach begrenzt werden.
Kalendereinladungen sind nur für Admins an bekannte aktive Konten erlaubt.

## Aktualisieren

Vorher ein Backup erstellen. In einem bewusst geprüften lokalen Repository:

```bash
cd /opt/ticket-system
bash ops/docker/backup.sh
bash ops/verify-and-pull.sh
bash install.sh
```

`verify-and-pull.sh` holt neue Commits und bricht ab, falls der neue Stand nicht mit einem
bekannten Schlüssel signiert ist (Security-Audit R-14) -- bis ein öffentlicher
Signaturschlüssel importiert ist (`gpg --import ...`), muss die Änderung dann bewusst manuell
geprüft werden, statt ungeprüft übernommen zu werden.

Der Installer übernimmt bestehende Daten und Schlüssel, prüft das Laufzeit-Datenbankkonto
und führt die Migrationen aus. Während der Datenmigration wird die alte App angehalten,
damit sie keine Klartextwerte mehr nachschreiben kann. Schlägt die Migration fehl, bleibt
die App bis zur Fehlerbehebung angehalten. Keine Volumes löschen und keine neuen Schlüssel über alte
Schlüssel schreiben. Migrationen dürfen nicht im dauerhaft laufenden App-Container
ausgeführt werden: Dieser besitzt absichtlich keine DDL-Zugangsdaten.

**Online-Updates:** Standardmäßig deaktiviert. Der optionale Updater benötigt privilegierten
Docker-Host-Zugriff und akzeptiert ausschließlich signierte Commits mit einem vom Betreiber
hinterlegten Schlüssel. Ohne Schlüssel bleiben Updates gesperrt, auch mit
`UPDATE_REQUIRE_SIGNED_COMMITS=false`. Details unten.

<details>
<summary>Betrieb, Fehlersuche, optionale Dienste und Entwicklung</summary>

## Docker Compose

### Befristete Benutzerkonten

In der Benutzerverwaltung beim Anlegen oder Bearbeiten das optionale Feld **Gültig bis
einschließlich** setzen. Das Konto bleibt bis zum Ende dieses Tages nutzbar (Europe/Berlin),
danach werden Anmeldung und bestehende Sitzungen abgewiesen. Ein leeres Datum bedeutet
unbegrenzte Gültigkeit. Das Datum kann mit Benutzerverwaltungsrechten geändert oder entfernt
werden; normale Benutzer können es nicht selbst verlängern. Der letzte dauerhaft verfügbare
Superadmin darf nicht befristet werden. Bestehende Konten bleiben ohne Datum gültig.

Die neue Spalte wird beim regulären Installer-/Update-Lauf durch Migration 0045 angelegt.

### Container verwalten

Alle Befehle im Installationsverzeichnis ausführen:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs --tail=100 app mariadb caddy
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env restart app
```

Der Stack enthält App, MariaDB, Caddy und Gotenberg. Datenbank und Office-Dienst haben
keine veröffentlichten Host-Ports. Images und Node-Basisimages sind per Digest festgelegt;
Sicherheitsaktualisierungen der Digests müssen bewusst geprüft und eingepflegt werden.

Wenn das Proxy-Netz kollidiert, `EDGE_SUBNET` in `ops/docker/.env` auf ein freies privates
Subnetz setzen. Compose und Proxy-Vertrauen verwenden denselben Wert.

### Bestehende Installation startet nicht / Datenbankanmeldung scheitert

`bash install.sh` erhält Passwörter einschließlich aller `=`-Zeichen. Es richtet das
eingeschränkte Laufzeitkonto mit Root-Rechten ein und prüft dessen Anmeldung über TLS,
bevor die App neu gestartet wird. DDL-Zugangsdaten gelangen nicht in die laufende App.

Bei älteren Installationen wird das ursprünglich von MariaDB generierte Root-Passwort
aus den vorhandenen Containerlogs übernommen. Sind diese nicht mehr vorhanden, muss
das tatsächliche bestehende Root-Passwort einmalig als `DB_ROOT_PASSWORD` in
`ops/docker/.env` eingetragen werden. Der Installer kann ein verlorenes Passwort nicht
rekonstruieren und bricht dann ab, ohne Daten oder Volumes zu löschen.

### Online-Updater bewusst aktivieren

Nur einsetzen, wenn der Docker-Host-Zugriff ausdrücklich akzeptiert wird. Ein kompromittierter
Updater besitzt Host-Rechte. Die sichere Standardinstallation startet diesen Dienst nicht.

Den öffentlichen Release-Signaturschlüssel über einen vertrauenswürdigen Kanal beziehen und
seinen Fingerprint unabhängig prüfen. Anschließend auf dem Host importieren:

```bash
mkdir -p ops/docker/update-keys
chmod 700 ops/docker/update-keys
gpg --homedir "$PWD/ops/docker/update-keys" --import /root/release-signing-key.asc
bash install.sh --enable-updates
```

Der Schlüsselbund wird nur lesend eingebunden. Nach Schlüsseländerungen den Updater neu
starten. Unsignierte Commits und unbekannte Signaturen werden abgelehnt; der Entwickler
muss Release-Commits entsprechend signieren. Rollbacks mit Schemaänderungen sind gesperrt
und erfordern eine Wiederherstellung mit passendem Datenbank-Backup.

### Weitere Optionen

- `--enable-antivirus`: ClamAV aktivieren; ohne funktionierenden Scanner schlagen Uploads bei aktivierter Prüfung fehl.
- `--dev`: lokale Testkonfiguration, nicht für öffentliche Produktionsinstallationen.
- `--domain=... --acme-email=...`: öffentlich vertrauenswürdiges HTTPS über ACME.
- `--no-assume-yes`: Paketinstallationen nicht automatisch bestätigen.

### Backups und Mailzustellung

```bash
bash ops/docker/backup.sh
bash ops/docker/restore.sh
```

Backup-Anweisungen und erforderliche Parameter in den Skripten beachten. KEK,
Installations-ID, Datenbank und Konfiguration gehören zusammen; ein Datenbankdump ohne
passenden KEK ist nicht wiederherstellbar.

Mails werden verschlüsselt in `jobs` gespeichert und getrennt vom HTTP-Request versendet.
Fehler werden mit Wartezeiten bis zu fünfmal versucht; erschöpfte Jobs haben Status `dead`.
Abgeschlossene Nutzdaten werden sofort entfernt, tote Jobs nach sieben Tagen gelöscht.
Bei einem Absturz direkt nach der SMTP-Annahme kann eine Mail doppelt zugestellt werden
(At-least-once-Zustellung). Serverlogs enthalten Job-ID und Versuchszahl, keinen Mailinhalt.

## Entwicklung und Verifikation

Node.js 24+, für Integrationstests eine separate MariaDB-Testdatenbank:

```bash
npm ci
npm run typecheck --workspace=apps/server
npm run test --workspace=apps/server
npm run build --workspace=apps/server
npm audit --audit-level=high
bash ops/tests/installer-security.sh
```

CI prüft zusätzlich den Upgrade-Pfad von Schema 0037 mit Bestandsdaten gegen MariaDB.
Ein lokaler grüner Unit-Testlauf ersetzt keinen erfolgreichen Compose-/Upgrade-Test.

Nach Quellcodeänderungen **vor Veröffentlichung**:

```bash
node ops/create-install-manifest.mjs
node ops/create-install-manifest.mjs --check
```

Der erste Befehl aktualisiert Manifest und Installationsbefehle im README. Alle Änderungen
gemeinsam veröffentlichen. CI weist ein veraltetes Manifest zurück. Das README ist als
Hash-Vertrauensanker selbst nicht Teil des Manifests.

Architektur, Grenzen und Sicherheitsentscheidungen: [docs](docs),
[Sicherheitsmodell](docs/THREAT_MODEL.md), [aktueller Reparaturstand](docs/SECURITY-REMEDIATION.md).

</details>

## Lizenz

CPAL-1.0. Originalprojekt [Ticket-System-web](https://github.com/ubodigat/Ticket-System-web)
von U:Bodigat. Siehe [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) und [CONTRIBUTORS.md](CONTRIBUTORS.md).
