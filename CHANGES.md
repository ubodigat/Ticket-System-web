# Änderungen und Herkunft (CPAL 3.3)

## 2026-10-25 - Persönlicher Outlook-Kalender pro Benutzer (Punkt 9.2)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Neue, von der bestehenden App-only-Integration getrennte Funktion: jede Person kann über einen
  neuen "Mein Kalender"-Button in der Kopfzeile ihren eigenen Outlook-Kalender per OAuth
  (Authorization Code Flow, delegierte Berechtigung) verbinden, darin direkt eine
  Monatsübersicht mit ihren echten Terminen sehen und neue Termine anlegen -- unabhängig vom
  gemeinsamen Service-Postfach der Ticket-Kalenderfunktion.
- **Backend:** neue Migration `0048_outlook_personal_calendar.ts` (drei neue Spalten an
  `users`: verschlüsselter Refresh-Token, Anzeige-E-Mail, Verbindungszeitpunkt -- gleiches
  Verschlüsselungsmuster wie `name_enc`/`email_enc`, nicht das globale `app_settings`-Muster).
  `domain/graphClient.ts` um den delegierten OAuth-Austausch erweitert (Autorisierungs-URL,
  Code-gegen-Token-Tausch, Refresh mit automatischer Rotation, `/me/calendarview`,
  `/me/events`) -- nutzt dieselbe Azure-App-Registrierung (Tenant-/Client-ID, Client-Secret) wie
  die bestehende Integration, nur mit zusätzlichen delegierten Scopes
  (`offline_access Calendars.ReadWrite User.Read`). Neue Routen-Datei
  `http/routes/outlookPersonal.ts` (`GET /connect`, `GET /callback`, `GET /status`,
  `GET /calendar`, `POST /events`, `POST /disconnect`) mit CSRF-Schutz über einen kurzlebigen,
  signierten State-Cookie; der Access-Token wird nie persistiert, nur der Refresh-Token
  (verschlüsselt). Token-Refresh läuft bedarfsgesteuert bei jeder Anfrage, bewusst ohne neuen
  Hintergrund-Job (die bestehende `setInterval`-Wartung ist nicht Multi-Instance-sicher).
- **Frontend:** neue Datei `js/outlook-calendar.js` (`OutlookCalendar`) -- Monatsraster mit
  Termin-Markern pro Tag, Tagesdetailansicht, Verbinden-/Trennen-Dialog, Termin-Erstellen-
  Formular (gleiche Feldstruktur wie der bestehende Ticket-Outlook-Termin-Dialog). Der
  Rücksprung von Microsoft (`?outlook=connected`/`?outlook=failed`) wird beim Laden ausgewertet,
  per `history.replaceState` aus der URL entfernt und als Toast gemeldet. In
  Systemeinstellungen > Outlook ein zusätzlicher Hinweis mit der exakten Redirect-URI, die die
  Admin-Person einmalig in Azure AD hinterlegen muss.
- 16 neue Schlüsselpaare in `js/lang.js`; Konsistenz-Check über alle zwölf bisher bearbeiteten
  Dateien bestätigt 1121 DE- = 1121 EN-Schlüssel.
- Server-Verifikation: `typecheck`/`build`/`test` (159 Tests) für `apps/server` erfolgreich.
  Ein echter Microsoft-OAuth-Austausch kann hier nicht automatisiert getestet werden -- dafür
  nach dem einmaligen Azure-Setup (Redirect-URI + Admin-Consent für die delegierten Scopes) ein
  manueller Test: Verbinden, Kalender ansehen, Termin anlegen, Trennen.

## 2026-10-25 - Passwort-Anforderungen-Popup, Teilnehmer beim Outlook-Termin
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **Punkt 4 (Passwort-Anforderungen-Popup):** `UI.bindPasswordRequirements()` (neu in
  `js/ui.js`) zeigt beim Fokussieren eines Passwortfelds ein Popover mit der einzigen
  serverseitig durchgesetzten Regel (mind. 14 Zeichen, siehe
  `apps/server/src/http/routes/users.ts`) und aktualisiert live, wie viele Zeichen noch fehlen,
  statt die Person erst nach dem Absenden scheitern zu lassen. Eingebunden bei den beiden
  Stellen, an denen ein Admin ein neues Anmelde-Passwort vergibt: "Benutzer erstellen"
  (`#a-password`) und "Benutzer bearbeiten" (`#ue-pass`). Neue CSS-Klasse
  `.password-requirements-popover` in `style.css`.
- **Punkt 9.1 (Personen beim Outlook-Termin auswählen):** Das Backend
  (`apps/server/src/domain/graphClient.ts`, Route `POST /api/v2/tickets/:id/calendar-event`)
  unterstützte `attendee_emails` bereits vollständig -- nur die Oberfläche
  (`AdminBoard.openCalendarEventModal`) hatte dafür noch kein Eingabefeld. Jetzt mit einer
  Mehrfachauswahl (bestehende, nicht archivierte Benutzer) ergänzt; die ausgewählten Personen
  werden beim Absenden zu E-Mail-Adressen aufgelöst und an den bestehenden Endpunkt
  übergeben -- keine neue Graph-Berechtigung nötig, da `Calendars.ReadWrite`
  (Application Permission) Teilnehmer als Teil des Termin-Objekts bereits abdeckt.
  **Räume/Ressourcen** sind dagegen in diesem Projekt an keiner Stelle als Datenmodell
  vorhanden (weder im Graph-Client noch in der Datenbank) -- das wurde bewusst nicht erfunden,
  sondern als separate, noch zu klärende Anforderung zurückgestellt.
- 2 neue Schlüsselpaare in `js/lang.js`; Konsistenz-Check bestätigt 1108 DE- = 1108
  EN-Schlüssel.

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 8 (Ad-hoc-Ternarys aufräumen) -- Plan abgeschlossen
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Alle verbleibenden `Lang.current === 'en' ? ... : ...`-Ternarys, die direkt deutschen/
  englischen Text enthielten, durch echte `Lang.t()`-Wörterbucheinträge ersetzt: die
  Archiv-Suche-Platzhalter, die zweifach vorkommende "Interne Kommunikation"-Überschrift, die
  drei "Warten auf..."-Werte in `Lang.status()` und die komplette `chooseWaitingStatus()`-
  Funktion (Auswahlliste, Titel, Labels, Platzhalter, Bestätigen-/Abbrechen-Button) in
  `js/admin-board.js`. Drei verbleibende `Lang.current === 'en'`-Stellen sind bewusst erhalten
  geblieben, da sie keine Übersetzungs-Ternarys sind, sondern die Locale für
  `toLocaleDateString()`/`toLocaleTimeString()` wählen (`js/admin-board.js`, `js/settings.js`,
  `js/utils.js`) -- das ist korrektes, sprachabhängiges Datumsformat-Verhalten, kein
  Übersetzungs-Workaround.
- 14 neue Schlüsselpaare in `js/lang.js`. Finaler Konsistenz-Check über alle elf Dateien
  bestätigt 1104 DE- = 1104 EN-Schlüssel, 963 tatsächlich verwendete Schlüssel vollständig in
  beiden Wörterbüchern vorhanden.
- **Damit ist der komplette 8-Phasen-Plan zur vollständigen Englisch-Übersetzung
  abgeschlossen** (Login/2FA, Nutzer-Dashboard, Todo-Liste, Admin-Board, Einstellungen,
  gemeinsame UI-Komponenten, restliches statisches Markup, Ad-hoc-Ternarys). Bewusst weiterhin
  unübersetzt bleiben historische Audit-Protokoll-Freitexte (`Store.addLog`/`addGlobalLog`) --
  siehe Begründung im Phase-4-Eintrag.

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 7 (restliches statisches Markup)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- `admin.html` war die einzige Datei mit noch offenen Stellen (`index.html` und `dashboard.html`
  waren durch Phase 1+2 bereits vollständig abgedeckt): Kopf-Buttons des Ticket-Modals,
  Frist-/Outlook-Termin-Buttons, Genehmigungs-Status-Blöcke, beide internen
  Kommunikations-Tabs samt Formatierungs-Werkzeugleisten und Notiz-Typ-Auswahllisten,
  Ticket-Aktionsleiste, Chat-Werkzeugleiste, "Konto erstellen"-Dialog und die
  Schließen-Buttons der Anfragen-/Benutzerverwaltungs-Modals.
- Nebenbefund behoben: Die Status-Auswahlliste im Ticket (`#m-status-edit`) hatte für die
  Hauptwerte "Neu"/"In Bearbeitung"/"Geschlossen" überhaupt keine Übersetzung und für die drei
  "Warten auf..."-Werte nur einen Ad-hoc-Ternary. Durch eine einzige Zeile ersetzt, die für jede
  Option die bereits vorhandene `Lang.status()`-Zuordnungsfunktion verwendet -- konsistent mit
  der Statusanzeige überall sonst im Programm.
- 32 neue Schlüsselpaare in `js/lang.js`; Konsistenz-Check über alle elf bisher bearbeiteten
  Dateien bestätigt 1091 DE- = 1091 EN-Schlüssel.
- Damit sind Phasen 1-7 des Übersetzungsplans abgeschlossen. Letzter Schritt: Phase 8
  (verbleibende Ad-hoc-Ternarys wie `chooseWaitingStatus` in echte Wörterbuch-Einträge
  überführen).

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 6 (js/ui.js)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- `js/ui.js` (gemeinsame Dialoge/Widgets, auf vielen Seiten wiederverwendet) komplett übersetzt:
  Bestätigungs-/Prompt-Dialog, "Ticket einer Störung zuordnen"-Dialog, Ticket-Protokoll-Modal,
  Farbwähler (Tooltips/aria-Labels), der komplette Datum/Uhrzeit-Picker (Monatsnamen,
  Wochentage, Navigation, manuelle Eingabe, Fehlermeldung), Mehrfachauswahl-Komponente
  (Platzhalter, Suche, "N ausgewählt"-Text) und eigene Formularfelder (Pflichtfeld-Auswahl).
  39 neue Schlüsselpaare in `js/lang.js`; Konsistenz-Check über alle neun bisher bearbeiteten
  Dateien bestätigt 1063 DE- = 1063 EN-Schlüssel.
- Weiter laut Plan: Phase 7 (restliches statisches Markup in admin.html/dashboard.html/
  index.html), Phase 8 (Ad-hoc-Ternarys aufräumen).

