# Datenschutz und Verschlüsselungsumfang

Stand: 05.11.2026. Ausgangspunkt ist eine Neuinstallation mit dem ausgelieferten Docker-Compose-Stack.
Dieses Dokument beschreibt technische Maßnahmen und offene Betreiberentscheidungen. Es ist keine
Zertifizierung und keine Zusicherung einer weltweit oder branchenübergreifend zulässigen Verarbeitung.

## Technischer Schutz

| Daten / Speicherort | Umsetzung | Grenze |
| --- | --- | --- |
| Tickettexte, Nachrichten, Wissensartikel, Anhänge, Name/E-Mail, Profile, Präferenzen, Integrationsgeheimnisse | Feldverschlüsselung AES-256-GCM; Zwecke und Spalten in `apps/server/src/crypto/rotation.ts` | Berechtigte Funktionen entschlüsseln im Arbeitsspeicher |
| Datenbank-Metadaten, nicht einzeln verschlüsselte Felder und Indizes | MariaDB-Dateiverschlüsselung für Anwendungsdaten mit `innodb_encrypt_tables=FORCE`, verschlüsselten Logs und temporären Daten; `ops/docker/mariadb/conf.d/encryption.cnf` | Kein Schutz vor Root auf dem laufenden Server oder Zugriff auf Schlüssel und Daten zusammen |
| Eigene Todo-Tätigkeitsnotizen | Verschlüsselte Zeiteinträge; Schlüsselrotation und persönlicher Datenexport umfassen die neue Tabelle | Zugeordnete Teilaufgaben buchen weiterhin in das Ticket |
| Kennwörter | Argon2id-Hash statt wiederherstellbarer Speicherung | Für selbst gewählte Kennwörter gelten die konfigurierten Anforderungen |
| Browser, Datenbank, SMTP, LDAP | HTTPS; Datenbank-TLS mit Zertifikatsprüfung; SMTP-TLS verpflichtend; LDAP nur über LDAPS | Interne CA muss auf Endgeräten vertrauenswürdig eingerichtet werden; Anbieter/Netzkonfiguration bleiben Betreiberaufgabe |
| Datensicherungen | OpenPGP-verschlüsselte Sicherungen; standardmäßig 14 lokale Sicherungen, über `BACKUP_KEEP_LOCAL` anpassbar | Externe Kopien, Herausgabe und Löschung sind getrennt zu verwalten |
| Diagnoseprotokolle | Keine Query-Strings, Cookies oder Auth-Header im Request-Serializer; Fehlertexte/SQL werden durch Fehlerklasse, Code und Aufrufstellen ersetzt; Kontoidentifikatoren redigiert | Kein Vollverschlüsselungsversprechen für sämtliche Host-, Docker- oder Fremddienstprotokolle |
| Docker-Diagnosen | Lokaler Logging-Treiber mit Rotation: je Dienst maximal drei Dateien à 10 MB | Größenrotation ist keine zeitgesteuerte Löschfrist |

Für Host-Dateien außerhalb der Datenbank, Protokolle, Schlüssel, Swap und externe Sicherungen ist
zusätzlich eine geeignete Verschlüsselung der Host-Datenträger erforderlich. Der Installer richtet
keine Festplattenverschlüsselung ein. `/tmp` der App ist ein flüchtiges tmpfs; dessen Schutz vor
Auslagerung hängt von der Host-/Swap-Konfiguration ab. Bereits heruntergeladene Exporte, Druckdateien
und E-Mails unterliegen der Schutzverantwortung ihrer Empfänger. Dies ist keine Ende-zu-Ende-Verschlüsselung.

## Auskunft, Zugriff und Aufbewahrung

- Serverrechte begrenzen Ticket-, Anhangs- und Kontaktzugriff. Export fremder Personen nur durch
  Superadmins mit erneuter Authentifizierung/MFA; eigene Auskunft ebenfalls mit Identitätsprüfung.
- Der persönliche Export enthält eigene Todo-Zeiten, aber keine Zugangsschlüssel oder Zeiten anderer
  Personen. Der Export ist entschlüsselt und muss nach dem Herunterladen entsprechend geschützt werden.
- Wartungsjobs löschen Request-Protokolle nach 90 Tagen und übrige Audit-/Ticket-Aktivitätsprotokolle
  nach 365 Tagen. IP-Adressen in Audit-Details werden nach 30 Tagen entfernt; abgelaufene Sitzungen
  werden nach weiteren 30 Tagen entfernt (`jobs/maintenance.ts`). Das sind technische Standardwerte,
  keine für jeden Einsatzzweck rechtlich gerechtfertigten Fristen.
- Archivieren ist kein Löschen. Es gibt keine universelle automatische Löschung aller Ticket- und
  Beschäftigtendaten. Der Betreiber muss Zweck, Aufbewahrung, Löschung und Wiederherstellung aus
  Sicherungen fallbezogen regeln. Exporte können bei mehr als 10.000 Datensätzen je Abschnitt gekürzt
  sein; die Antwort kennzeichnet dies und muss bei Auskunftsersuchen auf Vollständigkeit geprüft werden.

## Vor einem produktiven Einsatz festlegen

Die DSGVO verlangt unter anderem eine Rechtsgrundlage, Datenminimierung, transparente Informationen,
angemessene Aufbewahrung und risikogerechte technische und organisatorische Maßnahmen. Verschlüsselung
allein erfüllt diese Anforderungen nicht. Maßgeblich sind insbesondere Art. 5, 6, 13/14, 15–22, 25 und 32
der [DSGVO](https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu).

Der Betreiber muss Verantwortlichen/Kontakt, Zwecke und Rechtsgrundlagen, Empfänger/Dienstleister,
Fristen und Rechteverfahren dokumentieren und den Betroffenen bereitstellen. Auftragsverarbeitung,
Drittlandtransfers, besondere Datenkategorien, Beschäftigten- und behördliche Daten können zusätzliche
Prüfungen erfordern. Ein einziges „strengstes“ Profil kann kollidierende Aufbewahrungs- und Löschpflichten
nicht entscheiden. Für Deutschland sind gegebenenfalls das [BDSG](https://www.gesetze-im-internet.de/bdsg_2018/)
und bereichsspezifische Regeln zu berücksichtigen. Hinweise zur Rollenverteilung liefert der
[Europäische Datenschutzausschuss](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_de).

Vorhandene technische Funktionen ersetzen weder den Nachweis der gewählten Rechtsgrundlage noch
Verarbeitungsverzeichnis, geeignete Verträge, ein Löschkonzept und gegebenenfalls eine
Datenschutz-Folgenabschätzung. Open Source ändert diese Anforderungen nicht.

## Prüfgrenze

Automatisierte Tests prüfen Export-Isolation, Entschlüsselung, Berechtigungen und das Ausblenden von
Geheimnissen in Diagnoseobjekten. `ops/tests/mariadb-encryption-at-rest.sh` ist für den echten
Datenträgerverschlüsselungsnachweis in CI vorgesehen. In diesem lokalen Lauf wurden weder Docker
noch MariaDB installiert und weder der Host-Datenträger noch externe Anbieter geprüft.
