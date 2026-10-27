# Ticket-System / Support Portal

Selbst gehostetes Ticketsystem mit Benutzerportal, Admin-Board, Aufgaben, Genehmigungen,
Benachrichtigungen und Dokumentenvorschau. Daten werden serverseitig in MariaDB gespeichert.

## Installation mit einem Befehl

Auf einem Debian-/Ubuntu-Server **als root** ausführen. Docker, Docker Compose und die
benötigten Pakete werden automatisch installiert. Empfohlen: mindestens 3 GB RAM;
für den optionalen Virenscanner zusätzlich 1-2 GB, für die Office-Oberfläche zusätzlich
4 GB. Die Grundinstallation verwendet die PDF-Vorschau; die Office-Oberfläche wird mit
`--enable-office-viewer` aktiviert (Anleitung unten).

```bash
bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\n" "821522da4cb9785b4ccaaab08e501809ab93cd9222bb45ccf53bb17134693524" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=d133e0a9889801530952a8a1efdb9106b82e664815f13c715927780759cccde9 bash "$f"'
```

Der Befehl prüft das Installationsskript **vor seiner Ausführung** und anschließend die
Dateien des gesamten Installationsstands gegen ein festgelegtes SHA-256-Manifest. Bei
Abweichungen wird abgebrochen. Immer den vollständigen Befehl aus diesem README verwenden,
nicht durch ein ungeprüftes `curl | bash` ersetzen. Skript, Manifest und README müssen
gemeinsam veröffentlicht sein; vor dem Push ist der neue Befehl noch nicht verwendbar.

Nach erfolgreichem Start zeigt der Installer die Adresse und das Setup-Token an.
Vor der Erfolgsmeldung prüft er die öffentliche Anmeldeseite, JavaScript-Module und
Stylesheets über Caddy. Fehlen erforderliche Dateien oder startet der Webzugang nicht,
bricht er mit einer Fehlermeldung ab. `/health` ist öffentlich absichtlich gesperrt
(404); dieser Pfad wird nur intern für den Container-Healthcheck verwendet.
Adresse öffnen, Token eingeben und das erste Superadmin-Konto einrichten.
Installation: `/opt/ticket-system`; Konfiguration: `ops/docker/.env`.

**Zugriff:** Ports 80/443 müssen vom Arbeitsplatz aus erreichbar sein. Bei Zugriff über
eine lokale IP verwendet Caddy ein internes Zertifikat; dessen CA muss auf den Endgeräten
als vertrauenswürdig eingerichtet werden. Ein gesunder Container allein bestätigt noch
nicht die Erreichbarkeit durch eine externe Firewall oder den Proxmox-Host.

### Mit eigener Domain

DNS muss bereits auf den Server zeigen. Beispielwerte im Befehl ersetzen:

```bash
bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\n" "821522da4cb9785b4ccaaab08e501809ab93cd9222bb45ccf53bb17134693524" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=d133e0a9889801530952a8a1efdb9106b82e664815f13c715927780759cccde9 bash "$f" --domain=support.example.com --acme-email=admin@example.com'
```

### Was enthalten ist

- Benutzerkontoanfragen, optionale Kontogültigkeit, Rollen und serverseitige Berechtigungsprüfung.
- Ticket-Board und Listenansicht, Prioritäten, Fristen, Geschäftszeiten, Archiv und Störungen.
- Nachrichten, Anhänge, Teilaufgaben, eigene/geteilte/wiederkehrende Aufgaben und Genehmigungen.
- PDF-Vorschau und optionale, schreibgeschützte Office-Oberfläche über isolierte Dokumentendienste.
- SMTP mit verschlüsselter, dauerhafter Versandqueue; LDAP und Outlook nach Einrichtung.
- Argon2id, widerrufbare Sitzungen, MFA mit TOTP/Passkeys, CSRF-Schutz und Feldverschlüsselung.
- Benutzerbezogenes Design über mehrere Geräte und Ticket-Timer mit verpflichtender Tätigkeitsdokumentation.

<details>
<summary>Office-Oberfläche aktivieren (nur lesen)</summary>

Die Office-Ansicht nutzt einen zusätzlichen ONLYOFFICE-Dienst: Tabellen mit Arbeitsblättern,
Word-Dokumente und Präsentationen werden in dessen Office-Oberfläche geöffnet. Die Ansicht
ist schreibgeschützt; Änderungen am Original sind gesperrt. Fehlende Schriftarten oder
besondere Office-Funktionen können weiterhin zu Abweichungen von Microsoft Office führen.
Neue Office-Uploads sind für DOCX, XLSX, PPTX und ODT/ODS/ODP freigegeben; die zusätzlichen
Formate müssen zur erkannten Dateistruktur passen. Makroformate bleiben gesperrt.

Bei der Erstinstallation diesen verifizierten Befehl verwenden; mit einer eigenen Domain
zusätzlich `--domain=… --acme-email=…` hinter `--enable-office-viewer` ergänzen:

