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

// ... Store ...
// ... Auth ...
// ... UI ...
// ... Settings ...
// ... UserDash ...
// ... AdminBoard ...
// ... getStatusColor ...



// --- Store ---
const Store = {
    getUsers: () => Utils.read('users', []),
    saveUsers: (users) => Utils.write('users', users),
    getTickets: () => Utils.read('tickets', []),
    saveTickets: (tickets) => Utils.write('tickets', tickets),

    // Seed default data if empty
    init: () => {
        let users = Store.getUsers();
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
                Store.saveUsers(users);
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

        Store.saveUsers(users);
        if (!Utils.read('tickets', null)) Utils.write('tickets', []);
        if (!Utils.read('account_requests', null)) Utils.write('account_requests', []);

        // Migration: ensure 'comments', 'chat', 'archived' are set
        const tickets = Store.getTickets();
        let changed = false;
        tickets.forEach(t => {
            // Note: 'comments' used to store chat. We need to split them if we want separate logic?
            // User requested: "comments should remain" (as internal notes) AND "chat".
            // If I look at the previous step, I used 'comments' for chat. 
            // Migration Strategy: Move existing 'comments' (if they look like chat) to 'chat'?
            // Or just init 'internalComments' and keep 'comments' as 'chat'?
            // Let's decide: 'comments' = Internal Notes. 'chat' = Chat.
            // Since I recently wrote chat into 'comments', I should probably move them to 'chat'.
            // But if I do that, the old comments (from before chat feature) also move to chat.
            // That is probably acceptable as old comments were likely communication.

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
        });
        if (changed) Store.saveTickets(tickets);
    },

    addLog: (ticket, msg, details) => {
        if (!ticket.logs) ticket.logs = [];
        const user = Store.currentUser();
        ticket.logs.push({
            id: Utils.uid(),
            date: Utils.nowISO(),
            user: user ? (user.name || user.username) : 'System',
            msg: msg,
            details: details
        });
    },

    currentUser: () => {
        const username = localStorage.getItem('currentUser');
        if (!username) return null;
        return Store.getUsers().find(u => u.username === username) || null;
    },

    readFile: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
};

