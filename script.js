/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, qa, Icon } from './js/utils.js';
import { Lang } from './js/lang.js';
import { Store, Notifications } from './js/store.js';
import { UI } from './js/ui.js';
import { Settings } from './js/settings.js';
import { Auth } from './js/auth.js';
import { UserDash } from './js/user-dash.js';
import { AdminBoard } from './js/admin-board.js';
import './js/context-menu.js';
// --- Main Init ---
// --- Main Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await Store.init();
    await Auth.checkGuard();
    await Lang.init();
    // Display Current User
    const currentUser = await Store.currentUser();
    if (currentUser && q('#user-display')) {
        q('#user-display').textContent = `${Lang.t('loggedInAs')}: ${currentUser.name || currentUser.username}`;
    }
    await Settings.init(); // Initialize Settings with Theme logic
    await Notifications.init();
    UI.initTooltips();
    if (q('#stars')) UI.starfield();

    // Login Page
    if (q('#btn-login')) {
        const goToApp = (user) => {
            UI.toast(Auth.mfaSetupRequired
                ? `Willkommen ${user.name || user.username} – bitte richte die Zwei-Faktor-Anmeldung in deinem Konto ein.`
                : `Willkommen ${user.name || user.username}`);
            setTimeout(() => window.location.href = (user.role === 'admin' || user.role === 'superadmin') ? 'admin.html' : 'dashboard.html', 500);
        };
        // Die Entscheidung "ist ein zweiter Faktor nötig" trifft ausschließlich der Server
        // (anhand des gespeicherten totp_enabled-Flags) -- der Client fragt hier nur noch den
        // Code ab, wenn der Server das verlangt. Kein clientseitig generiertes/geprüftes TOTP
        // mehr (das war der alte, unsichere Weg über Auth.open2FAModal/open2FAVerify).
        const handleLogin = async () => {
            const u = q('#login-user').value.trim();
            const p = q('#login-pass').value;
            const result = await Auth.login(u, p);
            if (result && result.mfaRequired) {
                const code = await UI.promptText({
                    title: 'Zwei-Faktor-Code',
                    label: 'Code aus der Authenticator-App',
                    placeholder: '123456'
                });
                if (!code) return;
                const user = await Auth.verifyMfa(code.trim());
                if (user) return goToApp(user);
                UI.toast('Code ungültig oder abgelaufen.');
                return;
            }
            if (result) return goToApp(result);
            UI.toast(Auth.lastError === 'network' ? 'Verbindung zum Server fehlgeschlagen.' : 'Benutzername oder Passwort ist falsch.');
        };
        q('#btn-login').addEventListener('click', handleLogin);
        q('#login-user').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        q('#login-pass').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }

    // Logout
    if (q('#btn-logout') || q('#logout')) {
        const btns = qa('#btn-logout, #logout');
        btns.forEach(b => b.onclick = Auth.logout);
    }

    // Request Flow
    if (q('#btn-request')) {
        const handleRequest = async () => {
            const name = q('#req-name').value.trim();
            const email = q('#req-email').value.trim();
            if (!name || !email) {
                UI.toast('Bitte Felder füllen');
                return;
            }

            const res = await fetch('/api/v2/account-requests', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name, email })
            }).catch(() => null);
            if (!res || !res.ok) return UI.toast('Anfrage senden fehlgeschlagen.');

            q('#req-name').value = '';
            q('#req-email').value = '';
            UI.toast('Anfrage gesendet! Ein Admin prüft das.');
        };
        q('#btn-request').onclick = handleRequest;
        q('#req-name').onkeydown = (e) => {
            if (e.key === 'Enter') handleRequest();
        };
        q('#req-email').onkeydown = (e) => {
            if (e.key === 'Enter') handleRequest();
        };
    }

    if (q('#btn-create-ticket') || q('#user-tickets')) await UserDash.init();
    if (q('.kanban-board')) await AdminBoard.init();

    // Auto-refresh across tabs
    window.addEventListener('storage', async (e) => {
        if (e.key === 'notifications') await Notifications.refresh();
        if (e.key === 'tickets' || e.key === 'users' || e.key === 'account_requests') {
            if (q('.kanban-board')) {
                await AdminBoard.render();
                await AdminBoard.renderArchive();
                if (AdminBoard.currentTicketId && q('#ticket-modal.open')) {
                    const tickets = await Store.getTickets();
                    const t = tickets.find(t => t.id === AdminBoard.currentTicketId);
                    if (t) await AdminBoard.renderChat(t, '#m-chat-msgs');
                }
            }
            if (q('#user-tickets')) {
                await UserDash.renderList();
                if (UserDash.currentTicketId && q('#u-ticket-modal.open')) {
                    const tickets = await Store.getTickets();
                    const t = tickets.find(t => t.id === UserDash.currentTicketId);
                    if (t) await AdminBoard.renderChat(t, '#u-chat-msgs');
                }
            }
            if (q('#request-list')) await AdminBoard.renderRequests();
        }
    });
});

// --- Scroll to Top Button ---
const ScrollToTop = {
    init: () => {
        // Create scroll to top button
        let btn = q('#scroll-to-top-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'scroll-to-top-btn';
            btn.className = 'btn-primary btn-icon btn-scroll-to-top';
            const icon = document.createElement('i');
            icon.dataset.lucide = 'arrow-up';
            icon.setAttribute('width', '18');
            icon.setAttribute('height', '18');
            btn.replaceChildren(icon);
            btn.title = 'Nach oben';
            btn.setAttribute('aria-label', 'Nach oben');
            btn.onclick = () => window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            document.body.appendChild(btn);
        }

        // Show/hide button on scroll
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                btn.classList.add('show');
            } else {
                btn.classList.remove('show');
            }
        });
    }
};

// <select>-Listen: gleiche Regeln wie das Multi-Select (immer nach unten, Platz schaffen, Höhe anpassen)
const syncSelectPicker = (e) => {
    const sel = e.target && e.target.closest ? e.target.closest('select') : null;
    if (!sel || sel.multiple) return;
    sel.style.setProperty('--picker-max', `${UI.dropdownMaxHeight(sel)}px`);
    requestAnimationFrame(() => {
        let isOpen = false;
        try {
            isOpen = sel.matches(':open');
        } catch {}
        if (!isOpen) return;
        UI.ensureSpaceBelow(sel, Math.min(sel.options.length * 38 + 14, 260) + 18);
        sel.style.setProperty('--picker-max', `${UI.dropdownMaxHeight(sel)}px`);
    });
};
document.addEventListener('pointerdown', syncSelectPicker, true);
document.addEventListener('keydown', syncSelectPicker, true);
document.addEventListener('focusin', syncSelectPicker);

// Initialize scroll to top button
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ScrollToTop.init();
        if (window.lucide) lucide.createIcons();
    });
} else {
    ScrollToTop.init();
    if (window.lucide) lucide.createIcons();
}
