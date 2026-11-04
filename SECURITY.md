# Sicherheit

## Eine Schwachstelle melden

Bitte melde Sicherheitslücken **nicht** über öffentliche Issues, sondern vertraulich:

- über [GitHub Security Advisories](https://github.com/ubodigat/Ticket-System-web/security/advisories/new) („Report a vulnerability“) oder
- per E-Mail an **kontakt@ubodigat.com** (Betreff „Security“).

Hilfreich sind: betroffene Version (Commit oder Release-Tag), Schritte zum Nachstellen, erwartete
und tatsächliche Wirkung und, falls vorhanden, ein Vorschlag zur Behebung.

| Schritt | Ziel |
| --- | --- |
| Eingangsbestätigung | innerhalb von 3 Werktagen |
| Erste Einschätzung (Schweregrad, betroffene Versionen) | innerhalb von 10 Werktagen |
| Behebung kritischer und hoher Lücken | so schnell wie möglich, in der Regel innerhalb von 30 Tagen |
| Veröffentlichung | nach verfügbarer Korrektur, abgestimmt mit der meldenden Person |

Wer verantwortungsvoll meldet, wird auf Wunsch in `CONTRIBUTORS.md` genannt.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für den jeweils neuesten signierten Release-Tag und für `main`.
Installationen sollten über das Online-Update oder den Installer aktuell gehalten werden.

## Weiterführende Dokumente

- [Bedrohungsmodell](docs/THREAT_MODEL.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Kryptografie und Schlüsselverwaltung](docs/CRYPTOGRAPHY.md)
- [Betrieb: Update, Sicherung, Wiederherstellung, Schlüsselrotation](docs/OPERATIONS.md)