## 2026-10-25 - Datumsauto-Format erneut geprüft (kein Bug), Englisch-Übersetzung Phase 5
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **Punkt 5/9 (Datumsauto-Format) erneut untersucht**, diesmal mit der genaueren Beschreibung
  "beim Eingeben soll das Datum automatisch in dd.mm.yyyy formatiert werden": `UI.bindDateInput`/
  `UI.formatDateText` (js/ui.js) sind bei allen drei betroffenen Feldern (`ue-valid-until` im
  Benutzer-Bearbeiten-Dialog, `custom-due-date` bei der eigenen Lösungsfrist,
  `cal-event-start-date`/`cal-event-end-date` beim Outlook-Termin) korrekt verdrahtet --
  Markup wird zuerst gesetzt, die Bindung läuft danach auf dem echten, aktuellen Element, ohne
  doppelte IDs oder stehen gebliebene alte Modals. Die Formatierungslogik selbst funktioniert
  nachweislich auch, wenn Nutzer Punkte selbst eintippen. Es gibt keine zweite,
  unverdrahtete "Gültigkeit"-Stelle im Code. Sollte es weiterhin nicht funktionieren, bitte mit
  Hard-Refresh erneut testen und genaue Reproduktionsschritte (Browser, welches Feld genau)
  mitteilen.
- Vollständige Englisch-Übersetzung, Phase 5 (`js/settings.js`): Hintergrund-Vorlagen-Namen,
  Abwesenheit-Zeitraum-Labels/-Fehlermeldungen, das komplette eigene-Abwesenheit-Formular im
  Portaleinstellungen-Dialog, das Konto-Formular (Felder, Sperrhinweis, Validierung, Speichern),
  den gesamten Portaleinstellungen-Modal-Rahmen (Akzentfarben-Voreinstellungen, eigene Farbe,
  Konto-/Benachrichtigungs-Bereich), 2FA-Status/-Deaktivieren-Dialog samt aller Fehlermeldungen,
  die Benachrichtigungsmatrix-Zeilen und den Hintergrundbild-Upload. 49 neue Schlüsselpaare in
  `js/lang.js`; Konsistenz-Check über alle acht bisher bearbeiteten Dateien bestätigt
  1024 DE- = 1024 EN-Schlüssel.
- Weiter laut Plan: Phase 6 (`js/ui.js`), Phase 7 (restliches statisches Markup), Phase 8
  (Ad-hoc-Ternarys aufräumen).

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 4 abgeschlossen - js/admin-board.js
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- `js/admin-board.js` (6793 Zeilen, größter Teil der Übersetzung) ist jetzt vollständig auf
  `Lang.t()`/`Lang.format()` umgestellt: SLA-Überfällig-Modal, Anhänge-Verwaltung, Mentions-
  Autovervollständigung, Ticket-Karten, System-Protokoll (Modal/Filter/Druck), Gruppen- und
  Kategorien-Verwaltung inkl. eigener Felder, komplette Benutzerverwaltung (Liste, Bearbeiten-
  /Anlegen-/Löschen-Dialoge, LDAP-Box, Verwaltungsrechte), Sicherheitsbestätigungs-Modal
  (Step-up), Update/Rollback, die komplette Systemeinstellungen-Seite (Sicherheit,
  Benachrichtigungen, Outlook, LDAP, E-Mail/SMTP inkl. aller FieldHelp-Texte, Allgemein inkl.
  Geschäftszeiten/SLA, Unternehmenseinstellungen, Ticketnummern-Formate, Genehmigungsworkflow),
  komplette Listenansicht, Kontoanfragen, der zentrale Status-Wechsel-Pfad (`changeStatus`),
  Zuständigkeiten/Teilaufgaben/Zeiterfassung im Ticket-Modal, Großstörungs-Verwaltung (Erstellen/
  Markieren/Aufheben/Verknüpfen samt Druckausgabe), der komplette Abwesenheit/Vertretung-
  Workflow (Banner, Übersicht, "Tickets zurückholen"-Dialog, alle Benachrichtigungstexte),
  "Ticket-Ersteller archiviert"-Dialog, Ticket-Zusammenführen, Ticket-Erstellen-im-Namen-von,
  eigene Lösungsfrist, Outlook-Kalendertermin-Dialog, Genehmigungsübersicht samt Ablehnungs-
  Dialog, Textbausteine, Wissensdatenbank, Auswertungen/Berichte, wiederkehrende Tickets,
  Verknüpfung verwandter Tickets, interne Notizen/Admin-Chat, Anhang-Vorschau (alle Dateiformat-
  Fallback-Meldungen) und CSV-Benutzerimport.
- Entscheidung zum Umfang: Im Ticket-/System-Protokoll gespeicherte Freitext-Aktionen
  (`Store.addLog`/`addGlobalLog`, z. B. `'Ticket archiviert'`) bleiben bewusst unübersetzt --
  das sind historische, bereits in der Datenbank gespeicherte Einträge, vergleichbar mit
  Ticket-Status/-Priorität, die ebenfalls nicht im Datenmodell, sondern nur bei der Anzeige über
  `Lang.status()`/`Lang.prio()` übersetzt werden. Alte, bereits gespeicherte Log-Einträge ließen
  sich ohnehin nicht nachträglich übersetzen; nur die direkt angezeigten Toast-/Bestätigungs-/
  E-Mail-Meldungen rund um diese Aktionen wurden übersetzt. Ebenfalls unverändert: zwei interne
  Keyword-Abgleiche für Protokoll-Icons (`iconForLog`, vergleicht rohe Aktionstexte) und ein
  bereits zuvor bestehender `Lang.current === 'en' ? ... : ...`-Ternary in
  `chooseWaitingStatus` (liefert schon heute korrektes Englisch, wird wie geplant erst in
  Phase 8 in das Wörterbuch-Muster überführt).
- 975 Schlüsselpaare in `js/lang.js` insgesamt (Phasen 1-4 zusammen). Automatischer
  Konsistenz-Check über alle bisher bearbeiteten Dateien bestätigt 975 DE- = 975 EN-Schlüssel,
  alle 843 tatsächlich verwendeten Schlüssel in beiden Wörterbüchern vorhanden.
- Weiter laut Plan: Phase 5 (`js/settings.js`), Phase 6 (`js/ui.js`), Phase 7 (restliches
  statisches Markup), Phase 8 (Aufräumen bestehender Ad-hoc-Ternarys in `js/lang.js`).

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 3 (Todo-Liste)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- `js/todos.js` (Admin-Todo-Liste in der Topbar) hatte bisher 0 `Lang.t()`-Aufrufe. Alle
  hartkodierten Strings umgestellt: Modal-Markup (Tabs, Toolbar, Formular inkl. Intervall-
  Dropdown Tag(e)/Woche(n)/Monat(e)), Fehlermeldungen aus `request()`, Validierungsfehler in
  `saveForm()`, die Badge-aria-label-Vorlage mit Zähler-Interpolation, die Zeilen-Markups für
  wiederkehrende Aufgaben (inkl. "Alle {n} Tag(e)"-Interpolation und Aktiv/Pausiert-Status) und
  für normale Aufgaben (Eigene Aufgabe/Aufgabe bearbeiten/Aus meiner Liste entfernen) sowie der
  Leerzustand "Keine Aufgaben".
- 46 neue Schlüsselpaare in `js/lang.js` ergänzt. Automatischer Konsistenz-Check über alle bisher
  bearbeiteten Dateien (Phase 1-3) bestätigt 286 DE- = 286 EN-Schlüssel, alle verwendeten
  Schlüssel in beiden Wörterbüchern vorhanden.

## 2026-10-25 - Vollständige Englisch-Übersetzung, Phase 1+2 (Login/2FA, Nutzer-Dashboard)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Befund: Das Wörterbuch in `js/lang.js` (`Lang.translations.de`/`en`) war bereits umfangreich,
  aber an sehr vielen Stellen im Code stand deutscher Text direkt als String im JS statt per
  `Lang.t('key')`/`Lang.format('key', {...})` übersetzt zu werden -- die Lücke lag in der
  Anwendung des vorhandenen Mechanismus, nicht im Wörterbuch selbst.
- **Phase 1 (Login/2FA):** `js/auth.js` und `script.js` hatten für die Login-/
  Account-Anfrage-/2FA-Oberfläche 0 bzw. nur vereinzelte `Lang.t()`-Aufrufe. Alle hartkodierten
  Strings (Toast-Meldungen, Modal-Überschriften, Button-Titel/aria-label, QR-Anleitung,
  Begrüßungstexte mit Namens-Interpolation) auf `Lang.t()`/`Lang.format()` umgestellt; `index.html`
  um 13 `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`/`data-i18n-aria-label`-Attribute
  ergänzt. `Lang.applyToDOM()` um die Behandlung von `data-i18n-title`, `data-i18n-aria-label` und
  `data-i18n-alt` erweitert (bisher nur `textContent` und `placeholder`).
- **Phase 2 (Nutzer-Dashboard):** `dashboard.html` um 28 `data-i18n*`-Attribute ergänzt (Topbar,
  Neues-Ticket-Formular, Ticket-Liste, Ticket-Modal inkl. aller Meta-Labels, Chat-Toolbar,
  Prioritäts-Auswahl). `js/user-dash.js` hatte dafür keine Entsprechung zu
  `Lang.applyAdminDOM()` -- alle ~20 betroffenen Stellen (Toasts, Genehmigungs-Texte mit
  Namens-/Datums-Interpolation, Datei-Anhang-Chips, E-Mail-Betreff/-Text für neue Tickets,
  Rückmeldungs-Erinnerung, Status-Badges) auf `Lang.t()`/`Lang.format()` umgestellt. Eine eigene
  `Lang.applyUserDOM()`-Funktion wurde zwar als Platzhalter angelegt, ist aber bewusst leer
  geblieben: anders als in der Admin-Oberfläche steht `data-i18n` in `dashboard.html` immer auf
  einem reinen Text-Element, nie auf dem Icon-Elternelement, wodurch das normale
  `textContent`-Ersetzen kein Icon überschreibt.
- 38 neue Schlüsselpaare in `js/lang.js` ergänzt (DE und EN je gleich viele); automatischer
  Konsistenz-Check bestätigt 240 DE- = 240 EN-Schlüssel und dass jeder in Phase 1+2 verwendete
  Schlüssel in beiden Wörterbüchern existiert.
