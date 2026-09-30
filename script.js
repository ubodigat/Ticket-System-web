"use strict";

const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));

// Icons: Größe per Parameter; Abstände kommen immer vom Container (gap), nie vom Icon
const Icon = (name, size = 16) =>
    `<i data-lucide="${name}" style="width:${size}px;height:${size}px;"></i>`;

// --- Utils ---
const Utils = {
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    nowISO: () => new Date().toISOString(),
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtDate: (iso) => {
        if (!iso) return '-';
        const d = new Date(iso);
        const locale = (typeof Lang !== 'undefined' && Lang.current === 'en') ? 'en-GB' : 'de-DE';
        return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }) +
            ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    },
    searchText: (...values) => {
        const seen = new Set();
        const parts = [];
        const walk = (value) => {
            if (value == null) return;
            if (value instanceof Date) {
                parts.push(value.toISOString(), Utils.fmtDate(value.toISOString()));
                return;
            }
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                const text = String(value);
                parts.push(text);
                if (/^\d{4}-\d{2}-\d{2}T/.test(text)) parts.push(Utils.fmtDate(text), text.slice(0, 10));
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) value.forEach(walk);
            else Object.entries(value).forEach(([key, val]) => {
                if (key === 'data') return;
                parts.push(key);
                walk(val);
            });
        };
        values.forEach(walk);
        return parts.join(' ').toLowerCase();
    },
    matchesSearch: (query, ...values) => {
        const qv = String(query || '').toLowerCase().trim();
        return !qv || Utils.searchText(...values).includes(qv);
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
    },
    normalizeHex: (value) => {
        let v = String(value || '').trim().replace(/^#/, '').toLowerCase();
        if (/^[0-9a-f]{3}$/.test(v)) v = v.split('').map(c => c + c).join('');
        return /^[0-9a-f]{6}$/.test(v) ? '#' + v : null;
    },
    hexToHsv: (hex) => {
        const n = parseInt((Utils.normalizeHex(hex) || '#6366f1').slice(1), 16);
        const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h, s: max ? d / max : 0, v: max };
    },
    hsvToHex: ({ h, s, v }) => {
        const f = (k) => {
            const x = (k + h / 60) % 6;
            return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
        };
        return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    },
    hexToRgb: (hex) => {
        const clean = String(hex || '').replace('#', '');
        if (clean.length !== 6) return '99, 102, 241';
        const n = parseInt(clean, 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }
};

// --- i18n ---
const Lang = {
    translations: {
        de: {
            login: 'Einloggen', logout: 'Abmelden', dashboard: 'Dashboard',
            newTicket: 'Neues Ticket', myTickets: 'Meine Tickets',
            subject: 'Betreff', description: 'Beschreibung', priority: 'Priorität',
            category: 'Kategorie', submit: 'Absenden', status: 'Status',
            date: 'Datum', prio: 'Prio', archived: 'Archiviert',
            assignee: 'Bearbeiter', close: 'Schließen', save: 'Speichern',
            cancel: 'Abbrechen', delete: 'Löschen', edit: 'Bearbeiten',
            search: 'Suchen...', noTickets: 'Keine Tickets gefunden',
            ticketCreated: 'Ticket erstellt!', titleRequired: 'Bitte Titel angeben',
            loadMore: 'Weitere laden', showArchived: 'Archiviert einblenden',
            normal: 'Normal', high: 'Hoch', critical: 'Kritisch', low: 'Niedrig',
            statusNew: 'Neu', statusDoing: 'In Bearbeitung', statusClosed: 'Geschlossen',
            systemLogs: 'System-Logs', archive: 'Archiv', settings: 'Einstellungen',
            userMgmt: 'Benutzerverwaltung',
            confirm: 'Bestätigung', yes: 'Bestätigen', no: 'Abbrechen',
        },
        en: {
            login: 'Login', logout: 'Logout', dashboard: 'Dashboard',
            newTicket: 'New Ticket', myTickets: 'My Tickets',
            subject: 'Subject', description: 'Description', priority: 'Priority',
            category: 'Category', submit: 'Submit', status: 'Status',
            date: 'Date', prio: 'Priority', archived: 'Archived',
            assignee: 'Assigned To', close: 'Close', save: 'Save',
            cancel: 'Cancel', delete: 'Delete', edit: 'Edit',
            search: 'Search...', noTickets: 'No tickets found',
            ticketCreated: 'Ticket created!', titleRequired: 'Please enter a title',
            loadMore: 'Load more', showArchived: 'Show archived',
            normal: 'Normal', high: 'High', critical: 'Critical', low: 'Low',
            statusNew: 'New', statusDoing: 'In Progress', statusClosed: 'Closed',
            systemLogs: 'System Logs', archive: 'Archive', settings: 'Settings',
            userMgmt: 'User Management',
            confirm: 'Confirmation', yes: 'Confirm', no: 'Cancel',
        }
    },
    current: 'de',
    t: (key) => {
        const trans = Lang.translations[Lang.current] || Lang.translations['de'];
        return trans[key] || key;
    },
    init: async () => {
        const s = await Store.getSettings();
        Lang.current = s.lang || 'de';
        Lang.applyToDOM();
    },
    applyToDOM: () => {
        document.documentElement.lang = Lang.current;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            el.textContent = Lang.t(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = Lang.t(el.dataset.i18nPlaceholder);
        });
        Lang.applyAdminDOM();
    },
    applyAdminDOM: () => {
        const setHTML = (selector, html) => {
            const el = q(selector);
            if (el) el.innerHTML = html;
        };
        const setText = (selector, text) => {
            const el = q(selector);
            if (el) el.textContent = text;
        };
        setHTML('#btn-to-dash', `${Icon('layout-dashboard', 16)}${Lang.t('dashboard')}`);
        setHTML('#btn-global-logs', `${Icon('bell', 16)}${Lang.t('systemLogs')}`);
        setHTML('#btn-archive', `${Icon('archive', 16)}${Lang.t('archive')}`);
        setHTML('#archive-view .archive-header h3', `${Icon('archive', 18)}${Lang.t('archivedTickets')}`);
        setHTML('#btn-back-kanban', `${Icon('arrow-left', 16)}${Lang.t('backToOverview')}`);
        const archiveSearch = q('#archive-search');
        if (archiveSearch) archiveSearch.placeholder = Lang.current === 'en' ? 'Search archive (title, author, content)...' : 'Suche im Archiv (Titel, Autor, Inhalt)...';
        setText('.requests-board h3', Lang.t('requests'));
        setHTML('#col-new .col-header span:first-child', `${Icon('inbox', 16)}${Lang.t('statusNew')}`);
        setHTML('#col-doing .col-header span:first-child', `${Icon('loader', 16)}${Lang.t('statusDoing')}`);
        setHTML('#col-done .col-header span:first-child', `${Icon('check-circle', 16)}${Lang.t('statusClosed')}`);
        setText('#ticket-modal .tab-btn[data-tab="details"]', Lang.t('details'));
        setText('#ticket-modal .tab-btn[data-tab="chat"]', Lang.t('chat'));
        const metaGrid = q('#ticket-modal .ticket-meta-grid');
        if (metaGrid) {
            const labels = metaGrid.querySelectorAll('strong');
            if (labels[0]) labels[0].textContent = Lang.t('from');
            if (labels[1]) labels[1].textContent = Lang.t('date');
            if (labels[2]) labels[2].textContent = Lang.t('prio');
            if (labels[3]) labels[3].textContent = Lang.t('category');
        }
        const descHead = q('#tab-details h4');
        if (descHead) descHead.textContent = Lang.t('description');
        const assignLabel = q('#assignee-multi')?.closest('.field')?.querySelector('label');
        if (assignLabel) assignLabel.textContent = `${Lang.t('assignTo')} (${Lang.t('multipleSelection')})`;
        const notesHead = q('.comments-section h4');
        if (notesHead) notesHead.textContent = Lang.t('internalNotes');
        const commentInput = q('#m-new-comment');
        if (commentInput) commentInput.placeholder = Lang.t('addComment');
        setText('#btn-add-comment', Lang.t('comment'));
        const archiveBtn = q('#btn-archive-ticket');
        if (archiveBtn) archiveBtn.innerHTML = `${Icon('archive', 16)}${Lang.t('archive')}`;
        setHTML('#approve-modal h3', `${Icon('user-plus', 18)}${Lang.t('createUser')}`);
        setHTML('#user-man-modal h3', `${Icon('users', 18)}${Lang.t('userManagement')}`);
        q('#m-prio-edit option[value="Niedrig"]') && (q('#m-prio-edit option[value="Niedrig"]').textContent = Lang.t('low'));
        q('#m-prio-edit option[value="Normal"]') && (q('#m-prio-edit option[value="Normal"]').textContent = Lang.t('normal'));
        q('#m-prio-edit option[value="Hoch"]') && (q('#m-prio-edit option[value="Hoch"]').textContent = Lang.t('high'));
        q('#m-prio-edit option[value="Kritisch"]') && (q('#m-prio-edit option[value="Kritisch"]').textContent = Lang.t('critical'));
        if (window.lucide) lucide.createIcons();
    }
};

Object.assign(Lang.translations.de, {
    priority: 'Priorität',
    close: 'Schließen',
    delete: 'Löschen',
    confirm: 'Bestätigung',
    yes: 'Bestätigen',
    openTickets: 'Offene Tickets',
    allTickets: 'Alle Tickets',
    ticketCount: 'Tickets',
    loadAll: 'Alle laden',
    showing: 'Angezeigt',
    details: 'Details',
    chat: 'Chat',
    from: 'Von',
    nobody: 'Niemand',
    noDescription: 'Keine Beschreibung',
    archivedReadonly: 'Ticket ist archiviert (keine Antwort möglich)',
    writeMessage: 'Nachricht schreiben...',
    attachFile: 'Datei anhängen',
    createdAt: 'Erstellt',
    unassigned: 'Unzugewiesen',
    emailSent: 'E-Mail an {to} gesendet (simuliert)',
    emailLogged: 'E-Mail ohne SMTP gespeichert',
    portalSettings: 'Portaleinstellungen',
    themeMode: 'Designmodus',
    dark: 'Dunkel',
    light: 'Hell',
    accentColor: 'Akzentfarbe',
    language: 'Sprache',
    background: 'Hintergrund',
    security: 'Sicherheit',
    done: 'Fertig',
    adminPanel: 'Adminbereich',
    system: 'System',
    accountRequests: 'Konto-Anfragen',
    systemSettings: 'Systemeinstellungen',
    notifications: 'Benachrichtigungen',
    general: 'Allgemein',
    emailIntegration: 'E-Mail-Integration',
    company: 'Unternehmen',
    emailHint: 'Konfiguriert SMTP-Ausgang und Benachrichtigungsregeln. Für echten Versand ist ein Backend oder Outlook/Graph Connector erforderlich.',
    smtpHost: 'SMTP Host',
    smtpPort: 'SMTP Port',
    smtpUser: 'SMTP Benutzer',
    smtpPassword: 'SMTP Passwort',
    smtpFrom: 'Absender-Adresse',
    smtpFromName: 'Absender-Name',
    testEmail: 'Test-E-Mail senden',
    smtpEncryption: 'Verschlüsselung',
    replyTo: 'Antwort-an Adresse',
    emailTemplate: 'E-Mail Vorlage',
    notifyRules: 'Lege fest, wann automatisch E-Mails versendet werden.',
    notifyNewTicket: 'Neues Ticket',
    notifyNewTicketDesc: 'Admins werden per E-Mail über neue Tickets benachrichtigt.',
    notifyStatusChange: 'Statusänderung',
    notifyStatusChangeDesc: 'Benutzer erhalten eine E-Mail, wenn sich der Ticket-Status ändert.',
    notifyNewMessage: 'Neue Nachricht im Chat',
    notifyNewMessageDesc: 'Beteiligte erhalten eine E-Mail bei neuer Nachricht.',
    notifyTicketClosed: 'Ticket geschlossen',
    notifyTicketClosedDesc: 'Benutzer erhalten eine Abschluss-E-Mail wenn ihr Ticket geschlossen wird.',
    notifyAccountApproved: 'Konto genehmigt',
    notifyAccountApprovedDesc: 'Antragsteller erhalten eine E-Mail wenn ihr Konto genehmigt wurde.',
    force2fa: '2FA erzwingen',
    sessionTimeout: 'Session-Timeout (Minuten, 0 = kein Timeout)',
    maxLoginAttempts: 'Max. Fehlversuche beim Login (0 = kein Limit)',
    ldapHint: 'LDAP-Integration ermöglicht Single Sign-On. Benötigt Backend-Anbindung.',
    portalName: 'Portal-Name',
    autoArchiveDays: 'Auto-Archivierung nach (Tage, 0 = deaktiviert)',
    defaultPriority: 'Standard-Priorität für neue Tickets',
    defaultCategories: 'Standard-Kategorien (kommagetrennt)',
    outlookIntegration: 'Outlook-Integration',
    outlookHint: 'Outlook ist möglich über Microsoft Graph: eingehende Mails als Tickets, Statusmails, Kalender-/Aufgaben-Links und optional ein Outlook Add-in.',
    graphTenant: 'Microsoft Tenant ID',
    graphClient: 'Graph Client ID',
    graphMailbox: 'Support-Postfach',
    enableOutlook: 'Outlook/Graph Integration vorbereiten',
    showClosedArchived: 'Geschlossene/archivierte einblenden',
    archivedTickets: 'Archivierte Tickets',
    backToOverview: 'Zurück zur Übersicht',
    requests: 'Konto-Anfragen',
    internalNotes: 'Interne Notizen / Kommentare',
    comment: 'Kommentieren',
    assignTo: 'Zuweisung',
    multipleSelection: 'Mehrfachauswahl möglich',
    addComment: 'Kommentar hinzufügen...',
    createUser: 'Benutzer erstellen',
    username: 'Benutzername',
    password: 'Passwort',
    role: 'Rolle',
    department: 'Abteilung',
    userManagement: 'Benutzerverwaltung',
    saveSettings: 'Einstellungen speichern',
    closeSystemSettings: 'Schließen',
    securityHint: 'Benutzer werden beim Login aufgefordert, 2FA einzurichten, wenn sie betroffen sind.',
    notForced: 'Nicht erzwingen (optional)',
    allUsers: 'Alle Nutzer',
    onlyAdmins: 'Nur Admins',
    onlyUsers: 'Nur User',
    loggedInAs: 'Angemeldet als',
    notes: 'Notizen',
    possible: 'möglich'
});