```bash
bash -c 'set -euo pipefail; if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl ca-certificates; fi; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh -o "$f"; printf "%s  %s\n" "821522da4cb9785b4ccaaab08e501809ab93cd9222bb45ccf53bb17134693524" "$f" | sha256sum -c -; INSTALL_MANIFEST_SHA256=d133e0a9889801530952a8a1efdb9106b82e664815f13c715927780759cccde9 bash "$f" --enable-office-viewer'
```

Bei einem bereits aktualisierten Checkout auf dem Server:

```bash
cd /opt/ticket-system
bash install.sh --enable-office-viewer
```

Der Installer aktiviert das Compose-Profil `office-viewer`, erstellt ein dauerhaftes
JWT-Geheimnis und startet den Dienst ohne öffentliche Zusatzports. Beim ersten Start
braucht ONLYOFFICE einige Minuten. Bis er bereit ist, bleibt die PDF-Vorschau verfügbar.
Mindestens etwa **7 GB RAM für den gesamten Stack** vorsehen, mit Virenscanner entsprechend
mehr. Dateien über 15 MiB bleiben auf den Download beschränkt. Die Dokumentendienste halten
entschlüsselte Arbeitskopien im Container; Zugriff auf Docker/Server bleibt deshalb privilegiert.

Technische Grundlage: [ONLYOFFICE Docker-Installation](https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx)
und [JWT-Absicherung](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/security/).

</details>

<details>
<summary>MFA, Gerätefreigabe und Wiederherstellung</summary>

Unter **Systemeinstellungen → Sicherheit → MFA-Methoden** stehen nach dem Passwort
TOTP, Passkey, TOTP oder Passkey sowie TOTP + Passkey zur Auswahl. Die Pflicht kann für
alle Konten, Admins inklusive Superadmins oder Benutzer gelten. Bei TOTP + Passkey beträgt
die zusätzliche Gerätefreigabe standardmäßig **14 Tage**; `0` verlangt den Passkey bei jeder
Anmeldung. Das Gerät wird über ein HttpOnly-Cookie und einen benutzergebundenen
Datenbanknachweis erkannt. Ein neues Gerät benötigt einen neuen Nachweis. Eine reine
Passkey-Regel verlangt den Passkey weiterhin bei jeder Anmeldung.

Passkeys benötigen einen **Domainnamen mit vertrauenswürdigem HTTPS**, nicht nur eine
LAN-IP. `PUBLIC_URL` wird vom Installer inklusive HTTPS-Port gesetzt und als
`WEBAUTHN_ORIGIN` an die App übergeben. Nach einer Domainänderung Installer erneut ausführen;
Passkeys sind an ihre bisherige Domain gebunden und müssen bei einer anderen Domain neu
registriert werden. Die Pflicht zu Passkeys kann nur über die passend konfigurierte
HTTPS-Domain aktiviert werden. Bestehende Sitzungen behalten ihre normale Laufzeit;
die neue Anmelderegel greift bei der nächsten Anmeldung.

Eigene Verfahren unter **Persönliche Einstellungen → Sicherheit → MFA / Passkeys verwalten**
einrichten. Zuerst TOTP aktivieren. Neue Passkeys sowie das Entfernen von Schlüsseln oder
Erzeugen neuer Wiederherstellungscodes verlangen das aktuelle Passwort und einen frischen
TOTP-Code. Handy-Passkeys, Computer und FIDO2-Sicherheitsschlüssel werden über den Browser
ausgewählt; SMS/Push sind ohne zusätzlichen Anbieter nicht enthalten. Für Passkeys wird
Benutzerverifikation verlangt (z. B. Geräte-PIN oder Biometrie).

Die zehn Wiederherstellungscodes werden **nur einmal angezeigt** und gehasht gespeichert.
Offline aufbewahren. Passwort + ein unbenutzter Code setzen bisherige MFA-Verfahren und
Sitzungen zurück; vor dem Login müssen die vorgeschriebenen Verfahren neu eingerichtet
werden. Neue Codes ersetzen alle alten. Ohne Code kann ein entsprechend berechtigter
Superadmin zurücksetzen. Als letzter Rettungsweg auf dem Server:

```bash
cd /opt/ticket-system
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec app node dist/cli/unlock.js admin --reset-mfa
```

Dieser explizite Serverbefehl widerruft die bisherigen Verfahren/Sitzungen des genannten
Kontos und wird protokolliert. Er ersetzt kein Passwort und deaktiviert keine globale MFA-Regel.
Protokollimplementierung: [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server).

</details>

<details>
<summary>Persönliches Design, einklappbare Einstellungen und Ticket-Timer</summary>

