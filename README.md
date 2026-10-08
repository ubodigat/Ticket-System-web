# Support Portal - Ticketsystem

Ein Helpdesk- und Ticketsystem im Umbau: Der bisherige Browser-Prototyp wird schrittweise zu
einer selbst gehosteten Server-Anwendung mit MariaDB, serverseitiger Verschluesselung und echter
Rechtepruefung weiterentwickelt.

> **Aktueller Stand:** Phase 1. Das Repository enthaelt aktuell zwei getrennte Teile:
>
> 1. **Alter Frontend-Prototyp**: `index.html`, `dashboard.html`, `admin.html`, `script.js`,
>    `style.css`. Laeuft komplett im Browser und nutzt `localStorage`/IndexedDB.
> 2. **Neuer Server**: `apps/server/`. Fastify + TypeScript + MariaDB. Aktuell sind Installation,
>    Datenbankanbindung, Migrationen und der einmalige Einrichtungsassistent vorhanden.
>
> Beide Teile sind noch nicht verbunden. Das alte Frontend spricht noch nicht mit dem neuen Server.

---

## Inhalt

- [Schnellstart mit Docker](#schnellstart-mit-docker)
- [Docker-Betrieb](#docker-betrieb)
- [Lokale Entwicklung ohne Docker](#lokale-entwicklung-ohne-docker)
- [Fehlerbehebung](#fehlerbehebung)
- [Projektuebersicht](#projektuebersicht)
- [Neuer Server](#neuer-server)
- [Alter Frontend-Prototyp](#alter-frontend-prototyp)
- [Sicherheit und wichtige Dateien](#sicherheit-und-wichtige-dateien)
- [Tests und CI](#tests-und-ci)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

---

## Schnellstart mit Docker

Docker ist der empfohlene Weg fuer Testserver und spaetere Serverinstallationen. Der Stack
enthaelt:

- `mariadb`: MariaDB 12.3 mit internem TLS
- `app`: Node.js 24 / Fastify / TypeScript Server
- `caddy`: Reverse Proxy fuer HTTP/HTTPS
- Docker-Volumes fuer Datenbank, Anhaenge und Caddy-Daten

### Voraussetzungen

Auf dem Zielserver muessen installiert sein:

- Linux-Server mit Shell-Zugriff
- `git`
- `docker`
- `docker compose` als Docker-Plugin
- `openssl`

Pruefen:

```bash
git --version
docker --version
docker compose version
openssl version
```

Wenn einer der Befehle fehlt, muss die jeweilige Software zuerst auf dem Server installiert
werden.

### Repository klonen

```bash
git clone <repository-url> ticket-system
cd ticket-system
```

Wichtig: Alle folgenden Befehle muessen im Projektordner ausgefuehrt werden, also dort, wo
`install.sh`, `package.json`, `apps/` und `ops/` liegen.

### Installation starten

```bash
chmod +x install.sh
./install.sh
```

Fuer lokale Tests ohne oeffentliche Domain:

```bash
./install.sh --dev
```

Das Installationsskript:

1. prueft `docker`, `docker compose` und `openssl`,
2. erzeugt `ops/docker/.env` mit Datenbankname, Datenbankbenutzer, Passwort, Cookie-Secret und
   Installations-ID,
3. erzeugt `ops/secrets/app.kek` als Schluesselverschluesselungsschluessel,
4. erzeugt interne TLS-Zertifikate fuer App zu MariaDB in `ops/tls/mariadb/`,
5. baut und startet den Docker-Stack,
6. wartet auf den App-Healthcheck,
7. fuehrt Datenbankmigrationen aus,
8. gibt die erreichbare URL aus.

Beim ersten Oeffnen der URL erscheint `/setup`. Dort werden Unternehmensname, Portalname und das
erste Superadmin-Konto angelegt.

---

## Docker-Betrieb

### Wichtige Dateien und Verzeichnisse

```text
install.sh                         Ein-Befehl-Installation
ops/docker/docker-compose.yml       Docker-Stack: mariadb, app, caddy
ops/docker/Dockerfile.server        Multi-stage Build fuer den Server
ops/docker/Caddyfile                Reverse Proxy und Security Header
ops/docker/.env                     Generierte Docker-Konfiguration, nicht committen
ops/secrets/app.kek                 Generierter KEK, nicht committen
ops/tls/mariadb/                    Generierte interne MariaDB-TLS-Zertifikate, nicht committen
```

### Domain und Ports einstellen

`install.sh` erzeugt standardmaessig:

```env
HTTP_PORT=80
HTTPS_PORT=443
PUBLIC_DOMAIN=localhost
```

Diese Werte stehen in:

```bash
ops/docker/.env
```

Fuer einen echten Server nach Bedarf anpassen:

```env
HTTP_PORT=80
HTTPS_PORT=443
PUBLIC_DOMAIN=support.example.com
ACME_EMAIL=admin@example.com
```

Danach den Stack neu starten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --build
```

Hinweis: Fuer oeffentliches HTTPS muss die Domain auf den Server zeigen und Port 80/443 muessen
von aussen erreichbar sein.

### Status anzeigen

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
```

### Logs anzeigen

Alle Logs:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f
```

Nur App:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
```

Nur MariaDB:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f mariadb
```

### Start, Stop und Neustart

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

Stoppen und Container entfernen, Daten aber behalten:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env down
```

### Updates einspielen

```bash
git pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --build
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Migrationen liegen in:

```text
apps/server/src/db/migrations/
```

Bestehende Migrationen sollten nicht nachtraeglich veraendert werden. Fuer Schemaaenderungen
immer eine neue Migration anlegen.

### Backup-Hinweis

Aktuell gibt es noch kein fertiges Backup-Skript. Fuer einen produktiven Betrieb muessen
mindestens diese Daten gesichert werden:

- Docker-Volume `ticket-system_mariadb-data`
- Docker-Volume `ticket-system_attachments-data`
- `ops/docker/.env`
- `ops/secrets/app.kek`
- `ops/tls/mariadb/`

Wichtig: Ohne `ops/secrets/app.kek` koennen verschluesselte Daten nicht wieder entschluesselt
werden. Diese Datei gehoert nicht in Git, muss aber sicher und getrennt vom normalen
Datenbank-Backup aufbewahrt werden.

Docker-Volumes anzeigen:

```bash
docker volume ls | grep ticket-system
```

---

## Lokale Entwicklung ohne Docker

Diese Variante ist nur fuer Entwickler gedacht. Fuer normalen Betrieb bitte Docker verwenden.

### Voraussetzungen

- Node.js **24 oder neuer**
- npm
- Eine erreichbare MariaDB-Instanz
- OpenSSL

Pruefen:

```bash
node --version
npm --version
openssl version
```

Wenn `npm: command not found` erscheint, ist Node.js/npm auf diesem System nicht installiert.
Dann zuerst Node.js 24 installieren.

### Abhaengigkeiten installieren

```bash
npm install
```

### Lokale `.env` erstellen

```bash
cp apps/server/.env.example apps/server/.env
```

Danach `apps/server/.env` bearbeiten. Wichtige Werte:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `KEK_FILE_PATH`
- `COOKIE_SECRET`
- `INSTALLATION_ID`

Lokale Schluessel erzeugen:

```bash
openssl rand -base64 32 > apps/server/kek.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomUUID())"
```

`KEK_FILE_PATH` kann z. B. auf `./kek.local` zeigen, wenn der Server aus `apps/server` gestartet
wird.

### Entwicklung starten

```bash
npm run dev --workspace=apps/server
```

Standard:

```text
http://127.0.0.1:3000
```

### Pruefen, testen, bauen

```bash
npm run typecheck --workspace=apps/server
npm run test --workspace=apps/server
npm run build --workspace=apps/server
```

Alternativ ueber die Root-Skripte:

```bash
npm run typecheck
npm run test
npm run build
```

---

## Fehlerbehebung

### `npm: command not found`

Node.js/npm ist nicht installiert oder nicht im `PATH`.

Pruefen:

```bash
node --version
npm --version
```

Loesung: Node.js 24 oder neuer installieren, Shell neu oeffnen und erneut pruefen.

### `cp: cannot stat 'apps/server/.env.example': No such file or directory`

Die Datei existiert im Repository. Wenn dieser Fehler erscheint, ist fast immer einer dieser
Punkte die Ursache:

- Du bist nicht im Projektordner.
- Das Repository wurde nicht vollstaendig kopiert.
- Du befindest dich in einem Container oder Serverpfad ohne Projektdateien.

Pruefen:

```bash
pwd
ls
ls apps/server
```

Im richtigen Ordner muessen u. a. diese Eintraege sichtbar sein:

```text
apps/
ops/
install.sh
package.json
README.md
```

### Docker: App wird nicht healthy

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

### Docker: Ports 80 oder 443 sind belegt

In `ops/docker/.env` andere Ports setzen:

```env
HTTP_PORT=8080
HTTPS_PORT=8443
```

Danach:

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d
```

### Server startet lokal, aber Datenbankverbindung schlaegt fehl

Pruefe in `apps/server/.env`:

- Stimmt `DB_HOST`?
- Laeuft MariaDB?
- Stimmen Datenbankname, Benutzer und Passwort?
- Ist `DB_SSL_CA_PATH` gesetzt, obwohl lokal keine TLS-CA vorhanden ist?

Fuer lokale Entwicklung ohne TLS kann je nach Setup gelten:

```env
DB_SSL_REJECT_UNAUTHORIZED=false
```

---

## Projektuebersicht

```text
.
  index.html                         Login und Kontoanfrage des alten Frontends
  dashboard.html                     Benutzerbereich des alten Frontends
  admin.html                         Adminbereich des alten Frontends
  script.js                          Browser-Prototyp: Logik, Store, UI, AdminBoard, UserDash
  style.css                          Styling fuer altes Frontend
  DESIGN.md                          UI-/Designregeln
  package.json                       npm Workspaces und Root-Skripte
  package-lock.json                  npm Lockfile
  tsconfig.base.json                 TypeScript-Basisconfig
  install.sh                         Docker-Installation
  apps/server/                       Neuer Server
  ops/docker/                        Docker Compose, Dockerfile, Caddy
  picture/favicon.png                Favicon
  .github/workflows/ci.yml           GitHub Actions CI
```

Hinweis: `CHANGELOG.md` ist im aktuellen Projektordner nicht vorhanden.

---

## Neuer Server

Der neue Server liegt in `apps/server/`.

Technik:

- Node.js 24+
- TypeScript strict
- Fastify
- MariaDB
- Kysely als typisierter Query-Builder
- Argon2id fuer Passwort-Hashes
- AES-256-GCM fuer serverseitige Feldverschluesselung
- Blind Index fuer E-Mail-Suche
- Vitest fuer Tests

Wichtige Serverstruktur:

```text
apps/server/
  src/
    config/env.ts              Validierung aller Umgebungsvariablen
    crypto/                    KEK/DEK und Feldverschluesselung
    db/
      connection.ts            Kysely + mysql2
      migrate.ts               Migration Runner
      migrations/              Versionierte Datenbankmigrationen
      types.ts                 Typisiertes Datenbankschema
    http/
      app.ts                   Fastify, Helmet, Cookie, Rate-Limit
      assets/setupPage.ts      Einrichtungsseite
      routes/                  /health und /setup
    index.ts                   Einstiegspunkt
  test/                        Unit-Tests
  package.json
  .env.example                 Vorlage fuer lokale Entwicklung
```

Aktuell vorhanden:

- `/health`
- `/setup`
- `/api/v1/setup/status`
- `/api/v1/setup/complete`
- Datenbankmigrationen
- serverseitige Verschluesselung fuer erste Benutzerdaten

Noch nicht vorhanden:

- Login fuer normale Benutzer im neuen Server
- Ticket-API im neuen Server
- Chat, E-Mail, LDAP, Outlook-Integration im neuen Server
- Verbindung zwischen altem Frontend und neuem Backend

---

## Alter Frontend-Prototyp

Der alte Prototyp ist eine reine HTML/CSS/JavaScript-Demo ohne Backend.

Starten:

```bash
npx serve .
```

Oder mit Python:

```bash
python -m http.server 8080
```

Danach im Browser oeffnen:

```text
http://localhost:8080
```

Demo-Zugaenge:

| Benutzer | Passwort | Rolle |
|---|---|---|
| `admin` | `123` | Superadmin |
| `user` | `123` | Benutzer |

Wichtig: Dieser Prototyp ist nicht fuer den produktiven Einsatz gedacht.

Grenzen des Prototyps:

- Daten liegen lokal im Browser.
- Passwoerter und 2FA-Secrets sind fuer echte Produktion nicht sicher gespeichert.
- Rechtepruefung findet nur clientseitig statt.
- Jeder Browser hat seine eigene Datenbasis.
- E-Mail, LDAP und Outlook sind nur simuliert.

---

## Sicherheit und wichtige Dateien

Nicht committen:

- `ops/docker/.env`
- `ops/secrets/`
- `ops/tls/`
- `apps/server/.env`
- `apps/server/kek.local`
- `*.kek`

Warum das wichtig ist:

- `ops/docker/.env` enthaelt Datenbankpasswort, Cookie-Secret und Installations-ID.
- `ops/secrets/app.kek` ist fuer das Entschluesseln verschluesselter Daten erforderlich.
- `ops/tls/mariadb/` enthaelt interne Zertifikate und private Schluessel.

Der neue Server setzt bereits um:

- serverseitige Feldverschluesselung
- Argon2id fuer Passwoerter
- getrennte Schluesselverwaltung
- TLS fuer App zu MariaDB im Docker-Stack
- Rate-Limiting
- Security Header ueber Helmet und Caddy
- Content Security Policy ohne `unsafe-inline` und ohne `unsafe-eval`
- non-root App-Container
- validierte Umgebungsvariablen ohne unsichere Secret-Defaults

---

## Tests und CI

GitHub Actions liegt in:

```text
.github/workflows/ci.yml
```

Die CI fuehrt aus:

```bash
npm ci
npm run typecheck --workspace=apps/server
npm run test --workspace=apps/server
npm run build --workspace=apps/server
npm audit --audit-level=high
```

Lokal vor einem Commit:

```bash
npm run typecheck
npm run test
npm run build
```

---

## Mitwirken

Regeln:

- Datenbankaenderungen nur ueber neue Migrationen in `apps/server/src/db/migrations/`.
- Bestehende Migrationen nicht nachtraeglich veraendern.
- UI-Aenderungen am alten Frontend direkt in `index.html`, `dashboard.html`, `admin.html`,
  `script.js` und `style.css`.
- Dynamisch erzeugte Icons im alten Frontend nach dem Rendern mit `lucide.createIcons()`
  aktualisieren.
- Commit-Nachrichten im Format: `TT.MM.JJJJ | Kurzbeschreibung`.

---

## Lizenz

[MIT](LICENSE) (c) 2026 U:Bodigat