- Noch offen (nächste Schritte, separat geplant): `js/todos.js`, `js/admin-board.js`,
  `js/settings.js`, `js/ui.js` sowie restliches statisches Markup und das Aufräumen bestehender
  Ad-hoc-Ternarys in `js/lang.js`.

## 2026-10-25 - Regression aus der CSP-Härtung behoben (Listenansicht & weitere verschwundene UI-Elemente), Logo-Druck-Bug
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **Eigener Bug aus der letzten CSP-Härtungsrunde gefunden und behoben:** `style.css` enthält
  `[hidden] { display: none !important; }`. Beim Entfernen von `style="display:none"` zugunsten
  des `hidden`-Attributs (CSP ohne `style-src 'unsafe-inline'`) blieb der bestehende Toggle-Code
  an mehreren Stellen unverändert bei `element.style.display = '...'` -- eine per JS gesetzte
  inline `style.display` kann aber eine `!important`-Regel nicht schlagen, die Elemente blieben
  dadurch für immer unsichtbar, unabhängig vom tatsächlichen Zustand. Betroffen und jetzt auf
  `element.hidden = true/false` umgestellt: die Listenansicht (`#list-view`, erschien nie mehr),
  der "System-Logs"-Button in der Navbar, der "Einer Störung zuordnen"-Button, der
  "Archivieren"/"Reaktivieren"-Button im Ticket, das Admin-Zusatzfeld und die LDAP-Box im
  Benutzer-Bearbeiten-Dialog sowie der Optionen-Editor bei Auswahl-Zusatzfeldern.
- **Firmenlogo fehlte beim Drucken (Tickets, Gruppenmitglieder, Auswertungen):** alle vier
  Druckfunktionen lasen `settings.companyBranding.logoDataUrl`, gespeichert wird das Logo aber
  unter `settings.companyBrandingConfig` (mit "Config"-Suffix) -- ein reiner Property-Namens-
  Tippfehler, der das Logo immer leer ausfallen ließ. Alle vier Stellen korrigiert.
- Geprüft und als korrekt bestätigt (kein Bug gefunden): Datumsauto-Formatierung bei
  Kontogültigkeit und beim Outlook-Termin-Dialog (beide nutzen bereits `UI.bindDateInput`,
  identisch zu anderen funktionierenden Datumsfeldern) sowie die gemeldeten Browser-
  Konsolenfehler zum "message channel" (stammen nachweislich nicht aus dem eigenen Code, enthält
  kein `chrome.runtime`/`browser.runtime` -- typisches Symptom einer installierten
  Browser-Erweiterung).
- Klargestellt, kein Bug: Der In-App-Updater lehnt Updates aktuell bewusst ab, weil kein Commit
  im Repository signiert ist -- exakt die in R-14 (siehe vorheriger Audit-Eintrag) beschriebene,
  gewollte Fail-Closed-Sicherung. Erst durch Einrichten einer Commit-Signatur nutzbar.

## 2026-10-24 - Security-Audit R-10 bis R-17 behoben
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **R-10 (CVE-2026-15144, mittel/hoch bei IPv6):** `@fastify/rate-limit` von 10.2.2 auf ^11.2.1
  angehoben und `ipv6Subnet: 64` in der globalen Registrierung (`app.ts`) explizit gesetzt --
  vor 11.2.0 bildete die Bibliothek den Zähler aus dem rohen `req.ip`-Text, wodurch jede neue
  Schreibweise/Adresse aus demselben IPv6-/64-Netz ein frisches Kontingent bekam und das
  Login-Limit (10/min) damit faktisch wirkungslos war. Zwei neue Regressionstests
  (`test/rateLimitIpv6.test.ts`) bestätigen das für wechselnde Adressen im selben /64-Netz UND
  für fünf Schreibweisen derselben Adresse.
- **R-11 (mittel, Konto ohne Anmeldung sperrbar):** Die automatische Sperre nach Fehlversuchen
  hing bisher allein am Konto -- wer einen Benutzernamen kennt (admin, vorname.nachname, ...),
  konnte mit fünf falschen Passwörtern jedes Konto sperren, auch das eines Superadmins, ohne
  selbst angemeldet zu sein. Neuer Mechanismus (`domain/loginThrottle.ts`, Migration 0046,
  Tabelle `login_failure_sources`): die automatische Sperre gilt jetzt nur noch pro
  (Konto, Quellnetz) und ist immer befristet, nie dauerhaft. Für das Konto insgesamt gibt es bei
  anhaltenden Fehlversuchen nur noch eine wachsende Wartezeit (max. 5 Minuten,
  `accountBackoffSecondsRemaining`). `users.locked_permanent`/`locked_until` bleiben unverändert
  für die bewusste, manuelle Sperre durch eine Admin-Person. Neuer Rettungsanker
  `node dist/cli/unlock.js <benutzername>` setzt beides zurück, falls doch einmal niemand mehr
  hereinkommt. Die Einstellungs-Oberfläche ("Was passiert nach Erreichen der Fehlversuche?")
  wurde entsprechend vereinfacht. Eigene Unit-Tests (`test/loginThrottle.test.ts`) decken dabei
  einen echten Bug in der ersten Fassung der IPv6-/64-Normalisierung auf (führende Nullen wie
  "0db8" vs. "db8" wurden als unterschiedliche Netze behandelt) und bestätigen die Korrektur.
- **R-12 (mittel, Step-up ohne Fehlversuchsgrenze):** Passwortwechsel
  (`POST /api/v2/users/:id/change-password`) sowie 2FA-Neueinrichtung und -Abschaltung
  (`POST /api/v2/mfa/setup`, `/mfa/disable`) hatten bisher kein eigenes Rate-Limit und keinen
  Fehlversuchszähler -- eine übernommene Session hätte das aktuelle Passwort dort mit hoher Rate
  raten können. Jetzt: eigenes Rate-Limit (5 pro 15 Minuten, Schlüssel = Session bzw. IP) und
  dieselbe Pro-Quellnetz-Sperre wie beim Login (R-11) bei jedem Fehlversuch. 2FA-Abschaltung
  verlangt zusätzlich einen gültigen TOTP-Code (nicht mehr nur das Passwort), wird ins
  `global_audit_log` eingetragen und löst eine Warn-Mail ans eigene Konto aus.
- **R-13 (niedrig, Klartext-Kopien im Audit-Log):** Genehmigungsgrund, Entscheidungsbegründung
  und Kalender-Betreff standen trotz verschlüsselter Originalspalte (`tickets.approval_text`,
  `ticket_calendar_events.subject`) zusätzlich im Klartext in `ticket_audit_log.new_value` --
  ein DB-Dump/Backup hätte sie trotz Verschlüsselungszusage preisgegeben. Jetzt nur noch
  vermerkt, DASS eine Begründung mitgegeben wurde ("mit Begründung"), nie ihr Inhalt; Migration
  0047 bereinigt bestehende Alteinträge per `REGEXP_REPLACE`.
- **R-15 (niedrig, Mails an beendete Konten / abstürzende Requests):** `queueUserMail` prüfte
  bisher nur `account_archived` -- dauerhaft gesperrte und per Ablaufdatum beendete Konten
  bekamen weiterhin Benachrichtigungen mit Ticketinhalten an ihre (eventuell private) Adresse.
  Jetzt zusätzlich `locked_permanent`/`isAccountExpired` geprüft. Zudem brach ein Fehler beim
  Einreihen (`createNotification`) bisher den ganzen aufrufenden Request mit HTTP 500 ab, obwohl
  die In-App-Benachrichtigung schon erfolgreich gespeichert war -- jetzt in try/catch gefasst und
  nur noch geloggt.
- **R-16 (niedrig, DSGVO-Datenminimierung):** `GET /api/v2/users/directory` gab bisher
  Kontaktdaten (E-Mail, Telefon, Mobilnummer, Funktion, Standort, Vorgesetzte) ALLER aktiven
  Konten an jede angemeldete Rolle "user" heraus, inklusive aller Admin-Konten -- ein einzelnes
  kompromittiertes Nutzerkonto hätte damit eine vollständige Liste fürs Phishing geliefert. Für
  die Rolle "user" jetzt nur noch `id`/`username`/`name` (ausreichend für Erwähnungen,
  Zuweisungsanzeige und Auswahlfelder); volle Kontaktdaten bleiben Admin-/Superadmin-Konten
  vorbehalten.
- **R-17 (niedrig, veraltete Abhängigkeiten):** `mysql2`, `kysely`, `@fastify/helmet`, `argon2`,
  `file-type` auf den aktuellen Patch-/Minor-Stand gehoben; `DOMPurify`-Vendor-Datei von 3.4.16
  auf 3.4.17 (schließt drei gemeldete Advisories, Prüfsumme in `vendor/VERSIONS.md` aktualisiert).
  `pino` (Major-Sprung 9→10) sowie die Dev-Only-Pakete `eslint`/`typescript`/`vitest` bewusst
  NICHT angehoben -- größere Breaking-Change-Risiken, die eine eigene Prüfung verdienen, nicht
  sicherheitskritisch in der aktuellen Nutzung. Neuer `.github/dependabot.yml` (npm/Docker/GitHub
  Actions, wöchentlich/monatlich) sowie ein zusätzlicher OSV-Scanner-Schritt in der CI (auf einen
  Commit-Hash fixiert) -- `npm audit` hatte CVE-2026-15144 (R-10) nicht gemeldet, obwohl die
  Lücke öffentlich gelistet war; ein zweiter, unabhängiger Scanner schließt genau diese Lücke im
  Nachweis.
- **R-14 (niedrig, Updater durch unsignierte Commits faktisch gesperrt) -- teilweise:** Die
  Signaturpflicht im Updater ist korrekt (siehe vorheriger Audit), aber kein Commit auf `main`
  ist aktuell signiert, wodurch der optionale In-App-Updater nie aktualisieren kann und Betreiber
  auf manuelle `git pull`-Updates ganz ohne Integritätsprüfung ausweichen. Neues Skript
  `ops/verify-and-pull.sh` (per README referenziert) holt neue Commits und bricht fail-closed ab,
  wenn der neue Stand nicht mit einem bekannten Schlüssel signiert ist, statt ihn ungeprüft zu
  übernehmen. Das eigentliche Signieren der Commits (GPG-Schlüssel erzeugen, `main` damit
  signieren, öffentlichen Schlüssel veröffentlichen) ist eine bewusste Betriebsentscheidung der
  Projektverantwortlichen und wurde hier nicht automatisch vorgenommen.