Object.assign(Lang.translations.en, {
    openTickets: 'Open Tickets',
    allTickets: 'All Tickets',
    ticketCount: 'Tickets',
    loadAll: 'Load all',
    showing: 'Showing',
    details: 'Details',
    chat: 'Chat',
    from: 'From',
    nobody: 'Nobody',
    noDescription: 'No description',
    archivedReadonly: 'Ticket is archived (replies are disabled)',
    writeMessage: 'Write a message...',
    attachFile: 'Attach file',
    createdAt: 'Created',
    unassigned: 'Unassigned',
    emailSent: 'Email to {to} sent (simulated)',
    emailLogged: 'Email logged without SMTP',
    portalSettings: 'Portal Settings',
    themeMode: 'Theme mode',
    dark: 'Dark',
    light: 'Light',
    accentColor: 'Accent color',
    language: 'Language',
    background: 'Background',
    security: 'Security',
    done: 'Done',
    adminPanel: 'Admin Panel',
    system: 'System',
    accountRequests: 'Account Requests',
    systemSettings: 'System Settings',
    notifications: 'Notifications',
    general: 'General',
    emailIntegration: 'Email Integration',
    company: 'Company',
    emailHint: 'Configure SMTP delivery and notification rules. Real delivery requires a backend or Outlook/Graph connector.',
    smtpHost: 'SMTP Host',
    smtpPort: 'SMTP Port',
    smtpUser: 'SMTP User',
    smtpPassword: 'SMTP Password',
    smtpFrom: 'From address',
    smtpFromName: 'From name',
    testEmail: 'Send test email',
    smtpEncryption: 'Encryption',
    replyTo: 'Reply-to address',
    emailTemplate: 'Email template',
    notifyRules: 'Choose when automatic emails should be sent.',
    notifyNewTicket: 'New Ticket',
    notifyNewTicketDesc: 'Admins receive an email when a new ticket is created.',
    notifyStatusChange: 'Status change',
    notifyStatusChangeDesc: 'Users receive an email when their ticket status changes.',
    notifyNewMessage: 'New chat message',
    notifyNewMessageDesc: 'Participants receive an email when a new message is posted.',
    notifyTicketClosed: 'Ticket closed',
    notifyTicketClosedDesc: 'Users receive a closing email when their ticket is closed.',
    notifyAccountApproved: 'Account approved',
    notifyAccountApprovedDesc: 'Requesters receive an email when their account is approved.',
    force2fa: 'Enforce 2FA',
    sessionTimeout: 'Session timeout (minutes, 0 = no timeout)',
    maxLoginAttempts: 'Max. failed login attempts (0 = no limit)',
    ldapHint: 'LDAP integration enables single sign-on. Requires backend connection.',
    portalName: 'Portal name',
    autoArchiveDays: 'Auto-archive after (days, 0 = disabled)',
    defaultPriority: 'Default priority for new tickets',
    defaultCategories: 'Default categories (comma-separated)',
    outlookIntegration: 'Outlook Integration',
    outlookHint: 'Outlook integration is possible via Microsoft Graph: incoming mails as tickets, status emails, calendar/task links and optionally an Outlook add-in.',
    graphTenant: 'Microsoft Tenant ID',
    graphClient: 'Graph Client ID',
    graphMailbox: 'Support mailbox',
    enableOutlook: 'Prepare Outlook/Graph integration',
    showClosedArchived: 'Show closed/archived',
    archivedTickets: 'Archived Tickets',
    backToOverview: 'Back to Overview',
    requests: 'Account Requests',
    internalNotes: 'Internal Notes / Comments',
    comment: 'Comment',
    assignTo: 'Assignment',
    multipleSelection: 'multiple selection available',
    addComment: 'Add comment...',
    createUser: 'Create User',
    username: 'Username',
    password: 'Password',
    role: 'Role',
    department: 'Department',
    userManagement: 'User Management',
    saveSettings: 'Save Settings',
    closeSystemSettings: 'Close',
    securityHint: 'Users are prompted to set up 2FA during login when the rule applies.',
    notForced: 'Do not enforce (optional)',
    allUsers: 'All users',
    onlyAdmins: 'Admins only',
    onlyUsers: 'Users only',
    loggedInAs: 'Logged in as',
    notes: 'Notes',
    possible: 'available'
});

Lang.format = (key, values = {}) =>
    Object.entries(values).reduce((txt, [k, v]) => txt.replace(`{${k}}`, v), Lang.t(key));

Lang.status = (status) => ({
    'Neu': Lang.t('statusNew'),
    'In Bearbeitung': Lang.t('statusDoing'),
    'Geschlossen': Lang.t('statusClosed')
}[status] || status || '-');

