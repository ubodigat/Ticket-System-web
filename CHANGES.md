# Änderungen und Herkunft (CPAL 3.3)

## 2026-10-10 - Sicherheitsaudit: gespeicherte XSS über Anhänge, zeitunabhängiger Token-Vergleich, verzögerte Rollen-/Sperrwirkung
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: gezielte Aufforderung, alle Sicherheitslücken sofort zu beheben. Gefunden und behoben:
  - **Gespeicherte XSS über Anhänge (hoch):** `image/svg+xml` und `text/html`/`.htm`/`.xhtml`
    waren nicht in der Blockliste für Anhang-Uploads. Eine hochgeladene SVG-Datei mit
    eingebettetem `<script>` führte beim Öffnen über "In neuem Tab öffnen" (eine `blob:`-URL mit
    dem vom Client beim Upload angegebenen MIME-Typ) zur Ausführung im Ursprung der Anwendung,
    same-origin mit der Sitzung der öffnenden Person. Fix:
    `apps/server/src/http/routes/extras.ts` -- `image/svg+xml` zur `blockedMime`-Liste,
    `.svg`/`.svgz`/`.htm`/`.xhtml` zur `blockedExtensions`-Liste hinzugefügt.
  - **Zeitbasierter Seitenkanal beim Update-Token (niedrig):** `ops/docker/updater-server.mjs`
    verglich den Bearer-Token mit `!==`, was bei jedem abweichenden Byte sofort abbricht und
    dadurch (schwach) Rückschlüsse über das Netzwerk erlaubt. Fix: Vergleich über
    `crypto.timingSafeEqual` (`safeTokenEquals`).
  - **Rollen-/Sperr-/Archivierungsänderungen griffen erst nach Ablauf des Sitzungs-Cookies
    (mittel):** Rolle, Sperr- und Archivstatus standen nur im signierten, bis zu 8 Stunden
    gültigen Sitzungs-Cookie und wurden nie erneut gegen die Datenbank geprüft. Eine Degradierung,
    Sperrung oder Archivierung eines Admin-/Superadmin-Kontos griff dadurch erst nach Ablauf oder
    erneutem Login, nicht sofort. Fix: `apps/server/src/http/app.ts` prüft jetzt bei jeder
    authentifizierten Anfrage per `onRequest`-Hook den aktuellen Datenbankstand (Rolle,
    `account_archived`, `locked_until`/`locked_permanent`) und verwirft die Sitzung sofort bei
    Abweichung; `apps/server/src/http/routes/session.ts`s `getSession` liest nur noch dieses
    bereits geprüfte Ergebnis (`req.ticketSession`).
- Das als weiterhin akzeptiertes Restrisiko dokumentierte, nicht geänderte Verhalten: der
  Selbst-Update-Mechanismus (`apps/server/src/http/routes/update.ts`,
  `ops/docker/updater-server.mjs`) führt bei Auslösung durch eine Superadmin-Person
  `git reset --hard origin/main` gefolgt von einem Docker-Rebuild mit Zugriff auf
  `/var/run/docker.sock` aus -- das ist für ein Selbst-Update-Feature architekturbedingt so
  (volles Vertrauen in die Integrität des konfigurierten Git-Ursprungs), siehe README.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - "Ticket-Ersteller archiviert"-Hinweis ging beim Speichern verloren
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Fortsetzung der Prüfung auf vollständige Funktionsgleichheit mit der lokalen Version vom
  07.10.2026: `AdminBoard.applyArchiveConsequences` setzte `t.authorArchived` lokal auf dem
  JS-Objekt und rief danach `Store.saveTickets()` auf -- das Feld stand aber nicht in dessen
  Diff-Whitelist und hatte auch keine Datenbankspalte, wurde also nie tatsächlich gespeichert.
  Das Chat-Eingabefeld-Sperren für archivierte Ersteller und der "Ticket-Ersteller archiviert"-
  Hinweisdialog hätten dadurch nach einem Neuladen nie mehr funktioniert.