- **N-3 (mittel, Update-Container mit Host-Root) -- weiterhin bewusst nicht angegangen:** vom
  Audit selbst als "langfristig" (1-2 Tage, Architekturänderung: Updates per systemd auf dem Host
  statt per Docker-Socket im Container) eingestuft, nicht Teil dieser Runde.
- Vollständiger Verifikationslauf: Typecheck, 159 Tests (10 davon neu), Build, Installer-
  Testsuite, JS-/Shell-Syntax und `npm audit` durchgängig grün. `install-manifest.sha256` sowie
  der gepinnte Hash im README-Installationsbefehl neu erzeugt.

## 2026-10-24 - Installer gegen falsch-positive "lokale Änderungen" abgesichert, zod v4
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **`install.sh` bricht nicht mehr grundlos mit "Your local changes ... would be
  overwritten by merge" ab:** Ein Nutzer traf das live, nachdem zwischen seinem ersten
  und zweiten Lauf `.gitattributes` um `eol=lf`-Normalisierung ergänzt wurde -- Git
  bewertete die bereits ausgecheckte `install.sh` dadurch als "lokal verändert",
  obwohl niemand etwas editiert hatte, und `git pull --ff-only` verweigerte sich fünf
  Versuche lang identisch. Das vom Installer verwaltete Klon-Verzeichnis ist nie für
  Handbearbeitung gedacht (Secrets liegen per `.gitignore` außerhalb in
  `ops/docker/.env`), deshalb setzt `install.sh` jetzt vor jedem `git pull --ff-only`
  hart auf den zuletzt bekannten Commit zurück (`git reset --hard HEAD`) -- betrifft
  nur versionierte Dateien, nie die Secrets. Diese Fehlerklasse (egal ob durch
  Normalisierung, eine versehentliche Änderung oder sonst eine Abweichung ausgelöst)
  kann dadurch nicht mehr auftreten.
- **Abhängigkeiten aktualisiert (neue, seit dem letzten Lauf veröffentlichte
  Schwachstellen):** `fastify`/`fast-uri` (Header-Validierung bzw. URI-Scheme-Spoofing/
  Pfad-Verwechslung, Patch-Updates innerhalb des bestehenden Bereichs) und
  `nodemailer` (Adressparser-Lücken, ebenfalls Patch-Update). Zusätzlich `zod` von 3.24
  auf 4.6.7 angehoben (High-Severity: Speichererschöpfung bei übergroßen,
  eingeschränkten Collections) -- ein echter Major-Versionssprung mit API-Änderung:
  `z.record()` verlangt in v4 zwingend ein Schema für die Schlüssel (`z.record(z.string(), ...)`
  statt nur `z.record(...)`), betraf drei Stellen (`tickets.ts` custom_fields,
  `users.ts` notif_prefs, `extras.ts` filters) und wurde angepasst. Vor dem Hochstufen
  mit vollem Typecheck/149 Tests/Build geprüft, nicht blind per `--force` übernommen.
  `npm audit --omit=dev` meldet wieder 0 Schwachstellen.
- `install-manifest.sha256` und der gepinnte Hash im README-Installationsbefehl mit
  `node ops/create-install-manifest.mjs` neu erzeugt (Inhalt von `install.sh`,
  `package.json`/`package-lock.json` und den drei Routen-Dateien hat sich geändert).

## 2026-10-22 - npm-audit-Nachbesserung und Install-Manifest aktualisiert
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Der Security-Audit vom 21.10.2026 (Commit 7e60822) listete R-6 bis R-9, N10-Rest, N11,
  N12, N13, N3, CSP `unsafe-inline` und Image-Digest-Pinning als offen. Beim Nachprüfen
  stellte sich heraus, dass all diese Punkte bereits in Commit `44838e3` (22.10.2026,
  bereits auf `origin/main`) behoben waren -- u.a. `ops/docker/provision-db.sh` (R-6:
  Laufzeit-Konto wird erst nach erfolgreicher TLS-Verifikation in die `.env`
  geschrieben, nie vorher), `requireAdmin` + Empfänger-Blind-Index + Rate-Limit am
  Kalender-Endpunkt (R-7), fail-closed `decryptFieldTolerant` (R-8), `mail_secrets_enc`
  für S/MIME/DKIM (R-9), harte Ablehnung einer Ticket-Zusammenführung bei
  unterschiedlichem Ersteller (N11), `recipient_user_id` statt Benutzername bei
  Benachrichtigungen (N12), Prüfsummen-Manifest `install-manifest.sha256` für den
  Installer (N13), Mail-Versand über die `jobs`-Tabelle (N3), CSP ohne `unsafe-inline`
  und Image-Digests in `docker-compose.yml`.
- Zwei dabei neu aufgetretene, bis dahin ungeprüfte Dependency-Lücken geschlossen:
  `fastify` (Header-Validierungs-Bypass, Patch-Update innerhalb des bestehenden
  `^5.2.1`-Bereichs) und `sanitize-html` (unbegrenzte Rekursion beim erneuten
  Bereinigen eines verworfenen iframe-Fallbacks, DoS-Risiko; Pin von 2.18.0 auf
  2.18.1 angehoben). `npm audit --omit=dev` meldet wieder 0 Schwachstellen.
- `install-manifest.sha256` sowie der darauf aufbauende gepinnte Hash im
  `curl | bash`-Einzeiler in README.md mit `node ops/create-install-manifest.mjs`
  neu erzeugt, da sich durch das Dependency-Update die Prüfsummen von `package.json`/
  `package-lock.json` geändert hatten (`--check` bestätigt jetzt wieder Konsistenz).
- Vollständiger Verifikationslauf: Typecheck, 149 Tests, Build, JS-/Shell-Syntax und
  `npm audit` grün. Der echte MariaDB-Integrationstest (`ops/tests/mariadb-security.mjs`,
  bereits von einer vorherigen Sitzung ergänzt, deckt u.a. die serverseitige Mail-Queue
  und die JSON-String-Rückgabe von mysql2 ab) läuft lokal mangels Docker nicht --
  Bestätigung steht beim nächsten GitHub-CI-Lauf aus.

## 2026-10-20 - Zeitstempel bei Teilaufgaben, verbindliches Ticketnummer-Format
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- **Erledigungszeitpunkt bei Teilaufgaben:** Checkt man eine Teilaufgabe ab, wird jetzt Datum und
  Uhrzeit direkt neben dem (durchgestrichenen) Text angezeigt. Neue Spalte `done_at` auf
  `ticket_todos` (Migration `0036_todo_completed_at.ts`); wird beim Abhaken gesetzt und beim
  erneuten Öffnen wieder entfernt, da sie dann nicht mehr erledigt ist.
- **Ticketnummer-Format gegen Fehlkonfiguration abgesichert:** Ohne den Platzhalter `{number}`
  im Format wären Ticketnummern nicht mehr eindeutig unterscheidbar (die Erzeugung ist intern
  zwar bereits immer auf eine stillschweigende Rückfall-Vorlage ausgewichen, das Problem war in
  den Einstellungen selbst aber nie sichtbar). `PATCH /api/v2/settings` lehnt ein Format ohne
  `{number}` jetzt bereits beim Speichern ab (für `ticketNumberFormat.format` und jede
  Kategorie-Vorlage in `ticketNumberCategoryFormats`). Zusätzlich darf die Stellenzahl
  (`padding`) nicht mehr unter die Ziffernzahl der bereits höchsten vergebenen Ticketnummer
  gesenkt werden (Prüfung gegen den aktuellen Höchstwert aus `tickets.ticket_number`). Ein
  Überlauf (z. B. Zähler erreicht beim Format mit drei Stellen die Zahl 1000) führt ohnehin nie
  zu einem Abschneiden oder einer Kollision: die Zahl selbst wird nie gekürzt, nur die führenden
  Nullen reichen bei Bedarf automatisch nicht mehr aus und die Nummer wird einfach länger.
- **Hilfe-Icons bei den E-Mail-Einstellungen:** Jedes Feld im Bereich "E-Mail / SMTP" (SMTP-Host,
  Port, Verschlüsselung, Zugangsdaten, Absender, Vorlage/Signatur, Transport-Sicherheit,
  Zertifikatsprüfung, S/MIME- und DKIM-Schlüssel) hat jetzt ein Fragezeichen-Icon daneben, das
  beim Hovern bzw. per Tastaturfokus über das bereits vorhandene app-weite Tooltip-System
  (`UI.initTooltips()`) erklärt, wofür das Feld gut ist.
- **Outlook/Microsoft Graph-Integration ist jetzt funktionsfähig (App-only, Kalendertermine):**
  Bisher gab es in den Systemeinstellungen nur Konfigurationsfelder ohne jede Anbindung. Jetzt
  kann aus einem Ticket heraus (neues Kalender-Icon neben der Lösungsfrist) über einen echten
  Microsoft-Graph-Aufruf ein Termin im konfigurierten Postfach angelegt werden -- vorbelegt mit
  der aktuellen SLA-/manuellen Frist, kombinierbar mit einem eigenen Zeitraum und einer Notiz.
  - Neuer dependency-freier Client (`domain/graphClient.ts`, gleiche Abwägung wie bei S/MIME:
    kein `@azure/msal-node`/`@microsoft/microsoft-graph-client`, nur zwei schlanke REST-Aufrufe):
    App-only-Client-Credentials-Flow gegen `login.microsoftonline.com`, danach
    `POST /users/{mailbox}/events` gegen Microsoft Graph.
  - Das Client-Secret liegt -- anders als bisher die S/MIME-/DKIM-Schlüssel -- NICHT im Klartext
    in `config_json`, sondern verschlüsselt in einer eigenen Spalte (`outlook_client_secret_enc`,
    Migration `0037_outlook_calendar_events.ts`), analog zu `smtp_password_enc`/
    `ldap_bind_password_enc`. Eigener Endpoint `PATCH /api/v2/settings/outlook/secret` (nur
    Superadmin), nie über `GET /api/v2/settings` lesbar.
  - Neue Routen `GET/POST /api/v2/tickets/:id/calendar-event(s)`: legt den Termin an, verknüpft
    ihn über eine neue Tabelle `ticket_calendar_events` mit dem Ticket (gleicher Zugriffsschutz
    wie bei Teilaufgaben/Beteiligten: Ersteller des Tickets oder Admin/Superadmin) und protokolliert
    die Aktion im Ticket-Audit-Log.
  - Eingehende E-Mails automatisch zu Tickets zu machen (Mailbox-Sync) bleibt weiterhin nicht
    verfügbar -- das verlangt einen dauerhaft laufenden Sync-Dienst und ist bewusst nicht Teil
    dieser Änderung; die entsprechenden Kästchen in den Einstellungen sind weiterhin deaktiviert
    und als "noch nicht verfügbar" gekennzeichnet.