Design, Akzentfarbe, Sprache und eigenes Hintergrundbild liegen für angemeldete Personen
verschlüsselt in MariaDB. Ein anderer Browser desselben Kontos übernimmt diese Werte.
Änderungen werden einzeln zusammengeführt, damit eine neue Akzentfarbe kein Bild überschreibt.
Vor der Anmeldung bleiben die Einstellungen browserbezogen. Vorhandene, nicht eindeutig
einem Konto zuordenbare Browserbilder werden nicht automatisch in ein fremdes Konto importiert;
das gewünschte Bild nach dem Update einmal im eigenen Konto auswählen.

Unterüberschriften der Systemeinstellungen lassen sich auf-/zuklappen. Ihr Zustand wird
sofort für das jeweilige Konto gespeichert und beim nächsten Öffnen vom Server geladen.

Admins starten die Zeiterfassung über das Play-Icon im Ticketkopf. Das Stop-Icon hält die
Zeit an und öffnet die Tätigkeitsdokumentation. Ohne eine nicht leere Beschreibung lässt
sich die Erfassung nicht abschließen. Optionale Lösungsschritte werden als interne
Lösungsnotiz gespeichert. Zeit und Notiz werden gemeinsam in einer Transaktion geschrieben;
angefangene Minuten zählen als volle Minuten. Pro Admin kann ein Timer aktiv oder noch
undokumentiert sein. Laufende und angehaltene Timer bleiben nach Neuladen erhalten.
Ein Browser/Tab selbst kann geschlossen werden; beim nächsten Besuch erscheint die noch
ausstehende Dokumentation erneut.

Die Schema-Erweiterungen sind Migrationen **0050 und 0051**. Der Installer führt sie vor
dem App-Start aus; eine reine Ersetzung von Frontend-Dateien reicht für dieses Update nicht.

</details>

<details>
<summary>Passwortregeln und große Anhänge</summary>

**Passwortregeln:** Unter Systemeinstellungen → Sicherheit lassen sich Mindestlänge
(14–128 Zeichen) und Mindestanzahl an Klein-/Großbuchstaben, Ziffern und Sonderzeichen
festlegen. Sie gelten beim Anlegen und Ändern von Passwörtern; bestehende Passwörter
werden nicht rückwirkend ungültig. Für das erste Setup gelten mindestens 14 Zeichen.

**Anhänge:** Bis zu 500 MiB pro Datei in der Ticket-Anhangsliste und Wissensdatenbank.
Große Dateien werden blockweise übertragen und verschlüsselt in MariaDB gespeichert
(Migration 0049); die Freigabe erfolgt erst nach vollständiger Prüfung. Pro Konto sind
für diesen Uploadweg 2 GiB innerhalb von 24 Stunden reservierbar. Dateien über 15 MiB
werden heruntergeladen statt vorgerendert. Große Dateien direkt an das Ticket anhängen,
nicht an private Notizen oder Chat-Nachrichten. Für 500-MiB-Dateien entsprechend RAM,
Datenbank-/Backup-Speicher und Uploadzeit einplanen; empfohlen sind mindestens 6 GB RAM.
Die endgültige Inhaltsprüfung verarbeitet pro App-Instanz nur eine große Datei gleichzeitig.

Optionaler vollständiger 500-MiB-Test (isolierte Datenbank-Nachbildung, ca. 1–2 GB RAM):

```bash
RUN_LARGE_UPLOAD_TEST=1 npm run test --workspace=apps/server -- test/uploads.test.ts
```

Der reguläre Testlauf überspringt diesen großen Test. Der MariaDB-CI-Test prüft separat
das Schema-Upgrade und einen echten verschlüsselten 8-MiB-Datenblock.

</details>

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
Tickettermine dürfen nur Admins erstellen, auch mit externen E-Mail-Adressen
(maximal 20 Teilnehmende und 20 Terminerstellungen pro Stunde). Im persönlich verbundenen
Outlook-Kalender gelten dieselben Empfänger-/Ratenlimits für das eigene Konto.

<details>
<summary>Outlook einrichten und E-Mail-Vorlagen</summary>

Unter Systemeinstellungen → Outlook Tenant-ID, Client-ID und das gültige Client-Secret
der eigenen Microsoft-Entra-App speichern. Auch der zentrale Speichern-Button übernimmt
das neu eingegebene Secret. Für persönliche Kalender muss die Redirect-URI
`https://DEIN-HOST/api/v2/outlook/callback` einschließlich eines abweichenden Ports exakt
registriert sein; delegierte Berechtigungen: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
Für Tickettermine zusätzlich App-only-Kalenderberechtigungen und ein begrenztes Supportpostfach
einrichten. Ohne diese externen Zugangsdaten ist keine echte Microsoft-Verbindung möglich.

E-Mail-Vorlagen unterstützen `{{subject}}`, `{{message}}` und `{{recipient}}`.
Die Signatur wird anschließend ergänzt. Externe Einladungen benötigen kein Portal-Konto.
Die optionalen ClamAV-Einstellungen für große Dateien liegen in
`ops/docker/clamav/clamd.conf` ([offizielle Konfigurationsdokumentation](https://docs.clamav.net/manual/Installing/Docker.html)).

</details>

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
