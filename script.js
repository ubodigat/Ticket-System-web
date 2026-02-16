"use strict";

const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));

// --- Utils ---
const Utils = {
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    nowISO: () => new Date().toISOString(),
    fmtDate: (iso) => {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        }) +
            ' ' + d.toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit'
            });
    },
    read: (key, fallback) => {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    },
    write: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
    adjustColor: (color, amount) => {
        return '#' + color.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
    }
};

// --- TOTP Helper ---
const TOTP = {
    generateSecret: () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let secret = '';
        for (let i = 0; i < 16; i++) secret += chars.charAt(Math.floor(Math.random() * chars.length));
        return secret;
    },
    verify: (token, secret) => {
        if (!window.OTPAuth) {
            console.error('OTPAuth library not loaded');
            return token === '123456';
        }
        try {
            const totp = new OTPAuth.TOTP({
                issuer: 'TicketSystem',
                label: 'Support',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: secret
            });
            const delta = totp.validate({
                token,
                window: 1
            });
            return delta !== null;
        } catch (e) {
            console.error('TOTP Error:', e);
            return false;
        }
    }
};

// ... Store ...
// ... Auth ...
// ... UI ...
// ... Settings ...
// ... UserDash ...
// ... AdminBoard ...
// ... getStatusColor ...



// --- Store ---
// --- Store ---
const Store = {
    getUsers: async () => Promise.resolve(Utils.read('users', [])),
    saveUsers: async (users) => Promise.resolve(Utils.write('users', users)),
    getTickets: async () => Promise.resolve(Utils.read('tickets', [])),
    saveTickets: async (tickets) => Promise.resolve(Utils.write('tickets', tickets)),
    getRequests: async () => Promise.resolve(Utils.read('account_requests', [])),
    saveRequests: async (reqs) => Promise.resolve(Utils.write('account_requests', reqs)),
    getSettings: async () => Promise.resolve(Utils.read('app_settings', Settings.defaults)),
    saveSettings: async (settings) => Promise.resolve(Utils.write('app_settings', settings)),
    getGlobalLogs: async () => Promise.resolve(Utils.read('global_logs', [])),
    saveGlobalLogs: async (logs) => Promise.resolve(Utils.write('global_logs', logs)),
    addGlobalLog: async (action, details = '') => {
        const username = localStorage.getItem('currentUser') || 'System';
        const users = await Store.getUsers();
        const user = users.find(u => u.username === username);
        const displayName = user ? (user.name || user.username) : username;

        const logs = await Store.getGlobalLogs();
        logs.push({
            id: Utils.uid(),
            date: Utils.nowISO(),
            user: displayName,
            action: action,
            details: details
        });
        if (logs.length > 1000) logs.shift(); // Max 1000 entries
        await Store.saveGlobalLogs(logs);
    },

    sendEmail: async (to, subject, body) => {
        const settings = await Store.getSettings();
        const conf = settings.emailConfig;
        if (!conf || !conf.host) {
            console.log('Email logging (No SMTP config):', { to, subject, body });
            return;
        }
        console.log(`Sending Email via ${conf.host}:${conf.port}`, {
            user: conf.user,
            from: conf.from,
            to,
            subject,
            body
        });
        UI.toast(`📧 Email an ${to} gesendet (Simuliert)`);
    },

    // Seed default data if empty
    init: async () => {
        let users = await Store.getUsers();
        // Check for Admin and enforce password '123'
        const adminIdx = users.findIndex(u => u.username === 'admin');
        if (adminIdx === -1) {
            users.push({
                id: Utils.uid(),
                username: 'admin',
                password: '123',
                name: 'Administrator',
                role: 'superadmin',
                dept: 'All'
            });
        } else {
            // Force upgrade existing admin to superadmin
            if (users[adminIdx].role !== 'superadmin') {
                users[adminIdx].role = 'superadmin';
                users[adminIdx].dept = 'All';
                await Store.saveUsers(users);
            }
        }

        // 1. Add a default normal user
        const userIdx = users.findIndex(u => u.username === 'user');
        if (userIdx === -1) {
            users.push({
                id: Utils.uid(),
                username: 'user',
                password: '123',
                name: 'Max Mustermann',
                role: 'user'
            });
        }

        await Store.saveUsers(users);
        if (!Utils.read('tickets', null)) Utils.write('tickets', []);
        if (!Utils.read('account_requests', null)) Utils.write('account_requests', []);

        // Migration: ensure 'comments', 'chat', 'archived' are set
        const tickets = await Store.getTickets();
        let changed = false;
        tickets.forEach(t => {
            if (!t.chat) {
                // If we have comments, move them to chat for continuity of history
                if (t.comments && t.comments.length > 0) {
                    t.chat = [...t.comments];
                    t.comments = []; // Reset comments for internal notes
                } else {
                    t.chat = [];
                }
                changed = true;
            }
            if (!t.comments) {
                t.comments = [];
                changed = true;
            } // Internal notes
            if (!t.logs) {
                t.logs = [];
                changed = true;
            }
            if (t.archived === undefined) {
                t.archived = false;
                changed = true;
            }
            if (t.category && !Array.isArray(t.category)) {
                t.category = [t.category];
                changed = true;
            }
        });
        if (changed) await Store.saveTickets(tickets);

        await Store.runAutoArchive();
    },

    addLog: async (ticket, msg, details) => {
        if (!ticket.logs) ticket.logs = [];
        const user = await Store.currentUser();
        ticket.logs.push({
            id: Utils.uid(),
            date: Utils.nowISO(),
            user: user ? (user.name || user.username) : 'System',
            msg: msg,
            details: details
        });
    },

    currentUser: async () => {
        const username = localStorage.getItem('currentUser');
        if (!username) return null;
        const users = await Store.getUsers();
        return users.find(u => u.username === username) || null;
    },

    readFile: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    runAutoArchive: async () => {
        const tickets = await Store.getTickets();
        const now = new Date();
        let changed = false;
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        // 1. Archive if Closed > 3 days
        tickets.forEach(t => {
            if (!t.archived && t.status === 'Geschlossen') {
                let closedDate = null;
                if (t.logs) {
                    for (let i = t.logs.length - 1; i >= 0; i--) {
                        if (t.logs[i].msg && t.logs[i].msg.includes('zu Geschlossen')) {
                            closedDate = new Date(t.logs[i].date);
                            break;
                        }
                    }
                }
                if (!closedDate) closedDate = new Date(t.createdAt);

                if (closedDate < threeDaysAgo) {
                    t.archived = true;
                    t.archivedAt = Utils.nowISO();
                    changed = true;
                }
            }
        });

        // 2. Max 10 Closed Active
        const closedActive = tickets.filter(t => !t.archived && t.status === 'Geschlossen');
        if (closedActive.length > 10) {
            // Sort oldest created first to archive them
            closedActive.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const toArchiveCount = closedActive.length - 10;
            for (let i = 0; i < toArchiveCount; i++) {
                const t = closedActive[i];
                t.archived = true;
                t.archivedAt = Utils.nowISO();
                changed = true;
            }
        }

        if (changed) {
            await Store.saveTickets(tickets);
            console.log('Auto-Archivierung durchgeführt');
        }
    }
};