## 2026-10-20 - Zwei Regressionen aus dem letzten Update behoben (R-1, R-2) plus R-3 bis R-5, N-3- und N9-Nachbesserung
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Externer Security-Audit (Commit ecb296b) fand zwei durch das letzte Sicherheitsupdate selbst
  eingeführte Hoch-Befunde sowie drei neue Niedrig-Befunde. Alle fünf sind behoben, dazu zwei
  bereits als "Teilweise" geführte Punkte (N-3, N9) weiter geschlossen:
  - **R-1 (Hoch, Regression) `trustProxy` blockierte faktisch alle Logins hinter einem gemeinsamen
    Limit:** Fastify 5.12.5 behandelt `trustProxy` als Zahl bewusst als "keinem Proxy vertrauen"
    (fail-closed) -- die vorherige Annahme, eine Hop-Zahl würde wie erwartet funktionieren, war
    mit dieser Fastify-Version falsch. `req.ip` zeigte dadurch für JEDE Anfrage auf die
    Caddy-Adresse, wodurch sich alle Benutzer ein einziges Login-Rate-Limit (10/min) teilten --
    zehn Versuche einer Person sperrten den Login für alle anderen. Fix: `TRUSTED_PROXY_CIDR`
    (ein konkretes Subnetz, z. B. das `edge`-Docker-Netz, in dem nur Caddy läuft) ersetzt die
    Hop-Zahl; `docker-compose.yml` gibt dem `edge`-Netz dafür ein festes Subnetz
    (`172.30.250.0/24`). Neuer Regressionstest (`test/trustProxy.test.ts`, 3 Fälle) prüft
    dauerhaft: ohne Konfiguration vertraut der Server niemandem, mit Konfiguration liefert
    `req.ip` die echte Client-Adresse, und ein direkter Client außerhalb des vertrauten Netzes
    kann `X-Forwarded-For` nicht fälschen.
  - **R-2 (Hoch, Regression) Ausfall nach Update durch unverschlüsselte Altwerte:** die
    Migrationen 0034/0035 (vorherige Sitzung) hatten den Spaltentyp von approval_text/
    waiting_message/Kontaktfeldern auf verschlüsselt umgestellt, aber vorhandene Klartextwerte nie
    tatsächlich verschlüsselt -- jeder Lesezugriff auf einen Altwert scheiterte mit
    "Invalid authentication tag length"/"Unsupported state", wodurch `GET /api/v2/tickets`,
    `/api/v2/users`, `/users/me` und das Verzeichnis komplett mit 500 ausfielen, sobald auch nur
    ein Datensatz betroffen war. Fix in zwei Schichten: (1) `db/reencryptLegacy.ts` läuft jetzt
    automatisch am Ende jedes `migrate.js`-Laufs (neue wie bestehende Installationen), erkennt
    bereits verschlüsselte Werte (übersprungen) gegenüber Klartext (nachträglich verschlüsselt)
    und ist idempotent -- betrifft also auch Installationen, die das letzte Update schon vor
    diesem Fix eingespielt hatten, sobald sie erneut migrieren. (2) Zusätzliches Sicherheitsnetz:
    `fieldCrypto.ts` `decryptFieldTolerant()` fängt einen Entschlüsselungsfehler für genau diese
    sechs Felder ab und zeigt den Rohinhalt als Text, statt die ganze Liste mit 500 abstürzen zu
    lassen (gilt NICHT für Kernfelder wie title/description/name/email, die von Anfang an
    verschlüsselt waren -- dort bleibt ein Entschlüsselungsfehler bewusst ein echter Fehler).
  - **R-3 (Niedrig) Setup ohne Token, wenn `SETUP_TOKEN` fehlt:** `install.sh` setzt das Token
    zwar immer, bei manueller Installation/eigener `.env` ohne diese Variable war das Setup aber
    weiterhin unauthentifiziert erreichbar (fail-open). Jetzt fail-closed: ohne konfiguriertes
    `SETUP_TOKEN` lehnt die Einrichtung in Produktion ab (503); nur `NODE_ENV=development`
    erlaubt es weiterhin ohne Token.
  - **R-4 (Niedrig) DB-Zugangsdatei blieb im MariaDB-Container zurück:** `backup.sh`, `restore.sh`
    und `install.sh` riefen die temporäre Zugangsdaten-Datei über `exec mariadb[-dump] ...` auf --
    `exec` ersetzt den Shell-Prozess, wodurch der zuvor registrierte `trap ... EXIT` nie ausgelöst
    wurde und die Datei (Benutzername+Passwort des vollen DB-Kontos, `/tmp`, Rechte 0600) liegen
    blieb. Fix: `exec` entfernt, der Exit-Code wird wie zuvor einfach durchgereicht.
  - **R-5 (Niedrig) S/MIME-Versand verlor BCC und ließ Header-Injection zu:** nodemailer baut bei
    einer fertigen, bereits signierten Nachricht (`raw`) keine Header mehr aus eigenen Feldern --
    das `bcc`/`replyTo`-Feld wurde dadurch bei jeder S/MIME-signierten Mail stillschweigend
    ignoriert, und ein Betreff mit `\r\n` (erreichbar über `POST /api/v2/mail/send`, nur Admins)
    hätte eigene Mail-Header einschleusen können. Fix: `domain/smime.ts` lehnt `\r`/`\n` in
    Header-Werten hart ab und kodiert Nicht-ASCII-Zeichen nach RFC 2047; `mail/mailer.ts` nimmt
    das BCC-Archiv jetzt im `envelope.to` auf (dem einzigen Feld, das bei `raw` tatsächlich die
    SMTP-Zustellung steuert) und reicht `replyTo` explizit an den S/MIME-Header-Aufbau durch.
  - **N-3 (weitere Härtung) Signierte Commits jetzt automatisch Pflicht, sobald ein Schlüssel
    vorhanden ist:** `UPDATE_REQUIRE_SIGNED_COMMITS` bleibt explizit setzbar, erkennt ohne
    gesetzten Wert aber jetzt selbst beim Start, ob bereits ein GPG-Schlüssel im
    Updater-Container importiert wurde (`gpg --list-keys`) -- ist das der Fall, wird die
    Signaturprüfung automatisch zur Pflicht (sicher sobald konfiguriert), ohne Installationen
    ohne Schlüssel durch einen rückwirkend geänderten Standardwert auszusperren.
  - **N9 (vollständig statt teilweise) App-Container ohne DDL-Konto:** `DB_USER`/`DB_PASSWORD`
    (volle Rechte) stehen nicht mehr in der ständigen Umgebung des lang laufenden
    App-Containers -- nur noch das eingeschränkte `DB_RUNTIME_USER`/`DB_RUNTIME_PASSWORD`
    (`env.ts`: `DB_USER`/`DB_PASSWORD` jetzt optional, mit Prüfung, dass mindestens ein
    Kontopaar vorhanden ist; `connection.ts` wirft eine klare Fehlermeldung statt eines
    kryptischen mysql2-Fehlers, falls für den jeweiligen Zweck die passenden Zugangsdaten
    fehlen). `Dockerfile.server` führt Migrationen nicht mehr automatisch beim Containerstart
    aus; sie laufen separat (`install.sh`, `updater-server.mjs` `runMigrate()`) mit den vollen
    Zugangsdaten nur für diesen einen kurzlebigen Aufruf -- und zwar, wie schon bei R-4, per
    stdin/temporärer Optionsdatei im Zielcontainer statt als `-e`-Kommandozeilenargument.
  - `apps/server/.env.example` und `test/appBoot.test.ts` an die `TRUSTED_PROXY_CIDR`-Umbenennung
    angepasst; 98 statt 95 Tests insgesamt (3 neue Fälle für R-1).