- Lösung: statt eines mitgeschriebenen Felds wird `authorArchived` jetzt live aus dem aktuellen
  Account-Status (`users.account_archived`) des Erstellers abgeleitet -- kann dadurch nie wieder
  stumm verloren gehen.
  - `apps/server/src/http/routes/tickets.ts`: `GET /api/v2/tickets` liefert `author_archived` als
    korrelierte Unterabfrage mit; `GET /api/v2/tickets/:id` ergänzt es per Nachschlag.
  - `js/store.js` (`mapApiTicketToLegacy`): `authorArchived` aus `t.author_archived`.
  - `js/admin-board.js`: `applyArchiveConsequences` mutiert `t.authorArchived` nicht mehr lokal
    (reine Zähllogik fürs Protokoll bleibt).
  - Neues Problem dabei gefunden und mitbehoben: die "Weiter bearbeiten"-Entscheidung im
    Hinweisdialog (`openArchivedAuthorDecisions`) hätte ohne eigene Bestätigungs-Speicherung bei
    jedem erneuten Laden wieder aufpoppen müssen, da der jetzt live abgeleitete
    `authorArchived`-Status sich durch die Entscheidung selbst nicht ändert. Dafür neue,
    tatsächlich persistierte Spalte `archived_author_ack`
    (`apps/server/src/db/migrations/0022_ticket_archived_author_ack.ts`), die bei Reaktivierung
    des Erstellers automatisch zurückgesetzt wird.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Abwesenheits-/Vertretungs-Workflow war für andere Personen komplett wirkungslos
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Schwerster bisher gefundener Befund in dieser Prüfreihe: `js/store.js`s `mapApiUserToLegacy`
  setzte `absence` hart auf `null` -- Abwesenheits-Badges in der Benutzerverwaltung, das eigene
  "Ich bin abwesend"-Häkchen und die Abwesenheits-Übersicht zeigten nie den echten Stand.
  Schwerwiegender: `AdminBoard.setAbsence`/`endAbsence`/`returnTickets` im Frontend mutierten
  nur ein lokales JS-Objekt (`target.absence = {...}`) und "speicherten" es über
  `Store.saveUsers`, dessen Diff-Logik das `absence`-Feld gar nicht kennt -- eine von einem
  Admin für eine ANDERE Person gesetzte Abwesenheit wurde dadurch **nie tatsächlich in der
  Datenbank gespeichert**, obwohl die Oberfläche Erfolg meldete. Der serverseitige
  Self-Service-Endpunkt (`POST /api/v2/users/me/absence`) existierte zwar bereits und
  funktionierte für die eigene Abwesenheit, aber nicht für von einem Admin für andere Personen
  gesetzte.
- Geänderte/neue Dateien:
  - `apps/server/src/http/routes/users.ts`: Logik in `applyUserAbsence()` extrahiert; neuer
    Endpunkt `POST /api/v2/users/:id/absence` (Admin setzt Abwesenheit einer anderen Person);
    neuer Endpunkt `GET /api/v2/users/:id/absence/transferred-tickets` (aus dem Audit-Log
    abgeleitet, ersetzt die frühere, im normalisierten Schema nicht mehr vorhandene
    `returnPending`-Liste auf dem Benutzerobjekt); `GET /api/v2/users` und `/users/me` liefern
    jetzt die aktuell laufende/geplante Abwesenheit korreliert mit.
  - `js/store.js`: `absence` korrekt zugeordnet (statt `null`); neue Methoden
    `setUserAbsence`/`getTransferredTickets`.
  - `js/admin-board.js`: `setAbsence`, `endAbsence`, `returnTickets`, `openAbsenceReturnPopup`
    rufen jetzt die echten Endpunkte auf, statt ein nie persistiertes lokales Objekt zu
    mutieren. `renderAbsenceBanner`, `openAbsenceOverview`, `openSubstituteNoticePopups`
    brauchten keine Änderung -- sie lasen bereits korrekt aus `u.absence`, bekamen durch den
    Mapping-Fix automatisch echte Daten.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Kanban-Karten zeigten Chat-/Notiz-/Teilaufgaben-Anzahl und Antwortstatus nie
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Fortsetzung der Prüfung auf vollständige Funktionsgleichheit mit der lokalen Version vom
  07.10.2026: Die Kanban-Karten im Admin-Board lasen `t.chat`, `t.comments`, `t.todos` und
  `t.attachments` direkt vom Ticket-Objekt der Listen-API -- die sind dort seit der
  Normalisierung in eigene Tabellen aber absichtlich immer leer (echte Inhalte lädt erst die
  Detailansicht je Ticket nach). Dadurch zeigten alle Karten dauerhaft "0" Nachrichten/Notizen/
  Anhänge, "0/0" Teilaufgaben, und das "wartet auf Antwort"-Symbol erschien nie, unabhängig vom
  tatsächlichen Stand.
