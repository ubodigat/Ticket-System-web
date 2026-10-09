/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Statische Assets der Einrichtungsseite als TS-Konstanten statt separater Dateien im Build-
// Output -- Phase-1-Vereinfachung. Sobald apps/web über Vite eingebunden wird (docs/PROGRESS.md
// Phase 4/5), zieht diese Seite dorthin um. Kein Inline-<script>/<style>, da die CSP aus
// docs/adr/0006-csp-directives.md weder 'unsafe-inline' noch 'unsafe-eval' erlaubt -- CSS/JS
// werden als eigene, same-origin Endpunkte ausgeliefert.

export const SETUP_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Einrichtung</title>
<link rel="stylesheet" href="/setup/setup.css">
</head>
<body>
<main class="setup-card">
  <h1>Erste Einrichtung</h1>
  <p class="hint">Diese Seite erscheint nur einmal. Danach meldest du dich mit dem hier angelegten Konto an.</p>
  <form id="setup-form">
    <fieldset>
      <legend>Unternehmen</legend>
      <label for="companyName">Unternehmensname</label>
      <input id="companyName" name="companyName" type="text" required maxlength="255" autocomplete="organization">
      <label for="portalName">Name des Portals (z.&nbsp;B. in der Titelzeile)</label>
      <input id="portalName" name="portalName" type="text" required maxlength="255" autocomplete="off">
    </fieldset>
    <fieldset>
      <legend>Erstes Administrator-Konto</legend>
      <label for="adminUsername">Benutzername</label>
      <input id="adminUsername" name="adminUsername" type="text" required minlength="3" maxlength="64" autocomplete="username">
      <label for="adminEmail">E-Mail-Adresse</label>
      <input id="adminEmail" name="adminEmail" type="email" required maxlength="255" autocomplete="email">
      <label for="adminName">Vollständiger Name</label>
      <input id="adminName" name="adminName" type="text" required maxlength="255" autocomplete="name">
      <label for="adminPassword">Passwort (mindestens 14 Zeichen)</label>
      <input id="adminPassword" name="adminPassword" type="password" required minlength="14" autocomplete="new-password">
      <label for="adminPasswordConfirm">Passwort wiederholen</label>
      <input id="adminPasswordConfirm" name="adminPasswordConfirm" type="password" required minlength="14" autocomplete="new-password">
    </fieldset>
    <p id="setup-error" class="error" role="alert" hidden></p>
    <button type="submit" id="setup-submit">Einrichtung abschließen</button>
  </form>
</main>
<script src="/setup/setup.js"></script>
<aside class="cpal-origin" role="note" aria-label="Ursprung des Ticket-Systems">
  <div class="cpal-origin__tag">ORIGINALPROJEKT</div>
  <div>Originalprojekt Ticket-System-web von <strong>U:Bodigat</strong></div>
  <a href="https://github.com/ubodigat/Ticket-System-web" target="_blank" rel="noopener noreferrer">github.com/ubodigat/Ticket-System-web</a>
  <div class="cpal-origin__copyright">Copyright © 2026 U:Bodigat · CPAL-1.0</div>
</aside>
</body>
</html>`;

export const SETUP_CSS = `
:root {
  --bg: #0f1117;
  --card: #1a1d27;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #6366f1;
  --error: #ef4444;
  --border: #2a2e3a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  padding: 24px;
}
.setup-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
  max-width: 480px;
  width: 100%;
}
h1 { margin: 0 0 8px; font-size: 1.5rem; }
.hint { color: var(--muted); margin: 0 0 24px; font-size: 0.9rem; }
fieldset { border: 1px solid var(--border); border-radius: 8px; margin: 0 0 20px; padding: 16px; }
legend { color: var(--muted); font-size: 0.85rem; padding: 0 6px; }
label { display: block; font-size: 0.85rem; margin: 12px 0 4px; }
input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #11131a;
  color: var(--text);
  font-size: 0.95rem;
}
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: none;
  background: var(--accent);
  color: white;
  font-size: 1rem;
  cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: default; }
.error {
  color: var(--error);
  font-size: 0.85rem;
  margin: 0 0 12px;
}

/* CPAL-1.0: sichtbare Herkunftskennzeichnung */
.cpal-origin {
  position: fixed; right: 16px; bottom: 16px; z-index: 10000;
  box-sizing: border-box; width: min(350px, calc(100vw - 32px));
  padding: 12px 15px; border: 1px solid rgba(169,198,255,.45);
  border-radius: 14px; background: rgba(24,33,52,.97); color: #f8fafc;
  box-shadow: 0 12px 30px rgba(0,0,0,.3);
  font: 13px/1.45 system-ui, sans-serif; text-align: left;
}
.cpal-origin__tag { color: #a9c6ff; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.cpal-origin strong { color: #b9d0ff; }
.cpal-origin a { display: block; margin-top: 5px; color: #9ddcff; overflow-wrap: anywhere; text-decoration: underline; }
.cpal-origin__copyright { color: #c2cbdc; font-size: 11px; margin-top: 6px; }
@media (max-width: 500px) {
  .cpal-origin { right: 8px; bottom: 8px; width: calc(100vw - 16px); padding: 10px 12px; }
}
`;

export const SETUP_JS = `
const form = document.getElementById('setup-form');
const errorBox = document.getElementById('setup-error');
const submitBtn = document.getElementById('setup-submit');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const data = Object.fromEntries(new FormData(form).entries());

  if (data.adminPassword !== data.adminPasswordConfirm) {
    errorBox.textContent = 'Die Passwörter stimmen nicht überein.';
    errorBox.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = await res.json();
    if (!res.ok) {
      errorBox.textContent = body.detail || 'Einrichtung fehlgeschlagen.';
      errorBox.hidden = false;
      submitBtn.disabled = false;
      return;
    }
    window.location.href = '/login';
  } catch (err) {
    errorBox.textContent = 'Verbindung zum Server fehlgeschlagen.';
    errorBox.hidden = false;
    submitBtn.disabled = false;
  }
});
`;
