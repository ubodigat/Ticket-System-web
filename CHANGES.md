# Änderungen und Herkunft (CPAL 3.3)

## 2026-10-10 - Modulaufteilung von script.js, Backup/Restore, SLA-/Rechte-Tests
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Geänderte Dateien und Funktionen:
  - `script.js` (10.600+ Zeilen) in native ES-Module unter `js/` aufgeteilt (`utils.js`,
    `lang.js`, `store.js`, `log-diff.js`, `auth.js`, `ui.js`, `settings.js`, `user-dash.js`,
    `ticket-helpers.js`, `admin-board.js`, `context-menu.js`); `script.js` ist jetzt nur noch
    der ~195-zeilige Einstiegspunkt. Kein Bundler, native `<script type="module">`.
  - Dabei entdeckter und behobener Fehler: `Store.init()` rief `Store.syncSessionUser(...)`
    auf, das nirgends definiert war -- ein unbehandelter `TypeError` bei jedem Seitenaufruf
    einer angemeldeten Person im Serverbetrieb. Jetzt in `js/store.js` definiert.
  - `apps/server/src/http/routes/staticAssets.ts`: Allowlist um alle `/js/*.js`-Pfade erweitert.
  - `index.html`, `dashboard.html`, `admin.html`: `<script>`-Tag auf `type="module"` umgestellt.
  - Neu: `apps/server/src/domain/sla.ts` (serverseitige SLA-Fristberechnung, Geschäftszeiten)
    und `apps/server/src/domain/status.ts` (Ticket-Status-Validierung) inkl. Tests
    (`test/sla.test.ts`, `test/status.test.ts`, `test/session.test.ts`).
  - Neu: `ops/docker/backup.sh` / `ops/docker/restore.sh` (verschlüsseltes Backup/Restore von
    Datenbank, Schlüssel und TLS-Zertifikaten).
  - `apps/server/src/mail/mailer.ts`: `requireTLS: true` für STARTTLS ergänzt -- ohne diese
    Option hätte nodemailer bei einem SMTP-Server ohne STARTTLS-Unterstützung stillschweigend
    unverschlüsselt versendet (Verstoß gegen die Anforderung "E-Mail verschlüsselt").
  - CodeQL-Fund (Insecure randomness, `js/insecure-randomness`): `js/store.js` erzeugte das
    Fallback-Passwort neuer Benutzer mit `Utils.uid()` (`Math.random()`), vorhersagbar für
    Angreifer (CWE-338). Neue Funktion `Utils.secureToken()` in `js/utils.js` auf Basis von
    `crypto.getRandomValues()`, nur für diesen sicherheitsrelevanten Fall verwendet.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-09 - Geplante lokale Lizenzumstellung
- Originalentwickler: U:Bodigat
- Originalprojekt: https://github.com/ubodigat/Ticket-System-web
- Vorgesehen: CPAL-1.0 mit Exhibit-B-Attribution; UI-Hinweise ergänzt
- Kein automatischer Commit und kein Upload

## Vorlage für weitere Änderungen
- Datum:
- Verantwortliche Person / Organisation:
- Welche Dateien und Funktionen wurden geändert:
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version:
