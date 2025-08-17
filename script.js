const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));

function nowISO() { return new Date().toISOString(); }

function fmtDate(iso) { const d = new Date(iso); return d.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' }) + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6); }

function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function toast(msg) {
    const el = q('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
}

function ensureSeed() {
    const users = read('users', []);
    if (!users.length) {
        users.push({ id: uid(), username: 'admin', password: 'Admin!123', name: 'Administrator', email: 'admin@example.com', role: 'admin', createdAt: nowISO() });
        write('users', users);
    }
    if (!read('tickets', null)) write('tickets', []);
    if (!read('account_requests', null)) write('account_requests', []);
    const theme = localStorage.getItem('theme');
    applyTheme(theme || 'dark');
}

function getCurrentUser() {
    const username = localStorage.getItem('currentUser');
    if (!username) return null;
    const users = read('users', []);
    return users.find(u => u.username === username) || null;
}

function guard() {
    const guardType = document.body.getAttribute('data-guard');
    const user = getCurrentUser();
    if (!guardType) return;
    if (!user) { window.location.href = 'index.html'; return; }
    if (guardType === 'admin' && user.role !== 'admin') { window.location.href = 'dashboard.html'; }
}

function loginFlow() {
    const loginBtn = q('#btn-login');
    if (!loginBtn) return;
    loginBtn.addEventListener('click', () => {
        const u = q('#login-user').value.trim();
        const p = q('#login-pass').value;
        const users = read('users', []);
        const found = users.find(x => x.username === u && x.password === p);
        if (!found) { toast('Login fehlgeschlagen'); return; }
        localStorage.setItem('currentUser', found.username);
        toast('Willkommen, ' + found.name);
        setTimeout(() => { window.location.href = found.role === 'admin' ? 'admin.html' : 'dashboard.html'; }, 400);
    });
}

function logoutFlow() {
    const logoutBtn = q('#btn-logout');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    });
}

function accountRequestFlow() {
    const btn = q('#btn-request');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const name = q('#req-name').value.trim();
        const email = q('#req-email').value.trim();
        if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Bitte Name und gültige E‑Mail angeben'); return; }
        const requests = read('account_requests', []);
        requests.push({ id: uid(), name, email, createdAt: nowISO() });
        write('account_requests', requests);
        q('#req-name').value = '';
        q('#req-email').value = '';
        toast('Anfrage gesendet');
    });
}

function fillRequests() {
    const wrap = q('#requests');
    if (!wrap) return;
    const requests = read('account_requests', []);
    wrap.innerHTML = '';
    if (!requests.length) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.textContent = 'Keine offenen Anfragen';
        wrap.appendChild(empty);
        return;
    }
    requests.forEach(r => {
        const card = document.createElement('div');
        card.className = 'request-card';
        const left = document.createElement('div');
        left.innerHTML = `<div><strong>${r.name}</strong></div><div class="request-meta">${r.email}</div><div class="request-meta">${fmtDate(r.createdAt)}</div>`;
        const right = document.createElement('div');
        right.className = 'request-actions';
        const userInput = document.createElement('input');
        userInput.placeholder = 'Benutzername';
        const passInput = document.createElement('input');
        passInput.placeholder = 'Passwort';
        passInput.type = 'text';
        const approve = document.createElement('button');
        approve.className = 'btn-inline';
        approve.textContent = 'Freigeben';
        const deny = document.createElement('button');
        deny.className = 'btn-inline';
        deny.textContent = 'Ablehnen';
        right.append(userInput, passInput, approve, deny);
        card.append(left, right);
        wrap.appendChild(card);

        approve.addEventListener('click', () => {
            const username = userInput.value.trim();
            const password = passInput.value.trim() || genPassword();
            if (!username) { toast('Benutzername angeben'); return; }
            const users = read('users', []);
            if (users.some(u => u.username === username)) { toast('Benutzername existiert'); return; }
            users.push({ id: uid(), username, password, name: r.name, email: r.email, role: 'user', createdAt: nowISO() });
            write('users', users);
            const rest = requests.filter(x => x.id !== r.id);
            write('account_requests', rest);
            fillRequests();
            toast('Account erstellt');
        });

        deny.addEventListener('click', () => {
            const rest = requests.filter(x => x.id !== r.id);
            write('account_requests', rest);
            fillRequests();
            toast('Anfrage entfernt');
        });
    });
}

function genPassword() {
    const s = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let p = '';
    for (let i = 0; i < 10; i++) p += s[Math.floor(Math.random() * s.length)];
    return p;
}

function createTicketFlow() {
    const btn = q('#btn-create-ticket');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const title = q('#t-title').value.trim();
        const desc = q('#t-desc').value.trim();
        const prio = q('#t-prio').value;
        const cat = q('#t-cat').value;
        if (!title || !desc) { toast('Bitte Betreff und Beschreibung angeben'); return; }
        const user = getCurrentUser();
        const tickets = read('tickets', []);
        tickets.push({
            id: uid(),
            title,
            desc,
            prio,
            category: cat,
            status: 'Offen',
            assignee: '',
            author: user ? user.username : '',
            authorName: user ? user.name : '',
            createdAt: nowISO()
        });
        write('tickets', tickets);
        q('#t-title').value = '';
        q('#t-desc').value = '';
        toast('Ticket erstellt');
        loadUserTickets();
    });
}

