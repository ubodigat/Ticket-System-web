# Änderungen und Herkunft (CPAL 3.3)

## 2026-10-11 - Update-Status-Abfrage ohne Zeitlimit: haengender "git fetch" fuehrte zu 502 Bad Gateway
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Befund (vom Nutzer gemeldet): `GET /api/v2/update/status` antwortete mit 502 Bad Gateway,
  obwohl der App-Container lief -- "Updater ist nicht erreichbar oder nicht konfiguriert"
  erschien dadurch auch dann, wenn er es war.
- Ursache: `collectStatus()` im Updater-Sidecar (`ops/docker/updater-server.mjs`) fuehrt bei
  JEDER Status-Abfrage einen echten `git fetch` gegen GitHub aus, bisher ganz ohne Zeitlimit.
  Haengt dieser eine Netzwerkaufruf (instabiles/langsames Internet zum GitHub-Host), haengt die
  gesamte Anfrage -- und Caddy wartet nicht unbegrenzt auf eine Antwort des App-Containers,
  sondern beendet die Verbindung irgendwann selbst mit 502, was im Browser wie ein kompletter
  Ausfall aussieht, obwohl der App-Container die ganze Zeit normal lief.
- Fix:
  - `ops/docker/updater-server.mjs`: `run()` kennt jetzt ein optionales Zeitlimit (killt den
    Kindprozess bei Überschreitung); der `git fetch` in `collectStatus()` bekommt 15 Sekunden.
  - `apps/server/src/http/routes/update.ts`: `callUpdater()` setzt zusätzlich ein eigenes
    20-Sekunden-Zeitlimit auf die Anfrage an den Updater-Sidecar (Verteidigung in der Tiefe,
    falls der Sidecar aus einem anderen Grund haengt) und gibt bei Zeitüberschreitung einen
    sauberen 504 statt eines unkontrollierten Hängers zurück.
  - `js/store.js`/`js/admin-board.js`: die Update-Anzeige unterscheidet jetzt zwischen "nie
    konfiguriert" (503), "Server nicht erreichbar" (Netzwerkfehler) und "Updater antwortet
    gerade nicht, z.B. wegen laufendem Neustart" (502/504, mit direktem "Erneut prüfen"-Knopf)
    statt immer dieselbe, irreführende Meldung zu zeigen.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Update-Anzeige: Fortschrittsbalken ergänzt, fehlenden Abstand unter der Konsolenansicht behoben
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: Rückmeldung, dass die Update-Anzeige in Systemeinstellungen > Update während eines
  laufenden Updates nur "Schritt: build" als Text zeigte (kein Überblick, wie weit das Update
  ist) und der Bereich unter der Konsolenausgabe ohne Abstand direkt an "Nur Superadmins können
  Updates starten." stieß.
- `ops/docker/updater-server.mjs`: `job.step` bleibt bei einem Fehler jetzt auf dem Namen des
  zuletzt gestarteten Schritts stehen (z.B. "build"), statt auf die generische Zeichenkette
  "failed" überschrieben zu werden -- ein neues `job.failed`-Feld zeigt den Fehlschlag getrennt
  an. Vorher konnte das Frontend nach einem Fehler nicht mehr erkennen, bei welchem der fünf
  Schritte (Abrufen/Zurücksetzen/Bauen/Neustarten/Migrieren) es hakte.
- `js/admin-board.js`: neue `AdminBoard.renderUpdateProgress(job)` -- Fortschrittsbalken plus
  Schritt-Leiste (jeder der fünf Schritte als erledigt/aktiv/fehlgeschlagen/ausstehend markiert),
  wird während und nach einem Update in Systemeinstellungen > Update angezeigt.
- `style.css`: `.update-status`/`.update-log` bekommen jetzt `margin-bottom`, dazu die neuen
  `.update-progress*`-Klassen (an die bestehenden Design-Tokens `--success`/`--warning`/
  `--danger`/`--radius-pill`/`--card-hover` angelehnt, gleiches Muster wie die bereits
  vorhandene Teilaufgaben-Fortschrittsleiste `.todo-progress-bar`).
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Architekturfehler in AdminBoard.render() gefunden: Board aktualisierte sich bei fehlgeschlagenem /users/me-Abruf gar nicht mehr
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: weitere Suche nach den vier noch offenen, vom Nutzer gemeldeten Problemen (Chat senden,
  Drag&Drop im Board, neu angelegte Großstörungen werden nicht angezeigt, Icons in der Liste),
  ohne dass dafür Browser-Konsolenausgaben vorlagen.
