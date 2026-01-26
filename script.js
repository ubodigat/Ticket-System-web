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
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
            ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    },
    read: (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    write: (key, val) => localStorage.setItem(key, JSON.stringify(val))
};

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
                id: Utils.uid(), username: 'admin', password: '123',
                name: 'Administrator', role: 'admin'
            });
        }

        // 1. Add a default normal user
        const userIdx = users.findIndex(u => u.username === 'user');
        if (userIdx === -1) {
            users.push({
                id: Utils.uid(), username: 'user', password: '123',
                name: 'Max Mustermann', role: 'user'
            });
        }

        Store.saveUsers(users);
        if (!Utils.read('tickets', null)) Utils.write('tickets', []);
        if (!Utils.read('account_requests', null)) Utils.write('account_requests', []);
    },

    currentUser: () => {
        const username = localStorage.getItem('currentUser');
        if (!username) return null;
        return Store.getUsers().find(u => u.username === username) || null;
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
        if (!user) { window.location.href = 'index.html'; return; }
        if (guard === 'admin' && user.role !== 'admin') window.location.href = 'dashboard.html';
    }
};

// --- UI Components ---
const UI = {
    toast: (msg) => {
        let el = q('#toast');
        if (!el) {
            el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },
    themeInit: () => {
        const theme = localStorage.getItem('theme') || 'dark';
        if (theme === 'light') document.documentElement.classList.add('light');
        const btn = q('#theme-toggle');
        if (btn) {
            btn.textContent = theme === 'light' ? '☀️' : '🌙';
            btn.addEventListener('click', () => {
                const isLight = document.documentElement.classList.toggle('light');
                localStorage.setItem('theme', isLight ? 'light' : 'dark');
                btn.textContent = isLight ? '☀️' : '🌙';
            });
        }
    },
    starfield: () => {
        const c = q('#stars');
        if (!c) return;
        const ctx = c.getContext('2d');
        const stars = [];
        const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
        const loop = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.fillStyle = document.documentElement.classList.contains('light') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.9)';
            stars.forEach(s => {
                ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
                s.y += s.v; if (s.y > c.height) s.y = -2;
            });
            requestAnimationFrame(loop);
        };
        resize();
        window.addEventListener('resize', resize);
        for (let i = 0; i < 150; i++) stars.push({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.5, v: Math.random() * 0.4 + 0.1 });
        loop();
    }
};

