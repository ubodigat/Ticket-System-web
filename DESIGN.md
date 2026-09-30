# Designkonzept – Support Portal

Dieses Dokument ist das **verbindliche Design-System** für das gesamte Portal: Startseite, Benutzer-Dashboard, Adminbereich und jedes Modal, jede Liste und jeden Button, auch solche, die `script.js` erzeugt. Es beschreibt den Stand, der in `style.css` umgesetzt ist, und die Regeln für alle künftigen Änderungen.

> **Grundregel:** Es gibt für jede Aufgabe genau **ein** Bauteil. Neue Oberflächen setzen sich ausschließlich aus den Tokens und Komponenten dieses Dokuments zusammen. Fehlt etwas, wird zuerst das Konzept und `:root` ergänzt, nie eine einzelne Stelle im Code.

---

## 1. Leitbild

Das Portal ist ein **ruhiges Arbeitswerkzeug mit Glasflächen**. Inhalte (Tickets, Nachrichten, Personen) stehen im Vordergrund, die Oberfläche tritt zurück.

| Prinzip | Bedeutung |
|---|---|
| **Ein Bauteil pro Aufgabe** | Ein Button-System, ein Badge-System, ein Listen-System, ein Modal-Aufbau. Keine Sonderlösungen. |
| **Eine Höhe pro Zeile** | Alles, was nebeneinandersteht (Feld, Auswahl, Button), hat dieselbe Höhe (`--control-h`) und denselben Radius (`--radius-control`). |
| **Eine Sprache für Zustände** | Hover, Auswahl und Fokus sehen überall gleich aus, egal ob Option, Tab, Checkbox-Zeile oder Navigation. |
| **Eine Akzentfarbe** | Farbe heißt „interaktiv“ oder „ausgewählt“. Sie ist vom Nutzer einstellbar und wird deshalb nie fest codiert. |
| **Semantik nur für Bedeutung** | Grün, Gelb, Rot, Blau nur für Status und Priorität. |
| **Hell = Dunkel** | Jede Komponente funktioniert in beiden Themes und mit jeder Akzentfarbe. |

---

## 2. Tokens

Alle Tokens stehen in `:root` (dunkel) und `:root.light` (hell) in `style.css`.

### 2.1 Farben

| Token | Dunkel | Hell | Verwendung |
|---|---|---|---|
| `--bg1` / `--bg2` | `#0b0f1a` / `#131a2a` | `#f6f7fb` / `#eef1f8` | Seitenverlauf; `--bg2` auch Modal- und Listenhintergrund |
| `--glass` | `rgba(20,25,40,.75)` | `rgba(255,255,255,.85)` | Panels (Karten, Spalten, Topbar) |
| `--card-bg` | `rgba(255,255,255,.05)` | `#fff` | Kacheln auf Panels, Modal-Fußbereich |
| `--card-hover` | `rgba(255,255,255,.08)` | `#f8fafc` | Hover von Zeilen, Info-Flächen, Badges |
| `--field-bg` | = `--card-bg` | = `--card-bg` | **Alle** Eingabefelder, Auswahlfelder, Auswahlzeilen |
| `--border` | `rgba(255,255,255,.1)` | `#e2e8f0` | Alle Rahmen und Trennlinien |
| `--text` / `--text-sec` | `#e8ecf1` / `#a7b0c4` | `#0f172a` / `#475569` | Inhalt / Labels und Metadaten |

**Akzent** (von `Settings.apply()` gesetzt): `--primary-solid`, `--primary-rgb`, `--primary-grad`.

**Semantik** (jeweils mit `-rgb`-Variante; im hellen Theme dunkler für Kontrast):

| Token | Bedeutung |
|---|---|
| `--info` | Status *Neu*, Priorität *Niedrig* |
| `--success` | Status *Geschlossen*, Priorität *Normal* |
| `--warning` | Status *In Bearbeitung*, Priorität *Hoch*, Kontoanfragen |
| `--danger` | Priorität *Kritisch*, Löschen |

