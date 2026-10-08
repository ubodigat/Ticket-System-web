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
    document.body.innerHTML = '<main class="setup-card"><h1>Fertig</h1><p class="hint">Die Einrichtung ist abgeschlossen. Der Login folgt in einer späteren Ausbaustufe.</p></main>';
  } catch (err) {
    errorBox.textContent = 'Verbindung zum Server fehlgeschlagen.';
    errorBox.hidden = false;
    submitBtn.disabled = false;
  }
});
`;