- Gefunden: `AdminBoard.render()` (js/admin-board.js) brach mit `if (!user) return;` komplett ab,
  sobald `Store.currentUser()` aus irgendeinem Grund `null` lieferte -- das sollte ursprünglich
  nur den Absturz nach dem 502-Vorfall vom 10.10.2026 abfangen (behoben, siehe dortiger Eintrag),
  hatte aber eine schwerwiegende Nebenwirkung: `render()` wird bei JEDER Ticket-Aktion erneut
  aufgerufen (nach Drag&Drop, nach dem Anlegen einer Großstörung, nach jeder Chat-Nachricht,
  zusätzlich alle 60 Sekunden per Timer) -- und `Store.currentUser()` feuerte dabei bei jedem
  einzelnen Aufruf einen komplett neuen, ungecachten Netzwerk-Request an `/api/v2/users/me`.
  Jeder einzelne fehlgeschlagene/verzögerte dieser vielen Requests ließ das gesamte Board
  unverändert stehen -- eine per Drag&Drop geänderte Spalte sprang optisch zurück, eine frisch
  angelegte Großstörung blieb unsichtbar, obwohl beides auf dem Server bereits korrekt gespeichert
  war (daher die Erfolgsmeldung bei gleichzeitig fehlender Anzeige).
- Fix:
  - `js/admin-board.js`: `render()` bricht nicht mehr komplett ab, wenn `Store.currentUser()`
    `null` liefert -- nur der abteilungsbezogene Admin-Filter wird dann übersprungen (sicherer
    Fallback), der Rest des Boards (Spalten, Karten, Zähler) wird immer neu aufgebaut.
  - `js/store.js` (`Store.fetchSessionUser`): 3 Sekunden Zwischenspeicher, damit nicht mehr bei
    jedem einzelnen `render()`-Durchlauf ein frischer Request nötig ist; bei einem fehlgeschlagenen
    Abruf wird der zuletzt bekannte Wert weiterverwendet statt `null`. Rechteprüfungen selbst
    laufen weiterhin serverseitig bei jeder einzelnen API-Anfrage neu (app.ts onRequest-Hook) --
    dieser Zwischenspeicher betrifft nur die Anzeige. Cache wird bei Login/MFA-Bestätigung/Logout
    geleert (`js/auth.js`).
