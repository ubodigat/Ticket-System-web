# Support Portal - Ticketsystem

Ein selbst gehostetes Helpdesk- und Ticketsystem mit Docker-Installation, MariaDB,
serverseitigem Login und angebundener Weboberflaeche.

Der fruehere Browser-Prototyp (`index.html`, `dashboard.html`, `admin.html`, `script.js` +
`js/*.js`, `style.css`) wird weiterhin als Oberflaeche genutzt, ist aber im Serverbetrieb an den
neuen Fastify/MariaDB-Server angebunden. Tickets, Benutzer, Gruppen, Einstellungen, Logs,
Benachrichtigungen, Kontoanfragen, Listenansichten und Anhaenge werden serverseitig gespeichert.

`script.js` ist nur noch ein schlanker Einstiegspunkt (Bootstrap/`DOMContentLoaded`); die
eigentliche Oberflächen-Logik ist in native ES-Module unter `js/` aufgeteilt (`<script
type="module">`, kein Bundler, kein Build-Schritt) -- siehe [Projektstruktur](#projektstruktur).

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
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env build --no-cache app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --force-recreate
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Migrationen liegen unter:

```text
apps/server/src/db/migrations/
```

Bestehende Migrationen nicht nachtraeglich aendern. Fuer Schemaaenderungen immer eine neue
Migration anlegen.

## Backups

```bash
./ops/docker/backup.sh
```

Sichert MariaDB (alle Geschäftsdaten inkl. Anhänge, dort bereits AES-256-GCM-verschlüsselt),
den Schlüssel `ops/secrets/app.kek` (ohne ihn ist der Dump nicht entschlüsselbar) und die
TLS-Zertifikate in einem einzelnen, selbst noch einmal passphrase-verschlüsselten Archiv unter
`ops/backups/`. Wiederherstellung über `./ops/docker/restore.sh <archiv>`. Details und
3-2-1-Empfehlung: [ops/docker/README.md](ops/docker/README.md#backuprestore).

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
  index.html                         Alte Login-Seite, wird vom Server NICHT mehr ausgeliefert
  dashboard.html                     Benutzerbereich (Design-Basis), vom Server ausgeliefert
  admin.html                         Adminbereich (Design-Basis), vom Server ausgeliefert
  script.js                          Schlanker Einstiegspunkt (Bootstrap/DOMContentLoaded),
                                      importiert die Module aus js/
  js/                                Native ES-Module (type="module", kein Bundler):
    utils.js                           DOM-Helfer (q/qa/Icon), reine Formatierungs-/Util-Funktionen
    lang.js                            Übersetzungen (de/en), Lang.t/.status/.prio
    store.js                           Zugriff auf die v2-API (Benutzer, Tickets, Einstellungen,
                                        Benachrichtigungen, Anhänge, SLA-Berechnung im Client, ...)
    log-diff.js                        Erzeugt lesbare Änderungs-Zusammenfassungen fürs Protokoll
    auth.js                            Login/Logout/Session-Guard, 2FA-Einrichtung
    ui.js                              Wiederverwendbare UI-Bausteine (Modals, Datepicker,
                                        Mehrfachauswahl, Farbwähler, Kontextmenü-Rendering)
    settings.js                        Portaleinstellungen-Modal (Theme, Sprache, Abwesenheit, ...)
    user-dash.js                       Benutzer-Dashboard (Ticket erstellen/ansehen, Chat)
    ticket-helpers.js                  Status-/Prioritäts-Helfer, Markdown-Toolbar, Tabellen-Editor
    admin-board.js                     Admin-Kanban/Liste/Archiv, Benutzerverwaltung,
                                        Systemeinstellungen (größtes Modul, bewusst nicht weiter
                                        aufgeteilt -- siehe Hinweis unten)
    context-menu.js                    Rechtsklick-Kontextmenü für Tickets
  style.css                          Styling
  vendor/                            Selbst gehostete Bibliotheken (lucide, DOMPurify, mammoth,
                                      xlsx, jszip) statt CDN -- siehe staticAssets.ts
  install.sh                         Ein-Befehl-Dockerinstallation
  apps/server/                       Fastify/MariaDB-Server
  ops/docker/                        Docker Compose, Dockerfile, Caddy
  picture/favicon.png                Favicon
```

**Hinweis zur Modulaufteilung:** `admin-board.js` bleibt mit Abstand die größte Datei. Die
ursprünglichen Objekte (`Store`, `Lang`, `UI`, `AdminBoard`, ...) waren historisch alle in der
einen 10.600-Zeilen-Datei `script.js` zusammengefasst; sie sind jetzt als separate Module
extrahiert, aber intern weiterhin stark miteinander verzahnt (zyklische Imports, z. B.
`store.js` ↔ `ui.js` ↔ `admin-board.js`). Das ist in nativem ESM unproblematisch, weil keines der
Module eine importierte Funktion sofort beim Laden aufruft -- jeder Aufruf passiert verzögert
innerhalb einer Methode, die erst später (z. B. per Klick) ausgeführt wird.

Serverstruktur:

```text
apps/server/
  src/
    config/env.ts
    crypto/                           KeyProvider, Feldverschlüsselung, Blind-Index
    db/
      connection.ts
      migrate.ts
      migrations/                     0001-0011, siehe docs-Kommentare in jeder Datei
      types.ts
    http/
      app.ts                          CSP, Helmet, Rate-Limit, Routen-Registrierung
      assets/                         Setup-/Login-Seiten (HTML/CSS/JS als Konstanten)
      routes/
        setup.ts, auth.ts, mfa.ts      Einrichtung, Login/Logout/Session, 2FA
        tickets.ts                     Tickets, Chat, Notizen, Zeiterfassung, Großstörungen,
                                        Genehmigungen
        users.ts                       Benutzer, Gruppen, Abwesenheit, CSV-Import/-Export
        settings.ts                    Systemeinstellungen, Kategorien
        knowledge.ts                   Wissensdatenbank, Textbausteine
        recurring.ts                   Wiederkehrende Ticket-Regeln (Verwaltung)
        extras.ts                      Benachrichtigungen, Kontoanfragen, Anhänge, Audit-Log
        session.ts, routeError.ts      Rechteprüfung, einheitliche Fehlerantworten
        staticAssets.ts                Liefert dashboard.html/admin.html/script.js/style.css/vendor
    jobs/maintenance.ts                Auto-Archivierung + Ausführung fälliger wiederkehrender
                                        Tickets (einfacher In-Prozess-Timer, siehe Hinweis unten)
    index.ts
  test/
  package.json
  .env.example
```

## Daten Und Funktionen

Alles läuft über eine echte, rechtegeprüfte REST-API unter `/api/v2/*` (plus `/api/v1/auth/*`
und `/api/v1/setup/*`) gegen MariaDB -- es gibt **keine** JSON-Blob-Kompatibilitätsschicht mehr.

| Bereich | Status |
|---|---|
| Benutzer, Abwesenheit/Vertretung | Vollständige API; `script.js` umgestellt |
| Gruppen (eine Gruppe pro Person, `department_group_id`) | Vollständige API inkl. Umbenennen; `script.js` umgestellt. Kein Mehrfach-Gruppen-Feature wie im alten UI-Entwurf |
| Login/Logout/Session, 2FA (TOTP) | Vollständige API inkl. serverseitigem QR-Code; `script.js` umgestellt |
| Tickets: Board/Liste, Erstellen, Status ändern, Archivieren/Reaktivieren | Vollständige API; `script.js` umgestellt. Archiv nutzt den eigenen `/api/v2/tickets/archived`-Endpunkt (die normale Liste schließt Archiviertes serverseitig aus) |
| Ticket-Detailansicht: Chat, interne Notizen, Teilaufgaben, Zeiterfassung, eigene Felder je Kategorie, Mehrfach-Beteiligte, Anhänge | Umgestellt -- lädt/speichert live über die v2-API (`ticket_participants`-Tabelle für Beteiligte). Dateianhänge an Chat-Nachrichten/internen Notizen selbst noch nicht angebunden (nur ticketweite Anhänge) |
| Ticket-Protokoll/Verlauf | Echtes, serverseitig geschriebenes `ticket_audit_log`; `script.js` umgestellt (vorher immer leer, da `ticket.logs` nie aus der API kam) |
| "Ticket im Auftrag von" | Vollständige API (`filed_by_user_id`/-`username`, getrennt vom eigentlichen Autor); `script.js` umgestellt. Vorher wurde das Ticket serverseitig fälschlich der anlegenden Admin-Person statt der Zielperson zugeordnet |
| Großstörungen (Markieren/Aufheben, Hinweistext, Verknüpfen) | Vollständige API; `script.js` umgestellt. Verknüpfen auch durch die betroffene Person selbst möglich, nicht nur durch Admins |
| Genehmigungen (anfordern/entscheiden), Vorgesetzte-Genehmigungsworkflow | Vollständige API; `script.js` umgestellt. Legt eine Person mit hinterlegter Vorgesetzter Person (Benutzerverwaltung) ein Ticket mit passender Priorität an, wird automatisch eine Genehmigung angefordert (Ersatzperson/Superadmin als Fallback, konfigurierbar in Systemeinstellungen). Nur Admin/Superadmin können als Prüfer eingetragen werden/entscheiden |
| "Warten auf Benutzer"-Fristen | Vollständige API (`waiting_since`/`waiting_message` auf dem Ticket); `script.js` umgestellt. Erinnerung/automatisches Schließen laufen serverseitig per Timer, Fristen in Systemeinstellungen konfigurierbar |
| Kategorien (Name, eigene Felder je Kategorie, Auto-Zuweisung an Gruppe) | Vollständige API; `script.js` umgestellt, inkl. automatischer Gruppen-Zuweisung neuer Tickets und Benachrichtigung der Gruppe/aller Admins. Die frühere "Admins dieser Kategorie"-Zuordnung aus dem alten UI-Entwurf hat keine Entsprechung im Schema und wurde nicht nachgebaut |
| Systemeinstellungen (Portalname, Firmenname, SLA-Stunden, Geschäftszeiten, Ticketnummernformat, Konto-Selbstverwaltung, Genehmigungsworkflow, Warten-auf-Benutzer-Fristen) | Vollständige API (`/api/v2/settings`); `script.js`-Modal umgestellt |
| Granulare Einzelrechte je Benutzer (z.B. "nur Kontoanfragen verwalten") | **Bewusst nicht nachgebaut** -- das neue, sicherere Rollenmodell kennt nur user/admin/superadmin mit serverseitig erzwungenen Rechten; Einzelrechte gab es im Altsystem nur als nie durchgesetztes UI-Flag |
| E-Mail-Versand (SMTP) | Echter Versand über `nodemailer`; Konfiguration (`/api/v2/settings/smtp`, nur Superadmin) inkl. verschlüsseltem Passwort und Test-E-Mail-Button in Systemeinstellungen. Jede In-App-Benachrichtigung löst bei hinterlegter E-Mail-Adresse zusätzlich eine echte Mail aus (best-effort -- ein SMTP-Fehler blockiert nie die In-App-Benachrichtigung) |
| LDAP-Login | Echter Bind-basierter Login über `ldapts` als **Ergänzung** zum lokalen Passwort (`apps/server/src/auth/ldap.ts`): die Person braucht weiterhin ein lokales Konto mit demselben Benutzernamen, Rolle/Rechte kommen immer aus der eigenen Datenbank, nie aus LDAP-Gruppen. Konfiguration + Verbindungstest (`/api/v2/settings/ldap`, nur Superadmin) in Systemeinstellungen |
| Outlook/Microsoft-Graph | **Noch nicht vorhanden** -- das alte UI hat dafür Eingabefelder, aber kein Backend; wurde aus den Admin-Modals entfernt statt ungespeichert vorzutäuschen. Erfordert eine App-Registrierung in Azure AD mit echten Zugangsdaten zum Testen, anders als SMTP/LDAP nicht ohne externe Infrastruktur sinnvoll umsetzbar |
| Globales Audit-Log, Benachrichtigungen | Vollständige API; `script.js` umgestellt. Log-Einträge werden ausschließlich serverseitig bei der jeweiligen Aktion erzeugt (users.ts/settings.ts/tickets.ts), nicht mehr vom Client übermittelt -- Admins können das Protokoll nicht mehr leeren |
| Wissensdatenbank, Textbausteine | Vollständige API; `script.js` umgestellt. Dateianhänge an Wissensartikeln gibt es im Schema nicht und wurden aus dem Editor entfernt |
| Wiederkehrende Tickets | Vollständige API; `script.js` umgestellt (Intervall in Tagen/Wochen/Monaten + konkreter Startzeitpunkt statt "Wochentag/Tag im Monat"). Ausführung läuft serverseitig per Timer (alle 5 Min.) |
| Auto-Archivierung geschlossener Tickets | Automatisch (Timer alle 5 Min., über Systemeinstellungen konfigurierbare Frist) |
| Kontoanfragen (öffentliches Formular, annehmen/ablehnen) | Vollständige, verschlüsselte API; `script.js` umgestellt |
| Anhänge | Vollständige, verschlüsselte API; `script.js` umgestellt. Vorher landeten Anhänge unbemerkt im Browser-IndexedDB statt in der Datenbank, weil der Client einen nie existierenden `/api/v1/attachments/*`-Endpunkt ansprach |
| Verwandte Tickets (verknüpfen/aufheben) | Vollständige API (`ticket_relations`-Tabelle); `script.js` umgestellt |
| Tickets zusammenführen | Vollständige API (`/api/v2/tickets/:id/merge`); `script.js` umgestellt. Verschiebt Chat/Notizen/Teilaufgaben/Zeiten/Anhänge/Beteiligte per Fremdschlüssel-Update auf das Zielticket (Inhalte bleiben unverändert) und archiviert das Ursprungsticket |
| Gespeicherte Listenansichten (Listenansicht-Filter) | Vollständige API (`/api/v2/list-views`); `script.js` umgestellt, inkl. Löschen |
| CSV-Import/-Export (Benutzer) | Vorhanden, mit Formel-Injektions-Neutralisierung. Exportiert nur noch echte, persistierte Felder |
| Benutzer löschen | Vollständiger `DELETE /api/v2/users/:id` (Tickets der Person wahlweise archivieren oder löschen); vorher nur im UI vorhanden, serverseitig nie umgesetzt |
| Oberfläche (`admin.html`/`dashboard.html`, dasselbe Layout wie vor der Datenbankanbindung) | `script.js` ist durchgehend auf die echte `/api/v2/*`-API umgestellt (siehe Zeilen oben) -- keine bekannten Bereiche mehr, die noch die entfernte Alt-Schnittstelle erwarten. Eine völlig neue, andere Oberfläche wurde nicht gebaut (war auch nicht das Ziel) |

Login/Logout laufen über serverseitige, signierte Session-Cookies. Das erste Konto wird über
`/setup` angelegt. `index.html` (alte Login-Seite) wird vom Server nicht mehr ausgeliefert --
nur noch beim direkten Öffnen der Datei ohne Server relevant (reiner Entwicklungs-/Demo-Modus,
nicht produktiv vorgesehen).

**Bekannte Vereinfachung:** Auto-Archivierung und wiederkehrende Tickets laufen über einen
einfachen `setInterval`-Timer im App-Prozess, nicht über eine echte Job-Queue mit Sperren
zwischen mehreren Instanzen. Bei genau einer laufenden App-Instanz (der Standardfall dieses
Stacks) ist das korrekt; bei horizontaler Skalierung müsste das durch eine DB-gestützte Queue
ersetzt werden.

## Sicherheit

Nicht committen:

- `ops/docker/.env`
- `ops/secrets/`
- `ops/tls/`
- `apps/server/.env`
- `apps/server/kek.local`
- `*.kek`

Umgesetzt:

- Argon2id-Passwort-Hashing, kein Klartext-Passwortvergleich irgendwo im Code
- Serverseitige AES-256-GCM-Feldverschlüsselung mit kanonischem AAD für: Benutzername/E-Mail,
  Ticket-Titel/-Beschreibung, Chat-Nachrichten, interne Notizen, Wissensdatenbank-Artikel,
  Textbausteine, Anhang-Dateinamen und -Inhalt, Konto-Anfragen, Benachrichtigungstexte,
  TOTP-Secrets
- **Chat-Verschlüsselungsmodell (bewusste Entscheidung):** Der Chat ist serverseitig
  verschlüsselt (siehe oben) und die Verbindung dorthin läuft über TLS -- es handelt sich NICHT
  um Ende-zu-Ende-Verschlüsselung. Grund: echte Ende-zu-Ende-Verschlüsselung würde bedeuten,
  dass der Server Chat-Inhalte nie entschlüsseln kann -- damit wären serverseitige Suche,
  Admin-Einsicht in Tickets, Moderation und E-Mail-Benachrichtigungen mit Inhaltsvorschau nicht
  mehr möglich, und genau der Server müsste dem Browser zur Schlüsselverwaltung vertrauen, was
  dem Grundsatz "nur der Server ist die sichere Zone" widerspricht. Die Daten sind also auf dem
  Transportweg (TLS) und im Ruhezustand (AES-256-GCM in der Datenbank) verschlüsselt, aber der
  Server selbst kann sie lesen -- wie bei praktisch jedem serverbasierten Ticketsystem
- Separater Blind-Index-Schlüssel für die E-Mail-Suche (kein Klartext-Hash)
- KEK/DEK-Schlüsselverwaltung über eine austauschbare `KeyProvider`-Abstraktion
- Echte Zwei-Faktor-Authentifizierung (TOTP) mit serverseitig erzeugtem QR-Code -- kein externer
  Dienst, kein clientseitig generiertes Secret
- Serverseitiger Brute-Force-Schutz: Konten werden nach 5 Fehlversuchen (Passwort oder TOTP-Code)
  15 Minuten gesperrt, unabhängig vom IP-Rate-Limit
- Rechteprüfung ausschließlich serverseitig (`requireSession`/`requireAdmin`/`requireSuperadmin`),
  IDOR-Schutz auf Ticket-/Anhang-/Genehmigungsebene
- MariaDB-TLS im Docker-Stack
- SMTP-Versand erzwingt Verschlüsselung: entweder direktes TLS/SMTPS (`secure: true`, i.d.R.
  Port 465) oder STARTTLS mit `requireTLS: true` (Port 587) -- schlägt STARTTLS fehl, bricht der
  Versand ab, statt unverschlüsselt auf Klartext zurückzufallen
- Signierte, `HttpOnly`/`SameSite=Lax`-Session-Cookies
- Content-Security-Policy ohne CDN-Hosts und ohne `unsafe-inline`/`unsafe-eval` fuer JavaScript.
  `script-src` ist auf `'self'` begrenzt. `style-src` erlaubt derzeit bewusst
  `'unsafe-inline'`, weil die vorhandene Oberflaeche aus der lokalen Version dynamische
  Style-Attribute/CSS-Variablen fuer Icons, Dropdowns, Popovers, Farbpunkte, Datepicker und
  Hintergrundbilder nutzt. Alle Bibliotheken (`lucide`, `DOMPurify`, `mammoth`, `xlsx`, `jszip`)
  liegen selbst gehostet unter `vendor/`
- Rate-Limiting (global + verschärft auf Login/Setup/Kontoanfragen)
- Einheitliche, nicht-auskunftsfreudige Fehlerantworten (`routeError.ts`) -- interne
  Fehlermeldungen (z.B. von MariaDB) werden nie an den Client weitergegeben, nur serverseitig
  geloggt
- Helmet-Security-Header, Caddy Reverse Proxy, non-root App-Container
- Validierte Umgebungsvariablen ohne Secret-Defaults

Noch nicht umgesetzt (siehe Tabelle oben): E-Mail-Versand, LDAP, eine echte Job-Queue mit
Mehrinstanzen-Sperre, vollständige Verschlüsselung von Konto-Anfrage-Freitextfeldern
(`company`/`reason` bleiben Klartext).

## Tests Und CI

Lokal pruefen:

```bash
npm run typecheck
npm run test
npm run build
node --check script.js js/*.js
```

Der Server-Testlauf nutzt Vitest mit Thread-Pool:

```bash
npm run test --workspace=apps/server
```

Abgedeckt sind unter anderem die Rechteprüfung (`session.test.ts`: `requireSession`/`requireAdmin`/
`requireSuperadmin`, Session-Ablauf nach 8 Stunden, manipulierte Rolle im Cookie), die
SLA-/Fristenberechnung (`sla.test.ts`: Geschäftszeiten, Wochenend-/Feierabend-Sprung,
deaktivierte Prioritäten) und die Status-Validierung (`status.test.ts`: nur bekannte
Ticket-Status werden akzeptiert, inkl. XSS-Payload als Negativtest).

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

### Admin-Oberflaeche hat keine Icons, `/js/*.js` liefert 404 oder CSP-Fehler

Wenn der Browser Fehler wie `js/utils.js 404`, `js/admin-board.js 404`, blockierte Inline-Skripte
oder blockierte Styles meldet, laeuft fast immer noch ein alter App-Container oder ein alter
Browsercache. Die aktuelle Version liefert die Dateien unter `/js/*` aus, kopiert sie ins
Docker-Image und erlaubt fuer die bestehende Oberflaeche die notwendigen dynamischen Styles.

Auf dem Server hart neu bauen und den Container ersetzen:

```bash
cd /opt/ticket-system
git pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env build --no-cache app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --force-recreate
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Danach pruefen:

```bash
curl -k -I https://<server-ip>/js/utils.js
curl -k -I https://<server-ip>/admin.html
```

Beide Befehle muessen `HTTP/2 200` oder `HTTP/1.1 200` liefern. Danach im Browser einmal hart
neu laden (`Strg+F5`) oder den Cache fuer die Seite leeren.

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

Die neu unter dieser Lizenz veröffentlichten Fassungen von Ticket-System-web
stehen unter der **Common Public Attribution License 1.0 (CPAL-1.0)**.
Die verbindlichen Attribution-Vorgaben befinden sich in Exhibit B von [LICENSE](LICENSE).

**Originalentwickler:** U:Bodigat  
**Originalprojekt:** https://github.com/ubodigat/Ticket-System-web  
**Copyright:** (c) 2026 U:Bodigat

Kostenlose und kommerzielle Nutzung, Änderungen und Weitergabe sind unter CPAL
zulässig. Beim Start bzw. bei Sitzungsbeginn muss die Attribution in einer
vorhandenen grafischen Benutzeroberfläche gemäß Abschnitt 14 und Exhibit B
angemessen prominent angezeigt werden. Die CPAL enthält Quellcodepflichten bei
Weitergabe und externer Netzwerkbereitstellung (Abschnitte 3 und 15).
Änderungen sind nach Abschnitt 3.3 zu dokumentieren.

Siehe [NOTICE.md](NOTICE.md), [CHANGES.md](CHANGES.md) und
[CONTRIBUTORS.md](CONTRIBUTORS.md). Pull Requests zum Original sind erwünscht,
aber nicht verpflichtend. Die bisherigen MIT-Veröffentlichungen behalten ihre
ursprünglichen Nutzungsrechte. Rechte Dritter bleiben unberührt.