- Bewusst noch nicht umgesetzt (vom Audit selbst als mittel-/langfristig eingestuft, nicht Teil
  der "Dringendste Maßnahmen"): N10-Rest (Regeln wiederkehrender Tickets, `custom_fields_json`,
  Kontoanfragen-Freitext, Mail-Schlüssel in `config_json` weiter Klartext), N11 (Zusammenführung
  zeigt weiter Nachrichten fremder Ersteller), N12 (Benachrichtigungen per Benutzername statt
  -ID), N13 (Installer weiter per `curl | bash`), Container-Images auf Digests festlegen (erfordert
  Abgleich gegen eine echte Registry, nicht ohne Netzwerkzugriff auf eine vertrauenswürdige Quelle
  verlässlich möglich), CSP ohne `style-src 'unsafe-inline'`, Mailversand über eine Queue (N3).
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - In-App-Update gehärtet statt entfernt (N3, Fortsetzung)
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Auf Nachfrage: statt die In-App-Update-Funktion komplett durch einen Host-systemd-Umbau zu
  ersetzen (siehe vorheriger Eintrag, N3 "bewusst zurückgestellt"), bekommt die bestehende
  Funktion mehrere unabhängige, zusätzliche Verteidigungsschichten:
  - **Step-up-Bestätigung:** `POST /api/v2/update/run|migrate|rollback` verlangen jetzt zusätzlich
    zu "nur Superadmin" das aktuelle Passwort (und bei aktiver 2FA den TOTP-Code) direkt vor der
    Ausführung -- eine gekaperte/offen gelassene Admin-Session allein reicht nicht mehr, um Code
    auf dem Server auszuführen (`update.ts` `requireStepUp`, Oberfläche fragt beides in einem
    neuen Bestätigungsdialog ab, `admin-board.js` `confirmStepUp`).
  - **Commit-Pinning ("Prüfsumme"):** die Oberfläche muss den exakten Ziel-Commit-Hash
    mitschicken, den sie zuletzt angezeigt hat; stimmt er nicht mit dem aktuellen Stand bei GitHub
    überein (z. B. weil zwischen Ansehen und Bestätigen ein neuer Commit gepusht wurde), wird
    abgebrochen (`409 commit_mismatch`) statt blind den jeweils neuesten Stand zu übernehmen.
    Wird serverseitig sowohl in der App (`update.ts`) als auch unabhängig davon nochmal im
    Updater-Dienst selbst geprüft (`updater-server.mjs`, gegen TOCTOU zwischen beiden Aufrufen).
  - **Signierte, Replay-geschützte Kommunikation App↔Updater:** zusätzlich zum bisherigen
    Bearer-Token wird jede Anfrage mit HMAC-SHA256 (Schlüssel: `UPDATE_TOKEN`) über
    Methode+Pfad+Zeitstempel+Einmal-Nonce+Body signiert; der Updater verlangt ein enges
    30-Sekunden-Zeitfenster und verwirft bereits gesehene Nonces (`updater-server.mjs`
    `verifyHmac`) -- ein Mitschnitt des internen Docker-Netzwerkverkehrs lässt sich dadurch nicht
    wiederholen.
  - **Rollback:** der Updater merkt sich den Commit von vor jedem erfolgreichen Update
    (`.git/ticket-system-update-history.json`, bewusst außerhalb des Arbeitsverzeichnisses, damit
    er nie als "lokale Änderung" ein künftiges Update blockiert) und kann gezielt (wieder mit
    Step-up + Commit-Pinning) dorthin zurückgesetzt werden (`POST /api/v2/update/rollback`, neuer
    Button in der Oberfläche, nur sichtbar wenn ein Rollback-Ziel bekannt ist). Wichtige
    Einschränkung, im Log nach jedem Rollback und hier dokumentiert: ein Rollback setzt nur den
    CODE zurück, nicht automatisch das Datenbank-Schema (Migrationen sind nur vorwärts gerichtet)
    -- enthielt das rückgängig gemachte Update Migrationen, kann das zu Inkompatibilitäten führen;
    im Zweifel zusätzlich ein Datenbank-Backup von vor dem Update wiederherstellen
    (`ops/docker/restore.sh`).
  - Jede Aktion (Trigger, abgelehnter Commit-Mismatch, Migration, Rollback) landet mit Akteur und
    Zeitpunkt im globalen Audit-Log.
  - Bereits vorhandene, unverändert gültige Schutzschichten: `UPDATE_ALLOW_MAIN_DEPLOY` (Opt-in,
    Standard aus), `git merge --ff-only` statt `reset --hard` beim normalen Update, Abbruch bei
    lokalen Änderungen, optionale GPG-Signaturprüfung (`UPDATE_REQUIRE_SIGNED_COMMITS`).
  - `apps/server/test/update.test.ts` auf die neue Step-up-/Commit-Pinning-/Signatur-Logik
    umgestellt (95 statt 91 Tests insgesamt, 4 neue Fälle für das gehärtete Verhalten).
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - Zweite Welle: auch die bewusst zurückgestellten Audit-Punkte (N-2, N3, N7-Rest, N9, N10, N14, B7-Rest) geschlossen
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Direkte Fortsetzung des Eintrags "Behebung aller im externen Security-Audit ... gefundenen
  offenen Lücken" weiter unten -- die dort als "bewusst noch nicht umgesetzt" aufgeführten Punkte
  sind jetzt ebenfalls behoben, auf expliziten Wunsch ("Alles muss geschlossen werden"):
  - **N-2 Sicherheitseinstellungen ohne Wirkung (jetzt wirksam):** `mailer.ts` wertet
    `transportSecurity`/`certificateValidation` jetzt tatsächlich für die SMTP-Verbindung aus
    (TLS-Pflicht nur noch bei "opportunistic" deaktivierbar; Zertifikatsprüfung nur bei
    "allow-self-signed"/"disabled" gelockert). DKIM-Signierung über nodemailers eingebaute
    Unterstützung, sobald Domain/Selector/privater Schlüssel hinterlegt sind. S/MIME-Signierung
    (neu: `domain/smime.ts`) baut die komplette signierte MIME-Nachricht über die `openssl
    smime`-CLI (RFC 8551) und übergibt sie via `raw` an nodemailer -- bewusst ohne zusätzliches
    npm-Paket, da das einzige verbreitete reine-JS-CMS/S-MIME-Paket (node-forge) zum Prüfzeitpunkt
    einen offenen, ungepatchten High-Schwachstellen-Eintrag hatte (GHSA-86w9-cpqp-85rv); `openssl`
    läuft wie beim Updater mit `shell:false`/Array-Argumenten. Dockerfile.server installiert
    `openssl` im Runtime-Image nach.
  - **N3 Updater (weitere Härtung):** neue, standardmäßig deaktivierte Option
    `UPDATE_REQUIRE_SIGNED_COMMITS=true` -- verlangt `git verify-commit` gegen einen vorab in den
    Updater-Container importierten GPG-Keyring, bevor gemergt wird (schützt gegen ein
    kompromittiertes GitHub-Konto). Der eigentliche, vom Audit vorgeschlagene Vollumbau
    ("Updates nur noch per Host-systemd, Token nicht im App-Container") würde das bestehende
    "Update installieren"-Bedienkonzept in der Oberfläche ersetzen -- das ist eine Produktentscheidung,
    keine reine Code-Änderung, und wurde hier bewusst NICHT einseitig vorgenommen. Siehe G.
  - **N7 (Rest) LDAP-Freischaltung pro Konto:** neue Spalte `ldap_login_enabled` (Migration 0033,
    Standard `false` für jedes Konto); nur eine Superadmin-Person kann es je Zielkonto umschalten
    (neuer Schalter im Benutzer-Editor, nur für Superadmins sichtbar). Vorherige Session hatte nur
    Superadmin-Konten pauschal ausgeschlossen -- jetzt ist LDAP für JEDES Konto standardmäßig aus,
    nicht nur für Superadmins.
  - **N9 Kein Least-Privilege-DB-Konto:** neues, optionales `DB_RUNTIME_USER`/`DB_RUNTIME_PASSWORD`
    mit nur `SELECT, INSERT, UPDATE, DELETE` (kein `ALTER`/`CREATE`/`DROP`) für den Laufzeitbetrieb;
    Migrationen laufen weiterhin mit dem vollen `DB_USER`/`DB_PASSWORD`-Konto (`db/connection.ts`
    `createDb(env, 'migrate' | 'runtime')`). `install.sh` generiert das Konto automatisch und legt
    es bei einer frischen Installation über `/docker-entrypoint-initdb.d` an; bei einer
    bestehenden Installation (Datenbank schon initialisiert) läuft ein Best-Effort-Versuch direkt
    nach dem MariaDB-Healthcheck -- gelingt er nicht (DB_USER ohne GRANT OPTION), bleibt die
    Installation nutzbar und fällt automatisch auf das bisherige Verhalten zurück (siehe Warnung
    in der Installer-Ausgabe; die GRANT-Anweisungen stehen dann in
    `ops/docker/mariadb/initdb.d/10-runtime-user.sql`).
  - **N10 Uneinheitliche Verschlüsselung:** `approval_text`/`waiting_message` (Tickets, Migration
    0034) sowie `phone`/`mobile`/`job_title`/`office_location` (Benutzerkonten, Migration 0035)
    sind jetzt AES-256-GCM-verschlüsselt wie title/description/name/email -- vorher Klartext in
    der Datenbank. `department`/`department_group_id` bleiben bewusst Klartext (werden für
    Gruppen-/Kategorie-Zuordnung gebraucht, nicht Teil dieses Befunds, siehe bestehender
    Code-Kommentar). CSV-Export/-Import, Benutzerverzeichnis und die Erinnerungs-Mail für
    "Warten auf Antwort"-Tickets (`jobs/maintenance.ts`) wurden entsprechend angepasst.
  - **N14 Backups:** `ops/docker/backup.sh`/`restore.sh` nutzen jetzt `gpg` (symmetrisch, AES256,
    mit Integritätsschutz/MDC) statt `openssl enc` mit unauthentifiziertem AES-256-CBC -- ein
    verändertes Archiv wird beim Entschlüsseln jetzt als manipuliert erkannt statt nur als
    kaputtes tar. Weder das DB-Passwort noch die Backup-Passphrase landen noch als
    Kommandozeilenargument (vorher über `ps aux` für jeden lokalen Prozess auf dem Host sichtbar)
    -- beide laufen über eine temporäre MySQL-Optionsdatei bzw. einen separaten
    Dateideskriptor (`--passphrase-fd 3`). Dieselbe Härtung wurde auch auf die in der ersten Welle
    ergänzte N9-Hilfsroutine in `install.sh` angewendet (dort war beim Schreiben derselbe
    Fehler unterlaufen).
  - **B7 (Rest) Virenscan:** neuer, optionaler ClamAV-Dienst (`install.sh --enable-antivirus`,
    Compose-Profil `antivirus`, eigenes isoliertes Netz + eigenes Netz nur für
    Signatur-Updates) -- `domain/antivirus.ts` spricht das clamd-INSTREAM-Protokoll direkt über
    TCP (bewusst ohne npm-Zusatzpaket). Läuft NACH der bereits vorhandenen Magic-Byte-/
    Inhaltsprüfung in `domain/fileValidation.ts`. Ohne `CLAMAV_HOST` (Standard) bleibt das
    Verhalten unverändert; ist er gesetzt, ist der Scan verbindlich -- ein nicht erreichbarer
    ClamAV-Dienst lässt den Upload mit 503 fehlschlagen statt den Scan still zu überspringen.
    Nicht standardmäßig aktiv (ca. 1-2GB RAM, mehrminütiger Erstlauf für den
    Signatur-Datenbank-Download).
  - Ergänzend: `install.sh` unterstützt jetzt `--domain=` und `--acme-email=` für ein
    vertrauenswürdiges Let's-Encrypt-Zertifikat (siehe vorheriger CHANGES.md-Eintrag, B5) sowie
    `--enable-antivirus`; README.md aktualisiert.