### 2.2 Zustände – überall identisch

| Token | Wert | Wo |
|---|---|---|
| `--hover-bg` | Akzent 10 % | Hover auf Optionen, Tabs, Ghost-Buttons, Protokollzeilen |
| `--hover-border` | Akzent 35 % | Hover-Rahmen von Feldern und Auswahlzeilen |
| `--sel-bg` | Akzent 16 % | **Ausgewählt**: Option, Tab, Checkbox-Zeile, Navigation, Historie |
| `--sel-border` | Akzent 45 % | Rahmen ausgewählter Zeilen und Karten |
| `--sel-text` | Akzentfarbe | Text ausgewählter Optionen und Tabs |
| `--focus-ring` | 4 px Akzent 15 % | Fokus und geöffnete Felder |

### 2.3 Maße

| Gruppe | Tokens |
|---|---|
| Abstände | `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 |
| Radien | `--radius-sm` 6 (Badges, Tabs) · `--radius-control` 8 (Felder, Buttons, Zeilen) · `--radius-md` 10 (Kacheln) · `--radius-lg` 14 (Panels, Modals, Listen) |
| Schrift | Poppins · `--fs-xs` 11 · `--fs-sm` 12 · `--fs-base` 14 · `--fs-md` 15 · `--fs-lg` 17 · `--fs-xl` 20 · `--fs-hero` 48 |
| Höhen | `--control-h` 42 · `--control-h-sm` 32 · `--control-h-xs` 24 · `--icon-btn` 34 · `--row-h` 40 · `--option-h` 36 · `--badge-h` 22 |
| Buttons | `--btn-radius` = `--radius-control` · `--btn-min-w` 160 · `--btn-shadow` / `--btn-shadow-hover` (Material) · `--btn-transition` 0.3 s |
| Schatten | `--shadow-panel` · `--shadow-float` (Listen, Toast) · `--shadow-modal` |
| Ebenen | `--z-topbar` 50 · `--z-float` 90 · `--z-modal` 100 · `--z-modal-top` 300 · `--z-tooltip` 2000 · `--z-dropdown` 11000 · `--z-toast` 20000 |

Wer die Dichte ändern will, ändert `--control-h`, dann ziehen alle Felder und Buttons mit.

---

## 3. Flächen

```
Seitenhintergrund      --bgp-* (8 Vorlagen, hell + dunkel)
└─ Panel               .card · .column · .requests-board · .archive-header · .archived-list
   │                   Glas, Radius 14, --shadow-panel
   ├─ Kachel           .ticket-card · .history-card · .meta-grid · .responsibility-section
   │                   Radius 10, Rahmen --border
   └─ Feld / Zeile     Eingaben, Auswahl, .check-row, .ticket-todo – --field-bg, Radius 8