- Dieser Fund erklärt sehr wahrscheinlich Drag&Drop und die nicht angezeigten Großstörungen
  vollständig, und mindestens den "Board aktualisiert sich nicht"-Anteil des Chat-Problems.
  Für das Icon-Problem in der Listenansicht wurde trotz gezielter Prüfung (lucide.createIcons()
  wird korrekt nach jedem Render aufgerufen) keine konkrete Fehlerquelle gefunden -- dafür bräuchte
  es weiterhin die tatsächliche Fehlermeldung aus der Browser-Konsole.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Vier vom Nutzer gegen die echte laufende Installation gefundene Bugs behoben
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: erster echter Durchklick-Test der laufenden Installation durch den Nutzer (siehe
  Boot-Smoke-Test-Eintrag oben -- genau das, was von hier aus nicht möglich war). Gefunden und
  behoben:
  - **Logout wirkungslos (kritisch):** `__Host-ticket_session` ist ein `__Host-`-Cookie -- ein
    Browser akzeptiert dafür JEDE Set-Cookie-Antwort, auch eine löschende, nur mit gesetztem
    `Secure`-Attribut. `reply.clearCookie(PROD_SESSION_COOKIE, { path: '/' })` setzte das nicht,
    der Browser verwarf die Löschung still, die Sitzung blieb bestehen. Fix:
    `apps/server/src/http/routes/auth.ts`, `clearCookie` bekommt jetzt dieselben Sicherheits-
    Attribute wie beim Setzen.
  - **Neuen Benutzer anlegen meldete "Gespeichert", obwohl nichts angelegt wurde:**
    `Store.saveUsers` (js/store.js) prüfte den Rückgabewert der POST-Anfrage nie -- jede vom
    Server abgelehnte Eingabe (zu kurzes Passwort, doppelter Benutzername, ungültige E-Mail)
    endete trotzdem mit einer Erfolgsmeldung. Fix: prüft jetzt `res.ok` für jede Teiloperation
    und gibt `false` zurück, wenn irgendetwas fehlschlug; `openEditUserModal` zeigt dann eine
    konkrete Fehlermeldung statt "Gespeichert".
  - **Zusatzrechte für Admin-Konten ("Verwaltung"/"Zusatzfunktionen" aus der lokalen Version vom
    07.10.2026) komplett fehlend:** in einer früheren Runde ersatzlos entfernt, weil das
    zugrunde liegende `user.permissions`-Objekt serverseitig nie existierte
    (`AdminBoard.can()` lief dadurch für jeden normalen Admin immer ins Leere). Statt die
    Oberfläche zu entfernen (wie zuvor geschehen), jetzt wie bei department/ticketNumberFormat
    real angebunden:
    - Neue Spalte `permissions_json` auf `users` (Migration `0024_user_permissions.ts`).
    - `apps/server/src/http/routes/users.ts`: neues Schema `userPermissionsSchema`
      (canManageRequests/canManageUsers/canViewLogs/canManage2FA/textBlocks/reports/approvals/
      recurring/kb), in `GET /users`, `/users/me`, `POST /users`, `PATCH /users/:id` verdrahtet.
      Vergabe der Zusatzrechte für andere Admin-Konten ist selbst privilegiert -- nur Superadmin
      darf das (`PATCH` ignoriert `permissions` sonst still, wie die Oberfläche es auch nur
      Superadmin anzeigt).
    - `js/admin-board.js` (`openEditUserModal`): "Verwaltung"/"Zusatzfunktionen"-Bereich im
      Benutzer-Editor wieder vorhanden (nur für Superadmin sichtbar, nur bei Rolle "admin").
      `AdminBoard.can()` prüft wieder echte, vom Superadmin vergebene Rechte statt pauschal
      "jeder Admin darf alles"; `openKnowledgeBase`s Schreibrecht ebenso an `permissions.kb`
      gekoppelt.
    - `js/store.js` (`mapApiUserToLegacy`): `canManageUsers`/`canManage2FA`/`canManageRequests`/
      `canViewLogs`/`permissions` kommen jetzt aus echten Serverdaten statt pauschal `true` für
      jeden Admin.
  - **Abwesenheits-Dialog stürzte bei jedem Öffnen ab, sobald die Zielperson noch keine laufende
    Abwesenheit hatte:** `Settings.absencePeriodMarkup(absence = {}, ...)` -- ein Default-
    Parameter greift nur bei `undefined`, nicht bei explizitem `null`, und `target.absence` ist
    bei fehlender Abwesenheit immer `null` (siehe `mapApiUserToLegacy`). Jeder Öffnen-Versuch
    endete mit "Cannot read properties of null (reading 'fromMs')", bevor überhaupt etwas
    gespeichert werden konnte -- das erklärt vermutlich auch, warum zuvor gesetzte Abwesenheiten
    nirgends in der Benutzerliste auftauchten: der Dialog ließ sich nie erfolgreich bedienen.
    Fix: `js/settings.js`, expliziter `absence || {}`-Fallback zusätzlich zum Default-Parameter.
- Noch nicht abschließend geklärt (keine konkrete Fundstelle ohne weitere Fehlermeldungen aus
  dem Browser): Chat-Nachrichten senden, Ticket per Drag&Drop verschieben, neu angelegte
  Großstörungen werden nicht angezeigt, Icons laden in der Listenansicht nicht immer korrekt.
  Code für alle vier Bereiche wurde gelesen, keine offensichtliche Fehlerquelle gefunden --
  Browser-Konsolenausgabe (wie beim Abwesenheits-Dialog) würde die Suche erheblich verkürzen.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Boot-/Verdrahtungs-Smoke-Test ergänzt (apps/server/test/appBoot.test.ts)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: Nachfrage, ob wirklich ALLE Funktionen fehlerfrei laufen. Ehrlicher Befund dazu: in
  dieser Arbeitsumgebung steht weder Docker noch eine echte MariaDB/MySQL-Instanz zur Verfügung
  -- ein echter Durchklick-Test der laufenden Installation ist von hier aus technisch nicht
  möglich. Was stattdessen ergänzt wurde, um die Lücke zwischen "Typecheck/Unit-Tests grün" und
  "läuft wirklich" zu verkleinern: ein Boot-Smoke-Test, der `buildApp()` gegen eine
  Kysely-Instanz mit Kyselys eigenem `DummyDriver` (keine echte Verbindung, aber auch kein
  Wurf) tatsächlich hochfährt und per `app.inject()` echte HTTP-Anfragen durch den vollständigen
  Plugin-/Hook-Stack schickt.
