# Änderungen

## 04.11.2026 – Security-Audit (Stand d174169): R-14, R-29, R-30, R-31 und Checkliste

### R-30 Gruppen-Sichtbarkeit (hoch)
- Zentrale Prüfung `ticketRouteGuard` (domain/ticketAccess.ts) für jede Route unter
  `/api/v2/tickets/:id` und alle Rollen; ohne Zugriff Antwort 404 (verrät nicht, dass es das Ticket
  gibt). Neue Routen sind automatisch erfasst; Ausnahme nur die Genehmigungsentscheidung.
- Gruppen sind abgeschottet: ein nicht zugewiesenes Ticket einer fremden Gruppe ist nicht mehr für jede
  Admin-Person sichtbar (gleiche Regel im Frontend).
- `first-response-times` liefert nur sichtbare Tickets und keine Zuordnungsdaten; Zusammenführen prüft
  Quelle und Ziel; Benachrichtigungen (auch Erwähnungen und die API `POST /notifications`) nur an Konten
  mit Zugriff; Aufgabenliste, Zeiterfassung, Vertretungsliste, Wissensdatenbank (Zähler, Quellticket)
  und verknüpfte Großstörungen im Sichtbarkeitsbereich; Zuständige einer Teilaufgabe müssen das Ticket
  sehen dürfen.
- Tests: `ticket-route-guard.test.ts` ruft jede Route mit „Admin anderer Gruppe“, „fremdes Konto“ und
  „Superadmin“ gegen die echte App auf (66 Fälle, Gegenprobe ohne Prüfung schlägt fehl);
  `security-audit-2026-11-04.test.ts`.

### R-29 Speicherbedarf (mittel)
- Upload-Abschluss, Typprüfung (file-type als Datenstrom) und Virenscan (clamd INSTREAM) arbeiten
  Teilstück für Teilstück statt mit einem Puffer in Dateigröße.
- Sicherung und Wiederherstellung in der Oberfläche komprimieren und verschlüsseln als Datenstrom; beim
  Einspielen wird der GCM-Tag zuerst über die ganze Datei geprüft, danach stückweise entschlüsselt. Im
  Speicher liegt höchstens die verschlüsselte Datei. Dabei behoben: Beim Überschreiten der Größengrenze
  blieb das Erstellen einer Sicherung hängen.
- Tests: `uploads.test.ts` (keine Allokation in Dateigröße, 500-MiB-Durchlauf), `backup.test.ts`,
  `security-audit-2026-11-04.test.ts` (Office-Erkennung aus Teilstücken, clamd-Protokoll).

### R-31 Build-Kontext und Laufzeit-Image (niedrig)
- `.dockerignore` als Positivliste: Schlüssel, Sicherungen, Kits, TLS-Material und `.env`-Dateien
  erreichen den Docker-Daemon nicht mehr.
- Laufzeit-Abhängigkeiten aus eigener Stufe (`npm ci --omit=dev`): kein typescript, tsx, vitest oder
  @types im Image. Geprüft mit einem echten Image-Build.

### R-14 Signierte Releases (niedrig)
- Behoben: `verify_release_tag` im Installer verglich nur den ersten Fingerabdruck der Schlüsseldatei.
  Ein angehängter Fremdschlüssel konnte Tags signieren. Jetzt zählt der Hauptschlüssel in der Signatur
  selbst (VALIDSIG), und die Schlüsseldatei darf genau einen Schlüssel enthalten.
- `ops/release/create-release.sh` (init/tag) für signierte Tags und Release-Assets; der Installer
  hinterlegt den geprüften Release-Schlüssel automatisch für Online-Updates.
- Test: `ops/tests/release-signature.sh` (in der CI), inklusive drei Angriffsvarianten.

### Checkliste und Empfehlungen
- Warnung in Info & Updates, solange ein Wiederherstellungs-Kit unter `ops/` liegt; deutlichere
  Aufforderung im Installer.
- Auskunft und Datenexport (DSGVO Art. 15/20) vom Server: vollständig, entschlüsselt, ohne Geheimnisse,
  mit Passwort bzw. für andere Personen nur durch Superadmins mit TOTP, protokolliert.