Modal                  .modal auf --bg2, Radius 14, --shadow-modal
```

**Panel-Kopf** (`.panel-head`, gleich wie `.col-header`): Titel links (mit Icon in Akzentfarbe), Zähler oder Aktionen rechts, Trennlinie darunter.

---

## 4. Komponenten

### 4.1 Buttons

Alle Buttons teilen **Radius, Schrift (14/600), Icon-Abstand (8 px), Übergang, Fokus-Umriss und Disabled-Zustand**.

| Klasse | Aussehen | Einsatz |
|---|---|---|
| `.btn-primary` | Akzent-Verlauf, weiße Schrift, Material-Schatten, 42 px, min. 160 px | **Eine** Hauptaktion pro Ansicht: Speichern, Absenden, Annehmen |
| `.btn-secondary` | Akzent 10 %, Rahmen Akzent 25 %, sonst wie primary | Jede Nebenaktion: **Abbrechen, Schließen**, Zurück, Export |
| `.btn-danger` | Rot, sonst wie primary | Destruktive Hauptaktion im Bestätigungsdialog |
| `.btn-ghost` | Transparent, `--text-sec`, 34 px | Navigation in der Topbar, Icon-Aktionen in Kopfzeilen und Listen |
| `.btn-ghost.btn-danger` | Roter Text, rote Hover-Fläche | Löschen in Listen (Icon) |

| Modifikator | Wirkung |
|---|---|
| `.btn-sm` | 32 px hoch, 13 px, keine Mindestbreite: Aktionen in Karten und Einstellungszeilen |
| `.btn-xs` | 24 px: nur für Entfernen-Kreuz in Datei-Chips |
| `.btn-icon` | Quadratisch in der jeweiligen Höhe (42 / 34 / 32 / 24) |
| `.btn-block` | Volle Breite: Formularabschluss (Login, Absenden, Kommentieren, 2FA) |
| `.btn` | Button-Optik für Nicht-Buttons, z. B. `<label>` als Datei-Auswahl |

**Regeln**
- Abbrechen und Schließen sind **immer** `.btn-secondary`, nie Ghost.
- Stehen Buttons in einer Zeile mit Feldern (Suche, Teilaufgaben), haben sie Feldhöhe: `.btn-primary` / `.btn-secondary` (auch als `.btn-icon`).
- Icons: 17 px, in `.btn-sm` 15 px, in `.btn-xs` 13 px. Das CSS setzt die Größe, der Abstand kommt nur über `gap`.
- Icon-Buttons ohne Text haben `title` **und** `aria-label`.
- Eingeblendete Buttons nutzen `display: ''` oder `inline-flex`, nie `block`.

### 4.2 Eingaben

```html
<div class="field">
  <label for="x">Bezeichnung</label>
  <input id="x" type="text">