// --- Auth ---
// --- Auth ---
const Auth = {
    login: async (u, p) => {
        const users = await Store.getUsers();
        const user = users.find(x => x.username === u && x.password === p);
        if (user) {
            localStorage.setItem('currentUser', user.username);
            await Store.addGlobalLog('Anmeldung erfolgreich', `Benutzer: ${user.name || user.username}`);
            return user;
        }
        await Store.addGlobalLog('Anmeldung fehlgeschlagen', `Benutzerversuch: ${u}`);
        return null;
    },
    logout: async () => {
        await Store.addGlobalLog('Abmeldung');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    },
    checkGuard: async () => {
        const user = await Store.currentUser();
        const guard = document.body.dataset.guard;
        if (!guard) return; // Public page
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        // Admin page accessible by admin AND superadmin
        if (guard === 'admin' && user.role !== 'admin' && user.role !== 'superadmin') window.location.href = 'dashboard.html';
    },

    open2FAModal: async (user) => {
        // Generate or get existing secret
        if (!user.twoFactorSecret) {
            user.twoFactorSecret = TOTP.generateSecret();
            const users = await Store.getUsers();
            const idx = users.findIndex(u => u.id === user.id);
            if (idx > -1) {
                users[idx].twoFactorSecret = user.twoFactorSecret;
                await Store.saveUsers(users);
            }
        }

        let modal = q('#modal-two-fa');
        if (modal) modal.remove(); // Fresh state

        modal = document.createElement('div');
        modal.id = 'modal-two-fa';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '9999';

        const qrData = `otpauth://totp/TicketSystem:${user.username}?secret=${user.twoFactorSecret}&issuer=TicketSystem`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;

        modal.innerHTML = `
            <div class="modal" style="max-width:350px; text-align:center;">
                <button class="btn-ghost" style="position:absolute; right:10px; top:10px;" onclick="q('#modal-two-fa').classList.remove('open')">✕</button>
                <div class="modal-header"><h3>🔐 2FA Einrichtung</h3></div>
                <div class="modal-body">
                    <p style="margin-bottom:15px; font-size:13px; opacity:0.8;">Scannen Sie den QR-Code mit einer App (z.B. Google Authenticator).</p>
                    <div style="background:white; padding:10px; display:inline-block; margin-bottom:15px; border-radius:4px;">
                        <img src="${qrUrl}" alt="QR Code" style="display:block; width:150px; height:150px;">
                    </div>
                    <p style="font-size:11px; margin-bottom:10px; opacity:0.6;">Secret: ${user.twoFactorSecret}</p>
                    <input type="text" id="code-2fa-input" placeholder="123 456" style="text-align:center; letter-spacing:4px; font-size:18px; width:100%;">
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" id="btn-verify-2fa" style="width:100%">Einrichtung abschließen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const input = q('#code-2fa-input');
        const btn = q('#btn-verify-2fa');

        btn.onclick = async () => {
            const code = input.value.trim().replace(/\s/g, '');
            if (TOTP.verify(code, user.twoFactorSecret)) {
                user.twoFactorEnabled = true;
                const users = await Store.getUsers();
                const idx = users.findIndex(u => u.id === user.id);
                if (idx > -1) {
                    users[idx].twoFactorEnabled = true;
                    await Store.saveUsers(users);
                }
                modal.classList.remove('open');
                UI.toast('2FA erfolgreich aktiviert!');
                await Store.addGlobalLog('2FA eingerichtet', `Benutzer: ${user.username}`);
                setTimeout(() => window.location.href = (user.role === 'admin' || user.role === 'superadmin') ? 'admin.html' : 'dashboard.html', 500);
            } else {
                UI.toast('Code ungültig. Bitte erneut versuchen.');
            }
        };
        modal.classList.add('open');
    },

    open2FAVerify: (user, onSuccess) => {
        let modal = q('#modal-2fa-verify');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-2fa-verify';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '9999';
            modal.innerHTML = `
                <div class="modal" style="max-width:350px; text-align:center;">
                    <button class="btn-ghost" style="position:absolute; right:10px; top:10px;" onclick="q('#modal-2fa-verify').classList.remove('open')">✕</button>
                    <div class="modal-header"><h3>🔐 2FA Überprüfung</h3></div>
                    <div class="modal-body">
                        <p style="margin-bottom:15px; font-size:13px;">Bitte geben Sie Ihren 2FA-Code ein:</p>
                        <input type="text" id="verify-2fa-input" placeholder="123 456" style="text-align:center; letter-spacing:4px; font-size:18px; width:100%;">
                    </div>
                    <div class="modal-footer">
                        <button class="btn-primary" id="btn-check-2fa" style="width:100%">Bestätigen</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        const input = q('#verify-2fa-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        const btn = q('#btn-check-2fa');

        btn.onclick = () => {
            const code = input.value.trim().replace(/\s/g, '');
            if (TOTP.verify(code, user.twoFactorSecret)) {
                modal.classList.remove('open');
                onSuccess();
            } else {
                UI.toast('Code ungültig!');
            }
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') btn.click();
        };
        modal.classList.add('open');
    }

};

// --- UI Components ---
const UI = {
    toast: (msg) => {
        let el = q('#toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },
    confirm: (msg, onYes) => {
        let modal = q('#confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirm-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '11000';
            modal.innerHTML = `
                <div class="modal" style="max-width:400px; text-align:center;">
                    <div class="modal-body" style="padding:30px 20px;">
                        <h3 style="margin-bottom:10px;">Bestätigung</h3>
                        <p id="cm-msg" style="margin-bottom:20px; color:var(--text-sec)"></p>
                        <div style="display:flex; justify-content:center; gap:10px;">
                            <button class="btn-ghost" id="cm-no">Abbrechen</button>
                            <button class="btn-primary" id="cm-yes">Bestätigen</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        q('#cm-msg').textContent = msg;

        const close = () => modal.classList.remove('open');
        const yesBtn = q('#cm-yes');
        const noBtn = q('#cm-no');

        // Clone to clear listeners
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);

        newYes.onclick = () => {
            close();
            onYes();
        };
        newNo.onclick = () => close(); // Fix: close on No

        modal.classList.add('open');
    },
    starfield: () => {
        const c = q('#stars');
        if (!c) return;
        const ctx = c.getContext('2d');
        const stars = [];
        const resize = () => {
            c.width = window.innerWidth;
            c.height = window.innerHeight;
        };
        const loop = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.fillStyle = document.documentElement.classList.contains('light') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.9)';
            stars.forEach(s => {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
                s.y += s.v;
                if (s.y > c.height) s.y = -2;
            });
            requestAnimationFrame(loop);
        };
        resize();
        window.addEventListener('resize', resize);
        for (let i = 0; i < 150; i++) stars.push({
            x: Math.random() * c.width,
            y: Math.random() * c.height,
            r: Math.random() * 1.5,
            v: Math.random() * 0.4 + 0.1
        });
        loop();
    },

    showLogs: async (id) => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(t => t.id === id);
        // ... (existing logic) ...
        if (!ticket) return;

        let modal = q('#logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'logs-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '200';
            modal.innerHTML = `
                <div class="modal" style="max-width:500px;">
                    <div class="modal-header">
                        <h3>📜 Ticket Protokoll</h3>
                        <button class="btn-ghost" onclick="q('#logs-modal').classList.remove('open')">✕</button>
                    </div>
                    <div class="modal-body" id="logs-body" style="background:rgba(0,0,0,0.2); border-radius:8px; padding:15px; max-height: 60vh;"></div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="q('#logs-modal').classList.remove('open')">Schließen</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        const body = q('#logs-body');
        body.innerHTML = '';
        if (!ticket.logs || ticket.logs.length === 0) {
            body.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">Keine Einträge vorhanden.</p>';
        } else {
            ticket.logs.slice().reverse().forEach(l => {
                const item = document.createElement('div');
                item.style.borderBottom = '1px solid var(--border)';
                item.style.padding = '12px 0';
                item.innerHTML = `
                    <div style="font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; color:var(--text-sec);">
                        <span style="font-weight:600; color:var(--primary-solid)">${l.user}</span>
                        <span>${Utils.fmtDate(l.date)}</span>
                    </div>
                    <div style="font-size:13px; line-height:1.4; display:flex; align-items:center; gap:6px;">
                        ${l.msg}
                        ${l.details ? `<span class="info-icon" data-tooltip="${l.details.replace(/"/g, '&quot;')}">i</span>` : ''}
                    </div>
                `;
                body.appendChild(item);
            });
        }
        modal.classList.add('open');
    },

    createMultiSelect: (container, options, initialValues = [], onChange = null) => {
        // Clear container
        container.innerHTML = '';
        container.classList.add('multi-select-container');

        // Header (The box looking like a select)
        const header = document.createElement('div');
        header.className = 'multi-select-header';
        // Style to match standard select inputs
        // Style to match standard select inputs
        header.style.cssText = `
            border: 1px solid var(--border);
            background: var(--bg2);
            color: var(--text);
            padding: 8px 15px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            min-height: 42px;
            font-size: 14px;
            position: relative;
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
        `;
        const updateHeader = () => {
            const count = inputs.filter(i => i.checked).length;
            const selected = inputs.filter(i => i.checked);
            const arrow = '<span style="font-size:10px; opacity:0.5; margin-left:10px;">▼</span>';

            if (count === 0) header.innerHTML = `<span>Bitte wählen...</span> ${arrow}`;
            else if (count <= 2) {
                const labels = selected.map(i => i.dataset.label || i.value);
                header.innerHTML = `<span>${labels.join(', ')}</span> ${arrow}`;
            } else {
                header.innerHTML = `<span>${count} ausgewählt</span> ${arrow}`;
            }
        };
        container.appendChild(header);

        // Dropdown List
        const dropdown = document.createElement('div');
        dropdown.className = 'multi-select-dropdown';
        dropdown.style.cssText = `
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--bg2);
            border: 1px solid var(--border);
            border-radius: 6px;
            z-index: 11000;
            max-height: 250px;
            overflow-y: auto;
            box-shadow: 0 8px 16px var(--shadow);
            margin-top: 4px;
            padding: 5px 0;
        `;
        // Ensure style tag for 'open' exists once
        if (!document.getElementById('ms-style-sheet')) {
            const st = document.createElement('style');
            st.id = 'ms-style-sheet';
            st.textContent = `
                .multi-select-dropdown.open { display: block !important; }
                .ms-row { color: var(--text) !important; transition: all 0.2s; }
                .ms-row:hover { background: var(--primary) !important; color: white !important; }
                .ms-row span { color: inherit !important; font-weight: 500; }
                .ms-row input[type="checkbox"] { cursor: pointer; width: 16px; height: 16px; }
            `;
            document.head.appendChild(st);
        }

        const inputs = [];

        options.forEach(opt => {
            const isObj = typeof opt === 'object';
            const val = isObj ? opt.value : opt;
            const label = isObj ? opt.label : opt;

            const row = document.createElement('label');
            row.className = 'ms-row';
            row.style.cssText = `
                display: flex;
                align-items: center;
                padding: 10px 16px;
                cursor: pointer;
                gap: 12px;
                font-size: 14px;
                width: 100%;
                text-transform: none;
                user-select: none;
            `;

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.value = val;
            box.dataset.label = label;
            box.checked = initialValues.includes(val);
            box.onchange = (e) => {
                updateHeader();
                if (onChange) onChange(inputs.filter(i => i.checked).map(i => i.value));
            };

            inputs.push(box);

            row.appendChild(box);
            const textSpan = document.createElement('span');
            textSpan.textContent = label;
            row.appendChild(textSpan);
            dropdown.appendChild(row);
        });

        container.appendChild(dropdown);
        updateHeader();

        // Toggle visibility
        header.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        };

        // Close on click outside
        window.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        return {
            getValue: () => inputs.filter(i => i.checked).map(i => i.value),
            setValue: (vals) => {
                inputs.forEach(i => i.checked = vals.includes(i.value));
                updateHeader();
            }
        };
    }
};

const Settings = {
    defaults: {
        theme: 'dark',
        accentColor: '#6366f1',
        lang: 'de',
        bgType: 'default',
        bgValue: ''
    },
    init: async () => {
        const s = await Store.getSettings();
        Settings.apply(s);
        const toggle = q('#theme-toggle');
        if (toggle) {
            toggle.innerHTML = '⚙️';
            toggle.id = 'btn-settings';
            toggle.onclick = Settings.openModal;
        }
    },

    bgPresets: {
        dark: [{
            type: 'default',
            val: '',
            label: 'Standard',
            icon: '🌌'
        },
        {
            type: 'class',
            val: 'bg-anim-space',
            label: 'Deep Space (Anim)',
            icon: '🚀'
        },
        {
            type: 'class',
            val: 'bg-anim-nebula',
            label: 'Nebula (Anim)',
            icon: '✨'
        },
        {
            type: 'color',
            val: 'linear-gradient(180deg, #0f172a, #1e293b)',
            label: 'Deep Ocean',
            icon: '🩶'
        },
        {
            type: 'color',
            val: 'linear-gradient(180deg, #064e3b, #065f46)',
            label: 'Forest',
            icon: '🌲'
        }
        ],
        light: [{
            type: 'default',
            val: '',
            label: 'Standard',
            icon: '☀️'
        },
        {
            type: 'class',
            val: 'bg-anim-clouds',
            label: 'Clouds (Anim)',
            icon: '☁️'
        },
        {
            type: 'class',
            val: 'bg-anim-waves',
            label: 'Soft Waves (Anim)',
            icon: '🌊'
        },
        {
            type: 'color',
            val: 'linear-gradient(180deg, #f5f3ff, #ede9fe)',
            label: 'Lavender',
            icon: '🌈'
        },
        {
            type: 'color',
            val: 'linear-gradient(180deg, #f0fdf4, #dcfce7)',
            label: 'Mint',
            icon: '🍃'
        }
        ]
    },

    apply: (s) => {
        const isLight = s.theme === 'light';
        if (isLight) document.documentElement.className = 'light';
        else document.documentElement.className = '';

        document.documentElement.style.setProperty('--primary-solid', s.accentColor);
        document.documentElement.style.setProperty('--primary-grad', `linear-gradient(135deg, ${s.accentColor}, ${Utils.adjustColor(s.accentColor, -20)})`);

        // Applied Background
        const stars = q('#stars');
        const overlay = 'rgba(0,0,0,0.4)';

        // Clear body classes for animations
        document.body.className = '';

        if (s.bgType === 'default') {
            document.body.style.background = isLight ? '#f6f7fb' : '';
            if (stars) stars.style.display = isLight ? 'none' : 'block';
        } else if (s.bgType === 'color') {
            document.body.style.background = isLight ? s.bgValue : `linear-gradient(${overlay}, ${overlay}), ${s.bgValue}`;
            if (stars) stars.style.display = 'none';
        } else if (s.bgType === 'image') {
            document.body.style.background = `linear-gradient(${overlay}, ${overlay}), url(${s.bgValue}) no-repeat center center fixed`;
            document.body.style.backgroundSize = 'cover';
            if (stars) stars.style.display = 'none';
        } else if (s.bgType === 'class') {
            document.body.className = s.bgValue;
            document.body.style.background = '';
            if (stars) stars.style.display = 'none';
        }
    },
    openModal: async () => {
        let modal = q('#settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'settings-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal" style="max-width:500px">
                    <div class="modal-header"><h3>Einstellungen</h3><button class="btn-ghost close-m">✕</button></div>
                    <div class="modal-body">
                        <div class="field">
                            <label>Design Modus</label>
                            <div class="input-row">
                                <button class="btn-secondary s-theme-btn" data-val="dark" style="flex:1">Dunkel</button>
                                <button class="btn-secondary s-theme-btn" data-val="light" style="flex:1">Hell</button>
                            </div>
                        </div>
                        <div class="field">
                            <label>Akzentfarbe</label>
                            <input type="color" id="s-color" style="width:100%; height:40px; cursor:pointer; background:none; border:none; padding:0;">
                        </div>
                        <div class="field">
                            <label>Sprache</label>
                            <select id="s-lang"><option value="de">Deutsch</option><option value="en">English</option></select>
                        </div>
                        <div class="field">
                            <label>Hintergrund</label>
                            <div id="s-bg-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:10px;">
                                <!-- Rendered by renderBgGrid -->
                            </div>
                            <input type="file" id="s-bg-file" style="display:none" accept="image/*">
                        </div>
                        <div class="field">
                            <label>Sicherheit</label>
                            <div id="s-sec-area">
                                <!-- Rendered dynamically -->
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer"><button class="btn-primary close-m">Fertig</button></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(x => x.onclick = () => modal.classList.remove('open'));

            // Listeners
            modal.querySelectorAll('.s-theme-btn').forEach(b => {
                b.onclick = async () => {
                    const s = await Store.getSettings();
                    s.theme = b.dataset.val;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                };
            });
            q('#s-color').onchange = async (e) => {
                const s = await Store.getSettings();
                s.accentColor = e.target.value;
                await Store.saveSettings(s);
                Settings.apply(s);
            };
            q('#s-lang').onchange = async (e) => {
                const s = await Store.getSettings();
                s.lang = e.target.value;
                await Store.saveSettings(s);
                Settings.apply(s);
            };
        }

        const s = await Store.getSettings();
        Settings.renderState(modal, s);

        // Render Security Section
        const user = await Store.currentUser();
        const secArea = q('#s-sec-area');
        if (user && secArea) {
            const isEnabled = user.twoFactorEnabled;
            secArea.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.1); padding:10px; border-radius:6px;">
                    <div>
                        <div style="font-weight:600; font-size:13px;">2-Faktor-Authentifizierung</div>
                        <div style="font-size:11px; opacity:0.7;">${isEnabled ? 'Aktiviert' : 'Deaktiviert'}</div>
                    </div>
                    <button class="btn-${isEnabled ? 'ghost' : 'primary'}" id="btn-toggle-2fa" style="font-size:12px;">
                        ${isEnabled ? 'Deaktivieren' : 'Einrichten'}
                    </button>
                </div>
            `;
            q('#btn-toggle-2fa').onclick = () => {
                if (isEnabled) {
                    // Disable
                    UI.confirm('2FA wirklich deaktivieren?', async () => {
                        const users = await Store.getUsers();
                        const target = users.find(u => u.id === user.id);
                        if (target) {
                            target.twoFactorEnabled = false;
                            await Store.saveUsers(users);
                            UI.toast('2FA deaktiviert');
                            Settings.openModal(); // Re-render
                        }
                    });
                } else {
                    // Enable -> Open the existing Setup Modal
                    modal.classList.remove('open');
                    setTimeout(() => Auth.open2FAModal(user), 200); // Wait for transition
                }
            };
        }

        modal.classList.add('open');
    },
    renderState: (modal, s) => {
        modal.querySelectorAll('.s-theme-btn').forEach(b => {
            b.className = (b.dataset.val === s.theme) ? 'btn-primary s-theme-btn' : 'btn-secondary s-theme-btn';
        });

        // Dynamic Background Grid
        const currentTheme = modal.dataset.renderedTheme;
        if (currentTheme !== s.theme) {
            modal.dataset.renderedTheme = s.theme;
            Settings.renderBgGrid(modal, s);
        }

        q('#s-color').value = s.accentColor;
        q('#s-lang').value = s.lang || 'de';

        modal.querySelectorAll('.s-bg-btn').forEach(b => {
            let active = false;
            if (b.dataset.type === 'image') {
                active = (s.bgType === 'image'); // Pure type check for custom upload
            } else {
                active = (b.dataset.type === s.bgType && (b.dataset.val || '') === s.bgValue);
            }
            b.style.borderColor = active ? 'var(--primary-solid)' : 'transparent';
            b.style.boxShadow = active ? '0 0 10px var(--primary-solid)' : 'none';
        });
    },

    renderBgGrid: (modal, s) => {
        const grid = modal.querySelector('#s-bg-grid');
        if (!grid) return;

        const presets = Settings.bgPresets[s.theme || 'dark'];
        grid.innerHTML = '';

        presets.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn-secondary s-bg-btn';
            btn.dataset.type = p.type;
            btn.dataset.val = p.val;
            btn.title = p.label;
            btn.textContent = p.icon;
            btn.onclick = async () => {
                s.bgType = p.type;
                s.bgValue = p.val;
                await Store.saveSettings(s);
                Settings.apply(s);
                Settings.renderState(modal, s);
            };
            grid.appendChild(btn);
        });

        // Add upload button
        const upBtn = document.createElement('button');
        upBtn.className = 'btn-secondary s-bg-btn';
        upBtn.id = 's-bg-upload';
        upBtn.dataset.type = 'image';
        upBtn.title = 'Eigenes Bild';
        upBtn.textContent = '📁';
        upBtn.onclick = () => q('#s-bg-file').click();
        grid.appendChild(upBtn);

        q('#s-bg-file').onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) {
                UI.toast('Bild zu groß (max 4MB)');
                return;
            }
            try {
                const data = await Store.readFile(file);
                s.bgType = 'image';
                s.bgValue = data;
                await Store.saveSettings(s);
                Settings.apply(s);
                Settings.renderState(modal, s);
                UI.toast('Hintergrund aktualisiert');
            } catch (err) {
                UI.toast('Fehler beim Upload');
            }
        };
    },
    save: async (s) => {
        await Store.saveSettings(s);
        Settings.apply(s);
    }
};