// --- User Dashboard Logic ---
const UserDash = {
    init: () => {
        if (!q('#btn-create-ticket')) return;
        const btn = q('#btn-create-ticket');
        btn.addEventListener('click', () => {
            const title = q('#t-title').value.trim();
            const desc = q('#t-desc').value.trim();
            const prio = q('#t-prio').value;
            if (!title) { UI.toast('Bitte Titel angeben'); return; }

            const user = Store.currentUser();
            const tickets = Store.getTickets();
            tickets.push({
                id: Utils.uid(),
                title, desc, prio,
                status: 'Neu',
                author: user.username, authorName: user.name || user.username,
                createdAt: Utils.nowISO(),
                comments: []
            });
            Store.saveTickets(tickets);
            UI.toast('Ticket erstellt!');
            q('#t-title').value = ''; q('#t-desc').value = '';
            UserDash.renderList();
        });
        UserDash.renderList();
    },
    renderList: () => {
        const list = q('#user-tickets');
        if (!list) return;
        const user = Store.currentUser();
        const tickets = Store.getTickets().filter(t => t.author === user.username);
        list.innerHTML = '';
        tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(t => {
            const el = document.createElement('div');
            el.className = 'ticket-row';
            el.innerHTML = `
                <div class="status-indicator" style="background:${getStatusColor(t.status)}; width:8px; height:8px; border-radius:50%;"></div>
                <div style="font-weight:600">${t.title}</div>
                <div class="status-badge">${t.status}</div>
                <div class="date">${Utils.fmtDate(t.createdAt)}</div>
                <div style="font-size:12px; color:var(--text-sec)">${t.prio}</div>
            `;
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

// --- Admin Kanban Logic ---
const AdminBoard = {
    init: () => {
        if (!q('.kanban-board')) return;
        AdminBoard.render();
        AdminBoard.setupDrag();

        // Setup Modal
        if (q('#m-close')) q('#m-close').onclick = AdminBoard.closeModal;
        if (q('#m-close-bt')) q('#m-close-bt').onclick = AdminBoard.closeModal;
        if (q('#ticket-modal')) q('#ticket-modal').onclick = (e) => { if (e.target.id === 'ticket-modal') AdminBoard.closeModal(); };
        if (q('#btn-add-comment')) q('#btn-add-comment').onclick = AdminBoard.postComment;
    },

    render: () => {
        const tickets = Store.getTickets();
        const cols = {
            'Neu': q('#list-new'),
            'In Bearbeitung': q('#list-doing'),
            'Geschlossen': q('#list-done')
        };
        const counts = { 'Neu': 0, 'In Bearbeitung': 0, 'Geschlossen': 0 };

        Object.values(cols).forEach(c => { if (c) c.innerHTML = ''; });

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

            const assignee = t.assigneeName ?
                `<span class="assignee-badge">👤 ${t.assigneeName}</span>` :
                `<span style="opacity:0.5; font-size:11px">Unzugewiesen</span>`;

            card.innerHTML = `
                <span class="t-tag prio-${t.prio}">${t.prio}</span>
                <div class="t-title">${t.title}</div>
                <div class="t-meta">
                    <span>${t.authorName}</span>
                    <span>${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                </div>
                <div class="t-meta" style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
                     ${assignee}
                     <span style="font-size:10px">💬 ${t.comments?.length || 0}</span>
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
            // Accept Logic
            el.querySelector('.btn-primary').onclick = () => AdminBoard.openApproveModal(r);
            // Deny Logic
            el.querySelector('.btn-ghost').onclick = () => {
                if (!confirm('Anfrage löschen?')) return;
                const rest = reqs.filter(x => x.id !== r.id);
                Utils.write('account_requests', rest);
                AdminBoard.renderRequests();
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

        q('#m-title').textContent = t.title;
        q('#m-desc').textContent = t.desc || 'Keine Beschreibung';

        // Populate Assignee Select
        const sel = q('#m-assignee');
        sel.innerHTML = '<option value="">Unzugewiesen</option>';
        const admins = Store.getUsers().filter(u => u.role === 'admin');
        admins.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.username;
            opt.textContent = a.name || a.username;
            if (t.assignee === a.username) opt.selected = true;
            sel.appendChild(opt);
        });

        sel.onchange = () => {
            const val = sel.value;
            const user = admins.find(a => a.username === val);
            t.assignee = val;
            t.assigneeName = user ? (user.name || user.username) : null;
            Store.saveTickets(tickets);
            AdminBoard.render();
            UI.toast('Zuweisung gespeichert');
        };

        AdminBoard.renderComments(t);
        q('#ticket-modal').classList.add('open');
    },

    closeModal: () => {
        q('#ticket-modal').classList.remove('open');
        AdminBoard.currentTicketId = null;
    },

    renderComments: (ticket) => {
        const box = q('#m-comments');
        box.innerHTML = '';
        if (!ticket.comments || !ticket.comments.length) {
            box.innerHTML = '<div style="font-style:italic; opacity:0.6; font-size:12px;">Keine Kommentare</div>';
            return;
        }
        ticket.comments.forEach(c => {
            const el = document.createElement('div');
            el.className = 'comment';
            el.innerHTML = `
                <div class="comment-head"><span>${c.author}</span><span>${Utils.fmtDate(c.date)}</span></div>
                <div class="comment-body">${c.text}</div>
            `;
            box.appendChild(el);
        });
    },

    postComment: () => {
        const txt = q('#m-new-comment').value.trim();
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
        Store.saveTickets(tickets);
        q('#m-new-comment').value = '';
        AdminBoard.renderComments(t);
        AdminBoard.render(); // Update List (comment count)
        UI.toast('Kommentar gesendet');
    },

    // Approve Modal Logic
    currentReq: null,
    openApproveModal: (req) => {
        AdminBoard.currentReq = req;
        q('#a-name-disp').textContent = req.name;
        q('#a-username').value = req.name.toLowerCase().replace(/\s+/g, '');
        q('#a-password').value = '123';
        q('#approve-modal').classList.add('open');

        q('#a-confirm').onclick = AdminBoard.confirmApprove;
        q('#a-close').onclick = AdminBoard.closeApprove;
        q('#a-cancel').onclick = AdminBoard.closeApprove;
    },
    closeApprove: () => {
        q('#approve-modal').classList.remove('open');
        AdminBoard.currentReq = null;
    },
    confirmApprove: () => {
        if (!AdminBoard.currentReq) return;
        const username = q('#a-username').value.trim();
        const password = q('#a-password').value.trim();

        if (!username || !password) { UI.toast('Bitte alle Felder füllen'); return; }

        const users = Store.getUsers();
        if (users.find(u => u.username === username)) { UI.toast('Benutzername existiert bereits'); return; }

        users.push({
            id: Utils.uid(),
            username,
            password,
            name: AdminBoard.currentReq.name,
            role: 'user'
        });
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
document.addEventListener('DOMContentLoaded', () => {
    Store.init();
    Auth.checkGuard();
    UI.starfield();
    UI.themeInit();

    // Login Page
    if (q('#btn-login')) {
        q('#btn-login').addEventListener('click', () => {
            const u = q('#login-user').value.trim();
            const p = q('#login-pass').value;
            const user = Auth.login(u, p);
            if (user) {
                UI.toast(`Willkommen ${user.name}`);
                setTimeout(() => window.location.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html', 500);
            } else {
                UI.toast('Login fehlgeschlagen');
            }
        });
    }

    // Logout
    if (q('#btn-logout') || q('#logout')) {
        const btns = qa('#btn-logout, #logout');
        btns.forEach(b => b.onclick = Auth.logout);
    }

    // Request Flow
    if (q('#btn-request')) {
        q('#btn-request').onclick = () => {
            const name = q('#req-name').value.trim();
            const email = q('#req-email').value.trim();
            if (!name || !email) { UI.toast('Bitte Felder füllen'); return; }

            const reqs = Utils.read('account_requests', []);
            reqs.push({ id: Utils.uid(), name, email, date: Utils.nowISO() });
            Utils.write('account_requests', reqs);

            q('#req-name').value = ''; q('#req-email').value = '';
            UI.toast('Anfrage gesendet! Ein Admin prüft das.');
        };
    }

    if (q('#btn-create-ticket') || q('#user-tickets')) UserDash.init();
    if (q('.kanban-board')) AdminBoard.init();
});