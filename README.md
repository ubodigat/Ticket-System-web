# Support Portal – Ticketsystem

Ein schlankes Helpdesk- und Ticketsystem, das komplett im Browser läuft – ohne Server, ohne Build-Schritt, ohne Installation. Benutzer erstellen Tickets und chatten mit dem Support; Admins bearbeiten sie auf einem Kanban-Board, verteilen Zuständigkeiten und verwalten Benutzer, Gruppen und Kategorien.

> **Status:** Prototyp / Demo. Alle Daten liegen im `localStorage` des jeweiligen Browsers. Für den produktiven Einsatz fehlen ein Backend, eine echte Authentifizierung und E-Mail-Versand – siehe [Grenzen und Sicherheit](#grenzen-und-sicherheit).

---

## Inhalt

- [Funktionen](#funktionen)
- [Schnellstart](#schnellstart)
- [Rollen und Rechte](#rollen-und-rechte)
- [Projektstruktur](#projektstruktur)
- [Architektur](#architektur)
- [Datenmodell](#datenmodell)
- [Anpassung](#anpassung)
- [Grenzen und Sicherheit](#grenzen-und-sicherheit)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

---

## Funktionen

### Für Benutzer (`dashboard.html`)
- Tickets mit Betreff, Beschreibung, Priorität und einer oder mehreren Kategorien erstellen
- Bereits beim Erstellen mehrere Dateianhänge hinzufügen
- Priorität auf **Niedrig**, **Normal** oder **Hoch** beschränkt; Ticketnummer und Status in der Liste sehen
- Eigene Tickets als Liste mit Status, Datum und Priorität; geschlossene und archivierte Tickets einblendbar
- Chat mit dem Support inklusive Formatierung, sicheren Links, bearbeitbaren eigenen Nachrichten und Dateianhängen
- Benachrichtigungen bei Statusänderungen und neuen Chatnachrichten; Vorschau für PDF, Bilder, Text/CSV/JSON, Audio/Video sowie DOCX-, XLSX- und PPTX-Inhalte
- Persönliche Einstellungen: helles/dunkles Theme, Akzentfarbe, Sprache (Deutsch/Englisch), Hintergrund (animiert, Verlauf oder eigenes Bild)
- Zwei-Faktor-Authentifizierung (TOTP, z. B. Google Authenticator) selbst einrichten

### Für Admins (`admin.html`)
- **Kanban-Board** mit den Spalten *Neu*, *In Bearbeitung* und *Geschlossen* – Tickets per Drag & Drop verschieben
- Suche nach Ticketnummer, Titel, Beschreibung, Benutzer und Ticketinhalt; eindeutige lesbare Ticketnummern
- Ticketnummernformat in den Unternehmenseinstellungen anpassbar, mit optionalen Vorlagen pro Kategorie und den Platzhaltern `{prefix}`, `{category}` und `{number}`
- **Ticket-Detail** mit
  - Titel, Beschreibung, Status, Priorität und Kategorien direkt bearbeiten
  - Warte-Status für Benutzer, externe Dienstleister und interne Rückmeldungen
  - Zuweisung an mehrere Bearbeiter, Hauptverantwortlicher und beteiligte Personen
  - Teilaufgaben mit erledigt/gesamt-Zähler; nachträgliche Bearbeitung, Zuweisung nur an Ticketverantwortliche/Beteiligte
  - Chat mit dem Ersteller; Admin-Nachrichten sind farblich markiert. Interne Streams (Admin-Absprachen und Lösungsweg) haben einen eigenen Reiter.
  - Admin-Erwähnungen mit In-App-Benachrichtigungen
  - Protokoll aller Änderungen und Ticket-Historie des Erstellers
- **Archiv** mit Volltextsuche (Titel, Autor, Inhalt) und Reaktivierung
- **Automatische Archivierung**: geschlossene Tickets nach 3 Tagen; höchstens 10 geschlossene Tickets bleiben auf dem Board
- **Kontoanfragen** von der Startseite annehmen oder ablehnen
- **Benutzerverwaltung**: Benutzer, Benutzergruppen und Kategorien anlegen und bearbeiten, 2FA zurücksetzen, CSV-Export und -Import
- **System-Logs**: globales Protokoll (Anmeldungen, Änderungen, Löschungen) mit Text- und Datum/Uhrzeitbereichssuche
- **Benachrichtigungen**: einzelne Einträge löschen, alle als gelesen markieren oder alle eigenen Einträge gesammelt löschen
- **Systemeinstellungen** (Superadmin): E-Mail/SMTP, Benachrichtigungen, Sicherheit (2FA-Pflicht), LDAP, Outlook, allgemeine Vorgaben wie Portalname, Standardpriorität und Standardkategorien

### Startseite (`index.html`)
- Anmeldung mit optionaler 2FA-Abfrage
- Formular für Kontoanfragen

---

## Schnellstart

Es wird nur ein aktueller Browser benötigt.

**Variante 1 – direkt öffnen**

`index.html` im Browser öffnen.

**Variante 2 – lokaler Webserver (empfohlen)**

Ein fester Ursprung (`http://localhost:…`) sorgt dafür, dass der `localStorage` und damit alle Daten zuverlässig erhalten bleiben.

```bash
# Node.js
npx serve .

# oder Python
python -m http.server 8080
```

Danach `http://localhost:8080` (bzw. die angezeigte Adresse) öffnen.

### Demo-Zugänge

Beim ersten Start werden automatisch angelegt:

| Benutzer | Passwort | Rolle |
|---|---|---|
| `admin` | `123` | Superadmin |
| `user` | `123` | Benutzer |

Außerdem die Gruppen *Admins*, *Verwaltung* und *Support*.

**Daten zurücksetzen:** In den Entwicklertools des Browsers unter *Application → Local Storage* die Einträge der Seite löschen und neu laden.

### Abhängigkeiten (per CDN)

| Bibliothek | Zweck |
|---|---|
| [Lucide](https://lucide.dev) | Icons |
| [OTPAuth](https://github.com/hectorm/otpauth) | TOTP für 2FA |
| [Google Fonts – Poppins](https://fonts.google.com/specimen/Poppins) | Schrift |
| [api.qrserver.com](https://goqr.me/api/) | QR-Code bei der 2FA-Einrichtung |

Für Icons, Schrift und 2FA ist daher eine Internetverbindung nötig.

---

## Rollen und Rechte

| Rolle | Rechte |
|---|---|
| **Benutzer** (`user`) | Eigene Tickets erstellen, einsehen und dazu chatten |
| **Admin** (`admin`) | Kanban-Board und Archiv; sieht Tickets der zugeordneten Kategorien sowie direkt zugewiesene Tickets. Zusätzliche Rechte einzeln vergebbar: *Kontoanfragen verwalten*, *Benutzerverwaltung (nur Benutzer)*, *System-Logs anzeigen*, *2FA von Benutzern zurücksetzen* |
| **Superadmin** (`superadmin`) | Alle Rechte, inklusive Systemeinstellungen, Admin-Verwaltung, CSV-Import und 2FA-Reset |

Der Zugriff auf die Seiten wird über `data-guard` am `<body>` geprüft (`Auth.checkGuard`).

---

## Projektstruktur

```
.
├── index.html       Startseite: Anmeldung und Kontoanfrage
├── dashboard.html   Benutzerbereich: Tickets erstellen und verfolgen
├── admin.html       Adminbereich: Kanban, Archiv, Ticket-Detail
├── script.js        Gesamte Anwendungslogik
├── style.css        Gesamtes Styling (dunkles und helles Theme)
├── picture/         Favicon
├── DESIGN.md        Designkonzept und UI-Richtlinien
└── LICENSE          MIT-Lizenz
```

---

## Architektur

Reines HTML, CSS und Vanilla JavaScript ohne Framework. `script.js` wird von allen drei Seiten geladen und ist in Module (Objekte) gegliedert:

| Modul | Aufgabe |
|---|---|
| `Utils` | IDs, Datumsformat, `localStorage`-Zugriff, Farbberechnung |
| `Lang` | Übersetzungen (de/en) und Anwendung auf das DOM über `data-i18n` |
| `TOTP` | Erzeugen und Prüfen von 2FA-Codes |
| `Store` | Datenzugriff (asynchrone API über `localStorage`), Seed-Daten, Migrationen, Logs, Auto-Archivierung |
| `Auth` | Anmeldung, Abmeldung, Seitenschutz, 2FA-Dialoge |
| `UI` | Toast, Bestätigungsdialog, Sternenfeld, Multi-Select, Ticket-Protokoll |
| `Settings` | Persönliche Einstellungen (Theme, Akzent, Sprache, Hintergrund) |
| `UserDash` | Logik von `dashboard.html` |
| `AdminBoard` | Logik von `admin.html`: Board, Modals, Benutzerverwaltung, Systemeinstellungen, CSV |
| `ScrollToTop` | Button „nach oben“ |

Alle `Store`-Methoden sind bereits `async`. Ein späterer Wechsel auf eine REST-API ist dadurch möglich, ohne die aufrufenden Stellen zu ändern.

---

## Datenmodell

Gespeichert wird im `localStorage` unter folgenden Schlüsseln:

| Schlüssel | Inhalt |
|---|---|
| `users` | Benutzer: `username`, `password`, `name`, `email`, `role`, `dept` (Kategorien), Rechte, 2FA-Status |
| `user_groups` | Gruppen mit `name`, `description`, `members` |
| `tickets` | Tickets (siehe unten) |
| `account_requests` | Offene Kontoanfragen |
| `app_settings` | Persönliche und Systemeinstellungen |
| `global_logs` | Systemweites Protokoll |
| `notifications` | Lokale In-App-Benachrichtigungen je Benutzer |
| `currentUser` | Benutzername der aktiven Sitzung |

Ein Ticket enthält unter anderem:

```js
{
  id, ticketNumber, title, desc, prio,
  status,                         // inklusive definierter Warte-Status
  category: [],                   // eine oder mehrere Kategorien
  author, authorName, createdAt,
  owner, participants: [],        // Hauptverantwortlicher und Beteiligte
  todos: [],                      // Teilaufgaben
  chat: [],                       // Nachrichten mit dem Ersteller (inkl. Anhänge als Base64)
  comments: [],                   // interne Einträge mit channel 'admin-chat' oder 'solution'
  logs: [],                       // Änderungsprotokoll
  archived, archivedAt
}
```

Ältere Datenstände werden beim Start in `Store.init()` automatisch migriert.

---

## Anpassung

- **Design:** Farben, Größen und Radien sind CSS-Variablen in `:root` in `style.css`. Regeln und Komponenten beschreibt [DESIGN.md](DESIGN.md) – bitte vor UI-Änderungen lesen.
- **Akzentfarbe und Theme:** pro Benutzer über das Zahnrad in der Topbar.
- **Kategorien, Standardpriorität, Portalname:** in der Benutzerverwaltung bzw. in den Systemeinstellungen.
- **Übersetzungen:** in `Lang.translations` in `script.js`; im HTML per `data-i18n="schlüssel"` einbinden.

---

## Grenzen und Sicherheit

Das Projekt ist als Frontend-Prototyp gebaut. Vor einem echten Einsatz sind folgende Punkte zu beachten:

- **Keine echte Sicherheit:** Passwörter und 2FA-Secrets liegen im Klartext im `localStorage`; Anmeldung und Rechteprüfung laufen nur im Browser und lassen sich umgehen.
- **Keine gemeinsame Datenbasis:** Jeder Browser hat seine eigenen Daten. Benutzer und Admins sehen sich nur, wenn sie denselben Browser auf demselben Gerät nutzen.
- **Benachrichtigungen sind lokal:** Sie werden im `localStorage` geführt und aktualisieren sich über Browser-Tabs. Es gibt keine geräteübergreifende Zustellung oder echte E-Mail-Auslieferung ohne Backend.
- **Standardpasswort:** `admin` / `123` wird beim Start immer angelegt.
- **Speicherlimit:** Anhänge werden im Browser gespeichert (mit IndexedDB-Auslagerung bei Bedarf); der `localStorage` bleibt meist auf etwa 5 MB begrenzt.
- **E-Mail, LDAP, Outlook:** Die Einstellungen werden gespeichert, aber nicht ausgeführt. E-Mails erscheinen nur in der Browser-Konsole.
- **Nur gespeichert, nicht ausgewertet:** Session-Timeout, maximale Login-Fehlversuche und die Tage für die Auto-Archivierung. Die Auto-Archivierung verwendet fest 3 Tage bzw. maximal 10 geschlossene Tickets.
- **Externer Dienst:** Der QR-Code für die 2FA wird über `api.qrserver.com` erzeugt; dabei wird das Secret an diesen Dienst übertragen.

Für einen produktiven Betrieb wäre ein Backend mit Datenbank, gehashten Passwörtern, serverseitiger Rechteprüfung und einem Mail-Dienst nötig. Die asynchrone `Store`-API ist der vorgesehene Anknüpfungspunkt.

---

## Mitwirken

1. Änderungen direkt in `index.html`, `dashboard.html`, `admin.html`, `script.js` und `style.css` vornehmen – ein Build-Schritt ist nicht nötig.
2. UI-Änderungen folgen [DESIGN.md](DESIGN.md); die Checkliste in Abschnitt 9 vor dem Commit durchgehen.
3. Dynamisch erzeugtes Markup mit Icons braucht danach `lucide.createIcons()`.
4. Commit-Nachrichten im bisherigen Format: `TT.MM.JJJJ | Kurzbeschreibung`.

---

## Lizenz

[MIT](LICENSE) © 2026 U:Bodigat