- Genau diese Prüfung hätte den Produktionsausfall vom 11.10.2026 (502, siehe Eintrag oben)
  gefangen: der Fehler lag in der Registrierungsreihenfolge von Hook/Plugin in `app.ts` und
  hätte bei JEDER Anfrage einschließlich `/health` einen ungefangenen Fehler geworfen -- etwas,
  das weder `tsc` noch die bisherigen, auf einzelne Funktionen beschränkten Unit-Tests prüfen
  konnten, weil beide nie den gesamten Fastify-Request-Lebenszyklus durchlaufen.
- Deckt ab: `buildApp()` wirft nicht beim Start; `/health` antwortet statt abzustürzen;
  geschützte Routen antworten ohne Sitzung mit 401 statt 500 (auch mit einem manipulierten/
  ungültigen Sitzungs-Cookie); unbekannte Routen liefern 404.
- **Ersetzt ausdrücklich keinen echten Test gegen eine echte Installation** -- Datenbank-Logik,
  Verschlüsselung mit echten Schlüsseln, tatsächliche Dateninhalte und alles, was eine echte
  Zeile in einer echten Tabelle braucht, prüft dieser Test bewusst nicht (dafür sind die
  bestehenden, auf `DummyDriver` basierenden Mocks zu grob). Ein Durchklicken der echten
  Installation ersetzt das nicht.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - "Erste Antwortzeit" in der Auswertung berechnet jetzt tatsächlich etwas
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Letzte bisher offene, ehrlich dokumentierte Einschränkung aus der Auswertung (Reports)
  behoben: `firstResponse()` las `t.chat`/`t.comments` vom Ticket-Objekt der Listen-API --
  seit der Normalisierung dort immer `[]` (siehe `mapApiTicketToLegacy`), wodurch "Erste
  Antwortzeit" immer "–" anzeigte, auch im Mitarbeiter-Vergleich in derselben Auswertung.
