# Betrieb

Alle Befehle werden als root im Installationsverzeichnis (Standard `/opt/ticket-system`) ausgeführt.

## Update

### Online (empfohlen)

Systemeinstellungen › Info & Updates › **Jetzt aktualisieren**. Voraussetzungen: Host-Updater
aktiviert (`bash install.sh --enable-updates`) und Signaturschlüssel hinterlegt. Ablauf:

1. **Prüfung**: Signatur des Ziel-Commits bzw. Release-Tags, keine lokalen Änderungen, freier Speicher.
2. **Sicherung**: verschlüsselte Datensicherung der Datenbank.
3. **Herunterladen**: Code auf den geprüften Stand bringen.
4. **Installation**: neues App-Image bauen (die App bleibt bis dahin erreichbar).
5. **Datenbank**: Schema-Abgleich – fehlende Tabellen, Spalten und Indizes werden angelegt, Spalten
   nur verlustfrei erweitert. **Es wird nie etwas gelöscht.**
6. **Neustart**: App starten und auf den Healthcheck warten (ca. eine Minute nicht erreichbar).

Schlägt ein Schritt ab „Herunterladen“ fehl, setzt der Updater automatisch auf die vorherige Version
zurück; die Daten bleiben erhalten. „Erneut ausrollen“ wiederholt den aktuellen Stand nach einem
Abbruch, „Zurücksetzen“ kehrt zur Version vor dem letzten Update zurück.

### Manuell

```bash
bash ops/docker/backup.sh
bash ops/verify-and-pull.sh
bash install.sh
```

## Datenbankschema

Es gibt keine Migrationsdateien. `apps/server/src/db/schema.ts` beschreibt das vollständige Schema,
`node dist/cli/schema.js` gleicht eine Datenbank damit ab (Installer und Updater rufen das auf).
`--check` zeigt nur an, was zu tun wäre. Weicht eine Spalte so ab, dass eine Anpassung Daten kosten
könnte, bricht der Abgleich ab, bevor irgendetwas geändert wird.

Die App startet nur, wenn die Datenbank zum Schema des Codes passt.

## Sicherung

| Teil | Inhalt | Wo |
| --- | --- | --- |
| Datensicherung | Datenbank-Dump, asymmetrisch verschlüsselt | `ops/backups/` + externe Kopie |
| Wiederherstellungs-Kit | KEK, `.env`, TLS, Schlüssel der Dateiverschlüsselung, privater Sicherungsschlüssel | **nicht auf dem Server** |

- Einmalig: `bash ops/docker/backup.sh --init-keys` (macht der Installer bei der Ersteinrichtung und
  zeigt Kit-Pfad und Passphrase einmal an).
- Täglich automatisch (systemd-Timer `ticket-system-backup.timer`) und vor jedem Update.
- Nach einer KEK-Rotation: `bash ops/docker/backup.sh --recovery-kit`.

### Externe Kopie

In `ops/docker/.env` eintragen:

```
# restic (z. B. rest-server mit --append-only)
BACKUP_RESTIC_REPOSITORY=rest:https://backup.example.com/ticket-system
BACKUP_RESTIC_PASSWORD_FILE=/root/.restic-ticket-system
# oder S3 mit Object Lock (aws CLI)
BACKUP_S3_URI=s3://firma-backups/ticket-system
```

Solange keine externe Kopie besteht, warnt die Oberfläche. Ebenso, solange ein Wiederherstellungs-Kit
unter `ops/` liegt: Kit herunterladen, getrennt von der Passphrase aufbewahren, dann
`shred -u ops/recovery-kit-*`.

### Löschkonzept für Sicherungen

Sicherungen enthalten personenbezogene Daten und erben die Löschfristen der Anwendung (Protokolle 90
bzw. 365 Tage, IP-Adressen 30 Tage, Sitzungen 30 Tage) erst, wenn sie selbst ablaufen. Die längste
Verweildauer eines gelöschten Datensatzes ist deshalb die Aufbewahrungsdauer der Sicherungen.

