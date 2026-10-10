/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, Icon, Utils } from './utils.js';
import { Store } from './store.js';
import { UI } from './ui.js';
import { Settings } from './settings.js';

// --- Auth ---
// Authentifizierung läuft ausschließlich über den Server (/api/v1/auth/*). Es gibt KEINEN
// clientseitigen Passwortvergleich mehr -- das Altsystem verglich Klartext-Passwörter im
// Browser, genau das war einer der Kernmängel, die diese Umstellung beheben soll.
export const Auth = {
    lastError: null,
    pendingMfaToken: null,
    mfaSetupRequired: false,
    login: async (u, p) => {
        Auth.lastError = null;
        Auth.pendingMfaToken = null;
        const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        }).catch(() => null);
        if (!res) {
            Auth.lastError = 'network';
            return null;
        }
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.mfaRequired) {
            Auth.pendingMfaToken = payload.mfaToken;
            return { mfaRequired: true };
        }
        if (res.ok && payload.user) {
            Store._usersCache = null;
            // "2FA erzwingen" (Systemeinstellungen > Sicherheit) betrifft diese Person, hat aber
            // noch keine 2FA eingerichtet -- Login wird dadurch nicht blockiert, nur markiert.
            Auth.mfaSetupRequired = !!payload.mfaSetupRequired;
            return payload.user;
        }
        Auth.lastError = res.status === 401 ? 'invalid' : (payload.detail || 'invalid');
        return null;
    },
    // Zweiter Schritt, wenn login() { mfaRequired: true } zurückgegeben hat.
    verifyMfa: async (code) => {
        if (!Auth.pendingMfaToken) return null;
        const res = await fetch('/api/v1/auth/mfa-verify', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mfaToken: Auth.pendingMfaToken, code })
        }).catch(() => null);
        if (!res) {
            Auth.lastError = 'network';
            return null;
        }
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.user) {
            Auth.pendingMfaToken = null;
            Store._usersCache = null;
            return payload.user;
        }
        Auth.lastError = 'invalidCode';
        return null;
    },
    logout: async () => {
        try {
            await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch {
            // Ignorieren: zur Login-Seite geht es trotzdem.
        }
        Store._usersCache = null;
        window.location.href = '/login';
    },
    checkGuard: async () => {
        const user = await Store.currentUser();
        const guard = document.body.dataset.guard;
        if (!guard) return; // Public page
        if (!user) {
            window.location.href = location.protocol.startsWith('http') ? '/login' : 'index.html';
            return;
        }
        // Admin page accessible by admin AND superadmin
        if (guard === 'admin' && user.role !== 'admin' && user.role !== 'superadmin') window.location.href = 'dashboard.html';
    },

    // Secret wird ausschließlich serverseitig erzeugt (/api/v2/mfa/setup) und verschlüsselt
    // gespeichert; der QR-Code kommt als fertiges Bild vom Server (lokal per "qrcode"-Paket
    // erzeugt) -- kein Aufruf an api.qrserver.com mehr, kein clientseitig generiertes Secret.
    open2FAModal: async (user) => {
        const setupRes = await fetch('/api/v2/mfa/setup', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
        if (!setupRes || !setupRes.ok) {
            UI.toast('2FA-Einrichtung konnte nicht gestartet werden.');
            return;
        }
        const { secret, qrDataUrl } = await setupRes.json();

        let modal = q('#modal-two-fa');
        if (modal) modal.remove(); // Fresh state

        modal = document.createElement('div');
        modal.id = 'modal-two-fa';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-sm">
                <div class="modal-header">
                    <h3>${Icon('shield-check', 18)} 2FA einrichten</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" id="btn-close-2fa-setup" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body text-center">
                    <p>Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator).</p>
                    <div class="qr-box"><img src="${qrDataUrl}" alt="QR-Code"></div>
                    <p class="hint">Manuelle Eingabe: ${Utils.esc(secret)}</p>
                    <input type="text" id="code-2fa-input" class="code-input" placeholder="123 456">
                </div>
                <div class="modal-footer">
                    <button class="btn-primary btn-block" id="btn-verify-2fa">${Icon('shield-check', 16)} Einrichtung abschließen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        q('#btn-close-2fa-setup').onclick = () => modal.classList.remove('open');
        const input = q('#code-2fa-input');
        const btn = q('#btn-verify-2fa');

        btn.onclick = async () => {
            const code = input.value.trim().replace(/\s/g, '');
            const res = await fetch('/api/v2/mfa/confirm', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ code })
            }).catch(() => null);
            if (res && res.ok) {
                modal.classList.remove('open');
                UI.toast('2FA erfolgreich aktiviert!');
                Settings.openModal();
            } else {
                UI.toast('Code ungültig. Bitte erneut versuchen.');
            }
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    }

};
