# Prüfstand und Grenzen

## 05.11.2026 – Zuordnung zu Großstörungen

`test/incident-status.test.ts` prüft mit dem Datenbank-Testersatz zehn Fälle: Statusübernahme
für normale Benutzer, alle aktiven Statuswerte, konsistente Warte-/Abschlusszeitpunkte, wiederholte
Zuordnung ohne Frist-Neustart, verweigerte Fremdzugriffe und Rollback bei einem Protokollfehler.
Dies ersetzt keinen vollständigen Docker-/MariaDB-/Browser-Neuinstallationstest.

## 05.11.2026 – Wissensdatenbank und Datenschutz-Nachprüfung

- Typecheck und Build erfolgreich; 50 Testdateien mit 618 bestandenen Tests, einer übersprungen.
- 23 JavaScript-Dateien syntaktisch geprüft.
- Tests prüfen freie Reportzeiträume einschließlich ungültiger Daten, Monats-/Jahreswechsel und
  exklusiver Obergrenze nach dem letzten lokalen Kalendertag.
- Die tatsächlichen Handler für neue Artikelanhänge und Todo-Optionen werden mit kleinen
  DOM-Testersatzobjekten ausgeführt. Das belegt den Zustands-/Ereignisablauf, keinen Browser-Layouttest.
- API-Test für lesbare Lösungstitel bei KB-Leserecht als JSON-Text und als Objekt; Schreibzugriff
  bleibt dabei gesperrt. Persönlicher Export enthält eigene Todo-Zeiten, keine fremden Tätigkeiten.
- Diagnose-Serializer werden auf Auslassung von Query-Geheimnissen und SQL-/Fehlertexten geprüft.
  Die Compose-Konfiguration begrenzt Diagnose-Dateigrößen; kein lokaler Docker-Lauf durchgeführt.
- [Datenschutz und Verschlüsselungsumfang](DATENSCHUTZ.md) trennt technische Maßnahmen von
  Host-Verschlüsselung, gesetzlichen Grundlagen und den notwendigen Betreiberentscheidungen.
- Keine zusätzlichen Programme oder Pakete installiert oder heruntergeladen.

## 05.11.2026 – Oberfläche, Genehmigungen und Todo-Zeiterfassung

- Typecheck und Build erfolgreich; 49 Testdateien mit 610 bestandenen Tests, einer übersprungen.
- 22 JavaScript-Dateien mit dem vorhandenen Node auf Syntax geprüft.
- Neue Routentests prüfen Genehmigungsrechte als JSON-Text und dekodiertes Objekt einschließlich
  der Profilantwort. Fehlende Rechte, normale Benutzer und ungültige Werte bleiben gesperrt.
- Todo-Timertests prüfen exklusive Zielauswahl, nur einen aktiven Timer pro Konto, Start/Stop,
  Pflichtdokumentation, Verschlüsselung sowie die Sperre fremder und ausgeblendeter Aufgaben.
  Schema und Verschlüsselungsregister werden durch die Schematests auf Konsistenz geprüft.
- Layoutkorrekturen sind im Quellcode umgesetzt. Die geplante Kontrolle im vorhandenen Chrome
  wurde vom Computer-Use-Werkzeug wegen unsicherer URL-Erkennung beendet. Eine erfolgreiche
  visuelle Prüfung aller Fenstergrößen ist daher nicht nachgewiesen.
- Die Tests verwenden für neue Routen einen Datenbank-Testersatz. Ein echter vollständiger
  Neuinstallationslauf mit Docker, MariaDB und Browser wurde hier nicht durchgeführt.
- Keine Programme oder Testpakete heruntergeladen oder installiert. Ein temporärer lokaler
  Testserver wurde mit dem vorhandenen Node gestartet und danach beendet.

## 04.11.2026 – HTTPS / Installer

Stand: 04.11.2026, lokale Änderungen zur HTTPS-/Installer-Reparatur.

Die README beschreibt den vorgesehenen Funktionsumfang. Weder erfolgreiche automatisierte
Tests noch ein leerer Schwachstellenscan garantieren Fehlerfreiheit oder das Fehlen aller
Sicherheitslücken. Die konkrete Serverinstallation wurde in diesem Lauf nicht verändert.

| Bereich | Nachweis dieses Laufs | Grenze |
| --- | --- | --- |
| TypeScript | Typecheck und Build erfolgreich | Vorhandene lokale Node-Version 24.11.1; Produktion/CI verwenden Node 26 |
| Automatisierte Server-Tests | 49 Dateien: 607 Tests erfolgreich, einer übersprungen | Kein vollständiger Browser-/Produktivtest aller Rollen und Integrationen |
| LAN-Domain / TLS-Auswahl | `ops/tests/web-tls.sh`: Eingabevalidierung, Erhalt der Konfiguration, SNI-/CA-Probeparameter und Zertifikatsfehler | Docker wird im Shell-Test simuliert; kein echter Caddy-Handshake dieses endgültigen Stands |
| Reparaturmodus | Test für schmale App-/Caddy-Neuerstellung und Rücknahme bei ungültiger Caddy-Konfiguration | Keine Ausführung gegen den Benutzer-Server |
| Quellcode beim Bootstrap | Tests für unveränderten Checkout, lokale/staged Änderungen, unversionierte Dateien | Ein sauberer Checkout ersetzt keine Signatur-/Manifestprüfung |
| Datenbank / Neustart / Komplettinstallation | CI enthält MariaDB- und Docker-Integrationstests | In diesem lokalen Lauf keine Docker-/MariaDB-Installation und kein CT-Neustarttest |
| SMTP, LDAP, Outlook, Office, Passkeys | Konfiguration und Implementierungen vorhanden | Einrichtung, Anbieterfreigaben, Geräte und echte Zustellung separat prüfen |
| README und Manifest | Prüfsummen werden gemeinsam mit Code und Befehlen erneuert | Erst nach gemeinsamer Veröffentlichung vom Server abrufbar |

Für die Fehlermeldung `ERR_SSL_PROTOCOL_ERROR` ist eine abweichende Domain/SNI-Konfiguration
eine mögliche Ursache. Ohne aktuelle Serverkonfiguration und Caddy-Logs ist sie nicht als
konkrete Ursache bestätigt. Die Reparatur und Diagnose stehen in [OPERATIONS.md](OPERATIONS.md#https-und-domainwechsel).