| Ort | Aufbewahrung | Festgelegt durch |
| --- | --- | --- |
| `ops/backups/` | die neuesten `BACKUP_KEEP_LOCAL` Sicherungen (Standard 14 = 14 Tage bei täglichem Timer) | `ops/docker/.env` |
| restic | `restic forget --keep-daily 14 --keep-monthly 6 --prune` | Betreiber des Repositories (der Server schreibt nur, `--append-only`) |
| S3 | Object-Lock-Aufbewahrung plus Lifecycle-Regel (z. B. 180 Tage) | Bucket-Konfiguration |
| Sicherung aus der Oberfläche | Datei der herunterladenden Person | eigenes Löschkonzept der Organisation |

- Werte in das Verzeichnis der Verarbeitungstätigkeiten übernehmen und mit Revision bzw.
  Betriebsrat abstimmen.
- Wird eine ältere Sicherung eingespielt, kehren zwischenzeitlich gelöschte Daten zurück. Löschungen
  nach Art. 17 seit dem Sicherungszeitpunkt danach erneut ausführen; das Systemprotokoll
  (`users.delete`, `privacy.*`) zeigt, welche.

## Auskunft und Datenexport (DSGVO Art. 15 und 20)

- Jede Person: Einstellungen › Datenschutz › „Meine Daten exportieren“ (Passwort, ggf. 2FA).
- Superadmin für eine andere Person (z. B. ohne eigenen Zugang): Benutzerverwaltung › Auskunft
  (Passwort und TOTP).
- Der Export ist eine JSON-Datei mit allen Daten der Person, entschlüsselt: Konto, Einstellungen,
  Gruppen, Abwesenheiten, Sitzungen, Benachrichtigungen, eigene Tickets mit Gesprächsverlauf, eigene
  Nachrichten, Zeiten, persönliche Aufgaben und das eigene Aktivitätsprotokoll. Nicht enthalten sind
  Geheimnisse (Passwort-Hash, TOTP-Geheimnis, Tokens), interne Notizen und Tickets anderer Personen.
- Jeder Export steht im Systemprotokoll (`privacy.export_self`, `privacy.export_subject`).

## Ticket-Sichtbarkeit

Admins sehen eigene, ihnen zugewiesene und beteiligte Tickets sowie Tickets ihrer Gruppe (mit Ober- und
Untergruppen). Tickets ohne Gruppe sehen sie zusätzlich, wenn niemand zugewiesen ist oder die
Kategorie „Allgemein“ lautet. Gruppen sind abgeschottet: ein Ticket der Gruppe „Personal“ sieht
außerhalb dieser Gruppe nur, wer zugewiesen oder beteiligt ist, und Superadmins. Die Prüfung gilt für
jede Route unter `/api/v2/tickets/:id` (Antwort 404), für Benachrichtigungen, Aufgabenlisten und
Berichte.

Zugriffe außerhalb der eigenen Gruppe vor dieser Änderung finden (MariaDB):

```sql
SELECT g.created_at, g.actor_username, g.action, g.target_id
FROM global_audit_log g
JOIN tickets t ON t.id = g.target_id
JOIN users u ON u.id = g.actor_user_id AND u.role = 'admin'
WHERE g.action LIKE 'request:% /api/v2/tickets/:id%'
  AND t.assigned_group_id IS NOT NULL
  AND (t.assigned_to_user_id IS NULL OR t.assigned_to_user_id <> g.actor_user_id)
  AND (t.created_by_user_id IS NULL OR t.created_by_user_id <> g.actor_user_id)
  AND NOT EXISTS (SELECT 1 FROM ticket_participants p WHERE p.ticket_id = t.id AND p.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM user_groups ug WHERE ug.user_id = u.id AND ug.group_id = t.assigned_group_id)
ORDER BY g.created_at DESC;
```

(Ober- und Untergruppen berücksichtigt die Abfrage nicht; Treffer einzeln prüfen.)

## Wiederherstellung

```bash
# Restore-Test (verändert nichts):
bash ops/docker/restore.sh --verify recovery-kit-*.tar.gz.gpg ops/backups/ticket-system-data-*.sql.gz.gpg
# Wiederherstellen auf diesem Server:
bash ops/docker/restore.sh recovery-kit-*.tar.gz.gpg ops/backups/ticket-system-data-*.sql.gz.gpg
bash install.sh
# Neuer, leerer Server: Installer ausführen, dann
bash ops/docker/restore.sh --with-secrets recovery-kit-*.tar.gz.gpg ticket-system-data-*.sql.gz.gpg
bash install.sh
```