- Damit sind alle in B./C. des Audits gelisteten Befunde mit konkretem Code-/Konfigurationsbezug
  behoben oder (N3 Vollumbau) bewusst als Produktentscheidung zurückgestellt und transparent
  benannt -- siehe G. "Restore testen" (N14) und "echte Produktivnutzung/Entscheidung zu Domain,
  LDAP, HTML-Mails etc." (G.1-G.9 des Audits) bleiben organisatorische/betriebliche Punkte, die
  sich nicht durch Code allein beantworten lassen.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - Behebung aller im externen Security-Audit (Commit a215bc5) gefundenen offenen Lücken
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Grundlage: externer Security-Audit-Bericht ("Security-Audit: Ticket-System-web", 20.10.2026,
  @Simon Prior). M-1 (offenes Mail-Relay) war zu Beginn dieser Sitzung bereits durch eine parallele
  Änderung behoben; alle übrigen Hoch/Mittel-Befunde sowie mehrere Niedrig-Befunde wurden jetzt
  behoben:
  - **B4 (Hoch) Setup-Übernahme nach Installation:** `install.sh` erzeugt jetzt ein Einmal-Token
    (`SETUP_TOKEN`), gibt es nur in der Konsolenausgabe aus; `POST /api/v1/setup/complete`
    vergleicht es mit `timingSafeEqual` (`setup.ts`), das Setup-Formular hat ein neues Token-Feld.
  - **B5 (Hoch) Kein vertrauenswürdiges TLS:** `tls internal` gilt nur noch für IP-Adressen/
    localhost/`--dev`; mit `install.sh --domain=... --acme-email=...` bezieht Caddy automatisch
    ein echtes Let's-Encrypt-Zertifikat (`Caddyfile`, `TLS_POLICY`-Umgebungsvariable).
  - **B6 (Mittel) Nicht-Admins legen Großstörungen an:** `POST /api/v2/tickets` erzwingt
    `type='ticket'` und kein `incident_notice` für alle außer Admin/Superadmin (`tickets.ts`).
  - **B9 (Mittel) Rohes HTML in der Wissensdatenbank:** `sanitizeServerHtml` beim Anlegen/Ändern
    von KB-Artikeln (`knowledge.ts`), `Utils.sanitizeRichHtml` beim Rendern im Frontend
    (`admin-board.js`) -- schließt auch Altbestände.
  - **B12 (Mittel) Gespeicherte SMTP/LDAP-Passwörter an neue Ziele:** bei geändertem Host/Port
    (SMTP) bzw. geänderter URL (LDAP) ist jetzt ein neues Passwort Pflicht; LDAP erlaubt nur noch
    `ldaps://` (`settings.ts`).
  - **B3 (Mittel) 2FA-Neueinrichtung ohne Passwort:** bei bereits aktiver 2FA verlangt
    `POST /api/v2/mfa/setup` jetzt das aktuelle Passwort; das neue Secret landet in der neuen
    Spalte `totp_pending_secret_enc` und wird erst durch `/mfa/confirm` mit gültigem Code
    aktiviert -- das aktive Secret bleibt bis dahin unverändert in Kraft (Migration 0030).
  - **M-2 (Mittel) HTML-Injection in ausgehenden Mails:** Nutzereingaben werden vor dem Einfügen
    in den HTML-Teil escaped; nur die Admin-gepflegte Signatur bleibt HTML (`mailer.ts`).
  - **M-3 (Mittel) Admins übernehmen höher berechtigte Admins:** `change-password`, `mfa-reset`,
    PATCH und DELETE auf ein fremdes Admin-Konto (nicht nur Superadmin-Ziele) sind jetzt
    Superadmins vorbehalten (`users.ts`).
  - **M-4 (Niedrig) Status gesperrter Konten per Zeitmessung erkennbar:** auch für gesperrte/
    archivierte Konten läuft jetzt ein `argon2.verify()`, damit die Antwortzeit nicht verrät, dass
    das Konto existiert (`auth.ts`).
  - **M-5 (Niedrig) Interne Konfiguration für alle lesbar:** `GET /api/v2/settings` liefert
    `emailAdvancedConfig`/`outlookConfig`/`securityConfig` nur noch an Admin/Superadmin
    (`settings.ts`).
  - **M-6 (Niedrig) Kein Schutz des letzten Superadmins:** Herabstufung, Sperre, Archivierung und
    Löschung des letzten aktiven Superadmin-Kontos sind blockiert (`assertNotLastSuperadmin`,
    `users.ts`).
  - **N1 (Niedrig) trustProxy als Boolean:** nutzt jetzt die konfigurierte Hop-Zahl
    (`TRUSTED_PROXY_HOPS`) statt pauschal der gesamten X-Forwarded-For-Kette zu vertrauen
    (`app.ts`).
  - **N2 (Niedrig) Body-Limit 20MB global:** global auf 2MB gesenkt; Anhänge/KB-Anhänge/
    CSV-Import setzen ihr eigenes, höheres Limit auf Routenebene.
  - **N4 (Niedrig) Passwortrichtlinie uneinheitlich:** API-Mindestlänge jetzt 14 Zeichen wie beim
    Setup-Assistenten (`users.ts`, `admin-board.js`).
  - **N6 (Niedrig) TOTP-Replay:** neue Spalte `totp_last_step` (Migration 0031) plus
    `domain/totp.ts` verhindern Mehrfachverwendung desselben Codes innerhalb seines
    Gültigkeitsfensters, race-sicher über eine bedingte UPDATE-Anweisung.
  - **N7 (Mittel) LDAP als Zweitpasswort auch für Superadmins:** Superadmin-Konten sind vom
    LDAP-Fallback jetzt ausgenommen, nur das lokale Passwort zählt (`auth.ts`).
  - **N11 (Mittel) Ticket-Zusammenführung ohne Transaktion:** läuft jetzt vollständig in einer
    Transaktion mit Zeilensperre auf beiden Tickets (`tickets.ts`).
  - **N12 (Niedrig) `priority` im PATCH als freier String:** auf dieselben vier gültigen Stufen
    wie bei der Ticket-Neuanlage beschränkt (`tickets.ts`).
  - **N13 (Niedrig) `/health` öffentlich erreichbar:** über den öffentlichen Caddy-Origin jetzt
    gesperrt (404); der Docker-Healthcheck läuft weiterhin direkt im internen Netz.
  - Nebenbei behoben: ein Test-Mock in `attachment-rights.test.ts` unterstützte die neue
    Tagesquote-Prüfung (B7) noch nicht und lieferte dadurch einen falschen 500er.
- Bewusst noch NICHT umgesetzt (zu großer Umfang für diese Änderung, nicht sicherheitskritisch
  im Sinne einer akuten Ausnutzbarkeit): N-2 (TLS-/Zertifikats-/DKIM-/S-MIME-Optionen im Mailer
  tatsächlich auswerten), N3 (Updater durch Host-systemd mit signierten Release-Tags ersetzen),
  N7 (LDAP-Freischaltung pro Konto statt nur Superadmin-Ausnahme), N9 (getrennte DB-Konten für
  Migration/Laufzeit), N10 (restliche Klartextfelder verschlüsseln), N14 (Backup-Härtung), Idle-
  Timeout für Sessions, B7-Rest (Upload-Allowlist statt Blockliste, Virenscan). Diese bleiben als
  offene Punkte für eine Folgeänderung.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - Fehlgeschlagenes Update erneut installierbar
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Bisher war der Knopf "Update installieren" deaktiviert, sobald kein neuer Commit auf GitHub
  vorlag -- war der letzte Lauf aber z.B. beim Build, der Datenbank-Migration oder dem Neustart
  fehlgeschlagen (lokaler Stand bereits auf der neuesten Version, nur die restlichen Schritte
  nicht durchgelaufen), ließ sich dieser Lauf nicht wiederholen, solange GitHub nichts Neues
  hatte. Der Updater-Dienst (`ops/docker/updater-server.mjs`) führte den vollen Zyklus
  (fetch/merge/build/migrate/restart) bei `/run` ohnehin schon immer unabhängig vom
  Update-Verfügbarkeits-Status erneut aus (ein `git merge --ff-only` auf denselben Commit ist
  ein folgenloses No-Op) -- die einzige Sperre war die UI.
  Jetzt zeigt der Update-Tab in den Systemeinstellungen bei "kein neues Update, aber letzter Lauf
  fehlgeschlagen" einen Hinweis und beschriftet den Knopf als "Letztes Update erneut
  installieren"; der Klick wiederholt Build, Migration und Neustart für die aktuelle Version
  (`js/admin-board.js`, `renderUpdateStatus`).
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - Sicherheits-Selbstaudit (SQLi/XSS/CSRF/IDOR/Upload/Business-Logic u.a.) und Behebung der gefundenen Lücken
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Vollständiger Selbstaudit der Anwendung gegen die OWASP-nahe Liste aus der Anforderung (SQLi,
  XSS, Command/SSTI/XXE/LDAP/NoSQL-Injection, Broken Auth, Brute-Force, Session-Hijacking/
  -Fixation, Broken Access Control/IDOR, Privilege Escalation, Mass Assignment, Unrestricted
  File Upload, Path Traversal, CSRF, Clickjacking, DOM-XSS, CORS, Open Redirect, CSP,
  Security Misconfiguration, SSRF, Sensitive Data Exposure, Insecure Deserialization, Race
  Conditions, Business Logic Flaws, Rate Limiting, Security Logging). Ergebnis: die bestehende
  Härtung (parameterisierte Kysely-Queries, LDAP-Filter-Escaping, `spawn()` ohne Shell,
  durchgängiges `Utils.esc()`, strikte CSP/Helmet/HSTS, keine CORS-Freigabe, argon2id überall,
  serverseitige Rollenprüfung bei jeder Anfrage) deckt die meisten Kategorien bereits ab. Konkret
  gefunden und behoben:
  - **Business Logic Flaw (behoben):** im Genehmigungsworkflow (`POST /api/v2/tickets/:id/request-approval`)
    konnte eine Person mit `approvals`-Recht sich selbst als Prüfer eintragen und die eigene
    Anfrage anschließend selbst genehmigen. Jetzt blockiert: Prüfer darf nicht die anfragende
    Person und nicht die Ersteller-Person des Tickets sein (`tickets.ts`).
  - **Race Condition (behoben):** der Fehllogin-Zähler (`recordFailedLogin`, `auth.ts`) war ein
    ungeschütztes Read-Modify-Write -- parallele Anfragen gegen dasselbe Konto konnten sich
    gegenseitig überschreiben und so die konfigurierte Sperrschwelle unterlaufen. Läuft jetzt in
    einer Transaktion mit Zeilensperre (`SELECT ... FOR UPDATE`).
  - **Account Enumeration per Zeitmessung (behoben):** ein unbekannter Benutzername durchlief
    bisher keinen `argon2.verify()`-Aufruf und war dadurch messbar schneller als "bekannter
    Benutzername, falsches Passwort". Ein einmalig berechneter Dummy-Hash wird jetzt auch für
    unbekannte Benutzernamen verifiziert (`auth.ts`).
  - **IDOR-artige Logiklücke (behoben, war admin-gated):** Notizen/Todos/Zeiteinträge eines
    Tickets ließen sich über `PATCH`/`DELETE` ohne Prüfung ansprechen, ob die ID tatsächlich zum
    Ticket aus dem URL-Pfad gehört. Alle betroffenen Routen prüfen jetzt zusätzlich
    `ticket_id = :id` (`tickets.ts`).
  - **Fehlendes Security-Logging (behoben):** jeder 403 wegen fehlender Admin-/Superadmin-Rolle
    wird jetzt protokolliert (`session.ts`); Passwortänderungen (selbst oder durch Admin) werden
    jetzt im globalen Audit-Log festgehalten, ohne das Passwort selbst zu speichern (`users.ts`).
  - **Fehlendes Rate Limiting (behoben):** `POST /api/v2/users` (Benutzeranlage) und
    `GET /api/v2/users/check-similar` hatten bisher nur das globale 1000/min-Limit.
  - **CSRF (gehärtet):** bisher einzige Verteidigung war `SameSite=Lax` auf dem Session-Cookie.
    Ergänzt um ein klassisches Double-Submit-Cookie-Token: beim Login wird ein zweites,
    nicht-httpOnly Cookie gesetzt, das das Frontend (`js/utils.js`, globaler `fetch()`-Wrapper,
    deckt automatisch jede bestehende und künftige Anfrage ab) als `x-csrf-token`-Header auf
    jede mutierende Anfrage zurückschickt; der Server (`app.ts`) vergleicht beide Werte für jede
    angemeldete, mutierende Anfrage.
  - **Upload-Typprüfung (gehärtet):** die MIME-/Extension-Blockliste für Ticket- und
    Wissensdatenbank-Anhänge ließ sich durch MIME-Parameter/Großschreibung/Leerzeichen umgehen.
    Inzwischen durch eine deutlich umfassendere, inhaltsbasierte Prüfung (`domain/fileValidation.ts`:
    Magic-Bytes für PE/ELF/Mach-O-Binärdateien, Shebang-Erkennung, Inhaltsscan auf
    `<script>`/PHP-Tags/SVG/HTML, echte MIME-Erkennung über `file-type`) ersetzt.
  - Keine ausnutzbaren Funde bei: SQL-Injection, Command-/SSTI-/XXE-/LDAP-/NoSQL-Injection,
    Path Traversal/LFI/RFI, Clickjacking, DOM-XSS, CORS-Fehlkonfiguration, Open Redirect,
    fehlende CSP, SSRF, hartcodierte Secrets, Insecure Deserialization, Mass Assignment,
    Session Hijacking/Fixation, unsichere Passwortspeicherung, fehlende MFA-Durchsetzung.
  - Verbleibendes, bewusst akzeptiertes Restrisiko: das Login-Rate-Limit ist IP-basiert (10/min);
    gegen ein verteiltes Credential-Stuffing über viele IPs hinweg schützt primär der echte,
    pro-Konto geführte Lockout (`securityPolicy.ts`), nicht das IP-Limit selbst.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-20 - Duplikatsprüfung bei Neuanlage, erweiterte Personendaten, Firmenlogo-Upload, Signatur-Konsolidierung, Ticket-Button-Abstände
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Duplikats-/Ähnlichkeitsprüfung beim Anlegen neuer Benutzer: neuer Endpunkt
  `GET /api/v2/users/check-similar?name=&email=` (admin, `canManageUsers`) vergleicht Name/E-Mail
  gegen alle bestehenden Konten (Levenshtein-Distanz ≤2 für "ähnlich", exakte Übereinstimmung von
  Name+E-Mail oder bereits vergebener E-Mail-Adresse für "Duplikat"). Im Benutzer-Bearbeiten-Modal
  (`js/admin-board.js`) erscheint beim Tippen (debounced, 350ms) ein Hinweis; bei einem 100%
  identischen Treffer ist "Anlegen" blockiert, bei nur ähnlichem Namen lediglich ein Hinweis.
  `POST /api/v2/users` lehnt eine bereits vergebene E-Mail-Adresse serverseitig zusätzlich mit
  `409 email_taken` ab (Schutz auch ohne Nutzung der UI-Prüfung).