Lang.prio = (prio) => ({
    'Niedrig': Lang.t('low'),
    'Normal': Lang.t('normal'),
    'Hoch': Lang.t('high'),
    'Kritisch': Lang.t('critical')
}[prio] || prio || '-');

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
    getGroups: async () => Promise.resolve(Utils.read('user_groups', [])),
    saveGroups: async (groups) => Promise.resolve(Utils.write('user_groups', groups)),
    getTickets: async () => Promise.resolve(Utils.read('tickets', [])),
    saveTickets: async (tickets) => {
        try {
            Utils.write('tickets', tickets);
        } catch (e) {
            if (e?.name !== 'QuotaExceededError') throw e;
            await Store.offloadTicketAttachments(tickets);
            try {
                Utils.write('tickets', tickets);
                UI.toast('Anhänge wurden platzsparend ausgelagert.');
            } catch (second) {
                if (second?.name === 'QuotaExceededError') {
                    UI.toast('Speicher voll: Bitte große alte Anhänge löschen oder Browser-Speicher leeren.');
                }
                throw second;
            }
        }
    },
    getRequests: async () => Promise.resolve(Utils.read('account_requests', [])),
    saveRequests: async (reqs) => Promise.resolve(Utils.write('account_requests', reqs)),
    getSettings: async () => Promise.resolve(Utils.read('app_settings', Settings.defaults)),
    saveSettings: async (settings) => Promise.resolve(Utils.write('app_settings', settings)),
    getGlobalLogs: async () => Promise.resolve(Utils.read('global_logs', [])),
    saveGlobalLogs: async (logs) => Promise.resolve(Utils.write('global_logs', logs)),
    openAttachmentDb: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('ticket_system_files', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }),
    saveAttachment: async (fileLike) => {
        if (fileLike.size && fileLike.size > 15 * 1024 * 1024) {
            throw new Error('ATTACHMENT_TOO_LARGE');
        }
        const data = fileLike.data || await Store.readFile(fileLike);
        const record = {
            id: fileLike.id || Utils.uid(),
            name: fileLike.name || 'Anhang',
            type: fileLike.type || 'application/octet-stream',
            size: fileLike.size || Math.round((data.length * 3) / 4),
            data
        };
        const db = await Store.openAttachmentDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').put(record);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        return { id: record.id, name: record.name, type: record.type, size: record.size };
    },
    getAttachment: async (id) => {
        const db = await Store.openAttachmentDb();
        const record = await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readonly');
            const req = tx.objectStore('files').get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return record;
    },
    downloadAttachment: async (id) => {
        const file = await Store.getAttachment(id);
        if (!file?.data) {
            UI.toast('Anhang nicht gefunden');
            return;
        }
        const a = document.createElement('a');
        a.href = file.data;
        a.download = file.name || 'Anhang';
        document.body.appendChild(a);
        a.click();
        a.remove();
    },
    offloadTicketAttachments: async (tickets) => {
        for (const ticket of tickets) {
            for (const area of ['comments', 'chat']) {
                for (const entry of (ticket[area] || [])) {
                    if (!Array.isArray(entry.files)) continue;
                    for (const file of entry.files) {
                        if (file.data && !file.attachmentId) {
                            const saved = await Store.saveAttachment(file);
                            file.attachmentId = saved.id;
                            file.id = saved.id;
                            file.size = saved.size;
                            delete file.data;
                        }
                    }
                }
            }
        }
    },
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
        const company = settings.companyConfig || {};
        const signature = conf.htmlSignature || company.htmlSignature || company.signature || '';
        const textSignature = company.signature || '';
        const textBody = textSignature ? `${body || ''}\n\n${textSignature}` : body;
        const htmlBody = conf.htmlEnabled
            ? `${String(body || '').replace(/\n/g, '<br>')}${signature ? `<br><br>${signature}` : ''}`
            : null;
        console.log(`Sending Email via ${conf.host}:${conf.port}`, {
            user: conf.user,
            from: conf.from,
            to,
            subject,
            body: textBody,
            htmlBody,
            security: conf.security || {}
        });
        UI.toast(Lang.format('emailSent', { to }));
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
        if (!Utils.read('user_groups', null)) {
            Utils.write('user_groups', [
                { id: Utils.uid(), name: 'Admins', description: 'Administrative Benutzer', members: ['admin'] },
                { id: Utils.uid(), name: 'Verwaltung', description: 'Interne Verwaltung', members: [] },
                { id: Utils.uid(), name: 'Support', description: 'Support Team', members: [] }
            ]);
        }
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
            if (!Array.isArray(t.participants)) {
                t.participants = Array.isArray(t.assignees) ? [...t.assignees] : (t.assignee ? [t.assignee] : []);
                changed = true;
            }
            if (!t.owner && t.participants.length) {
                t.owner = t.participants[0];
                changed = true;
            }
            if (!Array.isArray(t.todos)) {
                t.todos = [];
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
        const settings = await Store.getSettings();
        const days = parseInt(settings.generalConfig?.autoArchiveDays, 10) || 0;
        if (days <= 0) return;

        const tickets = await Store.getTickets();
        const now = new Date();
        let changed = false;
        const archiveBefore = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

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

                if (closedDate < archiveBefore) {
                    t.archived = true;
                    t.archivedAt = Utils.nowISO();
                    changed = true;
                }
            }
        });

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
        modal.className = 'modal-overlay modal-top';

        const qrData = `otpauth://totp/TicketSystem:${user.username}?secret=${user.twoFactorSecret}&issuer=TicketSystem`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;

        modal.innerHTML = `
            <div class="modal modal-sm">
                <div class="modal-header">
                    <h3>${Icon('shield-check', 18)} 2FA einrichten</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" title="Schließen" aria-label="Schließen" onclick="q('#modal-two-fa').classList.remove('open')">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body text-center">
                    <p>Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator).</p>
                    <div class="qr-box"><img src="${qrUrl}" alt="QR-Code"></div>
                    <p class="hint">Secret: ${user.twoFactorSecret}</p>
                    <input type="text" id="code-2fa-input" class="code-input" placeholder="123 456">
                </div>
                <div class="modal-footer">
                    <button class="btn-primary btn-block" id="btn-verify-2fa">${Icon('shield-check', 16)} Einrichtung abschließen</button>
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
        if (window.lucide) lucide.createIcons();
    },

    open2FAVerify: (user, onSuccess) => {
        let modal = q('#modal-2fa-verify');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-2fa-verify';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('shield-check', 18)} 2FA-Überprüfung</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" title="Schließen" aria-label="Schließen" onclick="q('#modal-2fa-verify').classList.remove('open')">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body text-center">
                        <p>Bitte gib deinen 2FA-Code ein.</p>
                        <input type="text" id="verify-2fa-input" class="code-input" placeholder="123 456">
                    </div>
                    <div class="modal-footer">
                        <button class="btn-primary btn-block" id="btn-check-2fa">${Icon('shield-check', 16)} Bestätigen</button>
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
        if (window.lucide) lucide.createIcons();
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
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('circle-help', 18)} ${Lang.t('confirm')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="cm-no-head" title="${Lang.t('cancel')}" aria-label="${Lang.t('cancel')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <p id="cm-msg"></p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary footer-cancel" id="cm-no">${Lang.t('cancel')}</button>
                        <button class="btn-primary" id="cm-yes">${Lang.t('yes')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        q('#cm-msg').textContent = msg;

        const close = () => modal.classList.remove('open');
        const yesBtn = q('#cm-yes');
        const noBtn = q('#cm-no');
        const headNoBtn = q('#cm-no-head');

        // Clone to clear listeners
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        const newHeadNo = headNoBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);
        headNoBtn.parentNode.replaceChild(newHeadNo, headNoBtn);

        newYes.onclick = () => {
            close();
            onYes();
        };
        newNo.onclick = () => close(); // Fix: close on No
        newHeadNo.onclick = () => close();

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
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
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('scroll-text', 18)} Ticket-Protokoll</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" title="${Lang.t('close')}" aria-label="${Lang.t('close')}" onclick="q('#logs-modal').classList.remove('open')">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body flush" id="logs-body"></div>
                </div>`;
            document.body.appendChild(modal);
        }

        const iconForLog = (msg = '') => {
            const text = msg.toLowerCase();
            if (text.includes('status')) return 'refresh-cw';
            if (text.includes('priorit') || text.includes('prio')) return 'flag';
            if (text.includes('kategorie')) return 'tags';
            if (text.includes('zuweisung') || text.includes('verantwortlich') || text.includes('beteilig')) return 'users';
            if (text.includes('todo') || text.includes('teilaufgabe')) return 'check-square';
            if (text.includes('kommentar') || text.includes('notiz')) return 'message-square';
            if (text.includes('archiv')) return 'archive';
            return 'activity';
        };

        const body = q('#logs-body');
        body.innerHTML = '';
        if (!ticket.logs || ticket.logs.length === 0) {
            body.innerHTML = '<div class="empty-state">Keine Einträge vorhanden.</div>';
        } else {
            body.innerHTML = ticket.logs.slice().reverse().map(l => UI.logRow({
                icon: iconForLog(l.msg),
                user: l.user || 'System',
                date: l.date,
                action: l.msg,
                details: l.details
            })).join('');
        }
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Farbwähler: runder Farbfeld-Button, Popover mit Farbfläche, Farbton, Pipette, HEX und RGB
    colorPickerMarkup: (id, label) => `
        <div class="color-field">
            <button type="button" class="color-swatch-btn" id="${id}" popovertarget="${id}-pop" title="${label}" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="color-popover" id="${id}-pop" popover role="dialog" aria-label="${label}">
                <div class="cp-area" tabindex="0" aria-label="Sättigung und Helligkeit"><span class="cp-thumb"></span></div>
                <div class="cp-row">
                    <button type="button" class="btn-ghost btn-icon btn-sm cp-eyedrop" title="Farbe vom Bildschirm aufnehmen" aria-label="Farbe vom Bildschirm aufnehmen">${Icon('pipette', 15)}</button>
                    <span class="cp-preview"></span>
                    <input type="range" class="cp-hue" min="0" max="359" step="1" aria-label="Farbton">
                </div>
                <div class="cp-inputs">
                    <label class="cp-input cp-hex"><input type="text" maxlength="7" spellcheck="false"><span>HEX</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="0"><span>R</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="1"><span>G</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="2"><span>B</span></label>
                </div>
            </div>
        </div>`,

    createColorPicker: (root, { value, onInput, onCommit }) => {
        const btn = root.querySelector('.color-swatch-btn');
        const pop = root.querySelector('.color-popover');
        const area = pop.querySelector('.cp-area');
        const thumb = pop.querySelector('.cp-thumb');
        const hue = pop.querySelector('.cp-hue');
        const hexIn = pop.querySelector('.cp-hex input');
        const rgbIn = [...pop.querySelectorAll('[data-ch]')];
        const drop = pop.querySelector('.cp-eyedrop');
        const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
        let hsv = Utils.hexToHsv(value);
        let committed = Utils.hsvToHex(hsv);

        const render = (skip) => {
            const hex = Utils.hsvToHex(hsv);
            root.style.setProperty('--cp-hue', hsv.h);
            root.style.setProperty('--cp-color', hex);
            thumb.style.left = `${hsv.s * 100}%`;
            thumb.style.top = `${(1 - hsv.v) * 100}%`;
            if (skip !== 'hue') hue.value = hsv.h;
            if (skip !== 'hex') hexIn.value = hex.toUpperCase();
            if (skip !== 'rgb') {
                const n = parseInt(hex.slice(1), 16);
                [(n >> 16) & 255, (n >> 8) & 255, n & 255].forEach((c, i) => { rgbIn[i].value = c; });
            }
            return hex;
        };
        const change = (skip) => { const hex = render(skip); if (onInput) onInput(hex); };
        const commit = () => {
            const hex = Utils.hsvToHex(hsv);
            if (hex !== committed && onCommit) onCommit(hex);
            committed = hex;
        };

        // Farbfläche: ziehen und Pfeiltasten
        const fromPointer = (e) => {
            const r = area.getBoundingClientRect();
            hsv.s = clamp((e.clientX - r.left) / r.width);
            hsv.v = 1 - clamp((e.clientY - r.top) / r.height);
            change();
        };
        area.onpointerdown = (e) => {
            area.setPointerCapture(e.pointerId);
            fromPointer(e);
            area.onpointermove = fromPointer;
        };
        area.onpointerup = area.onpointercancel = () => { area.onpointermove = null; commit(); };
        area.onkeydown = (e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (!moves[e.key]) return;
            e.preventDefault();
            hsv.s = clamp(hsv.s + moves[e.key][0]);
            hsv.v = clamp(hsv.v + moves[e.key][1]);
            change();
            commit();
        };

        hue.oninput = () => { hsv.h = Number(hue.value); change('hue'); };
        hue.onchange = commit;
        hexIn.onchange = () => {
            const hex = Utils.normalizeHex(hexIn.value);
            if (hex) hsv = Utils.hexToHsv(hex);
            change();
            commit();
        };
        rgbIn.forEach(inp => {
            inp.onchange = () => {
                const hex = '#' + rgbIn.map(x => clamp(Math.round(Number(x.value) || 0), 0, 255).toString(16).padStart(2, '0')).join('');
                hsv = Utils.hexToHsv(hex);
                change();
                commit();
            };
        });
        [hexIn, ...rgbIn].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); }));

        if (window.EyeDropper) {
            drop.onclick = async () => {
                try {
                    const res = await new window.EyeDropper().open();
                    hsv = Utils.hexToHsv(res.sRGBHex);
                    change();
                    commit();
                } catch { }
            };
        } else {
            drop.hidden = true;
        }

        // Popover unter dem Farbfeld – gleiche Regel wie bei Auswahllisten: immer nach unten
        const place = () => {
            const r = btn.getBoundingClientRect();
            const w = pop.offsetWidth;
            pop.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
            pop.style.top = `${r.bottom + 10}px`;
        };
        pop.addEventListener('beforetoggle', (e) => {
            if (e.newState === 'open') UI.ensureSpaceBelow(btn, 330);
        });
        pop.addEventListener('toggle', (e) => {
            const open = e.newState === 'open';
            btn.setAttribute('aria-expanded', open);
            if (open) {
                place();
                window.addEventListener('scroll', place, true);
                window.addEventListener('resize', place);
            } else {
                window.removeEventListener('scroll', place, true);
                window.removeEventListener('resize', place);
                commit();
            }
        });

        render();
        if (window.lucide) lucide.createIcons();
        return {
            setValue: (hex) => {
                const norm = Utils.normalizeHex(hex);
                if (!norm) return;
                hsv = Utils.hexToHsv(norm);
                committed = norm;
                render();
            }
        };
    },

    // Eine Protokollzeile – gleich für Ticket- und System-Protokoll
    logRow: ({ icon, user, date, action, details }) => `
        <div class="log-row">
            <div class="log-icon">${Icon(icon, 16)}</div>
            <div class="log-main">
                <div class="log-meta"><span>${Utils.esc(user)}</span><span>${Utils.fmtDate(date)}</span></div>
                <div class="log-action">${Utils.esc(action)}</div>
                ${details ? `<div class="log-details">${Utils.esc(details)}</div>` : ''}
            </div>
        </div>`,

    // Aufklappende Listen öffnen immer nach unten; die Höhe richtet sich nach dem Platz im Fenster
    dropdownMaxHeight: (anchor) => {
        const below = window.innerHeight - anchor.getBoundingClientRect().bottom - 18;
        return Math.max(120, Math.min(260, Math.floor(below)));
    },

    // Reicht der Platz unter dem Feld nicht, wird der nächste scrollbare Bereich (oder die Seite) nachgezogen
    ensureSpaceBelow: (anchor, needed) => {
        const missing = needed - (window.innerHeight - anchor.getBoundingClientRect().bottom);
        if (missing <= 0) return;
        let el = anchor.parentElement;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                const room = el.scrollHeight - el.clientHeight - el.scrollTop;
                const step = Math.min(missing, room);
                if (step > 0) el.scrollTop += step;
                if (step >= missing) return;
                break;
            }
            el = el.parentElement;
        }
        window.scrollBy(0, missing);
    },

    createMultiSelect: (container, options, initialValues = [], onChange = null) => {
        // Mehrfachauswahl im selben Look wie <select> (Stile in style.css, Abschnitt "Auswahllisten")
        container.innerHTML = '';
        container.classList.add('multi-select-container');
        container.classList.remove('open');

        const header = document.createElement('div');
        header.className = 'multi-select-header';
        header.tabIndex = 0;
        header.setAttribute('role', 'button');
        header.setAttribute('aria-haspopup', 'listbox');
        header.setAttribute('aria-expanded', 'false');

        const dropdown = document.createElement('div');
        dropdown.className = 'multi-select-dropdown';
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('aria-multiselectable', 'true');

        const inputs = [];

        const updateHeader = () => {
            const selected = inputs.filter(i => i.checked);
            let text = 'Bitte wählen...';
            if (selected.length > 2) text = `${selected.length} ausgewählt`;
            else if (selected.length) text = selected.map(i => i.dataset.label || i.value).join(', ');
            header.innerHTML = `<span class="ms-text${selected.length ? '' : ' is-placeholder'}">${Utils.esc(text)}</span><span class="ms-arrow" aria-hidden="true"></span>`;
        };

        options.forEach(opt => {
            const isObj = typeof opt === 'object';
            const val = isObj ? opt.value : opt;
            const label = isObj ? opt.label : opt;

            const row = document.createElement('label');
            row.className = 'ms-row';

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.value = val;
            box.dataset.label = label;
            box.checked = initialValues.includes(val);
            box.onchange = () => {
                updateHeader();
                if (onChange) onChange(inputs.filter(i => i.checked).map(i => i.value));
            };
            inputs.push(box);

            const textSpan = document.createElement('span');
            textSpan.textContent = label;

            row.appendChild(box);
            row.appendChild(textSpan);
            dropdown.appendChild(row);
        });

        container.appendChild(header);
        container.appendChild(dropdown);
        updateHeader();

        const close = () => {
            container.classList.remove('open');
            header.setAttribute('aria-expanded', 'false');
        };

        // Wie <select>: immer nach unten, Höhe passt sich dem Platz an
        const open = () => {
            document.querySelectorAll('.multi-select-container.open').forEach(c => {
                if (c !== container) c.classList.remove('open');
            });
            UI.ensureSpaceBelow(header, Math.min(dropdown.scrollHeight, 260) + 18);
            dropdown.style.maxHeight = `${UI.dropdownMaxHeight(header)}px`;
            container.classList.add('open');
            header.setAttribute('aria-expanded', 'true');
        };

        const toggle = () => container.classList.contains('open') ? close() : open();

        header.onclick = (e) => {
            e.stopPropagation();
            toggle();
        };
        header.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            } else if (e.key === 'Escape') {
                close();
            }
        };

        // Klick außerhalb schließt – Listener nur einmal pro Container
        if (container._msOutside) window.removeEventListener('click', container._msOutside);
        container._msOutside = (e) => {
            if (!container.contains(e.target)) close();
        };
        window.addEventListener('click', container._msOutside);

        return {
            getValue: () => inputs.filter(i => i.checked).map(i => i.value),
            setDisabled: (off) => container.classList.toggle('is-disabled', !!off),
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
            toggle.innerHTML = Icon('settings', 16);
            toggle.title = Lang.t('settings');
            toggle.id = 'btn-settings';
            toggle.classList.add('btn-icon');
            toggle.onclick = Settings.openModal;
            if (window.lucide) lucide.createIcons();
        }
    },

    // Jeder Hintergrund hat eine helle und eine dunkle Variante (siehe --bgp-* in style.css)
    bgPresets: [
        { type: 'default', val: '', preset: 'bg-default', label: 'Standard', icon: 'moon-star' },
        { type: 'class', val: 'bg-aurora', preset: 'bg-aurora', label: 'Aurora', icon: 'sparkles' },
        { type: 'class', val: 'bg-nebula', preset: 'bg-nebula', label: 'Nebel', icon: 'orbit' },
        { type: 'class', val: 'bg-ocean', preset: 'bg-ocean', label: 'Ozean', icon: 'waves' },
        { type: 'class', val: 'bg-forest', preset: 'bg-forest', label: 'Wald', icon: 'trees' },
        { type: 'class', val: 'bg-ember', preset: 'bg-ember', label: 'Glut', icon: 'flame' },
        { type: 'class', val: 'bg-sand', preset: 'bg-sand', label: 'Sand', icon: 'mountain' },
        { type: 'class', val: 'bg-graphite', preset: 'bg-graphite', label: 'Graphit', icon: 'grid-3x3' }
    ],

    // Alte Hintergrund-Werte auf die neuen Vorlagen abbilden
    normalizeBg: (s) => {
        const legacy = {
            'bg-anim-space': 'bg-aurora',
            'bg-anim-nebula': 'bg-nebula',
            'bg-anim-clouds': 'bg-aurora',
            'bg-anim-waves': 'bg-ocean',
            'linear-gradient(180deg, #0f172a, #1e293b)': 'bg-ocean',
            'linear-gradient(180deg, #064e3b, #065f46)': 'bg-forest',
            'linear-gradient(180deg, #f5f3ff, #ede9fe)': 'bg-nebula',
            'linear-gradient(180deg, #f0fdf4, #dcfce7)': 'bg-forest'
        };
        if ((s.bgType === 'class' || s.bgType === 'color') && legacy[s.bgValue]) {
            s.bgType = 'class';
            s.bgValue = legacy[s.bgValue];
        }
        return s;
    },
    applyAccent: (hex) => {
        const root = document.documentElement.style;
        root.setProperty('--primary-solid', hex);
        root.setProperty('--primary-rgb', Utils.hexToRgb(hex));
        root.setProperty('--primary-grad', `linear-gradient(135deg, ${hex}, ${Utils.adjustColor(hex, -20)})`);
    },
    applyBranding: (s) => {
        const name = (s.generalConfig?.portalName || s.companyConfig?.name || 'Support Portal').trim();
        qa('.brand-mini').forEach(el => { el.textContent = name; });
        const suffix = document.body.dataset.guard === 'admin' ? 'Admin' : document.body.dataset.guard === 'user' ? 'Dashboard' : 'Login';
        document.title = `${name} | ${suffix}`;
    },
    apply: (s) => {
        const isLight = s.theme === 'light';
        if (isLight) document.documentElement.className = 'light';
        else document.documentElement.className = '';

        Settings.applyAccent(s.accentColor);
        Settings.applyBranding(s);

        // Applied Background
        Settings.normalizeBg(s);
        const stars = q('#stars');
        const overlay = 'rgba(0,0,0,0.4)';

        // Clear body classes for animations
        document.body.className = '';

        if (s.bgType === 'default') {
            document.body.style.background = '';
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
                <div class="modal modal-lg">
                    <div class="modal-header">
                        <h3>${Icon('settings', 18)} ${Lang.t('portalSettings')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field">
                            <label>${Lang.t('themeMode')}</label>
                            <div class="tabs segmented">
                                <button type="button" class="tab-btn s-theme-btn" data-val="dark">${Icon('moon', 16)}${Lang.t('dark')}</button>
                                <button type="button" class="tab-btn s-theme-btn" data-val="light">${Icon('sun', 16)}${Lang.t('light')}</button>
                            </div>
                        </div>
                        <div class="field">
                            <label>${Lang.t('language')}</label>
                            <select id="s-lang"><option value="de">Deutsch</option><option value="en">English</option></select>
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('accentColor')}</label>
                            <div class="accent-picker">
                                <div class="accent-presets" role="group" aria-label="${Lang.t('accentColor')}">
                                    <button type="button" class="accent-preset" data-color="#6366f1" style="--preset:#6366f1" title="Indigo" aria-label="Indigo"></button>
                                    <button type="button" class="accent-preset" data-color="#63bce8" style="--preset:#63bce8" title="Himmelblau" aria-label="Himmelblau"></button>
                                    <button type="button" class="accent-preset" data-color="#10b981" style="--preset:#10b981" title="Grün" aria-label="Grün"></button>
                                    <button type="button" class="accent-preset" data-color="#f59e0b" style="--preset:#f59e0b" title="Orange" aria-label="Orange"></button>
                                    <button type="button" class="accent-preset" data-color="#ef4444" style="--preset:#ef4444" title="Rot" aria-label="Rot"></button>
                                </div>
                                <span class="accent-picker-divider"></span>
                                ${UI.colorPickerMarkup('s-color', 'Eigene Farbe')}
                                <span class="accent-picker-label" id="s-color-label"></span>
                            </div>
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('background')}</label>
                            <div id="s-bg-grid" class="bg-grid">
                                <!-- Rendered by renderBgGrid -->
                            </div>
                            <input type="file" id="s-bg-file" accept="image/*">
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('security')}</label>
                            <div id="s-sec-area">
                                <!-- Rendered dynamically -->
                            </div>
                        </div>
                    </div>
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
            Settings.colorPicker = UI.createColorPicker(modal.querySelector('.color-field'), {
                value: (await Store.getSettings()).accentColor,
                onInput: (hex) => {
                    Settings.applyAccent(hex);
                    q('#s-color-label').textContent = hex;
                },
                onCommit: async (hex) => {
                    const s = await Store.getSettings();
                    s.accentColor = hex;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                }
            });
            modal.querySelectorAll('.accent-preset').forEach(b => {
                b.onclick = async () => {
                    const s = await Store.getSettings();
                    s.accentColor = b.dataset.color;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                };
            });
            q('#s-lang').onchange = async (e) => {
                const s = await Store.getSettings();
                s.lang = e.target.value;
                await Store.saveSettings(s);
                Settings.apply(s);
                Lang.current = e.target.value;
                Lang.applyToDOM();
                if (q('.kanban-board')) {
                    AdminBoard.render();
                    AdminBoard.renderArchive();
                }
                if (q('#user-tickets')) UserDash.renderList();
                q('#sys-settings-modal')?.remove();
                modal.remove();
                Settings.openModal();
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
                <div class="setting-row">
                    <div class="check-text">
                        <strong>2-Faktor-Authentifizierung</strong>
                        <span>${isEnabled ? 'Aktiviert' : 'Deaktiviert'}</span>
                    </div>
                    <button class="${isEnabled ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-toggle-2fa">
                        ${Icon(isEnabled ? 'shield-off' : 'shield-check', 15)}${isEnabled ? 'Deaktivieren' : 'Einrichten'}
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
            if (window.lucide) lucide.createIcons();
        }

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },
    renderState: (modal, s) => {
        modal.querySelectorAll('.s-theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === (s.theme || 'dark'));
        });

        // Dynamic Background Grid
        const currentTheme = modal.dataset.renderedTheme;
        if (currentTheme !== s.theme) {
            modal.dataset.renderedTheme = s.theme;
            Settings.renderBgGrid(modal, s);
        }

        Settings.colorPicker?.setValue(s.accentColor);
        const accent = (s.accentColor || '').toLowerCase();
        let isPreset = false;
        modal.querySelectorAll('.accent-preset').forEach(b => {
            const active = b.dataset.color.toLowerCase() === accent;
            if (active) isPreset = true;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active);
        });
        q('#s-color').classList.toggle('active', !isPreset);
        q('#s-color-label').textContent = s.accentColor;
        q('#s-lang').value = s.lang || 'de';

        Settings.normalizeBg(s);
        modal.querySelectorAll('.s-bg-btn').forEach(b => {
            let active = false;
            if (b.dataset.type === 'image') {
                active = (s.bgType === 'image'); // Pure type check for custom upload
            } else {
                active = (b.dataset.type === s.bgType && (b.dataset.val || '') === s.bgValue);
            }
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active);
            if (b.dataset.type === 'image') {
                b.style.backgroundImage = (s.bgType === 'image' && s.bgValue) ? `url(${s.bgValue})` : '';
            }
        });
    },

    renderBgGrid: (modal, s) => {
        const grid = modal.querySelector('#s-bg-grid');
        if (!grid) return;

        const presets = Settings.bgPresets;
        grid.innerHTML = '';

        presets.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-secondary s-bg-btn';
            btn.dataset.type = p.type;
            btn.dataset.val = p.val;
            btn.dataset.preset = p.preset;
            btn.title = p.label;
            btn.innerHTML = `${Icon(p.icon, 16)}<span>${p.label}</span>`;
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
        upBtn.type = 'button';
        upBtn.className = 'btn-secondary s-bg-btn';
        upBtn.id = 's-bg-upload';
        upBtn.dataset.type = 'image';
        upBtn.dataset.preset = 'upload';
        upBtn.title = 'Eigenes Bild';
        upBtn.innerHTML = `${Icon('image-plus', 16)}<span>Eigenes Bild</span>`;
        upBtn.onclick = () => q('#s-bg-file').click();
        grid.appendChild(upBtn);
        if (window.lucide) lucide.createIcons();

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
            const rightNav = q('.topbar-right');
            if (rightNav && !q('#btn-to-admin')) {
                const btn = document.createElement('button');
                btn.id = 'btn-to-admin';
                btn.className = 'btn-ghost';
                btn.innerHTML = `${Icon('shield', 16)}${Lang.t('adminPanel')}`;
                btn.onclick = () => window.location.href = 'admin.html';
                rightNav.insertBefore(btn, rightNav.firstChild);
            }
        }

        if (!q('#btn-create-ticket')) return;
        const btn = q('#btn-create-ticket');
        btn.onclick = async () => {
            const title = q('#t-title').value.trim();
            const desc = q('#t-desc').value.trim();
            const settings = await Store.getSettings();
            const prio = q('#t-prio').value || settings.generalConfig?.defaultPrio || 'Normal';
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
            if (settings.emailConfig && settings.emailConfig.host) {
                const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin');
                admins.forEach(a => {
                    if (a.email) Store.sendEmail(a.email, `Neues Ticket: ${title}`, `Ticket #${newTicket.id} von ${user.name || user.username} erstellt.`);
                });
            }

            UI.toast('Ticket erstellt!');
            q('#t-title').value = '';
            q('#t-desc').value = '';
            if (q('#t-prio')) q('#t-prio').value = settings.generalConfig?.defaultPrio || 'Normal';
            await UserDash.renderList();
        };

        // ... Key listeners for Create Ticket ...
        q('#t-title').onkeydown = (e) => {
            if (e.key === 'Enter') q('#btn-create-ticket').click();
        };

        // Populate Categories dynamically with Custom Multi-Select
        const catContainer = q('#u-cat-container');
        if (catContainer) {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            if (q('#t-prio')) q('#t-prio').value = settings.generalConfig?.defaultPrio || 'Normal';
            const initial = categories.includes('Allgemein') ? ['Allgemein'] : categories.slice(0, 1);
            UserDash.categoryInstance = UI.createMultiSelect(catContainer, categories, initial);
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

        // Suche in der Ticketliste
        const search = q('#u-search');
        if (search) {
            search.placeholder = Lang.t('search');
            search.oninput = () => UserDash.renderList();
        }

        const archiveFilter = q('#dash-filter-archive');
        if (archiveFilter) {
            const label = archiveFilter.closest('label')?.querySelector('[data-i18n]');
            if (label) {
                label.dataset.i18n = 'showClosedArchived';
                label.textContent = Lang.t('showClosedArchived');
            }
            archiveFilter.onchange = () => {
                UserDash.displayLimit = UserDash.pageSize;
                UserDash.renderList();
            };
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
                tag.className = 'file-chip';
                tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
                tag.querySelector('.remove-file').onclick = () => {
                    UserDash.selectedFiles.splice(idx, 1);
                    UserDash.renderFilePreview();
                };
                pan.appendChild(tag);
            });
            if (window.lucide) lucide.createIcons();
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

        if (q('#u-m-title')) q('#u-m-title').textContent = t.title + (t.archived ? ` (${Lang.t('archived')})` : '');
        if (q('#u-m-desc')) q('#u-m-desc').textContent = t.desc || Lang.t('noDescription');

        // Read-only check for archived
        const uChatInput = q('#u-chat-input');
        const uChatSend = q('#u-chat-send');
        if (uChatInput) uChatInput.disabled = t.archived;
        if (uChatSend) uChatSend.disabled = t.archived;

        // Metadata
        if (q('#u-m-status')) {
            q('#u-m-status').innerHTML = `<span class="status-badge"><span class="status-dot" style="--dot:${getStatusColor(t.status)}"></span>${Lang.status(t.status)}</span>`;
        }
        if (q('#u-m-date')) q('#u-m-date').textContent = Utils.fmtDate(t.createdAt);

        // Handle Archived Date Visibility
        if (q('#u-m-archived')) {
            const archEl = q('#u-m-archived');
            if (t.archived && t.archivedAt) {
                archEl.textContent = Utils.fmtDate(t.archivedAt);
                archEl.parentElement.style.display = '';
            } else {
                archEl.parentElement.style.display = 'none';
            }
        }

        if (q('#u-m-prio')) q('#u-m-prio').innerHTML = `<span class="prio-pill prio-${t.prio}">${Lang.prio(t.prio)}</span>`;
        if (q('#u-m-cat')) q('#u-m-cat').textContent = (Array.isArray(t.category) ? t.category.join(', ') : t.category) || '-';

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
                q('#u-m-assignee').textContent = t.assigneeName || Lang.t('nobody');
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
                chatInput.placeholder = Lang.t('archivedReadonly');
            }
            if (chatSend) chatSend.disabled = true;
            if (chatFile) chatFile.disabled = true;
        } else {
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.placeholder = Lang.t('writeMessage');
            }
            if (chatSend) chatSend.disabled = false;
            if (chatFile) chatFile.disabled = false;
        }

        q('#u-ticket-modal').classList.add('open');
    },

    closeModal: () => {
        q('#u-ticket-modal').classList.remove('open');
        UserDash.currentTicketId = null;
    },

    pageSize: 5,
    displayLimit: 5,

    renderList: async () => {
        const list = q('#user-tickets');
        if (!list) return;
        const user = await Store.currentUser();
        const userKeys = [
            user.username,
            user.name,
            user.email,
            user.id
        ].filter(Boolean).map(v => String(v).toLowerCase());

        const belongsToCurrentUser = (t) => {
            const ticketKeys = [
                t.author,
                t.authorName,
                t.requester,
                t.requesterName,
                t.createdBy,
                t.user,
                t.username,
                t.email,
                t.authorEmail
            ].filter(Boolean).map(v => String(v).toLowerCase());
            return ticketKeys.some(v => userKeys.includes(v));
        };

        let tickets = (await Store.getTickets()).filter(belongsToCurrentUser);

        // Default: show every still-open ticket this user created. Toggle adds closed and archived history.
        const showClosedArchived = q('#dash-filter-archive') && q('#dash-filter-archive').checked;
        tickets = tickets.filter(t => {
            const isOpen = t.status !== 'Geschlossen' && !t.archived;
            if (showClosedArchived) return true;
            return isOpen;
        });

        // Search Filter
        const query = (q('#u-search')?.value || '').toLowerCase().trim();
        if (query) {
            tickets = tickets.filter(t => Utils.matchesSearch(query, t));
        }

        // Sorting
        tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const total = tickets.length;
        const toDisplay = tickets;

        list.innerHTML = '';
        if (toDisplay.length === 0) {
            list.innerHTML = `<div class="empty-state">${Lang.t('noTickets')}</div>`;
        } else {
            toDisplay.forEach(t => {
                const el = document.createElement('div');
                el.className = `table-row user-ticket-row${t.archived ? ' is-archived' : ''}`;

                const cats = Array.isArray(t.category) ? t.category : [t.category || '-'];
                const catBadges = cats.map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('');
                const archivedBadge = t.archived ? `<span class="archive-badge">${Icon('archive', 12)}${Lang.t('archived')}</span>` : '';

                el.innerHTML = `
                    <span class="status-dot" style="--dot:${getStatusColor(t.status)}" title="${Utils.esc(Lang.status(t.status))}"></span>
                    <div class="ticket-row-main">
                        <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.title)}</div>
                        <div class="ticket-row-cats">${catBadges}${archivedBadge}</div>
                    </div>
                    <div class="ticket-row-status"><span class="status-badge">${Lang.status(t.status)}</span></div>
                    <div class="ticket-row-date date">${Utils.fmtDate(t.createdAt)}</div>
                    <div class="ticket-row-prio"><span class="prio-pill prio-${t.prio}">${Lang.prio(t.prio)}</span></div>
                `;
                el.onclick = () => UserDash.openModal(t.id);
                list.appendChild(el);
            });
            if (window.lucide) lucide.createIcons();
        }

        // Handle Load More
        const loadContainer = q('#dash-load-more-container');
        if (loadContainer) {
            loadContainer.style.display = 'none';
        }
    }
};