- Geänderte Dateien:
  - `apps/server/src/http/routes/tickets.ts`: `GET /api/v2/tickets` liefert jetzt pro Ticket
    echte, korrelierte Zählungen (`message_count`, `note_count`, `todo_count`,
    `todo_done_count`, `attachment_count`) sowie `last_message_role` (für "wartet auf
    Antwort") direkt aus der Datenbank mit, ohne die vollen Inhalte zu laden.
  - `js/store.js` (`mapApiTicketToLegacy`): neue Felder `chatCount`/`noteCount`/`todoTotal`/
    `todoDone`/`attachmentCount`/`awaitingReply` zugeordnet.
  - `js/admin-board.js` (`AdminBoard.render` → `createCard`): nutzt diese echten Zahlen statt
    `.length` auf den (immer leeren) Arrays.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Vier weitere, teils schwerwiegende Funktionslücken behoben
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: gezielte Nachfrage, ob die Serverversion wirklich vollständig der lokalen Version vom
  07.10.2026 entspricht. Dabei gefunden und behoben:
  - **Ticketnummern ignorierten die Konfiguration komplett** (`apps/server/src/http/routes/
    tickets.ts`): Die Nummer war hart auf `String(n).padStart(5,'0')` fest codiert -- Präfix,
    Stellenzahl, eigenes Format und Kategorie-Formate aus den Systemeinstellungen hatten
    überhaupt keine Wirkung, jedes Ticket bekam unabhängig von der Konfiguration z. B. "00001"
    statt "TS-00001". Logik in ein neues, getestetes Modul `apps/server/src/domain/
    ticketNumber.ts` ausgelagert (6 neue Tests in `test/ticketNumber.test.ts`), Format-Vorlage
    und Kategorie-Format-Editor in den Systemeinstellungen ergänzt.
  - **Admins (nicht Superadmin) sahen zentrale Funktionen nie**: `AdminBoard.can()` prüfte ein
    `user.permissions`-Objekt, das es im aktuellen, vereinfachten Rollenmodell gar nicht mehr
    gibt (siehe README "Granulare Einzelrechte... bewusst nicht nachgebaut") -- dadurch waren
    die Menüpunkte Textbausteine, Wissensdatenbank, Auswertung, Genehmigungen und
    Wiederkehrende Tickets für jede Person außer Superadmin unsichtbar, obwohl die Funktionen
    selbst vollständig funktionieren. Auf eine einfache Rollenprüfung (admin/superadmin)
    vereinfacht, wie bei jeder anderen Admin-Funktion in diesem Board.
  - **Auswertung (Reports) zeigte Bearbeitungszeiten immer leer**: Die Berechnung suchte im
    (aus der Listenansicht absichtlich immer leeren) `ticket.logs`-Array nach einem
    "Geschlossen"-Eintrag. Die serverseitig echte `closed_at`-Spalte wurde nie bis zum
    Frontend durchgereicht (`Store.mapApiTicketToLegacy`). Jetzt verbunden.
  - **Bekannte, bewusst nicht behobene Einschränkung:** Die "Erste Antwortzeit" in derselben
    Auswertung bleibt leer, weil sie Chat-Nachrichten bräuchte, die `Store.getTickets()` aus
    Performance-Gründen nicht mitliefert (Chat ist pro Ticket eine eigene Ressource). Eine
    korrekte Berechnung bräuchte entweder einen neuen Server-Aggregations-Endpunkt oder einen
    Einzelabruf pro Ticket im Zeitraum (N+1) -- zu riskant für eine Spontan-Änderung, siehe
    README für den aktuellen Stand.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Systemeinstellungen an lokale Version angeglichen, Ladezeit verbessert
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: Vergleich mit der lokalen Version vom 07.10.2026 zeigte mehrere Lücken in den
  Systemeinstellungen sowie spürbar langsames Laden der Admin-/Dashboard-Seiten.
- Geänderte Dateien und Funktionen:
  - Geschäftszeiten für Fristen: individuelle Zeiten je Wochentag und Feiertage waren im
    Frontend (`js/store.js` `Store.addBusinessMs`) und per CSS bereits vorbereitet, aber ohne
    Bedienelemente in den Systemeinstellungen und ohne serverseitige Berechnung. Jetzt in
    `js/admin-board.js` (Allgemein-Tab), `apps/server/src/http/routes/settings.ts`
    (`businessHours.perDay`/`.holidays`) und `apps/server/src/domain/sla.ts` (maßgebliche
    Fristberechnung bei Ticket-Erstellung) durchgängig umgesetzt, inkl. zwei neuer Tests in
    `test/sla.test.ts`.
  - Dabei gefundener Fehler: Geschäftszeiten ließen sich nach dem ersten Aktivieren nie wieder
    deaktivieren, weil `businessHours.enabled` beim Deaktivieren gar nicht erst mitgeschickt
    wurde und `PATCH /settings` bestehende Werte nur ergänzt statt ersetzt.
  - "Frist auch Benutzern anzeigen", Lösungsfrist-Einheit (Stunden/Tage) und Standard-Priorität
    für neue Tickets: zugehörige Hilfsfunktionen (`setSlaField`/`getSlaField`) existierten
    bereits, aber ohne passende Eingabefelder -- ergänzt.
  - Benachrichtigungen: Der Tab zeigte eine einfache Checkliste, deren Werte nirgends
    ausgewertet wurden (nicht einmal die alte lokale Version hatte das, siehe unten). Ersetzt
    durch die bereits vorhandene, aber nie eingebundene Richtlinien-Matrix je Ereignis und
    Rolle (`AdminBoard.renderNotifMatrix`/`readNotifMatrix`, `Store.resolveNotifPref`), die
    tatsächlich in Benachrichtigungen/E-Mail-Versand einfließt.
  - `apps/server/src/http/routes/settings.ts`: Schema entsprechend erweitert
    (`showSlaToUsers`, `defaultPrio`, `notifPolicy`, `businessHours.enabled/perDay/holidays`).
  - Ladezeit: `lucide.min.js`/`dompurify.min.js` luden ohne `defer` blockierend im `<head>`,
    zusammen mit `mammoth.browser.min.js`/`xlsx.full.min.js`/`jszip.min.js` (insgesamt
    >2 MB) auf JEDEM Seitenaufruf, obwohl die drei letzteren nur für die seltene
    Office-Dateivorschau gebraucht werden. `defer` ergänzt; die drei großen Bibliotheken werden
    jetzt erst beim tatsächlichen Öffnen einer .docx/.xlsx/.pptx-Vorschau nachgeladen
    (`Utils.loadVendorScript` in `js/utils.js`, genutzt in `js/admin-board.js`
    `openAttachmentPreview`). Das war die Hauptursache für spürbar verzögert erscheinende
    Icons.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Selbst-Update-Funktion in den Systemeinstellungen
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Geänderte/neue Dateien und Funktionen:
  - Neuer Tab "Update" in den Systemeinstellungen (nur Superadmin, `js/admin-board.js`): zeigt
    lokalen Versionsstand gegen GitHub und startet das Update per Knopfdruck.
  - Neu: `apps/server/src/http/routes/update.ts` -- proxyt `/api/v2/update/status` und
    `/api/v2/update/run` (nur Superadmin) zu einem internen Updater-Sidecar.
  - Neu: `ops/docker/Dockerfile.updater`, `ops/docker/updater-server.mjs` -- eigener Container
    mit Zugriff auf Docker-Socket und Repo-Checkout, führt `git fetch`/`reset --hard`,
    `docker compose build/up` und die Migrationen aus.
  - `apps/server/src/config/env.ts`: `UPDATE_SERVICE_URL`/`UPDATE_TOKEN` (optional) ergänzt.
  - `ops/docker/docker-compose.yml`, `install.sh`: `updater`-Service verdrahtet, `UPDATE_TOKEN`
    wird vom Installer erzeugt (auch nachträglich für bestehende Installationen).
  - Beim Fertigstellen gefundene und behobene Bugs aus einer unterbrochenen Vorarbeit:
    das `updater`-Netz war `internal: true` und hätte GitHub nie erreichen können (eigenes
    `egress`-Netz ergänzt); `git`-Operationen auf dem Host-gemounteten Repo scheiterten ohne
    `safe.directory`-Konfiguration ("dubious ownership"); `git pull --ff-only` durch
    `fetch` + `reset --hard` ersetzt (robuster für eine Installation, die nie von Hand
    bearbeitet wird); fehlende `ca-certificates` im Updater-Image (TLS zu GitHub);
    CSS nutzte die nicht existierenden Variablen `--panel`/`--muted` statt `--card-bg`/
    `--text-sec`; CSS-Klasse `callout danger` statt der im Design-System üblichen
    `callout-danger`; kein automatisches Nachladen des Update-Fortschritts während ein
    `docker build --no-cache` mehrere Minuten läuft.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Modulaufteilung von script.js, Backup/Restore, SLA-/Rechte-Tests
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Geänderte Dateien und Funktionen:
  - `script.js` (10.600+ Zeilen) in native ES-Module unter `js/` aufgeteilt (`utils.js`,
    `lang.js`, `store.js`, `log-diff.js`, `auth.js`, `ui.js`, `settings.js`, `user-dash.js`,
    `ticket-helpers.js`, `admin-board.js`, `context-menu.js`); `script.js` ist jetzt nur noch
    der ~195-zeilige Einstiegspunkt. Kein Bundler, native `<script type="module">`.
  - Dabei entdeckter und behobener Fehler: `Store.init()` rief `Store.syncSessionUser(...)`
    auf, das nirgends definiert war -- ein unbehandelter `TypeError` bei jedem Seitenaufruf
    einer angemeldeten Person im Serverbetrieb. Jetzt in `js/store.js` definiert.
  - `apps/server/src/http/routes/staticAssets.ts`: Allowlist um alle `/js/*.js`-Pfade erweitert.
  - `index.html`, `dashboard.html`, `admin.html`: `<script>`-Tag auf `type="module"` umgestellt.
  - Neu: `apps/server/src/domain/sla.ts` (serverseitige SLA-Fristberechnung, Geschäftszeiten)
    und `apps/server/src/domain/status.ts` (Ticket-Status-Validierung) inkl. Tests
    (`test/sla.test.ts`, `test/status.test.ts`, `test/session.test.ts`).
  - Neu: `ops/docker/backup.sh` / `ops/docker/restore.sh` (verschlüsseltes Backup/Restore von
    Datenbank, Schlüssel und TLS-Zertifikaten).
  - `apps/server/src/mail/mailer.ts`: `requireTLS: true` für STARTTLS ergänzt -- ohne diese
    Option hätte nodemailer bei einem SMTP-Server ohne STARTTLS-Unterstützung stillschweigend
    unverschlüsselt versendet (Verstoß gegen die Anforderung "E-Mail verschlüsselt").
  - CodeQL-Fund (Insecure randomness, `js/insecure-randomness`): `js/store.js` erzeugte das
    Fallback-Passwort neuer Benutzer mit `Utils.uid()` (`Math.random()`), vorhersagbar für
    Angreifer (CWE-338). Neue Funktion `Utils.secureToken()` in `js/utils.js` auf Basis von
    `crypto.getRandomValues()`, nur für diesen sicherheitsrelevanten Fall verwendet.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-09 - Geplante lokale Lizenzumstellung
- Originalentwickler: U:Bodigat
- Originalprojekt: https://github.com/ubodigat/Ticket-System-web
- Vorgesehen: CPAL-1.0 mit Exhibit-B-Attribution; UI-Hinweise ergänzt
- Kein automatischer Commit und kein Upload

## Vorlage für weitere Änderungen
- Datum:
- Verantwortliche Person / Organisation:
- Welche Dateien und Funktionen wurden geändert:
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version:
