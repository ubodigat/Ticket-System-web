# Support Portal - Ticketsystem

Selbst gehostetes Helpdesk- und Ticketsystem mit Weboberflaeche, Fastify-Backend,
MariaDB, Docker Compose, serverseitigem Login, Tickets, Benutzerverwaltung,
Einstellungen, Benachrichtigungen, Anhaengen und Audit-Logs.

Admins haben eine Todo-Liste in der Kopfzeile: Ticket-Teilaufgaben mit Ticketfrist sowie
eigene und geteilte Aufgaben mit optionaler Faelligkeit. Erledigte Aufgaben lassen sich
einblenden; Entfernen wirkt nur auf die eigene Liste. Benutzer sehen beim Anmelden eine
Uebersicht ausstehender Rueckfragen. Excel-Anhaenge bieten eine Blattvorschau mit
verbundenen Zellen und Spaltenbreiten (keine vollstaendige Excel-Darstellung).

## Schnellinstallation

Auf einem frischen Debian-/Ubuntu-Server als `root` ausfuehren:

```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash'
```

Fuer lokale Tests ohne oeffentliche Domain:

```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash -s -- --dev'
```

Das Skript installiert fehlende Pakete, Docker und Docker Compose, klont das Projekt nach
`/opt/ticket-system`, erzeugt `.env`, Schluessel und interne TLS-Zertifikate, startet den Stack,
fuehrt Migrationen aus und zeigt danach die URL zur Einrichtung an.

## Nach Der Installation

1. Webseite oeffnen: `https://<server-ip>/`
2. Erste Einrichtung unter `/setup` abschliessen.
3. Danach anmelden unter `/login`.

Weiterleitungen:

- normale Benutzer: `/dashboard.html`
- Admins und Superadmins: `/admin.html`

Bei einer Serverinstallation werden keine Demo-Accounts erzeugt. Das erste Superadmin-Konto wird
im Setup angelegt.

## Wichtige Befehle

Im Installationsordner:

```bash
cd /opt/ticket-system
```

Status:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
```

Logs:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f
```

App neu bauen und starten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --no-deps --build app
```

Migrationen manuell ausfuehren:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Backup:

```bash
./ops/docker/backup.sh
```

## Updates

Empfohlen ist ein kontrolliertes Update auf dem Server:

```bash
cd /opt/ticket-system
git pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --no-deps --build app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Der optionale In-App-Updater ist aus Sicherheitsgruenden nicht der Standardweg. Er benoetigt einen
separaten Updater-Container mit Docker-Socket-Zugriff und sollte nur bewusst aktiviert werden.

Fuer Updates direkt unter **System → Update** aktiviere ihn einmalig (auch bei einer bestehenden
Installation; Datenbank und Zugangsdaten bleiben erhalten):

```bash
cd /opt/ticket-system && git pull --ff-only && bash install.sh --enable-updates
```

Bei einer Neuinstallation kann derselbe Schalter an den Installer angehaengt werden.
Der Installer konfiguriert die interne Verbindung, startet den Updater und speichert die
Aktivierung fuer weitere Container-Neustarts. Nur Superadmins koennen Updates starten.
Der Dienst ist nicht auf einem Host-Port erreichbar, hat aber ueber den Docker-Socket
Host-Rechte. Aktiviere ihn nur auf einem Server, auf dem du diese Berechtigung erlaubst.
Updates verwenden Fast-Forward und brechen bei lokalen Aenderungen ab. Nach Build und
Migration wartet der Updater auf den erfolgreichen App-Healthcheck.

## Projektstatus

Die Serverversion nutzt MariaDB als zentrale Datenbank. Die alte lokale Oberflaeche
(`index.html`, `dashboard.html`, `admin.html`, `js/*.js`, `style.css`) ist weiterhin die UI, aber
im Serverbetrieb an die API angebunden.

Fertig angebunden sind unter anderem:

- Login, Setup und Rollen
- Tickets, Status, Archiv, Kommentare, interne Notizen und Anhaenge
- Benutzer, Gruppen, Abwesenheiten und Vertretungen
- Systemeinstellungen, SMTP, LDAP-Konfiguration und Kategorien
- Kontoanfragen, Benachrichtigungen, Audit-Logs und Wissensdatenbank

Outlook/Microsoft Graph ist derzeit als Konfigurationsbereich vorbereitet. Eine echte
Mailbox-Synchronisation ist noch kein Standardbestandteil der Serverinstallation.

<details>
<summary>Details: Docker-Stack</summary>

Container:

- `mariadb`: MariaDB 12.3
- `app`: Node.js 24 / Fastify / TypeScript
- `caddy`: Reverse Proxy fuer HTTP/HTTPS
- optional `updater`: interner Update-Dienst

Wichtige Dateien:

```text
install.sh
ops/docker/docker-compose.yml
ops/docker/Dockerfile.server
ops/docker/Caddyfile
ops/docker/.env
ops/secrets/app.kek
ops/tls/mariadb/
```

`ops/docker/.env`, `ops/secrets/app.kek`, TLS-Dateien und Backups duerfen nicht veroeffentlicht
oder committet werden. Ohne `ops/secrets/app.kek` koennen verschluesselte Daten nicht wieder
entschluesselt werden.

</details>

<details>
<summary>Details: Lokale Entwicklung</summary>

Fuer normalen Betrieb Docker verwenden. Lokale Entwicklung ist fuer Entwickler gedacht.

Voraussetzungen:

- Node.js 24 oder neuer
- npm
- MariaDB
- OpenSSL

Abhaengigkeiten:

```bash
npm install
```

Server pruefen:

```bash
npm run typecheck --workspace=apps/server
npm run test --workspace=apps/server
npm run build --workspace=apps/server
```

Entwicklungsserver:

```bash
npm run dev --workspace=apps/server
```

</details>

<details>
<summary>Details: Sicherheit</summary>

- Fachliche Daten werden serverseitig in MariaDB gespeichert.
- Sensible Inhalte wie Tickettexte, Benutzerprofile, Benachrichtigungstexte und Secrets werden
  serverseitig verschluesselt.
- Passwoerter werden mit Argon2id gehasht.
- SMTP-/LDAP-Secrets werden nicht im Klartext ueber die API ausgegeben.
- Benutzerrechte werden serverseitig geprueft.
- Der optionale Updater hat bei Aktivierung erweiterte Host-Rechte und ist deshalb bewusst als
  Risikofunktion zu behandeln.

</details>

<details>
<summary>Details: Fehlerbehebung</summary>

Containerstatus:

```bash
docker ps -a
```

Ports pruefen:

```bash
ss -ltnp | grep -E ':(80|443)\b'
```

Healthcheck:

```bash
curl -k -i https://127.0.0.1/health
```

App-Logs:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
```

Caddy-Logs:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f caddy
```

Wenn die Webseite per IP nicht erreichbar ist, zuerst pruefen:

- Container laufen
- Ports `80` und `443` sind offen
- Firewall erlaubt Zugriff
- Browser ruft `https://<server-ip>/` auf
- `/health` liefert `{"status":"ok"}`

</details>