function loadUserTickets() {
    const list = q('#user-tickets');
    if (!list) return;
    const user = getCurrentUser();
    const tickets = read('tickets', []).filter(t => t.author === (user ? user.username : ''));
    list.innerHTML = '';
    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(t => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
      <div><span class="badge">${t.status}</span></div>
      <div>${t.title}</div>
      <div>${fmtDate(t.createdAt)}</div>
      <div>${t.prio}</div>
    `;
        list.appendChild(row);
    });
}

function loadAdminTickets() {
    const list = q('#admin-tickets');
    if (!list) return;
    const statusF = q('#f-status');
    const prioF = q('#f-prio');
    const textF = q('#f-text');

    function refresh() {
        const users = read('users', []);
        const admins = users.filter(u => u.role === 'admin');
        const tickets = read('tickets', []);
        const s = statusF.value;
        const p = prioF.value;
        const txt = textF.value.trim().toLowerCase();
        list.innerHTML = '';
        tickets
            .filter(t => !s || t.status === s)
            .filter(t => !p || t.prio === p)
            .filter(t => !txt || (t.title.toLowerCase().includes(txt) || (t.authorName || '').toLowerCase().includes(txt)))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .forEach(t => {
                const row = document.createElement('div');
                row.className = 'row';
                const statusSel = document.createElement('select');;
                ['Offen', 'In Bearbeitung', 'Wartet auf Antwort', 'Erledigt'].forEach(v => {
                    const o = document.createElement('option');
                    o.textContent = v;
                    o.selected = v === t.status;
                    statusSel.appendChild(o);
                });
                const assSel = document.createElement('select');
                const none = document.createElement('option');
                none.value = '';
                none.textContent = 'Unzugewiesen';
                assSel.appendChild(none);
                admins.forEach(a => { const o = document.createElement('option');
                    o.value = a.username;
                    o.textContent = a.name || a.username; if (a.username === t.assignee) o.selected = true;
                    assSel.appendChild(o); });
                const statusCell = document.createElement('div');
                statusCell.appendChild(statusSel);
                const titleCell = document.createElement('div');
                titleCell.innerHTML = `${t.title}<div class="request-meta">${t.authorName||t.author}</div>`;
                const authorCell = document.createElement('div');
                authorCell.textContent = t.authorName || t.author;
                const prioCell = document.createElement('div');
                prioCell.appendChild(assSel);
                row.replaceChildren(statusCell, titleCell, authorCell, prioCell);
                list.appendChild(row);
                statusSel.addEventListener('change', () => {
                    const all = read('tickets', []);
                    const idx = all.findIndex(x => x.id === t.id);
                    if (idx >= 0) { all[idx].status = statusSel.value;
                        write('tickets', all);
                        toast('Status aktualisiert'); }
                });
                assSel.addEventListener('change', () => {
                    const all = read('tickets', []);
                    const idx = all.findIndex(x => x.id === t.id);
                    if (idx >= 0) { all[idx].assignee = assSel.value;
                        write('tickets', all);
                        toast('Zugewiesen'); }
                });
            });
    }
    statusF.addEventListener('change', refresh);
    prioF.addEventListener('change', refresh);
    textF.addEventListener('input', refresh);
    refresh();
}

function themeFlow() {
    const btn = q('#theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const current = localStorage.getItem('theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });
}

function applyTheme(mode) {
    if (mode === 'light') {
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
        const t = q('#theme-toggle');
        if (t) t.textContent = '☀️';
    } else {
        document.documentElement.classList.remove('light');
        localStorage.setItem('theme', 'dark');
        const t = q('#theme-toggle');
        if (t) t.textContent = '🌙';
    }
}

function starfield() {
    const c = q('#stars');
    if (!c) return;
    const ctx = c.getContext('2d');
    const stars = [];

    function size() { c.width = window.innerWidth;
        c.height = window.innerHeight; }

    function init() {
        stars.length = 0;
        const count = Math.min(180, Math.floor((c.width * c.height) / 12000));
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * c.width,
                y: Math.random() * c.height,
                r: Math.random() * 1.5 + 0.3,
                a: Math.random() * 0.6 + 0.2,
                s: Math.random() * 0.3 + 0.05,
                tw: Math.random() * 0.04 + 0.01
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, c.width, c.height);
        const light = document.documentElement.classList.contains('light');
        ctx.fillStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.9)';
        stars.forEach(st => {
            ctx.globalAlpha = st.a + Math.sin(Date.now() * st.tw) * 0.2;
            ctx.beginPath();
            ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
            ctx.fill();
            st.y += st.s;
            if (st.y > c.height) { st.y = -2;
                st.x = Math.random() * c.width; }
        });
        requestAnimationFrame(draw);
    }
    size();
    init();
    draw();
    window.addEventListener('resize', () => { size();
        init(); });
}

function bindDashboard() {
    if (q('#btn-create-ticket')) createTicketFlow();
    if (q('#user-tickets')) loadUserTickets();
}

function bindAdmin() {
    if (q('#requests')) fillRequests();
    if (q('#admin-tickets')) loadAdminTickets();
}

function bindIndex() {
    if (q('#btn-login')) loginFlow();
    if (q('#btn-request')) accountRequestFlow();
}

function bindYear() {
    const y = q('#year');
    if (y) y.textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', () => {
    ensureSeed();
    guard();
    bindIndex();
    bindDashboard();
    bindAdmin();
    logoutFlow();
    themeFlow();
    starfield();
    bindYear();
});

document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(".kanban-card");
  const columns = document.querySelectorAll(".kanban-cards");

  cards.forEach(card => {
    card.addEventListener("dragstart", e => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", card.outerHTML);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });
  });

  columns.forEach(column => {
    column.addEventListener("dragover", e => {
      e.preventDefault();
      column.style.background = "rgba(255,255,255,0.1)";
    });

    column.addEventListener("dragleave", () => {
      column.style.background = "";
    });

    column.addEventListener("drop", e => {
      e.preventDefault();
      const draggedHTML = e.dataTransfer.getData("text/plain");
      column.insertAdjacentHTML("beforeend", draggedHTML);
      column.style.background = "";
    });
  });
});