- Fix: neuer, schlanker Endpunkt `GET /api/v2/tickets/first-response-times` (nur Admin,
  `apps/server/src/http/routes/tickets.ts`) liefert je Ticket den Zeitpunkt der ersten
  Admin-/Superadmin-Nachricht per korrelierter Unterabfrage -- bewusst ein eigener Endpunkt statt
  einer weiteren Unterabfrage an der generischen Ticket-Liste, die von jeder Rolle bei jedem
  normalen Laden mitbezahlt werden müsste. `js/store.js`: `Store.getFirstResponseTimes(sinceIso)`.
  `js/admin-board.js` (`AdminBoard.openReports`): `firstResponse()` nutzt die echten Zeitpunkte.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Weitere Funktionslücken zur lokalen Version vom 07.10.2026 geschlossen
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: gezielte Aufforderung, erneut zu prüfen, was der Serverversion noch fehlt, und es
  funktionsfähig umzusetzen. Gefunden und behoben, schwerste zuerst:
  - **Ticket drucken zeigte fast nie etwas außer Kopf/Metadaten (stiller Funktionsverlust):**
    `AdminBoard.printTicket` las `t.todos`/`t.comments`/`t.chat`/`t.logs`/`t.timeEntries` vom
    Ticket-Objekt der Listen-API -- die sind dort seit der Normalisierung immer `[]` (siehe
    `mapApiTicketToLegacy`). Jedes der standardmäßig angehakten Druck-Optionen
    (Teilaufgaben/Admin-Chat/Lösungsweg/Chat-Verlauf/Zeiterfassung) tat dadurch nichts -- ein
    ausgedrucktes Ticket enthielt nur Kopf, Metadaten und Beschreibung, unabhängig von den
    gewählten Haken. Betrifft auch Abrechnungs-/Prüfzwecke (Zeiterfassung). Fix: `printTicket`
    lädt jeden Abschnitt jetzt frisch von der jeweiligen Detail-API
    (`/todos`, `/notes`, `/messages`, `/time-entries`, `Store.getTicketAuditLog`).
  - **"Als Wissensartikel übernehmen" fand nie einen Lösungsweg:** derselbe Fehler --
    `addSolutionToKnowledgeBase(t)` las `t.comments` (immer `[]`). Der Knopf meldete deshalb
    immer "Es gibt noch keinen Lösungsweg", selbst wenn einer dokumentiert war. Fix: lädt die
    echten internen Notizen jetzt über `/api/v2/tickets/:id/notes`.
  - **Teilaufgaben-Zuweisung wurde beim Entfernen einer Beteiligten Person nie tatsächlich
    gelöscht:** `AdminBoard.syncTodoAssignees` iterierte ebenfalls über das immer leere
    `ticket.todos`-Array und löste dadurch nie eine PATCH-Anfrage aus -- eine Teilaufgabe blieb
    einer aus dem Ticket entfernten Person dauerhaft zugewiesen, sowohl serverseitig als auch in
    der Anzeige. Fix: lädt die echten Teilaufgaben über `/todos` und löscht betroffene
    Zuweisungen dort gezielt per PATCH.
  - **Genehmigungs-Entscheidung über generisches Ticket-PATCH umgehbar** (bereits am 10.10.2026
    behoben, hier nur zur Vollständigkeit nicht erneut aufgeführt).
  - **Wissensdatenbank: Dateianhänge an Artikeln fehlten komplett.** Die lokale Version vom
    07.10.2026 erlaubte Datei-Eingabe/Drag&Drop/Einfügen beim Anlegen eines Artikels -- die
    Serverversion hatte dafür weder Datenbankspalte noch Endpunkt noch UI. Neu:
    - Migration `0023_kb_article_attachments.ts`: eigene, schlanke Tabelle (nicht die generische
      `attachments`-Tabelle wiederverwendet, da dort `ticket_id` eine Pflichtangabe ist).
    - `apps/server/src/http/routes/knowledge.ts`: vier neue Endpunkte (Liste/Upload je Artikel,
      Einzelabruf mit Inhalt, Löschen), gleiche AES-256-GCM-Verschlüsselung wie Ticket-Anhänge,
      gleiche MIME-/Endungs-Blockliste (siehe Sicherheitsaudit vom 10.10.2026, inkl.
      `image/svg+xml`).
    - `js/store.js`: `getKbArticleAttachments`/`saveKbAttachment`/`getKbAttachment`/
      `deleteKbAttachment`; `createKbArticle` gibt jetzt die neue Artikel-ID zurück (vorher nur
      `true`/`false`), damit Anhänge gleich mit hochgeladen werden können.
    - `js/admin-board.js` (`openKnowledgeBase`): Datei-Eingabe, Drag&Drop und Einfügen beim
      Anlegen eines Artikels (wie in der lokalen Version), Anhang-Chips je Artikel (beim
      Aufklappen nachgeladen, nicht pauschal für die ganze Liste).
  - **Genehmigungsverlauf:** eine erneute Genehmigungsanfrage nach einer Ablehnung überschrieb
    bisher die Angaben der vorherigen Entscheidung ohne Spur. Es gibt weiterhin keine
    vollständige Historie als eigene Datenstruktur (auch die lokale Version rendert nirgends
    eine solche Liste, hält die Einträge nur ungenutzt im Speicher), aber das ohnehin
    vorhandene `ticket_audit_log` (jetzt auch über den reparierten Ticket-Protokoll-Druck
    einsehbar, siehe oben) vermerkt bei Anfrage/Entscheidung jetzt zusätzlich Prüfer-Person und
    Ablehnungsgrund, statt nur den nackten Status.
- Geprüft und als bereits gleichwertig zur lokalen Version bestätigt (keine Änderung nötig):
  Auswertung/Reports, Textbausteine, Wiederkehrende Tickets (bewusst als Server-Cron mit festem
  Startzeitpunkt statt Tag-im-Monat/Wochentag umgesetzt), CSV-Export/Import, Genehmigungs-
  Anfrage/Entscheidung/Status-Anzeige im Ticket-Modal und auf der Kanban-Karte,
  Großstörungs-Verknüpfung und Status-Synchronisation.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Kritischer Ausfall (502) durch Hook-Reihenfolge in app.ts behoben
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Befund (vom Nutzer per Browser-Konsole gemeldet): Nach dem Sicherheitsaudit vom 10.10.2026
  antwortete die laufende Installation auf **alle** Anfragen (`/api/v2/tickets`,
  `/api/v2/users/me`, sogar `/health`) mit 502, und `admin-board.js` stürzte mit
  "Cannot read properties of null (reading 'role')" ab.
