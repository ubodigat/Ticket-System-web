# Support Portal · Enterprise Helpdesk- & Ticketsystem

Ein modernes, selbst gehostetes Helpdesk- und Ticketsystem mit reaktiver Weboberfläche, Node.js/Fastify-Backend, MariaDB und durchgängiger Enterprise-Sicherheit.

Entwickelt nach dem **Zero-Trust-Prinzip**: Der Server ist die alleinige Sicherheitsinstanz. Client-Eingaben werden niemals ungeprüft übernommen, alle Daten werden auf Feldebene verschlüsselt und sicher verwaltet.

---

## Highlights & Kernfunktionen

- **Ein-Befehl-Installation (One-Command-Install):** Vollautomatisches Setup auf Debian/Ubuntu inklusive MariaDB, Caddy (automatisches TLS), Docker Compose und Migrationen.
- **Zero-Trust-Sicherheitsarchitektur:**
  - **Kein Vertrauen in den Browser (Client):** Strikte serverseitige Zod-Validierung, serverseitige HTML-Sanitization (`sanitize-html`), kein RCE oder unsichere Code-Ausführung möglich.
  - **Vollständiger Schutz vor Datei-Manipulationen:** Tiefe Dateityp-Erkennung (`file-type`), Prüfung auf Magic Bytes (Blockierung von Windows PE, Linux ELF, Mach-O, Shell-Skripten, PHP, bösartigem SVG/HTML) unabhängig vom deklarierten MIME-Typ oder der Endung.
  - **Defense in Depth & CSP:** Strikte Content Security Policy ohne `'unsafe-inline'` oder `'unsafe-eval'` für Skripte. Keine externen CDNs – alle benötigten Assets werden lokal ausgeliefert.
  - **Argon2id & TOTP Zwei-Faktor-Authentifizierung (2FA):** Server-validiertes MFA mit Notfall-Wiederherstellung und konfigurierbarem Brute-Force-Schutz (temporäre/permanente Kontensperrung).
  - **Verschlüsselung auf Feldebene (Encryption at Rest):** DEK-Schlüsselhierarchie (AES-256-GCM) mit Authenticated Additional Data (AAD) für Ticketinhalte, Chatnachrichten, interne Notizen, Dateianhänge und Benutzerdaten.
  - **Ende-zu-Ende-Verschlüsselung (E2EE):** Unterstützung für asymmetrische Schlüsselpaare und Ende-zu-Ende-Verschlüsselung im Ticket-Chat.
- **Rollensystem & Granulare Berechtigungen (RBAC):**
  - **Benutzer:** Tickets erstellen, eigene Tickets einsehen/kommentieren, Rückfragen beantworten, Profil verwalten.
  - **Admins:** Kanban- und Listenansichten, Zuweisungen, interne Notizen, Zeitabrechnung, Dokumentenvorschau, Todo-Verwaltung.
  - **Superadmins:** Vollständige Systemverwaltung, globale Audit-Logs, Benutzer- und Rollenvergabe, Sicherheitsrichtlinien.
- **Umfassende Ticket- & Workflow-Tools:**
  - Status-, Prioritäts- und SLA-Fristenverwaltung mit automatischer Reaktionszeitüberwachung.
  - Interne Notizen (für Endbenutzer unsichtbar) und Aufgaben-Checklisten pro Ticket.
  - Integrierte Dokumentenvorschau (Office- und PDF-Dateien) über isolierten Konvertierungsdienst.
  - Benachrichtigungscenter (In-App & E-Mail via SMTP) und konfigurierbare Textbausteine.
  - Integrierte Wissensdatenbank (Knowledge Base) mit Volltextsuche.

---

## Schnellinstallation (One-Command-Install)

Auf einem frischen Debian- oder Ubuntu-Server als `root` (oder mit `sudo`) ausführen:

### Für Produktionsserver mit Domain:
```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash'
```

### Für lokale Testumgebungen (localhost / Dev-Modus):
```bash
bash -c 'set -e; if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl ca-certificates; fi; curl -fsSL https://raw.githubusercontent.com/ubodigat/Ticket-System-web/main/install.sh | bash -s -- --dev'
```

### Was der Installer automatisch erledigt:
1. Prüft und installiert Systempakete (`curl`, `git`, `openssl`, `ca-certificates`).
2. Installiert und konfiguriert Docker & das Docker Compose Plugin.
3. Klont das Repository nach `/opt/ticket-system`.
4. Erzeugt kryptografisch sichere Zufallsschlüssel (`ops/secrets/app.kek`, Passwörter, Cookie-Secret).
5. Startet MariaDB, wartet auf die Verfügbarkeit und führt alle Datenbankmigrationen aus.
6. Startet den App-Container und den Caddy-Proxy (mit automatischem HTTPS/TLS).
7. Gibt nach erfolgreichem Start die Einrichtungs-URL im Terminal aus.

---

## Erste Schritte nach der Installation

