# Betrieb (Phase 1 – Grundgerüst)

Dieses Verzeichnis enthält den Docker-Stack für das Server-/MariaDB-Backend. Es deckt den in
`docs/PROGRESS.md` als "Phase 1" bezeichneten Umfang ab: Datenbankverbindung, Schlüsselverwaltung,
Healthcheck, Migrationen. Die Geschäftslogik (Tickets, Authentifizierung, Chat, …) folgt in
späteren Phasen.

## Installation (einmalig)

```bash
./install.sh
```

Das Skript (im Projektwurzelverzeichnis):
1. erzeugt alle Secrets (DB-Passwort, Cookie-Secret, Installations-ID) – idempotent, läuft ein
   zweiter Aufruf, werden vorhandene Secrets wiederverwendet statt überschrieben;
2. erzeugt den KEK (App-seitiger Schlüsselverschlüsselungsschlüssel, `ops/secrets/app.kek`) –
   siehe `docs/CRYPTOGRAPHY.md`;
3. erzeugt eine selbstsignierte TLS-Zertifikatskette für die Verbindung App↔MariaDB
   (`ops/tls/mariadb/`) – siehe `docs/CRYPTOGRAPHY.md` §8;
4. baut und startet den Stack (`mariadb`, `app`, `caddy`) über `docker compose`;
5. wartet auf den Healthcheck der Anwendung;
6. führt die Datenbankmigrationen aus;
7. gibt die erreichbare URL aus.

Für eine lokale Entwicklungsumgebung ohne öffentliches TLS: `./install.sh --dev`.

**Hinweis zum Stand:** `ops/secrets/` und `ops/tls/` sind bewusst nicht versioniert (siehe
`.gitignore`) – sie enthalten Installationsspezifische Geheimnisse, keinen Code.

## Update

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --build
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Migrationen sind additiv (`up`-Richtung wird bei jedem Update erneut ausgeführt, bereits
angewendete Migrationen werden von Kysely übersprungen). Ein `ticketctl`-Kommando, das diese
drei Schritte zusammenfasst, ist gemäß `docs/SPEC.md` §4.3 für eine spätere Phase vorgesehen.

## Backup/Restore

Noch nicht automatisiert in Phase 1 – siehe `docs/BACKUP_CONCEPT.md` für das verbindliche
Konzept (3-2-1, Object-Lock, Deletion-Journal). Die Umsetzung als Tooling folgt gemäß
`docs/PROGRESS.md` Phase 9.

## Logs/Diagnose

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
```