- Ursache: Der neue `onRequest`-Hook für die Rollen-/Sperr-Nachprüfung
  (`apps/server/src/http/app.ts`) wurde VOR `app.register(cookie, ...)` eingehängt. Dadurch
  existierten `req.cookies`/`req.unsignCookie` (bereitgestellt vom `@fastify/cookie`-Plugin) zum
  Ausführungszeitpunkt noch nicht -- jede einzelne Anfrage warf sofort einen ungefangenen Fehler,
  auch der Docker-Healthcheck auf `/health`. Der Container galt dadurch als "unhealthy", Caddy
  bekam keine Verbindung mehr -> 502 für alle Nutzer.
- Fix: Hook-Registrierung hinter `app.register(cookie, ...)` verschoben, `req.cookies`-Zugriff
  zusätzlich mit `?.` abgesichert, `ticketSession` korrekt über `app.decorateRequest(...)` statt
  `app.decorate(...)` deklariert (letzteres hätte die Instanz, nicht die Anfrage dekoriert).
- Nebenbei gefunden und mitbehoben: `AdminBoard.render()` (`js/admin-board.js`) griff ungeprüft
  auf `user.role` zu -- `Store.currentUser()` liefert bei JEDEM Fehlschlag (401 ebenso wie ein
  vorübergehendes 502) `null` zurück. Der 60-Sekunden-Refresh-Timer wiederholte den Absturz
  dadurch endlos. Jetzt: einfacher, stiller Abbruch dieses Render-Durchlaufs, nächster
  Intervall-Durchlauf versucht es erneut.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-11 - Systemeinstellungen (Sicherheit/Benachrichtigungen/E-Mail/Unternehmen) noch immer nicht identisch zur lokalen Version
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: Screenshot-Vergleich der Systemeinstellungen zwischen Serverversion und der lokalen
  Version vom 07.10.2026 zeigte, dass trotz vorheriger Anpassungsrunden weiterhin mehrere Tabs
  mit abweichenden Feldern/Bezeichnungen/Verhalten liefen. Mit dem baseline-Export aus `script.js`
  (Commit `5cdb6aa`) Feld für Feld abgeglichen und behoben:
  - **Tab "Sicherheit" war komplett anders aufgebaut und wirkungslos:** Die Serverversion zeigte
    "Mindestlänge Passwort"/"Sitzungslaufzeit"/"2FA für Administratoren erzwingen"
    (Checkbox)/"Dauerhafte Sitzungen erlauben" -- Felder, die es in der lokalen Version gar nicht
    gibt, UND alle zugehörigen `securityConfig`-Werte wurden serverseitig nirgends gelesen (nur
    gespeichert, nie angewendet; Brute-Force-Schutz/Sitzungsdauer blieben fest auf 5
    Versuche/15 Minuten/8 Stunden einprogrammiert). Jetzt exakt wie die lokale Version: "2FA
    erzwingen" (Keine/Alle/Nur Admins/Nur Benutzer), "Session-Timeout (0 = kein Timeout)",
    "Max. Fehlversuche (0 = kein Limit)", "Was passiert nach Erreichen der Fehlversuche?"
    (Sperren/Vorübergehend sperren/Nur protokollieren), Sperrdauer -- UND serverseitig jetzt
    tatsächlich wirksam:
    - Neu: `apps/server/src/domain/securityPolicy.ts` (`loadSecurityPolicy`,
      `force2faAppliesToRole`) liest diese Werte aus den Systemeinstellungen, mit sicheren
      Vorgaben (5/15 Min./8h), solange nichts explizit gespeichert wurde.
    - `apps/server/src/http/routes/auth.ts`: Login/MFA-Verify/`currentUser()` nutzen jetzt
      `maxLoginAttempts`/`lockoutAction`/`lockoutMinutes` statt fester Konstanten, Sitzungs-Cookie
      und -Gültigkeit richten sich nach `sessionTimeout` (0 = kein Ablauf), erfolgreiche Logins
      melden `mfaSetupRequired`, wenn "2FA erzwingen" die Person betrifft und sie noch keine 2FA
      eingerichtet hat (blockiert den Login nicht, nur ein Hinweis -- wie im Hinweistext der
      lokalen Version).
    - `apps/server/src/http/app.ts`: der Live-Rollen-Check (siehe Eintrag vom 10.10.2026) nutzt
      jetzt ebenfalls `sessionTimeout` statt der vorher fest verdrahteten 8 Stunden.
    - Neue Tests: `apps/server/test/securityPolicy.test.ts`.
  - **Tab "Benachrichtigungen" fehlte die "Konto genehmigt"-Automail komplett:** weder Schalter
    noch die eigentliche Mail gab es serverseitig. Neu: `notifConfig.accountApproved` in
    `settings.ts`, `PATCH /api/v2/account-requests/:id` verschickt bei Freigabe jetzt eine Mail
    an die Antragsperson, wenn der Schalter aktiv ist (`apps/server/src/http/routes/extras.ts`).
  - **Tab "E-Mail Einstellungen" fehlten HTML-E-Mails sowie Teile von "Sicherheit und
    Zertifikate":** "HTML-E-Mails aktivieren"-Schalter, E-Mail-Vorlage, Key-Passphrase,
    DKIM Selector/Domain/Private-Key fehlten vollständig; die Zertifikatsprüfung bot nur
    "Strikt"/"Opportunistisch" statt der drei Stufen "Strikt"/"Self-signed erlauben"/
    "Deaktiviert", Transport-Sicherheit "STARTTLS/TLS/Keine" statt "STARTTLS/TLS/
    Opportunistisch". Alle Felder ergänzt, Enum-Werte an die lokale Version angeglichen
    (`emailAdvancedConfig` in `settings.ts`). Wie in der lokalen Version selbst dokumentiert
    ("...werden gespeichert und für Backend/SMTP-Integration bereitgestellt") werden
    S/MIME/DKIM-Werte gespeichert, aber (wie im Original) nicht aktiv zum Signieren
    ausgehender Mails verwendet -- kein Funktionsverlust gegenüber der lokalen Version.
  - **Tab "Unternehmenseinstellungen" fehlten mehrere Felder:** "Support-Abteilung",
    "Standard-Zeitzone", "Standort / Region", "E-Mail Signatur" (Klartext) und
    "HTML-E-Mail-Signatur" ergänzt (`companyBrandingConfig` in `settings.ts`). Vorhandene,
    über die lokale Version hinausgehende Felder (getrennte Impressum-/Datenschutz-URL statt
    einer kombinierten, eigenständiges "Adresse"-Feld) bewusst zusätzlich belassen, nicht
    entfernt.
  - Die "Konto-Selbstverwaltung"-Checkboxen (Name/E-Mail/Einrichtung-Abteilung) standen in der
    Serverversion fälschlich im Tab "Unternehmen" statt wie in der lokalen Version im Tab
    "Sicherheit" -- verschoben, doppelte IDs (ein und dieselbe Checkbox in zwei Tabs) entfernt.
