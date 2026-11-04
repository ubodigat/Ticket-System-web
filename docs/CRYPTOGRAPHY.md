# Kryptografie und Schlüsselverwaltung

## Überblick

```
KEK-Schlüsselbund (ops/secrets/app.kek, "<version>:<base64>" je Zeile)
  └─ umhüllt (AES-256-GCM, AAD = Zweck + DEK-Version) ─▶ DEKs je Zweck (data_encryption_keys)
        └─ verschlüsseln (AES-256-GCM, AAD = Installation, Tabelle, Datensatz, Feld, Format, Version) ─▶ Felder
```

- **KEK** (Key Encryption Key): liegt nur als Datei auf dem Server (Rechte 0400/0600) und im
  Wiederherstellungs-Kit. Mehrere Versionen gleichzeitig möglich; die höchste ist die aktuelle.
- **DEK** (Data Encryption Key): je Zweck (z. B. `users.email`, `tickets.description`) mehrere
  Versionen, genau eine aktiv. Ältere Versionen bleiben gespeichert, bis die Neuverschlüsselung
  abgeschlossen ist.
- **Blind-Index** für die E-Mail-Suche: HMAC-SHA256 mit einem eigenen Schlüssel
  (`blind-index.users.email`). Suchen prüfen alle Schlüsselversionen.

## Feldformat (Version 1)

```
format (1 Byte = 0x01) | key_version (4 Byte, big endian) | iv (12 Byte) | ciphertext | tag (16 Byte)
```

AAD: `installation_id ␟ tabelle ␟ datensatz ␟ feld ␟ f<format> ␟ key_version`. Kopfdaten sind damit
authentifiziert; ein Wert ist nur an genau seiner Stelle gültig. Werte im früheren Format ohne Kopf
werden weiterhin gelesen und vom Wartungsjob schrittweise ins aktuelle Format gebracht.

## DEK-Umhüllung

`iv | tag | ciphertext`, AES-256-GCM mit der aktuellen KEK. AAD: `dek ␟ zweck ␟ version`
(`wrap_format = 1`). Eine umkopierte Zeile lässt sich nicht als DEK eines anderen Zwecks verwenden.

## Abgeleitete Schlüssel

Kurzlebige Tokens (Office-Quelltoken, MFA-Zwischentoken, Pseudo-Konten der Anmeldedrosselung)
nutzen je Zweck einen per HKDF-SHA256 aus `COOKIE_SECRET` abgeleiteten Schlüssel
(`crypto/derivedKeys.ts`).

## Rotation

| Anlass | Befehl (im App-Container, siehe [Betrieb](OPERATIONS.md)) |
| --- | --- |
| KEK möglicherweise offengelegt | `bash ops/docker/rotate-keys.sh kek` – neue KEK, alle DEKs neu umhüllt, alte KEK danach entfernt |
| DEKs möglicherweise offengelegt | `bash ops/docker/rotate-keys.sh dek` – neue DEK-Versionen, Neuverschlüsselung aller Werte, alte Versionen danach entfernt |
| Status | `node dist/cli/keys.js status` |

Die Neuverschlüsselung ist fortsetzbar (`crypto_jobs`). Werte, die sich nicht entschlüsseln lassen,
werden gemeldet und nie überschrieben; alte Schlüsselversionen bleiben dann erhalten.

## Daten auf der Festplatte

MariaDB verschlüsselt Tabellen, Redo-/Undo-Logs, temporäre Dateien, Aria-Tabellen und das Binlog
(`file_key_management`, Schlüssel in `ops/secrets/mariadb-encryption`). Nachweis:
`ops/tests/mariadb-encryption-at-rest.sh`.

## Sicherungen

Datensicherungen sind asymmetrisch (OpenPGP) verschlüsselt; der private Schlüssel liegt nur im
Wiederherstellungs-Kit. Sicherungen enthalten weder KEK noch `.env`.

## Transport

HTTPS über Caddy (HSTS ohne `preload`), TLS zwischen App und MariaDB mit Zertifikatsprüfung.
