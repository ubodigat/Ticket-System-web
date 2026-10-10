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
git pull
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env build --no-cache app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env up -d --force-recreate
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env exec -T app node dist/db/migrate.js
```

Das harte Neubauen ist wichtig, weil die Weboberflaeche statische Dateien aus `js/` und
`vendor/` in das App-Image kopiert. Ohne Rebuild kann der Server noch alte HTML-/JS-Dateien
ausliefern, was sich im Browser als fehlende Icons, `/js/*.js`-404 oder CSP-Fehler zeigt.

Migrationen sind additiv (`up`-Richtung wird bei jedem Update erneut ausgeführt, bereits
angewendete Migrationen werden von Kysely übersprungen). Ein `ticketctl`-Kommando, das diese
drei Schritte zusammenfasst, ist gemäß `docs/SPEC.md` §4.3 für eine spätere Phase vorgesehen.

## Backup/Restore

Alle Geschäftsdaten (Tickets, Benutzer, Anhänge, ...) liegen ausschließlich in MariaDB, dort
bereits AES-256-GCM-verschlüsselt. Ein Backup braucht deshalb zwei Dinge: den Datenbank-Dump
UND den Schlüssel (`ops/secrets/app.kek`), ohne den der Dump nicht entschlüsselbar ist.

```bash
./ops/docker/backup.sh
```

Fragt eine Passphrase ab (oder liest sie aus `BACKUP_PASSPHRASE`) und legt ein einzelnes,
mit dieser Passphrase verschlüsseltes Archiv unter `ops/backups/` ab (DB-Dump + KEK +
TLS-Zertifikate). Das Archiv ist ohne die Passphrase nutzlos -- auch wenn es irgendwo offen
liegt (siehe Anforderung "Offene Backup-Dateien"). `ops/backups/` ist nicht Teil des Git-Repos
(siehe `.gitignore`); die Datei UND die Passphrase gehören an einen anderen Ort als dieser
Server (3-2-1-Regel: mindestens eine Kopie extern).

```bash
./ops/docker/restore.sh ops/backups/ticket-system-backup-<Zeitstempel>.tar.gz.enc
```

Überschreibt die aktuelle Datenbank und den aktuellen Schlüssel dieser Installation vollständig
und unwiderruflich (fragt vor dem Ausführen eine Bestätigung ab) -- gedacht für Wiederherstellung
auf einem leeren/zu ersetzenden System, nicht zum Zusammenführen mit vorhandenen Daten.

## Logs/Diagnose

```bash
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env logs -f app
docker compose -f ops/docker/docker-compose.yml --env-file ops/docker/.env ps
```
