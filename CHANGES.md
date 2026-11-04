# Änderungen

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