1. **Einrichtungsassistent aufrufen:** Öffne `https://<server-adresse>/setup` im Browser.
2. **Grundeinstellungen festlegen:** Unternehmensname, Portalbezeichnung und Einstellungen erfassen.
3. **Ersten Superadmin anlegen:** Zugangsdaten für das Haupt-Administratorkonto definieren.
4. **Anmelden:** Unter `https://<server-adresse>/login` anmelden.
   - Benutzer werden automatisch auf `/dashboard.html` weitergeleitet.
   - Administratoren und Superadmins werden automatisch auf `/admin.html` weitergeleitet.

---

## Architektur & Sicherheitsmodell

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                              │
│   Dashboard / Admin-Board / UI-Module (Zero-Trust: reine Präsentation) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / TLS (Caddy)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Fastify App Server (Node 24)                    │
│  ├─ Rate-Limiting & Security-Header (Helmet, Strict-CSP)              │
│  ├─ Session-Prüfung & serverseitige Rollenvalidierung (RBAC)           │
│  ├─ Zod-Validierung aller Parameter & Payloads                         │
│  ├─ Serverseitige HTML-Sanitization (sanitize-html)                    │
│  ├─ Tiefen-Dateivalidierung (Magic Bytes, file-type, Shebang-Check)    │
│  └─ Kryptografische Dienste (Argon2id, AES-256-GCM DEK Service)        │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   ▼                                 ▼
┌────────────────────────────────────┐  ┌────────────────────────────────┐
│      MariaDB 12 (Datenbank)        │  │     Office Preview Service     │
│  ├─ Normalisierte SQL-Tabellen     │  │  ├─ Gotenberg / LibreOffice    │
│  ├─ Verschlüsselte Pflichtspalten  │  │  ├─ Isolierter PDF-Export      │
│  └─ Revisionssichere Audit-Logs    │  │  └─ Keine Skriptausführung     │
└────────────────────────────────────┘  └────────────────────────────────┘
```

### Sicherheitsprinzipien im Detail

1. **Zero-Trust-Browser-Prinzip:**
   - Der Client wird niemals als vertrauenswürdig eingestuft.
   - Berechtigungen (z.B. Bearbeiten von Tickets, Admin-Zusatzrechte, Schließen fremder Tickets) werden ausschließlich auf dem Server erzwungen.
   - Rich-Text-Nachrichten und Beschreibungen werden vor der Speicherung serverseitig von bösartigem HTML, Skripten und Event-Handlern bereinigt.
2. **Sichere Dateiverarbeitung:**
   - Hochgeladene Dateien werden serverseitig auf Binärebene (Magic Bytes) analysiert.
   - Ausführbare Dateien (EXE, ELF, Mach-O, Java-Bytecode) und Skripte (Bash, Batch, PHP, HTML, SVG mit Skripten) werden unabhängig von ihrer Dateiendung blockiert.
   - Dokumentenvorschauen werden isoliert gerendert und mit strikter CSP (`default-src 'none'`) als PDF ausgeliefert.
3. **Schlüsselverwaltung & Verschlüsselung:**
   - Der Key Encryption Key (KEK) liegt in `ops/secrets/app.kek` und verlässt den Server nicht.
   - Datenverschlüsselungsschlüssel (DEKs) verschlüsseln sensitive Daten mit AES-256-GCM und kanonischem AAD (Verhinderung von Vertauschungs- und Replay-Angriffen).
   - Passwörter werden ausschließlich mit Argon2id gehasht.

---

## Wichtige Befehle für Administratoren

Wechsle in das Installationsverzeichnis:
```bash
cd /opt/ticket-system
```

| Aktion | Befehl |
|---|---|
| **Status aller Container** | `docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps` |
| **Live-Logs anzeigen** | `docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f` |
| **App neu starten** | `docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env restart app` |
| **App neu bauen** | `docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --build --no-deps app` |
| **Migrationen prüfen/ausführen** | `docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js` |
| **Backup erstellen** | `./ops/docker/backup.sh` |

---

## Entwicklung & Testsuite

Für Entwickler, die lokal an der Codebasis arbeiten:

### Voraussetzungen
- Node.js 24+
- MariaDB oder Docker

### Installation & Prüfung
```bash
# Abhängigkeiten installieren
npm install

# TypeScript Typecheck
npm run typecheck

# Vollständige Testsuite ausführen (Vitest)
npm run test
```

Alle 20 Test-Suites decken RBAC, IDOR-Schutz, Dateivalidierung, HTML-Sanitizing, Krypto-Services, SLA-Berechnungen und Authentifizierung automatisiert ab.

---

## Lizenz & Attribution

Dieses Projekt unterliegt der **Common Public Attribution License Version 1.0 (CPAL-1.0)**.
Originalprojekt: [Ticket-System-web](https://github.com/ubodigat/Ticket-System-web) von **U:Bodigat**.
Copyright © 2026 U:Bodigat. Alle Rechte vorbehalten.
Details zur Lizenzierung siehe [LICENSE](LICENSE) und [NOTICE.md](NOTICE.md).