Eine ältere Sicherung lässt sich nach einem Update einspielen; der anschließende Installer-Lauf bringt
das Schema auf den aktuellen Stand, ohne Daten zu verlieren. Restore-Test mindestens vierteljährlich
durchführen und dokumentieren.

## Schlüsselrotation

```bash
bash ops/docker/rotate-keys.sh status
bash ops/docker/rotate-keys.sh kek   # KEK möglicherweise offengelegt
bash ops/docker/rotate-keys.sh dek   # DEKs möglicherweise offengelegt
bash ops/docker/backup.sh --recovery-kit
```

Details: [Kryptografie](CRYPTOGRAPHY.md).

## Release erstellen (Maintainer)

Vertrauensanker der Installation ist ein Signaturschlüssel, dessen Fingerabdruck an einer vom
Repository unabhängigen Stelle veröffentlicht ist (z. B. eigene Website).

1. Einmalig: Signaturschlüssel erzeugen (`gpg --quick-gen-key "Name <mail>" ed25519 sign 2y`), dann
   `bash ops/release/create-release.sh init <SCHLÜSSEL-ID>` -- schreibt `ops/release-signing-key.asc`
   (genau ein Schlüssel) und zeigt den Fingerabdruck. Datei committen, Fingerabdruck auf der eigenen
   Website veröffentlichen, Schlüssel auf keys.openpgp.org hochladen, `git config user.signingkey <FPR>`.
2. Je Release: `node ops/create-install-manifest.mjs`, Commit, dann
   `bash ops/release/create-release.sh tag vJJJJ.MM.N`. Das Skript prüft sauberen Stand, Manifest und
   Schlüssel, legt den signierten Tag an und erzeugt unter `release-assets/<version>/` die Assets
   `install.sh`, `install.sh.asc` und `install-manifest.sha256.txt`. Gepusht wird nichts.
3. `git push origin main vJJJJ.MM.N`, GitHub-Release anlegen, die drei Dateien anhängen.

Installation eines Releases: `INSTALL_REF=vJJJJ.MM.N INSTALL_SIGNER_FINGERPRINT=<FPR> bash install.sh`.
Der Installer akzeptiert nur einen Tag, dessen Signatur vom veröffentlichten Hauptschlüssel stammt
(VALIDSIG), und nur eine Schlüsseldatei mit genau diesem einen Schlüssel. Derselbe Schlüssel wird
automatisch für Online-Updates hinterlegt; Updates über die Oberfläche funktionieren damit, sobald
Releases signiert sind.

## Container-Härtung

`app`, `mariadb` und `caddy` laufen ohne Linux-Capabilities (nur die nötigsten werden ergänzt), mit
`no-new-privileges`, Speicher- und CPU-Grenzen; `app` und `caddy` mit nur lesbarem Dateisystem.

Das App-Image enthält nur Laufzeit-Abhängigkeiten (`npm ci --omit=dev`). Der Build-Kontext ist per
`.dockerignore` auf eine Positivliste beschränkt -- Schlüssel, Sicherungen, Kits und `.env`-Dateien
erreichen den Docker-Daemon nie.

### Speicherbedarf

Upload-Abschluss, Typprüfung und Virenscan arbeiten Teilstück für Teilstück (höchstens 8 MB je
Abschluss, zwei gleichzeitig); Sicherung und Wiederherstellung in der Oberfläche halten höchstens die
verschlüsselte Datei (bis 512 MB). Das Speicherlimit von 2 GB der App reicht damit auch bei einem
Upload-Limit von 2000 MB. Für Images einmal `trivy image <image>` oder `grype <image>` auf dem Host
laufen lassen.

## Rate-Limits

Enge Limits (Anmeldung, MFA, Setup, Passwort, Update, Sicherung) zählen in der Datenbank und gelten
über Neustarts hinweg. Das grobe globale Limit gegen Überlastung liegt im Speicher.