- Löschkonzept für Sicherungen dokumentiert; lokale Aufbewahrung über `BACKUP_KEEP_LOCAL` in `.env`.
- Patch-Updates: fastify 5.12.8, @fastify/rate-limit 11.2.2, argon2 0.45.2, jose 6.2.15, kysely 0.29.8,
  otpauth 9.6.0, vitest 5.1.0, pdfjs-dist 6.5.438 (mit `isEvalSupported: false`), jszip 3.10.2.
  Prüfsummen der Vendor-Bibliotheken werden jetzt getestet.

## 04.11.2026 – Schema ohne Migrationen, Online-Update, Review-Fixes und Arbeitsansichten

### Datenbank und Update
- Keine Migrationsdateien mehr: `apps/server/src/db/schema.ts` beschreibt das vollständige Schema,
  `node dist/cli/schema.js` gleicht jede Datenbank ab – fehlende Tabellen, Spalten, Indizes und
  Fremdschlüssel werden angelegt, Spalten nur verlustfrei erweitert, nie etwas gelöscht. Würde eine
  Anpassung Daten kosten, bricht der Abgleich ab, bevor etwas geändert wird. Die App startet nur mit
  passendem Schema (`schema_state`). Test: Upgrade einer bestehenden Installation (Stand 11/2026)
  ohne Datenverlust und Gleichheit mit einer Neuinstallation (`ops/tests/mariadb-security.mjs`).
- Online-Update in einem Durchgang: Prüfung, verschlüsselte Sicherung, Signaturprüfung, Build,
  Schema-Abgleich, Neustart mit Healthcheck; bei einem Fehler automatische Rückkehr zur vorherigen
  Version. Neue Oberfläche mit Änderungsliste, Ablauf, Sicherungsstatus und „Erneut ausrollen“.
- Ältere Sicherungen lassen sich nach einem Update einspielen, solange keine gesicherte Spalte fehlt.

### Review vom 02.11.2026
1. Rechteausweitung behoben: nur Superadmins legen Admin-Konten an, befördern oder vergeben
   Zusatzrechte – auch beim CSV-Import. Admins mit „Benutzerverwaltung“ verwalten nur Konten der
   Rolle „Benutzer“ (wie früher „Benutzerverwaltung (nur Benutzer)“). Test: `review-2026-11.test.ts`.
2. Neue Installationen verlangen TOTP oder Passkey für Admin-Konten; das Setup gibt dem ersten
   Superadmin einen Einrichtungscode. Bestehende Installationen werden nicht umgestellt, Superadmins
   sehen einen Hinweis. Test: `review-2026-11.test.ts`.
3. Schlüsselrotation: versioniertes Feldformat (Format, Schlüsselversion, IV, Ciphertext, Tag), DEK-
   Versionen, KEK-Schlüsselbund, AAD-gebundene DEK-Umhüllung, fortsetzbare Neuverschlüsselung,
   `ops/docker/rotate-keys.sh`; `SCHEMA_VERSION` entfällt. Tests: `crypto.test.ts`, MariaDB-Integration.
4. Sicherung neu: asymmetrisch verschlüsselte Datensicherung ohne KEK/.env, direkt gestreamt,
   Wiederherstellungs-Kit getrennt und nicht auf dem Server, externe Kopie über restic oder S3,
   Warnung in der Oberfläche, täglicher Timer, Restore-Test. Test: `ops/tests/backup-roundtrip.sh`.
5. Jede Verbindung arbeitet in UTC, MariaDB zusätzlich mit `default_time_zone = '+00:00'`; CI-Lauf
   mit `TZ=Europe/Berlin` für MariaDB und Node. Tests: `db-connection.test.ts`, MariaDB-Integration.
6. Installation signierter Release-Tags mit unabhängig veröffentlichtem Fingerabdruck
   (`INSTALL_REF`, `INSTALL_SIGNER_FINGERPRINT`, README). Der Release-Schlüssel und der erste
   signierte Tag müssen vom Maintainer erstellt werden (docs/OPERATIONS.md).
7. Dateiverschlüsselung von MariaDB (Tabellen, Redo-/Undo-Log, temporäre Dateien, Aria, Binlog).
   Test: `ops/tests/mariadb-encryption-at-rest.sh` (kein Klartext im Volume, ohne Schlüssel unlesbar).