</div>
```

- Feld, Auswahl und Mehrfachauswahl sind 42 px hoch, haben `--field-bg`, Radius 8 und Rahmen `--border`. Beim Hover wird der Rahmen `--hover-border`, beim Fokus bekommen sie `--focus-ring`.
- Labels: 11 px, 600, GROSSBUCHSTABEN per CSS, ohne Doppelpunkt.
- Mehrspaltig mit `.form-grid` (2 Spalten, `.field-wide` über beide). Gilt für Einstellungen, Benutzerformular, Systemeinstellungen und Ticket-Formular.
- 2FA-Code: `.code-input` (52 px, zentriert, gesperrt).

### 4.3 Auswahl

| Situation | Bauteil |
|---|---|
| Eine Option | `<select>` |
| Mehrere Optionen, platzsparend | Mehrfachauswahl `UI.createMultiSelect()` |
| Mehrere Optionen sichtbar / An-Aus | `.checkbox-list` mit `.check-row` (Checkbox oder Radio) |
| Option mit Beschreibung | `.check-row` mit `.check-text` (`<strong>` + `<span>`) |
| Filter über einer Liste | `.filter-toggle` (kompakte `.check-row`) |
| Zwei bis vier Ansichten | `.tabs` mit `.tab-btn` |
| Zwei Zustände (Hell/Dunkel) | `.tabs.segmented` |
| Farbe | `.accent-picker` mit Presets und Farbwähler `UI.createColorPicker()` |

**Aufklappende Listen** (Select und Mehrfachauswahl) verhalten sich identisch:
- Liste 6 px unter dem Feld, Radius 14, `--bg2`, `--shadow-float`, max. 260 px.
- Einträge 36 px, Radius 8, Hover `--hover-bg`, gewählt `--sel-bg` + `--sel-text` + 600.
- **Immer nach unten.** Fehlt Platz, scrollt zuerst Seite oder Modal nach (`UI.ensureSpaceBelow()`), sonst wird die Liste niedriger (min. 120 px, `UI.dropdownMaxHeight()`).
- Pfeil: 7-px-Winkel, dreht sich beim Öffnen. Gesperrt: `.is-disabled`.

**Farbwähler** (`UI.colorPickerMarkup()` + `UI.createColorPicker()`): runder Farbfeld-Button, der ein Popover im Stil der Auswahllisten öffnet (Radius 14, `--bg2`, `--shadow-float`, immer unter dem Feld). Darin eine Farbfläche für Sättigung und Helligkeit, eine Pipette (wenn der Browser sie kann), eine Vorschau, ein Farbton-Regler sowie HEX- und RGB-Felder in `--control-h-sm`. Beim Ziehen ändert sich die Farbe live, gespeichert wird beim Loslassen. Das Browser-Popup von `<input type="color">` wird nicht verwendet, weil es sich nicht gestalten lässt.

**Tabs**: Container mit Feldoptik (Rahmen, `--field-bg`, 4 px Innenabstand), Tabs 34 px, aktiver Tab `--sel-bg` + `--sel-text`. Die Navigation der Systemeinstellungen nutzt dieselben `.tab-btn`, nur senkrecht.

### 4.4 Badges

Ein Stil für alles Kleine: `.badge` (Aliase: `.status-badge`, `.prio-pill`, `.t-tag`, `.t-category`, `.archive-badge`, `.group-chip`, `.history-badge`, `.assignee-badge`, `.chat-count`, `.count`).

- 22 px hoch, Radius 6, 11 px / 600, Rahmen `--border`, Hintergrund `--card-hover`, Icon 12 px.
- **Priorität** färbt sich über `.prio-Niedrig | Normal | Hoch | Kritisch` (Hintergrund 14 %, Rahmen 35 %, Text in Tonfarbe).
- **Akzent** (`.badge-accent`, Gruppen, „Aktiv“) in Akzentfarbe.
- **Status** neutral, mit `.status-dot` in Statusfarbe davor oder daneben.
- Datei-Anhänge im Chat-Eingang: `.file-chip` mit `.btn-xs`-Entfernen.

### 4.5 Listen und Tabellen

- Kopf: `.table-head` (11 px, uppercase, Trennlinie).
- Zeile: `.table-row` (12 × 14 px Innenabstand, Trennlinie, Radius 8, Hover `--card-hover`).
- Titel `.row-title` (600, max. 2 Zeilen), Nebentext `.row-sub`, Datum `.date`.
- Raster pro Liste: `.ticket-list-head` / `.user-ticket-row` (Dashboard), `.archive-grid` (Archiv), `.user-manager-row` (Benutzer, Gruppen, Kategorien).
- Protokolle (System und Ticket): **eine** Zeile `UI.logRow()` mit Icon-Kachel, Meta, Aktion und Details.
- Notizen: `.note-item`. Leere Zustände: `.empty-state` (in Panels `.compact` mit gestricheltem Rahmen).

### 4.6 Modals

```
┌──────────────────────────────────────────────┐
│ [Icon] Titel                  [Aktionen] [×] │  .modal-header + .modal-actions
├──────────────────────────────────────────────┤
│ Inhalt (scrollt)                             │  .modal-body  (.flush für Listen)
├──────────────────────────────────────────────┤
│                  [Abbrechen] [Hauptaktion]   │  .modal-footer
└──────────────────────────────────────────────┘
```

- Breiten nur über Klassen: `.modal-sm` 420 (Bestätigung, 2FA, Dialoge), `.modal-md` 600 (Ticket, Protokoll, Benutzerverwaltung), `.modal-lg` 720 (Formulare, Einstellungen), `.modal-xl` 900 (Systemeinstellungen, System-Protokoll).
- Schließen immer oben rechts als `.btn-ghost.btn-icon` mit `x`, zusätzlich im Fuß „Schließen“ / „Abbrechen“ als `.btn-secondary`.
- Modals über anderen Modals (Bestätigung, 2FA, Ticket-Protokoll): `.modal-top`.
- Kopfdaten eines Tickets: `.meta-grid` mit `.meta-item` (Label `<strong>` + Wert oder Feld).
- Zwischenüberschriften: `.section-title` (12 px, uppercase, Icon in Akzentfarbe).

### 4.7 Kanban

- Spalte = Panel mit `.col-header` (Icon, Titel, Zähler-Badge). Jede Spalte hat eine feste Höhe (`height: calc(100vh - 260px)`, nicht `max-height`), damit ihre `.ticket-list` intern scrollt statt die Karten zusammenzudrücken. **Wichtig:** `.ticket-card` braucht `flex-shrink: 0` — sonst behandelt Flexbox eine Karte mit `overflow: hidden` als beliebig auf 0 schrumpfbar, sobald die Liste nicht mehr in die Spalte passt (bei vielen Tickets sonst ein Stapel fast leerer Streifen statt einer scrollenden Liste).
- Karte `.ticket-card` – kompakt gehalten, damit auch 50+ Tickets pro Spalte scanbar bleiben:
  - `.t-head`: Prioritäts-Badge links, Kategorien rechts.
  - `.t-title`: zweizeilig geclampt (`-webkit-line-clamp: 2`), lange Titel brechen nicht die Kartenhöhe auf.
  - `.t-sub` (Klasse von `.t-meta`): eine Zeile mit Ersteller + Datum (`.t-author`, mit `flex:1 1 auto; min-width:0;` zum Kürzen) links, Nachrichten-/Notiz-Zähler (`.t-counts`) rechts.
  - `.ticket-card-ops`: eine Zeile mit drei Chips – Hauptverantwortlicher (`.ticket-card-owner`, `flex:1 1 auto; overflow:hidden;` kürzt lange Namen statt die Zeile zu sprengen; ohne Zuweisung zusätzlich `.is-unassigned`, gestrichelt in `--warning`), Beteiligte und offene Teilaufgaben (beide `flex:0 0 auto`, nur Icon + Zahl, Name/Text im `title`-Attribut).
  - `.ticket-card-activity.has-user-update`: **nur** rendern, wenn die zuletzt gesendete Chat-Nachricht vom Kunden stammt (Antwort steht aus). Bei jeder anderen Aktivität (Status geändert, Ticket erstellt …) wird die Zeile komplett weggelassen statt einen generischen Verlaufseintrag zu zeigen – sonst trägt jede Karte eine Zeile, die bei vielen Tickets nur Rauschen ist.
  - Flex-Item, das kürzen soll statt zu sprengen: **immer** `flex: 1 1 auto; min-width: 0; overflow: hidden;` auf dem Container plus `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;` auf dem Text. `flex: 1 1 0` (Basis 0) NICHT für sowas verwenden – der Schrumpf-Faktor wird dann `flexShrink × flexBasis = 0`, das Element schrumpft trotz `flex-shrink:1` nie und sprengt die Zeile.
- Hover: `--sel-border`, `--shadow-float`, −2 px. Ablagefläche beim Ziehen: `.drag-over`.
- Kontoanfrage: `.ticket-card.request-card` (Rahmen `--warning`) mit `.btn-sm`-Aktionen.

### 4.8 Topbar

Auf allen Seiten gleich: `.topbar-left` mit Marke, Brotkrumen (`.crumb`) und angemeldetem Benutzer (`.topbar-user`); `.topbar-right` mit `.btn-ghost`-Buttons (Icon + Text), Einstellungen als Icon-Button, zuletzt **Abmelden** mit `log-out`-Icon.

### 4.9 Rückmeldungen

| Situation | Mittel |
|---|---|
| Aktion erledigt | `UI.toast()` |
| Destruktive Aktion | `UI.confirm()`: Titel „Bestätigung“, Abbrechen + Bestätigen |
| Hinweis in Formularen | `.callout` (Akzent) / `.callout-success`, kurze Hilfe `.hint` |

### 4.10 Icons

Lucide über `Icon(name, size)`, **ohne** eigene Abstände. Größen: 12 (Badges), 13 (Chips), 15 (`.btn-sm`), 16 (Standard), 17 (Buttons, per CSS), 18 (Modal-Titel). Nach dynamischem Markup immer `lucide.createIcons()`.

---

## 5. Layout

| Bereich | Regel |
|---|---|
| Container | `.container`: volle Breite bis 1200 px, 20 px Rand |
| Startseite | `.grid-2` mit zwei `.card` |
| Dashboard | `.dashboard-grid`: Formular : Ticketliste = 2 : 3 |
| Admin | Kontoanfragen-Panel über drei Kanban-Spalten |
| Umbruch | **768 px**: alle Raster einspaltig, Kanban untereinander, Archiv ohne Tabellenkopf |
| Ticketliste | Container-Query 440 px: Status und Datum rutschen unter den Titel |

---

## 6. Theming

- Hell/Dunkel über `html.light`. Jede neue Farbe braucht beide Werte.
- Akzentfarbe frei wählbar (Presets Indigo, Himmelblau, Grün, Orange, Rot + eigene Farbe). Komponenten dürfen nur `--primary-*`, `--hover-*`, `--sel-*` verwenden.
- Hintergründe: acht Vorlagen als `--bgp-*` (Standard, Aurora, Nebel, Ozean, Wald, Glut, Sand, Graphit) plus eigenes Bild. Neue Vorlage = beide Token-Varianten + `body.bg-*` + Kachelregel + Eintrag in `Settings.bgPresets`.

---

## 7. Texte

- Deutsch in **Du-Form**, echte Umlaute, Buttons als Verb („Speichern“, „Archivieren“).
- Neue Texte mit Schlüssel in `Lang.translations` (de + en).
- Nutzereingaben (Titel, Namen, Notizen, Chat) werden immer mit `Utils.esc()` ausgegeben.

---

## 8. Barrierefreiheit

- Jedes Feld hat ein Label, jeder Icon-Button `title` + `aria-label`.
- Fokus sichtbar: Umriss bei Buttons, `--focus-ring` bei Feldern und Auswahllisten.
- Mehrfachauswahl per Tastatur: Enter/Leertaste öffnen, Esc schließt.
- Farbe nie allein: Priorität und Status stehen immer auch als Text.
- Animationen stoppen bei `prefers-reduced-motion`.

---

## 9. Checkliste für jede Änderung

- [ ] Nur Tokens aus `:root`, keine festen Farben, Größen, Radien oder Schatten.
- [ ] Keine Inline-Styles für Aussehen. Erlaubt sind nur Zustände (`display:none`) und Daten-Variablen (`--dot`, `--preset`).
- [ ] Bestehendes Bauteil verwendet (Button, Badge, Zeile, Modal-Aufbau), kein neues erfunden.
- [ ] Alles in einer Zeile hat dieselbe Höhe.
- [ ] Abbrechen/Schließen = `.btn-secondary`, Hauptaktion = `.btn-primary`, rechts.
- [ ] Getestet in Dunkel **und** Hell sowie mit zwei Akzentfarben.
- [ ] Getestet bei 768 px und schmaler.
- [ ] `lucide.createIcons()` nach dynamischem Markup; Nutzertexte über `Utils.esc()`.
- [ ] Listen zusätzlich mit realistischer Menge geprüft (z. B. 50+ Tickets) und mit einem sehr langen Namen/Titel – nicht nur mit den zwei, drei Demo-Einträgen.

---

## 10. Offene Punkte

| Punkt | Hinweis |
|---|---|
| Firefox/Safari | Die gestaltete Auswahlliste nutzt `appearance: base-select` (Chromium 135+). Andere Browser zeigen das Systemmenü, das Feld selbst sieht gleich aus. |
| Inline-`onclick` | Einige Schließen-Buttons in dynamischen Modals nutzen noch `onclick="…"` im Markup. Funktioniert, sollte aber auf Listener umgestellt werden. |
