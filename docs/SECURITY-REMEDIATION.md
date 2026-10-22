# Sicherheitsreparaturen / 21.10.2026

## Ergänzung: Kontogültigkeit / 22.10.2026

Migration 0045 ergänzt ein optionales Gültigkeitsdatum. Ein Konto bleibt einschließlich
dieses Tages in Europe/Berlin gültig. Passwort-/LDAP-Login, MFA und bestehende Sitzungen
prüfen dieselbe serverseitige Regel; ein Cronjob ist dafür nicht erforderlich.
Normale Benutzer dürfen die Frist nicht ändern. Der letzte unbefristete Superadmin
wird geschützt. Beim Wiederfreischalten abgelaufener Konten werden alte Sitzungen widerrufen.

Verifikation dieser Ergänzung: 140 Unit-Tests, Typecheck und Build erfolgreich;
16 Browserprüfungen inklusive Benutzereditor auf Desktop/Mobil und strikter CSP bestanden.
Der echte MariaDB-Test wurde um die neue Spalte und Tagesgrenzen erweitert, ist lokal
weiterhin mangels Docker-Daemon nicht ausgeführt.

## Implementiert

| Befund | Änderung |
| --- | --- |
| R-6 / Installation | Passwörter werden vollständig gelesen, auch mit `=`. Separater Provisionierungsschritt mit Root-Anmeldung, DML-only-Laufzeitkonto und TLS-Anmeldeprüfung vor Neustart. Derselbe Schritt läuft beim Online-Update. |
| R-7 / Kalender | Admin-Pflicht, bekannte aktive Empfänger und kontobasiertes Rate-Limit. |
| R-8 / Chiffrate | Kein Klartext-Fallback beim Lesen. Migrationen erkennen gültige UTF-8-Altwerte nur bis zum feldbezogenen Abschluss-Checkpoint. Danach führt jeder Authentifizierungsfehler zum Abbruch. |
| R-9 / Mail-Schlüssel | S/MIME-Schlüssel, Passphrase und DKIM-Schlüssel in authentifiziert verschlüsselter Spalte; automatische Übernahme und Entfernung aus `config_json`. |
| N10 / Restfelder | Wiederholungsregeln, Kontoantrag-Freitexte und Ticket-Zusatzwerte werden verschlüsselt gespeichert; Altbestände werden migriert. |
| N11 / Merge | Unterschiedliche oder unbekannte Ticket-Ersteller werden für alle Rollen abgewiesen, bevor Inhalte verschoben werden. |
| N12 / Identität | API-Lesen, Markieren und Löschen ausschließlich per Benutzer-ID; Frontend-Abwesenheitshinweise ebenfalls. Verwaiste Alteinträge werden entfernt, niemals anhand eines möglicherweise neu vergebenen Benutzernamens zugeordnet. |
| N13 / Bootstrap | README-Befehl prüft Skript-Hash vor Ausführung. Installer prüft ein festgelegtes Gesamtmanifest und die vollständige versionierte Dateiliste vor Fortsetzung. CI prüft die Aktualität. |
| N3 / SMTP | Persistente verschlüsselte Queue, gesperrte Auftragsübernahme, Neustart-Wiederaufnahme, verzögerte Wiederholungen, Status `dead`, begrenzte Aufbewahrung. Kein SMTP-Warten in Benachrichtigungs-Requests. |
| N-3 / Updater | Unbekannte/fehlende GPG-Schlüssel und unsignierte Commits verhindern Deployments. Keine abschaltbare Signaturprüfung; geprüfter Ziel-Commit zwingend erforderlich. Rollbacks überschreiben keine lokalen Änderungen und übergehen keine Schemaänderungen. |
| Container / CSP | Image- und Basisimage-Digests festgelegt; Proxy-Subnetz konfigurierbar. CSP ohne `unsafe-inline`; Druckansichten laden eine separate CSS-Datei. |

## Verifikation

Lokaler Abschlusslauf: Typecheck und Build erfolgreich, 121 Unit-Tests bestanden,
14 Browserprüfungen auf Desktop und Mobilgerät unter strikter CSP bestanden,
Installer-Regressionen und Shell-/JavaScript-Syntax geprüft, `npm audit`: 0 Befunde.
Der echte MariaDB-/Compose-Lauf wurde lokal mangels Docker-Daemon nicht ausgeführt;
der ergänzte CI-Integrationstest ist noch auszuführen.

- Typecheck, Vitest und Build lokal ausführen; zusätzliche Regressionstests liegen in
  `security-regressions.test.ts` und `mail-queue.test.ts`.
- `bash ops/tests/installer-security.sh` prüft mit simuliertem Docker/MariaDB die
  Passwortübernahme, Root-Wiederherstellung, TLS-Prüfung und sichere Fehlerbehandlung.
- `ops/tests/mariadb-security.mjs` ist für eine **separate, leere** CI-Datenbank vorgesehen.
  Es installiert Schema 0037, legt Altbestände an, aktualisiert das Schema und prüft
  Verschlüsselung, Checkpoints und einen fehlgeschlagenen persistenten Mailversuch.
- Browserprüfungen müssen Desktop und Mobilansicht mit strikter CSP abdecken.

Ein angelegter CI-Test ist kein Beleg, dass er bereits auf GitHub oder gegen eine produktive
Installation erfolgreich gelaufen ist. Ohne lokalen Docker-Daemon bleibt ein vollständiger
Compose-Neuinstallations-, Neustart- und Upgrade-Lauf gesondert zu bestätigen.

## Verbleibende Betriebsbedingungen

Der optionale Updater besitzt weiterhin Host-Rechte über den Docker-Socket. Das ist eine
bewusste privilegierte Betriebsart, keine beseitigte Container-Isolation: Standardmäßig bleibt
er aus. Ein Host-Updater mit unabhängigem Freigabeprozess wäre eine andere Architektur.

Verlorene Root-Passwörter können nicht ohne weiteres rekonstruiert werden. Bei alten
Installationen ohne ursprüngliche MariaDB-Logs muss der Betreiber das bestehende Passwort
bereitstellen. Es gibt keinen automatischen unsicheren DDL-Fallback und kein Löschen von Daten.

Signaturschlüssel müssen unabhängig geprüft und hinterlegt, Release-Commits signiert und
Skript/Manifest/README gemeinsam veröffentlicht werden. Es wird kein fremder Schlüssel
automatisch als vertrauenswürdig importiert.

SMTP- und Microsoft-Graph-Zugangsdaten, Postfachbeschränkung in Entra ID, Zertifikatsvertrauen,
Firewallfreigaben sowie organisatorische Lösch- und Auskunftsprozesse bleiben Aufgaben des
Betreibers. Eine absolute Zusage „100 % sicher“ lässt sich aus Tests nicht ableiten.
