# Support Portal - Ticketsystem

Ein selbst gehostetes Helpdesk- und Ticketsystem mit Docker-Installation, MariaDB,
serverseitigem Login und angebundener Weboberflaeche.

Der fruehere Browser-Prototyp (`index.html`, `dashboard.html`, `admin.html`, `script.js`,
`style.css`) wird weiterhin als Oberflaeche genutzt, ist aber im Serverbetrieb an den neuen
Fastify/MariaDB-Server angebunden. Tickets, Benutzer, Gruppen, Einstellungen, Logs,
Benachrichtigungen, Kontoanfragen, Listenansichten und Anhaenge werden serverseitig gespeichert.

## Inhalt

- [Schnellstart](#schnellstart)
- [Nach Der Installation](#nach-der-installation)
- [Docker-Betrieb](#docker-betrieb)
- [Updates](#updates)
- [Backups](#backups)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Projektstruktur](#projektstruktur)
- [Daten Und Funktionen](#daten-und-funktionen)
- [Sicherheit](#sicherheit)
- [Tests Und CI](#tests-und-ci)
- [Fehlerbehebung](#fehlerbehebung)

## Schnellstart

Auf einem frischen Ubuntu-/Debian-Server als `root` ausfuehren:

```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash'
```

Fuer lokale Tests ohne oeffentliche Domain:

```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash -s -- --dev'
```

Das Installationsskript:

1. installiert fehlende Basispakete,
2. installiert Docker und Docker Compose, falls noetig,
3. klont das Repository nach `/opt/ticket-system`, falls es noch nicht vorhanden ist,
4. erzeugt `ops/docker/.env`,
5. erzeugt den KEK unter `ops/secrets/app.kek`,
6. erzeugt interne MariaDB-TLS-Zertifikate,
7. baut und startet den Docker-Stack,
8. wartet auf den App-Healthcheck,
9. fuehrt die Datenbankmigrationen aus,
10. gibt die URL fuer die Einrichtung aus.

Der Stack besteht aus:

- `mariadb`: MariaDB 12.3
- `app`: Node.js 24 / Fastify / TypeScript
- `caddy`: Reverse Proxy fuer HTTP/HTTPS
- Docker-Volumes fuer Datenbank, Anhaenge und Caddy-Daten

## Nach Der Installation

Beim ersten Oeffnen erscheint `/setup`. Dort werden eingerichtet:

- Unternehmensname
- Portalname
- erstes Superadmin-Konto

Danach erfolgt die Anmeldung ueber `/login`. `/app` leitet angemeldete Benutzer automatisch weiter:

- normale Benutzer nach `/dashboard.html`
- Admins/Superadmins nach `/admin.html`

Es werden bei einer Serverinstallation **keine Demo-Zugaenge** wie `admin / 123` erzeugt. Diese
Demo-Accounts gibt es nur noch als Fallback im direkten Dateimodus, wenn die HTML-Dateien ohne
Server geoeffnet werden.

## Docker-Betrieb

Wichtige Dateien:

```text
install.sh                         Ein-Befehl-Installation
ops/docker/docker-compose.yml       Docker-Stack
ops/docker/Dockerfile.server        Server- und Frontend-Image
ops/docker/Caddyfile                Reverse Proxy
ops/docker/.env                     generierte Docker-Konfiguration, nicht committen
ops/secrets/app.kek                 generierter Schluessel, nicht committen
ops/tls/mariadb/                    interne MariaDB-TLS-Zertifikate, nicht committen
```

Status anzeigen:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
```

Logs anzeigen:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f
```

Nur App-Logs:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
```

Starten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d
```

Stoppen:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env stop
```

Neustarten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env restart
```

Container entfernen, Daten behalten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env down
```

## Updates

Im Installationsordner:

```bash
cd /opt/ticket-system
git pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --build
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Migrationen liegen unter:

```text
apps/server/src/db/migrations/
```

Bestehende Migrationen nicht nachtraeglich aendern. Fuer Schemaaenderungen immer eine neue
Migration anlegen.

## Backups

Fuer den Betrieb muessen mindestens gesichert werden:

- Docker-Volume `ticket-system_mariadb-data`
- Docker-Volume `ticket-system_attachments-data`
- `ops/docker/.env`
- `ops/secrets/app.kek`
- `ops/tls/mariadb/`

Wichtig: Ohne `ops/secrets/app.kek` koennen verschluesselte Daten nicht wieder entschluesselt
werden.

## Lokale Entwicklung

Fuer normalen Betrieb Docker verwenden. Die lokale Entwicklung ist fuer Entwickler gedacht.

Voraussetzungen:

- Node.js 24 oder neuer
- npm
- MariaDB
- OpenSSL

Abhaengigkeiten installieren:

```bash
npm install
```

Lokale Env-Datei erstellen:

```bash
cp apps/server/.env.example apps/server/.env
```

Danach `apps/server/.env` ausfuellen. Lokale Schluessel koennen so erzeugt werden:

```bash
openssl rand -base64 32 > apps/server/kek.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomUUID())"
```

Migrationen ausfuehren:

```bash
npm run migrate --workspace=apps/server
```

Entwicklungsserver starten:

```bash
npm run dev --workspace=apps/server
```

Standard-URL:

```text
http://127.0.0.1:3000
```

## Projektstruktur

```text
.
  index.html                         Login/Kontoanfrage der Oberflaeche
  dashboard.html                     Benutzerbereich
  admin.html                         Adminbereich
  script.js                          UI, Store, AdminBoard, UserDash
  style.css                          Styling
  install.sh                         Ein-Befehl-Dockerinstallation
  apps/server/                       Fastify/MariaDB-Server
  ops/docker/                        Docker Compose, Dockerfile, Caddy
  picture/favicon.png                Favicon
```

Serverstruktur:

```text
apps/server/
  src/
    config/env.ts
    crypto/
    db/
      connection.ts
      migrate.ts
      migrations/
      types.ts
    http/
      app.ts
      assets/
      routes/
    index.ts
  test/
  package.json
  .env.example
```

## Daten Und Funktionen

Im Serverbetrieb werden ueber die Server-API gespeichert:

- Tickets
- Benutzer
- Benutzergruppen
- Portal- und Systemeinstellungen
- Systemprotokolle
- Benachrichtigungen
- Kontoanfragen
- Listenansichten
- Anhaenge

Login/Logout laufen ueber serverseitige Session-Cookies. Das erste Konto wird ueber `/setup` in
der normalisierten Server-Benutzertabelle angelegt. Spaeter ueber die UI angelegte Benutzer werden
im Kompatibilitaetsspeicher abgelegt und koennen sich ebenfalls anmelden.

Der direkte Dateimodus (`index.html` ohne Server) bleibt nur als Entwicklungs-/Fallbackmodus
erhalten. Dort koennen weiterhin lokale Browserdaten entstehen; produktiv ist ausschliesslich der
Serverbetrieb vorgesehen.

## Sicherheit

Nicht committen:

- `ops/docker/.env`
- `ops/secrets/`
- `ops/tls/`
- `apps/server/.env`
- `apps/server/kek.local`
- `*.kek`

Umgesetzt:

- Argon2id fuer das Setup-/Serverkonto
- serverseitige Feldverschluesselung fuer normalisierte Benutzerdaten
- KEK/DEK-Schluesselverwaltung
- MariaDB-TLS im Docker-Stack
- signierte HTTP-only Session-Cookies
- servergeschuetzte Kompatibilitaets-API
- Rate-Limiting
- Helmet Security Header
- Caddy Reverse Proxy
- non-root App-Container
- validierte Umgebungsvariablen ohne Secret-Defaults

Hinweis: Die bestehende Oberflaeche wird schrittweise weiter von der Kompatibilitaets-JSON-Schicht
in normalisierte Tabellen ueberfuehrt. Fuer den aktuellen Serverbetrieb liegen viele UI-Daten
bereits zentral in MariaDB, aber noch nicht alle fachlichen Objekte sind vollstaendig normalisiert.

## Tests Und CI

Lokal pruefen:

```bash
npm run typecheck
npm run test
npm run build
node --check script.js
```

Der Server-Testlauf nutzt Vitest mit Thread-Pool:

```bash
npm run test --workspace=apps/server
```

CI liegt unter:

```text
.github/workflows/ci.yml
```

## Fehlerbehebung

### `npm: command not found`

Node.js/npm ist nicht installiert oder nicht im `PATH`.

Fuer normale Installation bitte den Schnellstart verwenden; dort werden die Serverpakete ueber
Docker bereitgestellt. Fuer lokale Entwicklung Node.js 24 installieren.

### Docker-App wird nicht healthy

Logs pruefen:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs mariadb
```

Haeufige Ursachen:

- Datenbank ist noch nicht bereit.
- `ops/docker/.env` fehlt oder enthaelt falsche Werte.
- `ops/secrets/app.kek` fehlt.
- TLS-Dateien unter `ops/tls/mariadb/` fehlen.

### Ports 80 oder 443 sind belegt

In `ops/docker/.env` aendern:

```env
HTTP_PORT=8080
HTTPS_PORT=8443
```

Danach:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d
```

## Lizenz

[MIT](LICENSE) (c) 2026 U:Bodigat
