# Support Portal – Ticketsystem

Ein Helpdesk- und Ticketsystem, das gerade von einem reinen Browser-Prototyp (alles im
`localStorage`, kein Backend) zu einer selbst-gehosteten Server-Anwendung mit MariaDB,
serverseitiger Verschlüsselung und echter Rechteprüfung umgebaut wird.

> **Status:** Aktiver Umbau, **Phase 1 von mehreren** (Grundgerüst). Es gibt zwei getrennte
> Dinge in diesem Repository:
> 1. **Den alten Frontend-Prototyp** (`index.html`, `dashboard.html`, `admin.html`,
>    `script.js`, `style.css`) – läuft weiterhin eigenständig im Browser, siehe
>    [Alter Frontend-Prototyp](#alter-frontend-prototyp-eigenständige-demo).
> 2. **Den neuen Server** (`apps/server/`) – noch ohne Login, Tickets oder Chat. Aktuell
>    funktionieren nur die Installation, die Datenbankanbindung und der einmalige
>    Einrichtungsassistent. Siehe [Neuer Server](#neuer-server-apps-server).
>
> Die beiden Teile sind **noch nicht verbunden**. Das alte Frontend spricht nicht mit dem
> neuen Server; der neue Server liefert noch keine eigene Benutzeroberfläche außer dem
> Einrichtungsassistenten.

---

## Inhalt

- [Neuer Server (`apps/server`)](#neuer-server-apps-server)
  - [Installation mit einem Befehl](#installation-mit-einem-befehl)
  - [Was die Installation einrichtet](#was-die-installation-einrichtet)
  - [Einrichtungsassistent](#einrichtungsassistent)
  - [Sicherheitsmaßnahmen (aktueller Stand)](#sicherheitsmaßnahmen-aktueller-stand)
  - [Projektstruktur des Servers](#projektstruktur-des-servers)
  - [Entwicklung ohne Docker](#entwicklung-ohne-docker)
  - [Was noch fehlt](#was-noch-fehlt-ehrlich-gesagt)
- [Alter Frontend-Prototyp (eigenständige Demo)](#alter-frontend-prototyp-eigenständige-demo)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

---

## Neuer Server (`apps/server`)

Node.js 24 + TypeScript (strict) + Fastify + MariaDB 12.3, angebunden über den typisierten
Query-Builder Kysely (kein roher SQL-String). Ziel: eine einzige Vertrauenszone (der Server),
die alle Geschäftslogik, Authentifizierung und Verschlüsselung übernimmt – der Browser wird
nicht mehr vertraut.

### Installation mit einem Befehl

Voraussetzungen auf dem Zielserver: `docker`, `docker compose` (Plugin), `openssl`.

```bash
./install.sh
```

Für eine lokale Entwicklungsumgebung ohne öffentliches TLS-Zertifikat:

```bash
./install.sh --dev
```

Am Ende gibt das Skript die erreichbare Adresse aus (z. B. `http://localhost` im `--dev`-Modus).
Ein erneuter Aufruf ist unschädlich: vorhandene Secrets, Schlüssel und Zertifikate werden
wiederverwendet, nicht überschrieben.

### Was die Installation einrichtet

1. **Secrets**: Datenbank-Passwort, Cookie-Signierschlüssel, unveränderliche Installations-ID
   (`ops/docker/.env`, nicht versioniert).
2. **KEK** (Schlüsselverschlüsselungsschlüssel, `ops/secrets/app.kek`): 256-Bit-Schlüssel, mit
   dem die eigentlichen Datenschlüssel (DEKs) in der Datenbank verschlüsselt abgelegt werden –
   liegt ausschließlich im App-Container, nie in der Datenbank, nie im Backup.
3. **TLS-Zertifikatskette** (`ops/tls/mariadb/`) für die verschlüsselte Verbindung zwischen App
   und MariaDB (selbstsigniert, intern).
4. **Docker-Stack**: `mariadb` (12.3), `app` (der Fastify-Server, läuft als nicht-root-Benutzer),
   `caddy` (Reverse Proxy, TLS-Terminierung nach außen).
5. **Datenbankmigrationen** (siehe `apps/server/src/db/migrations/`).
6. **Healthcheck-Wartezeit**, danach Erfolgsmeldung mit der URL.

### Einrichtungsassistent

Beim ersten Öffnen der ausgegebenen Adresse erscheint automatisch `/setup` – einmalig, danach
gesperrt (ein zweiter Versuch bekommt `409 Conflict`). Abgefragt werden:

- Unternehmensname und Portalname
- Erstes Administrator-Konto: Benutzername, vollständiger Name, E-Mail, Passwort
  (mindestens 14 Zeichen, da dieses erste Konto automatisch **Superadmin** wird)

Name und E-Mail-Adresse werden dabei bereits serverseitig AES-256-GCM-verschlüsselt
gespeichert (nicht im Klartext), das Passwort mit Argon2id gehasht. Nach erfolgreichem
Abschluss ist das Konto angelegt – ein Login-Bildschirm dafür existiert aktuell noch nicht
(siehe [Was noch fehlt](#was-noch-fehlt-ehrlich-gesagt)).

### Sicherheitsmaßnahmen (aktueller Stand)

Was heute schon **wirklich** umgesetzt ist (nicht nur geplant):

- **Serverseitige Verschlüsselung ruhender Daten**: Name/E-Mail-Adresse der Benutzer sind
  AES-256-GCM-verschlüsselt, mit einem kanonischen Zusatzdatenfeld (AAD) aus Installations-ID,
  Schema-Version, Tabelle, Datensatz-ID, Feldname und Schlüsselversion – verhindert, dass ein
  verschlüsselter Wert unbemerkt in ein anderes Feld/einen anderen Datensatz kopiert werden kann.
  (**Wichtig:** Das ist serverseitige Verschlüsselung, keine Ende-zu-Ende-Verschlüsselung – der
  Server kann und muss die Daten zur Verarbeitung entschlüsseln können, z. B. für Suche oder
  Admin-Ansicht.)
- **Getrennter Blind-Index-Schlüssel** für die Suche nach E-Mail-Adressen, ohne das Feld selbst
  entschlüsseln zu müssen.
- **Schlüsselverwaltung**: KEK nur im App-Container, Datenschlüssel (DEKs) KEK-umwickelt in der
  Datenbank, nie im Klartext gespeichert.
- **Argon2id** für Passwörter, keine Standardpasswörter (die Installation erzwingt die Eingabe
  eines eigenen Admin-Passworts im Einrichtungsassistenten).
- **TLS zur Datenbank** (selbstsignierte interne Zertifikatskette, von `install.sh` erzeugt).
- **Strikte Content-Security-Policy** ohne `unsafe-inline`/`unsafe-eval`; keine CDN-Abhängigkeiten
  – alle Skripte/Styles werden vom Server selbst ausgeliefert.
- **Rate-Limiting** (global + verschärft auf dem Einrichtungs-Endpunkt gegen Brute-Force).
- **Keine rohen SQL-Strings**: Datenbankzugriff ausschließlich über den typisierten Query-Builder
  Kysely.
- **Non-root-Container**: Der App-Container läuft unter einem dedizierten, unprivilegierten
  Benutzer.
- **Umgebungsvalidierung**: Fehlt ein Secret oder eine Konfiguration, startet der Server gar
  nicht erst – kein unsicherer Fallback.

### Projektstruktur des Servers

```
apps/server/
├── src/
│   ├── config/env.ts          Validierung aller Umgebungsvariablen (zod), keine Defaults für Secrets
│   ├── crypto/
│   │   ├── keyProvider.ts     KEK-Verwaltung (Datei-Backend), AES-256-GCM-Wrap/Unwrap der DEKs
│   │   ├── dekService.ts      Legt Datenschlüssel je Verwendungszweck an bzw. liest sie
│   │   └── fieldCrypto.ts     Feldverschlüsselung mit kanonischem AAD, Blind-Index-Berechnung
│   ├── db/
│   │   ├── connection.ts      Kysely + mysql2, TLS-fähig
│   │   ├── migrate.ts         Migrationsrunner
│   │   ├── migrations/        Versionierte Schemaänderungen
│   │   └── types.ts           Typisiertes Datenbankschema
│   ├── http/
│   │   ├── app.ts             Fastify-Aufbau (Helmet/CSP, Cookie, Rate-Limit)
│   │   ├── assets/setupPage.ts HTML/CSS/JS der Einrichtungsseite
│   │   └── routes/            health.ts (/health), setup.ts (/setup, /api/v1/setup/*)
│   └── index.ts                Einstiegspunkt
└── test/                        Vitest (Verschlüsselung, Umgebungsvalidierung)

ops/
├── docker/
│   ├── docker-compose.yml      MariaDB + App + Caddy
│   ├── Dockerfile.server       Build des App-Containers (non-root)
│   ├── Caddyfile                Reverse-Proxy-Konfiguration
│   ├── mariadb/conf.d/tls.cnf   Erzwingt TLS auf der MariaDB-Seite
│   └── README.md                Betriebsanleitung (Update, Logs, Diagnose)
├── secrets/                     Von install.sh erzeugt, NICHT versioniert
└── tls/                         Von install.sh erzeugt, NICHT versioniert

install.sh                       Ein-Befehl-Installation
```

### Entwicklung ohne Docker

```bash
npm install
cp apps/server/.env.example apps/server/.env   # falls vorhanden, sonst Variablen aus env.ts manuell setzen
npm run typecheck --workspace=apps/server
npm run test --workspace=apps/server
npm run build --workspace=apps/server
npm run dev --workspace=apps/server
```

Für den lokalen Start ohne Docker wird trotzdem eine erreichbare MariaDB-Instanz sowie eine
KEK-Datei benötigt (siehe `apps/server/src/config/env.ts` für alle Pflichtvariablen).

### Was noch fehlt (ehrlich gesagt)

Noch **nicht** implementiert, auch wenn Teile davon im alten Frontend-Prototyp schon einmal
(unsicher, clientseitig) existierten:

- Login/Session für normale Benutzer (nur die Einrichtung legt ein Konto an – es gibt noch
  keinen Login-Bildschirm im neuen Server)
- Tickets, Chat, Kanban-Board, Benutzerverwaltung, E-Mail-Versand, LDAP, 2FA/Passkeys
- Verbindung zwischen dem neuen Server und dem alten Frontend (`script.js` etc.)
- Automatisierte End-to-End-Tests gegen eine echte MariaDB (bisher nur Unit-Tests für
  Verschlüsselung/Konfiguration)

---

## Alter Frontend-Prototyp (eigenständige Demo)

Dieser Teil ist unverändert gegenüber dem ursprünglichen Prototyp: reines HTML/CSS/JavaScript,
läuft komplett im Browser, **ohne Verbindung zum neuen Server**. Nützlich, um die Zielfunktionen
und das Design anzuschauen, aber **nicht produktiv einsetzen** – siehe die Sicherheitshinweise
am Ende dieses Abschnitts.

### Funktionen

**Für Benutzer (`dashboard.html`):** Tickets mit Betreff, Beschreibung, Priorität (Niedrig/
Normal/Hoch) und Kategorien erstellen, Dateianhänge, eigene Ticketliste mit Status/Datum/
Priorität, Chat mit dem Support (Formatierung, Anhänge, bearbeitbare eigene Nachrichten),
Benachrichtigungen, persönliche Einstellungen (Theme, Akzentfarbe, Sprache, Hintergrund),
eigene 2FA-Einrichtung (TOTP).

**Für Admins (`admin.html`):** Kanban-Board (Neu/In Bearbeitung/Wartet/Geschlossen) mit Drag &
Drop, Großstörungen mit verknüpften Tickets, Volltextsuche, Fristen mit Geschäftszeiten-Logik,
Abwesenheit & Vertretung mit automatischer Ticketübergabe, Archiv mit Reaktivierung,
automatische Archivierung geschlossener Tickets, Kontoanfragen, Benutzer-/Gruppen-/
Kategorienverwaltung mit CSV-Import/-Export, System-Logs (Vorher/Nachher-Diff je Änderung),
Systemeinstellungen (SMTP, LDAP, Sicherheit, Geschäftszeiten, Benachrichtigungen).

**Startseite (`index.html`):** Anmeldung mit optionaler 2FA, Kontoanfrage-Formular.

### Schnellstart

```bash
# Node.js
npx serve .

# oder Python
python -m http.server 8080
```

Danach `http://localhost:8080` öffnen (ein fester Ursprung sorgt dafür, dass `localStorage`
zuverlässig erhalten bleibt). Direktes Öffnen von `index.html` per Doppelklick funktioniert
ebenfalls, ist aber weniger zuverlässig.

**Demo-Zugänge** (werden beim ersten Start automatisch angelegt):

| Benutzer | Passwort | Rolle |
|---|---|---|
| `admin` | `123` | Superadmin |
| `user` | `123` | Benutzer |

**Daten zurücksetzen:** Entwicklertools → *Application → Local Storage* → Einträge der Seite
löschen, neu laden.

**Abhängigkeiten (per CDN, benötigen Internetverbindung):** [Lucide](https://lucide.dev)
(Icons), [OTPAuth](https://github.com/hectorm/otpauth) (2FA), [Google Fonts – Poppins](https://fonts.google.com/specimen/Poppins),
[api.qrserver.com](https://goqr.me/api/) (QR-Code für 2FA).

### Rollen und Rechte

| Rolle | Rechte |
|---|---|
| **Benutzer** (`user`) | Eigene Tickets erstellen, einsehen, dazu chatten |
| **Admin** (`admin`) | Kanban-Board und Archiv der zugeordneten Kategorien; einzeln vergebbare Zusatzrechte (Kontoanfragen, Benutzerverwaltung, System-Logs, 2FA-Reset) |
| **Superadmin** (`superadmin`) | Alle Rechte, inklusive Systemeinstellungen und Admin-Verwaltung |

Seitenschutz läuft über `data-guard` am `<body>` (`Auth.checkGuard`) – **nur im Browser**, siehe
Sicherheitshinweise.

### Projektstruktur

```
index.html       Startseite: Anmeldung und Kontoanfrage
dashboard.html    Benutzerbereich
admin.html        Adminbereich
script.js         Gesamte Anwendungslogik (Utils, Lang, TOTP, Store, Auth, UI, Settings,
                   UserDash, AdminBoard, ScrollToTop)
style.css          Gesamtes Styling (dunkles und helles Theme)
picture/           Favicon
DESIGN.md          Designkonzept und UI-Richtlinien (weiterhin bindend für beide Teile)
```

Alle `Store`-Methoden sind bereits `async` – bewusst so angelegt, damit eine spätere Anbindung
an eine echte API (also an `apps/server`) ohne Änderung der aufrufenden Stellen möglich ist.
Das ist der vorgesehene Anknüpfungspunkt für die eigentliche Zusammenführung der beiden
Repository-Teile.

### Grenzen und Sicherheit (gilt nur für diesen alten Teil)

- **Keine echte Sicherheit:** Passwörter und 2FA-Secrets liegen im Klartext im `localStorage`;
  Anmeldung und Rechteprüfung laufen nur im Browser und lassen sich umgehen.
- **Keine gemeinsame Datenbasis:** Jeder Browser hat seine eigenen Daten.
- **Benachrichtigungen sind lokal**, keine geräteübergreifende Zustellung, keine echte
  E-Mail-Auslieferung.
- **Standardpasswort** `admin`/`123` wird immer neu angelegt.
- **Speicherlimit:** `localStorage` ca. 5 MB, Anhänge zusätzlich in IndexedDB.
- **E-Mail/LDAP/Outlook** werden nur simuliert (Konsolenausgabe).
- **Externer Dienst:** Der 2FA-QR-Code wird über `api.qrserver.com` erzeugt – das 2FA-Secret
  wird dabei an diesen Dienst übertragen.

Genau diese Punkte sind der Grund für den Umbau in `apps/server` – siehe oben.

---

## Mitwirken

- **Neuer Server:** `npm run typecheck`/`test`/`build` im Workspace `apps/server` müssen grün
  sein. Datenbankänderungen nur über neue, versionierte Dateien in
  `apps/server/src/db/migrations/`, nie durch Ändern bestehender Migrationen.
- **Altes Frontend:** Änderungen direkt in `index.html`, `dashboard.html`, `admin.html`,
  `script.js`, `style.css` – kein Build-Schritt nötig. UI-Änderungen folgen `DESIGN.md`.
  Dynamisch erzeugtes Markup mit Icons braucht danach `lucide.createIcons()`.
- **Commit-Nachrichten:** `TT.MM.JJJJ | Kurzbeschreibung`.

---

## Lizenz

[MIT](LICENSE) © 2026 U:Bodigat