function getStatusColor(s) {
    if (s === 'Neu') return 'var(--info)';
    if (s === 'In Bearbeitung') return 'var(--warning)';
    if (s === 'Geschlossen') return 'var(--success)';
    return 'var(--text-sec)';
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
    noteFiles: [],

    orderTopbar: () => {
        const nav = q('.topbar-right');
        if (!nav) return;
        ['btn-to-dash', 'btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings', 'theme-toggle', 'btn-settings', 'logout'].forEach(id => {
            const el = q(`#${id}`);
            if (el && el.parentElement === nav) nav.appendChild(el);
        });
    },

    renderFilePreview: () => {
        const pan = q('#m-chat-file-preview');
        if (!pan) return;
        pan.innerHTML = '';
        if (AdminBoard.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            AdminBoard.selectedFiles.forEach((f, idx) => {
                const tag = document.createElement('div');
                tag.className = 'file-chip';
                tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
                tag.querySelector('.remove-file').onclick = () => {
                    AdminBoard.selectedFiles.splice(idx, 1);
                    AdminBoard.renderFilePreview();
                };
                pan.appendChild(tag);
            });
            if (window.lucide) lucide.createIcons();
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
            const actions = q('.topbar-right');
            if (actions) {
                if (!q('#btn-manage-users')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-manage-users';
                    btn.className = 'btn-ghost';
                    btn.innerHTML = `${Icon('users', 16)}${Lang.t('userMgmt')}`;
                    btn.onclick = AdminBoard.openUserManager;
                    actions.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
                }
                if (isSuper && !q('#btn-sys-settings')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-sys-settings';
                    btn.className = 'btn-ghost';
                    btn.innerHTML = `${Icon('sliders', 16)}${Lang.t('system')}`;
                    btn.onclick = AdminBoard.openSystemSettings;
                    actions.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
                }
                AdminBoard.orderTopbar();
            }
        }
        if (isSuper || user?.canViewLogs) {
            const btnLogs = q('#btn-global-logs');
            if (btnLogs) {
                btnLogs.style.display = 'inline-flex';
                btnLogs.onclick = AdminBoard.openGlobalLogsModal;
            }
        }
        AdminBoard.orderTopbar();
        if (window.lucide) lucide.createIcons();

        const reqBoard = q('#request-list')?.parentElement;
        if (reqBoard) {
            reqBoard.style.display = canReqs ? '' : 'none';
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

        const noteFileInput = q('#m-note-file-input');
        if (noteFileInput) {
            noteFileInput.onchange = () => {
                Array.from(noteFileInput.files).forEach(f => AdminBoard.noteFiles.push(f));
                AdminBoard.renderNoteFilePreview();
                noteFileInput.value = '';
            };
        }

        const noteInput = q('#m-new-comment');
        const noteBold = q('#m-note-bold');
        const noteItalic = q('#m-note-italic');
        const noteList = q('#m-note-list');
        if (noteBold && noteInput) noteBold.onclick = () => insertMarkdown(noteInput, '**');
        if (noteItalic && noteInput) noteItalic.onclick = () => insertMarkdown(noteInput, '*');
        if (noteList && noteInput) {
            noteList.onclick = () => {
                const start = noteInput.selectionStart;
                const end = noteInput.selectionEnd;
                const selected = noteInput.value.substring(start, end) || 'Punkt';
                const listText = selected.split('\n').map(line => `- ${line}`).join('\n');
                noteInput.value = noteInput.value.substring(0, start) + listText + noteInput.value.substring(end);
                noteInput.focus();
            };
        }
        const noteSearch = q('#m-note-search');
        if (noteSearch) noteSearch.oninput = async () => {
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
            if (t) AdminBoard.renderInternalComments(t);
        };

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
                if (dept) dept.style.display = roleSel.value === 'admin' ? '' : 'none';
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
        if (window.lucide) lucide.createIcons();

        AdminBoard.renderRequests();

        function createCard(t, usersList) {
            const card = document.createElement('div');
            card.className = `ticket-card ticket-status-${String(t.status || 'Neu').toLowerCase().replace(/\s+/g, '-')}`;
            card.draggable = true;
            card.dataset.id = t.id;

            const ownerUsername = t.owner || (Array.isArray(t.assignees) ? t.assignees[0] : t.assignee);
            const owner = ownerUsername ? usersList.find(x => x.username === ownerUsername) : null;
            const ownerLabel = owner ? (owner.name || owner.username) : (ownerUsername || Lang.t('unassigned'));
            const participantNames = (Array.isArray(t.participants) ? t.participants : [])
                .filter(username => username !== ownerUsername)
                .map(username => {
                    const found = usersList.find(x => x.username === username);
                    return found ? (found.name || found.username) : username;
                });
            // Nur die zuletzt gesendete Chat-Nachricht entscheidet, ob eine Antwort aussteht –
            // Statusänderungen o.ä. im Protokoll lösen keinen "wartet auf Antwort"-Hinweis aus.
            const latestChat = (t.chat || []).slice().sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))[0];
            const awaitingReply = latestChat?.role === 'user';
            const todoOpen = (t.todos || []).filter(todo => !todo.done).length;

            card.innerHTML = `
                <div class="t-head">
                    <span class="t-tag prio-${t.prio}">${Icon('flag', 12)}${Lang.prio(t.prio)}</span>
                    <div class="t-cats">
                        ${(Array.isArray(t.category) ? t.category : [t.category || '-']).map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('')}
                    </div>
                </div>
                <div class="t-title">${Utils.esc(t.title)}</div>
                <div class="t-meta t-sub">
                    <span class="t-author" title="${Utils.esc(t.authorName || t.author || '-')}">${Icon('user', 12)}${Utils.esc(t.authorName || t.author || '-')} · ${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                    <span class="t-counts">
                        <span class="chat-count" title="Nachrichten">${Icon('message-square', 12)}${(t.chat?.length || 0)}</span>
                        <span class="chat-count" title="Interne Notizen">${Icon('notebook-tabs', 12)}${(t.comments?.length || 0)}</span>
                    </span>
                </div>
                <div class="ticket-card-ops">
                    <div class="ticket-card-owner${ownerUsername ? '' : ' is-unassigned'}" title="${ownerUsername ? 'Hauptverantwortlicher: ' + Utils.esc(ownerLabel) : 'Noch niemandem zugewiesen'}">
                        ${Icon('user-check', 13)}
                        <span>${Utils.esc(ownerLabel)}</span>
                    </div>
                    <div class="ticket-card-participants" title="${participantNames.length ? 'Beteiligt: ' + Utils.esc(participantNames.join(', ')) : 'Keine weiteren Beteiligten'}">
                        ${Icon('users-round', 13)}
                        <span>${participantNames.length}</span>
                    </div>
                    <div class="ticket-card-work" title="${todoOpen} offene Teilaufgabe${todoOpen === 1 ? '' : 'n'}">
                        ${Icon('list-checks', 13)}
                        <span>${todoOpen}</span>
                    </div>
                </div>
                ${awaitingReply ? `
                <div class="ticket-card-activity has-user-update">
                    <span>${Icon('message-circle', 13)}Antwort ausstehend</span>
                    <time>${Utils.fmtDate(latestChat.date).split(' ')[0]}</time>
                </div>` : ''}
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
            modal.innerHTML = `
                <div class="modal modal-xl">
                    <div class="modal-header">
                        <h3>${Icon('bell', 18)} System-Protokoll</h3>
                        <div class="modal-actions">
                            <input type="text" id="gl-search" placeholder="Benutzer, Aktion, Details, Datum oder Uhrzeit suchen...">
                            <button class="btn-ghost btn-icon btn-danger" id="btn-gl-clear" title="Protokoll leeren" aria-label="Protokoll leeren">${Icon('trash-2', 16)}</button>
                            <button class="btn-ghost btn-icon" title="${Lang.t('close')}" aria-label="${Lang.t('close')}" onclick="q('#global-logs-modal').classList.remove('open')">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body flush" id="gl-body"></div>
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
        if (window.lucide) lucide.createIcons();
    },

    renderGlobalLogs: async () => {
        const body = q('#gl-body');
        if (!body) return;

        const logs = await Store.getGlobalLogs();
        const search = q('#gl-search').value.toLowerCase().trim();

        const filtered = logs.filter(l => Utils.matchesSearch(search, l));

        const visibleLogs = filtered.slice().reverse();
        const iconForLog = (action = '') => {
            const text = action.toLowerCase();
            if (text.includes('geloescht') || text.includes('geaendert')) return text.includes('geloescht') ? 'trash-2' : 'refresh-cw';
            if (text.includes('gelöscht') || text.includes('geleert')) return 'trash-2';
            if (text.includes('erstellt') || text.includes('genehmigt')) return 'plus-circle';
            if (text.includes('status') || text.includes('geändert') || text.includes('bearbeitet')) return 'refresh-cw';
            if (text.includes('anmeldung')) return 'log-in';
            if (text.includes('abmeldung')) return 'log-out';
            if (text.includes('ticket')) return 'ticket';
            if (text.includes('benutzer')) return 'user-round';
            return 'activity';
        };
        body.innerHTML = visibleLogs.length
            ? visibleLogs.map(l => UI.logRow({ icon: iconForLog(l.action), user: l.user, date: l.date, action: l.action, details: l.details })).join('')
            : '<div class="empty-state">Keine Einträge gefunden.</div>';
        if (window.lucide) lucide.createIcons();
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

        tabs.innerHTML = `
            <div class="tab-btn active" data-view="users">Benutzer</div>
            ${isSuper ? `<div class="tab-btn" data-view="admins">Admins</div>` : ''}
            ${isSuper ? `<div class="tab-btn" data-view="groups">Gruppen</div>` : ''}
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
                <div class="um-controls">
                    <input type="text" id="um-search" class="um-search" placeholder="Durchsuchen...">
                    <div id="um-actions" class="um-actions"></div>
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
                <button class="btn-secondary btn-icon" id="btn-csv-export" title="CSV-Export" aria-label="CSV-Export">${Icon('download', 16)}</button>
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-csv-import" title="CSV-Import" aria-label="CSV-Import">${Icon('upload', 16)}</button>` : ''}
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-ldap-sync" title="LDAP-Sync" aria-label="LDAP-Sync">${Icon('refresh-cw', 16)}</button>` : ''}
                <button class="btn-primary" id="btn-add-user">${Icon('plus', 16)}Neu</button>
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
        } else if (view === 'groups') {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-group">${Icon('plus', 16)}Neue Gruppe</button>`;
            actions.querySelector('#btn-add-group').onclick = () => AdminBoard.openEditGroupModal(null);
        } else {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-cat">${Icon('plus', 16)}Neue Kategorie</button>`;
            actions.querySelector('#btn-add-cat').onclick = () => AdminBoard.openEditCategoryModal(null);
        }

        if (view === 'groups') {
            const groups = await Store.getGroups();
            const filteredGroups = groups.filter(g => Utils.matchesSearch(searchTerm, g));

            filteredGroups.forEach(g => {
                const el = document.createElement('div');
                el.className = 'table-row user-manager-row';
                el.innerHTML = `
                    <div class="user-manager-text">
                        <span class="user-manager-name">${Icon('users-round', 15)}${Utils.esc(g.name)}</span>
                        <span class="row-sub">${Utils.esc(g.description || '-')}</span>
                        <span class="badge">${(g.members || []).length} ${(g.members || []).length === 1 ? 'Mitglied' : 'Mitglieder'}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon edit-g" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-g" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                `;
                el.querySelector('.edit-g').onclick = () => AdminBoard.openEditGroupModal(g);
                el.querySelector('.del-g').onclick = () => {
                    UI.confirm(`Gruppe "${g.name}" löschen?`, async () => {
                        const groups = (await Store.getGroups()).filter(x => x.id !== g.id);
                        await Store.saveGroups(groups);
                        const users = await Store.getUsers();
                        users.forEach(u => {
                            if (Array.isArray(u.groups)) u.groups = u.groups.filter(id => id !== g.id);
                        });
                        await Store.saveUsers(users);
                        AdminBoard.renderUserManager('groups');
                    });
                };
                list.appendChild(el);
            });
            if (window.lucide) lucide.createIcons();
            return;
        }

        if (view === 'cats') {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            categories.filter(c => Utils.matchesSearch(searchTerm, c)).forEach(c => {
                const el = document.createElement('div');
                el.className = 'table-row user-manager-row';
                el.innerHTML = `
                    <div class="user-manager-text">
                        <span class="user-manager-name">${Icon('tag', 15)}${Utils.esc(c)}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon edit-c" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-c" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
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
            if (window.lucide) lucide.createIcons();
            return;
        }

        const users = await Store.getUsers();
        const groups = await Store.getGroups();
        const filtered = users.filter(u => {
            const matchesView = (view === 'users' && u.role === 'user') ||
                (view === 'admins' && (u.role === 'admin' || u.role === 'superadmin'));
            if (!matchesView) return false;

            return Utils.matchesSearch(searchTerm, u, groups.filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id)));
        });

        filtered.forEach(u => {
            const el = document.createElement('div');
            el.className = 'table-row user-manager-row';

            let roleInfo = u.role.toUpperCase();
            if (u.role === 'admin') {
                const d = u.dept;
                const dStr = Array.isArray(d) ? d.join(', ') : (d || 'Allgemein');
                roleInfo += ` (${dStr})`;
            }
            const userGroups = groups
                .filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id))
                .map(g => g.name);

            el.innerHTML = `
                <div class="user-manager-text">
                    <span class="user-manager-name">${Utils.esc(u.username)}${u.twoFactorEnabled ? `<span class="badge badge-accent" title="2FA aktiv">${Icon('shield-check', 12)}2FA</span>` : ''}</span>
                    <span class="row-sub">${Utils.esc(u.name || '-')} · ${Utils.esc(u.email || 'Keine E-Mail')}</span>
                    <div class="group-chip-row">
                        <span class="badge">${Utils.esc(roleInfo)}</span>
                        ${userGroups.map(name => `<span class="group-chip">${Icon('users-round', 12)}${Utils.esc(name)}</span>`).join('')}
                    </div>
                </div>
                <div class="user-manager-actions">
                    ${isSuper && u.twoFactorEnabled ? `<button class="btn-ghost btn-sm reset-2fa" title="2FA zurücksetzen">${Icon('unlock-keyhole', 15)}2FA</button>` : ''}
                    <button class="btn-ghost btn-icon edit-u" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                    ${u.role !== 'superadmin' && u.username !== 'admin' ? `<button class="btn-ghost btn-icon btn-danger del-u" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>` : ''}
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
                q('#user-delete-modal')?.remove();
                const confirmModal = AdminBoard.createGenericModal();
                confirmModal.id = 'user-delete-modal';
                const title = confirmModal.querySelector('h3');
                const content = confirmModal.querySelector('.modal-body');
                const footer = confirmModal.querySelector('.modal-footer');

                title.textContent = 'Benutzer löschen';
                content.innerHTML = `
                    <p>Möchtest du <strong>${Utils.esc(u.username)}</strong> wirklich löschen? Was soll mit den Tickets dieses Benutzers geschehen?</p>
                    <div class="checkbox-list">
                        <label class="check-row"><input type="radio" name="del-opt" value="archive" checked><span>Tickets archivieren (empfohlen)</span></label>
                        <label class="check-row"><input type="radio" name="del-opt" value="delete"><span>Tickets unwiderruflich löschen</span></label>
                    </div>
                `;

                footer.innerHTML = `
                    <button class="btn-secondary close-m">Abbrechen</button>
                    <button class="btn-danger" id="btn-perform-del">${Icon('trash-2', 16)}Löschen</button>
                `;

                confirmModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => confirmModal.classList.remove('open'));
                if (window.lucide) lucide.createIcons();

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
        if (window.lucide) lucide.createIcons();
    },

    openEditCategoryModal: async (catName) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');

        const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin');

        let adminListHtml = `
            <div class="field">
                <label>Admins dieser Kategorie</label>
                <div id="cat-admin-list" class="checkbox-list">
        `;

        admins.forEach(a => {
            const hasCat = catName && Array.isArray(a.dept) && a.dept.includes(catName);
            adminListHtml += `
                <label class="check-row">
                    <input type="checkbox" value="${a.username}" ${hasCat ? 'checked' : ''} class="cat-admin-check">
                    <span>${Utils.esc(a.name || a.username)}</span>
                </label>
            `;
        });
        adminListHtml += '</div></div>';

        title.textContent = catName ? 'Kategorie bearbeiten' : 'Neue Kategorie';
        content.innerHTML = `
            <div class="field">
                <label>Name</label>
                <input type="text" id="g-input" value="${Utils.esc(catName || '')}" placeholder="z. B. Technik">
            </div>
            ${adminListHtml}
        `;

        confirmBtn.textContent = Lang.t('save');
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

    openEditGroupModal: async (group) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');
        const users = await Store.getUsers();
        const members = group?.members || [];

        title.textContent = group ? `Gruppe ${group.name} bearbeiten` : 'Neue Gruppe';
        content.innerHTML = `
            <div class="field"><label>Name</label><input id="ge-name" type="text" value="${group?.name || ''}" placeholder="z.B. Verwaltung"></div>
            <div class="field"><label>Beschreibung</label><input id="ge-desc" type="text" value="${group?.description || ''}" placeholder="Aufgabe oder Bereich"></div>
            <div class="field">
                <label>Mitglieder</label>
                <div class="checkbox-list">
                    ${users.map(u => `
                        <label class="check-row">
                            <input type="checkbox" value="${u.username}" ${members.includes(u.username) ? 'checked' : ''}>
                            <span>${Utils.esc(u.name || u.username)} <small>(${Utils.esc(u.username)})</small></span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
        confirmBtn.textContent = Lang.t('save');
        confirmBtn.onclick = async () => {
            const name = q('#ge-name').value.trim();
            if (!name) { UI.toast('Bitte Gruppennamen angeben'); return; }
            const description = q('#ge-desc').value.trim();
            const selectedMembers = qa('#generic-modal .checkbox-list input:checked').map(x => x.value);
            const groups = await Store.getGroups();
            if (group) {
                const target = groups.find(g => g.id === group.id);
                if (target) {
                    target.name = name;
                    target.description = description;
                    target.members = selectedMembers;
                }
            } else {
                groups.push({ id: Utils.uid(), name, description, members: selectedMembers });
            }
            await Store.saveGroups(groups);

            const users = await Store.getUsers();
            users.forEach(u => {
                const assignedGroupIds = groups.filter(g => (g.members || []).includes(u.username)).map(g => g.id);
                u.groups = assignedGroupIds;
            });
            await Store.saveUsers(users);
            modal.classList.remove('open');
            AdminBoard.renderUserManager('groups');
            UI.toast(group ? 'Gruppe gespeichert' : 'Gruppe erstellt');
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    openEditUserModal: async (user, viewContext) => {
        let editModal = q('#user-edit-modal');
        if (!editModal) {
            editModal = document.createElement('div');
            editModal.id = 'user-edit-modal';
            editModal.className = 'modal-overlay';
            editModal.innerHTML = `
                <div class="modal modal-lg">
                    <div class="modal-header">
                        <h3>Benutzer bearbeiten</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="ue-save-head" title="Speichern" aria-label="Speichern">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field"><label>Benutzername</label><input id="ue-user" type="text"></div>
                        <div class="field"><label>Name</label><input id="ue-name" type="text"></div>
                        <div class="field"><label>E-Mail</label><input id="ue-email" type="email"></div>
                        <div class="field"><label>Passwort (leer = unverändert)</label><input id="ue-pass" type="password"></div>
                        <div class="field field-wide" id="ue-role-box"><label>Rolle</label><select id="ue-role"><option value="user">User</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></div>
                        <div class="field field-wide" id="ue-dept-box" style="display:none">
                            <label>Kategorien</label>
                            <div id="ue-dept-list" class="checkbox-list"></div>
                        </div>
                        <div class="field field-wide" id="ue-groups-box">
                            <label>Benutzergruppen</label>
                            <div id="ue-groups-list" class="checkbox-list"></div>
                        </div>
                        <div class="field field-wide" id="ue-man-box" style="display:none">
                            <label>Berechtigungen</label>
                            <div class="checkbox-list">
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-req"><span>Kontoanfragen verwalten</span></label>
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-users"><span>Benutzerverwaltung (nur User)</span></label>
                                <label class="check-row"><input type="checkbox" id="ue-can-view-logs"><span>Systemlogs anzeigen</span></label>
                            </div>
                         </div>
                    </div>
                    <div class="modal-footer action-footer">
                        <button class="btn-secondary close-m footer-cancel">Abbrechen</button>
                        <button class="btn-primary" id="ue-save">Speichern</button>
                    </div>
                </div>`;
            document.body.appendChild(editModal);
            editModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => editModal.classList.remove('open'));
            editModal.querySelector('#ue-save-head').onclick = () => q('#ue-save')?.click();
            if (window.lucide) lucide.createIcons();
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
        const viewLogsCheck = q('#ue-can-view-logs');
        if (manReqCheck) manReqCheck.checked = user ? !!user.canManageRequests : false;
        if (manUsersCheck) manUsersCheck.checked = user ? !!user.canManageUsers : false;
        if (viewLogsCheck) viewLogsCheck.checked = user ? !!user.canViewLogs : false;

        const updateUI = () => {
            const r = roleSel.value;
            q('#ue-dept-box').style.display = r === 'admin' ? '' : 'none';
            if (manBox) manBox.style.display = (r === 'admin' && isSuper) ? '' : 'none';
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
            const row = document.createElement('label');
            row.className = 'check-row';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = c;
            chk.checked = userDepts.includes(c);

            const txt = document.createElement('span');
            txt.textContent = c;

            row.appendChild(chk);
            row.appendChild(txt);
            list.appendChild(row);
        });

        const groupList = q('#ue-groups-list');
        if (groupList) {
            const groups = await Store.getGroups();
            const userGroupIds = user?.groups || groups.filter(g => (g.members || []).includes(user?.username)).map(g => g.id);
            groupList.innerHTML = groups.map(g => `
                <label class="check-row">
                    <input type="checkbox" value="${g.id}" ${userGroupIds.includes(g.id) ? 'checked' : ''}>
                    <span>${Utils.esc(g.name)}</span>
                </label>
            `).join('') || '<div class="empty-state compact">Keine Gruppen vorhanden</div>';
        }

        const toggleDept = () => {
            const r = q('#ue-role').value;
            q('#ue-dept-box').style.display = (r === 'admin') ? '' : 'none';
        };
        q('#ue-role').onchange = updateUI;
        updateUI();

        editModal.querySelector('h3').textContent = isNew ? 'Neuen Benutzer anlegen' : `Benutzer ${user.username} bearbeiten`;
        editModal.classList.add('open');

        q('#ue-save').onclick = async () => {
            const uVal = q('#ue-user').value.trim();
            const nVal = q('#ue-name').value.trim();
            const eVal = q('#ue-email').value.trim();
            const pVal = q('#ue-pass').value.trim();
            const rVal = q('#ue-role').value;
            const gVal = qa('#ue-groups-list input:checked').map(x => x.value);

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
                    groups: gVal,
                    canManageRequests: rVal === 'admin' ? q('#ue-can-manage-req').checked : false,
                    canManageUsers: rVal === 'admin' ? q('#ue-can-manage-users').checked : false,
                    canViewLogs: rVal === 'admin' ? q('#ue-can-view-logs').checked : false
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
                        target.canViewLogs = rVal === 'admin' ? q('#ue-can-view-logs').checked : false;
                    }
                    target.dept = target.role === 'admin' ? dVal : undefined;
                    target.groups = gVal;
                    await Store.addGlobalLog('Benutzer bearbeitet', `Name: ${target.name || target.username}, Rolle: ${target.role}`);
                }
            }
            await Store.saveUsers(users);
            const groups = await Store.getGroups();
            groups.forEach(g => {
                g.members = (g.members || []).filter(username => username !== uVal);
                if (gVal.includes(g.id)) g.members.push(uVal);
            });
            await Store.saveGroups(groups);
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
            <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3></h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="generic-save-head" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body"></div>
                <div class="modal-footer action-footer">
                    <button class="btn-secondary close-m footer-cancel">Abbrechen</button>
                    <button class="btn-primary">Speichern</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
        modal.querySelector('#generic-save-head').onclick = () => modal.querySelector('.modal-footer .btn-primary')?.click();
        if (window.lucide) lucide.createIcons();
        return modal;
    },

    openSystemSettings: async () => {
        let modal = q('#sys-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sys-settings-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-xl">
                    <div class="modal-header">
                        <h3>${Icon('sliders', 18)}${Lang.t('systemSettings')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="sys-save-head" title="${Lang.t('saveSettings')}" aria-label="${Lang.t('saveSettings')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="sys-settings-shell">
                    <nav class="sys-settings-nav" aria-label="${Lang.t('systemSettings')}">
                        <button class="tab-btn active" data-tab="sys-general">
                            <i data-lucide="sliders"></i><span>${Lang.t('general')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-sec">
                            <i data-lucide="shield"></i><span>${Lang.t('security')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-notify">
                            <i data-lucide="bell"></i><span>${Lang.t('notifications')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-email">
                            <i data-lucide="mail"></i><span>${Lang.t('emailIntegration')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-ldap">
                            <i data-lucide="server"></i><span>LDAP</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-outlook">
                            <i data-lucide="mail-check"></i><span>Outlook</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-company">
                            <i data-lucide="building-2"></i><span>${Lang.t('company')}</span>
                        </button>
                    </nav>
                    <div class="modal-body sys-settings-content">
                        <!-- E-Mail SMTP -->
                        <div id="sys-email" class="tab-content">
                            <div class="callout"><strong>Hinweis:</strong> ${Lang.t('emailHint')}</div>
                            <div class="settings-section-title">${Icon('server-cog', 15)}SMTP-Ausgang</div>
                            <div class="field"><label>${Lang.t('smtpHost')}</label><input id="sys-smtp-host" type="text" placeholder="smtp.office365.com"></div>
                            <div class="field"><label>${Lang.t('smtpPort')}</label><input id="sys-smtp-port" type="number" placeholder="587"></div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('smtpUser')}</label><input id="sys-smtp-user" type="text" placeholder="user@example.com"></div>
                                <div class="field"><label>${Lang.t('smtpPassword')}</label><input id="sys-smtp-pass" type="password" placeholder="********"></div>
                            </div>
                            <div class="field"><label>${Lang.t('smtpFrom')}</label><input id="sys-smtp-from" type="email" placeholder="support@example.com"></div>
                            <div class="field"><label>${Lang.t('smtpFromName')}</label><input id="sys-smtp-fromname" type="text" placeholder="Support Portal"></div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('smtpEncryption')}</label><select id="sys-smtp-secure"><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></select></div>
                                <div class="field"><label>${Lang.t('replyTo')}</label><input id="sys-smtp-replyto" type="email" placeholder="support@example.com"></div>
                            </div>
                            <div class="settings-section-title">${Icon('mail-check', 15)}Vorlage und Signatur</div>
                            <div class="field"><label>${Lang.t('emailTemplate')}</label><textarea id="sys-email-template" rows="4" placeholder="{{ticketTitle}}, {{status}}, {{message}}"></textarea></div>
                            <div class="field">
                                <label class="check-row">
                                    <input type="checkbox" id="sys-email-html-enabled">
                                    <span class="check-text"><strong>HTML-E-Mails aktivieren</strong><span>Benachrichtigungen mit HTML-Signatur und formatiertem Inhalt vorbereiten.</span></span>
                                </label>
                            </div>
                            <div class="field"><label>HTML-Signatur</label><textarea id="sys-email-html-signature" rows="6" placeholder="<p>Mit freundlichen Grüßen</p><strong>IT Service Desk</strong>"></textarea></div>
                            <div class="settings-section-title">${Icon('shield-check', 15)}Sicherheit und Zertifikate</div>
                            <div class="callout"><strong>E-Mail Sicherheit:</strong> Zertifikate und Schlüssel werden gespeichert und für Backend/SMTP-Integration bereitgestellt.</div>
                            <div class="form-grid">
                                <div class="field"><label>Transport-Sicherheit</label><select id="sys-email-tls-mode"><option value="starttls">STARTTLS erzwingen</option><option value="tls">TLS/SSL erzwingen</option><option value="opportunistic">Opportunistisch</option></select></div>
                                <div class="field"><label>Zertifikatsprüfung</label><select id="sys-email-cert-verify"><option value="strict">Strikt prüfen</option><option value="allow-self-signed">Self-signed erlauben</option><option value="disabled">Deaktiviert</option></select></div>
                            </div>
                            <div class="field"><label>S/MIME Zertifikat (PEM)</label><textarea id="sys-email-smime-cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
                            <div class="field"><label>S/MIME Private Key (PEM)</label><textarea id="sys-email-smime-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
                            <div class="form-grid">
                                <div class="field"><label>Key-Passphrase</label><input id="sys-email-smime-pass" type="password" placeholder="Optional"></div>
                                <div class="field"><label>DKIM Selector</label><input id="sys-email-dkim-selector" type="text" placeholder="default"></div>
                            </div>
                            <div class="field"><label>DKIM Domain</label><input id="sys-email-dkim-domain" type="text" placeholder="example.com"></div>
                            <div class="field"><label>DKIM Private Key (PEM)</label><textarea id="sys-email-dkim-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
                            <button class="btn-secondary btn-sm" id="sys-test-email">${Icon('send', 15)}${Lang.t('testEmail')}</button>
                        </div>

                        <!-- Benachrichtigungsregeln -->
                        <div id="sys-notify" class="tab-content">
                            <div class="settings-section-title">${Icon('bell-ring', 15)}${Lang.t('notifyRules')}</div>
                            <div class="checkbox-list">
                                <label class="check-row">
                                    <input type="checkbox" id="notif-new-ticket">
                                    <span class="check-text"><strong>${Lang.t('notifyNewTicket')}</strong><span>${Lang.t('notifyNewTicketDesc')}</span></span>
                                </label>
                                <label class="check-row">
                                    <input type="checkbox" id="notif-status-change">
                                    <span class="check-text"><strong>${Lang.t('notifyStatusChange')}</strong><span>${Lang.t('notifyStatusChangeDesc')}</span></span>
                                </label>
                                <label class="check-row">
                                    <input type="checkbox" id="notif-new-message">
                                    <span class="check-text"><strong>${Lang.t('notifyNewMessage')}</strong><span>${Lang.t('notifyNewMessageDesc')}</span></span>
                                </label>
                                <label class="check-row">
                                    <input type="checkbox" id="notif-ticket-closed">
                                    <span class="check-text"><strong>${Lang.t('notifyTicketClosed')}</strong><span>${Lang.t('notifyTicketClosedDesc')}</span></span>
                                </label>
                                <label class="check-row">
                                    <input type="checkbox" id="notif-account-approved">
                                    <span class="check-text"><strong>${Lang.t('notifyAccountApproved')}</strong><span>${Lang.t('notifyAccountApprovedDesc')}</span></span>
                                </label>
                            </div>
                        </div>

                        <!-- Sicherheit -->
                        <div id="sys-sec" class="tab-content">
                            <div class="field">
                                <label>${Lang.t('force2fa')}</label>
                                <select id="sys-2fa-enforce">
                                    <option value="none">${Lang.t('notForced')}</option>
                                    <option value="all">${Lang.t('allUsers')}</option>
                                    <option value="admin">${Lang.t('onlyAdmins')}</option>
                                    <option value="user">${Lang.t('onlyUsers')}</option>
                                </select>
                            </div>
                            <div class="field">
                                <label>${Lang.t('sessionTimeout')}</label>
                                <input id="sys-session-timeout" type="number" placeholder="0" min="0">
                            </div>
                            <div class="field">
                                <label>${Lang.t('maxLoginAttempts')}</label>
                                <input id="sys-max-login-attempts" type="number" placeholder="0" min="0">
                            </div>
                            <div class="hint">${Lang.t('securityHint')}</div>
                        </div>

                        <!-- LDAP -->
                        <div id="sys-ldap" class="tab-content">
                            <div class="field"><label>LDAP Host</label><input id="sys-ldap-host" type="text" placeholder="ldap.example.com"></div>
                            <div class="field"><label>Port</label><input id="sys-ldap-port" type="number" placeholder="389"></div>
                            <div class="field"><label>Base DN</label><input id="sys-ldap-base" type="text" placeholder="dc=example,dc=com"></div>
                            <div class="field"><label>Bind User DN</label><input id="sys-ldap-user" type="text" placeholder="cn=admin,dc=example,dc=com"></div>
                            <div class="hint">${Lang.t('ldapHint')}</div>
                        </div>

                        <!-- Outlook -->
                        <div id="sys-outlook" class="tab-content">
                            <div class="callout callout-success"><strong>${Lang.t('outlookIntegration')}:</strong> ${Lang.t('outlookHint')}</div>
                            <div class="field">
                                <label class="check-row">
                                    <input type="checkbox" id="outlook-enabled">
                                    <span class="check-text"><strong>${Lang.t('enableOutlook')}</strong><span>Microsoft-Graph-Werte speichern und für die Backend-Integration bereitstellen.</span></span>
                                </label>
                            </div>
                            <div class="field"><label>${Lang.t('graphTenant')}</label><input id="outlook-tenant" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
                            <div class="field"><label>${Lang.t('graphClient')}</label><input id="outlook-client" type="text" placeholder="App client id"></div>
                            <div class="field"><label>${Lang.t('graphMailbox')}</label><input id="outlook-mailbox" type="email" placeholder="support@example.com"></div>
                        </div>

                        <!-- Allgemein -->
                        <div id="sys-general" class="tab-content active">
                            <div class="field">
                                <label>${Lang.t('portalName')}</label>
                                <input id="sys-portal-name" type="text" placeholder="Support Portal">
                            </div>
                            <div class="field">
                                <label>${Lang.t('autoArchiveDays')}</label>
                                <input id="sys-auto-archive" type="number" placeholder="0" min="0">
                            </div>
                            <div class="field">
                                <label>${Lang.t('defaultPriority')}</label>
                                <select id="sys-default-prio">
                                    <option value="Normal">Normal</option>
                                    <option value="Hoch">Hoch</option>
                                    <option value="Niedrig">Niedrig</option>
                                </select>
                            </div>
                            <div class="field">
                                <label>${Lang.t('defaultCategories')}</label>
                                <input id="sys-default-cats" type="text" placeholder="Allgemein, Technik, Account, Abrechnung">
                            </div>
                        </div>

                        <!-- Unternehmenseinstellungen -->
                        <div id="sys-company" class="tab-content">
                            <div class="callout"><strong>Branding:</strong> Firmenangaben werden für Portal, E-Mail-Vorlagen und interne Darstellung vorbereitet.</div>
                            <div class="form-grid">
                                <div class="field"><label>Firmenname</label><input id="sys-company-name" type="text" placeholder="Muster GmbH"></div>
                                <div class="field"><label>Support-Abteilung</label><input id="sys-company-dept" type="text" placeholder="IT Service Desk"></div>
                            </div>
                            <div class="field">
                                <label>Firmenlogo URL</label>
                                <input id="sys-company-logo" type="url" placeholder="https://example.com/logo.png">
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>Support E-Mail</label><input id="sys-company-support-mail" type="email" placeholder="support@example.com"></div>
                                <div class="field"><label>Support Telefon</label><input id="sys-company-support-phone" type="text" placeholder="+49 123 456789"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>Standard-Zeitzone</label><input id="sys-company-timezone" type="text" placeholder="Europe/Berlin"></div>
                                <div class="field"><label>Standort / Region</label><input id="sys-company-location" type="text" placeholder="Deutschland"></div>
                            </div>
                            <div class="field"><label>Impressum / Datenschutz URL</label><input id="sys-company-legal" type="url" placeholder="https://example.com/impressum"></div>
                            <div class="field"><label>E-Mail Signatur</label><textarea id="sys-company-signature" rows="4" placeholder="Mit freundlichen Grüßen&#10;IT Service Desk"></textarea></div>
                            <div class="field"><label>HTML-E-Mail-Signatur</label><textarea id="sys-company-html-signature" rows="4" placeholder="<p>Mit freundlichen Grüßen</p><strong>IT Service Desk</strong>"></textarea></div>
                        </div>
                    </div>
                    </div>
                    <div class="modal-footer action-footer">
                        <button class="btn-secondary close-m footer-cancel">${Lang.t('closeSystemSettings')}</button>
                        <button class="btn-primary" id="sys-save">${Icon('save', 16)}${Lang.t('saveSettings')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#sys-save-head').onclick = () => q('#sys-save')?.click();

            // Tab Logic
            modal.querySelectorAll('.tab-btn').forEach(btn => {
                btn.onclick = () => {
                    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    q('#' + btn.dataset.tab).classList.add('active');
                    if (window.lucide) lucide.createIcons();
                };
            });

            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));

            // Test Email button
            q('#sys-test-email').onclick = async () => {
                const user = await Store.currentUser();
                if (!user.email) { UI.toast('Kein E-Mail im Profil hinterlegt'); return; }
                await Store.sendEmail(user.email, 'Test E-Mail vom Support Portal', 'Diese Test-E-Mail bestätigt, dass die SMTP-Konfiguration gespeichert ist.');
            };
        }

        const settings = await Store.getSettings();
        const email = settings.emailConfig || {};
        const sec = settings.securityConfig || {};
        const notif = settings.notifConfig || {};
        const general = settings.generalConfig || {};
        const outlook = settings.outlookConfig || {};
        const company = settings.companyConfig || {};

        q('#sys-smtp-host').value = email.host || '';
        q('#sys-smtp-port').value = email.port || '';
        q('#sys-smtp-user').value = email.user || '';
        q('#sys-smtp-pass').value = email.pass || '';
        q('#sys-smtp-from').value = email.from || '';
        q('#sys-smtp-fromname').value = email.fromName || '';
        q('#sys-smtp-secure').value = email.secure || 'starttls';
        q('#sys-smtp-replyto').value = email.replyTo || '';
        q('#sys-email-template').value = email.template || '';
        q('#sys-email-html-enabled').checked = !!email.htmlEnabled;
        q('#sys-email-html-signature').value = email.htmlSignature || '';
        q('#sys-email-tls-mode').value = email.security?.tlsMode || 'starttls';
        q('#sys-email-cert-verify').value = email.security?.certVerify || 'strict';
        q('#sys-email-smime-cert').value = email.security?.smimeCert || '';
        q('#sys-email-smime-key').value = email.security?.smimeKey || '';
        q('#sys-email-smime-pass').value = email.security?.smimePass || '';
        q('#sys-email-dkim-selector').value = email.security?.dkimSelector || '';
        q('#sys-email-dkim-domain').value = email.security?.dkimDomain || '';
        q('#sys-email-dkim-key').value = email.security?.dkimKey || '';

        q('#notif-new-ticket').checked = !!notif.newTicket;
        q('#notif-status-change').checked = !!notif.statusChange;
        q('#notif-new-message').checked = !!notif.newMessage;
        q('#notif-ticket-closed').checked = !!notif.ticketClosed;
        q('#notif-account-approved').checked = !!notif.accountApproved;

        q('#sys-2fa-enforce').value = sec.force2FA || 'none';
        q('#sys-session-timeout').value = sec.sessionTimeout || 0;
        q('#sys-max-login-attempts').value = sec.maxLoginAttempts || 0;

        const ldap = settings.ldapConfig || {};
        q('#sys-ldap-host').value = ldap.host || '';
        q('#sys-ldap-port').value = ldap.port || '';
        q('#sys-ldap-base').value = ldap.baseDn || '';
        q('#sys-ldap-user').value = ldap.userDn || '';

        q('#outlook-enabled').checked = !!outlook.enabled;
        q('#outlook-tenant').value = outlook.tenantId || '';
        q('#outlook-client').value = outlook.clientId || '';
        q('#outlook-mailbox').value = outlook.mailbox || '';

        q('#sys-portal-name').value = general.portalName || 'Support Portal';
        q('#sys-auto-archive').value = general.autoArchiveDays || 0;
        q('#sys-default-prio').value = general.defaultPrio || 'Normal';
        q('#sys-default-cats').value = (settings.categories || []).join(', ');

        q('#sys-company-name').value = company.name || '';
        q('#sys-company-dept').value = company.department || '';
        q('#sys-company-logo').value = company.logoUrl || '';
        q('#sys-company-support-mail').value = company.supportEmail || '';
        q('#sys-company-support-phone').value = company.supportPhone || '';
        q('#sys-company-timezone').value = company.timezone || 'Europe/Berlin';
        q('#sys-company-location').value = company.location || '';
        q('#sys-company-legal').value = company.legalUrl || '';
        q('#sys-company-signature').value = company.signature || '';
        q('#sys-company-html-signature').value = company.htmlSignature || email.htmlSignature || '';

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();

        q('#sys-save').onclick = async () => {
            const newSettings = await Store.getSettings();
            newSettings.emailConfig = {
                host: q('#sys-smtp-host').value.trim(),
                port: q('#sys-smtp-port').value.trim(),
                user: q('#sys-smtp-user').value.trim(),
                pass: q('#sys-smtp-pass').value.trim(),
                from: q('#sys-smtp-from').value.trim(),
                fromName: q('#sys-smtp-fromname').value.trim(),
                secure: q('#sys-smtp-secure').value,
                replyTo: q('#sys-smtp-replyto').value.trim(),
                template: q('#sys-email-template').value.trim(),
                htmlEnabled: q('#sys-email-html-enabled').checked,
                htmlSignature: q('#sys-email-html-signature').value.trim(),
                security: {
                    tlsMode: q('#sys-email-tls-mode').value,
                    certVerify: q('#sys-email-cert-verify').value,
                    smimeCert: q('#sys-email-smime-cert').value.trim(),
                    smimeKey: q('#sys-email-smime-key').value.trim(),
                    smimePass: q('#sys-email-smime-pass').value,
                    dkimSelector: q('#sys-email-dkim-selector').value.trim(),
                    dkimDomain: q('#sys-email-dkim-domain').value.trim(),
                    dkimKey: q('#sys-email-dkim-key').value.trim()
                }
            };
            newSettings.notifConfig = {
                newTicket: q('#notif-new-ticket').checked,
                statusChange: q('#notif-status-change').checked,
                newMessage: q('#notif-new-message').checked,
                ticketClosed: q('#notif-ticket-closed').checked,
                accountApproved: q('#notif-account-approved').checked,
            };
            newSettings.securityConfig = {
                force2FA: q('#sys-2fa-enforce').value,
                sessionTimeout: parseInt(q('#sys-session-timeout').value) || 0,
                maxLoginAttempts: parseInt(q('#sys-max-login-attempts').value) || 0,
            };
            newSettings.ldapConfig = {
                host: q('#sys-ldap-host').value.trim(),
                port: q('#sys-ldap-port').value.trim(),
                baseDn: q('#sys-ldap-base').value.trim(),
                userDn: q('#sys-ldap-user').value.trim()
            };
            newSettings.outlookConfig = {
                enabled: q('#outlook-enabled').checked,
                tenantId: q('#outlook-tenant').value.trim(),
                clientId: q('#outlook-client').value.trim(),
                mailbox: q('#outlook-mailbox').value.trim()
            };
            const catsRaw = q('#sys-default-cats').value;
            newSettings.categories = catsRaw.split(',').map(c => c.trim()).filter(Boolean);
            newSettings.generalConfig = {
                portalName: q('#sys-portal-name').value.trim() || 'Support Portal',
                autoArchiveDays: parseInt(q('#sys-auto-archive').value) || 0,
                defaultPrio: q('#sys-default-prio').value,
            };
            newSettings.companyConfig = {
                name: q('#sys-company-name').value.trim(),
                department: q('#sys-company-dept').value.trim(),
                logoUrl: q('#sys-company-logo').value.trim(),
                supportEmail: q('#sys-company-support-mail').value.trim(),
                supportPhone: q('#sys-company-support-phone').value.trim(),
                timezone: q('#sys-company-timezone').value.trim() || 'Europe/Berlin',
                location: q('#sys-company-location').value.trim(),
                legalUrl: q('#sys-company-legal').value.trim(),
                signature: q('#sys-company-signature').value.trim(),
                htmlSignature: q('#sys-company-html-signature').value.trim()
            };

            await Store.saveSettings(newSettings);
            Settings.apply(newSettings);
            await Store.runAutoArchive();
            if (q('.kanban-board')) await AdminBoard.render();
            if (q('#user-tickets')) await UserDash.renderList();
            modal.classList.remove('open');
            UI.toast(Lang.current === 'en' ? 'System settings saved' : 'Systemeinstellungen gespeichert');
            await Store.addGlobalLog('Systemeinstellungen gespeichert', `Geänderte Bereiche: Allgemein, Sicherheit, Benachrichtigungen, E-Mail, LDAP, Outlook, Unternehmen`);
        };
    },

    // ... existing openApproveModal ...
    renderArchive: async () => {
        const list = q('#archive-list');
        if (!list) return;

        const query = (q('#archive-search')?.value || '').toLowerCase().trim();
        let archived = (await Store.getTickets()).filter(t => t.archived);

        if (query) {
            archived = archived.filter(t => Utils.matchesSearch(query, t));
        }

        archived.sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));

        list.innerHTML = '';
        if (archived.length === 0) {
            list.innerHTML = `<div class="empty-state">${query ? 'Keine Treffer im Archiv' : 'Keine archivierten Tickets'}</div>`;
            return;
        }
        list.innerHTML = `
            <div class="table-head archive-grid">
                <div></div><div>Titel</div><div>Status</div><div>Erstellt</div><div>Archiviert</div><div>Benutzer</div>
            </div>`;
        archived.forEach(t => {
            const el = document.createElement('div');
            el.className = 'table-row archive-grid archive-ticket-row';
            const cats = (Array.isArray(t.category) ? t.category : [t.category || '-']).map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('');

            el.innerHTML = `
                <span class="status-dot" style="--dot:${getStatusColor(t.status)}"></span>
                <div class="ticket-row-main">
                    <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.title)}</div>
                    <div class="ticket-row-cats">${cats}</div>
                </div>
                <div><span class="status-badge">${Lang.status(t.status)}</span></div>
                <div class="date">${Utils.fmtDate(t.createdAt)}</div>
                <div class="date">${t.archivedAt ? Utils.fmtDate(t.archivedAt) : '-'}</div>
                <div class="row-sub">${Utils.esc(t.authorName || t.author || '-')}</div>
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
            list.innerHTML = '<div class="empty-state compact">Keine offenen Anfragen</div>';
            return;
        }
        reqs.forEach(r => {
            const el = document.createElement('div');
            el.className = 'ticket-card request-card';
            el.innerHTML = `
                <div class="req-name">${Utils.esc(r.name)}</div>
                <div class="req-mail">${Utils.esc(r.email)}</div>
                <div class="req-actions">
                    <button class="btn-primary btn-sm req-accept">${Icon('check', 15)}Annehmen</button>
                    <button class="btn-secondary btn-sm req-decline">${Icon('x', 15)}Ablehnen</button>
                </div>
            `;
            el.querySelector('.req-accept').onclick = () => AdminBoard.openApproveModal(r);
            el.querySelector('.req-decline').onclick = () => {
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
        if (window.lucide) lucide.createIcons();
    },

    setupDrag: () => {
        qa('.ticket-list').forEach(zone => {
            zone.addEventListener('dragover', e => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });
            zone.addEventListener('drop', async e => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const id = e.dataTransfer.getData('text/plain');
                const newStatus = zone.dataset.status;
                const tickets = await Store.getTickets();
                const t = tickets.find(x => x.id === id);
                if (t && t.status !== newStatus) {
                    await Store.addLog(t, `Status geändert von ${t.status} zu ${newStatus}`);
                    t.status = newStatus;
                    await Store.saveTickets(tickets);

                    // Email Notification (respects notifConfig)
                    const s = await Store.getSettings();
                    if (s.notifConfig?.statusChange && s.emailConfig?.host) {
                        // Notify Author
                        const users = await Store.getUsers();
                        const author = users.find(u => u.username === t.author);
                        if (author && author.email) {
                            Store.sendEmail(author.email, `Ticket Update: ${t.title}`, `Status geändert auf: ${newStatus}`);
                        }
                    }
                    if (newStatus === 'Geschlossen' && s.notifConfig?.ticketClosed && s.emailConfig?.host) {
                        const users = await Store.getUsers();
                        const author = users.find(u => u.username === t.author);
                        if (author && author.email) {
                            Store.sendEmail(author.email, `Ticket geschlossen: ${t.title}`, `Dein Ticket wurde geschlossen. Du kannst den Verlauf weiterhin im Portal einsehen.`);
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

    ensureResponsibilitySection: async (t, users, tickets) => {
        const details = q('#tab-details');
        if (!details) return;

        const staff = users.filter(u => u.role === 'admin' || u.role === 'superadmin');
        if (!Array.isArray(t.assignees)) t.assignees = t.assignee ? [t.assignee] : [];
        if (!Array.isArray(t.participants)) t.participants = [...t.assignees];
        if (!Array.isArray(t.todos)) t.todos = [];
        if (!t.owner && t.assignees.length) t.owner = t.assignees[0];

        q('#ticket-responsibility')?.remove();
        const section = document.createElement('div');
        section.id = 'ticket-responsibility';
        section.className = 'responsibility-section';
        section.innerHTML = `
            <div class="section-title">${Icon('user-check', 15)} Zuständigkeiten</div>
            <div class="responsibility-grid">
                <div class="field">
                    <label>Hauptverantwortlicher</label>
                    <select id="m-owner-select">
                        <option value="">Nicht zugewiesen</option>
                        ${staff.map(u => `<option value="${u.username}">${u.name || u.username}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label>Beteiligte Personen</label>
                    <div id="participants-multi" class="multi-select-container"></div>
                </div>
            </div>
            <div class="ticket-todo-panel">
                <div class="section-title">${Icon('list-checks', 15)} Teilaufgaben</div>
                <div id="ticket-todos" class="ticket-todos"></div>
                <div class="todo-create-row">
                    <input id="todo-title" type="text" placeholder="Neue Teilaufgabe">
                    <select id="todo-assignee">
                        <option value="">Ohne Zuweisung</option>
                        ${staff.map(u => `<option value="${u.username}">${u.name || u.username}</option>`).join('')}
                    </select>
                    <button class="btn-primary" id="todo-add" type="button">${Icon('plus', 16)}Hinzufügen</button>
                </div>
            </div>
        `;
        const commentsSection = details.querySelector('.comments-section');
        if (commentsSection) commentsSection.before(section);
        else details.appendChild(section);

        const ownerSelect = q('#m-owner-select');
        ownerSelect.value = t.owner || '';
        ownerSelect.disabled = !!t.archived;
        ownerSelect.onchange = async () => {
            const old = t.owner || 'Nicht zugewiesen';
            t.owner = ownerSelect.value;
            t.participants = (t.participants || []).filter(username => username !== t.owner);
            t.assignees = [...t.participants];
            await Store.addLog(t, 'Hauptverantwortlicher geändert', `Alt: ${old} -> Neu: ${t.owner || 'Nicht zugewiesen'}`);
            await Store.saveTickets(tickets);
            await AdminBoard.ensureResponsibilitySection(t, users, tickets);
            await AdminBoard.render();
        };

        const participantsMulti = q('#participants-multi');
        const participantOptions = staff
            .filter(u => u.username !== t.owner)
            .map(u => ({ value: u.username, label: u.name || u.username }));
        const participantValues = (t.participants || []).filter(username => username !== t.owner);
        t.participants = participantValues;
        UI.createMultiSelect(participantsMulti, participantOptions, participantValues, async (newParticipants) => {
            t.participants = newParticipants.filter(username => username !== t.owner);
            t.assignees = [...t.participants];
            const names = newParticipants.map(username => {
                const found = staff.find(u => u.username === username);
                return found ? (found.name || found.username) : username;
            }).join(', ') || 'Niemand';
            await Store.addLog(t, 'Beteiligte Personen geändert', `Neu: ${names}`);
            await Store.saveTickets(tickets);
            await AdminBoard.render();
        });
        participantsMulti.classList.toggle('is-disabled', !!t.archived);

        AdminBoard.renderTicketTodos(t, staff, tickets);
        if (window.lucide) lucide.createIcons();
    },

    renderTicketTodos: (t, users, tickets) => {
        const list = q('#ticket-todos');
        const addBtn = q('#todo-add');
        const titleInput = q('#todo-title');
        const assigneeSelect = q('#todo-assignee');
        if (!list || !addBtn || !titleInput || !assigneeSelect) return;

        const getName = (username) => {
            const found = users.find(u => u.username === username);
            return found ? (found.name || found.username) : username;
        };
        const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));

        list.innerHTML = t.todos.length ? t.todos.map(todo => `
            <div class="ticket-todo ${todo.done ? 'done' : ''}" data-id="${todo.id}">
                <label>
                    <input type="checkbox" ${todo.done ? 'checked' : ''} ${t.archived ? 'disabled' : ''}>
                    <span>${esc(todo.title)}</span>
                </label>
                <div class="todo-meta">
                    ${todo.assignee ? `<span class="badge">${Icon('user-round', 12)}${esc(getName(todo.assignee))}</span>` : '<span class="badge">Nicht zugewiesen</span>'}
                    <button class="btn-ghost btn-icon btn-sm btn-danger todo-delete" title="Teilaufgabe löschen" aria-label="Teilaufgabe löschen" ${t.archived ? 'disabled' : ''}>${Icon('trash-2', 15)}</button>
                </div>
            </div>
        `).join('') : '<div class="empty-state compact">Noch keine Teilaufgaben.</div>';

        list.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.onchange = async () => {
                const row = chk.closest('.ticket-todo');
                const todo = t.todos.find(x => x.id === row.dataset.id);
                if (!todo) return;
                todo.done = chk.checked;
                await Store.addLog(t, `Teilaufgabe ${todo.done ? 'erledigt' : 'wieder geöffnet'}`, todo.title);
                await Store.saveTickets(tickets);
                AdminBoard.renderTicketTodos(t, users, tickets);
            };
        });

        list.querySelectorAll('.todo-delete').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.ticket-todo');
                const todo = t.todos.find(x => x.id === row.dataset.id);
                t.todos = t.todos.filter(x => x.id !== row.dataset.id);
                await Store.addLog(t, 'Teilaufgabe gelöscht', todo?.title || '');
                await Store.saveTickets(tickets);
                AdminBoard.renderTicketTodos(t, users, tickets);
            };
        });

        titleInput.disabled = !!t.archived;
        assigneeSelect.disabled = !!t.archived;
        addBtn.disabled = !!t.archived;
        addBtn.onclick = async () => {
            const title = titleInput.value.trim();
            if (!title) return;
            const todo = {
                id: Utils.uid(),
                title,
                assignee: assigneeSelect.value,
                done: false
            };
            t.todos.push(todo);
            await Store.addLog(t, 'Teilaufgabe hinzugefügt', `${title}${todo.assignee ? ` -> ${getName(todo.assignee)}` : ''}`);
            await Store.saveTickets(tickets);
            titleInput.value = '';
            assigneeSelect.value = '';
            AdminBoard.renderTicketTodos(t, users, tickets);
        };
        if (window.lucide) lucide.createIcons();
    },

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
                btnReact.innerHTML = `${Icon('rotate-ccw', 16)}Reaktivieren`;
                btnArch.parentElement.appendChild(btnReact);
            }

            if (t.archived) {
                if (btnArch) btnArch.style.display = 'none';
                if (btnReact) {
                    btnReact.style.display = isSuper ? 'inline-flex' : 'none';
                    btnReact.onclick = () => AdminBoard.reactivateTicket(t.id);
                }
            } else {
                if (btnReact) btnReact.style.display = 'none';
                if (btnArch) {
                    btnArch.style.display = (t.status === 'Geschlossen') ? 'inline-flex' : 'none';
                    btnArch.onclick = () => AdminBoard.archiveCurrent();
                }
            }

            // Disable edits if archived
            if (prioSel) prioSel.disabled = t.archived;
            if (catSel) catSel.disabled = t.archived;
            if (commentInput) commentInput.disabled = t.archived;
            if (commentBtn) commentBtn.disabled = t.archived;
            ['#m-note-type', '#m-note-bold', '#m-note-italic', '#m-note-list', '#m-note-file-input', '#m-note-pin', '#m-note-resolution'].forEach(selector => {
                const el = q(selector);
                if (el) el.disabled = t.archived;
            });
            if (chatInput) chatInput.disabled = t.archived;
            if (chatSend) chatSend.disabled = t.archived;

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

                msContainer.classList.toggle('is-disabled', !!t.archived);
            }

            // Reset Tabs
            q('.tab-btn[data-tab="details"]').click();

            // History Sidebar refresh if already open
            const sidebar = q('#m-history-sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                await AdminBoard.renderHistory(t.author, id);
            }

            // --- Multi-Select Assignment ---
            const allUsers = await Store.getUsers();

            await AdminBoard.ensureResponsibilitySection(t, allUsers, tickets);

            AdminBoard.noteFiles = [];
            AdminBoard.renderNoteFilePreview();
            AdminBoard.renderInternalComments(t);
            await AdminBoard.renderChat(t, '#m-chat-msgs');

            if (btnLogs) btnLogs.onclick = () => UI.showLogs(t.id);

            // History Toggle
            const authorEl = q('#m-author');
            if (authorEl) {
                authorEl.classList.add('link');
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
                    <div class="sidebar-title-row">
                        <span class="panel-title">${Icon('history', 16)}Ticket-Historie</span>
                        <button class="btn-ghost btn-icon" id="m-history-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                    <div class="history-search-wrap">
                        <input type="text" id="m-history-search" class="history-search-input" placeholder="Historie durchsuchen...">
                        <span class="history-search-icon">${Icon('search', 14)}</span>
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
            if (window.lucide) lucide.createIcons();
        }

        const content = sidebar.querySelector('.sidebar-content');
        if (!content) return;

        const query = searchInput.value.toLowerCase();
        content.innerHTML = '';

        const tickets = (await Store.getTickets())
            .filter(x => x.author === username)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const filtered = tickets.filter(t => Utils.matchesSearch(query, t));

        if (filtered.length === 0) {
            content.innerHTML = `<div class="empty-state">${query ? 'Keine Treffer' : 'Keine Historie vorhanden'}</div>`;
            return;
        }

        filtered.forEach(ticket => {
            const card = document.createElement('div');
            card.className = 'history-card' + (ticket.id === currentId ? ' active' : '') + (ticket.archived ? ' archived' : '');

            const isActive = !ticket.archived && ticket.status !== 'Geschlossen';

            card.innerHTML = `
                <div class="history-title">${Utils.esc(ticket.title)}</div>
                <div class="history-meta">
                    <span>${Utils.fmtDate(ticket.createdAt).split(' ')[0]}</span>
                    <span>${Lang.status(ticket.status)}</span>
                </div>
                ${isActive ? `<span class="history-badge">Aktiv</span>` : ''}
            `;

            card.onclick = () => AdminBoard.openModal(ticket.id);
            content.appendChild(card);
        });
        if (window.lucide) lucide.createIcons();
    },

    renderInternalComments: (t) => {
        const box = q('#m-comments');
        if (!box) return;
        box.innerHTML = '';
        const searchWrap = q('#m-note-search-wrap');
        const searchInput = q('#m-note-search');
        const commentsRaw = t.comments || [];
        if (searchWrap) searchWrap.style.display = commentsRaw.length >= 6 ? 'flex' : 'none';
        if (commentsRaw.length < 6 && searchInput) searchInput.value = '';
        if (!t.comments || t.comments.length === 0) {
            box.innerHTML = '<div class="empty-state compact">Noch keine internen Arbeitsschritte dokumentiert.</div>';
            return;
        }
        const renderText = (value = '') => Utils.esc(value)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^- (.*)$/gm, '<div class="note-bullet">$1</div>');
        const query = (searchInput?.value || '').toLowerCase().trim();
        const comments = [...t.comments]
            .map((comment, index) => ({ ...comment, index }))
            .filter(c => !query || [
                c.text,
                c.author,
                c.type,
                Utils.fmtDate(c.date),
                ...(c.files || []).map(f => f.name)
            ].join(' ').toLowerCase().includes(query))
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || new Date(a.date) - new Date(b.date));
        if (comments.length === 0) {
            box.innerHTML = '<div class="empty-state compact">Keine passenden internen Kommentare gefunden.</div>';
            return;
        }
        comments.forEach(c => {
            const div = document.createElement('div');
            div.className = `note-item ${c.pinned ? 'is-pinned' : ''} ${c.resolution ? 'is-resolution' : ''}`;
            div.dataset.index = c.index;
            div.innerHTML = `
                <div class="note-meta">
                    <div class="note-author">
                        ${c.pinned ? Icon('pin', 13) : ''}
                        <strong>${Utils.esc(c.author)}</strong>
                        <span class="note-type">${Utils.esc(c.type || 'Notiz')}</span>
                        ${c.resolution ? `<span class="note-type note-resolution">${Icon('check-circle', 12)}Lösung</span>` : ''}
                    </div>
                    <div class="note-actions">
                        <span>${Utils.fmtDate(c.date)}</span>
                        <button class="btn-ghost btn-icon btn-xs note-edit" title="Kommentar bearbeiten" aria-label="Kommentar bearbeiten">${Icon('pencil', 13)}</button>
                    </div>
                </div>
                <div class="note-body">${renderText(c.text)}</div>
                ${(c.files || []).length ? `
                    <div class="note-attachments">
                        ${c.files.map(f => f.data
                            ? `<a class="file-chip" href="${f.data}" download="${Utils.esc(f.name)}">${Icon('paperclip', 12)}<span>${Utils.esc(f.name)}</span></a>`
                            : `<button type="button" class="file-chip note-attachment-download" data-attachment-id="${Utils.esc(f.id || f.attachmentId)}">${Icon('paperclip', 12)}<span>${Utils.esc(f.name)}</span></button>`
                        ).join('')}
                    </div>
                ` : ''}
            `;
            div.querySelector('.note-edit')?.addEventListener('click', () => AdminBoard.editInternalComment(Number(div.dataset.index)));
            div.querySelectorAll('.note-attachment-download').forEach(btn => {
                btn.onclick = () => Store.downloadAttachment(btn.dataset.attachmentId);
            });
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
        if (window.lucide) lucide.createIcons();
    },

    renderNoteFilePreview: () => {
        const pan = q('#m-note-file-preview');
        if (!pan) return;
        pan.innerHTML = '';
        pan.style.display = AdminBoard.noteFiles.length ? 'flex' : 'none';
        AdminBoard.noteFiles.forEach((f, idx) => {
            const tag = document.createElement('div');
            tag.className = 'file-chip';
            tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
            tag.querySelector('button').onclick = () => {
                AdminBoard.noteFiles.splice(idx, 1);
                AdminBoard.renderNoteFilePreview();
            };
            pan.appendChild(tag);
        });
        if (window.lucide) lucide.createIcons();
    },

    editInternalComment: async (index) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
        const note = t?.comments?.[index];
        if (!note) return;
        q('#m-new-comment').value = note.text || '';
        if (q('#m-note-type')) q('#m-note-type').value = note.type || 'Analyse';
        if (q('#m-note-pin')) q('#m-note-pin').checked = !!note.pinned;
        if (q('#m-note-resolution')) q('#m-note-resolution').checked = !!note.resolution;
        const saveBtn = q('#btn-add-comment');
        if (saveBtn) {
            saveBtn.dataset.editIndex = String(index);
            saveBtn.innerHTML = `${Icon('save', 16)}Eintrag aktualisieren`;
        }
        q('#m-new-comment').focus();
        if (window.lucide) lucide.createIcons();
    },

    postInternalComment: async () => {
        const input = q('#m-new-comment');
        const txt = input.value.trim();
        const filesToUpload = [...AdminBoard.noteFiles];
        const saveBtn = q('#btn-add-comment');
        const editIndex = saveBtn?.dataset.editIndex;
        const isEditing = editIndex !== undefined && editIndex !== '';
        if (!txt && filesToUpload.length === 0) return;
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
        if (!t) return;

        const user = await Store.currentUser();
        if (!t.comments) t.comments = [];
        const note = {
            text: txt,
            author: user.name || user.username,
            date: Utils.nowISO(),
            type: q('#m-note-type')?.value || 'Notiz',
            pinned: !!q('#m-note-pin')?.checked,
            resolution: !!q('#m-note-resolution')?.checked,
            files: []
        };
        if (filesToUpload.length) {
            try {
                note.files = await Promise.all(filesToUpload.map(f => Store.saveAttachment(f)));
            } catch (e) {
                console.error(e);
                UI.toast(e.message === 'ATTACHMENT_TOO_LARGE' ? 'Anhang ist zu groß (max. 15 MB).' : 'Fehler beim Dateiladen');
                return;
            }
        }
        if (isEditing) {
            const existing = t.comments[Number(editIndex)];
            if (!existing) return;
            existing.text = note.text;
            existing.type = note.type;
            existing.pinned = note.pinned;
            existing.resolution = note.resolution;
            existing.editedAt = Utils.nowISO();
            existing.editedBy = user.name || user.username;
            if (note.files.length) existing.files = [...(existing.files || []), ...note.files];
            await Store.addLog(t, 'Interne Notiz bearbeitet', txt);
        } else {
            t.comments.push(note);
            await Store.addLog(t, 'Interne Notiz hinzugefügt', txt);
        }
        await Store.saveTickets(tickets);
        await Store.addGlobalLog(isEditing ? 'Interne Notiz bearbeitet' : 'Interne Notiz hinzugefügt', `Ticket: ${t.title}\nNotiz: ${txt.substring(0, 100)}${txt.length > 100 ? '...' : ''}`);
        input.value = '';
        AdminBoard.noteFiles = [];
        if (saveBtn) {
            delete saveBtn.dataset.editIndex;
            saveBtn.innerHTML = `${Icon('plus', 16)}Eintrag speichern`;
        }
        if (q('#m-note-pin')) q('#m-note-pin').checked = false;
        if (q('#m-note-resolution')) q('#m-note-resolution').checked = false;
        AdminBoard.renderNoteFilePreview();
        AdminBoard.renderInternalComments(t);
        await AdminBoard.render();
    },

    renderChat: async (ticket, containerSelector) => {
        const box = q(containerSelector);
        if (!box) return;
        box.innerHTML = '';

        const msgs = ticket.chat || []; // Now using 'chat' field

        if (msgs.length === 0) {
            box.innerHTML = '<div class="empty-state">Keine Nachrichten</div>';
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
                        fileHtml += `<a href="${f.data}" download="${Utils.esc(f.name)}" class="msg-file">${Icon('paperclip', 13)}${Utils.esc(f.name)}</a>`;
                    }
                });
            } else if (m.file) { // Legacy single file
                if (m.file.type.startsWith('image/')) {
                    fileHtml = `<img src="${m.file.data}" class="msg-img" onclick="window.open(this.src)">`;
                } else {
                    fileHtml = `<a href="${m.file.data}" download="${Utils.esc(m.file.name)}" class="msg-file">${Icon('paperclip', 13)}${Utils.esc(m.file.name)}</a>`;
                }
            }

            // Format text: **bold**, *italic* (Text vorher maskieren)
            let htmlText = Utils.esc(m.text)
                .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                .replace(/\*(.*?)\*/g, '<i>$1</i>')
                .replace(/\n/g, '<br>');

            el.innerHTML = `
                <div class="msg-meta">
                    <span>${Utils.esc(m.author)}</span>
                    <span>${Utils.fmtDate(m.date)}</span>
                </div>
                ${htmlText}
                ${fileHtml}
            `;
            box.appendChild(el);
        });
        box.scrollTop = box.scrollHeight;
        if (window.lucide) lucide.createIcons();
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

        const settings = await Store.getSettings();
        if (settings.notifConfig?.newMessage && settings.emailConfig?.host) {
            const users = await Store.getUsers();
            const recipients = new Map();
            const author = users.find(u => u.username === t.author);
            if (author?.email && user.username !== t.author) recipients.set(author.email, author);

            if (role === 'user') {
                users
                    .filter(u => u.role === 'admin' || u.role === 'superadmin')
                    .forEach(admin => {
                        if (admin.email) recipients.set(admin.email, admin);
                    });
            } else if (t.assignees?.length) {
                t.assignees.forEach(username => {
                    const assigned = users.find(u => u.username === username);
                    if (assigned?.email && assigned.username !== user.username) recipients.set(assigned.email, assigned);
                });
            }

            recipients.forEach((recipient, email) => {
                Store.sendEmail(email, `Neue Nachricht: ${t.title}`, `${user.name || user.username}: ${txt || 'Dateianhang'}`);
            });
        }

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
    await Lang.init();
    // Display Current User
    const currentUser = await Store.currentUser();
    if (currentUser && q('#user-display')) {
        q('#user-display').textContent = `${Lang.t('loggedInAs')}: ${currentUser.name || currentUser.username}`;
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
            btn.className = 'btn-primary btn-icon btn-scroll-to-top';
            btn.innerHTML = Icon('arrow-up', 18);
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
        try { isOpen = sel.matches(':open'); } catch { }
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