8. `app`, `mariadb`, `caddy`: `cap_drop: [ALL]` mit minimalen `cap_add`, `no-new-privileges`,
   Speicher-/CPU-Grenzen, `read_only` für `app` und `caddy`. Mit dem Test aus Punkt 7 geprüft.
9. Kanban auf dem Handy: Spalten untereinander in voller Höhe; Lizenzhinweis im Seitenfuß.
10. Enge Rate-Limits (Anmeldung, MFA, Setup, Passwort, Update …) in der Datenbank, über Neustarts
    hinweg; das grobe globale Limit bleibt bewusst im Speicher (dokumentiert). Test: MariaDB-Integration.
11. Druckansicht ohne Inline-Style (Klassen statt `style=`). Test: `review-2026-11.test.ts`.
12. Anmeldeseite ruft ohne Sitzung keine geschützten Endpunkte mehr auf (`/api/v1/auth/session`).
13. Dokumentation wiederhergestellt: `SECURITY.md` (Meldeweg), `docs/THREAT_MODEL.md`,
    `docs/ARCHITECTURE.md`, `docs/CRYPTOGRAPHY.md`, `docs/OPERATIONS.md`.
14. HSTS ohne `preload` (Caddy und Helmet).
15. Eigener, per HKDF abgeleiteter Schlüssel je Zweck für Office-Token, MFA-Zwischentoken und
    Anmeldedrosselung. Test: `review-2026-11.test.ts`.

### Bedienung (Bewertung 11/2026, Etappe 1)
- Systemeinstellungen breiter und höher.
- Arbeitsansichten über dem Board: Alle offenen, Mir zugewiesen, Nicht zugewiesen, Antwort nötig,
  Frist gefährdet – mit Zählern; geschlossene Tickets standardmäßig ausgeblendet.
- Benutzerportal mit Service-Einstieg („Wie können wir helfen?“); Priorität ergibt sich aus
  Auswirkung und Dringlichkeit statt Selbsteinstufung.
- Ticket: kopierbarer Direktlink, Schutz vor dem Schließen mit ungesendeten Eingaben.
- Tätigkeitsbeschreibung der Zeiterfassung abschaltbar (Systemeinstellungen › Allgemein).

## 29.10.2026 – Verwaltungsdialoge und Planung

- Erklärte Wartefristen mit abschaltbarer Erinnerung und wählbarer automatischer Schließung.
- Zwölf E-Mail-Vorlagenvariablen mit Einfügeschaltflächen und validierte Zeitzonenauswahl.
- Bearbeitbare, durchsuchbare Textbausteine; Neuanlage vor den Verwaltungslisten.
- Separate Wissensdatenbank-Leseansicht und durchsuchbare wiederkehrende Tickets.
- Mehrere Abwesenheitszeiträume mit Überschneidungsprüfung und zeitgerechter Vertretung.
- Personenauswahl innerhalb des sichtbaren Fensters und direkt anklickbare Ticket-Teilaufgaben.
- Neu gegliederte interne Kommunikation; vorhandene Bedienelemente und Funktionen bleiben erhalten.

## 26.10.2026 – persönlicher Arbeitsbereich und MFA

- Optionale, schreibgeschützte ONLYOFFICE-Oberfläche mit signierter Dokumentenkonfiguration,
  zeitlich begrenzten Dateifreigaben und isoliertem Docker-Profil.
- TOTP-/Passkey-Regeln einschließlich zusätzlichem Nachweis alle 14 Tage pro Gerät;
  einmalige Wiederherstellungscodes und expliziter Server-Rettungsweg.
- Verschlüsselte, kontobezogene Darstellungseinstellungen und gespeicherte Klappzustände
  für die Systemeinstellungen.
- Serverseitiger Ticket-Timer mit dauerhafter Erfassung, erforderlicher Tätigkeitsbeschreibung
  und optionalen Lösungsnotizen; gemeinsamer, atomarer Abschluss.
- Migrationen 0050/0051 und zusätzliche Rechte-, Ablauf-, Wiederverwendungs- und Persistenztests.