- Erweiterte Personendaten: neue Felder `phone`, `mobile`, `job_title` (Position/Jobtitel) und
  `office_location` (Standort) je Benutzerkonto -- Klartext-Spalten nach demselben Muster wie das
  bestehende `department`-Feld (kein personenbezogenes Pflichtfeld wie Name/E-Mail, daher nicht
  AES-256-GCM-verschlüsselt). Neue Migration `0029_user_contact_fields.ts`. Sichtbar/bearbeitbar
  im Admin-Benutzer-Editor (neuer Abschnitt "Kontaktdaten"), in CSV-Export/-Import, und -- je nach
  Freigabe in den Systemeinstellungen -- im eigenen Konto-Bereich der betroffenen Person selbst.
- Systemeinstellungen > Sicherheit > "Konto-Selbstverwaltung": vier neue Schalter für die neuen
  Felder ergänzt (bisher nur Name/E-Mail/Abteilung schaltbar), serverseitig über
  `accountSelfServiceFields` in `settings.ts` und die zugehörigen Freigabe-Prüfungen in
  `PATCH /api/v2/users/:id` (`users.ts`) durchgesetzt.
- Firmenbranding: zusätzlich zur bestehenden Logo-URL/Daten-URL kann das Firmenlogo jetzt auch
  direkt als Datei hochgeladen werden (Systemeinstellungen > Unternehmen, Browser-seitige
  Größenprüfung bis 650KB, befüllt automatisch das bestehende URL-Feld).
- E-Mail-Signatur-Wirrwarr behoben: die Signatur gab es bisher doppelt (einmal unter
  Unternehmen/Branding, einmal unter E-Mail/Versand) ohne dass beide tatsächlich beim Versand
  genutzt wurden. Jetzt gibt es die Signatur (Text- und HTML-Variante) nur noch unter dem
  E-Mail-Tab; `apps/server/src/mail/mailer.ts` hängt sie beim tatsächlichen Versand an
  (`sendMail()`, inkl. `replyTo`/`bcc` aus der E-Mail-Konfiguration) -- vorher wurden diese
  Einstellungen gespeichert, aber nie wirklich verwendet.
- Ticket-Modal: die Aktions-Buttons (Status ändern, Zuweisen, etc.) und die kontextabhängigen
  Zusatz-Buttons saßen in zwei getrennten Flex-Containern mit unterschiedlichen Abständen --
  dadurch wirkte die Button-Leiste "zerrissen". Beide liegen jetzt in derselben `.actions-row`
  (Zusatz-Buttons per `display:contents`-Span eingehängt), einheitliche Abstände.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-19 - Diagnose: generische 500er (Systemeinstellungen/Chat/Ticket-Status) durch hinterherhinkende Datenbank-Migrationen
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- Befund (vom Nutzer gemeldet, mit vollständiger Konsolenausgabe): `PATCH /api/v2/settings`,
  `POST /api/v2/tickets/:id/messages` und `PATCH /api/v2/tickets/:id` scheiterten durchgängig
  mit 500 "internal_error" -- Systemeinstellungen speichern, Chat-Nachrichten senden und
  Ticket-Status ändern waren dadurch praktisch komplett unbenutzbar.
- Ursache: Zwischen den letzten Prüfrunden wurden vier neue Migrationen ergänzt (u.a.
  `0025_app_settings_config_mediumtext.ts` -- deren eigener Kommentar bereits exakt
  dokumentiert: "TEXT ist dafuer zu klein und fuehrt in MariaDB zu 500ern beim Speichern").
  Diese Migrationen liegen zwar im Repository, wurden aber auf der laufenden Installation nie
  angewendet -- vermutlich, weil ein früherer Update-Lauf vor dem Migrations-Schritt
  abgebrochen ist (siehe 502-Befund vom 11.10., inzwischen behoben). Der App-Container lief
  bereits mit dem neuen Code, der neue, größere `config_json`-Spaltentyp (und weitere neue
  Spalten) fehlten aber noch in der Datenbank -- jede Schreiboperation, die diese erwartete,
  schlug fehl.
- Fix: neuer, vom vollen Update-Zyklus unabhängiger Weg, die Datenbank ohne Code-Update auf den
  aktuellen Schema-Stand zu bringen (bisher nur über den kompletten, durch "kein Update
  verfügbar" blockierten Update-Lauf erreichbar):
  - `ops/docker/updater-server.mjs`: neuer `POST /migrate`-Endpunkt, führt
    `docker compose run --rm --no-deps app node dist/db/migrate.js` direkt aus (120s Zeitlimit).
  - `apps/server/src/http/routes/update.ts`: neue Route `POST /api/v2/update/migrate`
    (nur Superadmin), proxyt zum Sidecar.
  - `js/store.js`/`js/admin-board.js`: neuer, immer aktiver Knopf "Datenbank-Migrationen
    ausführen" in Systemeinstellungen > Update, unabhängig davon ob ein Code-Update verfügbar
    ist.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

## 2026-10-19 - CodeQL "Insecure randomness" (#10, #11) und ungewollt installiertes Playwright entfernt
- Verantwortliche Person: U:Bodigat (mit KI-Unterstützung)
- GitHub Code Scanning (CodeQL) meldete zwei offene "High"-Befunde `js/insecure-randomness` in
  `js/store.js`, zurückverfolgbar auf `Utils.uid()` (`js/utils.js`), das `Math.random()` für
  vorläufige Objekt-IDs nutzte (u.a. für neu angelegte Benutzer, bevor die echte, serverseitig
  vergebene ID zurückkommt). Fix: `Utils.uid()` nutzt jetzt `crypto.randomUUID()` statt
  `Math.random()` -- räumt den Befund an der Quelle aus, unabhängig davon, welcher konkrete
  Aufrufort als sicherheitsrelevant eingestuft wird. `Utils.secureToken()` (echte
  Passwort-Fallbacks) nutzte bereits korrekt `crypto.getRandomValues()`.
- Zusätzlich entfernt: eine komplette Playwright-E2E-Testinfrastruktur
  (`playwright.config.mjs`, `tests/frontend/`, `@playwright/test`-Abhängigkeit,
  `test:ui`-Skript), die ohne entsprechende Anforderung installiert worden war -- inklusive
  349&nbsp;MB heruntergeladener Browser-Binärdateien im lokalen Benutzer-Cache
  (`~/AppData/Local/ms-playwright`), ebenfalls entfernt.
- Herkunft: https://github.com/ubodigat/Ticket-System-web
- Quellcode der veröffentlichten Version: lokale Arbeitskopie, noch nicht veröffentlicht

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