- `apps/server/test/session.test.ts` angepasst: prüft jetzt direkt gegen `req.ticketSession`
  statt ein signiertes Cookie nachzubilden, da Cookie-Parsing und die DB-Gegenprobe seit dem
  10.10.2026 zentral im `onRequest`-Hook in `app.ts` laufen (nicht mehr in `session.ts`).
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-10 - Genehmigungs-Entscheidung über generisches Ticket-PATCH umgehbar
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Anlass: gezielte Nachfrage, ob "nichts dem Browser vertraut, nur der Server die sichere Zone
  ist" wirklich überall durchgesetzt wird. Dabei gefunden: `approval_status`/`approval_text`
  standen im generischen `updateTicketSchema` von `PATCH /api/v2/tickets/:id` -- einer für JEDE
  Admin-Person freigegebenen Route. Die dedizierte Route `POST /api/v2/tickets/:id/
  approval-decision` prüft korrekt, dass nur die eingetragene Prüfer-Person (oder Superadmin als
  Vertretung) entscheiden darf, aber über das generische PATCH hätte jede beliebige Admin-Person
  (nicht nur die zuständige Prüfer-Person) eine fremde Genehmigung direkt setzen können --
  eine serverseitige Rechteprüfungslücke, auch wenn die Oberfläche selbst diesen Weg nie nutzt
  (`Store.saveTickets()` sendet dieses Feld nicht, nur die dedizierten Endpunkte tun es).
- Fix: `approval_status`/`approval_text` aus `updateTicketSchema`
  (`apps/server/src/http/routes/tickets.ts`) entfernt -- Änderungen am Genehmigungsstatus laufen
  jetzt ausschließlich über die geprüften, dedizierten Endpunkte.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

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