// --- Auth ---
const Auth = {
    login: (u, p) => {
        const users = Store.getUsers();
        const user = users.find(x => x.username === u && x.password === p);
        if (user) {
            localStorage.setItem('currentUser', user.username);
            return user;
        }
        return null;
    },
    logout: () => {
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    },
    checkGuard: () => {
        const user = Store.currentUser();
        const guard = document.body.dataset.guard;
        if (!guard) return; // Public page
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        // Admin page accessible by admin AND superadmin
        if (guard === 'admin' && user.role !== 'admin' && user.role !== 'superadmin') window.location.href = 'dashboard.html';
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

    showLogs: (id) => {
        const ticket = Store.getTickets().find(t => t.id === id);
        if (!ticket) return;

        let modal = q('#logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'logs-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '200'; // Above detail modal
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
    init: () => {
        const s = Utils.read('app_settings', Settings.defaults);
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
    openModal: () => {
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
                    </div>
                    <div class="modal-footer"><button class="btn-primary close-m">Fertig</button></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(x => x.onclick = () => modal.classList.remove('open'));

            // Listeners
            modal.querySelectorAll('.s-theme-btn').forEach(b => {
                b.onclick = () => {
                    const s = Utils.read('app_settings', Settings.defaults);
                    s.theme = b.dataset.val;
                    Settings.save(s);
                    Settings.renderState(modal, s);
                };
            });
            q('#s-color').onchange = (e) => {
                const s = Utils.read('app_settings', Settings.defaults);
                s.accentColor = e.target.value;
                Settings.save(s);
            };
            q('#s-lang').onchange = (e) => {
                const s = Utils.read('app_settings', Settings.defaults);
                s.lang = e.target.value;
                Settings.save(s);
            };
        }

        const s = Utils.read('app_settings', Settings.defaults);
        Settings.renderState(modal, s);
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
            btn.onclick = () => {
                s.bgType = p.type;
                s.bgValue = p.val;
                Settings.save(s);
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
                Settings.save(s);
                Settings.renderState(modal, s);
                UI.toast('Hintergrund aktualisiert');
            } catch (err) {
                UI.toast('Fehler beim Upload');
            }
        };
    },
    save: (s) => {
        Utils.write('app_settings', s);
        Settings.apply(s);
    }
};

// --- User Dashboard Logic ---
const UserDash = {
    selectedFiles: [], // Staging for file uploads

    init: () => {
        // Admin Button Injection if on dashboard (for superadmin/admin)
        const user = Store.currentUser();
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
        btn.onclick = () => {
            const title = q('#t-title').value.trim();
            const desc = q('#t-desc').value.trim();
            const prio = q('#t-prio').value;
            const cat = q('#t-cat').value || 'Allgemein'; // Capture Category

            if (!title) {
                UI.toast('Bitte Titel angeben');
                return;
            }

            const user = Store.currentUser();
            const tickets = Store.getTickets();
            const newTicket = {
                id: Utils.uid(),
                title,
                desc,
                prio,
                category: cat, // Save Category
                status: 'Neu',
                author: user.username,
                authorName: user.name || user.username,
                createdAt: Utils.nowISO(),
                comments: [],
                chat: [],
                archived: false
            };
            tickets.push(newTicket);
            Store.addLog(newTicket, 'Ticket erstellt');
            Store.saveTickets(tickets);
            UI.toast('Ticket erstellt!');
            q('#t-title').value = '';
            q('#t-desc').value = '';
            UserDash.renderList();
        };

        // ... Key listeners for Create Ticket ...
        q('#t-title').onkeydown = (e) => {
            if (e.key === 'Enter') q('#btn-create-ticket').click();
        };

        // Populate Categories dynamically
        const catSel = q('#t-cat');
        if (catSel) {
            const settings = Utils.read('settings', {});
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            catSel.innerHTML = '';
            categories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                catSel.appendChild(opt);
            });
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
        UserDash.renderList();
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

    openModal: (id) => {
        UserDash.currentTicketId = id;
        const tickets = Store.getTickets();
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
            const allUsers = Store.getUsers();
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

    renderList: () => {
        const list = q('#user-tickets');
        if (!list) return;
        const user = Store.currentUser();
        // Show all tickets for user (including archived)
        const tickets = Store.getTickets().filter(t => t.author === user.username);
        list.innerHTML = '';
        if (tickets.length === 0) {
            list.innerHTML = '<div style="opacity:0.5; padding:10px;">Keine Tickets</div>';
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

            el.innerHTML = `
                <div class="status-indicator" style="background:${getStatusColor(t.status)}; width:8px; height:8px; border-radius:50%;"></div>
                <div style="font-weight:600">${t.title} ${t.archived ? '(Archiviert)' : ''}</div>
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

    init: () => {
        if (!q('.kanban-board')) return;

        // Superadmin UI Injection
        // Admin UI Visibility
        const user = Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        const canUsers = isSuper || (user && user.canManageUsers);
        const canReqs = isSuper || (user && user.canManageRequests);

        if (canUsers) {
            const actions = q('.hero-actions');
            if (actions && !q('#btn-manage-users')) {
                const btn = document.createElement('button');
                btn.id = 'btn-manage-users';
                btn.className = 'btn-ghost';
                btn.textContent = '👥 User Manager';
                btn.onclick = AdminBoard.openUserManager;
                actions.insertBefore(btn, actions.firstChild);
            }
        }

        const reqBoard = q('#request-list')?.parentElement;
        if (reqBoard) {
            reqBoard.style.display = canReqs ? 'block' : 'none';
        }

        AdminBoard.render();
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
    render: () => {
        const user = Store.currentUser();
        let tickets = Store.getTickets().filter(t => !t.archived);

        // Filter by Department (if not Superadmin)
        if (user.role === 'admin') {
            // Support array or single string (legacy)
            const depts = Array.isArray(user.dept) ? user.dept : [user.dept || 'Allgemein'];
            tickets = tickets.filter(t => depts.includes(t.category) || depts.includes('All'));
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

        tickets.forEach(t => {
            if (!cols[t.status]) {
                if (cols['Neu']) cols['Neu'].appendChild(createCard(t));
                return;
            }
            counts[t.status]++;
            cols[t.status].appendChild(createCard(t));
        });

        if (q('#count-new')) q('#count-new').textContent = counts['Neu'];
        if (q('#count-doing')) q('#count-doing').textContent = counts['In Bearbeitung'];
        if (q('#count-done')) q('#count-done').textContent = counts['Geschlossen'];

        AdminBoard.renderRequests();

        function createCard(t) {
            const card = document.createElement('div');
            card.className = 'ticket-card';
            card.draggable = true;
            card.dataset.id = t.id;

            const allUsers = Store.getUsers();
            let assigneeHtml = `<span style="opacity:0.5; font-size:11px">Unzugewiesen</span>`;

            if (t.assignees && t.assignees.length > 0) {
                const names = t.assignees.map(u => {
                    const found = allUsers.find(x => x.username === u);
                    return found ? (found.name || found.username) : u;
                });
                assigneeHtml = `<span class="assignee-badge">👤 ${names.join(', ')}</span>`;
            } else if (t.assigneeName) {
                assigneeHtml = `<span class="assignee-badge">👤 ${t.assigneeName}</span>`;
            }

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <span class="t-tag prio-${t.prio}">${t.prio}</span>
                    <span class="t-category">${t.category || '-'}</span>
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
        UI.confirm('Ticket ins Archiv verschieben? Es wird aus dem Board entfernt.', () => {
            const id = AdminBoard.currentTicketId;
            const tickets = Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t) {
                t.archived = true;
                t.archivedAt = Utils.nowISO(); // Save archive timestamp
                Store.addLog(t, 'Ticket archiviert');
                Store.saveTickets(tickets);
                AdminBoard.closeModal();
                AdminBoard.render();
                UI.toast('Ticket archiviert');
            }
        });
    },

    // User Manager Logic
    openUserManager: () => {
        const modal = q('#user-man-modal');
        modal.classList.add('open');
        AdminBoard.renderUserManager('users'); // Default tab

        // Setup UM Tabs
        const user = Store.currentUser();
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

    renderUserManager: (view) => {
        const currentUser = Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';
        // Non-supers can ONLY see 'users'
        if (!isSuper) view = 'users';

        const listContainer = q('#um-list');
        listContainer.className = 'user-list-container';

        // Skeleton for search and actions if not present
        if (!q('#um-search')) {
            listContainer.innerHTML = `
                <div class="um-controls" style="display:flex; gap:10px; margin-bottom:15px; position:sticky; top:0; background:var(--bg2); z-index:10; padding:5px 0 10px;">
                    <input type="text" id="um-search" placeholder="Suchen..." style="flex:1">
                    <div id="um-actions"></div>
                </div>
                <div id="um-results"></div>
            `;
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        } else {
            // Update input listener for current view
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        }

        const searchTerm = q('#um-search').value.toLowerCase();
        const actions = q('#um-actions');
        const list = q('#um-results');
        list.className = 'user-list';
        list.innerHTML = '';

        if (view === 'users' || view === 'admins') {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-user">Neu anlegen</button>`;
            actions.querySelector('#btn-add-user').onclick = () => AdminBoard.openEditUserModal(null, view);
        } else {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-cat">Neu anlegen</button>`;
            actions.querySelector('#btn-add-cat').onclick = () => AdminBoard.openEditCategoryModal(null);
        }

        if (view === 'cats') {
            const settings = Utils.read('settings', {
                categories: ['Allgemein', 'Technik', 'Account', 'Abrechnung']
            });
            settings.categories.filter(c => c.toLowerCase().includes(searchTerm)).forEach(c => {
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
                    UI.confirm(`Kategorie "${c}" löschen?`, () => {
                        settings.categories = settings.categories.filter(x => x !== c);
                        Utils.write('settings', settings);
                        AdminBoard.renderUserManager('cats');
                    });
                };
                list.appendChild(el);
            });
            return;
        }

        const users = Store.getUsers();
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
                        <strong>${u.username}</strong> <br>
                        <span style="font-size:12px; opacity:0.8">${u.name || '-'} | ${u.email || 'Keine Email'}</span>
                        <div style="font-size:10px; opacity:0.6; margin-top:2px;">${roleInfo}</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-ghost edit-u" style="padding:4px;" title="Bearbeiten">✏️</button>
                    ${u.role !== 'superadmin' && u.username !== 'admin' ? `<button class="btn-ghost del-u" style="padding:4px; color:var(--danger);" title="Löschen">🗑️</button>` : ''}
                </div>
            `;

            const delBtn = el.querySelector('.del-u');
            if (delBtn) delBtn.onclick = () => {
                UI.confirm('Nutzer unwiderruflich löschen?', () => {
                    const fresh = Store.getUsers().filter(x => x.id !== u.id);
                    Store.saveUsers(fresh);
                    AdminBoard.renderUserManager(view);
                });
            };

            el.querySelector('.edit-u').onclick = () => AdminBoard.openEditUserModal(u, view);
            list.appendChild(el);
        });
    },

    openEditCategoryModal: (catName) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');

        const admins = Store.getUsers().filter(u => u.role === 'admin' || u.role === 'superadmin');

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
        confirmBtn.onclick = () => {
            const val = q('#g-input').value.trim();
            if (!val) return;

            const settings = Utils.read('settings', {
                categories: ['Allgemein', 'Technik', 'Account', 'Abrechnung']
            });
            const allUsers = Store.getUsers();
            const checkedAdmins = Array.from(modal.querySelectorAll('.cat-admin-check:checked')).map(cb => cb.value);

            if (catName) {
                // Rename logic
                const idx = settings.categories.indexOf(catName);
                if (idx !== -1) settings.categories[idx] = val;

                // Update all admins (even those not checked now might need the rename, 
                // but user wants assignment sync)
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
            }

            Utils.write('settings', settings);
            Store.saveUsers(allUsers);
            modal.classList.remove('open');
            AdminBoard.renderUserManager('cats');
            UI.toast(catName ? 'Kategorie bearbeitet' : 'Kategorie erstellt');
        };
    },

    openEditUserModal: (user, viewContext) => {
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
        const currentUser = Store.currentUser();
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
        const settings = Utils.read('settings', {
            categories: ['Allgemein', 'Technik', 'Account', 'Abrechnung']
        });
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

        q('#ue-save').onclick = () => {
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

            const users = Store.getUsers();

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
                }
            }
            Store.saveUsers(users);
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

    // ... existing openApproveModal ...
    renderArchive: () => {
        const list = q('#archive-list');
        if (!list) return;

        const query = (q('#archive-search')?.value || '').toLowerCase().trim();
        let archived = Store.getTickets().filter(t => t.archived);

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

    renderRequests: () => {
        const list = q('#request-list');
        if (!list) return;
        const reqs = Utils.read('account_requests', []);
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
                UI.confirm('Anfrage löschen?', () => {
                    const rest = reqs.filter(x => x.id !== r.id);
                    Utils.write('account_requests', rest);
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
            zone.addEventListener('drop', e => {
                e.preventDefault();
                zone.style.background = '';
                const id = e.dataTransfer.getData('text/plain');
                const newStatus = zone.dataset.status;
                const tickets = Store.getTickets();
                const t = tickets.find(x => x.id === id);
                if (t && t.status !== newStatus) {
                    Store.addLog(t, `Status geändert von ${t.status} zu ${newStatus}`);
                    t.status = newStatus;
                    Store.saveTickets(tickets);
                    AdminBoard.render();
                    UI.toast(`Status geändert: ${newStatus}`);
                }
            });
        });
    },

    // Modal Logic
    currentTicketId: null,

    openModal: (id) => {
        AdminBoard.currentTicketId = id;
        const tickets = Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;

        const user = Store.currentUser();
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
            prioSel.onchange = () => {
                const old = t.prio;
                t.prio = prioSel.value;
                Store.addLog(t, `Priorität geändert von ${old} zu ${t.prio}`);
                Store.saveTickets(tickets);
                AdminBoard.render();
            };
        }

        // Populate Category
        if (catSel) {
            const settings = Utils.read('settings', {});
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            catSel.innerHTML = '';
            categories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = opt.textContent = c;
                catSel.appendChild(opt);
            });
            catSel.value = t.category || 'Allgemein';
            catSel.onchange = () => {
                const old = t.category || 'Allgemein';
                t.category = catSel.value;
                Store.addLog(t, `Kategorie geändert von ${old} zu ${t.category}`);
                Store.saveTickets(tickets);
                AdminBoard.render();
            };
        }

        // Reset Tabs
        q('.tab-btn[data-tab="details"]').click();

        // History Sidebar refresh if already open
        const sidebar = q('#m-history-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            AdminBoard.renderHistory(t.author, id);
        }

        // --- Multi-Select Assignment ---
        const admins = Store.getUsers().filter(u => u.role === 'admin' || u.role === 'superadmin');
        if (!t.assignees) t.assignees = t.assignee ? [t.assignee] : [];

        const renderMS = () => {
            const msText = msHeader ? msHeader.querySelector('.ms-text') : null;
            if (msText) {

                if (t.assignees.length === 0) msText.textContent = 'Niemand';
                else {
                    const names = t.assignees.map(u => {
                        const adm = admins.find(x => x.username === u);
                        return adm ? (adm.name || adm.username) : u;
                    });
                    msText.textContent = names.join(', ');
                }
            }

            if (!msDropdown || t.archived) return;
            msDropdown.innerHTML = '';
            admins.forEach(a => {
                const item = document.createElement('div');
                item.className = 'select-item' + (t.assignees.includes(a.username) ? ' selected' : '');
                item.textContent = a.name || a.username;
                item.onclick = (e) => {
                    e.stopPropagation();
                    const idx = t.assignees.indexOf(a.username);
                    if (idx > -1) t.assignees.splice(idx, 1);
                    else t.assignees.push(a.username);

                    const action = idx > -1 ? 'entfernt' : 'hinzugefügt';
                    Store.addLog(t, `Admin ${a.name || a.username} ${action}`);
                    delete t.assignee;
                    Store.saveTickets(tickets);
                    renderMS();
                    AdminBoard.render();
                };
                msDropdown.appendChild(item);
            });


        };

        if (msHeader) {
            msHeader.onclick = (e) => {
                e.stopPropagation();
                if (msDropdown) msDropdown.classList.toggle('open');
            };
        }

        document.addEventListener('click', () => {
            if (msDropdown) msDropdown.classList.remove('open');
        }, {
            once: true
        });
        renderMS();

        AdminBoard.renderInternalComments(t);
        AdminBoard.renderChat(t, '#m-chat-msgs');

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
    },

    reactivateTicket: (id) => {
        UI.confirm('Möchtest du dieses Ticket reaktivieren?', () => {
            const tickets = Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t) {
                t.archived = false;
                delete t.archivedAt;
                t.status = 'In Bearbeitung'; // Default back to active status
                Store.addLog(t, 'Ticket aus dem Archiv reaktiviert');
                Store.saveTickets(tickets);
                AdminBoard.openModal(id);
                AdminBoard.render();
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

    renderHistory: (username, currentId) => {
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

        const tickets = Store.getTickets()
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

    postInternalComment: () => {
        const input = q('#m-new-comment');
        const txt = input.value.trim();
        if (!txt) return;
        const tickets = Store.getTickets();
        const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
        if (!t) return;

        const user = Store.currentUser();
        if (!t.comments) t.comments = [];
        t.comments.push({
            text: txt,
            author: user.name || user.username,
            date: Utils.nowISO()
        });
        Store.addLog(t, 'Interne Notiz hinzugefügt', txt);
        Store.saveTickets(tickets);
        input.value = '';
        AdminBoard.renderInternalComments(t);
    },

    renderChat: (ticket, containerSelector) => {
        const box = q(containerSelector);
        if (!box) return;
        box.innerHTML = '';

        const msgs = ticket.chat || []; // Now using 'chat' field

        if (msgs.length === 0) {
            box.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:20px;">Keine Nachrichten</div>';
            return;
        }

        const currentUser = Store.currentUser();

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

        const tickets = Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;

        const user = Store.currentUser();
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
        Store.addLog(t, 'Nachricht gesendet', txt);
        Store.saveTickets(tickets);

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
            AdminBoard.renderChat(t, '#m-chat-msgs');
            AdminBoard.render();
        } else {
            AdminBoard.renderChat(t, '#u-chat-msgs');
        }
        UI.toast('Nachricht gesendet');
    },

    openApproveModal: (req) => {
        const currentUser = Store.currentUser();
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
    confirmApprove: () => {
        if (!AdminBoard.currentReq) return;
        const currentUser = Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        const username = q('#a-username').value.trim();
        const password = q('#a-password').value.trim();
        const role = isSuper ? q('#a-role').value : 'user'; // Enforce 'user' if not super
        const dept = q('#a-dept').value;

        if (!username || !password) {
            UI.toast('Bitte alle Felder füllen');
            return;
        }

        const users = Store.getUsers();
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
        Store.saveUsers(users);

        const reqs = Utils.read('account_requests', []);
        const rest = reqs.filter(x => x.id !== AdminBoard.currentReq.id);
        Utils.write('account_requests', rest);

        AdminBoard.closeApprove();
        AdminBoard.renderRequests();
        UI.toast('Benutzer erfolgreich erstellt!');
    }
};

// --- Main Init ---
// --- Main Init ---
document.addEventListener('DOMContentLoaded', () => {
    Store.init();
    Auth.checkGuard();
    // Display Current User
    const currentUser = Store.currentUser();
    if (currentUser && q('#user-display')) {
        q('#user-display').textContent = `Angemeldet als: ${currentUser.name || currentUser.username}`;
    }
    Settings.init(); // Initialize Settings with Theme logic
    if (q('#stars')) UI.starfield();
    // UI.themeInit(); // Removed in favor of Settings

    // Login Page
    if (q('#btn-login')) {
        const handleLogin = () => {
            const u = q('#login-user').value.trim();
            const p = q('#login-pass').value;
            const user = Auth.login(u, p);
            if (user) {
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
        const handleRequest = () => {
            const name = q('#req-name').value.trim();
            const email = q('#req-email').value.trim();
            if (!name || !email) {
                UI.toast('Bitte Felder füllen');
                return;
            }

            const reqs = Utils.read('account_requests', []);
            reqs.push({
                id: Utils.uid(),
                name,
                email,
                date: Utils.nowISO()
            });
            Utils.write('account_requests', reqs);

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

    if (q('#btn-create-ticket') || q('#user-tickets')) UserDash.init();
    if (q('.kanban-board')) AdminBoard.init();

    // Auto-refresh across tabs
    window.addEventListener('storage', (e) => {
        if (e.key === 'tickets' || e.key === 'users' || e.key === 'account_requests') {
            if (q('.kanban-board')) {
                AdminBoard.render();
                AdminBoard.renderArchive();
                if (AdminBoard.currentTicketId && q('#ticket-modal.open')) {
                    const tickets = Store.getTickets();
                    const t = tickets.find(t => t.id === AdminBoard.currentTicketId);
                    if (t) AdminBoard.renderChat(t, '#m-chat-msgs');
                }
            }
            if (q('#user-tickets')) {
                UserDash.renderList();
                if (UserDash.currentTicketId && q('#u-ticket-modal.open')) {
                    const tickets = Store.getTickets();
                    const t = tickets.find(t => t.id === UserDash.currentTicketId);
                    if (t) AdminBoard.renderChat(t, '#u-chat-msgs');
                }
            }
            if (q('#request-list')) AdminBoard.renderRequests();
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