// --- User Dashboard Logic ---
const UserDash = {
    selectedFiles: [], // Staging for file uploads

    init: async () => {
        // Admin Button Injection if on dashboard (for superadmin/admin)
        const user = await Store.currentUser();
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
            const rightNav = q('.topbar .right');
            if (rightNav && !q('#btn-to-admin')) {
                const btn = document.createElement('button');
                btn.id = 'btn-to-admin';
                btn.className = 'btn-ghost';
                btn.textContent = 'Admin Panel';
                btn.style.marginRight = '10px';
                btn.onclick = () => window.location.href = 'admin.html';
                rightNav.insertBefore(btn, rightNav.firstChild);
            }
        }

        if (!q('#btn-create-ticket')) return;
        const btn = q('#btn-create-ticket');
        btn.onclick = async () => {
            const title = q('#t-title').value.trim();
            const desc = q('#t-desc').value.trim();
            const prio = q('#t-prio').value;
            // Get values from custom multi-select
            const selectedCats = UserDash.categoryInstance ? UserDash.categoryInstance.getValue() : ['Allgemein'];
            const cat = selectedCats.length > 0 ? selectedCats : ['Allgemein'];

            if (!title) {
                UI.toast('Bitte Titel angeben');
                return;
            }

            const user = await Store.currentUser();
            const tickets = await Store.getTickets();
            const newTicket = {
                id: Utils.uid(),
                title,
                desc,
                prio,
                category: cat,
                status: 'Neu',
                author: user.username,
                authorName: user.name || user.username,
                createdAt: Utils.nowISO(),
                comments: [],
                chat: [],
                archived: false
            };
            tickets.push(newTicket);
            await Store.addLog(newTicket, 'Ticket erstellt');
            await Store.addGlobalLog('Neues Ticket erstellt', `Titel: ${newTicket.title}`);
            await Store.saveTickets(tickets);

            // Notify Admins
            const s = await Store.getSettings();
            if (s.emailConfig && s.emailConfig.host) {
                const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin');
                admins.forEach(a => {
                    if (a.email) Store.sendEmail(a.email, `Neues Ticket: ${title}`, `Ticket #${newTicket.id} von ${user.name || user.username} erstellt.`);
                });
            }

            UI.toast('Ticket erstellt!');
            q('#t-title').value = '';
            q('#t-desc').value = '';
            await UserDash.renderList();
        };

        // ... Key listeners for Create Ticket ...
        q('#t-title').onkeydown = (e) => {
            if (e.key === 'Enter') q('#btn-create-ticket').click();
        };

        // Populate Categories dynamically with Custom Multi-Select
        const catContainer = q('#t-cat').parentElement;
        if (catContainer) {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];

            // Clear old label/select if present (re-run safety)
            catContainer.innerHTML = '<label>Kategorie</label>';

            // Create container for multi-select
            const msContainer = document.createElement('div');
            msContainer.id = 't-cat-ms';
            catContainer.appendChild(msContainer);

            UserDash.categoryInstance = UI.createMultiSelect(msContainer, categories, ['Allgemein']);
        }

        // Modal Events
        if (q('#u-m-close')) q('#u-m-close').onclick = UserDash.closeModal;
        if (q('#u-ticket-modal')) q('#u-ticket-modal').onclick = (e) => {
            if (e.target.id === 'u-ticket-modal') UserDash.closeModal();
        };

        // User Chat Logic
        const chatSend = q('#u-chat-send');
        if (chatSend) {
            chatSend.onclick = () => AdminBoard.postChat('user');
            q('#u-chat-input').onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') AdminBoard.postChat('user');
            };

            // File Handling
            const fileIn = q('#u-chat-file');
            fileIn.onchange = () => {
                Array.from(fileIn.files).forEach(f => UserDash.selectedFiles.push(f));
                UserDash.renderFilePreview();
                fileIn.value = ''; // Reset input to allow re-selecting same file
            };
        }

        // Tabs
        const modalBody = q('#u-ticket-modal .modal-body');
        if (modalBody) {
            const tabs = modalBody.querySelectorAll('.tab-btn');
            tabs.forEach(btn => {
                btn.onclick = () => {
                    modalBody.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const target = btn.dataset.tab; // u-details or u-chat
                    modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    const pane = q(`#u-tab-${target.replace('u-', '')}`) || q(`#${target}`);
                    if (pane) {
                        pane.classList.add('active');
                        if (target.includes('chat')) {
                            const box = q('#u-chat-msgs');
                            if (box) box.scrollTop = box.scrollHeight;
                        }
                    }
                };
            });
        }

        // Search Bar Injection - Target the H2 directly
        const ticketSection = qa('section.card').find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('Deine Tickets'));
        if (ticketSection) {
            const h2 = ticketSection.querySelector('h2');
            if (h2 && !q('#u-search')) {
                // Convert H2 to Flex container
                h2.style.display = 'flex';
                h2.style.justifyContent = 'space-between';
                h2.style.alignItems = 'center';
                h2.style.flexWrap = 'wrap';

                // Create Search Input
                const search = document.createElement('input');
                search.id = 'u-search';
                search.type = 'text';
                search.placeholder = '🔍 Suchen...';
                search.style.fontSize = '13px';
                search.style.padding = '6px 10px';
                search.style.width = '200px';
                search.style.border = '1px solid var(--border)';
                search.style.borderRadius = '4px';
                search.style.background = 'var(--bg)';
                search.style.color = 'var(--text)';
                search.style.fontWeight = 'normal';

                // Prevent click propagation
                search.onclick = (e) => e.stopPropagation();
                search.oninput = () => UserDash.renderList();

                h2.appendChild(search);
            }
        }

        await UserDash.renderList();
    },

    renderFilePreview: () => {
        const pan = q('#u-chat-file-preview');
        pan.innerHTML = '';
        if (UserDash.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            UserDash.selectedFiles.forEach((f, idx) => {
                const tag = document.createElement('div');
                tag.style.background = 'rgba(0,0,0,0.3)';
                tag.style.padding = '4px 8px';
                tag.style.borderRadius = '4px';
                tag.style.fontSize = '12px';
                tag.innerHTML = `<span>${f.name}</span> <span style="cursor:pointer; color:var(--danger); margin-left:4px;">✕</span>`;
                tag.querySelector('span:last-child').onclick = () => {
                    UserDash.selectedFiles.splice(idx, 1);
                    UserDash.renderFilePreview();
                };
                pan.appendChild(tag);
            });
        } else {
            pan.style.display = 'none';
        }
    },

    // ... renderList, openModal, closeModal ...
    currentTicketId: null,

    openModal: async (id) => {
        UserDash.currentTicketId = id;
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;

        if (q('#u-m-title')) q('#u-m-title').textContent = t.title + (t.archived ? ' (Archiviert)' : '');
        if (q('#u-m-desc')) q('#u-m-desc').textContent = t.desc || 'Keine Beschreibung';

        // Read-only check for archived
        const uChatInput = q('#u-chat-input');
        const uChatSend = q('#u-chat-send');
        if (uChatInput) uChatInput.disabled = t.archived;
        if (uChatSend) {
            uChatSend.disabled = t.archived;
            uChatSend.style.opacity = t.archived ? '0.5' : '1';
        }

        // Metadata
        if (q('#u-m-status')) {
            const st = q('#u-m-status');
            st.textContent = t.status;
            st.style.color = getStatusColor(t.status);
        }
        if (q('#u-m-date')) q('#u-m-date').textContent = Utils.fmtDate(t.createdAt);

        // Handle Archived Date Visibility
        if (q('#u-m-archived')) {
            const archEl = q('#u-m-archived');
            if (t.archived && t.archivedAt) {
                archEl.textContent = Utils.fmtDate(t.archivedAt);
                archEl.parentElement.style.display = 'block';
            } else {
                archEl.parentElement.style.display = 'none';
            }
        }

        if (q('#u-m-prio')) q('#u-m-prio').textContent = t.prio;
        if (q('#u-m-cat')) q('#u-m-cat').textContent = t.category || '-';

        // Support Multiple Assignees in User View
        if (q('#u-m-assignee')) {
            const allUsers = await Store.getUsers();
            if (t.assignees && t.assignees.length > 0) {
                const names = t.assignees.map(u => {
                    const found = allUsers.find(x => x.username === u);
                    return found ? (found.name || found.username) : u;
                });
                q('#u-m-assignee').textContent = names.join(', ');
            } else {
                q('#u-m-assignee').textContent = t.assigneeName || 'Niemand';
            }
        }

        // Reset Tabs
        const btnDetails = q('.tab-btn[data-tab="u-details"]');
        if (btnDetails) btnDetails.click();

        // Reset Files
        UserDash.selectedFiles = [];
        UserDash.renderFilePreview();

        AdminBoard.renderChat(t, '#u-chat-msgs');

        // Handle Archived State
        const isArchived = t.archived === true;
        const chatInput = q('#u-chat-input');
        const chatSend = q('#u-chat-send');
        const chatFile = q('#u-chat-file');

        if (isArchived) {
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = 'Ticket ist archiviert (Keine Antwort möglich)';
            }
            if (chatSend) {
                chatSend.disabled = true;
                chatSend.style.opacity = '0.5';
            }
            if (chatFile) chatFile.disabled = true;
        } else {
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.placeholder = 'Nachricht schreiben...';
            }
            if (chatSend) {
                chatSend.disabled = false;
                chatSend.style.opacity = '1';
            }
            if (chatFile) chatFile.disabled = false;
        }

        q('#u-ticket-modal').classList.add('open');
    },

    closeModal: () => {
        q('#u-ticket-modal').classList.remove('open');
        UserDash.currentTicketId = null;
    },

    renderList: async () => {
        const list = q('#user-tickets');
        if (!list) return;
        const user = await Store.currentUser();
        // Show all tickets for user (including archived)
        let tickets = (await Store.getTickets()).filter(t => t.author === user.username);

        // Search Filter
        const query = (q('#u-search')?.value || '').toLowerCase().trim();
        if (query) {
            tickets = tickets.filter(t =>
                t.title.toLowerCase().includes(query) ||
                (t.desc && t.desc.toLowerCase().includes(query)) ||
                t.status.toLowerCase().includes(query) ||
                (t.category && (Array.isArray(t.category) ? t.category.join(' ') : t.category).toLowerCase().includes(query))
            );
        }

        list.innerHTML = '';
        if (tickets.length === 0) {
            list.innerHTML = '<div style="opacity:0.5; padding:10px;">Keine Tickets gefunden</div>';
            return;
        }

        tickets.sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        }).forEach(t => {
            const el = document.createElement('div');
            el.className = 'ticket-row';
            el.style.cursor = 'pointer';

            if (t.archived) {
                el.style.opacity = '0.6';
                el.style.filter = 'blur(0.5px)';
            }

            const cats = Array.isArray(t.category) ? t.category : [t.category || '-'];
            const catBadges = cats.map(c => `<span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:10px; margin-right:4px;">${c}</span>`).join('');

            el.innerHTML = `
                <div class="status-indicator" style="background:${getStatusColor(t.status)}; width:8px; height:8px; border-radius:50%;"></div>
                <div style="font-weight:600; display:flex; flex-direction:column; gap:2px;">
                    <span>${t.title} ${t.archived ? '(Archiviert)' : ''}</span>
                    <div style="display:flex; flex-wrap:wrap;">${catBadges}</div>
                </div>
                <div class="status-badge">${t.status}</div>
                <div class="date">${Utils.fmtDate(t.createdAt)}</div>
                <div style="font-size:12px; color:var(--text-sec)">${t.prio}</div>
            `;
            el.onclick = () => UserDash.openModal(t.id);
            list.appendChild(el);
        });
    }
};

