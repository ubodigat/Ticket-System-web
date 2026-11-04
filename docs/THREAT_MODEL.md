# Bedrohungsmodell

Stand: 11/2026. Dieses Dokument beschreibt, wovor Ticket-System-web schützt, welche Annahmen dabei
gelten und wo die Grenzen liegen. Es wird bei jeder sicherheitsrelevanten Änderung mitgepflegt.

## 1. Schutzgüter

| Schutzgut | Beispiele | Schutzziel |
| --- | --- | --- |
| Ticketinhalte | Beschreibungen, Nachrichten, interne Notizen, Lösungen, Anhänge | Vertraulichkeit, Integrität |
| Personenbezogene Daten | Name, E-Mail, Telefon, Profil, Arbeitszeiten, Profilbild | Vertraulichkeit (DSGVO) |
| Zugangsdaten | Passwort-Hashes, TOTP-Geheimnisse, Passkeys, Sitzungen | Vertraulichkeit, Integrität |
| Integrationsgeheimnisse | SMTP-, LDAP-, Outlook-Zugangsdaten, Refresh-Tokens | Vertraulichkeit |
| Schlüsselmaterial | KEK, DEKs, Schlüssel der Dateiverschlüsselung, Sicherungsschlüssel | Vertraulichkeit, Verfügbarkeit |
| Protokolle | Systemprotokoll, Ticketverlauf | Integrität, Nachvollziehbarkeit |

## 2. Angreifer

1. **Anonym aus dem Internet**: Anmeldeversuche, Kontoanfragen, Ausnutzung von Eingaben.
2. **Angemeldete Person mit geringen Rechten**: versucht, fremde Tickets oder Daten zu sehen oder sich mehr Rechte zu verschaffen.
3. **Admin mit Teilrechten**: versucht, sich Rechte anderer Admins oder eines Superadmins anzueignen.
4. **Gestohlene Sitzung** (z. B. durch Schadsoftware auf einem Arbeitsplatz).
5. **Zugriff auf Datenträger oder Sicherungen** (gestohlene Platte, offen liegende Sicherung).
6. **Kompromittierte Lieferkette** (Abhängigkeiten, Container-Images, Repository).

Nicht abgedeckt: ein Angreifer mit dauerhaftem Root-Zugriff auf den laufenden Server. Er kann den
Arbeitsspeicher der App lesen und damit entschlüsselte Daten sehen.

## 3. Maßnahmen je Angreifer

| Angreifer | Maßnahmen |
| --- | --- |
| 1 | Argon2id, Anmeldedrosselung in der Datenbank, persistente Rate-Limits für Anmeldung/MFA/Setup, CSRF-Schutz, strikte CSP ohne `unsafe-inline`, serverseitige Validierung (zod), Bereinigung von Rich-Text |
| 2 | Rechteprüfung ausschließlich serverseitig (`domain/ticketAccess.ts`, Hooks in `app.ts`), Anhänge nur mit Ticketzugriff, Verwandte Tickets nur bei Zugriff sichtbar |
| 3 | Nur Superadmins vergeben Rollen und Zusatzrechte; Admins mit „Benutzerverwaltung“ verwalten nur Konten der Rolle „Benutzer“ (`users.ts`, `grantsPrivileges`); Step-up (Passwort + zweiter Faktor) vor Update, Rollback, Sicherung und Wiederherstellung |
| 4 | Widerrufbare, serverseitige Sitzungen mit Leerlauf- und Gesamtablauf, Zwei-Faktor-Pflicht für Admin-Konten (Standard neuer Installationen), Step-up für folgenreiche Aktionen |
| 5 | Feldverschlüsselung (AES-256-GCM, siehe [Kryptografie](CRYPTOGRAPHY.md)), Dateiverschlüsselung von MariaDB (Tabellen, Logs, temporäre Dateien), asymmetrisch verschlüsselte Datensicherungen ohne Schlüsselmaterial, KEK nur im Wiederherstellungs-Kit |
| 6 | Auf Digest gepinnte Images, auf Commit-SHA gepinnte Actions, Installationsmanifest mit Hash, signierte Release-Tags mit unabhängig veröffentlichtem Fingerabdruck, signierte Commits für das Online-Update, `npm audit` und OSV-Scan in der CI |

## 4. Annahmen

- TLS wird von Caddy beendet; zwischen App und MariaDB ist TLS Pflicht.
- Genau eine App-Instanz läuft (In-Prozess-Wartungsjobs, globales Grob-Rate-Limit im Speicher).
- Betreiber bewahren Wiederherstellungs-Kit und Passphrase getrennt und außerhalb des Servers auf.

## 5. Bekannte Grenzen

- Das globale Grob-Limit (1000 Anfragen/Minute je Adresse) liegt im Speicher und beginnt bei einem
  Neustart neu. Alle engen, sicherheitsrelevanten Limits liegen in der Datenbank.
- Große Anhänge werden zur abschließenden Prüfung vollständig im Arbeitsspeicher gehalten.
- Mehrmandantenfähigkeit mit strikter Trennung ist nicht vorgesehen.

## 6. Prüfungen

Jede Änderung durchläuft in der CI: Typprüfung, Unit-Tests, Installer- und Sicherungstests,
MariaDB-Integration (UTC und Europe/Berlin), Nachweis der Dateiverschlüsselung, Manifestprüfung.

## 7. Abhängigkeiten

`npm audit --audit-level=high` und der OSV-Scan müssen ohne Befund durchlaufen. Dependabot prüft
npm, Docker-Images und GitHub Actions regelmäßig.
