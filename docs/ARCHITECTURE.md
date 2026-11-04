# Architektur

```
Browser ──HTTPS──▶ Caddy ──HTTP (Netz "edge")──▶ App (Fastify, Node 26) ──TLS──▶ MariaDB 12
                                                   │                         (Dateiverschlüsselung)
                                                   ├─▶ Office-Vorschau / ONLYOFFICE (optional)
                                                   ├─▶ ClamAV (optional)
                                                   └─▶ Austauschverzeichnis ◀── Host-Updater (systemd)
```

## Bausteine

| Baustein | Ort | Aufgabe |
| --- | --- | --- |
| Oberfläche | `index.html`, `admin.html`, `dashboard.html`, `js/` | Vanilla-ES-Module ohne Build-Schritt; strikte CSP |
| API | `apps/server/src/http/routes/` | v2-REST-API, Rechteprüfung serverseitig |
| Domäne | `apps/server/src/domain/` | Ticketzugriff, SLA, Genehmigungen, MFA, Sicherung |
| Kryptografie | `apps/server/src/crypto/` | Feldverschlüsselung, DEKs, KEK, Rotation, abgeleitete Schlüssel |
| Datenbank | `apps/server/src/db/` | Schema (`schema.ts`), Abgleich (`schemaSync.ts`), Kysely-Typen |
| Wartung | `apps/server/src/jobs/` | In-Prozess-Timer: Abwesenheiten, Archiv, Wiederholungen, Löschfristen, Neuverschlüsselung |
| Betrieb | `install.sh`, `ops/` | Installer, Compose-Stack, Sicherung, Updater, Tests |

## Datenbankkonten

- **Laufzeitkonto** (`DB_RUNTIME_USER`): nur Zeilen lesen und schreiben – die App kann das Schema
  nicht verändern.
- **Schemakonto** (`DB_USER`): nur für den kurzlebigen Schema-Abgleich und die Schlüsselrotation,
  Zugangsdaten per stdin.

## Zeit

Alle Zeitpunkte werden in UTC gespeichert. Jede Verbindung setzt `time_zone = '+00:00'`, MariaDB
läuft zusätzlich mit `default_time_zone = '+00:00'`. Die Darstellung erfolgt im Browser.

## Healthcheck

`/health` ist nur intern erreichbar (Caddy sperrt ihn nach außen). Die App startet nur, wenn die
Datenbank zum Schema passt; der Updater nutzt den Healthcheck für das automatische Zurücksetzen.