function getStatusColor(s) {
    if (s === 'Neu') return '#3b82f6';
    if (s === 'In Bearbeitung') return '#f59e0b';
    if (s === 'Geschlossen') return '#10b981';
    return '#888';
}

function getPrioValue(p) {
    if (p === 'Kritisch') return 3;
    if (p === 'Hoch') return 2;
    if (p === 'Normal') return 1;
    return 0;
}

// --- Admin Kanban Logic ---
const AdminBoard = {
    selectedFiles: [],

    renderFilePreview: () => {
        const pan = q('#m-chat-file-preview');
        if (!pan) return;
        pan.innerHTML = '';
        if (AdminBoard.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            AdminBoard.selectedFiles.forEach((f, idx) => {
                const tag = document.createElement('div');
                tag.style.background = 'rgba(0,0,0,0.3)';
                tag.style.padding = '4px 8px';
                tag.style.borderRadius = '4px';
                tag.style.fontSize = '12px';
                tag.innerHTML = `<span>${f.name}</span> <span style="cursor:pointer; color:var(--danger); margin-left:4px;">✕</span>`;
                tag.querySelector('span:last-child').onclick = () => {
                    AdminBoard.selectedFiles.splice(idx, 1);
                    AdminBoard.renderFilePreview();
                };
                pan.appendChild(tag);
            });
        } else {
            pan.style.display = 'none';
        }
    },

    init: async () => {
        if (!q('.kanban-board')) return;

        // Superadmin UI Injection
        // Admin UI Visibility
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        const canUsers = isSuper || (user && user.canManageUsers);
        const canReqs = isSuper || (user && user.canManageRequests);

        if (canUsers) {
            const actions = q('.hero-actions');
            if (actions) {
                if (!q('#btn-manage-users')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-manage-users';
                    btn.className = 'btn-ghost';
                    btn.textContent = '👥 User Manager';
                    btn.onclick = AdminBoard.openUserManager;
                    actions.insertBefore(btn, actions.firstChild);
                }
                if (isSuper && !q('#btn-sys-settings')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-sys-settings';
                    btn.className = 'btn-ghost';
                    btn.textContent = '⚙️ System';
                    btn.onclick = AdminBoard.openSystemSettings;
                    actions.insertBefore(btn, actions.firstChild);
                }
            }
        }
        if (isSuper) {
            const btnLogs = q('#btn-global-logs');
            if (btnLogs) {
                btnLogs.style.display = 'inline-flex';
                btnLogs.onclick = AdminBoard.openGlobalLogsModal;
            }
        }

        const reqBoard = q('#request-list')?.parentElement;
        if (reqBoard) {
            reqBoard.style.display = canReqs ? 'block' : 'none';
        }

        await AdminBoard.render();
        AdminBoard.setupDrag();

        // Archive View Toggle
        const btnArch = q('#btn-archive');
        const btnBack = q('#btn-back-kanban');
        const viewKanban = q('#kanban-view');
        const viewArchive = q('#archive-view');

        if (btnArch && viewKanban && viewArchive) {
            btnArch.onclick = () => {
                viewKanban.style.display = 'none';
                viewArchive.style.display = 'block';
                AdminBoard.renderArchive();
            };
            btnBack.onclick = () => {
                viewArchive.style.display = 'none';
                viewKanban.style.display = 'block';
                AdminBoard.render();
            };
        }

        const archSearch = q('#archive-search');
        if (archSearch) {
            archSearch.oninput = () => AdminBoard.renderArchive();
        }

        // Setup Modal
        if (q('#m-close')) q('#m-close').onclick = AdminBoard.closeModal;
        if (q('#m-close-bt')) q('#m-close-bt').onclick = AdminBoard.closeModal;
        if (q('#ticket-modal')) {
            q('#ticket-modal').onclick = (e) => {
                if (e.target.id === 'ticket-modal' || e.target.classList.contains('modal-container')) {
                    AdminBoard.closeModal();
                }
            };
        }

        // Chat Send (Admin)
        if (q('#btn-chat-send')) {
            q('#btn-chat-send').onclick = () => AdminBoard.postChat('admin');
            q('#m-chat-input').onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') AdminBoard.postChat('admin');
            };
        }

        // Internal Comment Send (Admin)
        if (q('#btn-add-comment')) {
            q('#btn-add-comment').onclick = AdminBoard.postInternalComment;
        }

        // Date input (Admin) + Formatting
        const fileAdmin = q('#m-chat-file-input');
        if (fileAdmin) {
            fileAdmin.style.display = 'none'; // Ensure hidden
            fileAdmin.onchange = () => {
                Array.from(fileAdmin.files).forEach(f => AdminBoard.selectedFiles.push(f));
                AdminBoard.renderFilePreview();
                fileAdmin.value = '';
            };
        }

        // Formatting Buttons
        const boldBtn = q('#m-chat-bold');
        const italicBtn = q('#m-chat-italic');
        const inputArea = q('#m-chat-input');

        if (boldBtn && inputArea) {
            boldBtn.onclick = () => insertMarkdown(inputArea, '**');
        }
        if (italicBtn && inputArea) {
            italicBtn.onclick = () => insertMarkdown(inputArea, '*');
        }

        function insertMarkdown(area, char) {
            const start = area.selectionStart;
            const end = area.selectionEnd;
            const val = area.value;
            const sel = val.substring(start, end);
            const replace = char + sel + char;
            area.value = val.substring(0, start) + replace + val.substring(end);
            area.focus();
            area.selectionStart = start + char.length;
            area.selectionEnd = end + char.length;
        }

        // Archive Action
        if (q('#btn-archive-ticket')) {
            q('#btn-archive-ticket').onclick = AdminBoard.archiveCurrent;
        }

        // Tabs
        qa('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                const parent = btn.parentElement;
                parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const targetId = btn.getAttribute('data-tab');
                const modalBody = parent.parentElement;
                modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                const target = modalBody.querySelector(`#tab-${targetId}`) || modalBody.querySelector(`#${targetId}`);
                if (target) target.classList.add('active');

                if (targetId.includes('chat')) {
                    const box = modalBody.querySelector('.chat-messages');
                    if (box) box.scrollTop = box.scrollHeight;
                }
            };
        });

        // Approve Modal role toggle
        const roleSel = q('#a-role');
        if (roleSel) {
            roleSel.onchange = () => {
                const dept = q('#a-dept-field');
                if (dept) dept.style.display = roleSel.value === 'admin' ? 'block' : 'none';
            };
        }

        if (q('#um-close')) q('#um-close').onclick = () => q('#user-man-modal').classList.remove('open');
    },

    // ... render methods ...
    render: async () => {
        const user = await Store.currentUser();
        const rawTickets = await Store.getTickets();
        let tickets = rawTickets.filter(t => !t.archived);

        // Filter by Department (if not Superadmin)
        if (user.role === 'admin') {
            // Support array or single string (legacy)
            const depts = Array.isArray(user.dept) ? user.dept : [user.dept || 'Allgemein'];
            // Fix: Check if ANY of the ticket categories match the user's departments
            tickets = tickets.filter(t => {
                const tCats = Array.isArray(t.category) ? t.category : [t.category || 'Allgemein'];
                const isAssigned = (t.assignees || []).includes(user.username) || t.assignee === user.username;
                return tCats.some(c => depts.includes(c)) || depts.includes('All') || isAssigned;
            });
        }
        // Superadmin sees all (no filter)

        // Sort by Priority then Date
        tickets.sort((a, b) => {
            const pA = getPrioValue(a.prio);
            const pB = getPrioValue(b.prio);
            if (pA !== pB) return pB - pA;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const cols = {
            'Neu': q('#list-new'),
            'In Bearbeitung': q('#list-doing'),
            'Geschlossen': q('#list-done')
        };
        const counts = {
            'Neu': 0,
            'In Bearbeitung': 0,
            'Geschlossen': 0
        };

        Object.values(cols).forEach(c => {
            if (c) c.innerHTML = '';
        });

        // Loop tickets but await createCard since it calls Store.getUsers()?
        // createCard uses Store.getUsers() to show assignees properly.
        const allUsers = await Store.getUsers();

        tickets.forEach(t => {
            if (!cols[t.status]) {
                if (cols['Neu']) cols['Neu'].appendChild(createCard(t, allUsers));
                return;
            }
            counts[t.status]++;
            cols[t.status].appendChild(createCard(t, allUsers));
        });

        if (q('#count-new')) q('#count-new').textContent = counts['Neu'];
        if (q('#count-doing')) q('#count-doing').textContent = counts['In Bearbeitung'];
        if (q('#count-done')) q('#count-done').textContent = counts['Geschlossen'];

        AdminBoard.renderRequests();

        function createCard(t, usersList) {
            const card = document.createElement('div');
            card.className = 'ticket-card';
            card.draggable = true;
            card.dataset.id = t.id;

            let assigneeHtml = `<span style="opacity:0.5; font-size:11px">Unzugewiesen</span>`;

            if (t.assignees && t.assignees.length > 0) {
                const names = t.assignees.map(u => {
                    const found = usersList.find(x => x.username === u);
                    return found ? (found.name || found.username) : u;
                });
                assigneeHtml = `<span class="assignee-badge">👤 ${names.join(', ')}</span>`;
            } else if (t.assigneeName) {
                assigneeHtml = `<span class="assignee-badge">👤 ${t.assigneeName}</span>`;
            }

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <span class="t-tag prio-${t.prio}">${t.prio}</span>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; max-width:60%;">
                        ${(Array.isArray(t.category) ? t.category : [t.category || '-']).map(c => `<span class="t-category">${c}</span>`).join('')}
                    </div>
                </div>
                <div class="t-title">${t.title}</div>
                <div class="t-meta">
                    <span>${t.authorName}</span>
                    <span>${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                </div>
                <div class="t-meta" style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
                     ${assigneeHtml}
                     <span style="font-size:10px">💬 ${(t.chat?.length || 0)}</span>
                </div>
            `;
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', t.id);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            card.addEventListener('click', () => AdminBoard.openModal(t.id));
            return card;
        }
    },

    // START OF MISSING FUNCTIONS
    archiveCurrent: () => {
        UI.confirm('Ticket ins Archiv verschieben? Es wird aus dem Board entfernt.', async () => {
            const id = AdminBoard.currentTicketId;
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t) {
                t.archived = true;
                t.archivedAt = Utils.nowISO(); // Save archive timestamp
                await Store.addLog(t, 'Ticket archiviert');
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Ticket archiviert', `Titel: ${t.title}`);
                AdminBoard.closeModal();
                await AdminBoard.render();
                UI.toast('Ticket archiviert');
            }
        });
    },

    openGlobalLogsModal: async () => {
        let modal = q('#global-logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'global-logs-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '10000';
            modal.innerHTML = `
                <div class="modal" style="max-width:800px; width:95%;">
                    <div class="modal-header">
                        <h3>🔔 System Protokoll</h3>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input type="text" id="gl-search" placeholder="Durchsuchen..." style="padding:10px 14px; font-size:13px; border-radius:8px; border:1px solid var(--border); background:var(--card-bg); width:250px;">
                            <button class="btn-ghost" id="btn-gl-clear" style="color:var(--danger); font-size:20px; padding:0 10px;" title="Protokoll leeren">🗑️</button>
                            <button class="btn-ghost" onclick="q('#global-logs-modal').classList.remove('open')">✕</button>
                        </div>
                    </div>
                    <div class="modal-body" id="gl-body" style="padding:0; overflow-y:auto; max-height:70vh; background:rgba(0,0,0,0.1);"></div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="q('#global-logs-modal').classList.remove('open')">Schließen</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            q('#gl-search').oninput = () => AdminBoard.renderGlobalLogs();
            q('#btn-gl-clear').onclick = () => {
                UI.confirm('System-Protokoll wirklich vollständig leeren?', async () => {
                    await Store.saveGlobalLogs([]);
                    AdminBoard.renderGlobalLogs();
                    UI.toast('Protokoll geleert');
                });
            };
        }

        AdminBoard.renderGlobalLogs();
        modal.classList.add('open');
    },

    renderGlobalLogs: async () => {
        const body = q('#gl-body');
        if (!body) return;

        const logs = await Store.getGlobalLogs();
        const search = q('#gl-search').value.toLowerCase();

        const filtered = logs.filter(l =>
            l.user.toLowerCase().includes(search) ||
            l.action.toLowerCase().includes(search) ||
            l.details.toLowerCase().includes(search)
        );

        body.innerHTML = filtered.slice().reverse().map(l => `
            <div style="padding:12px 20px; border-bottom:1px solid var(--border); transition:background 0.2s;">
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                    <span style="font-weight:700; color:var(--primary-solid)">${l.user}</span>
                    <span style="opacity:0.6">${Utils.fmtDate(l.date)}</span>
                </div>
                <div style="font-weight:600; font-size:13px; margin-bottom:2px;">${l.action}</div>
                <div style="font-size:11px; opacity:0.8; font-style:italic;">${l.details || ''}</div>
            </div>
        `).join('') || '<p style="text-align:center; padding:40px; opacity:0.5;">Keine Einträge gefunden.</p>';
    },

    // User Manager Logic
    openUserManager: async () => {
        const modal = q('#user-man-modal');
        modal.classList.add('open');
        await AdminBoard.renderUserManager('users'); // Default tab

        // Setup UM Tabs
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';

        let tabs = modal.querySelector('.um-tabs');
        if (tabs) tabs.remove();

        tabs = document.createElement('div');
        tabs.className = 'um-tabs tabs';
        tabs.style.margin = '0 20px';
        tabs.style.borderBottom = '1px solid var(--border)';

        tabs.innerHTML = `
            <div class="tab-btn active" data-view="users">Benutzer</div>
            ${isSuper ? `<div class="tab-btn" data-view="admins">Admins</div>` : ''}
            ${isSuper ? `<div class="tab-btn" data-view="cats">Kategorien</div>` : ''}
        `;

        const header = modal.querySelector('.modal-header');
        header.insertAdjacentElement('afterend', tabs);

        tabs.querySelectorAll('.tab-btn').forEach(b => {
            b.onclick = () => {
                tabs.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                AdminBoard.renderUserManager(b.dataset.view);
            };
        });
    },

    renderUserManager: async (view) => {
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';
        // Non-supers can ONLY see 'users'
        if (!isSuper) view = 'users';

        const listContainer = q('#um-list');
        listContainer.className = 'user-list-container';

        // Skeleton for search and actions
        if (!q('#um-search')) {
            listContainer.innerHTML = `
                <div class="um-controls" style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px; position:sticky; top:-20px; background:var(--bg2); z-index:100; padding:20px 0 15px; align-items:center; border-bottom:1px solid var(--border); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);">
                    <input type="text" id="um-search" placeholder="Durchsuchen..." style="flex:1; min-width:200px; background:var(--card-bg); border-radius:10px;">
                    <div id="um-actions" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
                </div>
                <div id="um-results"></div>
            `;
            q('#um-search').focus();
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        } else {
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        }

        const searchTerm = q('#um-search').value.toLowerCase();
        const actions = q('#um-actions');
        const list = q('#um-results');
        list.className = 'user-list';
        list.innerHTML = '';

        if (view === 'users' || view === 'admins') {
            actions.innerHTML = `
                <button class="btn-primary" id="btn-add-user" style="white-space:nowrap;">+ Neu</button>
                <button class="btn-ghost" id="btn-csv-export" title="CSV Export">⬇️</button>
                ${isSuper ? '<button class="btn-ghost" id="btn-csv-import" title="CSV Import">⬆️</button>' : ''}
                ${isSuper ? '<button class="btn-ghost" id="btn-ldap-sync" title="LDAP Sync">🔄</button>' : ''}
            `;
            actions.querySelector('#btn-add-user').onclick = () => AdminBoard.openEditUserModal(null, view);
            actions.querySelector('#btn-csv-export').onclick = () => AdminBoard.exportUsersCSV();
            if (isSuper) {
                actions.querySelector('#btn-csv-import').onclick = () => AdminBoard.importUsersCSV();
                actions.querySelector('#btn-ldap-sync').onclick = () => {
                    UI.toast('LDAP Sync gestartet...');
                    setTimeout(() => UI.toast('LDAP Sync erfolgreich (Simuliert)'), 1500);
                };
            }
        } else {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-cat">Neu anlegen</button>`;
            actions.querySelector('#btn-add-cat').onclick = () => AdminBoard.openEditCategoryModal(null);
        }

        if (view === 'cats') {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            categories.filter(c => c.toLowerCase().includes(searchTerm)).forEach(c => {
                const el = document.createElement('div');
                el.className = 'ticket-row';
                el.style.display = 'flex';
                el.style.justifyContent = 'space-between';
                el.innerHTML = `
                    <div style="font-weight:600">${c}</div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-ghost edit-c">✏️</button>
                        <button class="btn-ghost del-c" style="color:var(--danger)">🗑️</button>
                    </div>
                 `;
                el.querySelector('.edit-c').onclick = () => AdminBoard.openEditCategoryModal(c);
                el.querySelector('.del-c').onclick = () => {
                    UI.confirm(`Kategorie "${c}" löschen?`, async () => {
                        const s = await Store.getSettings();
                        if (s.categories) {
                            s.categories = s.categories.filter(x => x !== c);
                            await Store.saveSettings(s);
                            await Store.addGlobalLog('Kategorie gelöscht', `Name: ${c}`);
                            AdminBoard.renderUserManager('cats');
                        }
                    });
                };
                list.appendChild(el);
            });
            return;
        }

        const users = await Store.getUsers();
        const filtered = users.filter(u => {
            const matchesView = (view === 'users' && u.role === 'user') ||
                (view === 'admins' && (u.role === 'admin' || u.role === 'superadmin'));
            if (!matchesView) return false;

            if (!searchTerm) return true;
            return u.username.toLowerCase().includes(searchTerm) ||
                (u.name && u.name.toLowerCase().includes(searchTerm)) ||
                (u.email && u.email.toLowerCase().includes(searchTerm));
        });

        filtered.forEach(u => {
            const el = document.createElement('div');
            el.className = 'ticket-row';
            el.style.display = 'flex';
            el.style.justifyContent = 'space-between';

            let roleInfo = u.role.toUpperCase();
            if (u.role === 'admin') {
                const d = u.dept;
                const dStr = Array.isArray(d) ? d.join(', ') : (d || 'Allgemein');
                roleInfo += ` (${dStr})`;
            }

            el.innerHTML = `
                <div style="display:flex; align-items:center;">
                    <div>
                        <strong>${u.username}</strong> ${u.twoFactorEnabled ? ' <span title="2FA Aktiv" style="font-size:10px; cursor:help;">🔐</span>' : ''} <br>
                        <span style="font-size:12px; opacity:0.8">${u.name || '-'} | ${u.email || 'Keine Email'}</span>
                        <div style="font-size:10px; opacity:0.6; margin-top:2px;">${roleInfo}</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${isSuper && u.twoFactorEnabled ? `<button class="btn-ghost reset-2fa" style="padding:4px; font-size:10px; color:var(--warning)" title="2FA zurücksetzen">🔓 2FA</button>` : ''}
                    <button class="btn-ghost edit-u" style="padding:4px;" title="Bearbeiten">✏️</button>
                    ${u.role !== 'superadmin' && u.username !== 'admin' ? `<button class="btn-ghost del-u" style="padding:4px; color:var(--danger);" title="Löschen">🗑️</button>` : ''}
                </div>
            `;

            if (el.querySelector('.reset-2fa')) {
                el.querySelector('.reset-2fa').onclick = () => {
                    UI.confirm(`2FA für ${u.username} zurücksetzen?`, async () => {
                        let users = await Store.getUsers();
                        const idx = users.findIndex(x => x.id === u.id);
                        if (idx > -1) {
                            users[idx].twoFactorEnabled = false;
                            await Store.saveUsers(users);
                            UI.toast('2FA deaktiviert');
                            await Store.addGlobalLog('2FA zurückgesetzt', `Für Benutzer: ${u.username}`);
                            AdminBoard.renderUserManager(view);
                        }
                    });
                };
            }

            const delBtn = el.querySelector('.del-u');
            if (delBtn) delBtn.onclick = () => {
                const confirmModal = AdminBoard.createGenericModal();
                const title = confirmModal.querySelector('h3');
                const content = confirmModal.querySelector('.modal-body');
                const footer = confirmModal.querySelector('.modal-footer');

                title.textContent = 'Benutzer löschen';
                content.innerHTML = `
                    <p>Möchtest du <strong>${u.username}</strong> wirklich löschen?</p>
                    <p style="margin-top:10px; font-size:13px; color:var(--text-sec)">
                        Dieser Benutzer hat Tickets erstellt. Was soll damit geschehen?
                    </p>
                    <div style="margin-top:15px; display:flex; flex-direction:column; gap:8px;">
                        <label style="cursor:pointer"><input type="radio" name="del-opt" value="archive" checked> Tickets archivieren (Empfohlen)</label>
                        <label style="cursor:pointer"><input type="radio" name="del-opt" value="delete"> Tickets unwiderruflich löschen</label>
                    </div>
                `;

                footer.innerHTML = `
                    <button class="btn-ghost close-m">Abbrechen</button>
                    <button class="btn-danger" id="btn-perform-del">Löschen</button>
                `;

                confirmModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => confirmModal.classList.remove('open'));

                confirmModal.querySelector('#btn-perform-del').onclick = async () => {
                    const opt = confirmModal.querySelector('input[name="del-opt"]:checked').value;
                    let users = await Store.getUsers();
                    users = users.filter(x => x.id !== u.id);
                    await Store.saveUsers(users);

                    const tickets = await Store.getTickets();
                    let tChanged = false;
                    for (let i = tickets.length - 1; i >= 0; i--) {
                        if (tickets[i].author === u.username) {
                            if (opt === 'delete') {
                                tickets.splice(i, 1);
                                tChanged = true;
                            } else {
                                if (!tickets[i].archived) {
                                    tickets[i].archived = true;
                                    tickets[i].archivedAt = Utils.nowISO();
                                    tChanged = true;
                                }
                            }
                        }
                    }
                    if (tChanged) await Store.saveTickets(tickets);

                    await Store.addGlobalLog('Benutzer gelöscht', `Name: ${u.username}, Verbleib Tickets: ${opt}`);
                    UI.toast(`Benutzer ${u.username} gelöscht.`);
                    confirmModal.classList.remove('open');
                    AdminBoard.renderUserManager(view);
                };

                confirmModal.classList.add('open');
            };

            el.querySelector('.edit-u').onclick = () => AdminBoard.openEditUserModal(u, view);
            list.appendChild(el);
        });
    },

    openEditCategoryModal: async (catName) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');

        const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin');

        let adminListHtml = `
            <div class="field" style="margin-top:15px;">
                <label>Admins dieser Kategorie zuweisen:</label>
                <div id="cat-admin-list" style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:6px; max-height:150px; overflow-y:auto; margin-top:5px;">
        `;

        admins.forEach(a => {
            const hasCat = catName && Array.isArray(a.dept) && a.dept.includes(catName);
            adminListHtml += `
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
                    <input type="checkbox" value="${a.username}" ${hasCat ? 'checked' : ''} class="cat-admin-check"> ${a.name || a.username}
                </label>
            `;
        });
        adminListHtml += '</div></div>';

        title.textContent = catName ? 'Kategorie bearbeiten' : 'Neue Kategorie';
        content.innerHTML = `
            <div class="field">
                <label>Name</label>
                <input type="text" id="g-input" value="${catName || ''}">
            </div>
            ${adminListHtml}
        `;

        modal.classList.add('open');
        confirmBtn.onclick = async () => {
            const val = q('#g-input').value.trim();
            if (!val) return;

            const settings = await Store.getSettings();
            if (!settings.categories) settings.categories = ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            const allUsers = await Store.getUsers();
            const checkedAdmins = Array.from(modal.querySelectorAll('.cat-admin-check:checked')).map(cb => cb.value);

            if (catName) {
                // Rename logic
                const idx = settings.categories.indexOf(catName);
                if (idx !== -1) settings.categories[idx] = val;

                // Update all admins
                allUsers.forEach(u => {
                    if (u.role === 'admin' || u.role === 'superadmin') {
                        if (!u.dept) u.dept = [];
                        if (!Array.isArray(u.dept)) u.dept = [u.dept];

                        const hadOld = u.dept.indexOf(catName);
                        const isChecked = checkedAdmins.includes(u.username);

                        if (hadOld !== -1) {
                            if (isChecked) {
                                u.dept[hadOld] = val; // Rename
                            } else {
                                u.dept.splice(hadOld, 1); // Remove
                            }
                        } else if (isChecked) {
                            u.dept.push(val); // Add new
                        }
                    }
                });
                await Store.addGlobalLog('Kategorie bearbeitet', `Alt: ${catName}, Neu: ${val}`);
            } else {
                // New category logic
                if (!settings.categories.includes(val)) {
                    settings.categories.push(val);
                }

                // Assign to checked admins
                allUsers.forEach(u => {
                    if (checkedAdmins.includes(u.username)) {
                        if (!u.dept) u.dept = [];
                        if (!Array.isArray(u.dept)) u.dept = [u.dept];
                        if (!u.dept.includes(val)) u.dept.push(val);
                    }
                });
                await Store.addGlobalLog('Kategorie erstellt', `Name: ${val}`);
            }

            await Store.saveSettings(settings);
            await Store.saveUsers(allUsers);
            modal.classList.remove('open');
            AdminBoard.renderUserManager('cats');
            UI.toast(catName ? 'Kategorie bearbeitet' : 'Kategorie erstellt');
        };
    },

    openEditUserModal: async (user, viewContext) => {
        let editModal = q('#user-edit-modal');
        if (!editModal) {
            editModal = document.createElement('div');
            editModal.id = 'user-edit-modal';
            editModal.className = 'modal-overlay';
            editModal.innerHTML = `
                <div class="modal" style="max-width:500px">
                    <div class="modal-header"><h3>Benutzer bearbeiten</h3><button class="btn-ghost close-m">✕</button></div>
                    <div class="modal-body">
                        <div class="field"><label>Benutzername</label><input id="ue-user" type="text"></div>
                        <div class="field"><label>Name</label><input id="ue-name" type="text"></div>
                        <div class="field"><label>Email</label><input id="ue-email" type="email"></div>
                        <div class="field"><label>Passwort (leer lassen für keine Änderung)</label><input id="ue-pass" type="password"></div>
                        <div class="field" id="ue-role-box"><label>Rolle</label><select id="ue-role"><option value="user">User</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></div>
                         <div class="field" id="ue-dept-box" style="display:none">
                            <label>Kategorien</label>
                            <div id="ue-dept-list" style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:6px; max-height:150px; overflow-y:auto;"></div>
                         </div>
                         <div class="field" id="ue-man-box" style="display:none">
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:5px;">
                                <input type="checkbox" id="ue-can-manage-req"> Kontoanfragen verwalten
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <input type="checkbox" id="ue-can-manage-users"> Benutzerverwaltung (nur User)
                            </label>
                         </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-ghost close-m">Abbrechen</button>
                        <button class="btn-primary" id="ue-save">Speichern</button>
                    </div>
                </div>`;
            document.body.appendChild(editModal);
            editModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => editModal.classList.remove('open'));
        }

        // Fill Data
        const isNew = !user;
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        q('#ue-user').value = isNew ? '' : user.username;
        q('#ue-user').disabled = !isNew;
        q('#ue-name').value = isNew ? '' : (user.name || '');
        q('#ue-email').value = isNew ? '' : (user.email || '');
        q('#ue-pass').value = '';

        const roleSel = q('#ue-role');
        roleSel.value = isNew ? (viewContext === 'admins' ? 'admin' : 'user') : user.role;

        // Permissions check for roles
        if (!isSuper) {
            q('#ue-role-box').style.display = 'none'; // Admins cannot change roles
        }

        const manBox = q('#ue-man-box');
        const manReqCheck = q('#ue-can-manage-req');
        const manUsersCheck = q('#ue-can-manage-users');
        if (manReqCheck) manReqCheck.checked = user ? !!user.canManageRequests : false;
        if (manUsersCheck) manUsersCheck.checked = user ? !!user.canManageUsers : false;

        const updateUI = () => {
            const r = roleSel.value;
            q('#ue-dept-box').style.display = r === 'admin' ? 'block' : 'none';
            if (manBox) manBox.style.display = (r === 'admin' && isSuper) ? 'block' : 'none';
        };
        roleSel.onchange = updateUI;
        updateUI();

        // Departments Checkboxes
        const settings = await Store.getSettings();
        if (!settings.categories) settings.categories = ['Allgemein', 'Technik', 'Account', 'Abrechnung'];

        const list = q('#ue-dept-list');
        list.innerHTML = '';

        // Normalize user.dept to array
        let userDepts = [];
        if (user && user.dept) {
            userDepts = Array.isArray(user.dept) ? user.dept : [user.dept];
        }

        settings.categories.forEach(c => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '8px';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = c;
            chk.checked = userDepts.includes(c);
            // Styling checkbox not trivial, leaving default
            chk.style.width = 'auto'; // override default full width input

            const lbl = document.createElement('label');
            lbl.textContent = c;
            lbl.style.marginBottom = '0'; // reset label style
            lbl.style.cursor = 'pointer';
            lbl.onclick = () => chk.click(); // Label click toggles checkbox

            div.appendChild(chk);
            div.appendChild(lbl);
            list.appendChild(div);
        });

        const toggleDept = () => {
            const r = q('#ue-role').value;
            q('#ue-dept-box').style.display = (r === 'admin') ? 'block' : 'none';
        };
        q('#ue-role').onchange = toggleDept;
        toggleDept();

        editModal.querySelector('h3').textContent = isNew ? 'Neuen Benutzer anlegen' : `Benutzer ${user.username} bearbeiten`;
        editModal.classList.add('open');

        q('#ue-save').onclick = async () => {
            const uVal = q('#ue-user').value.trim();
            const nVal = q('#ue-name').value.trim();
            const eVal = q('#ue-email').value.trim();
            const pVal = q('#ue-pass').value.trim();
            const rVal = q('#ue-role').value;

            // Collect checked departments
            const dVal = [];
            list.querySelectorAll('input[type="checkbox"]:checked').forEach(c => dVal.push(c.value));

            if (!uVal) {
                UI.toast('Benutzername fehlt');
                return;
            }

            const users = await Store.getUsers();

            if (isNew) {
                if (users.find(x => x.username === uVal)) {
                    UI.toast('Benutzer existiert schon');
                    return;
                }
                if (!pVal) {
                    UI.toast('Passwort fehlt');
                    return;
                }
                const newUser = {
                    id: Utils.uid(),
                    username: uVal,
                    name: nVal,
                    email: eVal,
                    password: pVal,
                    role: rVal,
                    dept: rVal === 'admin' ? dVal : undefined,
                    canManageRequests: rVal === 'admin' ? q('#ue-can-manage-req').checked : false,
                    canManageUsers: rVal === 'admin' ? q('#ue-can-manage-users').checked : false
                };
                users.push(newUser);
                await Store.addGlobalLog('Benutzer erstellt', `Name: ${newUser.name || newUser.username}, Rolle: ${newUser.role}`);
            } else {
                const target = users.find(x => x.id === user.id);
                if (target) {
                    target.name = nVal;
                    target.email = eVal;
                    if (pVal) target.password = pVal;
                    // Only superadmins can change these
                    if (isSuper) {
                        target.role = rVal;
                        target.canManageRequests = rVal === 'admin' ? q('#ue-can-manage-req').checked : false;
                        target.canManageUsers = rVal === 'admin' ? q('#ue-can-manage-users').checked : false;
                    }
                    target.dept = target.role === 'admin' ? dVal : undefined;
                    await Store.addGlobalLog('Benutzer bearbeitet', `Name: ${target.name || target.username}, Rolle: ${target.role}`);
                }
            }
            await Store.saveUsers(users);
            editModal.classList.remove('open');
            AdminBoard.renderUserManager(viewContext);
            UI.toast('Gespeichert');
        };
    },

    createGenericModal: () => {
        const modal = document.createElement('div');
        modal.id = 'generic-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:400px">
                <div class="modal-header"><h3></h3><button class="btn-ghost close-m">✕</button></div>
                <div class="modal-body"></div>
                <div class="modal-footer">
                    <button class="btn-ghost close-m">Abbrechen</button>
                    <button class="btn-primary">Speichern</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
        return modal;
    },

    openSystemSettings: async () => {
        let modal = q('#sys-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sys-settings-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal" style="max-width:500px">
                    <div class="modal-header"><h3>Systemeinstellungen</h3><button class="btn-ghost close-m">✕</button></div>
                    <div class="tabs" style="justify-content:flex-start; margin:0 20px; border-bottom:1px solid var(--border)">
                        <button class="tab-btn active" data-tab="sys-email">Email</button>
                        <button class="tab-btn" data-tab="sys-sec">Sicherheit</button>
                        <button class="tab-btn" data-tab="sys-ldap">LDAP</button>
                    </div>
                    <div class="modal-body">
                        <div id="sys-email" class="tab-content active">
                            <div class="field"><label>SMTP Host</label><input id="sys-smtp-host" type="text" placeholder="smtp.example.com"></div>
                            <div class="field"><label>SMTP Port</label><input id="sys-smtp-port" type="number" placeholder="587"></div>
                            <div class="field"><label>SMTP User</label><input id="sys-smtp-user" type="text"></div>
                            <div class="field"><label>SMTP Password</label><input id="sys-smtp-pass" type="password"></div>
                            <div class="field"><label>Absender Adresse</label><input id="sys-smtp-from" type="email" placeholder="noreply@example.com"></div>
                            <div style="font-size:11px; opacity:0.6; margin-top:10px;">Hinweis: Dies simuliert die Konfiguration. Echtes SMTP benötigt ein Backend.</div>
                        </div>
                        <div id="sys-sec" class="tab-content">
                            <div class="field">
                                <label>2FA Erzwingen</label>
                                <select id="sys-2fa-enforce">
                                    <option value="none">Nicht erzwingen (Optional)</option>
                                    <option value="all">Alle Nutzer</option>
                                    <option value="admin">Nur Admins</option>
                                    <option value="user">Nur User</option>
                                </select>
                            </div>
                            <div style="font-size:11px; opacity:0.6; margin-top:10px;">Benutzer werden beim Login aufgefordert, 2FA einzurichten, wenn sie betroffen sind.</div>
                        </div>
                        <div id="sys-ldap" class="tab-content">
                            <div class="field"><label>LDAP Host</label><input id="sys-ldap-host" type="text" placeholder="ldap.example.com"></div>
                            <div class="field"><label>Port</label><input id="sys-ldap-port" type="number" placeholder="389"></div>
                            <div class="field"><label>Base DN</label><input id="sys-ldap-base" type="text" placeholder="dc=example,dc=com"></div>
                            <div class="field"><label>Bind User DN</label><input id="sys-ldap-user" type="text" placeholder="cn=admin,dc=example,dc=com"></div>
                            <div style="font-size:11px; opacity:0.6; margin-top:10px;">Passwort wird bei Bedarf abgefragt (Mock).</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-ghost close-m">Schließen</button>
                        <button class="btn-primary" id="sys-save">Speichern</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            // Tab Logic
            modal.querySelectorAll('.tab-btn').forEach(btn => {
                btn.onclick = () => {
                    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    q('#' + btn.dataset.tab).classList.add('active');
                };
            });

            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
        }

        const settings = await Store.getSettings();
        const email = settings.emailConfig || {};
        const sec = settings.securityConfig || {};

        q('#sys-smtp-host').value = email.host || '';
        q('#sys-smtp-port').value = email.port || '';
        q('#sys-smtp-user').value = email.user || '';
        q('#sys-smtp-pass').value = email.pass || '';
        q('#sys-smtp-from').value = email.from || '';

        q('#sys-2fa-enforce').value = sec.force2FA || 'none';

        const ldap = settings.ldapConfig || {};
        q('#sys-ldap-host').value = ldap.host || '';
        q('#sys-ldap-port').value = ldap.port || '';
        q('#sys-ldap-base').value = ldap.baseDn || '';
        q('#sys-ldap-user').value = ldap.userDn || '';

        modal.classList.add('open');

        q('#sys-save').onclick = async () => {
            const newSettings = await Store.getSettings();
            newSettings.emailConfig = {
                host: q('#sys-smtp-host').value.trim(),
                port: q('#sys-smtp-port').value.trim(),
                user: q('#sys-smtp-user').value.trim(),
                pass: q('#sys-smtp-pass').value.trim(),
                from: q('#sys-smtp-from').value.trim()
            };
            newSettings.securityConfig = {
                force2FA: q('#sys-2fa-enforce').value
            };
            newSettings.ldapConfig = {
                host: q('#sys-ldap-host').value.trim(),
                port: q('#sys-ldap-port').value.trim(),
                baseDn: q('#sys-ldap-base').value.trim(),
                userDn: q('#sys-ldap-user').value.trim()
            };

            await Store.saveSettings(newSettings);
            modal.classList.remove('open');
            UI.toast('Systemeinstellungen gespeichert');
            await Store.addGlobalLog('Systemeinstellungen gespeichert', `Geänderte Bereiche: Email, Sicherheit, LDAP`);
        };
    },

    // ... existing openApproveModal ...
    renderArchive: async () => {
        const list = q('#archive-list');
        if (!list) return;

        const query = (q('#archive-search')?.value || '').toLowerCase().trim();
        let archived = (await Store.getTickets()).filter(t => t.archived);

        if (query) {
            archived = archived.filter(t =>
                (t.title || '').toLowerCase().includes(query) ||
                (t.authorName || '').toLowerCase().includes(query) ||
                (t.author || '').toLowerCase().includes(query) ||
                (t.desc || '').toLowerCase().includes(query)
            );
        }

        archived.sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));

        list.innerHTML = '';
        if (archived.length === 0) {
            list.innerHTML = `<div style="opacity:0.5; padding:20px;">${query ? 'Keine Treffer im Archiv' : 'Keine archivierten Tickets'}</div>`;
            return;
        }
        archived.forEach(t => {
            const el = document.createElement('div');
            el.className = 'ticket-row archive-ticket-row';

            const archDate = t.archivedAt ? Utils.fmtDate(t.archivedAt) : '-';

            el.innerHTML = `
                <div class="status-indicator" style="background:${getStatusColor(t.status)}; width:10px; height:10px; border-radius:50%;"></div>
                <div style="font-weight:600; color:var(--text)"><span style="opacity:0.7">Titel:</span><br>${t.title}</div>
                <div class="status-badge">${t.status}</div>
                <div class="date">
                    <span style="opacity:0.7">Erstellt:</span><br>${Utils.fmtDate(t.createdAt)}
                </div>
                <div class="date">
                    <span style="opacity:0.7">Archiviert:</span><br>${archDate}
                </div>
                <div style="font-size:12px; color:var(--text-sec)"><span style="opacity:0.7">Benutzer:</span><br>${t.authorName}</div>
            `;

            el.onclick = () => AdminBoard.openModal(t.id);
            list.appendChild(el);
        });
    },

    renderRequests: async () => {
        const list = q('#request-list');
        if (!list) return;
        const reqs = await Store.getRequests();
        list.innerHTML = '';
        if (reqs.length === 0) {
            list.innerHTML = '<div style="opacity:0.5; font-size:12px; padding:10px;">Keine Anfragen</div>';
            return;
        }
        reqs.forEach(r => {
            const el = document.createElement('div');
            el.className = 'ticket-card';
            el.style.borderColor = 'var(--warning)';
            el.innerHTML = `
                 <div style="font-weight:600">${r.name}</div>
                 <div style="font-size:12px; opacity:0.7">${r.email}</div>
                 <div style="margin-top:8px; display:flex; gap:8px;">
                     <button class="btn-primary" style="padding:4px 8px; font-size:11px;">Annehmen</button>
                     <button class="btn-ghost" style="padding:4px 8px; font-size:11px;">Ablehnen</button>
                 </div>
             `;
            el.querySelector('.btn-primary').onclick = () => AdminBoard.openApproveModal(r);
            el.querySelector('.btn-ghost').onclick = () => {
                UI.confirm('Anfrage löschen?', async () => {
                    let rest = await Store.getRequests();
                    rest = rest.filter(x => x.id !== r.id);
                    await Store.saveRequests(rest);
                    await Store.addGlobalLog('Kontosanfrage abgelehnt', `Anfrage von: ${r.name}`);
                    AdminBoard.renderRequests();
                });
            };
            list.appendChild(el);
        });
    },

    setupDrag: () => {
        qa('.ticket-list').forEach(zone => {
            zone.addEventListener('dragover', e => {
                e.preventDefault();
                zone.style.background = 'var(--card-hover)';
            });
            zone.addEventListener('dragleave', e => {
                zone.style.background = '';
            });
            zone.addEventListener('drop', async e => {
                e.preventDefault();
                zone.style.background = '';
                const id = e.dataTransfer.getData('text/plain');
                const newStatus = zone.dataset.status;
                const tickets = await Store.getTickets();
                const t = tickets.find(x => x.id === id);
                if (t && t.status !== newStatus) {
                    await Store.addLog(t, `Status geändert von ${t.status} zu ${newStatus}`);
                    t.status = newStatus;
                    await Store.saveTickets(tickets);

                    // Email Notification
                    const s = await Store.getSettings();
                    if (s.emailConfig && s.emailConfig.host) {
                        // Notify Author
                        const users = await Store.getUsers();
                        const author = users.find(u => u.username === t.author);
                        if (author && author.email) {
                            Store.sendEmail(author.email, `Ticket Update: ${t.title}`, `Status geändert auf: ${newStatus}`);
                        }
                    }
                    await Store.addGlobalLog('Ticket Status geändert', `Ticket: ${t.title}, Status: ${newStatus}`);
                    await AdminBoard.render();
                    UI.toast(`Status geändert: ${newStatus}`);
                }
            });
        });
    },

    // Modal Logic
    currentTicketId: null,

    openModal: async (id) => {
        try {
            AdminBoard.currentTicketId = id;
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (!t) return;

            await Store.addGlobalLog('Ticket geöffnet', `ID: ${t.id}, Titel: ${t.title}`);

            const user = await Store.currentUser();
            const isSuper = user && user.role === 'superadmin';

            q('#m-title').textContent = t.title + (t.archived ? ' [ARCHIVIERT]' : '');
            q('#m-desc').textContent = t.desc || 'Keine Beschreibung';

            // Elements
            const prioSel = q('#m-prio-edit');
            const catSel = q('#m-cat-edit');
            const msHeader = q('#ms-header');
            const msDropdown = q('#ms-dropdown');
            const commentInput = q('#m-new-comment');
            const commentBtn = q('#btn-add-comment');
            const chatInput = q('#m-chat-input');
            const chatSend = q('#btn-chat-send');
            const btnArch = q('#btn-archive-ticket');
            const btnLogs = q('#m-logs');

            // Archive/Re-activate logic integration
            let btnReact = q('#btn-reactivate-ticket');
            if (!btnReact && btnArch) {
                btnReact = document.createElement('button');
                btnReact.id = 'btn-reactivate-ticket';
                btnReact.className = 'btn-primary';
                btnReact.style.fontSize = '12px';
                btnReact.innerHTML = '⚡ Reaktivieren';
                btnArch.parentElement.appendChild(btnReact);
            }

            if (t.archived) {
                if (btnArch) btnArch.style.display = 'none';
                if (btnReact) {
                    btnReact.style.display = isSuper ? 'inline-block' : 'none';
                    btnReact.onclick = () => AdminBoard.reactivateTicket(t.id);
                }
            } else {
                if (btnReact) btnReact.style.display = 'none';
                if (btnArch) {
                    btnArch.style.display = (t.status === 'Geschlossen') ? 'inline-block' : 'none';
                    btnArch.onclick = () => AdminBoard.archiveCurrent();
                }
            }

            // Disable edits if archived
            if (prioSel) prioSel.disabled = t.archived;
            if (catSel) catSel.disabled = t.archived;
            if (msHeader) msHeader.style.pointerEvents = t.archived ? 'none' : 'auto';
            if (commentInput) commentInput.disabled = t.archived;
            if (commentBtn) {
                commentBtn.disabled = t.archived;
                commentBtn.style.opacity = t.archived ? '0.5' : '1';
            }
            if (chatInput) chatInput.disabled = t.archived;
            if (chatSend) {
                chatSend.disabled = t.archived;
                chatSend.style.opacity = t.archived ? '0.5' : '1';
            }

            // Metadata
            if (q('#m-author')) q('#m-author').textContent = t.authorName || t.author;
            if (q('#m-date')) q('#m-date').textContent = Utils.fmtDate(t.createdAt);

            // Populate Priority
            if (prioSel) {
                prioSel.value = t.prio;
                prioSel.onchange = async () => {
                    const old = t.prio;
                    t.prio = prioSel.value;
                    await Store.addLog(t, `Priorität geändert von ${old} zu ${t.prio}`);
                    await Store.saveTickets(tickets);

                    // Email Notification
                    const s = await Store.getSettings();
                    if (s.emailConfig && s.emailConfig.host) {
                        const users = await Store.getUsers();
                        const author = users.find(u => u.username === t.author);
                        if (author && author.email) {
                            Store.sendEmail(author.email, `Ticket Update: ${t.title}`, `Priorität geändert auf: ${t.prio}`);
                        }
                    }
                    await Store.addGlobalLog('Ticket Priorität geändert', `Ticket: ${t.title}, Priorität: ${t.prio}`);
                    await AdminBoard.render();
                };
            }

            // Populate Category with Custom Multi-Select
            const msContainer = q('#m-cat-container');
            if (msContainer) {
                const settings = await Store.getSettings();
                const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
                const currentCats = Array.isArray(t.category) ? t.category : [t.category || 'Allgemein'];

                UI.createMultiSelect(msContainer, categories, currentCats, async (newCats) => {
                    if (t.archived) return; // Read-only check
                    const old = Array.isArray(t.category) ? t.category.join(', ') : (t.category || '-');
                    t.category = newCats.length > 0 ? newCats : ['Allgemein'];

                    await Store.addLog(t, `Kategorien geändert`, `Alt: ${old} -> Neu: ${t.category.join(', ')}`);
                    await Store.saveTickets(tickets);
                    await Store.addGlobalLog('Ticket Kategorien geändert', `Ticket: ${t.title}, Kategorien: ${t.category.join(', ')}`);
                    await AdminBoard.render();
                    UI.toast('Kategorien aktualisiert');
                });

                // Disable if archived
                if (t.archived) msContainer.style.pointerEvents = 'none';
            }

            // Reset Tabs
            q('.tab-btn[data-tab="details"]').click();

            // History Sidebar refresh if already open
            const sidebar = q('#m-history-sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                await AdminBoard.renderHistory(t.author, id);
            }

            // --- Multi-Select Assignment ---
            const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin');
            const msContainerEl = q('#assignee-multi');

            if (msContainerEl) {
                if (!t.assignees) t.assignees = t.assignee ? [t.assignee] : [];

                UI.createMultiSelect(msContainerEl, admins.map(a => ({ value: a.username, label: a.name || a.username })), t.assignees, async (newAssignees) => {
                    t.assignees = newAssignees;
                    delete t.assignee;
                    const names = newAssignees.map(u => {
                        const found = admins.find(a => a.username === u);
                        return found ? (found.name || found.username) : u;
                    }).join(', ') || 'Niemand';

                    await Store.addLog(t, `Zuweisung aktualisiert`, `Neu: ${names}`);
                    await Store.addGlobalLog('Ticket Zuweisung geändert', `Ticket: ${t.title}, Admins: ${names}`);
                    await Store.saveTickets(tickets);
                    await AdminBoard.render();
                });

                if (t.archived) msContainerEl.style.pointerEvents = 'none';
            }


            AdminBoard.renderInternalComments(t);
            await AdminBoard.renderChat(t, '#m-chat-msgs');

            if (btnLogs) btnLogs.onclick = () => UI.showLogs(t.id);

            // History Toggle
            const authorEl = q('#m-author');
            if (authorEl) {
                authorEl.style.cursor = 'pointer';
                authorEl.style.textDecoration = 'underline';
                authorEl.title = 'Historie anzeigen';
                authorEl.onclick = () => AdminBoard.renderHistory(t.author, t.id);
            }

            q('#ticket-modal').classList.add('open');
        } catch (e) {
            console.error('Error opening modal:', e);
            UI.toast('Fehler beim Öffnen des Tickets');
        }
    },

    reactivateTicket: (id) => {
        UI.confirm('Möchtest du dieses Ticket reaktivieren?', async () => {
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t) {
                t.archived = false;
                delete t.archivedAt;
                t.status = 'In Bearbeitung'; // Default back to active status
                await Store.addLog(t, 'Ticket aus dem Archiv reaktiviert');
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Ticket reaktiviert', `Titel: ${t.title}`);
                await AdminBoard.openModal(id);
                await AdminBoard.render();
                UI.toast('Ticket reaktiviert');
            }
        });
    },

    closeModal: () => {
        q('#ticket-modal').classList.remove('open');
        const sidebar = q('#m-history-sidebar');
        if (sidebar) sidebar.classList.remove('open');
        AdminBoard.currentTicketId = null;
    },

    renderHistory: async (username, currentId) => {
        const sidebar = q('#m-history-sidebar');
        if (!sidebar) return;

        sidebar.classList.add('open');

        // Initialize header if needed
        let searchInput = q('#m-history-search');
        if (!searchInput) {
            sidebar.innerHTML = `
                <div class="sidebar-header">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div style="font-weight:700;">Ticket Historie</div>
                        <button class="btn-ghost" id="m-history-close" style="padding:0; width:30px; height:30px;">✕</button>
                    </div>
                    <div class="history-search-wrap">
                        <input type="text" id="m-history-search" class="history-search-input" placeholder="Historie durchsuchen...">
                        <span class="history-search-icon">🔍</span>
                    </div>
                </div>
                <div class="sidebar-content"></div>
            `;
            searchInput = q('#m-history-search');
            searchInput.oninput = () => AdminBoard.renderHistory(username, currentId);

            const closeBtn = q('#m-history-close');
            closeBtn.onclick = () => {
                sidebar.classList.remove('open');
            };
        }

        const content = sidebar.querySelector('.sidebar-content');
        if (!content) return;

        const query = searchInput.value.toLowerCase();
        content.innerHTML = '';

        const tickets = (await Store.getTickets())
            .filter(x => x.author === username)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const filtered = tickets.filter(t =>
            t.title.toLowerCase().includes(query) ||
            t.status.toLowerCase().includes(query)
        );

        if (filtered.length === 0) {
            content.innerHTML = `<div style="opacity:0.5; padding:30px 20px; font-size:12px; text-align:center;">
                ${query ? 'Keine Treffer' : 'Keine Historie vorhanden'}
            </div>`;
            return;
        }

        filtered.forEach(ticket => {
            const card = document.createElement('div');
            card.className = 'history-card' + (ticket.id === currentId ? ' active' : '') + (ticket.archived ? ' archived' : '');

            const isActive = !ticket.archived && ticket.status !== 'Geschlossen';

            card.innerHTML = `
                <div class="history-title">${ticket.title}</div>
                <div class="history-meta">
                    <span>${Utils.fmtDate(ticket.createdAt).split(' ')[0]}</span>
                    <span>${ticket.status}</span>
                </div>
                ${isActive ? `<span class="history-badge">Aktiv</span>` : ''}
            `;

            card.onclick = () => AdminBoard.openModal(ticket.id);
            content.appendChild(card);
        });
    },

    renderInternalComments: (t) => {
        const box = q('#m-comments');
        if (!box) return;
        box.innerHTML = '';
        if (!t.comments || t.comments.length === 0) {
            box.innerHTML = '<div style="opacity:0.5; font-size:11px;">Keine Notizen</div>';
            return;
        }
        t.comments.forEach(c => {
            const div = document.createElement('div');
            div.style.background = 'var(--card-hover)';
            div.style.padding = '8px';
            div.style.marginBottom = '6px';
            div.style.borderRadius = '4px';
            div.style.fontSize = '12px';
            div.innerHTML = `<strong>${c.author}</strong> <span style="opacity:0.6">${Utils.fmtDate(c.date)}</span><br>${c.text}`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    },

    postInternalComment: async () => {
        const input = q('#m-new-comment');
        const txt = input.value.trim();
        if (!txt) return;
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
        if (!t) return;

        const user = await Store.currentUser();
        if (!t.comments) t.comments = [];
        t.comments.push({
            text: txt,
            author: user.name || user.username,
            date: Utils.nowISO()
        });
        await Store.addLog(t, 'Interne Notiz hinzugefügt', txt);
        await Store.saveTickets(tickets);
        await Store.addGlobalLog('Interne Notiz hinzugefügt', `Ticket: ${t.title}\nNotiz: ${txt.substring(0, 100)}${txt.length > 100 ? '...' : ''}`);
        input.value = '';
        AdminBoard.renderInternalComments(t);
        await AdminBoard.render();
    },

    renderChat: async (ticket, containerSelector) => {
        const box = q(containerSelector);
        if (!box) return;
        box.innerHTML = '';

        const msgs = ticket.chat || []; // Now using 'chat' field

        if (msgs.length === 0) {
            box.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:20px;">Keine Nachrichten</div>';
            return;
        }

        const currentUser = await Store.currentUser();

        msgs.forEach(m => {
            const el = document.createElement('div');
            const isMe = (m.author === currentUser.name || m.author === currentUser.username);
            el.className = `chat-bubble ${isMe ? 'me' : 'other'}`;

            let fileHtml = '';
            // Supports multiple files?
            // If data structure changed to array of files:
            if (m.files && Array.isArray(m.files)) {
                m.files.forEach(f => {
                    if (f.type.startsWith('image/')) {
                        fileHtml += `<img src="${f.data}" class="msg-img" onclick="window.open(this.src)">`;
                    } else {
                        fileHtml += `<a href="${f.data}" download="${f.name}" class="msg-file">📎 ${f.name}</a>`;
                    }
                });
            } else if (m.file) { // Legacy single file
                if (m.file.type.startsWith('image/')) {
                    fileHtml = `<img src="${m.file.data}" class="msg-img" onclick="window.open(this.src)">`;
                } else {
                    fileHtml = `<a href="${m.file.data}" download="${m.file.name}" class="msg-file">📎 ${f.name}</a>`;
                }
            }

            // Format text: **bold**, *italic*
            let htmlText = m.text
                .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                .replace(/\*(.*?)\*/g, '<i>$1</i>')
                .replace(/\n/g, '<br>');

            el.innerHTML = `
                <div class="msg-meta">
                    <span>${m.author}</span>
                    <span>${Utils.fmtDate(m.date)}</span>
                </div>
                ${htmlText}
                ${fileHtml}
            `;
            box.appendChild(el);
        });
        box.scrollTop = box.scrollHeight;
    },

    postChat: async (role) => {
        const id = AdminBoard.currentTicketId || UserDash.currentTicketId;
        const prefix = (role === 'admin') ? '#m' : '#u';
        const txtInput = q(`${prefix}-chat-input`);

        // File handling different for Admin/User?
        // Admin: #m-chat-file-input (Single for now, unless complex needed)
        // User: #u-chat-file (Multi via UserDash.selectedFiles)

        let filesToUpload = [];

        if (role === 'user') {
            filesToUpload = [...UserDash.selectedFiles];
        } else {
            filesToUpload = [...AdminBoard.selectedFiles];
        }

        const txt = txtInput.value.trim();

        if (!txt && filesToUpload.length === 0) return;

        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;

        const user = await Store.currentUser();
        if (!t.chat) t.chat = [];

        const msg = {
            text: txt,
            author: user.name || user.username,
            date: Utils.nowISO(),
            role: user.role,
            files: []
        };

        // Process files
        if (filesToUpload.length > 0) {
            try {
                // Parallel read
                const promises = filesToUpload.map(async f => {
                    const data = await Store.readFile(f);
                    return {
                        name: f.name,
                        type: f.type,
                        data: data
                    };
                });
                msg.files = await Promise.all(promises);
            } catch (e) {
                console.error(e);
                UI.toast('Fehler beim Dateiladen');
                return;
            }
        }

        t.chat.push(msg);
        await Store.addLog(t, 'Nachricht gesendet', txt);
        await Store.saveTickets(tickets);
        await Store.addGlobalLog('Nachricht gesendet', `Ticket: ${t.title}\nInhalt: ${txt.substring(0, 100)}${txt.length > 100 ? '...' : ''}`);

        txtInput.value = '';
        if (role === 'user') {
            UserDash.selectedFiles = [];
            UserDash.renderFilePreview();
            const fIn = q('#u-chat-file');
            if (fIn) fIn.value = '';
        } else {
            AdminBoard.selectedFiles = [];
            AdminBoard.renderFilePreview();
            const adminIn = q('#m-chat-file-input');
            if (adminIn) adminIn.value = '';
        }

        if (role === 'admin') {
            await AdminBoard.renderChat(t, '#m-chat-msgs');
            await AdminBoard.render();
        } else {
            await AdminBoard.renderChat(t, '#u-chat-msgs');
        }
        UI.toast('Nachricht gesendet');
    },

    openApproveModal: async (req) => {
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        AdminBoard.currentReq = req;
        q('#a-name-disp').textContent = req.name;
        q('#a-username').value = req.name.toLowerCase().replace(/\s+/g, '');
        q('#a-password').value = '123';
        q('#approve-modal').classList.add('open');

        // Permissions check: only superadmins can set role/dept
        const roleField = q('#a-role')?.parentElement;
        const deptField = q('#a-dept-field');

        q('#a-role').value = 'user';
        if (deptField) deptField.style.display = 'none';

        if (roleField) roleField.style.display = isSuper ? 'block' : 'none';
        // deptField display is handled by onchange in ApproveModal listeners usually,
        // but here we just hide the whole capability for non-supers

        q('#a-confirm').onclick = AdminBoard.confirmApprove;
        q('#a-close').onclick = AdminBoard.closeApprove;
        q('#a-cancel').onclick = AdminBoard.closeApprove;

        // Listen for Enter key in inputs
        const inputs = [q('#a-username'), q('#a-password')];
        inputs.forEach(i => {
            i.onkeydown = (e) => {
                if (e.key === 'Enter') AdminBoard.confirmApprove();
            };
        });
    },
    closeApprove: () => {
        q('#approve-modal').classList.remove('open');
        AdminBoard.currentReq = null;
    },
    exportUsersCSV: async () => {
        const users = await Store.getUsers();
        if (users.length === 0) {
            UI.toast('Keine User zum Exportieren');
            return;
        }

        // Header
        let csv = 'id,username,name,email,role,dept\n';

        users.forEach(u => {
            const dept = Array.isArray(u.dept) ? u.dept.join(';') : (u.dept || '');
            const row = [
                u.id,
                u.username,
                u.name || '',
                u.email || '',
                u.role,
                dept
            ].map(f => `"${String(f).replace(/"/g, '""')}"`).join(',');
            csv += row + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `users_export_${Utils.nowISO().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await Store.addGlobalLog('Benutzer exportiert', `Anzahl: ${users.length}`);
    },

    importUsersCSV: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const txt = evt.target.result;
                await AdminBoard.processCSVImport(txt);
            };
            reader.readAsText(file);
        };
        input.click();
    },

    processCSVImport: async (csvText) => {
        const lines = csvText.split(/\r?\n/);
        if (lines.length < 2) return;

        let addedCount = 0;
        let skippedCount = 0;

        const users = await Store.getUsers();

        // Simple CSV parse (robust enough for our export format)
        // headers: id,username,name,email,role,dept

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Handle quotes simple regex or split
            // For simplicity assuming no commas in inner text for now or standard quote handling
            // A simple regex for CSV: /,(?=(?:(?:[^"]*"){2})*[^"]*$)/
            const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').replace(/""/g, '"'));

            if (cols.length < 5) continue; // Min required

            const [id, username, name, email, role, deptStr] = cols;

            if (!username) continue;

            // Check duplicate by username or email
            if (users.find(u => u.username === username || (email && u.email === email))) {
                skippedCount++;
                continue;
            }

            const newUser = {
                id: Utils.uid(), // Generate new ID to avoid collisions unless ID is strictly preserved logic needed? Safe to gen new.
                username,
                name,
                email,
                role: ['user', 'admin', 'superadmin'].includes(role) ? role : 'user',
                dept: deptStr ? deptStr.split(';') : undefined,
                password: '123' // Default password for import
            };

            users.push(newUser);
            addedCount++;
        }

        if (addedCount > 0) {
            await Store.saveUsers(users);
            AdminBoard.renderUserManager('users');
            UI.toast(`${addedCount} Benutzer importiert, ${skippedCount} übersprungen`);
            await Store.addGlobalLog('Benutzer per CSV importiert', `Hinzugefügt: ${addedCount}, Übersprungen: ${skippedCount}`);
        } else {
            UI.toast(`Keine neuen Benutzer importiert (${skippedCount} Duplikate)`);
        }
    },

    confirmApprove: async () => {
        if (!AdminBoard.currentReq) return;
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        const username = q('#a-username').value.trim();
        const password = q('#a-password').value.trim();
        const role = isSuper ? q('#a-role').value : 'user'; // Enforce 'user' if not super
        const dept = q('#a-dept').value;

        if (!username || !password) {
            UI.toast('Bitte alle Felder füllen');
            return;
        }

        const users = await Store.getUsers();
        if (users.find(u => u.username === username)) {
            UI.toast('Benutzername existiert bereits');
            return;
        }

        const newUser = {
            id: Utils.uid(),
            username,
            password,
            name: AdminBoard.currentReq.name,
            email: AdminBoard.currentReq.email,
            role: role
        };

        if (isSuper && role === 'admin') newUser.dept = dept;

        users.push(newUser);
        await Store.saveUsers(users);
        await Store.addGlobalLog('Kontosanfrage genehmigt', `Benutzer: ${newUser.name || newUser.username}`);

        const reqs = await Store.getRequests();
        const rest = reqs.filter(x => x.id !== AdminBoard.currentReq.id);
        await Store.saveRequests(rest);

        AdminBoard.closeApprove();
        await AdminBoard.renderRequests();
        UI.toast('Benutzer erfolgreich erstellt!');
    }
};

// --- Main Init ---
// --- Main Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await Store.init();
    await Auth.checkGuard();
    // Display Current User
    const currentUser = await Store.currentUser();
    if (currentUser && q('#user-display')) {
        q('#user-display').textContent = `Angemeldet als: ${currentUser.name || currentUser.username}`;
    }
    await Settings.init(); // Initialize Settings with Theme logic
    if (q('#stars')) UI.starfield();

    // Login Page
    if (q('#btn-login')) {
        const handleLogin = async () => {
            const u = q('#login-user').value.trim();
            const p = q('#login-pass').value;
            const user = await Auth.login(u, p);
            if (user) {
                // 2FA Logic
                const s = await Store.getSettings();
                const force = s.securityConfig ? s.securityConfig.force2FA : 'none';
                let enforced = false;
                if (force === 'all') enforced = true;
                if (force === 'admin' && (user.role === 'admin' || user.role === 'superadmin')) enforced = true;
                if (force === 'user' && user.role === 'user') enforced = true;

                // Priority 1: User has 2FA enabled -> Verification
                if (user.twoFactorEnabled === true) {
                    Auth.open2FAVerify(user, () => {
                        UI.toast(`Willkommen ${user.name}`);
                        setTimeout(() => window.location.href = (user.role === 'admin' || user.role === 'superadmin') ? 'admin.html' : 'dashboard.html', 500);
                    });
                    return;
                }

                // Priority 2: Not enabled but enforced -> Setup
                if (enforced && !user.twoFactorEnabled) {
                    UI.toast('2FA Einrichtung erforderlich');
                    Auth.open2FAModal(user);
                    return;
                }


                UI.toast(`Willkommen ${user.name}`);
                setTimeout(() => window.location.href = (user.role === 'admin' || user.role === 'superadmin') ? 'admin.html' : 'dashboard.html', 500);
            } else {
                UI.toast('Login fehlgeschlagen');
            }
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

            const reqs = await Store.getRequests();
            reqs.push({
                id: Utils.uid(),
                name,
                email,
                date: Utils.nowISO()
            });
            await Store.saveRequests(reqs);

            q('#req-name').value = '';
            q('#req-email').value = '';
            UI.toast('Anfrage gesendet! Ein Admin prüft das.');
            await Store.addGlobalLog('Kontosanfrage gesendet', `Name: ${name}, Email: ${email}`);
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
            btn.className = 'btn-scroll-to-top';
            btn.innerHTML = '↑';
            btn.title = 'Nach oben';
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

// Initialize scroll to top button
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ScrollToTop.init);
} else {
    ScrollToTop.init();
}