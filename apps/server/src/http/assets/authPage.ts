/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
export const AUTH_CSS = `
:root {
  --bg: #0f1117;
  --card: #1a1d27;
  --card-2: #11131a;
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
  background: radial-gradient(circle at 20% 15%, rgba(99, 102, 241, 0.18), transparent 32rem), var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
a { color: inherit; }
.auth-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: min(100%, 460px);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 32px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
}
.app-card {
  width: min(100%, 880px);
}
h1 { margin: 0 0 8px; font-size: 1.55rem; }
h2 { margin: 0 0 10px; font-size: 1rem; }
.hint { color: var(--muted); margin: 0 0 24px; line-height: 1.5; }
label { display: block; font-size: 0.86rem; margin: 14px 0 5px; color: var(--muted); }
input {
  width: 100%;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text);
  font-size: 0.96rem;
}
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  width: 100%;
  margin-top: 18px;
  padding: 12px;
  border-radius: 8px;
  border: 0;
  background: var(--accent);
  color: white;
  font-weight: 700;
  cursor: pointer;
}
button:disabled { opacity: 0.65; cursor: default; }
.error { color: var(--error); font-size: 0.88rem; margin: 14px 0 0; }
.topline {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 28px;
}
.logout {
  width: auto;
  margin: 0;
  padding: 9px 12px;
  background: var(--card-2);
  border: 1px solid var(--border);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.tile {
  background: var(--card-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
  min-height: 120px;
}
.tile strong { display: block; margin-bottom: 8px; }
.tile span { color: var(--muted); font-size: 0.9rem; line-height: 1.45; }
@media (max-width: 720px) {
  .grid { grid-template-columns: 1fr; }
  .topline { flex-direction: column; }
}
`;

export const LOGIN_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anmelden</title>
<link rel="stylesheet" href="/auth/auth.css">
</head>
<body>
<main class="auth-shell">
  <section class="card">
    <h1>Anmelden</h1>
    <p class="hint">Melde dich mit dem in der Einrichtung angelegten Administratorkonto an.</p>
    <form id="login-form">
      <label for="username">Benutzername</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Passwort</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="login-submit" type="submit">Anmelden</button>
      <p id="login-error" class="error" role="alert" hidden></p>
    </form>
    <form id="mfa-form" hidden>
      <label for="mfa-code">Code aus der Authenticator-App</label>
      <input id="mfa-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
      <button id="mfa-submit" type="submit">Bestätigen</button>
      <p id="mfa-error" class="error" role="alert" hidden></p>
    </form>
  </section>
</main>
<script src="/auth/login.js"></script>
</body>
</html>`;

export const LOGIN_JS = `
const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const submit = document.getElementById('login-submit');
const mfaForm = document.getElementById('mfa-form');
const mfaError = document.getElementById('mfa-error');
const mfaSubmit = document.getElementById('mfa-submit');
let pendingMfaToken = null;

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorBox.textContent = payload.detail || 'Anmeldung fehlgeschlagen.';
      errorBox.hidden = false;
      submit.disabled = false;
      return;
    }
    if (payload.mfaRequired) {
      pendingMfaToken = payload.mfaToken;
      form.hidden = true;
      mfaForm.hidden = false;
      document.getElementById('mfa-code').focus();
      return;
    }
    window.location.href = '/app';
  } catch {
    errorBox.textContent = 'Verbindung zum Server fehlgeschlagen.';
    errorBox.hidden = false;
    submit.disabled = false;
  }
});

mfaForm.addEventListener('submit', async event => {
  event.preventDefault();
  mfaError.hidden = true;
  mfaSubmit.disabled = true;
  const code = document.getElementById('mfa-code').value.trim();
  try {
    const res = await fetch('/api/v1/auth/mfa-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mfaToken: pendingMfaToken, code })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      mfaError.textContent = payload.detail || 'Code ungültig.';
      mfaError.hidden = false;
      mfaSubmit.disabled = false;
      return;
    }
    window.location.href = '/app';
  } catch {
    mfaError.textContent = 'Verbindung zum Server fehlgeschlagen.';
    mfaError.hidden = false;
    mfaSubmit.disabled = false;
  }
});
`;

export const APP_JS = `
document.getElementById('logout-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  await fetch('/api/v1/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
`;

export function renderAppHtml(input: {
  portalName: string;
  companyName: string;
  user: { username: string; name: string; email: string; role: string };
}): string {
  const esc = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.portalName || 'Ticket-System')}</title>
<link rel="stylesheet" href="/auth/auth.css">
</head>
<body>
<main class="auth-shell">
  <section class="card app-card">
    <div class="topline">
      <div>
        <h1>${esc(input.portalName || 'Ticket-System')}</h1>
        <p class="hint">${esc(input.companyName || 'Support Portal')} · Angemeldet als ${esc(input.user.name || input.user.username)} (${esc(input.user.role)})</p>
      </div>
      <form id="logout-form"><button class="logout" type="submit">Abmelden</button></form>
    </div>
    <div class="grid">
      <article class="tile"><strong>Authentifizierung aktiv</strong><span>Login, Session-Cookie und Logout laufen jetzt serverseitig.</span></article>
      <article class="tile"><strong>Setup abgeschlossen</strong><span>Das erste Superadmin-Konto wurde verschlüsselt gespeichert und kann sich anmelden.</span></article>
      <article class="tile"><strong>Nächster Ausbau</strong><span>Tickets, Benutzerverwaltung und Chat werden als serverseitige Module an diese Session angebunden.</span></article>
    </div>
  </section>
</main>
<script src="/auth/app.js"></script>
</body>
</html>`;
}
