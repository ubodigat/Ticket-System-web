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
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } [c])),
    fmtDate: (iso) => {
        if (!iso) return '-';
        const d = new Date(iso);
        const locale = (typeof Lang !== 'undefined' && Lang.current === 'en') ? 'en-GB' : 'de-DE';
        return d.toLocaleDateString(locale, {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit'
            }) +
            ' ' + d.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit'
            });
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
    formatRichText: (value = '') => {
        let html = Utils.esc(value);
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, (match, label, href) =>
            `<a href="${Utils.esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        );
        return html
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
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
        const r = ((n >> 16) & 255) / 255,
            g = ((n >> 8) & 255) / 255,
            b = (n & 255) / 255;
        const max = Math.max(r, g, b),
            min = Math.min(r, g, b),
            d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return {
            h,
            s: max ? d / max : 0,
            v: max
        };
    },
    hsvToHex: ({
        h,
        s,
        v
    }) => {
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
    },
    fmtDateOnly: (value) => {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    },
    fmtTimeOnly: (value) => {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    parseGermanDateTime: (dateValue, timeValue = '00:00') => {
        const match = String(dateValue || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        const time = String(timeValue || '').trim().match(/^(\d{2}):(\d{2})$/);
        if (!match || !time) return null;
        const [, dd, mm, yyyy] = match.map(Number);
        const [, hh, min] = time.map(Number);
        const d = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
        if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd || d.getHours() !== hh || d.getMinutes() !== min) return null;
        return d.getTime();
    }
};

// --- i18n ---
const Lang = {
    translations: {
        de: {
            login: 'Einloggen',
            logout: 'Abmelden',
            dashboard: 'Dashboard',
            newTicket: 'Neues Ticket',
            myTickets: 'Meine Tickets',
            subject: 'Betreff',
            description: 'Beschreibung',
            priority: 'Priorität',
            category: 'Kategorie',
            submit: 'Absenden',
            status: 'Status',
            date: 'Datum',
            prio: 'Prio',
            archived: 'Archiviert',
            assignee: 'Bearbeiter',
            close: 'Schließen',
            save: 'Speichern',
            cancel: 'Abbrechen',
            delete: 'Löschen',
            edit: 'Bearbeiten',
            search: 'Suchen...',
            noTickets: 'Keine Tickets gefunden',
            ticketCreated: 'Ticket erstellt!',
            titleRequired: 'Bitte Titel angeben',
            loadMore: 'Weitere laden',
            showArchived: 'Archiviert einblenden',
            normal: 'Normal',
            high: 'Hoch',
            critical: 'Kritisch',
            low: 'Niedrig',
            statusNew: 'Neu',
            statusDoing: 'In Bearbeitung',
            statusClosed: 'Geschlossen',
            systemLogs: 'System-Logs',
            archive: 'Archiv',
            settings: 'Einstellungen',
            userMgmt: 'Benutzerverwaltung',
            confirm: 'Bestätigung',
            yes: 'Bestätigen',
            no: 'Abbrechen',
        },
        en: {
            login: 'Login',
            logout: 'Logout',
            dashboard: 'Dashboard',
            newTicket: 'New Ticket',
            myTickets: 'My Tickets',
            subject: 'Subject',
            description: 'Description',
            priority: 'Priority',
            category: 'Category',
            submit: 'Submit',
            status: 'Status',
            date: 'Date',
            prio: 'Priority',
            archived: 'Archived',
            assignee: 'Assigned To',
            close: 'Close',
            save: 'Save',
            cancel: 'Cancel',
            delete: 'Delete',
            edit: 'Edit',
            search: 'Search...',
            noTickets: 'No tickets found',
            ticketCreated: 'Ticket created!',
            titleRequired: 'Please enter a title',
            loadMore: 'Load more',
            showArchived: 'Show archived',
            normal: 'Normal',
            high: 'High',
            critical: 'Critical',
            low: 'Low',
            statusNew: 'New',
            statusDoing: 'In Progress',
            statusClosed: 'Closed',
            systemLogs: 'System Logs',
            archive: 'Archive',
            settings: 'Settings',
            userMgmt: 'User Management',
            confirm: 'Confirmation',
            yes: 'Confirm',
            no: 'Cancel',
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
        setHTML('#btn-list-view', q('#list-view')?.style.display === 'block'
            ? `${Icon('layout-grid', 16)}${Lang.t('board')}`
            : `${Icon('table-properties', 16)}${Lang.t('list')}`);
        setHTML('#btn-admin-create-ticket', `${Icon('plus', 16)}${Lang.t('newTicket')}`);
        setHTML('#btn-admin-create-incident', `${Icon('siren', 16)}${Lang.t('createIncident')}`);
        const adminSearchLabel = q('label[for="admin-ticket-search"]');
        if (adminSearchLabel) adminSearchLabel.textContent = Lang.t('searchTickets');
        const adminTicketSearch = q('#admin-ticket-search');
        if (adminTicketSearch) adminTicketSearch.placeholder = Lang.t('ticketSearchPlaceholder');
        const notifBtn = q('#btn-notifications');
        if (notifBtn) {
            notifBtn.title = Lang.t('notifications');
            notifBtn.setAttribute('aria-label', Lang.t('notifications'));
        }
        setHTML('#archive-view .archive-header h3', `${Icon('archive', 18)}${Lang.t('archivedTickets')}`);
        setHTML('#btn-back-kanban', `${Icon('arrow-left', 16)}${Lang.t('backToOverview')}`);
        const archiveSearch = q('#archive-search');
        if (archiveSearch) archiveSearch.placeholder = Lang.current === 'en' ? 'Search archive (title, author, content)...' : 'Suche im Archiv (Titel, Autor, Inhalt)...';
        setText('#requests-board .request-banner-title', Lang.t('requests'));
        setText('#overdue-board .request-banner-title', Lang.t('overdue'));
        const requestCount = q('#request-count')?.parentElement;
        if (requestCount) requestCount.innerHTML = `<b id="request-count">${q('#request-count')?.textContent || '0'}</b> ${Lang.t('open')}`;
        const overdueCount = q('#overdue-ticket-count')?.parentElement;
        if (overdueCount) overdueCount.innerHTML = `<b id="overdue-ticket-count" class="overdue-count">${q('#overdue-ticket-count')?.textContent || '0'}</b> ${Lang.t('tickets')}`;
        setHTML('#requests-modal-title', `${Icon('user-round-plus', 18)}${Lang.t('requests')}`);
        setHTML('#col-new .col-header span:first-child', `${Icon('inbox', 16)}${Lang.t('statusNew')}`);
        setHTML('#col-doing .col-header span:first-child', `${Icon('loader', 16)}${Lang.t('statusDoing')}`);
        setHTML('#col-waiting .col-header span:first-child', `${Icon('pause-circle', 16)}${Lang.t('statusWaiting')}`);
        setHTML('#col-done .col-header span:first-child', `${Icon('check-circle', 16)}${Lang.t('statusClosed')}`);
        setText('#ticket-modal .tab-btn[data-tab="details"]', Lang.t('details'));
        setText('#ticket-modal .tab-btn[data-tab="chat"]', Lang.t('chat'));
        setText('#ticket-modal .tab-btn[data-tab="internal"]', Lang.current === 'en' ? 'Internal communication' : 'Interne Kommunikation');
        const setMetaLabel = (fieldSelector, text) => {
            const label = q(fieldSelector)?.closest('.meta-item')?.querySelector('strong');
            if (label) label.textContent = text;
        };
        setMetaLabel('#m-author', Lang.t('from'));
        setMetaLabel('#m-date', Lang.t('date'));
        setMetaLabel('#m-status-edit', Lang.t('status'));
        setMetaLabel('#m-prio-edit', Lang.t('prio'));
        setMetaLabel('#m-cat-container', Lang.t('category'));
        const waitingLabels = {
            'Warten auf Benutzer': 'Waiting for user',
            'Warten auf externen Dienstleister': 'Waiting for external provider',
            'Warten auf interne Rückmeldung': 'Waiting for internal feedback'
        };
        if (Lang.current === 'en') Object.entries(waitingLabels).forEach(([value, text]) => {
            const option = q(`#m-status-edit option[value="${value}"]`);
            if (option) option.textContent = text;
        });
        const descHead = q('#tab-details h4');
        if (descHead) descHead.textContent = Lang.t('description');
        const assignLabel = q('#assignee-multi')?.closest('.field')?.querySelector('label');
        if (assignLabel) assignLabel.textContent = `${Lang.t('assignTo')} (${Lang.t('multipleSelection')})`;
        const notesHead = q('.comments-section h4');
        if (notesHead) notesHead.textContent = Lang.current === 'en' ? 'Internal communication' : 'Interne Kommunikation';
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
    possible: 'möglich',
    list: 'Liste',
    board: 'Board',
    switchToBoard: 'Zur Kanban-Übersicht wechseln',
    switchToList: 'Zur Listenansicht wechseln',
    searchTickets: 'Tickets durchsuchen',
    ticketSearchPlaceholder: 'Titel, Beschreibung, Benutzer oder Ticket-ID...',
    overdue: 'Überfällig',
    open: 'offen',
    tickets: 'Tickets',
    statusWaiting: 'Wartet',
    replyPending: 'Antwort ausstehend',
    majorIncident: 'Großstörung',
    linked: 'Verknüpft',
    stillDue: 'Noch {time}',
    dueIn: 'Fällig in ',
    overdueSince: 'Überfällig seit {time}',
    dayShort: 'Tg.',
    hourShort: 'Std.',
    minuteShort: 'Min.',
    messages: 'Nachrichten',
    internalNotesShort: 'Interne Notizen',
    markAllRead: 'Alle als gelesen markieren',
    deleteAllNotifications: 'Alle Benachrichtigungen löschen',
    deleteNotification: 'Benachrichtigung löschen',
    noNotifications: 'Keine Benachrichtigungen',
    confirmDeleteNotifications: 'Alle Benachrichtigungen löschen?',
    createIncident: 'Störung erstellen',
    incident: 'Störung',
    knownIncident: 'Bekannte Störung',
    assignTicketToIncident: 'Ticket einer Störung zuordnen',
    noIncidentAssignment: 'Keine Zuordnung',
    activeKnownIncidents: '{count} bekannte Störungen aktiv. Bitte auswählen, falls dein Ticket dazugehört.',
    linkedTickets: 'Zugeordnete Tickets',
    incidentNotice: 'Für Benutzer sichtbarer Hinweis',
    incidentTitle: 'Titel der Störung',
    dueDate: 'Frist',
    dateFormatLabel: 'Datum (dd.mm.jjjj)',
    time: 'Uhrzeit'
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
    possible: 'available',
    list: 'List',
    board: 'Board',
    switchToBoard: 'Switch to Kanban board',
    switchToList: 'Switch to list view',
    searchTickets: 'Search tickets',
    ticketSearchPlaceholder: 'Title, description, user or ticket ID...',
    overdue: 'Overdue',
    open: 'open',
    tickets: 'Tickets',
    statusWaiting: 'Waiting',
    replyPending: 'Reply pending',
    majorIncident: 'Major incident',
    linked: 'Linked',
    stillDue: '{time} left',
    dueIn: 'Due in ',
    overdueSince: 'Overdue since {time}',
    dayShort: 'd',
    hourShort: 'h',
    minuteShort: 'min',
    messages: 'Messages',
    internalNotesShort: 'Internal notes',
    markAllRead: 'Mark all as read',
    deleteAllNotifications: 'Delete all notifications',
    deleteNotification: 'Delete notification',
    noNotifications: 'No notifications',
    confirmDeleteNotifications: 'Delete all notifications?',
    createIncident: 'Create incident',
    incident: 'Incident',
    knownIncident: 'Known Incident',
    assignTicketToIncident: 'Assign ticket to incident',
    noIncidentAssignment: 'No assignment',
    activeKnownIncidents: '{count} known incidents active. Select one if your ticket belongs to it.',
    linkedTickets: 'Linked Tickets',
    incidentNotice: 'User-visible notice',
    incidentTitle: 'Incident title',
    dueDate: 'Due Date',
    dateFormatLabel: 'Date (dd.mm.yyyy)',
    time: 'Time'
});

Lang.format = (key, values = {}) =>
    Object.entries(values).reduce((txt, [k, v]) => txt.replace(`{${k}}`, v), Lang.t(key));

Lang.status = (status) => ({
    'Neu': Lang.t('statusNew'),
    'In Bearbeitung': Lang.t('statusDoing'),
    'Warten auf Benutzer': Lang.current === 'en' ? 'Waiting for user' : 'Warten auf Benutzer',
    'Warten auf externen Dienstleister': Lang.current === 'en' ? 'Waiting for external provider' : 'Warten auf externen Dienstleister',
    'Warten auf interne Rückmeldung': Lang.current === 'en' ? 'Waiting for internal feedback' : 'Warten auf interne Rückmeldung',
    'Geschlossen': Lang.t('statusClosed')
} [status] || status || '-');

Lang.prio = (prio) => ({
    'Niedrig': Lang.t('low'),
    'Normal': Lang.t('normal'),
    'Hoch': Lang.t('high'),
    'Kritisch': Lang.t('critical')
} [prio] || prio || '-');

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
    saveUsers: async (users) => {
        const before = Utils.read('users', []);
        const result = Utils.write('users', users);
        await LogDiff.users(before, users);
        return result;
    },
    getGroups: async () => Promise.resolve(Utils.read('user_groups', [])),
    saveGroups: async (groups) => {
        const before = Utils.read('user_groups', []);
        const result = Utils.write('user_groups', groups);
        await LogDiff.groups(before, groups);
        return result;
    },
    getListViews: async () => Promise.resolve(Utils.read('list_views', [])),
    saveListViews: async (views) => Promise.resolve(Utils.write('list_views', views)),
    getTickets: async () => Promise.resolve(Utils.read('tickets', [])),
    saveTickets: async (tickets) => {
        const before = Utils.read('tickets', []);
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
        await LogDiff.tickets(before, tickets);
    },
    getRequests: async () => Promise.resolve(Utils.read('account_requests', [])),
    saveRequests: async (reqs) => {
        const before = Utils.read('account_requests', []);
        const result = Utils.write('account_requests', reqs);
        await LogDiff.requests(before, reqs);
        return result;
    },
    getSettings: async () => Promise.resolve(Utils.read('app_settings', Settings.defaults)),
    saveSettings: async (settings) => {
        const before = Utils.read('app_settings', Settings.defaults);
        const result = Utils.write('app_settings', settings);
        await LogDiff.settings(before, settings);
        return result;
    },
    getGlobalLogs: async () => Promise.resolve(Utils.read('global_logs', [])),
    saveGlobalLogs: async (logs) => Promise.resolve(Utils.write('global_logs', logs)),
    getNotifications: async () => Promise.resolve(Utils.read('notifications', [])),
    saveNotifications: async (notifications) => Promise.resolve(Utils.write('notifications', notifications)),

    // Welche Benachrichtigungs-Ereignisse es gibt, für wen sie relevant sind, und wie sie heißen.
    notifTypeMeta: {
        newTicket: { label: 'Neues Ticket eingegangen', roles: ['admin'] },
        mention: { label: 'In einem Kommentar erwähnt worden', roles: ['admin'] },
        statusChange: { label: 'Status deines Tickets geändert', roles: ['user'] },
        newMessage: { label: 'Neue Chat-Nachricht', roles: ['user', 'admin'] },
        ticketClosed: { label: 'Ticket wurde geschlossen', roles: ['user'] },
        ticketEdited: { label: 'Ticket wurde bearbeitet', roles: ['user'] }
    },
    // Werkseinstellung: wer darf was personalisieren, und was gilt, solange nichts eingestellt ist.
    defaultNotifPolicy: () => ({
        newTicket: { admin: { appLocked: true, emailLocked: false, defaultApp: true, defaultEmail: true } },
        mention: { admin: { appLocked: true, emailLocked: false, defaultApp: true, defaultEmail: false } },
        statusChange: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true } },
        newMessage: {
            user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true },
            admin: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false }
        },
        ticketClosed: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: true } },
        ticketEdited: { user: { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false } }
    }),
    roleGroup: (user) => (user && (user.role === 'admin' || user.role === 'superadmin')) ? 'admin' : 'user',
    getNotifPolicy: async () => {
        const settings = await Store.getSettings();
        const base = Store.defaultNotifPolicy();
        const saved = settings.generalConfig?.notifPolicy || {};
        const merged = {};
        Object.keys(base).forEach(type => {
            merged[type] = {};
            Object.keys(base[type]).forEach(role => {
                merged[type][role] = { ...base[type][role], ...(saved[type]?.[role] || {}) };
            });
        });
        return merged;
    },
    resolveNotifPref: async (user, type) => {
        const policy = await Store.getNotifPolicy();
        const role = Store.roleGroup(user);
        const rule = policy[type]?.[role];
        if (!rule) return { app: true, email: false };
        const personal = user?.notifPrefs?.[type] || {};
        return {
            app: rule.appLocked ? rule.defaultApp : (typeof personal.app === 'boolean' ? personal.app : rule.defaultApp),
            email: rule.emailLocked ? rule.defaultEmail : (typeof personal.email === 'boolean' ? personal.email : rule.defaultEmail)
        };
    },

    addNotifications: async (recipients, ticket, message, actorUsername, type = 'generic') => {
        const notifications = await Store.getNotifications();
        const users = await Store.getUsers();
        const targets = [...new Set((recipients || []).filter(username => username && username !== actorUsername))];
        const allowed = [];
        for (const username of targets) {
            const person = users.find(u => u.username === username);
            if (!person) { allowed.push(username); continue; }
            const pref = await Store.resolveNotifPref(person, type);
            if (pref.app) allowed.push(username);
        }
        allowed.forEach(recipient => notifications.push({
            id: Utils.uid(),
            recipient,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber || ticket.id,
            title: ticket.title,
            message,
            date: Utils.nowISO(),
            read: false
        }));
        await Store.saveNotifications(notifications.slice(-2000));
    },
    nextTicketNumber: (tickets, categories, settings) => {
        const company = settings.companyConfig || {};
        const category = Array.isArray(categories) ? (categories[0] || 'Allgemein') : (categories || 'Allgemein');
        const categoryFormats = company.ticketNumberCategoryFormats || {};
        const format = String(categoryFormats[category] || company.ticketNumberFormat || '{prefix}-{number}').trim();
        if (!format.includes('{number}')) throw new Error('TICKET_NUMBER_FORMAT_MISSING_NUMBER');

        const highest = tickets.reduce((max, ticket) => {
            const saved = Number(ticket.ticketNumberSequence) || 0;
            const legacy = Number(String(ticket.ticketNumber || '').match(/(\d+)$/)?.[1] || 0);
            return Math.max(max, saved, legacy);
        }, 0);
        const prefix = String(company.ticketNumberPrefix || 'TS').trim();
        const padding = Math.max(1, Math.min(12, parseInt(company.ticketNumberPadding, 10) || 6));
        const categoryCode = String(category).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'GENERAL';
        const existing = new Set(tickets.map(ticket => ticket.ticketNumber).filter(Boolean));
        let sequence = highest + 1;
        let ticketNumber = '';
        do {
            const number = String(sequence).padStart(padding, '0');
            ticketNumber = format
                .replaceAll('{prefix}', prefix)
                .replaceAll('{category}', categoryCode)
                .replaceAll('{number}', number);
            if (!existing.has(ticketNumber)) break;
            sequence++;
        } while (sequence <= Number.MAX_SAFE_INTEGER);
        if (!ticketNumber || existing.has(ticketNumber)) throw new Error('TICKET_NUMBER_EXHAUSTED');
        return {
            ticketNumber,
            ticketNumberSequence: sequence
        };
    },
    // Automatische Team-Zuweisung: erste passende Regel (Kategorie -> Team) gewinnt.
    // Ohne Treffer bleibt das Ticket unzugewiesen und muss von Hand verteilt werden.
    // Eigene Felder sind je Kategorie definiert; bei Mehrfachkategorien gilt die Vereinigung.
    getCustomFieldsForCategories: (categories, settings) => {
        const map = new Map();
        (Array.isArray(categories) ? categories : [categories]).filter(Boolean).forEach(cat => {
            (settings.customFields?.[cat] || []).forEach(f => map.set(f.id, f));
        });
        return [...map.values()];
    },
    autoAssignTeam: (ticket, settings, groups) => {
        const rules = settings.generalConfig?.assignmentRules || [];
        const categories = Array.isArray(ticket.category) ? ticket.category : [ticket.category || 'Allgemein'];
        const rule = rules.find(r => r.groupId && categories.includes(r.category));
        if (!rule) return null;
        return groups.find(g => g.id === rule.groupId) || null;
    },
    // Addiert eine Dauer (ms) in Geschäftszeiten auf einen Startzeitpunkt, überspringt
    // Nicht-Arbeitstage/-Feiertage und Zeiten außerhalb des Arbeitsfensters.
    addBusinessMs: (startMs, durationMs, bh) => {
        const perDay = bh.perDay || {};
        const legacyDays = bh.days && bh.days.length ? bh.days : [1, 2, 3, 4, 5];
        const holidays = new Set(bh.holidays || []);
        let remaining = durationMs;
        let cursor = new Date(startMs);
        // Lokales Datum (nicht toISOString/UTC), damit es zu den lokal gepflegten Feiertagen passt
        const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (let iter = 0; iter < 3650 && remaining > 0; iter++) {
            const dateStr = localDateStr(cursor);
            const dow = cursor.getDay();
            const dayCfg = perDay[dow] || {
                enabled: legacyDays.includes(dow),
                start: bh.start || '08:00',
                end: bh.end || '17:00'
            };
            if (!dayCfg.enabled || holidays.has(dateStr)) {
                cursor.setDate(cursor.getDate() + 1);
                cursor.setHours(0, 0, 0, 0);
                continue;
            }
            const [startH, startM] = (dayCfg.start || '08:00').split(':').map(Number);
            const [endH, endM] = (dayCfg.end || '17:00').split(':').map(Number);
            const dayStart = new Date(cursor);
            dayStart.setHours(startH, startM, 0, 0);
            const dayEnd = new Date(cursor);
            dayEnd.setHours(endH, endM, 0, 0);
            if (dayEnd <= dayStart || cursor >= dayEnd) {
                cursor.setDate(cursor.getDate() + 1);
                cursor.setHours(0, 0, 0, 0);
                continue;
            }
            if (cursor < dayStart) cursor = new Date(dayStart);
            const availableToday = dayEnd.getTime() - cursor.getTime();
            if (remaining <= availableToday) {
                cursor = new Date(cursor.getTime() + remaining);
                remaining = 0;
            } else {
                remaining -= availableToday;
                cursor.setDate(cursor.getDate() + 1);
                cursor.setHours(0, 0, 0, 0);
            }
        }
        return cursor.getTime();
    },
    ticketSlaDueAt: (ticket, settings) => {
        // Manuell gesetzte Frist überschreibt die berechnete Lösungsfrist vollständig.
        if (ticket?.customDueAt) {
            const customMs = new Date(ticket.customDueAt).getTime();
            if (Number.isFinite(customMs)) return customMs;
        }
        const priorityKey = {
            'Niedrig': 'low',
            'Normal': 'normal',
            'Hoch': 'high',
            'Kritisch': 'critical'
        } [ticket?.prio];
        if (!priorityKey || !ticket?.createdAt) return null;
        const defaults = {
            low: 72,
            normal: 48,
            high: 24,
            critical: 4
        };
        const configured = Number(settings?.generalConfig?.slaHours?.[priorityKey]);
        const hours = Number.isFinite(configured) && configured > 0 ? configured : defaults[priorityKey];
        const createdAt = new Date(ticket.createdAt).getTime();
        if (!Number.isFinite(createdAt)) return null;
        const durationMs = hours * 60 * 60 * 1000;
        const bh = settings?.generalConfig?.businessHours;
        const baseDue = bh?.enabled ? Store.addBusinessMs(createdAt, durationMs, bh) : createdAt + durationMs;
        // Die Uhr pausiert im Warte-Status: bereits pausierte Zeit plus eine laufende Pause
        // verschieben die Frist 1:1 um die stillstehende Dauer nach hinten.
        const runningPauseMs = ticket.slaPausedSince ? Math.max(0, Date.now() - new Date(ticket.slaPausedSince).getTime()) : 0;
        const pausedMs = (ticket.slaPausedMs || 0) + runningPauseMs;
        return baseDue + pausedMs;
    },
    isTicketOverdue: (ticket, settings, now = Date.now()) => {
        if (!ticket || ticket.archived || ticket.status === 'Geschlossen') return false;
        const dueAt = Store.ticketSlaDueAt(ticket, settings);
        return dueAt !== null && dueAt <= now;
    },
    // Countdown-Badge für ein Ticket: Ampel-Farbe (success/warning/danger) nach dem
    // üblichen Muster aus Helpdesk-Tools (z. B. Zendesk/Freshdesk) – grün = genug Zeit,
    // gelb = letztes Viertel der Frist oder unter 2 Std., rot = überschritten.
    formatSlaCountdown: (ticket, settings, now = Date.now()) => {
        if (!ticket || ticket.archived || ticket.status === 'Geschlossen') return null;
        const dueAt = Store.ticketSlaDueAt(ticket, settings);
        const createdAt = new Date(ticket.createdAt).getTime();
        if (dueAt === null || !Number.isFinite(createdAt)) return null;
        const diffMs = dueAt - now;
        const overdue = diffMs <= 0;
        const minutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
        const duration = minutes >= 1440 ? `${Math.floor(minutes / 1440)} ${Lang.t('dayShort')}` :
            minutes >= 60 ? `${Math.floor(minutes / 60)} ${Lang.t('hourShort')}` : `${minutes} ${Lang.t('minuteShort')}`;
        const totalMs = Math.max(1, dueAt - createdAt);
        const urgent = !overdue && diffMs <= Math.max(totalMs * 0.25, 2 * 60 * 60 * 1000);
        return {
            overdue,
            dueAt,
            tone: overdue ? 'danger' : urgent ? 'warning' : 'success',
            label: overdue ? Lang.format('overdueSince', { time: duration }) : `${Lang.t('dueIn')}${duration}`,
            dueDateLabel: Utils.fmtDate(new Date(dueAt).toISOString())
        };
    },

    notificationUI: {
        init: async () => {
            const button = q('#btn-notifications');
            if (button) button.onclick = Notifications.open;
            await Notifications.refresh();
        },

        refresh: async () => {
            const button = q('#btn-notifications');
            const count = button?.querySelector('.notification-count');
            if (!count) return;
            const user = await Store.currentUser();
            const notifications = await Store.getNotifications();
            const unread = notifications.filter(item => item.recipient === user?.username && !item.read).length;
            count.textContent = unread > 99 ? '99+' : String(unread);
            count.hidden = unread === 0;
        },

        open: async () => {
            let modal = q('#notification-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'notification-modal';
                modal.className = 'modal-overlay';
                modal.innerHTML = `
                    <div class="modal modal-md">
                        <div class="modal-header">
                            <h3>${Icon('bell', 18)} ${Lang.t('notifications')}</h3>
                            <div class="modal-actions">
                                <button class="btn-ghost btn-icon" id="notifications-mark-all" title="${Lang.t('markAllRead')}" aria-label="${Lang.t('markAllRead')}">${Icon('check-check', 16)}</button>
                                <button class="btn-ghost btn-icon btn-danger" id="notifications-delete-all" title="${Lang.t('deleteAllNotifications')}" aria-label="${Lang.t('deleteAllNotifications')}">${Icon('trash-2', 16)}</button>
                                <button class="btn-ghost btn-icon" data-close-notifications title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                            </div>
                        </div>
                        <div class="modal-body notification-list" id="notification-list"></div>
                    </div>`;
                document.body.appendChild(modal);
                modal.querySelector('[data-close-notifications]').onclick = () => modal.classList.remove('open');
                modal.querySelector('#notifications-mark-all').onclick = Notifications.markAllRead;
                modal.querySelector('#notifications-delete-all').onclick = Notifications.deleteAll;
                modal.onclick = event => {
                    if (event.target === modal) modal.classList.remove('open');
                };
            }
            await Notifications.render();
            modal.classList.add('open');
            if (window.lucide) lucide.createIcons();
        },

        render: async () => {
            const user = await Store.currentUser();
            const notifications = await Store.getNotifications();
            const own = notifications.filter(item => item.recipient === user?.username).sort((a, b) => new Date(b.date) - new Date(a.date));
            const list = q('#notification-list');
            if (!list) return;
            const markAll = q('#notifications-mark-all');
            const deleteAll = q('#notifications-delete-all');
            if (markAll) markAll.disabled = !own.some(item => !item.read);
            if (deleteAll) deleteAll.disabled = own.length === 0;
            list.innerHTML = own.length ? own.map(item => `
                <div class="notification-item${item.read ? '' : ' is-unread'}" data-notification-id="${Utils.esc(item.id)}">
                    <button class="notification-open" type="button">
                        <span class="notification-item-icon">${Icon('ticket', 16)}</span>
                        <span class="notification-item-content">
                            <strong>${Utils.esc(item.ticketNumber)} · ${Utils.esc(item.title)}</strong>
                            <span>${Utils.esc(item.message)}</span>
                            <time>${Utils.fmtDate(item.date)}</time>
                        </span>
                    </button>
                    <button class="btn-ghost btn-icon btn-sm notification-delete" type="button" title="${Lang.t('deleteNotification')}" aria-label="${Lang.t('deleteNotification')}">${Icon('trash-2', 14)}</button>
                </div>`).join('') : `<div class="empty-state">${Lang.t('noNotifications')}</div>`;
            list.querySelectorAll('.notification-item').forEach(row => {
                row.querySelector('.notification-open').onclick = async () => {
                    const all = await Store.getNotifications();
                    const selected = all.find(item => item.id === row.dataset.notificationId && item.recipient === user?.username);
                    if (!selected) return;
                    selected.read = true;
                    await Store.saveNotifications(all);
                    q('#notification-modal')?.classList.remove('open');
                    await Notifications.refresh();
                    if (selected.ticketId) {
                        if (q('.kanban-board')) await AdminBoard.openModal(selected.ticketId);
                        else await UserDash.openModal(selected.ticketId);
                    }
                };
                row.querySelector('.notification-delete').onclick = async () => {
                    const all = await Store.getNotifications();
                    await Store.saveNotifications(all.filter(item => item.id !== row.dataset.notificationId || item.recipient !== user?.username));
                    await Notifications.render();
                    await Notifications.refresh();
                };
            });
            if (window.lucide) lucide.createIcons();
        },

        markAllRead: async () => {
            const user = await Store.currentUser();
            const notifications = await Store.getNotifications();
            notifications.forEach(item => {
                if (item.recipient === user?.username) item.read = true;
            });
            await Store.saveNotifications(notifications);
            await Notifications.render();
            await Notifications.refresh();
        },

        deleteAll: async () => {
            const user = await Store.currentUser();
            const notifications = await Store.getNotifications();
            if (!notifications.some(item => item.recipient === user?.username)) return;
            UI.confirm(Lang.t('confirmDeleteNotifications'), async () => {
                const latest = await Store.getNotifications();
                await Store.saveNotifications(latest.filter(item => item.recipient !== user?.username));
                await Notifications.render();
                await Notifications.refresh();
            });
        }
    },
    openAttachmentDb: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('ticket_system_files', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files', {
            keyPath: 'id'
        });
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
        return {
            id: record.id,
            name: record.name,
            type: record.type,
            size: record.size
        };
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
        if (logs.length > 10000) logs.splice(0, logs.length - 10000);
        await Store.saveGlobalLogs(logs);
    },

    sendEmail: async (to, subject, body) => {
        const settings = await Store.getSettings();
        const conf = settings.emailConfig;
        if (!conf || !conf.host) {
            console.log('Email logging (No SMTP config):', {
                to,
                subject,
                body
            });
            return;
        }
        const company = settings.companyConfig || {};
        const signature = conf.htmlSignature || company.htmlSignature || company.signature || '';
        const textSignature = company.signature || '';
        const textBody = textSignature ? `${body || ''}\n\n${textSignature}` : body;
        const htmlBody = conf.htmlEnabled ?
            `${String(body || '').replace(/\n/g, '<br>')}${signature ? `<br><br>${signature}` : ''}` :
            null;
        console.log(`Sending Email via ${conf.host}:${conf.port}`, {
            user: conf.user,
            from: conf.from,
            to,
            subject,
            body: textBody,
            htmlBody,
            security: conf.security || {}
        });
        UI.toast(Lang.format('emailSent', {
            to
        }));
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
            Utils.write('user_groups', [{
                    id: Utils.uid(),
                    name: 'Admins',
                    description: 'Administrative Benutzer',
                    members: ['admin']
                },
                {
                    id: Utils.uid(),
                    name: 'Verwaltung',
                    description: 'Interne Verwaltung',
                    members: []
                },
                {
                    id: Utils.uid(),
                    name: 'Support',
                    description: 'Support Team',
                    members: []
                }
            ]);
        }
        if (!Utils.read('tickets', null)) Utils.write('tickets', []);
        if (!Utils.read('account_requests', null)) Utils.write('account_requests', []);

        // Migration: ensure 'comments', 'chat', 'archived' are set
        const tickets = await Store.getTickets();
        let changed = false;
        let nextNumber = tickets.reduce((max, ticket) => {
            const savedSequence = Number(ticket.ticketNumberSequence) || 0;
            const legacyNumber = Number(String(ticket.ticketNumber || '').match(/(\d+)$/)?.[1] || 0);
            return Math.max(max, savedSequence, legacyNumber);
        }, 0) + 1;
        const numberingSettings = await Store.getSettings();
        const numberingCompany = numberingSettings.companyConfig || {};
        const numberingPrefix = String(numberingCompany.ticketNumberPrefix || 'TS').trim();
        const numberingPadding = Math.max(1, Math.min(12, parseInt(numberingCompany.ticketNumberPadding, 10) || 6));
        const numberingBaseFormat = String(numberingCompany.ticketNumberFormat || '{prefix}-{number}').trim();
        const numberingCategoryFormats = numberingCompany.ticketNumberCategoryFormats || {};
        const numberingCategoryCode = (cat) => String(cat || 'Allgemein').normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'GENERAL';
        tickets.forEach(t => {
            if (!Number.isSafeInteger(t.ticketNumberSequence) || t.ticketNumberSequence < 1) {
                const legacyNumber = Number(String(t.ticketNumber || '').match(/(\d+)$/)?.[1] || 0);
                t.ticketNumberSequence = legacyNumber || nextNumber++;
                changed = true;
            }
            if (!t.ticketNumber) {
                const category = Array.isArray(t.category) ? (t.category[0] || 'Allgemein') : (t.category || 'Allgemein');
                const format = String(numberingCategoryFormats[category] || numberingBaseFormat).trim();
                const number = String(t.ticketNumberSequence).padStart(numberingPadding, '0');
                t.ticketNumber = format.includes('{number}')
                    ? format.replaceAll('{prefix}', numberingPrefix).replaceAll('{category}', numberingCategoryCode(category)).replaceAll('{number}', number)
                    : `${numberingPrefix}-${number}`;
                changed = true;
            }
            if (!t.chat) {
                t.chat = [];
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
const Notifications = Store.notificationUI;

// Protokolliert jede Änderung an Tickets, Benutzern, Gruppen, Anfragen und Einstellungen im Systemprotokoll.
const LogDiff = {
    fmt: v => {
        if (v === undefined || v === null || v === '') return '–';
        if (Array.isArray(v)) return v.length ? v.join(', ') : '–';
        if (typeof v === 'object') return JSON.stringify(v).slice(0, 300);
        return String(v).slice(0, 300);
    },
    isSecret: key => /pass|secret|token|private|key/i.test(key),
    flatten(value, prefix = '', out = {}) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value);
            if (!keys.length && prefix) out[prefix] = {};
            keys.forEach(k => LogDiff.flatten(value[k], prefix ? `${prefix}.${k}` : k, out));
            return out;
        }
        out[prefix] = value;
        return out;
    },
    async write(action, details) {
        try {
            await Store.addGlobalLog(action, details.slice(0, 4000));
        } catch (error) {
            console.error('Protokollierung fehlgeschlagen', error);
        }
    },
    async tickets(oldList, newList) {
        const oldMap = new Map(oldList.map(t => [t.id, t]));
        const newIds = new Set(newList.map(t => t.id));
        const chatKey = c => `${c.date}|${c.author}|${c.text}`;
        for (const t of newList) {
            const label = `${t.ticketNumber || t.id} „${t.title || ''}“`;
            const o = oldMap.get(t.id);
            if (!o) {
                await LogDiff.write('Ticket angelegt', `${label}\nErsteller: ${t.author || '–'} · Priorität: ${t.prio || '–'} · Kategorie: ${LogDiff.fmt(t.category)} · Status: ${t.status || '–'} · Hauptverantwortlicher: ${LogDiff.fmt(t.owner)}${t.linkedIncidentId ? ' · Verknüpft mit Störung: ' + t.linkedIncidentId : ''}`);
                continue;
            }
            const changes = [];
            const cmp = (name, a, b) => {
                if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes.push(`${name}: ${LogDiff.fmt(a)} → ${LogDiff.fmt(b)}`);
            };
            cmp('Titel', o.title, t.title);
            cmp('Beschreibung', o.desc, t.desc);
            cmp('Status', o.status, t.status);
            cmp('Priorität', o.prio, t.prio);
            cmp('Kategorie', o.category, t.category);
            cmp('Hauptverantwortlicher', o.owner, t.owner);
            cmp('Zuständige', o.assignees, t.assignees);
            cmp('Beteiligte', o.participants, t.participants);
            cmp('Team', o.team, t.team);
            cmp('Ersteller', o.author, t.author);
            cmp('Verknüpfte Störung', o.linkedIncidentId, t.linkedIncidentId);
            cmp('Großstörung', o.isMajorIncident, t.isMajorIncident);
            cmp('Störungshinweis', o.incidentNotice, t.incidentNotice);
            cmp('Archiviert', o.archived, t.archived);
            cmp('Ersteller archiviert', o.authorArchived, t.authorArchived);
            cmp('Frist (manuell)', o.customDueAt, t.customDueAt);
            cmp('Wartet auf Antwort mit Nachricht', o.waitingMessage, t.waitingMessage);

            const oTodos = o.todos || [];
            const nTodos = t.todos || [];
            const todoKey = x => x.id || x.title;
            nTodos.forEach(td => {
                const prev = oTodos.find(x => todoKey(x) === todoKey(td));
                if (!prev) {
                    changes.push(`Teilaufgabe hinzugefügt: „${td.title}“ · Zuweisung: ${LogDiff.fmt(td.assignee)}`);
                    return;
                }
                if (!!prev.done !== !!td.done) changes.push(`Teilaufgabe ${td.done ? 'erledigt' : 'wieder offen'}: „${td.title}“`);
                if (prev.title !== td.title) changes.push(`Teilaufgabe umbenannt: „${prev.title}“ → „${td.title}“`);
                if ((prev.assignee || '') !== (td.assignee || '')) changes.push(`Teilaufgabe „${td.title}“ Zuweisung: ${LogDiff.fmt(prev.assignee)} → ${LogDiff.fmt(td.assignee)}`);
            });
            oTodos.forEach(prev => {
                if (!nTodos.some(x => todoKey(x) === todoKey(prev))) changes.push(`Teilaufgabe entfernt: „${prev.title}“`);
            });

            const oTime = o.timeEntries || [];
            const nTime = t.timeEntries || [];
            nTime.filter(e => !oTime.some(x => x.id === e.id)).forEach(e => changes.push(`Zeit erfasst: ${e.minutes} Min. von ${e.username}${e.note ? ' („' + e.note + '“)' : ''}`));
            oTime.filter(e => !nTime.some(x => x.id === e.id)).forEach(e => changes.push(`Zeiteintrag entfernt: ${e.minutes} Min. von ${e.username}`));

            const oAtt = (o.attachments || []).map(a => a.name);
            const nAtt = (t.attachments || []).map(a => a.name);
            nAtt.filter(n => !oAtt.includes(n)).forEach(n => changes.push(`Anhang hinzugefügt: ${n}`));
            oAtt.filter(n => !nAtt.includes(n)).forEach(n => changes.push(`Anhang entfernt: ${n}`));

            const oChat = new Set((o.chat || []).map(chatKey));
            (t.chat || []).filter(c => !oChat.has(chatKey(c))).forEach(c => {
                changes.push(`Chat-Nachricht (${c.role === 'user' ? 'Benutzer' : 'Support'}, ${c.author || '–'}): „${String(c.text || '').slice(0, 500)}“${c.files?.length ? ' + ' + c.files.length + ' Datei(en)' : ''}`);
            });
            const oComments = new Set((o.comments || []).map(chatKey));
            (t.comments || []).filter(c => !oComments.has(chatKey(c))).forEach(c => {
                changes.push(`Interne Notiz (${c.channel || 'solution'}, ${c.type || '–'}, ${c.author || '–'}): „${String(c.text || '').slice(0, 500)}“${c.pinned ? ' · angepinnt' : ''}${c.resolution ? ' · endgültige Lösung' : ''}`);
            });

            if (changes.length) await LogDiff.write('Ticket geändert', `${label}\n${changes.join('\n')}`);
        }
        for (const o of oldList) {
            if (!newIds.has(o.id)) await LogDiff.write('Ticket entfernt', `${o.ticketNumber || o.id} „${o.title || ''}“`);
        }
    },
    async users(oldList, newList) {
        const oldMap = new Map(oldList.map(u => [u.username, u]));
        const newNames = new Set(newList.map(u => u.username));
        const fields = ['name', 'email', 'department', 'role', 'dept', 'groups', 'canManageRequests', 'canManageUsers', 'canViewLogs', 'canManage2FA', 'twoFactorEnabled', 'accountLocked', 'accountArchived', 'lockedUntil'];
        for (const u of newList) {
            const o = oldMap.get(u.username);
            if (!o) {
                await LogDiff.write('Benutzer angelegt', `${u.username} · Name: ${LogDiff.fmt(u.name)} · Rolle: ${LogDiff.fmt(u.role)} · E-Mail: ${LogDiff.fmt(u.email)} · Abteilung: ${LogDiff.fmt(u.department)}`);
                continue;
            }
            const changes = [];
            fields.forEach(f => {
                const a = o[f], b = u[f];
                if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
                    const shown = f === 'lockedUntil' ? (b ? new Date(b).toLocaleString('de-DE') : '–') : LogDiff.fmt(b);
                    changes.push(`${f}: ${f === 'lockedUntil' && a ? new Date(a).toLocaleString('de-DE') : LogDiff.fmt(a)} → ${shown}`);
                }
            });
            if (o.password !== u.password) changes.push('Passwort geändert');
            const oAbs = LogDiff.flatten(o.absence || {});
            const nAbs = LogDiff.flatten(u.absence || {});
            [...new Set([...Object.keys(oAbs), ...Object.keys(nAbs)])].forEach(k => {
                if (JSON.stringify(oAbs[k] ?? null) !== JSON.stringify(nAbs[k] ?? null)) changes.push(`Abwesenheit ${k}: ${LogDiff.fmt(oAbs[k])} → ${LogDiff.fmt(nAbs[k])}`);
            });
            if (changes.length) await LogDiff.write('Benutzer geändert', `${u.username}\n${changes.join('\n')}`);
        }
        for (const o of oldList) {
            if (!newNames.has(o.username)) await LogDiff.write('Benutzer gelöscht', `${o.username} · Name: ${LogDiff.fmt(o.name)} · Rolle: ${LogDiff.fmt(o.role)}`);
        }
    },
    async settings(oldS, newS) {
        const a = LogDiff.flatten(oldS || {});
        const b = LogDiff.flatten(newS || {});
        const changes = [];
        [...new Set([...Object.keys(a), ...Object.keys(b)])].forEach(k => {
            if (JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null)) return;
            if (k.endsWith('bgValue')) return changes.push(`${k}: Hintergrundbild geändert`);
            if (LogDiff.isSecret(k)) return changes.push(`${k}: Wert geändert (geheim)`);
            changes.push(`${k}: ${LogDiff.fmt(a[k])} → ${LogDiff.fmt(b[k])}`);
        });
        if (changes.length) await LogDiff.write('Einstellungen geändert', changes.join('\n'));
    },
    async groups(oldList, newList) {
        const oldMap = new Map(oldList.map(g => [g.id, g]));
        const newIds = new Set(newList.map(g => g.id));
        for (const g of newList) {
            const o = oldMap.get(g.id);
            if (!o) { await LogDiff.write('Gruppe angelegt', `${g.name} · Mitglieder: ${LogDiff.fmt(g.members)}`); continue; }
            const changes = [];
            if (o.name !== g.name) changes.push(`Name: ${o.name} → ${g.name}`);
            if (o.description !== g.description) changes.push(`Beschreibung: ${LogDiff.fmt(o.description)} → ${LogDiff.fmt(g.description)}`);
            if (JSON.stringify(o.members || []) !== JSON.stringify(g.members || [])) changes.push(`Mitglieder: ${LogDiff.fmt(o.members)} → ${LogDiff.fmt(g.members)}`);
            if (changes.length) await LogDiff.write('Gruppe geändert', `${g.name}\n${changes.join('\n')}`);
        }
        for (const o of oldList) if (!newIds.has(o.id)) await LogDiff.write('Gruppe gelöscht', o.name);
    },
    async requests(oldList, newList) {
        const oldIds = new Set(oldList.map(r => r.id));
        const newIds = new Set(newList.map(r => r.id));
        for (const r of newList) if (!oldIds.has(r.id)) await LogDiff.write('Kontoanfrage eingegangen', `${r.name} · ${r.email}`);
        for (const r of oldList) if (!newIds.has(r.id)) await LogDiff.write('Kontoanfrage entfernt', `${r.name} · ${r.email}`);
    }
};

// --- Auth ---
// --- Auth ---
const Auth = {
    lastError: null,
    login: async (u, p) => {
        Auth.lastError = null;
        const users = await Store.getUsers();
        const candidate = users.find(x => x.username === u);
        if (candidate?.accountArchived) {
            Auth.lastError = 'archived';
            await Store.addGlobalLog('Anmeldung abgelehnt (archiviert)', `Benutzer: ${u}`);
            return null;
        }
        if (candidate?.accountLocked) {
            Auth.lastError = 'locked';
            await Store.addGlobalLog('Anmeldung abgelehnt (gesperrt)', `Benutzer: ${u}`);
            return null;
        }
        if (candidate?.lockedUntil && Date.now() < candidate.lockedUntil) {
            Auth.lastError = 'tempLocked';
            Auth.lockedUntil = candidate.lockedUntil;
            await Store.addGlobalLog('Anmeldung abgelehnt (vorübergehend gesperrt)', `Benutzer: ${u}`);
            return null;
        }
        if (candidate && candidate.password === p) {
            candidate.failedLogins = 0;
            delete candidate.lockedUntil;
            await Store.saveUsers(users);
            localStorage.setItem('currentUser', candidate.username);
            await Store.addGlobalLog('Anmeldung erfolgreich', `Benutzer: ${candidate.name || candidate.username}`);
            return candidate;
        }
        await Store.addGlobalLog('Anmeldung fehlgeschlagen', `Benutzerversuch: ${u}`);
        if (candidate) {
            const settings = await Store.getSettings();
            const limit = Number(settings.securityConfig?.maxLoginAttempts) || 0;
            candidate.failedLogins = (candidate.failedLogins || 0) + 1;
            if (limit > 0 && candidate.failedLogins >= limit) {
                const action = settings.securityConfig?.lockoutAction || 'lock';
                if (action === 'lock') {
                    candidate.accountLocked = true;
                    Auth.lastError = 'locked';
                    await Store.addGlobalLog('Konto nach Fehlversuchen gesperrt', `Benutzer: ${u}`);
                } else if (action === 'temp') {
                    const minutes = Number(settings.securityConfig?.lockoutMinutes) || 15;
                    candidate.lockedUntil = Date.now() + minutes * 60000;
                    candidate.failedLogins = 0;
                    Auth.lockedUntil = candidate.lockedUntil;
                    Auth.lastError = 'tempLocked';
                    await Store.addGlobalLog('Konto nach Fehlversuchen vorübergehend gesperrt', `Benutzer: ${u}, ${minutes} Min.`);
                } else {
                    await Store.addGlobalLog('Maximale Fehlversuche erreicht', `Benutzer: ${u}`);
                }
            }
            await Store.saveUsers(users);
        }
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
    // Druckt HTML über ein unsichtbares iFrame statt einem neuen Tab/Fenster --
    // kein Pop-up-Blocker-Risiko, und die Ticket-System-Seite bleibt immer im Hintergrund erhalten.
    printHTML: (html) => {
        let frame = q('#print-frame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'print-frame';
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
            document.body.appendChild(frame);
        }
        const doc = frame.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
        UI.toast('Druckvorschau wird geöffnet...');
        frame.onload = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
        };
    },
    // Ersetzt native title-Tooltips (vom Browser gezeichnet, nicht stylebar) durch eine
    // ans Design angepasste, abgerundete Tooltip-Box. Funktioniert per Delegation auch für
    // Elemente, die erst später (z.B. in Modals) ins DOM kommen.
    _tooltipEl: null,
    showTooltip: (target, text) => {
        if (!UI._tooltipEl) {
            UI._tooltipEl = document.createElement('div');
            UI._tooltipEl.className = 'custom-tooltip';
            document.body.appendChild(UI._tooltipEl);
        }
        const el = UI._tooltipEl;
        el.textContent = text;
        el.classList.add('visible');
        const rect = target.getBoundingClientRect();
        const tipRect = el.getBoundingClientRect();
        let top = rect.top - tipRect.height - 8;
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        if (top < 4) top = rect.bottom + 8;
        left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
    },
    hideTooltip: () => {
        if (UI._tooltipEl) UI._tooltipEl.classList.remove('visible');
    },
    initTooltips: () => {
        if (UI._tooltipsInitialized) return;
        UI._tooltipsInitialized = true;
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest?.('[title],[data-tooltip-text]');
            if (!target) return;
            let text = target.getAttribute('title');
            if (text) {
                target.dataset.tooltipText = text;
                target.removeAttribute('title');
            } else {
                text = target.dataset.tooltipText;
            }
            if (text) UI.showTooltip(target, text);
        });
        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest?.('[data-tooltip-text]');
            if (target && !target.contains(e.relatedTarget)) UI.hideTooltip();
        });
        document.addEventListener('focusin', (e) => {
            const target = e.target.closest?.('[title],[data-tooltip-text]');
            if (!target) return;
            let text = target.getAttribute('title');
            if (text) {
                target.dataset.tooltipText = text;
                target.removeAttribute('title');
            } else {
                text = target.dataset.tooltipText;
            }
            if (text) UI.showTooltip(target, text);
        });
        document.addEventListener('focusout', (e) => {
            const target = e.target.closest?.('[data-tooltip-text]');
            if (target) UI.hideTooltip();
        });
        window.addEventListener('scroll', () => UI.hideTooltip(), true);
        document.addEventListener('mousedown', () => UI.hideTooltip());
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
    askIncidentLink: (incidents, opts = {}) => new Promise(resolve => {
        let modal = q('#incident-link-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'incident-link-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('siren', 18)}Gehört dein Ticket zu einer Störung?</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="ilk-close" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div class="incident-link-options" id="ilk-options"></div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="ilk-cancel">Abbrechen</button>
                        <button class="btn-primary" id="ilk-confirm">Ticket absenden</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        modal.querySelector('.modal-header h3').innerHTML = `${Icon('siren', 18)}${Utils.esc(opts.title || 'Gehört dein Ticket zu einer Störung?')}`;
        modal.querySelector('#ilk-confirm').textContent = opts.confirmLabel || 'Ticket absenden';
        const options = modal.querySelector('#ilk-options');
        options.innerHTML = [
            ...incidents.map((incident, i) => `
                <label class="check-row incident-link-option">
                    <input type="radio" name="ilk-incident" value="${Utils.esc(incident.id)}"${i === 0 ? ' checked' : ''}>
                    <span class="check-text"><strong>${Utils.esc(incident.ticketNumber || incident.id)} · ${Utils.esc(incident.title)}</strong><span>${Utils.esc(incident.incidentNotice || '')}</span></span>
                </label>`),
            `<label class="check-row incident-link-option">
                <input type="radio" name="ilk-incident" value="">
                <span class="check-text"><strong>Nein, keine dieser Störungen</strong></span>
            </label>`
        ].join('');
        const finish = (result) => {
            modal.classList.remove('open');
            resolve(result);
        };
        modal.querySelector('#ilk-close').onclick = () => finish(undefined);
        modal.querySelector('#ilk-cancel').onclick = () => finish(undefined);
        modal.querySelector('#ilk-confirm').onclick = () => {
            const checked = modal.querySelector('input[name="ilk-incident"]:checked');
            finish(checked && checked.value ? checked.value : null);
        };
        modal.onclick = e => { if (e.target === modal) finish(undefined); };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    }),

    promptText: ({ title, label, value = '', placeholder = '', multiline = false, saveLabel = null } = {}) => new Promise(resolve => {
        let modal = q('#prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'prompt-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3></h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="pm-save" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon" id="pm-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body"></div>
                </div>`;
            document.body.appendChild(modal);
        }
        const inputId = 'pm-value';
        modal.querySelector('.modal-header h3').textContent = title || '';
        modal.querySelector('#pm-save').title = saveLabel || Lang.t('save');
        modal.querySelector('#pm-save').setAttribute('aria-label', saveLabel || Lang.t('save'));
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label for="${inputId}">${Utils.esc(label || '')}</label>
                ${multiline
                ? `<textarea id="${inputId}" rows="4" placeholder="${Utils.esc(placeholder)}">${Utils.esc(value)}</textarea>`
                : `<input id="${inputId}" type="text" value="${Utils.esc(value)}" placeholder="${Utils.esc(placeholder)}">`}
            </div>`;
        const close = (result) => {
            modal.classList.remove('open');
            resolve(result);
        };
        modal.querySelector('#pm-close').onclick = () => close(null);
        modal.onclick = e => {
            if (e.target === modal) close(null);
        };
        modal.querySelector('#pm-save').onclick = () => close(q(`#${inputId}`)?.value || '');
        modal.classList.add('open');
        setTimeout(() => q(`#${inputId}`)?.focus(), 0);
        if (window.lucide) lucide.createIcons();
    }),
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

    createColorPicker: (root, {
        value,
        onInput,
        onCommit
    }) => {
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
                [(n >> 16) & 255, (n >> 8) & 255, n & 255].forEach((c, i) => {
                    rgbIn[i].value = c;
                });
            }
            return hex;
        };
        const change = (skip) => {
            const hex = render(skip);
            if (onInput) onInput(hex);
        };
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
        area.onpointerup = area.onpointercancel = () => {
            area.onpointermove = null;
            commit();
        };
        area.onkeydown = (e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const moves = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, step],
                ArrowDown: [0, -step]
            };
            if (!moves[e.key]) return;
            e.preventDefault();
            hsv.s = clamp(hsv.s + moves[e.key][0]);
            hsv.v = clamp(hsv.v + moves[e.key][1]);
            change();
            commit();
        };

        hue.oninput = () => {
            hsv.h = Number(hue.value);
            change('hue');
        };
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
        [hexIn, ...rgbIn].forEach(inp => inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inp.blur();
        }));

        if (window.EyeDropper) {
            drop.onclick = async () => {
                try {
                    const res = await new window.EyeDropper().open();
                    hsv = Utils.hexToHsv(res.sRGBHex);
                    change();
                    commit();
                } catch {}
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
    logRow: ({
        icon,
        user,
        date,
        action,
        details
    }) => `
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

    // Zeigt die je Kategorie definierten eigenen Felder in einem Ticket-Formular an.
    // Eigener Datum/Uhrzeit-Picker im App-Design -- ersetzt den nativen datetime-local-Kalender,
    // der sich (Browser-UI) nicht ins dunkle Theme einfügt.
    dateTimePickerMarkup: (id) => `
        <div class="dtp-field" id="${id}">
            <button type="button" class="dtp-trigger">
                <span class="dtp-value is-placeholder">Datum &amp; Uhrzeit wählen...</span>
                ${Icon('calendar', 15)}
            </button>
            <div class="dtp-popover">
                <div class="dtp-header">
                    <button type="button" class="dtp-nav dtp-prev" aria-label="Vorheriger Monat">${Icon('chevron-left', 16)}</button>
                    <span class="dtp-month-label"></span>
                    <button type="button" class="dtp-nav dtp-next" aria-label="Nächster Monat">${Icon('chevron-right', 16)}</button>
                </div>
                <div class="dtp-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
                <div class="dtp-grid"></div>
                <div class="dtp-time-row">
                    <div class="dtp-time-col dtp-hour" role="listbox" aria-label="Stunde"></div>
                    <span class="dtp-time-sep">:</span>
                    <div class="dtp-time-col dtp-minute" role="listbox" aria-label="Minute"></div>
                </div>
                <div class="dtp-actions">
                    <button type="button" class="dtp-clear">Löschen</button>
                    <button type="button" class="dtp-today">Heute</button>
                </div>
            </div>
        </div>`,

    createDateTimePicker: (root, { value = null, onChange = null, anchor = null } = {}) => {
        const trigger = root.querySelector('.dtp-trigger');
        const valueLabel = root.querySelector('.dtp-value');
        const monthLabel = root.querySelector('.dtp-month-label');
        const grid = root.querySelector('.dtp-grid');
        const hourSel = root.querySelector('.dtp-hour');
        const minuteSel = root.querySelector('.dtp-minute');
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

        let hourVal = 0;
        let minuteVal = 0;
        const renderTimeCol = (col, count, current, onPick) => {
            col.innerHTML = Array.from({ length: count }, (_, n) => `<button type="button" class="dtp-time-opt${n === current ? ' is-selected' : ''}" data-value="${n}">${String(n).padStart(2, '0')}</button>`).join('');
            col.querySelectorAll('.dtp-time-opt').forEach(btn => {
                btn.onclick = () => onPick(Number(btn.dataset.value));
            });
            const active = col.querySelector('.is-selected');
            if (active) col.scrollTop = active.offsetTop - col.clientHeight / 2 + active.offsetHeight / 2;
        };
        const renderTimeCols = () => {
            renderTimeCol(hourSel, 24, hourVal, h => { hourVal = h; renderTimeCols(); applyTime(); });
            renderTimeCol(minuteSel, 60, minuteVal, m => { minuteVal = m; renderTimeCols(); applyTime(); });
        };

        let selected = value ? new Date(value) : null;
        let viewDate = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        const renderLabel = () => {
            if (selected) {
                valueLabel.textContent = fmt(selected);
                valueLabel.classList.remove('is-placeholder');
            } else {
                valueLabel.textContent = 'Datum & Uhrzeit wählen...';
                valueLabel.classList.add('is-placeholder');
            }
        };

        const renderGrid = () => {
            monthLabel.textContent = `${monthNames[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
            const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
            const startOffset = (firstOfMonth.getDay() + 6) % 7; // Woche beginnt Montag
            const gridStart = new Date(firstOfMonth);
            gridStart.setDate(gridStart.getDate() - startOffset);
            const today = new Date();
            const cells = [];
            for (let i = 0; i < 42; i++) {
                const d = new Date(gridStart);
                d.setDate(gridStart.getDate() + i);
                const classes = ['dtp-day'];
                if (d.getMonth() !== viewDate.getMonth()) classes.push('is-outside');
                if (sameDay(d, today)) classes.push('is-today');
                if (sameDay(d, selected)) classes.push('is-selected');
                cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${d.toISOString()}">${d.getDate()}</button>`);
            }
            grid.innerHTML = cells.join('');
            grid.querySelectorAll('.dtp-day').forEach(btn => {
                btn.onclick = () => {
                    const picked = new Date(btn.dataset.date);
                    const h = selected ? selected.getHours() : new Date().getHours();
                    const m = selected ? selected.getMinutes() : new Date().getMinutes();
                    selected = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), h, m);
                    viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
                    hourVal = h;
                    minuteVal = m;
                    renderTimeCols();
                    renderGrid();
                    renderLabel();
                    if (onChange) onChange(selected.getTime());
                };
            });
        };

        const applyTime = () => {
            if (!selected) selected = new Date();
            selected.setHours(hourVal, minuteVal, 0, 0);
            renderLabel();
            if (onChange) onChange(selected.getTime());
        };
        if (selected) {
            hourVal = selected.getHours();
            minuteVal = selected.getMinutes();
        }
        renderTimeCols();

        root.querySelector('.dtp-clear').onclick = () => {
            selected = null;
            renderLabel();
            renderGrid();
            if (onChange) onChange(null);
        };
        root.querySelector('.dtp-today').onclick = () => {
            const now = new Date();
            selected = selected ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), selected.getHours(), selected.getMinutes()) : now;
            viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
            hourVal = selected.getHours();
            minuteVal = selected.getMinutes();
            renderTimeCols();
            renderGrid();
            renderLabel();
            if (onChange) onChange(selected.getTime());
        };
        root.querySelector('.dtp-prev').onclick = () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
            renderGrid();
        };
        root.querySelector('.dtp-next').onclick = () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
            renderGrid();
        };

        // Das Popover wird beim Öffnen aus dem Modal gelöst und direkt an <body> gehängt --
        // sonst schneidet das scrollbare .modal-body den Kalender ab, sobald er größer als
        // der sichtbare Rest des Dialogs ist.
        const popover = root.querySelector('.dtp-popover');
        popover.classList.add('dtp-popover-detached');
        if (root.id) popover.id = `${root.id}-popover`;
        const positionPopover = () => {
            const rect = (anchor || trigger).getBoundingClientRect();
            const popH = popover.offsetHeight || 420;
            const popW = popover.offsetWidth || 280;
            let top = rect.bottom + 6;
            if (top + popH > window.innerHeight - 8) top = Math.max(8, rect.top - popH - 6);
            let left = rect.left;
            if (left + popW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popW - 8);
            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
            popover.style.width = `${rect.width < 240 ? 280 : rect.width}px`;
        };
        const close = () => {
            root.classList.remove('open');
            popover.classList.remove('open');
        };
        const open = () => {
            qa('.dtp-popover-detached.open').forEach(p => p.classList.remove('open'));
            qa('.dtp-field.open').forEach(f => f.classList.remove('open'));
            if (popover.parentElement !== document.body) document.body.appendChild(popover);
            root.classList.add('open');
            positionPopover();
            popover.classList.add('open');
        };
        trigger.onclick = (e) => {
            e.stopPropagation();
            root.classList.contains('open') ? close() : open();
        };
        if (root._dtpOutside) window.removeEventListener('click', root._dtpOutside);
        root._dtpOutside = (e) => { if (!root.contains(e.target) && !popover.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); };
        window.addEventListener('click', root._dtpOutside);
        if (root._dtpReposition) window.removeEventListener('resize', root._dtpReposition);
        root._dtpReposition = () => { if (root.classList.contains('open')) positionPopover(); };
        window.addEventListener('resize', root._dtpReposition);

        renderGrid();
        renderLabel();

        return {
            getValue: () => selected ? selected.getTime() : null,
            setValue: (ms) => {
                selected = ms ? new Date(ms) : null;
                viewDate = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date();
                if (selected) {
                    hourVal = selected.getHours();
                    minuteVal = selected.getMinutes();
                }
                renderTimeCols();
                renderGrid();
                renderLabel();
            },
            open,
            close
        };
    },

    renderCustomFieldsForm: (container, fields, values = {}) => {
        if (!container) return;
        if (!fields.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = fields.map(f => `
            <div class="field">
                <label for="cf-${f.id}">${Utils.esc(f.label)}${f.required ? ' *' : ''}</label>
                ${f.type === 'select'
                ? `<select id="cf-${f.id}" data-field-id="${f.id}" data-field-label="${Utils.esc(f.label)}" data-field-required="${f.required ? '1' : ''}"><option value="">Bitte wählen...</option>${(f.options || []).map(o => `<option value="${Utils.esc(o)}" ${values[f.id] === o ? 'selected' : ''}>${Utils.esc(o)}</option>`).join('')}</select>`
                : `<input id="cf-${f.id}" data-field-id="${f.id}" data-field-label="${Utils.esc(f.label)}" data-field-required="${f.required ? '1' : ''}" type="${f.type === 'number' ? 'number' : 'text'}" value="${Utils.esc(values[f.id] || '')}">`}
            </div>`).join('');
    },
    // Zeigt die ausgefüllten eigenen Felder eines Tickets schreibgeschützt an (Ticket-Detailansicht).
    renderCustomFieldsDisplay: (container, fields, values = {}) => {
        if (!container) return;
        const filled = fields.filter(f => String(values[f.id] ?? '').trim());
        if (!filled.length) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.innerHTML = filled.map(f => `<div class="cf-display-item"><strong>${Utils.esc(f.label)}</strong><span>${Utils.esc(values[f.id])}</span></div>`).join('');
    },
    // Liest die Werte aus renderCustomFieldsForm; missing enthält die Labels fehlender Pflichtfelder.
    readCustomFieldsForm: (container) => {
        const values = {};
        const missing = [];
        if (!container) return { values, missing };
        container.querySelectorAll('[data-field-id]').forEach(el => {
            const val = el.value.trim();
            if (el.dataset.fieldRequired && !val) missing.push(el.dataset.fieldLabel);
            if (val) values[el.dataset.fieldId] = val;
        });
        return { values, missing };
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

        if (options.length > 6) {
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'ms-search';
            search.placeholder = 'Suchen...';
            search.setAttribute('aria-label', 'Auswahl durchsuchen');
            search.oninput = () => {
                const term = search.value.trim().toLowerCase();
                dropdown.querySelectorAll('.ms-row').forEach(row => {
                    row.hidden = !!term && !row.textContent.toLowerCase().includes(term);
                });
            };
            dropdown.prepend(search);
        }

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
                if (onChange) onChange(inputs.filter(i => i.checked).map(i => i.value));
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
    bgPresets: [{
            type: 'default',
            val: '',
            preset: 'bg-default',
            label: 'Standard',
            icon: 'moon-star'
        },
        {
            type: 'class',
            val: 'bg-aurora',
            preset: 'bg-aurora',
            label: 'Aurora',
            icon: 'sparkles'
        },
        {
            type: 'class',
            val: 'bg-nebula',
            preset: 'bg-nebula',
            label: 'Nebel',
            icon: 'orbit'
        },
        {
            type: 'class',
            val: 'bg-ocean',
            preset: 'bg-ocean',
            label: 'Ozean',
            icon: 'waves'
        },
        {
            type: 'class',
            val: 'bg-forest',
            preset: 'bg-forest',
            label: 'Wald',
            icon: 'trees'
        },
        {
            type: 'class',
            val: 'bg-ember',
            preset: 'bg-ember',
            label: 'Glut',
            icon: 'flame'
        },
        {
            type: 'class',
            val: 'bg-sand',
            preset: 'bg-sand',
            label: 'Sand',
            icon: 'mountain'
        },
        {
            type: 'class',
            val: 'bg-graphite',
            preset: 'bg-graphite',
            label: 'Graphit',
            icon: 'grid-3x3'
        }
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
        qa('.brand-mini').forEach(el => {
            el.textContent = name;
        });
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
            // Eigene Bilder sind oft dunkel fotografiert -- im hellen Theme braucht es einen
            // hellen statt dunklen Schleier, sonst wirkt alles (z. B. die Navbar) weiterhin dunkel.
            const imageOverlay = isLight ? 'rgba(255,255,255,0.55)' : overlay;
            document.body.style.background = `linear-gradient(${imageOverlay}, ${imageOverlay}), url(${s.bgValue}) no-repeat center center fixed`;
            document.body.style.backgroundSize = 'cover';
            if (stars) stars.style.display = 'none';
        } else if (s.bgType === 'class') {
            document.body.className = s.bgValue;
            document.body.style.background = '';
            if (stars) stars.style.display = 'none';
        }
    },
    absencePeriodMarkup: (absence = {}, prefix = 'abs') => `
        <div class="form-grid">
            <div class="field">
                <label for="${prefix}-from">Von (TT.MM.JJJJ, leer = sofort)</label>
                <input id="${prefix}-from" type="text" inputmode="numeric" placeholder="dd.mm.jjjj" value="${absence.fromMs ? Utils.fmtDateOnly(new Date(absence.fromMs)) : ''}">
            </div>
            <div class="field">
                <label for="${prefix}-until">Bis (TT.MM.JJJJ, leer = offen)</label>
                <input id="${prefix}-until" type="text" inputmode="numeric" placeholder="dd.mm.jjjj" value="${absence.untilMs ? Utils.fmtDateOnly(new Date(absence.untilMs)) : ''}">
            </div>
        </div>`,

    readAbsencePeriod: (prefix = 'abs') => {
        const fromRaw = q(`#${prefix}-from`)?.value.trim() || '';
        const untilRaw = q(`#${prefix}-until`)?.value.trim() || '';
        const fromMs = fromRaw ? Utils.parseGermanDateTime(fromRaw, '00:00') : null;
        const untilMs = untilRaw ? Utils.parseGermanDateTime(untilRaw, '23:59') : null;
        if (fromRaw && !fromMs) throw new Error('Bitte das Startdatum im Format TT.MM.JJJJ eingeben.');
        if (untilRaw && !untilMs) throw new Error('Bitte das Enddatum im Format TT.MM.JJJJ eingeben.');
        if (fromMs && untilMs && untilMs < fromMs) throw new Error('Das Enddatum liegt vor dem Startdatum.');
        return { fromMs, untilMs };
    },

    renderAbsenceArea: async (user) => {
        const field = q('#s-absence-field');
        const area = q('#s-absence-area');
        if (!field || !area) return;
        const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin');
        field.hidden = !isAdmin;
        if (!isAdmin) return;
        const users = await Store.getUsers();
        const me = users.find(u => u.id === user.id);
        const absence = me?.absence || {};
        const substitutes = users.filter(u => u.username !== user.username && (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived);
        area.innerHTML = `
            <label class="check-row"><input type="checkbox" id="s-abs-active" ${absence.active || absence.pending ? 'checked' : ''}><span>Ich bin abwesend</span></label>
            ${Settings.absencePeriodMarkup(absence, 's-abs')}
            <div class="field">
                <label for="s-abs-sub">Vertretung</label>
                <select id="s-abs-sub">
                    <option value="">Keine – Tickets zurück ins Team</option>
                    ${substitutes.map(u => `<option value="${Utils.esc(u.username)}" ${absence.substitute === u.username ? 'selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                </select>
            </div>
            <label class="check-row"><input type="checkbox" id="s-abs-visible" ${absence.visible ? 'checked' : ''}><span>Anderen Admins anzeigen, dass ich abwesend bin</span></label>
            <div class="setting-row"><span class="hint">${absence.pending ? `Geplant ab ${new Date(absence.fromMs).toLocaleDateString('de-DE')}.` : 'Beim Start wird die Vertretung Hauptverantwortlicher aller offenen Tickets. Am Ende kannst du sie zurückholen.'}</span>
                <button class="btn-primary btn-sm" id="btn-save-absence">${Icon('save', 15)}Abwesenheit speichern</button>
            </div>`;
        q('#btn-save-absence').onclick = async () => {
            let period;
            try { period = Settings.readAbsencePeriod('s-abs'); } catch (error) { return UI.toast(error.message); }
            await AdminBoard.setAbsence(user.username, q('#s-abs-active').checked, q('#s-abs-sub').value || null, q('#s-abs-visible').checked, period.fromMs, period.untilMs);
            UI.toast('Abwesenheit gespeichert.');
            Settings.renderAbsenceArea(user);
        };
    },

    renderAccountArea: (user, settings) => {
        const field = q('#s-account-field');
        const area = q('#s-account-area');
        if (!field || !area) return;
        if (!user) { field.hidden = true; return; }
        const editable = { name: true, email: true, department: false, ...(settings.accountConfig?.editable || {}) };
        const rows = [
            { key: 'name', label: 'Name', value: user.name || '' },
            { key: 'email', label: 'E-Mail', value: user.email || '' },
            { key: 'department', label: 'Einrichtung / Abteilung', value: user.department || '' },
        ];
        const anyEditable = rows.some(row => editable[row.key]);
        field.hidden = false;
        area.innerHTML = `
            <div class="form-grid">
                ${rows.map(row => `<div class="field"><label for="acc-${row.key}">${row.label}${editable[row.key] ? '' : ' <span class="hint">(vom Administrator gesperrt)</span>'}</label><input id="acc-${row.key}" type="text" value="${Utils.esc(row.value)}"${editable[row.key] ? '' : ' disabled'}></div>`).join('')}
            </div>
            ${anyEditable ? `<div class="setting-row"><span class="hint">Nur die freigegebenen Felder kannst du ändern.</span>
                <button class="btn-primary btn-sm" id="btn-save-account">${Icon('save', 15)}Konto speichern</button>
            </div>` : ''}`;
        q('#btn-save-account')?.addEventListener('click', async () => {
            const users = await Store.getUsers();
            const target = users.find(u => u.id === user.id);
            if (!target) return;
            const emailValue = q('#acc-email')?.value.trim();
            if (editable.email && emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return UI.toast('Bitte eine gültige E-Mail-Adresse eingeben.');
            rows.forEach(row => {
                const el = q(`#acc-${row.key}`);
                if (el && editable[row.key]) target[row.key] = el.value.trim();
            });
            await Store.saveUsers(users);
            await Store.addGlobalLog('Konto geändert', `Benutzer: ${target.username}`);
            UI.toast('Konto gespeichert.');
        });
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
                        <div class="field field-wide" id="s-absence-field" hidden>
                            <label>Abwesenheit &amp; Vertretung</label>
                            <div id="s-absence-area"></div>
                        </div>
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
                        <div class="field field-wide" id="s-sec-field">
                            <label>${Lang.t('security')}</label>
                            <div id="s-sec-area">
                                <!-- Rendered dynamically -->
                            </div>
                        </div>
                        <div class="field field-wide" id="s-account-field" hidden>
                            <label>Konto</label>
                            <div id="s-account-area"></div>
                        </div>
                        <div class="field field-wide" id="s-notif-field">
                            <label>Benachrichtigungen</label>
                            <p class="hint">Lege fest, ob du Benachrichtigungen in der App, per E-Mail oder auf beiden Wegen erhalten möchtest. Grau hinterlegte Einträge wurden vom Administrator fest vorgegeben.</p>
                            <div id="s-notif-area" class="notif-personal-list"></div>
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
                    await AdminBoard.render();
                    await AdminBoard.renderArchive();
                }
                if (q('#user-tickets')) await UserDash.renderList();
                Lang.applyToDOM();
                q('#sys-settings-modal')?.remove();
                modal.remove();
                Settings.openModal();
            };
        }

        const s = await Store.getSettings();
        Settings.renderState(modal, s);

        // Render Security Section
        const user = await Store.currentUser();
        q('#s-sec-field').hidden = !user;
        q('#s-notif-field').hidden = !user;
        Settings.renderAccountArea(user, s);
        Settings.renderAbsenceArea(user);
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

        await Settings.renderNotifArea(user);

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },
    renderNotifArea: async (user) => {
        const area = q('#s-notif-area');
        if (!area || !user) return;
        const policy = await Store.getNotifPolicy();
        const role = Store.roleGroup(user);
        const rows = [];
        Object.entries(Store.notifTypeMeta).forEach(([type, meta]) => {
            if (!meta.roles.includes(role)) return;
            const rule = policy[type]?.[role];
            if (!rule) return;
            const personal = user.notifPrefs?.[type] || {};
            const appValue = rule.appLocked ? rule.defaultApp : (typeof personal.app === 'boolean' ? personal.app : rule.defaultApp);
            const emailValue = rule.emailLocked ? rule.defaultEmail : (typeof personal.email === 'boolean' ? personal.email : rule.defaultEmail);
            rows.push(`
                <div class="notif-personal-row${rule.appLocked && rule.emailLocked ? ' locked' : ''}" data-notif-type="${type}">
                    <div class="notif-matrix-label"><strong>${Utils.esc(meta.label)}</strong>${rule.appLocked && rule.emailLocked ? '<span>Vom Administrator festgelegt</span>' : ''}</div>
                    <label class="check-row compact"><input type="checkbox" class="sn-app" ${appValue ? 'checked' : ''} ${rule.appLocked ? 'disabled' : ''}>In-App</label>
                    <label class="check-row compact"><input type="checkbox" class="sn-email" ${emailValue ? 'checked' : ''} ${rule.emailLocked ? 'disabled' : ''}>E-Mail</label>
                </div>`);
        });
        area.innerHTML = rows.join('') || '<div class="empty-state compact">Keine personalisierbaren Benachrichtigungen verfügbar.</div>';
        area.querySelectorAll('.notif-personal-row').forEach(row => {
            const type = row.dataset.notifType;
            const appBox = row.querySelector('.sn-app');
            const emailBox = row.querySelector('.sn-email');
            const persist = async () => {
                const users = await Store.getUsers();
                const target = users.find(u => u.id === user.id);
                if (!target) return;
                target.notifPrefs = target.notifPrefs || {};
                target.notifPrefs[type] = { app: appBox.checked, email: emailBox.checked };
                await Store.saveUsers(users);
                user.notifPrefs = target.notifPrefs;
            };
            if (!appBox.disabled) appBox.onchange = persist;
            if (!emailBox.disabled) emailBox.onchange = persist;
        });
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
    createFiles: [],
    activeIncident: null,

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
            const selectedPrio = q('#t-prio').value;
            const configuredPrio = settings.generalConfig?.defaultPrio;
            const prio = ['Niedrig', 'Normal', 'Hoch'].includes(selectedPrio) ? selectedPrio :
                (['Niedrig', 'Normal', 'Hoch'].includes(configuredPrio) ? configuredPrio : 'Normal');
            // Get values from custom multi-select
            const selectedCats = UserDash.categoryInstance ? UserDash.categoryInstance.getValue() : ['Allgemein'];
            const cat = selectedCats.length > 0 ? selectedCats : ['Allgemein'];

            if (!title) {
                UI.toast('Bitte Titel angeben');
                return;
            }

            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#t-custom-fields'));
            if (missingFields.length) {
                UI.toast(`Bitte Pflichtfeld${missingFields.length > 1 ? 'er' : ''} ausfüllen: ${missingFields.join(', ')}`);
                return;
            }

            if (UserDash.createFiles.some(file => file.size > 15 * 1024 * 1024)) {
                UI.toast('Anhänge dürfen maximal 15 MB groß sein.');
                return;
            }
            const activeIncidents = (await Store.getTickets()).filter(t => t.isMajorIncident && t.status !== 'Geschlossen' && !t.archived);
            let linkedIncidentId = null;
            if (activeIncidents.length) {
                const choice = await UI.askIncidentLink(activeIncidents);
                if (choice === undefined) return;
                linkedIncidentId = choice;
            }
            const tickets = await Store.getTickets();
            let ticketNumberData;
            try {
                ticketNumberData = Store.nextTicketNumber(tickets, cat, settings);
            } catch (error) {
                UI.toast('Ticketnummernformat ungültig: Das Format muss {number} enthalten.');
                return;
            }
            let attachments = [];
            try {
                attachments = await Promise.all(UserDash.createFiles.map(file => Store.saveAttachment(file)));
            } catch (error) {
                console.error(error);
                UI.toast('Anhänge konnten nicht gespeichert werden. Bitte erneut versuchen.');
                return;
            }

            const user = await Store.currentUser();
            const newTicket = {
                id: Utils.uid(),
                ticketNumber: ticketNumberData.ticketNumber,
                ticketNumberSequence: ticketNumberData.ticketNumberSequence,
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
                attachments,
                archived: false,
                customFieldValues,
                linkedIncidentId
            };
            const autoTeam = Store.autoAssignTeam(newTicket, settings, await Store.getGroups());
            if (autoTeam) {
                newTicket.team = autoTeam.id;
                newTicket.assignees = [...new Set([...(newTicket.assignees || []), ...autoTeam.members])];
            }
            tickets.push(newTicket);
            await Store.addLog(newTicket, autoTeam ? `Ticket erstellt und automatisch Team "${autoTeam.name}" zugewiesen` : 'Ticket erstellt');
            await Store.addGlobalLog('Neues Ticket erstellt', `Titel: ${newTicket.title}`);
            await Store.saveTickets(tickets);
            const admins = (await Store.getUsers()).filter(person => person.role === 'admin' || person.role === 'superadmin');
            await Store.addNotifications(admins.map(person => person.username), newTicket, 'Neues Ticket wurde erstellt.', user.username, 'newTicket');
            await Notifications.refresh();

            // Admins per E-Mail benachrichtigen, je nach persönlicher/administrativer Einstellung
            if (settings.emailConfig && settings.emailConfig.host) {
                for (const admin of admins) {
                    if (!admin.email) continue;
                    const pref = await Store.resolveNotifPref(admin, 'newTicket');
                    if (pref.email) Store.sendEmail(admin.email, `Neues Ticket: ${title}`, `Ticket #${newTicket.id} von ${user.name || user.username} erstellt.`);
                }
            }

            UI.toast('Ticket erstellt!');
            q('#t-title').value = '';
            q('#t-desc').value = '';
            UserDash.createFiles = [];
            if (q('#t-files')) q('#t-files').value = '';
            UserDash.renderCreateFilePreview();
            if (q('#t-prio')) q('#t-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(settings.generalConfig?.defaultPrio) ? settings.generalConfig.defaultPrio : 'Normal';
            UI.renderCustomFieldsForm(q('#t-custom-fields'), Store.getCustomFieldsForCategories(cat, settings));
            await UserDash.renderList();
        };

        const createFileInput = q('#t-files');
        if (createFileInput) createFileInput.onchange = () => {
            UserDash.createFiles.push(...Array.from(createFileInput.files || []));
            createFileInput.value = '';
            UserDash.renderCreateFilePreview();
        };
        const createDropzone = q('#t-files-dropzone');
        if (createDropzone) {
            ['dragenter', 'dragover'].forEach(evt => createDropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                createDropzone.classList.add('drag-over');
            }));
            ['dragleave', 'dragend'].forEach(evt => createDropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                createDropzone.classList.remove('drag-over');
            }));
            createDropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                createDropzone.classList.remove('drag-over');
                UserDash.createFiles.push(...Array.from(e.dataTransfer?.files || []));
                UserDash.renderCreateFilePreview();
            });
        }

        // ... Key listeners for Create Ticket ...
        q('#t-title').onkeydown = (e) => {
            if (e.key === 'Enter') q('#btn-create-ticket').click();
        };

        // Populate Categories dynamically with Custom Multi-Select
        const catContainer = q('#u-cat-container');
        if (catContainer) {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            if (q('#t-prio')) q('#t-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(settings.generalConfig?.defaultPrio) ? settings.generalConfig.defaultPrio : 'Normal';
            const initial = categories.includes('Allgemein') ? ['Allgemein'] : categories.slice(0, 1);
            const refreshCustomFields = (selectedCats) => {
                const fields = Store.getCustomFieldsForCategories(selectedCats, settings);
                UI.renderCustomFieldsForm(q('#t-custom-fields'), fields);
            };
            UserDash.categoryInstance = UI.createMultiSelect(catContainer, categories, initial, refreshCustomFields);
            refreshCustomFields(initial);
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
        const userChatInput = q('#u-chat-input');
        if (userChatInput) {
            q('#u-chat-bold').onclick = () => insertMarkdownText(userChatInput, '**');
            q('#u-chat-italic').onclick = () => insertMarkdownText(userChatInput, '*');
            q('#u-chat-link').onclick = () => insertMarkdownLink(userChatInput);
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

    renderCreateFilePreview: () => {
        const preview = q('#t-files-preview');
        if (!preview) return;
        preview.innerHTML = '';
        preview.style.display = UserDash.createFiles.length ? 'flex' : 'none';
        UserDash.createFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'file-chip file-chip-clickable';
            chip.title = 'Vorschau anzeigen';
            chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="Entfernen" aria-label="${Utils.esc(file.name)} entfernen">${Icon('x', 13)}</button>`;
            chip.querySelector('span').onclick = async () => {
                const data = await Store.readFile(file);
                AdminBoard.openAttachmentPreview({ name: file.name, type: file.type, data });
            };
            chip.querySelector('button').onclick = () => {
                UserDash.createFiles.splice(index, 1);
                UserDash.renderCreateFilePreview();
            };
            preview.appendChild(chip);
        });
        if (window.lucide) lucide.createIcons();
    },

    // ... renderList, openModal, closeModal ...
    currentTicketId: null,

    openModal: async (id) => {
        UserDash.currentTicketId = id;
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;

        if (q('#u-m-title')) q('#u-m-title').textContent = `${t.ticketNumber || t.id} · ${t.title}${t.archived ? ` (${Lang.t('archived')})` : ''}`;
        if (q('#u-m-desc')) q('#u-m-desc').textContent = t.desc || Lang.t('noDescription');
        {
            const incidentBox = q('#u-m-incident');
            if (incidentBox) {
                const incident = t.linkedIncidentId ? (await Store.getTickets()).find(x => x.id === t.linkedIncidentId) : null;
                incidentBox.hidden = !incident;
                incidentBox.innerHTML = incident ? `<div class="incident-notice-text"><strong>${Icon('siren', 14)}Zugeordnete Störung</strong><span>${Utils.esc(incident.ticketNumber || incident.id)} · ${Utils.esc(incident.title)}</span></div>` : '';
            }
        }
        {
            const fieldsSettings = await Store.getSettings();
            UI.renderCustomFieldsDisplay(q('#u-m-custom-fields-display'), Store.getCustomFieldsForCategories(t.category, fieldsSettings), t.customFieldValues || {});
        }
        AdminBoard.renderTicketAttachments(t, '#u-m-ticket-attachments');

        // Read-only check for archived
        const uChatInput = q('#u-chat-input');
        const uChatSend = q('#u-chat-send');
        if (uChatInput) uChatInput.disabled = t.archived;
        if (uChatSend) uChatSend.disabled = t.archived;

        // Metadata
        if (q('#u-m-status')) {
            q('#u-m-status').innerHTML = `<span class="status-badge"><span class="status-dot" style="--dot:${getStatusColor(t.status)}"></span>${Lang.status(t.status)}</span>`;
        }
        const waitingRequest = q('#u-waiting-request');
        if (waitingRequest) {
            const showRequest = t.status === 'Warten auf Benutzer' && !!t.waitingMessage;
            waitingRequest.hidden = !showRequest;
            q('#u-waiting-message').textContent = showRequest ? t.waitingMessage : '';
        }
        if (q('#u-m-date')) q('#u-m-date').textContent = Utils.fmtDate(t.createdAt);

        // Lösungsfrist für Benutzer: nur wenn in den Systemeinstellungen aktiviert, und
        // immer dezent (neutrale Farbe) – nie als Alarm, auch nicht bei Überschreitung.
        const slaItemUser = q('#u-m-sla-item');
        if (slaItemUser) {
            const slaSettingsForUser = await Store.getSettings();
            const slaCountdownUser = slaSettingsForUser.generalConfig?.showSlaToUsers
                ? Store.formatSlaCountdown(t, slaSettingsForUser)
                : null;
            slaItemUser.hidden = !slaCountdownUser;
            if (slaCountdownUser) {
                q('#u-m-sla-badge').innerHTML = `${Icon('timer', 13)}${Utils.esc(slaCountdownUser.label)}`;
            }
        }

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
        const slaSettings = await Store.getSettings();

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
                const isOverdue = !!slaSettings.generalConfig?.showSlaToUsers && Store.isTicketOverdue(t, slaSettings);
                const el = document.createElement('div');
                el.className = `table-row user-ticket-row${t.archived ? ' is-archived' : ''}${isOverdue ? ' is-overdue-dezent' : ''}`;

                const cats = Array.isArray(t.category) ? t.category : [t.category || '-'];
                const catBadges = cats.map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('');
                const archivedBadge = t.archived ? `<span class="archive-badge">${Icon('archive', 12)}${Lang.t('archived')}</span>` : '';
                const overdueBadge = isOverdue ? `<span class="sla-overdue-icon sla-badge-muted" title="Frist überschritten">${Icon('timer', 11)}</span>` : '';

                el.innerHTML = `
                    <span class="status-dot" style="--dot:${getStatusColor(t.status)}" title="${Utils.esc(Lang.status(t.status))}"></span>
                    <div class="ticket-row-main">
                        <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.title)}</div>
                        <div class="ticket-row-cats"><span class="ticket-number">${Utils.esc(t.ticketNumber || t.id)}</span>${catBadges}${archivedBadge}${overdueBadge}</div>
                    </div>
                    <div class="ticket-row-status${String(t.status).startsWith('Warten auf') ? ' is-waiting' : ''}"><span class="status-badge">${Lang.status(t.status)}</span></div>
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
    if (String(s).startsWith('Warten auf')) return 'var(--wait)';
    if (s === 'Geschlossen') return 'var(--success)';
    return 'var(--text-sec)';
}

function getPrioValue(p) {
    if (p === 'Kritisch') return 3;
    if (p === 'Hoch') return 2;
    if (p === 'Normal') return 1;
    return 0;
}

function insertMarkdownText(area, marker) {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.substring(start, end);
    const wrapped = `${marker}${selected}${marker}`;
    area.value = area.value.substring(0, start) + wrapped + area.value.substring(end);
    area.focus();
    area.selectionStart = start + marker.length;
    area.selectionEnd = end + marker.length;
}

async function insertMarkdownLink(area) {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.substring(start, end).replace(/[\[\]]/g, '');
    const href = await UI.promptText({
        title: 'Link einfügen',
        label: 'Link-Adresse',
        value: selected && /^(https?:\/\/|mailto:)/i.test(selected) ? selected : '',
        placeholder: 'https://example.com oder mailto:name@example.com',
        saveLabel: 'Link einfügen'
    });
    if (!href) return;
    if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) {
        UI.toast('Nur http-, https- und mailto-Links sind erlaubt.');
        return;
    }
    const label = selected || href.trim();
    const markdown = `[${label}](${href.trim()})`;
    area.value = area.value.substring(0, start) + markdown + area.value.substring(end);
    area.focus();
    area.selectionStart = start + markdown.length;
    area.selectionEnd = area.selectionStart;
}

function insertMarkdownTable(area) {
    const table = '| Überschrift 1 | Überschrift 2 |\n| --- | --- |\n| Eintrag | Eintrag |';
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const before = area.value.slice(0, start);
    const after = area.value.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n' : '';
    area.setRangeText(`${prefix}${table}${suffix}`, start, end, 'end');
    area.focus();
    area.dispatchEvent(new Event('input', {
        bubbles: true
    }));
}

// --- Admin Kanban Logic ---
const AdminBoard = {
    selectedFiles: [],
    slaRefreshTimer: null,
    noteFiles: {
        'admin-chat': [],
        solution: []
    },

    orderTopbar: () => {
        const nav = q('.topbar-right');
        if (!nav) return;
        ['btn-to-dash', 'btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings', 'btn-notifications', 'theme-toggle', 'btn-settings', 'logout'].forEach(id => {
            const el = q(`#${id}`);
            if (el && el.parentElement === nav) nav.appendChild(el);
        });
    },

    canAccessTicket: (user, ticket) => {
        if (!user || !ticket || !['admin', 'superadmin'].includes(user.role)) return false;
        if (user.role === 'superadmin') return true;
        if (!ticket.owner && !(ticket.assignees || []).length) return true;
        const departments = Array.isArray(user.dept) ? user.dept : [user.dept || 'Allgemein'];
        const categories = Array.isArray(ticket.category) ? ticket.category : [ticket.category || 'Allgemein'];
        const assignedUsers = [ticket.owner, ticket.assignee, ...(ticket.assignees || []), ...(ticket.participants || [])];
        return departments.includes('All') || categories.some(category => departments.includes(category)) || assignedUsers.includes(user.username);
    },

    // SLA-Felder: intern wird immer in Stunden gespeichert, angezeigt wird in der
    // Einheit, die sich am natürlichsten liest (volle Tage als "Tage", sonst "Stunden").
    setSlaField: (key, hours) => {
        const input = q(`#sys-sla-${key}`);
        const unitSelect = q(`#sys-sla-${key}-unit`);
        if (!input || !unitSelect) return;
        const asDays = hours >= 24 && hours % 24 === 0;
        unitSelect.value = asDays ? 'days' : 'hours';
        input.value = asDays ? hours / 24 : hours;
    },
    getSlaField: (key, fallbackHours) => {
        const input = q(`#sys-sla-${key}`);
        const unitSelect = q(`#sys-sla-${key}-unit`);
        const raw = parseFloat(input?.value);
        const value = Number.isFinite(raw) && raw > 0 ? raw : fallbackHours;
        return unitSelect?.value === 'days' ? value * 24 : value;
    },

    roleLabel: { user: 'Benutzer', admin: 'Admins' },
    renderNotifMatrix: (container, policy) => {
        if (!container) return;
        const rows = [];
        Object.entries(Store.notifTypeMeta).forEach(([type, meta]) => {
            meta.roles.forEach(role => {
                const rule = policy[type]?.[role] || { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false };
                rows.push(`
                    <div class="notif-matrix-row" data-notif-type="${type}" data-notif-role="${role}">
                        <div class="notif-matrix-label"><strong>${Utils.esc(meta.label)}</strong><span>${AdminBoard.roleLabel[role]}</span></div>
                        <label class="check-row compact"><input type="checkbox" class="nm-default-app" ${rule.defaultApp ? 'checked' : ''}>In-App (Standard)</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-default-email" ${rule.defaultEmail ? 'checked' : ''}>E-Mail (Standard)</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-app-configurable" ${!rule.appLocked ? 'checked' : ''}>In-App anpassbar</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-email-configurable" ${!rule.emailLocked ? 'checked' : ''}>E-Mail anpassbar</label>
                    </div>`);
            });
        });
        container.innerHTML = rows.join('');
    },
    readNotifMatrix: (container) => {
        const policy = {};
        if (!container) return policy;
        container.querySelectorAll('.notif-matrix-row').forEach(row => {
            const type = row.dataset.notifType;
            const role = row.dataset.notifRole;
            policy[type] = policy[type] || {};
            policy[type][role] = {
                defaultApp: row.querySelector('.nm-default-app').checked,
                defaultEmail: row.querySelector('.nm-default-email').checked,
                appLocked: !row.querySelector('.nm-app-configurable').checked,
                emailLocked: !row.querySelector('.nm-email-configurable').checked
            };
        });
        return policy;
    },

    refreshOverdueIndicator: async (tickets, user, settings) => {
        const button = q('#btn-overdue-tickets');
        if (!button) return;
        const visibleTickets = tickets.filter(ticket => !ticket.archived &&
            (user?.role !== 'admin' || AdminBoard.canAccessTicket(user, ticket)));
        const count = visibleTickets.filter(ticket => Store.isTicketOverdue(ticket, settings)).length;
        const section = q('#overdue-board');
        if (section) section.hidden = count === 0;
        const badge = q('#overdue-ticket-count');
        if (badge) badge.textContent = String(count);
        button.onclick = AdminBoard.openOverdueTickets;
        if (count) button.title = `${count} ${Lang.t('overdue')} ${Lang.t('tickets')}`;
    },

    openOverdueTickets: async () => {
        let modal = q('#sla-overdue-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sla-overdue-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('alarm-clock', 18)} ${Lang.t('overdue')} ${Lang.t('tickets')}</h3>
                        <button class="btn-ghost btn-icon" data-close-sla title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                    </div>
                    <div class="modal-body sla-overdue-list" id="sla-overdue-list"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('[data-close-sla]').onclick = () => modal.classList.remove('open');
            modal.onclick = event => {
                if (event.target === modal) modal.classList.remove('open');
            };
        }
        const user = await Store.currentUser();
        const settings = await Store.getSettings();
        const tickets = (await Store.getTickets()).filter(ticket =>
            !ticket.archived && (user?.role !== 'admin' || AdminBoard.canAccessTicket(user, ticket)) &&
            Store.isTicketOverdue(ticket, settings)
        ).sort((a, b) => Store.ticketSlaDueAt(a, settings) - Store.ticketSlaDueAt(b, settings));
        const list = q('#sla-overdue-list');
        list.innerHTML = tickets.length ? tickets.map(ticket => {
            const deadline = Store.ticketSlaDueAt(ticket, settings);
            const overdueMinutes = Math.max(1, Math.floor((Date.now() - deadline) / 60000));
            const overdueDuration = overdueMinutes >= 1440 ? `${Math.floor(overdueMinutes / 1440)} ${Lang.t('dayShort')}` :
                overdueMinutes >= 60 ? `${Math.floor(overdueMinutes / 60)} ${Lang.t('hourShort')}` : `${overdueMinutes} ${Lang.t('minuteShort')}`;
            const overdueText = Lang.format('overdueSince', { time: overdueDuration });
            return `
                <button class="sla-overdue-item" type="button" data-ticket-id="${Utils.esc(ticket.id)}">
                    <span class="sla-overdue-icon">${Icon('triangle-alert', 16)}</span>
                    <span class="sla-overdue-copy">
                        <strong>${Utils.esc(ticket.ticketNumber || ticket.id)} · ${Utils.esc(ticket.title)}</strong>
                        <span>${Lang.prio(ticket.prio)} · Frist ${Utils.fmtDate(new Date(deadline).toISOString())}</span>
                        <time>${overdueText}</time>
                    </span>
                </button>`;
        }).join('') : `<div class="empty-state">${Lang.current === 'en' ? 'No overdue tickets' : 'Keine überfälligen Tickets'}</div>`;
        list.querySelectorAll('.sla-overdue-item').forEach(item => {
            item.onclick = async () => {
                modal.classList.remove('open');
                await AdminBoard.openModal(item.dataset.ticketId);
            };
        });
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    mentionCandidates: [],
    mentionStart: 0,
    mentionEnd: 0,
    mentionActiveIndex: 0,

    setupMentionAutocomplete: async (ticket) => {
        const menu = q('#m-admin-mention-picker');
        const input = q('#m-admin-new-comment');
        if (!menu || !input) return;
        if (menu.parentElement !== document.body) document.body.appendChild(menu);
        const currentUser = await Store.currentUser();
        AdminBoard.mentionCandidates = (await Store.getUsers()).filter(user =>
            user.username !== currentUser?.username && AdminBoard.canAccessTicket(user, ticket)
        );
        menu.hidden = true;
        input.oninput = () => AdminBoard.renderMentionSuggestions(input, menu);
        input.onkeydown = event => {
            if (menu.hidden) return;
            const options = [...menu.querySelectorAll('[role="option"]')];
            if (event.key === 'Escape') {
                menu.hidden = true;
            } else if (options.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                AdminBoard.mentionActiveIndex = (AdminBoard.mentionActiveIndex + direction + options.length) % options.length;
                options.forEach((option, index) => {
                    option.classList.toggle('is-active', index === AdminBoard.mentionActiveIndex);
                    option.setAttribute('aria-selected', String(index === AdminBoard.mentionActiveIndex));
                });
            } else if (event.key === 'Enter' && options.length) {
                event.preventDefault();
                options[AdminBoard.mentionActiveIndex]?.click();
            }
        };
        menu.onmousedown = event => event.preventDefault();
    },

    renderMentionSuggestions: (input, menu) => {
        const beforeCursor = input.value.slice(0, input.selectionStart);
        const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
        if (!match) {
            menu.hidden = true;
            return;
        }
        const query = match[1].toLowerCase();
        const matches = AdminBoard.mentionCandidates.filter(user =>
            user.username.toLowerCase().includes(query) || String(user.name || '').toLowerCase().includes(query)
        );
        AdminBoard.mentionStart = input.selectionStart - match[1].length - 1;
        AdminBoard.mentionEnd = input.selectionStart;
        AdminBoard.mentionActiveIndex = 0;
        menu.replaceChildren();
        matches.forEach((user, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.role = 'option';
            option.className = `mention-suggestion${index === 0 ? ' is-active' : ''}`;
            option.textContent = `${user.name || user.username} (@${user.username})`;
            option.setAttribute('aria-selected', String(index === 0));
            option.onclick = () => {
                input.setRangeText(`@${user.username} `, AdminBoard.mentionStart, AdminBoard.mentionEnd, 'end');
                menu.hidden = true;
                input.focus();
                input.dispatchEvent(new Event('input', {
                    bubbles: true
                }));
            };
            menu.appendChild(option);
        });
        if (!matches.length) {
            const empty = document.createElement('span');
            empty.className = 'mention-suggestion-empty';
            empty.textContent = 'Keine Admins mit Ticketzugriff gefunden';
            menu.appendChild(empty);
        }
        const rect = input.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left)}px`;
        menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220))}px`;
        menu.hidden = false;
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

    renderTicketAttachments: (ticket, selector) => {
        const container = q(selector);
        if (!container) return;
        const attachments = ticket.attachments || [];
        container.innerHTML = '';
        container.hidden = attachments.length === 0;
        if (!attachments.length) return;
        const heading = document.createElement('h4');
        heading.className = 'section-title';
        heading.textContent = 'Anhänge';
        const list = document.createElement('div');
        list.className = 'ticket-attachment-list';
        attachments.forEach((file, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-chip';
            button.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name || 'Anhang')}</span>`;
            button.onclick = () => AdminBoard.openAttachmentPreview(attachments[index]);
            list.appendChild(button);
        });
        container.append(heading, list);
        if (window.lucide) lucide.createIcons();
    },

    init: async () => {
        if (!q('.kanban-board')) return;

        const internalPane = q('#tab-internal');
        const internalSection = q('#tab-details .comments-section');
        if (internalPane && internalSection && internalSection.parentElement !== internalPane) {
            internalPane.appendChild(internalSection);
        }

        // Superadmin UI Injection
        // Admin UI Visibility
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        const canManageUsers = isSuper || !!user?.canManageUsers;
        const canManage2FA = isSuper || !!user?.canManage2FA;
        const canUsers = canManageUsers || canManage2FA;
        const canReqs = isSuper || (user && user.canManageRequests);

        const actionsForAbsence = q('.topbar-right');
        if (actionsForAbsence && !q('#btn-absence-overview')) {
            const btn = document.createElement('button');
            btn.id = 'btn-absence-overview';
            btn.className = 'btn-ghost';
            btn.title = 'Abwesenheiten';
            btn.setAttribute('aria-label', 'Abwesenheiten');
            btn.innerHTML = `${Icon('plane', 16)}Abwesend`;
            btn.onclick = () => AdminBoard.openAbsenceOverview();
            actionsForAbsence.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
        }
        await AdminBoard.processAbsences();
        AdminBoard.renderAbsenceBanner(user);
        await AdminBoard.openAbsenceReturnPopup(user);
        AdminBoard.openArchivedAuthorDecisions(user);
        AdminBoard.openSubstituteNoticePopups(user);

        if (canUsers) {
            const actions = q('.topbar-right');
            if (actions) {
                if (!q('#btn-manage-users')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-manage-users';
                    btn.className = 'btn-ghost';
                    btn.innerHTML = `${Icon(canManageUsers ? 'users' : 'shield-check', 16)}${canManageUsers ? Lang.t('userMgmt') : '2FA-Verwaltung'}`;
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

        const reqBoard = q('#requests-board');
        if (reqBoard) {
            reqBoard.style.display = canReqs ? '' : 'none';
        }

        if (q('#btn-open-requests')) q('#btn-open-requests').onclick = async () => {
            await AdminBoard.renderRequests();
            q('#requests-modal').classList.add('open');
        };
        if (q('#requests-modal-close')) q('#requests-modal-close').onclick = () => q('#requests-modal').classList.remove('open');
        if (q('#requests-modal')) q('#requests-modal').onclick = event => {
            if (event.target === q('#requests-modal')) q('#requests-modal').classList.remove('open');
        };

        await AdminBoard.render();
        AdminBoard.setupDrag();
        if (!AdminBoard.slaRefreshTimer) AdminBoard.slaRefreshTimer = window.setInterval(() => AdminBoard.render(), 60000);

        // Archive View Toggle
        const btnArch = q('#btn-archive');
        const btnBack = q('#btn-back-kanban');
        const viewKanban = q('#kanban-view');
        const viewArchive = q('#archive-view');

        if (btnArch && viewKanban && viewArchive) {
            btnArch.onclick = () => {
                viewKanban.style.display = 'none';
                viewArchive.style.display = 'block';
                q('#list-view').style.display = 'none';
                setListViewButtonState(false);
                AdminBoard.renderArchive();
            };
            btnBack.onclick = () => {
                viewArchive.style.display = 'none';
                viewKanban.style.display = 'block';
                q('#list-view').style.display = 'none';
                AdminBoard.render();
            };
        }

        const btnListView = q('#btn-list-view');
        const setListViewButtonState = (active) => {
            if (!btnListView) return;
            btnListView.innerHTML = active ? `${Icon('layout-grid', 16)}${Lang.t('board')}` : `${Icon('table-properties', 16)}${Lang.t('list')}`;
            btnListView.title = active ? Lang.t('switchToBoard') : Lang.t('switchToList');
        };
        if (btnListView) {
            setListViewButtonState(false);
            btnListView.onclick = async () => {
                const isListActive = q('#list-view').style.display === 'block';
                viewArchive.style.display = 'none';
                if (isListActive) {
                    q('#list-view').style.display = 'none';
                    viewKanban.style.display = 'block';
                    setListViewButtonState(false);
                    await AdminBoard.render();
                } else {
                    viewKanban.style.display = 'none';
                    q('#list-view').style.display = 'block';
                    setListViewButtonState(true);
                    await AdminBoard.openListView();
                }
            };
        }

        const archSearch = q('#archive-search');
        if (archSearch) {
            archSearch.oninput = () => AdminBoard.renderArchive();
        }
        const ticketSearch = q('#admin-ticket-search');
        if (ticketSearch) ticketSearch.oninput = () => AdminBoard.render();
        const btnCreateTicket = q('#btn-admin-create-ticket');
        if (btnCreateTicket) btnCreateTicket.onclick = () => AdminBoard.openCreateTicketModal();
        const btnCreateIncident = q('#btn-admin-create-incident');
        if (btnCreateIncident) btnCreateIncident.onclick = () => AdminBoard.openIncidentCreateModal();

        // Setup Modal
        if (q('#m-close')) q('#m-close').onclick = AdminBoard.closeModal;
        if (q('#ticket-modal')) {
            q('#ticket-modal').onclick = (e) => {
                if (e.target.id === 'ticket-modal' || e.target.classList.contains('modal-container')) {
                    AdminBoard.closeModal();
                }
            };
        }
        qa('.internal-stream-tab').forEach(button => {
            button.onclick = () => {
                const selected = button.dataset.stream;
                qa('.internal-stream-tab').forEach(tab => {
                    const active = tab === button;
                    tab.classList.toggle('active', active);
                    tab.setAttribute('aria-selected', String(active));
                });
                qa('.internal-stream').forEach(stream => {
                    stream.classList.toggle('active', stream.dataset.stream === selected);
                });
            };
        });

        // Chat Send (Admin)
        if (q('#btn-chat-send')) {
            q('#btn-chat-send').onclick = () => AdminBoard.postChat('admin');
            q('#m-chat-input').onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') AdminBoard.postChat('admin');
            };
        }

        const noteChannels = [{
                channel: 'admin-chat',
                prefix: 'm-admin-note',
                input: '#m-admin-new-comment',
                send: '#btn-add-admin-comment'
            },
            {
                channel: 'solution',
                prefix: 'm-note',
                input: '#m-new-comment',
                send: '#btn-add-comment'
            }
        ];
        noteChannels.forEach(({
            channel,
            prefix,
            input: inputSelector,
            send
        }) => {
            const noteInput = q(inputSelector);
            const fileInput = q(`#${prefix}-file-input`);
            if (q(send)) q(send).onclick = () => AdminBoard.postInternalComment(channel);
            if (fileInput) fileInput.onchange = () => {
                Array.from(fileInput.files).forEach(file => AdminBoard.noteFiles[channel].push(file));
                AdminBoard.renderNoteFilePreview(channel);
                fileInput.value = '';
            };
            if (noteInput) {
                q(`#${prefix}-bold`).onclick = () => insertMarkdown(noteInput, '**');
                q(`#${prefix}-italic`).onclick = () => insertMarkdown(noteInput, '*');
                q(`#${prefix}-list`).onclick = () => {
                    const start = noteInput.selectionStart;
                    const end = noteInput.selectionEnd;
                    const selected = noteInput.value.substring(start, end) || 'Punkt';
                    const listText = selected.split('\n').map(line => `- ${line}`).join('\n');
                    noteInput.value = noteInput.value.substring(0, start) + listText + noteInput.value.substring(end);
                    noteInput.focus();
                };
                const numberedListButton = q(`#${prefix}-numbered`);
                if (numberedListButton) numberedListButton.onclick = () => {
                    const start = noteInput.selectionStart;
                    const end = noteInput.selectionEnd;
                    const selected = noteInput.value.substring(start, end) || 'Punkt';
                    const listText = selected.split('\n').map((line, index) => `${index + 1}. ${line}`).join('\n');
                    noteInput.value = noteInput.value.substring(0, start) + listText + noteInput.value.substring(end);
                    noteInput.focus();
                };
                const tableButton = q(`#${prefix}-table`);
                if (tableButton) tableButton.onclick = () => insertMarkdownTable(noteInput);
            }
            const search = q(`#${prefix}-search`);
            if (search) search.oninput = async () => {
                const tickets = await Store.getTickets();
                const ticket = tickets.find(item => item.id === AdminBoard.currentTicketId);
                if (ticket) AdminBoard.renderInternalComments(ticket, channel);
            };
        });

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
        if (q('#m-chat-link') && inputArea) q('#m-chat-link').onclick = () => insertMarkdownLink(inputArea);

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
        if (user.role === 'admin') tickets = tickets.filter(ticket => AdminBoard.canAccessTicket(user, ticket));
        const slaSettings = await Store.getSettings();
        await AdminBoard.refreshOverdueIndicator(tickets, user, slaSettings);
        const query = q('#admin-ticket-search')?.value || '';
        if (query.trim()) tickets = tickets.filter(ticket => Utils.matchesSearch(query, ticket));
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
            'Warten': q('#list-waiting'),
            'Geschlossen': q('#list-done')
        };
        const counts = {
            'Neu': 0,
            'In Bearbeitung': 0,
            'Warten': 0,
            'Geschlossen': 0
        };

        Object.values(cols).forEach(c => {
            if (c) c.innerHTML = '';
        });

        // Loop tickets but await createCard since it calls Store.getUsers()?
        // createCard uses Store.getUsers() to show assignees properly.
        const allUsers = await Store.getUsers();
        const allGroups = await Store.getGroups();

        tickets.filter(t => !t.linkedIncidentId).forEach(t => {
            const boardStatus = String(t.status).startsWith('Warten auf') ? 'Warten' : t.status;
            if (!cols[boardStatus]) {
                if (cols['Neu']) cols['Neu'].appendChild(createCard(t, allUsers));
                return;
            }
            counts[boardStatus]++;
            cols[boardStatus].appendChild(createCard(t, allUsers));
        });

        if (q('#count-new')) q('#count-new').textContent = counts['Neu'];
        if (q('#count-doing')) q('#count-doing').textContent = counts['In Bearbeitung'];
        if (q('#count-waiting')) q('#count-waiting').textContent = counts['Warten'];
        if (q('#count-done')) q('#count-done').textContent = counts['Geschlossen'];
        if (window.lucide) lucide.createIcons();

        AdminBoard.renderRequests();

        function createCard(t, usersList) {
            const card = document.createElement('div');
            const isWaiting = String(t.status || '').startsWith('Warten auf');
            const statusClass = isWaiting ? 'ticket-status-warten' : `ticket-status-${String(t.status || 'Neu').toLowerCase().replace(/\s+/g, '-')}`;
            const isOverdue = Store.isTicketOverdue(t, slaSettings);
            card.className = `ticket-card ${statusClass}${isOverdue ? ' is-overdue' : ''}`;
            card.draggable = true;
            card.dataset.id = t.id;

            const ownerUsername = t.owner || (Array.isArray(t.assignees) ? t.assignees[0] : t.assignee);
            const owner = ownerUsername ? usersList.find(x => x.username === ownerUsername) : null;
            const ownerLabel = owner ? (owner.name || owner.username) : (ownerUsername || Lang.t('unassigned'));
            // Nur die zuletzt gesendete Chat-Nachricht entscheidet, ob eine Antwort aussteht –
            // Statusänderungen o.ä. im Protokoll lösen keinen "wartet auf Antwort"-Hinweis aus.
            const latestChat = (t.chat || []).slice().sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))[0];
            const awaitingReply = latestChat?.role === 'user';
            const todoOpen = (t.todos || []).filter(todo => !todo.done).length;
            const todoTotal = (t.todos || []).length;
            const todoDone = todoTotal - todoOpen;
            const waitingReason = String(t.status || '').startsWith('Warten auf') ? Lang.status(t.status) : '';

            const linkedCount = t.isMajorIncident ? rawTickets.filter(x => x.linkedIncidentId === t.id && !x.archived).length : 0;
            const catList = (Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean);
            const categoryText = catList.length ? catList.slice(0, 2).join(', ') + (catList.length > 2 ? ` +${catList.length - 2}` : '') : '-';
            const sla = Store.formatSlaCountdown(t, slaSettings);
            const attachmentCount = (t.attachments || []).length;
            const tone = isOverdue ? 'overdue' : t.isMajorIncident ? 'incident' : t.prio === 'Kritisch' ? 'critical' : '';
            card.classList.add('card-v2');
            if (tone) card.classList.add(`card-tone-${tone}`);
            card.innerHTML = `
                <div class="card-line card-meta-line">
                    <span title="${Utils.esc(catList.join(', ') || '-')}">${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(categoryText)} · ${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                </div>
                <div class="card-title">${Utils.esc(t.title)}</div>
                <div class="card-line card-deadline-row">
                    ${sla ? `<span class="card-deadline sla-text-${sla.tone}" title="Frist: ${Utils.esc(sla.dueDateLabel)}">${Icon(sla.overdue ? 'triangle-alert' : 'timer', 11)}${Utils.esc(sla.label)}</span>` : '<span></span>'}
                    <span class="card-prio-outline prio-${t.prio}">${Lang.prio(t.prio)}</span>
                </div>
                <div class="card-line card-owner-line${ownerUsername ? '' : ' is-unassigned'}">
                    ${waitingReason ? `<span class="card-icon" title="${Utils.esc(waitingReason)}">${Icon('pause-circle', 12)}</span>` : ''}
                    ${awaitingReply ? `<span class="card-icon" title="${Lang.t('replyPending')}">${Icon('message-circle', 12)}</span>` : ''}
                    ${Icon('user', 12)}<span>${Utils.esc(ownerLabel)}</span>
                    ${t.isMajorIncident ? `<span class="t-incident-badge card-incident-badge" title="${Utils.esc(t.incidentNotice || Lang.t('majorIncident'))}">${Icon('siren', 11)}${Lang.t('majorIncident')} · ${linkedCount}</span>` : ''}
                </div>
                <div class="card-hover-meta" aria-hidden="true">
                    <span title="${Lang.t('messages')}">${Icon('message-square', 12)}${(t.chat?.length || 0)}</span>
                    <span title="${Lang.t('internalNotesShort')}">${Icon('notebook-tabs', 12)}${(t.comments?.length || 0)}</span>
                    <span title="Anhänge">${Icon('paperclip', 12)}${attachmentCount}</span>
                    <span title="${todoDone} von ${todoTotal} Teilaufgaben erledigt">${Icon('list-checks', 12)}${todoDone}/${todoTotal}</span>
                </div>
            `;
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', t.id);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            if (t.isMajorIncident) {
                card.addEventListener('dragover', e => {
                    const draggedId = e.dataTransfer.types.includes('text/plain');
                    if (!draggedId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    card.classList.add('incident-drop-target');
                });
                card.addEventListener('dragleave', () => card.classList.remove('incident-drop-target'));
                card.addEventListener('drop', async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    card.classList.remove('incident-drop-target');
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (!draggedId || draggedId === t.id) return;
                    const linked = await AdminBoard.linkTicketToIncident(draggedId, t.id);
                    if (linked) UI.toast('Ticket mit Großstörung verknüpft.');
                });
            }
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
                            <button class="btn-ghost btn-icon" id="btn-gl-print" title="Protokoll drucken" aria-label="Protokoll drucken">${Icon('printer', 16)}</button>
                            <button class="btn-ghost btn-icon btn-danger" id="btn-gl-clear" title="Protokoll leeren" aria-label="Protokoll leeren">${Icon('trash-2', 16)}</button>
                            <button class="btn-ghost btn-icon" title="${Lang.t('close')}" aria-label="${Lang.t('close')}" onclick="q('#global-logs-modal').classList.remove('open')">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="log-datetime-filters">
                        <label>Von ${UI.dateTimePickerMarkup('gl-from')}</label>
                        <label>Bis ${UI.dateTimePickerMarkup('gl-to')}</label>
                    </div>
                    <div class="modal-body flush" id="gl-body"></div>
                </div>`;
            document.body.appendChild(modal);

            q('#gl-search').oninput = () => AdminBoard.renderGlobalLogs();
            AdminBoard.glFromMs = null;
            AdminBoard.glToMs = null;
            UI.createDateTimePicker(q('#gl-from'), { onChange: (ms) => { AdminBoard.glFromMs = ms; AdminBoard.renderGlobalLogs(); } });
            UI.createDateTimePicker(q('#gl-to'), { onChange: (ms) => { AdminBoard.glToMs = ms; AdminBoard.renderGlobalLogs(); } });
            q('#btn-gl-clear').onclick = () => {
                UI.confirm('System-Protokoll wirklich vollständig leeren?', async () => {
                    await Store.saveGlobalLogs([]);
                    AdminBoard.renderGlobalLogs();
                    UI.toast('Protokoll geleert');
                });
            };
            q('#btn-gl-print').onclick = () => AdminBoard.printGlobalLogs();
        }

        AdminBoard.renderGlobalLogs();
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    getFilteredGlobalLogs: async () => {
        const logs = await Store.getGlobalLogs();
        const search = q('#gl-search')?.value.toLowerCase().trim() || '';
        const from = AdminBoard.glFromMs ?? -Infinity;
        const to = AdminBoard.glToMs ? AdminBoard.glToMs + 59999 : Infinity;
        const filtered = logs.filter(log => {
            const timestamp = new Date(log.date).getTime();
            return Utils.matchesSearch(search, log) && timestamp >= from && timestamp <= to;
        });
        return filtered.slice().reverse();
    },

    printGlobalLogs: async () => {
        const visibleLogs = await AdminBoard.getFilteredGlobalLogs();
        const settings = await Store.getSettings();
        const company = settings.companyConfig || {};
        const actor = await Store.currentUser();
        const rows = visibleLogs.map(l => `
            <tr>
                <td>${Utils.esc(Utils.fmtDate(l.date))}</td>
                <td>${Utils.esc(l.user || '-')}</td>
                <td>${Utils.esc(l.action || '-')}</td>
                <td>${Utils.esc(l.details || '')}</td>
            </tr>`).join('');
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>System-Protokoll</title>
            <style>
                body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain;}
                h1{font-size:18px;margin:0 0 4px;}
                .meta{color:#555;font-size:12px;margin-bottom:16px;}
                table{width:100%;border-collapse:collapse;font-size:12px;}
                th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;white-space:pre-line;}
                th{background:#f0f0f0;}
                tr:nth-child(even){background:#fafafa;}
            </style></head><body>
            <div class="print-head">
                <div>
                    <h1>System-Protokoll</h1>
                    <div class="meta">Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))} &middot; ${visibleLogs.length} Einträge</div>
                </div>
                ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}
            </div>
            <table><thead><tr><th>Datum/Uhrzeit</th><th>Benutzer</th><th>Aktion</th><th>Details</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">Keine Einträge gefunden.</td></tr>'}</tbody></table>
            </body></html>`;
        UI.printHTML(html);
    },

    renderGlobalLogs: async () => {
        const body = q('#gl-body');
        if (!body) return;

        const visibleLogs = await AdminBoard.getFilteredGlobalLogs();
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
        body.innerHTML = visibleLogs.length ?
            visibleLogs.map(l => UI.logRow({
                icon: iconForLog(l.action),
                user: l.user,
                date: l.date,
                action: l.action,
                details: l.details
            })).join('') :
            '<div class="empty-state">Keine Einträge gefunden.</div>';
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
        const canManageUsers = isSuper || !!currentUser?.canManageUsers;
        const canManage2FA = isSuper || !!currentUser?.canManage2FA;
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
                ${canManageUsers ? `<button class="btn-secondary btn-icon" id="btn-csv-export" title="CSV-Export" aria-label="CSV-Export">${Icon('download', 16)}</button>` : ''}
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-csv-import" title="CSV-Import" aria-label="CSV-Import">${Icon('upload', 16)}</button>` : ''}
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-ldap-sync" title="LDAP-Sync" aria-label="LDAP-Sync">${Icon('refresh-cw', 16)}</button>` : ''}
                ${canManageUsers ? `<button class="btn-primary" id="btn-add-user">${Icon('plus', 16)}Neu</button>` : ''}
            `;
            if (actions.querySelector('#btn-add-user')) actions.querySelector('#btn-add-user').onclick = () => AdminBoard.openEditUserModal(null, view);
            if (actions.querySelector('#btn-csv-export')) actions.querySelector('#btn-csv-export').onclick = () => AdminBoard.exportUsersCSV();
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
            if (u.accountArchived && !AdminBoard.showArchivedUsers) return false;
            if (!canManageUsers && (!canManage2FA || !u.twoFactorEnabled)) return false;

            return Utils.matchesSearch(searchTerm, u, groups.filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id)));
        });

        const archivedToggle = document.createElement('label');
        archivedToggle.className = 'check-row compact';
        archivedToggle.innerHTML = `<input type="checkbox" ${AdminBoard.showArchivedUsers ? 'checked' : ''}><span>Archivierte anzeigen</span>`;
        archivedToggle.querySelector('input').onchange = e => {
            AdminBoard.showArchivedUsers = e.target.checked;
            AdminBoard.renderUserManager(view);
        };
        list.appendChild(archivedToggle);

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
                    <span class="user-manager-name">${Utils.esc(u.username)}${u.twoFactorEnabled ? `<span class="badge badge-accent" title="2FA aktiv">${Icon('shield-check', 12)}2FA</span>` : ''}${u.accountLocked ? `<span class="badge badge-danger" title="Nach Fehlversuchen oder manuell gesperrt">${Icon('lock', 12)}Gesperrt</span>` : ''}${u.lockedUntil && u.lockedUntil > Date.now() ? `<span class="badge badge-danger" title="Vorübergehend nach Fehlversuchen gesperrt">${Icon('lock', 12)}Gesperrt bis ${new Date(u.lockedUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}${u.accountArchived ? `<span class="badge" title="Archiviert">${Icon('archive', 12)}Archiviert</span>` : ''}</span>
                    <span class="row-sub">${Utils.esc(u.name || '-')} · ${Utils.esc(u.email || 'Keine E-Mail')}</span>
                    <div class="group-chip-row">
                        <span class="badge">${Utils.esc(roleInfo)}</span>
                        ${userGroups.map(name => `<span class="group-chip">${Icon('users-round', 12)}${Utils.esc(name)}</span>`).join('')}
                        ${u.absence?.active ? `<span class="badge badge-accent" title="Vertretung aktiv">${Icon('plane', 12)}Abwesend${u.absence.substitute ? ' → ' + Utils.esc((users.find(x => x.username === u.absence.substitute)?.name) || u.absence.substitute) : ' → zurück ins Team'}</span>` : ''}
                    </div>
                </div>
                <div class="user-manager-actions">
                    ${(isSuper || canManage2FA) && u.twoFactorEnabled ? `<button class="btn-ghost btn-sm reset-2fa" title="2FA zurücksetzen">${Icon('unlock-keyhole', 15)}2FA</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' && !u.accountArchived ? `<button class="btn-ghost btn-icon lock-u" title="${u.accountLocked ? 'Entsperren' : 'Sperren'}" aria-label="${u.accountLocked ? 'Entsperren' : 'Sperren'}">${Icon(u.accountLocked ? 'lock-open' : 'lock', 16)}</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' ? `<button class="btn-ghost btn-icon archive-u" title="${u.accountArchived ? 'Reaktivieren' : 'Archivieren'}" aria-label="${u.accountArchived ? 'Reaktivieren' : 'Archivieren'}">${Icon(u.accountArchived ? 'archive-restore' : 'archive', 16)}</button>` : ''}
                    ${view === 'admins' && canManageUsers ? `<button class="btn-ghost btn-icon absence-btn" title="Abwesenheit &amp; Vertretung" aria-label="Abwesenheit und Vertretung">${Icon('plane', 16)}</button>` : ''}
                    ${canManageUsers ? `<button class="btn-ghost btn-icon edit-u" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>` : ''}
                    ${canManageUsers && u.role !== 'superadmin' && u.username !== 'admin' ? `<button class="btn-ghost btn-icon btn-danger del-u" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>` : ''}
                </div>
            `;

            const absenceBtn = el.querySelector('.absence-btn');
            if (absenceBtn) absenceBtn.onclick = () => AdminBoard.openAbsenceModal(u.username);

            const lockBtn = el.querySelector('.lock-u');
            if (lockBtn) lockBtn.onclick = async () => {
                const users = await Store.getUsers();
                const target = users.find(x => x.id === u.id);
                if (!target) return;
                target.accountLocked = !target.accountLocked;
                if (!target.accountLocked) target.failedLogins = 0;
                await Store.saveUsers(users);
                await Store.addGlobalLog(target.accountLocked ? 'Konto gesperrt' : 'Konto entsperrt', `Benutzer: ${u.username}`);
                UI.toast(target.accountLocked ? 'Konto gesperrt.' : 'Konto entsperrt.');
                AdminBoard.renderUserManager(view);
            };

            const archiveBtn = el.querySelector('.archive-u');
            if (archiveBtn) archiveBtn.onclick = () => {
                const restoring = !!u.accountArchived;
                UI.confirm(restoring ? `${u.username} reaktivieren?` : `${u.username} archivieren? Das Konto kann sich dann nicht mehr anmelden.`, async () => {
                    const users = await Store.getUsers();
                    const target = users.find(x => x.id === u.id);
                    if (!target) return;
                    target.accountArchived = !restoring;
                    if (restoring) target.accountLocked = false;
                    target.failedLogins = 0;
                    await Store.saveUsers(users);
                    await AdminBoard.applyArchiveConsequences(target, restoring);
                    await Store.addGlobalLog(restoring ? 'Konto reaktiviert' : 'Konto archiviert', `Benutzer: ${u.username}`);
                    UI.toast(restoring ? 'Konto reaktiviert.' : 'Konto archiviert.');
                    AdminBoard.renderUserManager(view);
                });
            };

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

            el.querySelector('.edit-u')?.addEventListener('click', () => AdminBoard.openEditUserModal(u, view));
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
            <div class="field field-wide">
                <label>Eigene Felder für diese Kategorie</label>
                <p class="hint">Zusätzliche Angaben, die beim Erstellen eines Tickets in dieser Kategorie abgefragt werden, z. B. Standort, Raum, Gerätenummer oder Kostenstelle.</p>
                <div id="cat-custom-fields" class="custom-fields-editor"></div>
                <button type="button" class="btn-secondary btn-sm" id="cat-add-field">${Icon('plus', 15)}Feld hinzufügen</button>
            </div>
        `;

        const allSettingsForFields = await Store.getSettings();
        const existingFields = (catName && allSettingsForFields.customFields?.[catName]) ? allSettingsForFields.customFields[catName].slice() : [];
        const fieldsContainer = q('#cat-custom-fields');
        // Aktuelle Eingaben aus dem DOM zurück ins Array schreiben, bevor neu gerendert wird --
        // sonst gehen Änderungen beim Hinzufügen/Entfernen eines anderen Feldes verloren.
        const syncFieldsFromDOM = () => {
            fieldsContainer.querySelectorAll('.custom-field-row').forEach(row => {
                const idx = Number(row.dataset.index);
                if (!existingFields[idx]) return;
                existingFields[idx].label = row.querySelector('.cf-label').value;
                existingFields[idx].type = row.querySelector('.cf-type').value;
                existingFields[idx].required = row.querySelector('.cf-required').checked;
                existingFields[idx].options = row.querySelector('.cf-options').value.split(',').map(s => s.trim()).filter(Boolean);
            });
        };
        const renderFieldRows = () => {
            fieldsContainer.innerHTML = existingFields.length ? existingFields.map((f, i) => `
                <div class="custom-field-row" data-index="${i}">
                    <input type="text" class="cf-label" placeholder="Feldname (z. B. Standort)" value="${Utils.esc(f.label || '')}">
                    <select class="cf-type">
                        <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
                        <option value="number" ${f.type === 'number' ? 'selected' : ''}>Zahl</option>
                        <option value="select" ${f.type === 'select' ? 'selected' : ''}>Auswahl</option>
                    </select>
                    <input type="text" class="cf-options" placeholder="Optionen, kommagetrennt" value="${Utils.esc((f.options || []).join(', '))}" style="${f.type === 'select' ? '' : 'display:none;'}">
                    <label class="check-row compact"><input type="checkbox" class="cf-required" ${f.required ? 'checked' : ''}>Pflicht</label>
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger cf-remove" title="Feld entfernen" aria-label="Feld entfernen">${Icon('x', 14)}</button>
                </div>`).join('') : '<div class="empty-state compact">Keine eigenen Felder definiert.</div>';
            fieldsContainer.querySelectorAll('.cf-type').forEach(sel => {
                sel.onchange = () => {
                    sel.closest('.custom-field-row').querySelector('.cf-options').style.display = sel.value === 'select' ? '' : 'none';
                };
            });
            fieldsContainer.querySelectorAll('.cf-remove').forEach(btn => {
                btn.onclick = () => {
                    syncFieldsFromDOM();
                    const idx = Number(btn.closest('.custom-field-row').dataset.index);
                    existingFields.splice(idx, 1);
                    renderFieldRows();
                };
            });
            if (window.lucide) lucide.createIcons();
        };
        renderFieldRows();
        q('#cat-add-field').onclick = () => {
            syncFieldsFromDOM();
            existingFields.push({ id: Utils.uid(), label: '', type: 'text', required: false, options: [] });
            renderFieldRows();
        };

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

            const collectedFields = Array.from(fieldsContainer.querySelectorAll('.custom-field-row')).map(row => ({
                id: existingFields[Number(row.dataset.index)]?.id || Utils.uid(),
                label: row.querySelector('.cf-label').value.trim(),
                type: row.querySelector('.cf-type').value,
                required: row.querySelector('.cf-required').checked,
                options: row.querySelector('.cf-type').value === 'select' ? row.querySelector('.cf-options').value.split(',').map(s => s.trim()).filter(Boolean) : []
            })).filter(f => f.label);
            settings.customFields = settings.customFields || {};
            if (catName && catName !== val) delete settings.customFields[catName];
            if (collectedFields.length) settings.customFields[val] = collectedFields;
            else delete settings.customFields[val];

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
            if (!name) {
                UI.toast('Bitte Gruppennamen angeben');
                return;
            }
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
                groups.push({
                    id: Utils.uid(),
                    name,
                    description,
                    members: selectedMembers
                });
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
                        <div class="field"><label>Einrichtung / Abteilung</label><input id="ue-department" type="text"></div>
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
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-2fa"><span>2FA von Benutzern zurücksetzen</span></label>
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
        q('#ue-department').value = isNew ? '' : (user.department || '');
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
        const man2FACheck = q('#ue-can-manage-2fa');
        if (manReqCheck) manReqCheck.checked = user ? !!user.canManageRequests : false;
        if (manUsersCheck) manUsersCheck.checked = user ? !!user.canManageUsers : false;
        if (viewLogsCheck) viewLogsCheck.checked = user ? !!user.canViewLogs : false;
        if (man2FACheck) man2FACheck.checked = user ? !!user.canManage2FA : false;

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
            AdminBoard.selectedGroupIds = [...userGroupIds];
            UI.createMultiSelect(groupList, groups.map(g => ({ value: g.id, label: g.name })), userGroupIds, ids => {
                AdminBoard.selectedGroupIds = ids;
            });
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
            const gVal = [...(AdminBoard.selectedGroupIds || [])];

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
                    canViewLogs: rVal === 'admin' ? q('#ue-can-view-logs').checked : false,
                    canManage2FA: rVal === 'admin' ? q('#ue-can-manage-2fa').checked : false
                };
                users.push(newUser);
                await Store.addGlobalLog('Benutzer erstellt', `Name: ${newUser.name || newUser.username}, Rolle: ${newUser.role}`);
            } else {
                const target = users.find(x => x.id === user.id);
                if (target) {
                    target.name = nVal;
                    target.email = eVal;
                    target.department = q('#ue-department').value.trim();
                    if (pVal) target.password = pVal;
                    // Only superadmins can change these
                    if (isSuper) {
                        target.role = rVal;
                        target.canManageRequests = rVal === 'admin' ? q('#ue-can-manage-req').checked : false;
                        target.canManageUsers = rVal === 'admin' ? q('#ue-can-manage-users').checked : false;
                        target.canViewLogs = rVal === 'admin' ? q('#ue-can-view-logs').checked : false;
                        target.canManage2FA = rVal === 'admin' ? q('#ue-can-manage-2fa').checked : false;
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

    // Das generische Modal versteckt seine Fußzeile standardmäßig (Speichern läuft über das
    // Disketten-Icon im Kopf). Für Dialoge, bei denen ein eindeutig beschrifteter Button
    // klarer ist, blendet diese Funktion die Fußzeile sichtbar ein (nur für das übergebene,
    // bereits individualisierte Modal-Element -- nie das geteilte #generic-modal selbst).
    makeModalFooterVisible: (modal) => {
        const footer = modal.querySelector('.modal-footer');
        if (!footer) return;
        footer.classList.remove('action-footer');
        footer.classList.add('modal-footer-visible');
        footer.querySelectorAll('.footer-cancel, .close-m').forEach(btn => btn.classList.remove('footer-cancel', 'close-m'));
        // Das Disketten-Icon im Kopf wäre jetzt doppelt zum sichtbaren Speichern-Button in der Fußzeile
        modal.querySelector('#generic-save-head')?.remove();
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
                        <button class="tab-btn" data-tab="sys-assignment">
                            <i data-lucide="route"></i><span>Zuweisung</span>
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
                                    <input type="checkbox" id="notif-account-approved">
                                    <span class="check-text"><strong>${Lang.t('notifyAccountApproved')}</strong><span>${Lang.t('notifyAccountApprovedDesc')}</span></span>
                                </label>
                            </div>

                            <div class="settings-section-title">${Icon('sliders-horizontal', 15)}Richtlinie je Ereignis (Benutzer &amp; Admins getrennt)</div>
                            <p class="hint">Standardwerte gelten, solange ein Benutzer nichts eigenes einstellt. Wird ein Kästchen unter „Anpassbar" deaktiviert, ist der Standardwert für alle verbindlich.</p>
                            <div id="sys-notif-matrix" class="notif-matrix"></div>
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
                                <div class="hint">${Lang.t('securityHint')}</div>
                            </div>
                            <div class="field">
                                <label>${Lang.t('sessionTimeout')}</label>
                                <input id="sys-session-timeout" type="number" placeholder="0" min="0">
                            </div>
                            <div class="field">
                                <label>${Lang.t('maxLoginAttempts')}</label>
                                <input id="sys-max-login-attempts" type="number" placeholder="0" min="0">
                            </div>
                            <div class="field">
                                <label>Was passiert nach Erreichen der Fehlversuche?</label>
                                <select id="sys-lockout-action">
                                    <option value="lock">Konto sperren (Admin muss entsperren)</option>
                                    <option value="temp">Konto vorübergehend sperren</option>
                                    <option value="none">Nur protokollieren</option>
                                </select>
                            </div>
                            <div class="field" id="sys-lockout-minutes-field">
                                <label>Sperrdauer (Minuten)</label>
                                <input id="sys-lockout-minutes" type="number" placeholder="15" min="1">
                            </div>
                            <div class="settings-section-title">Konto-Selbstverwaltung</div>
                            <div class="hint">Welche Angaben dürfen Benutzer in ihrem Konto selbst ändern?</div>
                            <label class="check-row"><input type="checkbox" id="sys-acc-name"><span>Name</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-email"><span>E-Mail</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-dept"><span>Einrichtung / Abteilung</span></label>
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
                            <div class="settings-section-title">Lösungsfrist je Priorität</div>
                            <div class="hint">Zeit bis zur Lösung, wahlweise in Stunden oder Tagen.</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-sla-low">Niedrig</label><div class="sla-field-row"><input id="sys-sla-low" type="number" min="0.25" step="0.25"><select id="sys-sla-low-unit" aria-label="Einheit Niedrig"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-normal">Normal</label><div class="sla-field-row"><input id="sys-sla-normal" type="number" min="0.25" step="0.25"><select id="sys-sla-normal-unit" aria-label="Einheit Normal"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-high">Hoch</label><div class="sla-field-row"><input id="sys-sla-high" type="number" min="0.25" step="0.25"><select id="sys-sla-high-unit" aria-label="Einheit Hoch"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-critical">Kritisch</label><div class="sla-field-row"><input id="sys-sla-critical" type="number" min="0.25" step="0.25"><select id="sys-sla-critical-unit" aria-label="Einheit Kritisch"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                            </div>
                            <label class="check-row sla-user-visibility-row">
                                <input type="checkbox" id="sys-sla-show-users">
                                <span class="check-text"><strong>Frist auch Benutzern anzeigen</strong><span>Dezenter Hinweis im Ticket, ohne Alarmfarben – auch wenn die Frist überschritten ist.</span></span>
                            </label>

                            <div class="settings-section-title">Geschäftszeiten für Fristen</div>
                            <label class="check-row">
                                <input type="checkbox" id="sys-bh-enabled">
                                <span class="check-text"><strong>Geschäftszeiten berücksichtigen</strong><span>Außerhalb dieser Zeiten sowie an Feiertagen läuft die Lösungsfrist nicht weiter.</span></span>
                            </label>
                            <div class="field field-wide">
                                <label>Geschäftszeiten je Tag</label>
                                <div class="business-hours-grid" id="sys-bh-days">
                                    ${[1, 2, 3, 4, 5, 6, 0].map(i => ({ i, d: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][i] })).map(({ i, d }) => `
                                        <div class="business-day-row" data-day="${i}">
                                            <label class="check-row compact"><input type="checkbox" class="bh-day-enabled" value="${i}"><span>${d}</span></label>
                                            <input class="bh-day-start" type="time" aria-label="${d} Beginn">
                                            <span class="business-day-sep">bis</span>
                                            <input class="bh-day-end" type="time" aria-label="${d} Ende">
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="field field-wide">
                                <label for="sys-bh-holidays">Feiertage (ein Datum pro Zeile, dd.mm.jjjj)</label>
                                <textarea id="sys-bh-holidays" rows="4" placeholder="01.01.2026&#10;25.12.2026"></textarea>
                            </div>
                        </div>

                        <!-- Unternehmenseinstellungen -->
                        <div id="sys-company" class="tab-content">
                            <div class="callout"><strong>Branding:</strong> Firmenangaben werden für Portal, E-Mail-Vorlagen und interne Darstellung vorbereitet.</div>
                            <div class="settings-section-title">Ticketnummern für neue Tickets</div>
                            <div class="callout">Formatvorlagen unterstützen <code>{prefix}</code>, <code>{category}</code> (Code der ersten Ticketkategorie) und <code>{number}</code>. Jede Vorlage muss <code>{number}</code> enthalten. Bestehende Ticketnummern bleiben unverändert.</div>
                            <div class="form-grid">
                                <div class="field"><label>Format (Standard)</label><input id="sys-ticket-number-format" type="text" placeholder="{prefix}-{number}"></div>
                                <div class="field"><label>Zusatz / Präfix</label><input id="sys-ticket-number-prefix" type="text" placeholder="TS"></div>
                                <div class="field"><label>Stellen der laufenden Nummer</label><input id="sys-ticket-number-padding" type="number" min="1" max="12" placeholder="6"></div>
                            </div>
                            <div class="field field-wide">
                                <label>Kategorieformate (leer = Standardformat)</label>
                                <div id="sys-ticket-category-formats" class="ticket-number-category-formats"></div>
                            </div>
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

                        <!-- Automatische Zuweisung -->
                        <div id="sys-assignment" class="tab-content">
                            <div class="callout">Lege fest, welches Team ein neues Ticket automatisch bekommt, wenn es zu einer bestimmten Kategorie passt. Ohne passende Regel bleibt das Ticket unzugewiesen und muss von Hand verteilt werden. Teams werden unter Benutzerverwaltung → Gruppen gepflegt.</div>
                            <div id="sys-assignment-rules" class="assignment-rules"></div>
                            <button type="button" class="btn-secondary btn-sm" id="sys-assignment-add">${Icon('plus', 15)}Regel hinzufügen</button>
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
                if (!user.email) {
                    UI.toast('Kein E-Mail im Profil hinterlegt');
                    return;
                }
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

        q('#notif-account-approved').checked = !!notif.accountApproved;
        AdminBoard.renderNotifMatrix(q('#sys-notif-matrix'), await Store.getNotifPolicy());

        q('#sys-2fa-enforce').value = sec.force2FA || 'none';
        q('#sys-session-timeout').value = sec.sessionTimeout || 0;
        q('#sys-max-login-attempts').value = sec.maxLoginAttempts || 0;
        q('#sys-lockout-action').value = sec.lockoutAction || 'lock';
        q('#sys-lockout-minutes').value = sec.lockoutMinutes || 15;
        const accEditable = settings.accountConfig?.editable || {};
        q('#sys-acc-name').checked = accEditable.name !== false;
        q('#sys-acc-email').checked = accEditable.email !== false;
        q('#sys-acc-dept').checked = !!accEditable.department;

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
        const slaHours = general.slaHours || {};
        AdminBoard.setSlaField('low', slaHours.low ?? 72);
        AdminBoard.setSlaField('normal', slaHours.normal ?? 48);
        AdminBoard.setSlaField('high', slaHours.high ?? 24);
        AdminBoard.setSlaField('critical', slaHours.critical ?? 4);
        q('#sys-sla-show-users').checked = !!general.showSlaToUsers;

        const businessHours = general.businessHours || {};
        q('#sys-bh-enabled').checked = !!businessHours.enabled;
        const bhDays = businessHours.days && businessHours.days.length ? businessHours.days : [1, 2, 3, 4, 5];
        qa('#sys-bh-days .business-day-row').forEach(row => {
            const day = Number(row.dataset.day);
            const cfg = businessHours.perDay?.[day] || {
                enabled: bhDays.includes(day),
                start: businessHours.start || '08:00',
                end: businessHours.end || '17:00'
            };
            row.querySelector('.bh-day-enabled').checked = !!cfg.enabled;
            row.querySelector('.bh-day-start').value = cfg.start || '08:00';
            row.querySelector('.bh-day-end').value = cfg.end || '17:00';
        });
        q('#sys-bh-holidays').value = (businessHours.holidays || []).map(d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d).join('\n');

        q('#sys-default-cats').value = (settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung']).join(', ');

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
        q('#sys-ticket-number-format').value = company.ticketNumberFormat || '{prefix}-{number}';
        q('#sys-ticket-number-prefix').value = company.ticketNumberPrefix || 'TS';
        q('#sys-ticket-number-padding').value = company.ticketNumberPadding || 6;
        const categoryFormatList = q('#sys-ticket-category-formats');
        const categoryFormatValues = {
            ...(company.ticketNumberCategoryFormats || {})
        };
        const renderCategoryNumberFormats = () => {
            const currentValues = Object.fromEntries(Array.from(categoryFormatList.querySelectorAll('[data-ticket-category]'))
                .map(input => [input.dataset.ticketCategory, input.value]));
            Object.assign(categoryFormatValues, currentValues);
            const categories = q('#sys-default-cats').value.split(',').map(category => category.trim()).filter(Boolean);
            categoryFormatList.innerHTML = categories.map((category, index) => `
                <div class="ticket-number-category-row">
                    <label for="ticket-number-category-${index}">${Utils.esc(category)}</label>
                    <input id="ticket-number-category-${index}" data-ticket-category="${Utils.esc(category)}" type="text" value="${Utils.esc(categoryFormatValues[category] || '')}" placeholder="{prefix}-{category}-{number}">
                </div>`).join('') || '<div class="empty-state compact">Keine Kategorien definiert</div>';
        };
        renderCategoryNumberFormats();
        q('#sys-default-cats').oninput = renderCategoryNumberFormats;

        // Automatische Zuweisung: Kategorie -> Team (Gruppe)
        const assignmentGroups = await Store.getGroups();
        const assignmentRulesList = q('#sys-assignment-rules');
        const renderAssignmentRules = (rules) => {
            const categories = q('#sys-default-cats').value.split(',').map(c => c.trim()).filter(Boolean);
            assignmentRulesList.innerHTML = rules.length ? rules.map((rule, index) => `
                <div class="assignment-rule-row" data-index="${index}">
                    <span class="assignment-rule-text">Kategorie</span>
                    <select class="ar-category">
                        ${categories.map(c => `<option value="${Utils.esc(c)}" ${c === rule.category ? 'selected' : ''}>${Utils.esc(c)}</option>`).join('')}
                    </select>
                    <span class="assignment-rule-text">→ Team</span>
                    <select class="ar-group">
                        <option value="">Kein Team</option>
                        ${assignmentGroups.map(g => `<option value="${Utils.esc(g.id)}" ${g.id === rule.groupId ? 'selected' : ''}>${Utils.esc(g.name)}</option>`).join('')}
                    </select>
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger ar-remove" title="Regel entfernen" aria-label="Regel entfernen">${Icon('x', 14)}</button>
                </div>`).join('') : '<div class="empty-state compact">Noch keine Regeln definiert.</div>';
            assignmentRulesList.querySelectorAll('.ar-remove').forEach(btn => {
                btn.onclick = () => {
                    const idx = Number(btn.closest('.assignment-rule-row').dataset.index);
                    currentAssignmentRules.splice(idx, 1);
                    renderAssignmentRules(currentAssignmentRules);
                };
            });
            if (window.lucide) lucide.createIcons();
        };
        let currentAssignmentRules = (general.assignmentRules || []).slice();
        renderAssignmentRules(currentAssignmentRules);
        q('#sys-assignment-add').onclick = () => {
            const categories = q('#sys-default-cats').value.split(',').map(c => c.trim()).filter(Boolean);
            if (!categories.length) { UI.toast('Bitte zuerst Kategorien anlegen.'); return; }
            if (!assignmentGroups.length) { UI.toast('Bitte zuerst ein Team unter Benutzerverwaltung → Gruppen anlegen.'); return; }
            currentAssignmentRules.push({ category: categories[0], groupId: assignmentGroups[0].id });
            renderAssignmentRules(currentAssignmentRules);
        };

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
                accountApproved: q('#notif-account-approved').checked,
            };
            const notifPolicy = AdminBoard.readNotifMatrix(q('#sys-notif-matrix'));
            newSettings.securityConfig = {
                force2FA: q('#sys-2fa-enforce').value,
                sessionTimeout: parseInt(q('#sys-session-timeout').value) || 0,
                maxLoginAttempts: parseInt(q('#sys-max-login-attempts').value) || 0,
                lockoutAction: q('#sys-lockout-action').value,
                lockoutMinutes: Math.max(1, parseInt(q('#sys-lockout-minutes').value) || 15),
            };
            newSettings.accountConfig = {
                editable: {
                    name: q('#sys-acc-name').checked,
                    email: q('#sys-acc-email').checked,
                    department: q('#sys-acc-dept').checked,
                }
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
                slaHours: {
                    low: AdminBoard.getSlaField('low', 72),
                    normal: AdminBoard.getSlaField('normal', 48),
                    high: AdminBoard.getSlaField('high', 24),
                    critical: AdminBoard.getSlaField('critical', 4)
                },
                showSlaToUsers: !!q('#sys-sla-show-users')?.checked,
                businessHours: {
                    enabled: !!q('#sys-bh-enabled')?.checked,
                    perDay: Object.fromEntries(qa('#sys-bh-days .business-day-row').map(row => [
                        row.dataset.day,
                        {
                            enabled: !!row.querySelector('.bh-day-enabled')?.checked,
                            start: row.querySelector('.bh-day-start')?.value || '08:00',
                            end: row.querySelector('.bh-day-end')?.value || '17:00'
                        }
                    ])),
                    days: qa('#sys-bh-days .bh-day-enabled:checked').map(cb => Number(cb.value)),
                    holidays: (q('#sys-bh-holidays')?.value || '').split('\n').map(s => s.trim()).filter(Boolean).map(value => {
                        const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                        return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
                    })
                },
                notifPolicy,
                assignmentRules: Array.from(assignmentRulesList.querySelectorAll('.assignment-rule-row')).map(row => ({
                    category: row.querySelector('.ar-category').value,
                    groupId: row.querySelector('.ar-group').value
                })).filter(rule => rule.groupId)
            };
            const ticketNumberFormat = q('#sys-ticket-number-format').value.trim() || '{prefix}-{number}';
            if (!ticketNumberFormat.includes('{number}')) {
                UI.toast('Das Standardformat muss {number} enthalten.');
                return;
            }
            const ticketNumberCategoryFormats = {};
            for (const input of categoryFormatList.querySelectorAll('[data-ticket-category]')) {
                const format = input.value.trim();
                if (format && !format.includes('{number}')) {
                    UI.toast(`Das Format für ${input.dataset.ticketCategory} muss {number} enthalten.`);
                    return;
                }
                if (format) ticketNumberCategoryFormats[input.dataset.ticketCategory] = format;
            }
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
                htmlSignature: q('#sys-company-html-signature').value.trim(),
                ticketNumberFormat,
                ticketNumberPrefix: q('#sys-ticket-number-prefix').value.trim() || 'TS',
                ticketNumberPadding: Math.max(1, Math.min(12, parseInt(q('#sys-ticket-number-padding').value, 10) || 6)),
                ticketNumberCategoryFormats
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

    // Listenansicht: Tabelle mit sortierbaren Spalten, Filtern, gespeicherten Ansichten
    // und Mehrfachauswahl für Sammelaktionen -- für Admins mit vielen offenen Tickets,
    // wo ein Kanban-Board nicht mehr überschaubar ist.
    listViewState: { sortKey: 'createdAt', sortDir: 'desc', selected: new Set() },

    openListView: async () => {
        const container = q('#list-view');
        if (!container.dataset.built) {
            container.dataset.built = '1';
            container.innerHTML = `
                <div class="list-view-toolbar">
                    <input type="search" id="lv-search" class="section-search" placeholder="Suchen...">
                    <select id="lv-status"><option value="">Alle Status</option></select>
                    <select id="lv-prio"><option value="">Alle Prioritäten</option><option>Niedrig</option><option>Normal</option><option>Hoch</option><option>Kritisch</option></select>
                    <select id="lv-category"><option value="">Alle Kategorien</option></select>
                    <select id="lv-team"><option value="">Alle Teams</option></select>
                    <details class="lv-more">
                        <summary class="btn-secondary btn-sm">${Icon('sliders-horizontal', 15)}Filter &amp; Ansichten</summary>
                        <div class="lv-more-body">
                            <label class="check-row compact"><input type="checkbox" id="lv-mine">Nur meine</label>
                            <label class="check-row compact"><input type="checkbox" id="lv-sla-risk">SLA in Gefahr</label>
                            <select id="lv-saved-views"><option value="">Gespeicherte Ansicht...</option></select>
                            <button id="lv-save-view" class="btn-secondary btn-sm">${Icon('bookmark-plus', 15)}Ansicht speichern</button>
                        </div>
                    </details>
                </div>
                <div id="lv-bulk-bar" class="list-view-bulk-bar" hidden>
                    <span id="lv-selected-count"></span>
                    <select id="lv-bulk-status">
                        <option value="">Status setzen...</option>
                        <option value="Neu">Neu</option>
                        <option value="In Bearbeitung">In Bearbeitung</option>
                        <option value="Geschlossen">Geschlossen</option>
                    </select>
                    <button id="lv-bulk-apply-status" class="btn-secondary btn-sm">Anwenden</button>
                    <button id="lv-bulk-archive" class="btn-secondary btn-sm">${Icon('archive', 15)}Archivieren</button>
                </div>
                <div class="list-view-table-wrap">
                    <table class="list-view-table">
                        <thead><tr>
                            <th><input type="checkbox" id="lv-select-all"></th>
                            <th data-sort="ticketNumber">Ticket-Nr</th>
                            <th data-sort="title">Titel</th>
                            <th data-sort="status">Status</th>
                            <th data-sort="prio">Priorität</th>
                            <th data-sort="category">Kategorie</th>
                            <th data-sort="owner">Verantwortlich</th>
                            <th data-sort="createdAt">Erstellt</th>
                            <th data-sort="sla">Frist</th>
                        </tr></thead>
                        <tbody id="lv-body"></tbody>
                    </table>
                </div>`;

            ['lv-search'].forEach(id => q('#' + id).oninput = () => AdminBoard.renderListView());
            ['lv-status', 'lv-prio', 'lv-category', 'lv-team'].forEach(id => q('#' + id).onchange = () => AdminBoard.renderListView());
            ['lv-mine', 'lv-sla-risk'].forEach(id => q('#' + id).onchange = () => AdminBoard.renderListView());
            q('#lv-select-all').onchange = (e) => {
                qa('#lv-body input[type="checkbox"]').forEach(cb => { cb.checked = e.target.checked; });
                const ids = qa('#lv-body input[type="checkbox"]').map(cb => cb.dataset.id);
                AdminBoard.listViewState.selected = e.target.checked ? new Set(ids) : new Set();
                AdminBoard.updateListViewBulkBar();
            };
            qa('.list-view-table th[data-sort]').forEach(th => {
                th.onclick = () => {
                    const key = th.dataset.sort;
                    if (AdminBoard.listViewState.sortKey === key) {
                        AdminBoard.listViewState.sortDir = AdminBoard.listViewState.sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        AdminBoard.listViewState.sortKey = key;
                        AdminBoard.listViewState.sortDir = 'asc';
                    }
                    AdminBoard.renderListView();
                };
            });
            q('#lv-saved-views').onchange = async (e) => {
                if (!e.target.value) return;
                const views = await Store.getListViews();
                const view = views.find(v => v.id === e.target.value);
                if (!view) return;
                q('#lv-search').value = view.filters.search || '';
                q('#lv-status').value = view.filters.status || '';
                q('#lv-prio').value = view.filters.prio || '';
                q('#lv-category').value = view.filters.category || '';
                q('#lv-team').value = view.filters.team || '';
                q('#lv-mine').checked = !!view.filters.mine;
                q('#lv-sla-risk').checked = !!view.filters.slaRisk;
                AdminBoard.renderListView();
            };
            q('#lv-save-view').onclick = async () => {
                const name = await UI.promptText({
                    title: 'Ansicht speichern',
                    label: 'Name der Ansicht',
                    placeholder: 'z. B. Meine offenen oder SLA in Gefahr',
                    saveLabel: 'Ansicht speichern'
                });
                if (!name || !name.trim()) return;
                const actor = await Store.currentUser();
                const views = await Store.getListViews();
                views.push({
                    id: Utils.uid(),
                    name: name.trim(),
                    owner: actor?.username,
                    filters: {
                        search: q('#lv-search').value,
                        status: q('#lv-status').value,
                        prio: q('#lv-prio').value,
                        category: q('#lv-category').value,
                        team: q('#lv-team').value,
                        mine: q('#lv-mine').checked,
                        slaRisk: q('#lv-sla-risk').checked
                    }
                });
                await Store.saveListViews(views);
                UI.toast('Ansicht gespeichert.');
                await AdminBoard.populateListViewFilters();
            };
            q('#lv-bulk-apply-status').onclick = async () => {
                const status = q('#lv-bulk-status').value;
                if (!status || !AdminBoard.listViewState.selected.size) return;
                const tickets = await Store.getTickets();
                let changed = 0;
                tickets.forEach(t => {
                    if (AdminBoard.listViewState.selected.has(t.id) && t.status !== status && !t.archived) {
                        t.status = status;
                        changed++;
                    }
                });
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Sammelaktion: Status geändert', `${changed} Ticket(s) auf "${status}" gesetzt`);
                UI.toast(`${changed} Ticket(s) aktualisiert.`);
                AdminBoard.listViewState.selected = new Set();
                await AdminBoard.renderListView();
            };
            q('#lv-bulk-archive').onclick = async () => {
                if (!AdminBoard.listViewState.selected.size) return;
                UI.confirm(`${AdminBoard.listViewState.selected.size} ausgewählte Ticket(s) archivieren?`, async () => {
                    const tickets = await Store.getTickets();
                    let changed = 0;
                    tickets.forEach(t => {
                        if (AdminBoard.listViewState.selected.has(t.id) && t.status === 'Geschlossen' && !t.archived) {
                            t.archived = true;
                            t.archivedAt = Utils.nowISO();
                            changed++;
                        }
                    });
                    await Store.saveTickets(tickets);
                    await Store.addGlobalLog('Sammelaktion: Archiviert', `${changed} Ticket(s) archiviert`);
                    UI.toast(changed ? `${changed} Ticket(s) archiviert.` : 'Nur geschlossene Tickets können archiviert werden.');
                    AdminBoard.listViewState.selected = new Set();
                    await AdminBoard.renderListView();
                });
            };
        }
        await AdminBoard.populateListViewFilters();
        await AdminBoard.renderListView();
    },

    populateListViewFilters: async () => {
        const settings = await Store.getSettings();
        const groups = await Store.getGroups();
        const views = (await Store.getListViews());
        const actor = await Store.currentUser();
        const statusSel = q('#lv-status');
        const curStatus = statusSel.value;
        statusSel.innerHTML = '<option value="">Alle Status</option>' + ['Neu', 'In Bearbeitung', 'Warten auf Benutzer', 'Warten auf externen Dienstleister', 'Warten auf interne Rückmeldung', 'Geschlossen'].map(s => `<option ${s === curStatus ? 'selected' : ''}>${Utils.esc(s)}</option>`).join('');
        const catSel = q('#lv-category');
        const curCat = catSel.value;
        catSel.innerHTML = '<option value="">Alle Kategorien</option>' + (settings.categories || []).map(c => `<option ${c === curCat ? 'selected' : ''}>${Utils.esc(c)}</option>`).join('');
        const teamSel = q('#lv-team');
        const curTeam = teamSel.value;
        teamSel.innerHTML = '<option value="">Alle Teams</option>' + groups.map(g => `<option value="${Utils.esc(g.id)}" ${g.id === curTeam ? 'selected' : ''}>${Utils.esc(g.name)}</option>`).join('');
        const viewsSel = q('#lv-saved-views');
        viewsSel.innerHTML = '<option value="">Gespeicherte Ansicht...</option>' + views.filter(v => v.owner === actor?.username).map(v => `<option value="${v.id}">${Utils.esc(v.name)}</option>`).join('');
    },

    updateListViewBulkBar: () => {
        const bar = q('#lv-bulk-bar');
        const count = AdminBoard.listViewState.selected.size;
        bar.hidden = count === 0;
        q('#lv-selected-count').textContent = `${count} ausgewählt`;
    },

    renderListView: async () => {
        const [tickets, users, groups, settings, actor] = await Promise.all([
            Store.getTickets(), Store.getUsers(), Store.getGroups(), Store.getSettings(), Store.currentUser()
        ]);
        const nameFor = (username) => {
            if (!username) return '-';
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const search = q('#lv-search').value;
        const statusFilter = q('#lv-status').value;
        const prioFilter = q('#lv-prio').value;
        const catFilter = q('#lv-category').value;
        const teamFilter = q('#lv-team').value;
        const mineOnly = q('#lv-mine').checked;
        const slaRiskOnly = q('#lv-sla-risk').checked;

        let visible = tickets.filter(t => !t.archived);
        if (actor?.role === 'admin') visible = visible.filter(t => AdminBoard.canAccessTicket(actor, t));
        if (search.trim()) visible = visible.filter(t => Utils.matchesSearch(search, t));
        if (statusFilter) visible = visible.filter(t => t.status === statusFilter);
        if (prioFilter) visible = visible.filter(t => t.prio === prioFilter);
        if (catFilter) visible = visible.filter(t => (Array.isArray(t.category) ? t.category : [t.category]).includes(catFilter));
        if (teamFilter) visible = visible.filter(t => t.team === teamFilter);
        if (mineOnly) visible = visible.filter(t => t.owner === actor?.username || (t.assignees || []).includes(actor?.username));
        if (slaRiskOnly) visible = visible.filter(t => { const c = Store.formatSlaCountdown(t, settings); return c && (c.tone === 'warning' || c.tone === 'danger'); });

        const { sortKey, sortDir } = AdminBoard.listViewState;
        const sortValue = (t) => {
            if (sortKey === 'category') return (Array.isArray(t.category) ? t.category[0] : t.category) || '';
            if (sortKey === 'owner') return nameFor(t.owner);
            if (sortKey === 'sla') { const d = Store.ticketSlaDueAt(t, settings); return d ?? Infinity; }
            if (sortKey === 'createdAt') return new Date(t.createdAt).getTime();
            return t[sortKey] || '';
        };
        visible.sort((a, b) => {
            const va = sortValue(a), vb = sortValue(b);
            const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return sortDir === 'asc' ? cmp : -cmp;
        });

        qa('.list-view-table th[data-sort]').forEach(th => {
            th.classList.toggle('sorted-asc', th.dataset.sort === sortKey && sortDir === 'asc');
            th.classList.toggle('sorted-desc', th.dataset.sort === sortKey && sortDir === 'desc');
        });

        const validIds = new Set(visible.map(t => t.id));
        AdminBoard.listViewState.selected.forEach(id => { if (!validIds.has(id)) AdminBoard.listViewState.selected.delete(id); });

        const body = q('#lv-body');
        body.innerHTML = visible.length ? visible.map(t => {
            const team = t.team ? groups.find(g => g.id === t.team) : null;
            const countdown = Store.formatSlaCountdown(t, settings);
            const checked = AdminBoard.listViewState.selected.has(t.id) ? 'checked' : '';
            return `<tr data-id="${Utils.esc(t.id)}" class="lv-row">
                <td><input type="checkbox" data-id="${Utils.esc(t.id)}" ${checked}></td>
                <td>${Utils.esc(t.ticketNumber || t.id)}</td>
                <td class="lv-title" title="${Utils.esc(t.title)}">${t.isMajorIncident ? `<span class="t-incident-badge lv-incident-icon" title="${Lang.t('majorIncident')}">${Icon('siren', 12)}</span> ` : ''}${Utils.esc(t.title)}</td>
                <td><span class="status-badge">${Utils.esc(Lang.status(t.status))}</span></td>
                <td><span class="t-tag prio-${t.prio}">${Utils.esc(Lang.prio(t.prio))}</span></td>
                <td>${Utils.esc((Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean).join(', ') || '-')}${team ? ` <span class="t-team">${Icon('route', 10)}${Utils.esc(team.name)}</span>` : ''}</td>
                <td>${Utils.esc(nameFor(t.owner))}</td>
                <td>${Utils.esc(Utils.fmtDate(t.createdAt))}</td>
                <td>${countdown ? `<span class="sla-mini-badge sla-badge-${countdown.tone}" title="Frist: ${Utils.esc(countdown.dueDateLabel)}">${Utils.esc(countdown.dueDateLabel)} · ${Utils.esc(countdown.label)}</span>` : '-'}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty-state">Keine Tickets gefunden.</div></td></tr>`;

        qa('#lv-body tr.lv-row').forEach(row => {
            row.querySelector('td:not(:first-child)').parentElement.onclick = null;
            row.querySelectorAll('td:not(:first-child)').forEach(td => {
                td.onclick = () => AdminBoard.openModal(row.dataset.id);
                td.style.cursor = 'pointer';
            });
            const cb = row.querySelector('input[type="checkbox"]');
            cb.onclick = (e) => e.stopPropagation();
            cb.onchange = () => {
                if (cb.checked) AdminBoard.listViewState.selected.add(cb.dataset.id);
                else AdminBoard.listViewState.selected.delete(cb.dataset.id);
                AdminBoard.updateListViewBulkBar();
            };
        });
        q('#lv-select-all').checked = visible.length > 0 && visible.every(t => AdminBoard.listViewState.selected.has(t.id));
        AdminBoard.updateListViewBulkBar();
        if (window.lucide) lucide.createIcons();
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
                    <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</div>
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
        const banner = q('#requests-board');
        const count = q('#request-count');
        if (banner) banner.hidden = reqs.length === 0;
        if (count) count.textContent = String(reqs.length);
        list.innerHTML = '';
        if (reqs.length === 0) {
            list.innerHTML = '<div class="empty-state compact">Keine offenen Anfragen</div>';
            return;
        }
        const existingUsers = await Store.getUsers();
        reqs.forEach(r => {
            const el = document.createElement('div');
            el.className = 'ticket-card request-card';
            const match = existingUsers.find(u => u.email && u.email.toLowerCase() === String(r.email || '').toLowerCase());
            const restoreLabel = match?.accountArchived ? 'Reaktivieren' : 'Entsperren';
            const showRestore = !!match && (match.accountLocked || match.accountArchived);
            el.innerHTML = `
                <div class="req-name">${Utils.esc(r.name)}</div>
                <div class="req-mail">${Utils.esc(r.email)}</div>
                <div class="req-actions">
                    <button class="btn-primary btn-sm req-accept">${Icon('check', 15)}Annehmen</button>
                    ${showRestore ? `<button class="btn-secondary btn-sm req-restore">${Icon(match.accountArchived ? 'archive-restore' : 'lock-open', 15)}${restoreLabel}</button>` : ''}
                    <button class="btn-secondary btn-sm req-decline">${Icon('x', 15)}Ablehnen</button>
                </div>
            `;
            el.querySelector('.req-accept').onclick = () => AdminBoard.openApproveModal(r);
            const restoreBtn = el.querySelector('.req-restore');
            if (restoreBtn) restoreBtn.onclick = async () => {
                const users = await Store.getUsers();
                const target = users.find(x => x.id === match.id);
                if (!target) return;
                target.accountLocked = false;
                target.accountArchived = false;
                target.failedLogins = 0;
                await Store.saveUsers(users);
                await Store.addGlobalLog('Konto über Kontoanfrage reaktiviert', `Benutzer: ${target.username}`);
                UI.toast(`${target.username} wurde ${restoreLabel === 'Reaktivieren' ? 'reaktiviert' : 'entsperrt'}.`);
                AdminBoard.renderRequests();
            };
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

    chooseWaitingStatus: (fixedStatus = '') => new Promise(resolve => {
        const modal = q('#waiting-status-modal');
        const select = q('#waiting-status-choice');
        const reasonField = q('#waiting-status-reason-field');
        const messageField = q('#waiting-user-message-field');
        const messageInput = q('#waiting-user-message');
        const confirm = q('#waiting-status-confirm');
        const cancel = q('#waiting-status-cancel');
        if (!modal || !select || !reasonField || !messageField || !messageInput || !confirm || !cancel) return resolve(null);

        if (Lang.current === 'en') {
            select.options[0].textContent = 'Choose a reason';
            select.options[1].textContent = 'Waiting for user';
            select.options[2].textContent = 'Waiting for external provider';
            select.options[3].textContent = 'Waiting for internal feedback';
            q('#waiting-status-title').lastChild.textContent = fixedStatus ? 'What do you need from the user?' : 'What are you waiting for?';
            reasonField.querySelector('label').textContent = 'Waiting reason';
            messageField.querySelector('label').textContent = 'Message to the user';
            messageInput.placeholder = 'Describe what you need from the user.';
            confirm.textContent = 'Apply';
            cancel.textContent = 'Cancel';
        } else {
            select.options[0].textContent = 'Bitte auswählen';
            select.options[1].textContent = 'Auf Benutzer';
            select.options[2].textContent = 'Auf externen Dienstleister';
            select.options[3].textContent = 'Auf interne Rückmeldung';
            q('#waiting-status-title').lastChild.textContent = fixedStatus ? 'Was wird vom Benutzer benötigt?' : 'Worauf wird gewartet?';
            reasonField.querySelector('label').textContent = 'Wartegrund';
            messageField.querySelector('label').textContent = 'Nachricht an den Benutzer';
            messageInput.placeholder = 'Was wird vom Benutzer benötigt?';
            confirm.textContent = 'Übernehmen';
            cancel.textContent = 'Abbrechen';
        }

        select.value = fixedStatus;
        select.disabled = !!fixedStatus;
        reasonField.hidden = !!fixedStatus;
        messageInput.value = '';
        const updateForm = () => {
            messageField.hidden = select.value !== 'Warten auf Benutzer';
            confirm.disabled = !select.value || (select.value === 'Warten auf Benutzer' && !messageInput.value.trim());
        };
        updateForm();
        modal.classList.add('open');
        if (select.value === 'Warten auf Benutzer') messageInput.focus();
        else select.focus();

        const finish = value => {
            modal.classList.remove('open');
            modal.onclick = null;
            document.removeEventListener('keydown', onKeyDown);
            select.disabled = false;
            reasonField.hidden = false;
            messageField.hidden = true;
            messageInput.value = '';
            select.onchange = null;
            messageInput.oninput = null;
            resolve(value);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') finish(null);
        };
        select.onchange = updateForm;
        messageInput.oninput = updateForm;
        confirm.onclick = () => {
            if (!select.value || (select.value === 'Warten auf Benutzer' && !messageInput.value.trim())) return;
            finish({
                status: select.value,
                message: select.value === 'Warten auf Benutzer' ? messageInput.value.trim() : ''
            });
        };
        cancel.onclick = () => finish(null);
        modal.onclick = event => {
            if (event.target === modal) finish(null);
        };
        document.addEventListener('keydown', onKeyDown);
        if (window.lucide) lucide.createIcons();
    }),

    changeStatus: async (id, newStatus, waitingMessage = '') => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(item => item.id === id);
        if (!ticket || ticket.archived || ticket.status === newStatus) return false;
        if (newStatus === 'Warten auf Benutzer' && !waitingMessage.trim()) {
            UI.toast('Bitte beschreiben, was vom Benutzer benötigt wird.');
            return false;
        }
        const oldStatus = ticket.status;
        const actor = await Store.currentUser();
        ticket.status = newStatus;
        if (newStatus === 'In Bearbeitung' && oldStatus !== 'In Bearbeitung' && actor && !ticket.owner && !(ticket.assignees || []).length) {
            ticket.owner = actor.username;
            ticket.assignees = [actor.username];
        }

        // SLA-Uhr pausieren/fortsetzen: läuft während "Warten auf ..." nicht weiter.
        const wasWaiting = String(oldStatus || '').startsWith('Warten auf');
        const isWaitingNow = String(newStatus || '').startsWith('Warten auf');
        if (!wasWaiting && isWaitingNow) {
            ticket.slaPausedSince = Utils.nowISO();
        } else if (wasWaiting && !isWaitingNow && ticket.slaPausedSince) {
            ticket.slaPausedMs = (ticket.slaPausedMs || 0) + (Date.now() - new Date(ticket.slaPausedSince).getTime());
            ticket.slaPausedSince = null;
        }

        if (newStatus === 'Warten auf Benutzer') {
            ticket.waitingMessage = waitingMessage.trim();
            if (!Array.isArray(ticket.chat)) ticket.chat = [];
            ticket.chat.push({
                text: ticket.waitingMessage,
                author: actor?.name || actor?.username || 'Support',
                authorUsername: actor?.username,
                date: Utils.nowISO(),
                role: actor?.role || 'admin',
                files: []
            });
            await Store.addLog(ticket, 'Nachricht an Benutzer gesendet', ticket.waitingMessage);
        } else {
            delete ticket.waitingMessage;
        }
        await Store.addLog(ticket, `Status geändert von ${oldStatus} zu ${newStatus}`);

        // Großstörung: verknüpfte Tickets übernehmen automatisch denselben Status.
        let linkedForNotify = [];
        if (ticket.isMajorIncident) {
            linkedForNotify = tickets.filter(t => t.linkedIncidentId === ticket.id && !t.archived && t.status !== newStatus);
            for (const lt of linkedForNotify) {
                const prevStatus = lt.status;
                lt.status = newStatus;
                const wasWaitingL = String(prevStatus || '').startsWith('Warten auf');
                const isWaitingNowL = String(newStatus || '').startsWith('Warten auf');
                if (!wasWaitingL && isWaitingNowL) {
                    lt.slaPausedSince = Utils.nowISO();
                } else if (wasWaitingL && !isWaitingNowL && lt.slaPausedSince) {
                    lt.slaPausedMs = (lt.slaPausedMs || 0) + (Date.now() - new Date(lt.slaPausedSince).getTime());
                    lt.slaPausedSince = null;
                }
                if (newStatus === 'Warten auf Benutzer') lt.waitingMessage = ticket.waitingMessage;
                else delete lt.waitingMessage;
                await Store.addLog(lt, `Status automatisch von Großstörung übernommen: ${newStatus}`);
            }
        }

        await Store.saveTickets(tickets);
        if (newStatus === 'Geschlossen' && ticket.isMajorIncident) {
            await AdminBoard.notifyLinkedIncidentTickets(ticket, ticket.desc);
        }
        if (linkedForNotify.length) {
            await Store.addNotifications(linkedForNotify.map(lt => lt.author).filter(Boolean), ticket, `Status der Großstörung wurde auf "${Lang.status(newStatus)}" geändert.`, actor?.username, 'statusChange');
        }
        const requestDetails = newStatus === 'Warten auf Benutzer' ? `\nAnforderung: ${ticket.waitingMessage}` : '';
        await Store.addGlobalLog('Ticket Status geändert', `Ticket: ${ticket.title}, Status: ${newStatus}${requestDetails}`);
        const notificationMessage = newStatus === 'Warten auf Benutzer' ?
            `Wir benötigen noch folgende Angaben: ${ticket.waitingMessage}` :
            `Status geändert: ${Lang.status(newStatus)}`;
        const statusNotifType = newStatus === 'Geschlossen' ? 'ticketClosed' : 'statusChange';
        await Store.addNotifications([ticket.author, ...(ticket.participants || [])], ticket, notificationMessage, actor?.username, statusNotifType);

        const settings = await Store.getSettings();
        const author = (await Store.getUsers()).find(user => user.username === ticket.author);
        if (author?.email && settings.emailConfig?.host) {
            const statusPref = await Store.resolveNotifPref(author, statusNotifType);
            if (statusNotifType === 'ticketClosed' && statusPref.email) {
                await Store.sendEmail(author.email, `Ticket geschlossen: ${ticket.title}`, 'Dein Ticket wurde geschlossen. Du kannst den Verlauf weiterhin im Portal einsehen.');
            } else if (statusNotifType === 'statusChange' && statusPref.email) {
                await Store.sendEmail(author.email, `Ticket Update: ${ticket.title}`, `Status geändert auf: ${Lang.status(newStatus)}${newStatus === 'Warten auf Benutzer' ? `\n\nWir benötigen noch folgende Angaben:\n${ticket.waitingMessage}` : ''}`);
            }
        }
        await AdminBoard.render();
        if (AdminBoard.currentTicketId === ticket.id && q('#ticket-modal.open')) await AdminBoard.renderChat(ticket, '#m-chat-msgs');
        if (q('#user-tickets')) await UserDash.renderList();
        await Notifications.refresh();
        return true;
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
                    if (newStatus === 'Warten auf Benutzer') {
                        if (String(t.status).startsWith('Warten auf')) {
                            await AdminBoard.render();
                            return;
                        }
                        const waitingChoice = await AdminBoard.chooseWaitingStatus();
                        if (!waitingChoice) {
                            await AdminBoard.render();
                            return;
                        }
                        const changed = await AdminBoard.changeStatus(id, waitingChoice.status, waitingChoice.message);
                        if (changed) UI.toast(`Status geändert: ${Lang.status(waitingChoice.status)}`);
                    } else {
                        const changed = await AdminBoard.changeStatus(id, newStatus);
                        if (changed) UI.toast(`Status geändert: ${Lang.status(newStatus)}`);
                    }
                }
            });
        });
    },

    // Modal Logic
    currentTicketId: null,

    getTodoAssigneeOptions: (ticket, users) => {
        const allowed = new Set([ticket.owner, ...(ticket.participants || [])].filter(Boolean));
        return users.filter(user => allowed.has(user.username));
    },

    syncTodoAssignees: async (ticket) => {
        const allowed = new Set([ticket.owner, ...(ticket.participants || [])].filter(Boolean));
        const cleared = [];
        (ticket.todos || []).forEach(todo => {
            if (todo.assignee && !allowed.has(todo.assignee)) {
                cleared.push(todo.title);
                todo.assignee = '';
            }
        });
        if (cleared.length) await Store.addLog(ticket, 'Teilaufgaben-Zuweisung entfernt', cleared.join(', '));
    },

    ensureResponsibilitySection: async (t, users, tickets) => {
        const details = q('#tab-details');
        if (!details) return;

        const staff = users.filter(u => (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived);
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
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('list-checks', 15)}Teilaufgaben</span><span id="todo-progress-count" class="todo-progress-count"></span></div>
                <div id="todo-progress-bar" class="todo-progress-bar" hidden><div id="todo-progress-fill" class="todo-progress-fill"></div></div>
                <div id="ticket-todos" class="ticket-todos"></div>
                <div class="todo-create-row">
                    <input id="todo-title" type="text" placeholder="Neue Teilaufgabe">
                    <select id="todo-assignee">
                        <option value="">Ohne Zuweisung</option>
                        ${AdminBoard.getTodoAssigneeOptions(t, staff).map(u => `<option value="${Utils.esc(u.username)}">${Utils.esc(u.name || u.username)}</option>`).join('')}
                    </select>
                    <button class="btn-primary" id="todo-add" type="button">${Icon('plus', 16)}Hinzufügen</button>
                </div>
            </div>
            <div class="time-tracking-panel">
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('clock', 15)}Zeiterfassung</span><span id="time-total-label" class="todo-progress-count"></span></div>
                <div id="time-entry-list" class="time-entry-list"></div>
                <div class="todo-create-row">
                    <input id="time-minutes" type="number" min="1" step="5" placeholder="Minuten">
                    <input id="time-note" type="text" placeholder="Notiz (optional)">
                    <button class="btn-primary" id="time-add" type="button">${Icon('plus', 16)}Hinzufügen</button>
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
            await AdminBoard.syncTodoAssignees(t);
            await Store.addLog(t, 'Hauptverantwortlicher geändert', `Alt: ${old} -> Neu: ${t.owner || 'Nicht zugewiesen'}`);
            await Store.saveTickets(tickets);
            await AdminBoard.ensureResponsibilitySection(t, users, tickets);
            await AdminBoard.setupMentionAutocomplete(t);
            await AdminBoard.render();
        };

        const participantsMulti = q('#participants-multi');
        const participantOptions = staff
            .filter(u => u.username !== t.owner)
            .map(u => ({
                value: u.username,
                label: u.name || u.username
            }));
        const participantValues = (t.participants || []).filter(username => username !== t.owner);
        t.participants = participantValues;
        UI.createMultiSelect(participantsMulti, participantOptions, participantValues, async (newParticipants) => {
            t.participants = newParticipants.filter(username => username !== t.owner);
            t.assignees = [...t.participants];
            await AdminBoard.syncTodoAssignees(t);
            const names = newParticipants.map(username => {
                const found = staff.find(u => u.username === username);
                return found ? (found.name || found.username) : username;
            }).join(', ') || 'Niemand';
            await Store.addLog(t, 'Beteiligte Personen geändert', `Neu: ${names}`);
            await Store.saveTickets(tickets);
            await AdminBoard.setupMentionAutocomplete(t);
            await AdminBoard.render();
        });
        participantsMulti.classList.toggle('is-disabled', !!t.archived);

        AdminBoard.renderTicketTodos(t, staff, tickets);
        AdminBoard.renderTimeEntries(t, users, tickets);
        if (window.lucide) lucide.createIcons();
    },

    // Zeiterfassung: aufgewendete Zeit pro Ticket, für interne Verrechnung oder Dienstleister-Abrechnung.
    renderTimeEntries: (t, users, tickets) => {
        const list = q('#time-entry-list');
        const addBtn = q('#time-add');
        if (!list || !addBtn) return;
        if (!Array.isArray(t.timeEntries)) t.timeEntries = [];
        const nameFor = (username) => {
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const fmtMinutes = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} Std.` : `${mins} Min.`;
        const totalMinutes = t.timeEntries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        const totalLabel = q('#time-total-label');
        if (totalLabel) totalLabel.textContent = totalMinutes ? `${fmtMinutes(totalMinutes)} erfasst` : '';
        list.innerHTML = t.timeEntries.length ? t.timeEntries.slice().reverse().map(e => `
            <div class="time-entry-row" data-id="${Utils.esc(e.id)}">
                <span class="time-entry-duration">${fmtMinutes(e.minutes)}</span>
                <span class="time-entry-meta">${Utils.esc(nameFor(e.username))} · ${Utils.esc(Utils.fmtDate(e.date))}${e.note ? ' · ' + Utils.esc(e.note) : ''}</span>
                <button type="button" class="btn-ghost btn-icon btn-xs btn-danger time-entry-remove" title="Eintrag entfernen" aria-label="Eintrag entfernen">${Icon('x', 13)}</button>
            </div>`).join('') : '<div class="empty-state compact">Noch keine Zeit erfasst.</div>';
        list.querySelectorAll('.time-entry-remove').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.closest('.time-entry-row').dataset.id;
                t.timeEntries = t.timeEntries.filter(e => e.id !== id);
                await Store.addLog(t, 'Zeiterfassungseintrag entfernt');
                await Store.saveTickets(tickets);
                AdminBoard.renderTimeEntries(t, users, tickets);
            };
        });
        addBtn.disabled = !!t.archived;
        addBtn.onclick = async () => {
            const minutesInput = q('#time-minutes');
            const noteInput = q('#time-note');
            const minutes = parseInt(minutesInput.value, 10);
            if (!Number.isFinite(minutes) || minutes <= 0) {
                UI.toast('Bitte eine gültige Dauer in Minuten angeben.');
                return;
            }
            const actor = await Store.currentUser();
            t.timeEntries.push({
                id: Utils.uid(),
                username: actor?.username || 'admin',
                minutes,
                note: noteInput.value.trim(),
                date: Utils.nowISO()
            });
            await Store.addLog(t, 'Zeit erfasst', `${fmtMinutes(minutes)}${noteInput.value.trim() ? ' – ' + noteInput.value.trim() : ''}`);
            await Store.saveTickets(tickets);
            minutesInput.value = '';
            noteInput.value = '';
            AdminBoard.renderTimeEntries(t, users, tickets);
        };
    },

    linkTicketToIncident: async (ticketId, incidentId) => {
        if (ticketId === incidentId) return false;
        const tickets = await Store.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        const incident = tickets.find(t => t.id === incidentId);
        if (!ticket || !incident || !incident.isMajorIncident || ticket.isMajorIncident || ticket.linkedIncidentId === incidentId) return false;
        ticket.linkedIncidentId = incidentId;
        if (ticket.status !== incident.status) ticket.status = incident.status;
        await Store.addLog(ticket, 'Mit Großstörung verknüpft', incident.title);
        await Store.addLog(incident, 'Ticket zur Großstörung hinzugefügt', ticket.title);
        await Store.saveTickets(tickets);
        await Store.addGlobalLog('Ticket mit Großstörung verknüpft', `Ticket: ${ticket.title} -> Störung: ${incident.title}`);
        const actor = await Store.currentUser();
        await Store.addNotifications([ticket.author].filter(Boolean), ticket, `Dein Ticket wurde der Großstörung "${incident.title}" zugeordnet.`, actor?.username, 'newMessage');
        await AdminBoard.render();
        return true;
    },

    openAddTicketsToIncident: async (incidentId) => {
        const tickets = await Store.getTickets();
        const candidates = tickets.filter(t => !t.archived && !t.isMajorIncident && !t.linkedIncidentId && t.id !== incidentId);
        const modal = document.createElement('div');
        modal.id = 'incident-add-modal';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md">
                <div class="modal-header">
                    <h3>${Icon('list-tree', 18)}Tickets zur Störung hinzufügen</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" id="iam-save" title="Hinzufügen" aria-label="Hinzufügen">${Icon('save', 16)}</button>
                        <button class="btn-ghost btn-icon" id="iam-close" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body">
                    <input type="search" id="iam-search" class="section-search" placeholder="Ticket-Nr, Titel oder Person suchen...">
                    <div class="checkbox-list" id="iam-list">${candidates.map(t => `
                        <label class="check-row" data-search="${Utils.esc(`${t.ticketNumber || ''} ${t.title} ${t.authorName || ''} ${t.author || ''}`.toLowerCase())}"><input type="checkbox" value="${Utils.esc(t.id)}">
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>${Utils.esc(t.authorName || t.author || '-')} · ${Lang.status(t.status)}</span></span>
                        </label>`).join('')}</div>
                    <div class="empty-state compact" id="iam-empty" ${candidates.length ? 'hidden' : ''}>Keine Treffer.</div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const close = () => { modal.remove(); };
        const searchInput = modal.querySelector('#iam-search');
        searchInput.oninput = () => {
            const term = searchInput.value.trim().toLowerCase();
            let visible = 0;
            modal.querySelectorAll('#iam-list .check-row').forEach(row => {
                const match = !term || row.dataset.search.includes(term);
                row.hidden = !match;
                if (match) visible++;
            });
            modal.querySelector('#iam-empty').hidden = visible > 0;
        };
        modal.querySelector('#iam-close').onclick = close;
        modal.onclick = e => { if (e.target === modal) close(); };
        modal.querySelector('#iam-save').onclick = async () => {
            const ids = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
            if (!ids.length) return UI.toast('Bitte mindestens ein Ticket auswählen.');
            for (const ticketId of ids) await AdminBoard.linkTicketToIncident(ticketId, incidentId);
            close();
            UI.toast(`${ids.length} Ticket(s) zur Störung hinzugefügt.`);
            await AdminBoard.openModal(incidentId);
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    renderIncidentLinkedTickets: (ticket, allTickets) => {
        const box = q('#m-incident-linked-list');
        if (!box) return;
        if (!ticket.isMajorIncident) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const linked = allTickets.filter(item => item.linkedIncidentId === ticket.id && !item.archived);
        box.hidden = false;
        box.innerHTML = `
            <h4 class="section-title">${Icon('list-tree', 15)} ${Lang.t('linkedTickets')}</h4>
            ${linked.length ? `<div class="incident-linked-table">
                ${linked.map(item => `
                    <button type="button" class="incident-linked-row" data-ticket-id="${Utils.esc(item.id)}">
                        <span><strong>${Utils.esc(item.ticketNumber || item.id)}</strong>${Utils.esc(item.title)}</span>
                        <span>${Utils.esc(item.authorName || item.author || '-')}</span>
                        <span>${Lang.status(item.status)}</span>
                    </button>
                `).join('')}
            </div>` : '<div class="empty-state compact">Noch keine Tickets zugeordnet.</div>'}
        `;
        box.querySelectorAll('.incident-linked-row').forEach(row => {
            row.onclick = () => AdminBoard.openModal(row.dataset.ticketId);
        });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-secondary btn-sm incident-linked-add';
        addBtn.innerHTML = `${Icon('plus', 14)}Ticket hinzufügen`;
        addBtn.disabled = !!ticket.archived;
        addBtn.onclick = () => AdminBoard.openAddTicketsToIncident(ticket.id);
        box.querySelector('.section-title')?.after(addBtn);
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
        const assigneeOptions = AdminBoard.getTodoAssigneeOptions(t, users);
        const todoTotal = t.todos.length;
        const todoDone = t.todos.filter(todo => todo.done).length;
        const progressCount = q('#todo-progress-count');
        if (progressCount) progressCount.textContent = todoTotal ? `${todoDone} von ${todoTotal} erledigt` : '';
        const progressBar = q('#todo-progress-bar');
        const progressFill = q('#todo-progress-fill');
        if (progressBar) progressBar.hidden = !todoTotal;
        if (progressFill) progressFill.style.width = `${todoTotal ? Math.round((todoDone / todoTotal) * 100) : 0}%`;
        const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        } [c]));

        list.innerHTML = t.todos.length ? t.todos.map(todo => `
            <div class="ticket-todo ${todo.done ? 'done' : ''}" data-id="${todo.id}">
                <label>
                    <input type="checkbox" ${todo.done ? 'checked' : ''} ${t.archived ? 'disabled' : ''}>
                    <span>${esc(todo.title)}</span>
                </label>
                <div class="todo-meta">
                    ${todo.assignee ? `<span class="badge">${Icon('user-round', 12)}${esc(getName(todo.assignee))}</span>` : '<span class="badge">Nicht zugewiesen</span>'}
                    <button class="btn-ghost btn-icon btn-sm todo-edit" title="Teilaufgabe bearbeiten" aria-label="Teilaufgabe bearbeiten" ${t.archived ? 'disabled' : ''}>${Icon('pencil', 14)}</button>
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

        list.querySelectorAll('.todo-edit').forEach(btn => {
            btn.onclick = () => {
                const row = btn.closest('.ticket-todo');
                const todo = t.todos.find(item => item.id === row.dataset.id);
                if (!todo) return;
                row.innerHTML = `
                    <div class="todo-edit-fields">
                        <input class="todo-title-edit" type="text" value="${esc(todo.title)}" aria-label="Teilaufgabe">
                        <select class="todo-assignee-edit" aria-label="Zuständige Person">
                            <option value="">Ohne Zuweisung</option>
                            ${assigneeOptions.map(user => `<option value="${esc(user.username)}">${esc(user.name || user.username)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="todo-meta">
                        <button class="btn-ghost btn-icon btn-sm todo-save" title="Speichern" aria-label="Speichern">${Icon('check', 14)}</button>
                        <button class="btn-ghost btn-icon btn-sm todo-cancel" title="Abbrechen" aria-label="Abbrechen">${Icon('x', 14)}</button>
                    </div>`;
                const select = row.querySelector('.todo-assignee-edit');
                if (assigneeOptions.some(user => user.username === todo.assignee)) select.value = todo.assignee;
                row.querySelector('.todo-save').onclick = async () => {
                    const title = row.querySelector('.todo-title-edit').value.trim();
                    if (!title) return UI.toast('Bitte einen Titel angeben.');
                    const old = `${todo.title} -> ${todo.assignee || 'Nicht zugewiesen'}`;
                    todo.title = title;
                    todo.assignee = select.value;
                    await Store.addLog(t, 'Teilaufgabe bearbeitet', `${old}; Neu: ${todo.title} -> ${todo.assignee || 'Nicht zugewiesen'}`);
                    await Store.saveTickets(tickets);
                    AdminBoard.renderTicketTodos(t, users, tickets);
                };
                row.querySelector('.todo-cancel').onclick = () => AdminBoard.renderTicketTodos(t, users, tickets);
                row.querySelector('.todo-title-edit').focus();
                if (window.lucide) lucide.createIcons();
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

    // Vertretung/Abwesenheit: offene Tickets eines abwesenden Agenten gehen an eine Vertretung
    // oder zurück ins Team (Owner wird geleert), damit nichts liegen bleibt.
    openAbsenceModal: async (username) => {
        const users = await Store.getUsers();
        const target = users.find(u => u.username === username);
        if (!target) return;
        const substitutes = users.filter(u => u.username !== username && (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived);
        q('#absence-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'absence-modal';
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = `Abwesenheit · ${target.name || target.username}`;
        modal.querySelector('.modal-body').innerHTML = `
            <label class="check-row"><input type="checkbox" id="abs-active" ${target.absence?.active ? 'checked' : ''}>Als abwesend markieren</label>
            ${Settings.absencePeriodMarkup(target.absence, 'abm')}
            <label class="check-row"><input type="checkbox" id="abs-visible" ${target.absence?.visible ? 'checked' : ''}>Anderen Admins anzeigen, dass ich abwesend bin</label>
            <div class="field">
                <label for="abs-substitute">Vertretung</label>
                <select id="abs-substitute">
                    <option value="">Keine – Tickets zurück ins Team</option>
                    ${substitutes.map(u => `<option value="${Utils.esc(u.username)}" ${target.absence?.substitute === u.username ? 'selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                </select>
            </div>
            <p class="hint">Beim Aktivieren werden alle offenen Tickets, bei denen ${Utils.esc(target.name || target.username)} Hauptverantwortlicher ist, sofort an die Vertretung übergeben – oder ohne Vertretung dem Team zur erneuten Verteilung zurückgegeben.</p>`;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const active = q('#abs-active').checked;
            const substitute = q('#abs-substitute').value || null;
            let period;
            try { period = Settings.readAbsencePeriod('abm'); } catch (error) { return UI.toast(error.message); }
            await AdminBoard.setAbsence(username, active, substitute, q('#abs-visible').checked, period.fromMs, period.untilMs);
            modal.classList.remove('open');
            AdminBoard.renderUserManager('admins');
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    setAbsence: async (username, active, substituteUsername, visible = false, fromMs = null, untilMs = null) => {
        const users = await Store.getUsers();
        const target = users.find(u => u.username === username);
        if (!target) return;
        if (!active) {
            await AdminBoard.endAbsence(target, users);
            await AdminBoard.render();
            return;
        }
        const now = Date.now();
        const substitute = substituteUsername ? users.find(u => u.username === substituteUsername) : null;
        const fmt = ms => new Date(ms).toLocaleDateString('de-DE');
        if (fromMs && fromMs > now) {
            target.absence = { active: false, pending: true, substitute: substitute?.username || null, visible: !!visible, fromMs, untilMs: untilMs || null, transferredIds: [], returnPending: target.absence?.returnPending || [] };
            await Store.saveUsers(users);
            await Store.addGlobalLog('Abwesenheit geplant', `Benutzer: ${target.name || username}, von ${fmt(fromMs)} bis ${untilMs ? fmt(untilMs) : 'offen'}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, Anzeige für andere Admins: ${visible ? 'ja' : 'nein'}`);
            UI.toast(`Abwesenheit geplant ab ${fmt(fromMs)}.`);
            await AdminBoard.render();
            return;
        }
        if (target.absence?.active) {
            target.absence = { ...target.absence, substitute: substitute?.username || null, visible: !!visible, untilMs: untilMs || target.absence.untilMs || null };
            await Store.saveUsers(users);
            await Store.addGlobalLog('Abwesenheit geändert', `Benutzer: ${target.name || username}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, bis ${untilMs ? fmt(untilMs) : 'offen'}, Anzeige: ${visible ? 'ja' : 'nein'}`);
            UI.toast('Abwesenheit aktualisiert.');
            await AdminBoard.render();
            return;
        }

        const tickets = await Store.getTickets();
        const openTickets = tickets.filter(t => t.owner === username && t.status !== 'Geschlossen' && !t.archived);
        const transferred = [];
        const addedAsParticipant = [];
        const transferredIds = [];
        for (const t of openTickets) {
            if (substitute) {
                if (!(t.participants || []).includes(substitute.username) && t.owner !== substitute.username) addedAsParticipant.push(t);
                t.owner = substitute.username;
                t.assignees = [...new Set([...(t.assignees || []).filter(a => a !== username), substitute.username])];
                t.participants = [...new Set([...(t.participants || []), substitute.username])];
                await Store.addLog(t, `Hauptverantwortlicher wegen Abwesenheit geändert: ${target.name || username} → ${substitute.name || substitute.username}`);
                transferred.push(t);
                transferredIds.push(t.id);
            } else {
                t.owner = '';
                t.assignees = (t.assignees || []).filter(a => a !== username);
                await Store.addLog(t, `Ticket wegen Abwesenheit von ${target.name || username} zurück ins Team gelegt`);
            }
        }
        target.absence = { active: true, pending: false, substitute: substitute?.username || null, visible: !!visible, since: Utils.nowISO(), fromMs: fromMs || null, untilMs: untilMs || null, transferredIds, returnPending: target.absence?.returnPending || [] };
        await Store.saveUsers(users);
        if (openTickets.length) {
            await Store.saveTickets(tickets);
            const ticketLines = openTickets.map(t => `${t.ticketNumber || t.id} „${t.title}“: Hauptverantwortlicher ${target.name || username} → ${substitute ? (substitute.name || substitute.username) : 'Team (keiner)'}`);
            await Store.addGlobalLog('Abwesenheit aktiviert', `Benutzer: ${target.name || username}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, bis ${untilMs ? fmt(untilMs) : 'offen'}, ${openTickets.length} Ticket(s)\n${ticketLines.join('\n')}`);
        } else {
            await Store.addGlobalLog('Abwesenheit aktiviert', `Benutzer: ${target.name || username}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, bis ${untilMs ? fmt(untilMs) : 'offen'}, keine offenen Tickets`);
        }
        if (substitute) await AdminBoard.notifySubstituteAbsence(substitute, target, transferred, addedAsParticipant);
        UI.toast(`${openTickets.length} Ticket(s) ${substitute ? 'übergeben' : 'zurück ins Team gelegt'}.`);
        await AdminBoard.render();
    },

    endAbsence: async (target, users) => {
        const absence = target.absence || {};
        const tickets = await Store.getTickets();
        const returnIds = absence.active ? (absence.transferredIds || []) : [];
        const lines = tickets.filter(t => returnIds.includes(t.id)).map(t => `${t.ticketNumber || t.id} „${t.title}“ · Status: ${Lang.status(t.status)} · Hauptverantwortlicher jetzt: ${t.owner || '–'}`);
        target.absence = {
            active: false,
            pending: false,
            substitute: null,
            visible: false,
            since: null,
            fromMs: null,
            untilMs: null,
            transferredIds: [],
            returnPending: [...new Set([...(absence.returnPending || []), ...returnIds])]
        };
        await Store.saveUsers(users);
        await Store.addGlobalLog('Abwesenheit beendet', `Benutzer: ${target.name || target.username}${lines.length ? '\n' + lines.join('\n') : '\nKeine Tickets zu übernehmen.'}`);
        UI.toast('Abwesenheit beendet.');
    },

    processAbsences: async () => {
        const now = Date.now();
        const users = await Store.getUsers();
        for (const u of users) {
            const a = u.absence || {};
            if (a.pending && a.fromMs && a.fromMs <= now) {
                await AdminBoard.setAbsence(u.username, true, a.substitute, a.visible, a.fromMs, a.untilMs);
            } else if (a.active && a.untilMs && a.untilMs < now) {
                const fresh = await Store.getUsers();
                await AdminBoard.endAbsence(fresh.find(x => x.username === u.username), fresh);
            }
        }
    },

    returnTickets: async (absentUsername, ticketIds) => {
        const users = await Store.getUsers();
        const absent = users.find(u => u.username === absentUsername);
        const tickets = await Store.getTickets();
        const byFrom = new Map();
        for (const id of ticketIds) {
            const t = tickets.find(x => x.id === id);
            if (!t || t.archived || t.owner === absentUsername) continue;
            const fromUser = t.owner;
            t.owner = absentUsername;
            t.assignees = [...new Set([...(t.assignees || []).filter(a => a !== fromUser), absentUsername])];
            await Store.addLog(t, `Ticket von ${absent?.name || absentUsername} zurückgeholt (vorher Vertretung: ${fromUser || '–'})`);
            if (fromUser) byFrom.set(fromUser, [...(byFrom.get(fromUser) || []), t]);
        }
        if (absent) absent.absence = { ...(absent.absence || {}), returnPending: [] };
        await Store.saveUsers(users);
        if (byFrom.size) await Store.saveTickets(tickets);
        const notifications = await Store.getNotifications();
        for (const [fromUser, list] of byFrom) {
            notifications.push({
                id: Utils.uid(),
                recipient: fromUser,
                ticketId: null,
                ticketNumber: 'Vertretung',
                title: `${absent?.name || absentUsername} · Tickets zurückgeholt`,
                message: `${absent?.name || absentUsername} hat ${list.length} Ticket(s) zurückgeholt:\n` + list.map(t => `${t.ticketNumber || t.id} „${t.title}“ · Status: ${Lang.status(t.status)}`).join('\n'),
                date: Utils.nowISO(),
                read: false,
                type: 'absence'
            });
            await Store.addGlobalLog('Vertretung über Rückholung informiert', `Vertretung: ${fromUser}, Tickets: ${list.map(t => t.ticketNumber || t.id).join(', ')}`);
        }
        await Store.saveNotifications(notifications.slice(-2000));
        await Notifications.refresh();
        if (ticketIds.length) UI.toast(`${ticketIds.length} Ticket(s) zurückgeholt.`);
    },

    openAbsenceReturnPopup: async (user) => {
        if (!user) return;
        const me = (await Store.getUsers()).find(u => u.username === user.username);
        const ids = me?.absence?.returnPending || [];
        q('#absence-return-popup')?.remove();
        if (!ids.length) return;
        const users = await Store.getUsers();
        const tickets = (await Store.getTickets()).filter(t => ids.includes(t.id) && !t.archived);
        if (!tickets.length) {
            await AdminBoard.returnTickets(user.username, []);
            return;
        }
        const modal = document.createElement('div');
        modal.id = 'absence-return-popup';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md substitute-popup">
                <div class="modal-header">
                    <h3>${Icon('plane', 20)}Abwesenheit beendet – Tickets zurückholen?</h3>
                </div>
                <div class="modal-body">
                    <p class="hint">Diese Tickets lagen während deiner Abwesenheit bei deiner Vertretung. Wähle aus, welche du zurückholen möchtest.</p>
                    <div class="checkbox-list">${tickets.map(t => {
                        const owner = users.find(u => u.username === t.owner);
                        return `<label class="check-row"><input type="checkbox" value="${Utils.esc(t.id)}" checked>
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>Status: ${Utils.esc(Lang.status(t.status))} · Aktuell bei: ${Utils.esc(owner?.name || t.owner || 'niemandem')}</span></span>
                        </label>`;
                    }).join('')}</div>
                </div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-secondary" id="arp-keep">Nicht zurückholen</button>
                    <button class="btn-primary" id="arp-return">${Icon('undo-2', 16)}Ausgewählte zurückholen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#arp-keep').onclick = async () => {
            modal.remove();
            await AdminBoard.returnTickets(user.username, []);
        };
        modal.querySelector('#arp-return').onclick = async () => {
            const chosen = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
            modal.remove();
            await AdminBoard.returnTickets(user.username, chosen);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    openSubstituteNoticePopups: async (user) => {
        if (!user) return;
        const all = await Store.getNotifications();
        const pending = all.filter(n => n.recipient === user.username && n.type === 'absence' && !n.read);
        q('#substitute-popup')?.remove();
        if (!pending.length) return;
        const modal = document.createElement('div');
        modal.id = 'substitute-popup';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md substitute-popup">
                <div class="modal-header">
                    <h3>${Icon('plane', 20)}Du bist als Vertretung eingetragen</h3>
                </div>
                <div class="modal-body substitute-popup-body">${pending.map(n => Utils.esc(n.message)).join('\n\n')}</div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-primary" id="substitute-popup-ok">${Icon('check', 16)}Verstanden</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#substitute-popup-ok').onclick = async () => {
            const notifications = await Store.getNotifications();
            notifications.forEach(n => { if (pending.some(p => p.id === n.id)) n.read = true; });
            await Store.saveNotifications(notifications);
            modal.remove();
            await Notifications.refresh();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    applyArchiveConsequences: async (target, restoring) => {
        const tickets = await Store.getTickets();
        let changed = 0;
        if (target.role === 'user') {
            tickets.filter(t => t.author === target.username && !t.archived && t.status !== 'Geschlossen').forEach(t => {
                t.authorArchived = !restoring;
                changed++;
            });
            if (!restoring) await Store.addGlobalLog('Ticket-Ersteller archiviert', `Benutzer: ${target.username}, offene Tickets: ${changed}`);
        } else if (!restoring) {
            tickets.filter(t => t.owner === target.username && !t.archived && t.status !== 'Geschlossen').forEach(t => {
                t.owner = '';
                t.assignees = (t.assignees || []).filter(a => a !== target.username);
                t.participants = (t.participants || []).filter(a => a !== target.username);
                changed++;
            });
            if (changed) await Store.addGlobalLog('Admin archiviert – Tickets zurück ins Team', `Benutzer: ${target.username}, Tickets: ${changed}`);
        }
        if (changed) await Store.saveTickets(tickets);
    },

    // Offene Tickets eines archivierten Benutzers: Hauptverantwortliche entscheidet pro Ticket.
    openArchivedAuthorDecisions: async (user) => {
        if (!user || !(user.role === 'admin' || user.role === 'superadmin')) return;
        const tickets = await Store.getTickets();
        const open = tickets.filter(t => t.owner === user.username && t.authorArchived && !t.archived && t.status !== 'Geschlossen');
        q('#archived-author-modal')?.remove();
        if (!open.length) return;
        const users = await Store.getUsers();
        const admins = users.filter(u => (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived && u.username !== user.username);
        const modal = document.createElement('div');
        modal.id = 'archived-author-modal';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md">
                <div class="modal-header">
                    <h3>${Icon('archive', 18)}Ticket-Ersteller archiviert</h3>
                </div>
                <div class="modal-body" id="aa-body"></div>
            </div>`;
        document.body.appendChild(modal);
        const body = modal.querySelector('#aa-body');
        body.innerHTML = `<p class="hint">Der Ersteller dieser Tickets wurde archiviert und kann nicht mehr antworten. Entscheide je Ticket, wie es weitergeht.</p>` + open.map(t => {
            const author = users.find(u => u.username === t.author);
            return `
                <div class="absence-overview-row aa-row" data-id="${Utils.esc(t.id)}">
                    <div><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span class="hint">Ersteller: ${Utils.esc(author?.name || t.author)}</span></div>
                    <div class="aa-actions">
                        <select class="aa-assign"><option value="">Zuordnen an…</option>${admins.map(a => `<option value="${Utils.esc(a.username)}">${Utils.esc(a.name || a.username)}</option>`).join('')}</select>
                        <button class="btn-secondary btn-sm aa-assign-btn" type="button">Zuordnen</button>
                        <button class="btn-secondary btn-sm aa-keep" type="button">Weiter bearbeiten</button>
                        <button class="btn-secondary btn-sm aa-archive" type="button">Archivieren</button>
                    </div>
                </div>`;
        }).join('');
        const close = () => { modal.remove(); };
        let updateQueue = Promise.resolve();
        const updateTicket = (id, mutate, logText) => {
            updateQueue = updateQueue.then(async () => {
                const all = await Store.getTickets();
                const t = all.find(x => x.id === id);
                if (!t) return;
                mutate(t);
                t.authorArchived = false;
                await Store.addLog(t, logText);
                await Store.saveTickets(all);
                modal.querySelector(`.aa-row[data-id="${id}"]`)?.remove();
                if (!modal.querySelector('.aa-row')) close();
                await AdminBoard.render();
            });
            return updateQueue;
        };
        modal.classList.add('open');
        body.querySelectorAll('.aa-row').forEach(row => {
            const id = row.dataset.id;
            row.querySelector('.aa-assign-btn').onclick = () => {
                const newOwner = row.querySelector('.aa-assign').value;
                if (!newOwner) return UI.toast('Bitte einen Benutzer auswählen.');
                updateTicket(id, t => {
                    t.owner = newOwner;
                    t.assignees = [...new Set([...(t.assignees || []).filter(a => a !== user.username), newOwner])];
                    t.participants = [...new Set([...(t.participants || []).filter(a => a !== user.username), newOwner])];
                }, `Ticket nach Archivierung des Erstellers neu zugeordnet an ${newOwner}`);
            };
            row.querySelector('.aa-keep').onclick = () => updateTicket(id, () => {}, 'Ticket nach Archivierung des Erstellers weiter bearbeitet (Ersteller kann nicht antworten)');
            row.querySelector('.aa-archive').onclick = () => UI.confirm('Ticket archivieren?', () => updateTicket(id, t => { t.archived = true; }, 'Ticket nach Archivierung des Erstellers archiviert'));
        });
        if (window.lucide) lucide.createIcons();
    },

    renderAbsenceBanner: async (user) => {
        q('#absence-banner')?.remove();
        if (!user || !(user.role === 'admin' || user.role === 'superadmin')) return;
        const me = (await Store.getUsers()).find(u => u.id === user.id);
        if (!me?.absence?.active) return;
        const users = await Store.getUsers();
        const sub = me.absence.substitute ? users.find(u => u.username === me.absence.substitute) : null;
        const banner = document.createElement('div');
        banner.id = 'absence-banner';
        banner.className = 'absence-banner';
        banner.innerHTML = `
            <div class="absence-banner-text">
                <strong>${Icon('plane', 14)}Du bist als abwesend markiert</strong>
                <span>Vertretung: ${sub ? Utils.esc(sub.name || sub.username) : 'keine – Tickets liegen im Team'}</span>
            </div>
            <button class="btn-secondary btn-sm" id="absence-banner-end">Abwesenheit beenden</button>`;
        document.body.appendChild(banner);
        banner.querySelector('#absence-banner-end').onclick = async () => {
            await AdminBoard.setAbsence(me.username, false, null, false);
            await AdminBoard.openAbsenceReturnPopup(user);
        };
        if (window.lucide) lucide.createIcons();
    },

    openAbsenceOverview: async () => {
        const users = await Store.getUsers();
        const absent = users.filter(u => u.absence?.active && u.absence?.visible);
        q('#absence-overview-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'absence-overview-modal';
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = 'Abwesenheiten';
        modal.querySelector('.modal-body').innerHTML = absent.length ? absent.map(u => {
            const sub = u.absence.substitute ? users.find(x => x.username === u.absence.substitute) : null;
            return `<div class="absence-overview-row"><strong>${Utils.esc(u.name || u.username)}</strong><span>Vertretung: ${sub ? Utils.esc(sub.name || sub.username) : 'keine – Team'}</span></div>`;
        }).join('') : '<div class="empty-state compact">Aktuell ist niemand abwesend.</div>';
        modal.querySelector('.modal-body').insertAdjacentHTML('beforeend', `
            <div class="setting-row" style="margin-top:var(--space-3);">
                <button type="button" class="btn-primary btn-sm" id="abs-overview-own">${Icon('plane', 15)}Meine Abwesenheit einstellen</button>
            </div>`);
        modal.querySelector('#abs-overview-own').onclick = () => {
            modal.classList.remove('open');
            Settings.openModal();
        };
        modal.querySelector('.modal-footer')?.remove();
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    notifySubstituteAbsence: async (substitute, absentUser, transferred, addedAsParticipant) => {
        const absentName = absentUser.name || absentUser.username;
        const lines = [];
        if (transferred.length) {
            lines.push(`Als Hauptverantwortlicher übernommen (${transferred.length}): ` + transferred.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
        }
        if (addedAsParticipant.length) {
            lines.push(`Als Beteiligter hinzugefügt (${addedAsParticipant.length}): ` + addedAsParticipant.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
        }
        const todos = transferred.flatMap(t => (t.todos || []).filter(todo => !todo.done).map(todo => `${t.ticketNumber || t.id}: ${todo.title}`));
        if (todos.length) lines.push(`Offene Teilaufgaben: ` + todos.join('; '));
        const message = `${absentName} hat dich als Vertretung hinterlegt.\n` + (lines.length ? lines.join('\n') : 'Aktuell sind keine offenen Tickets betroffen.');
        const notifications = await Store.getNotifications();
        notifications.push({
            id: Utils.uid(),
            recipient: substitute.username,
            ticketId: null,
            ticketNumber: 'Vertretung',
            title: `${absentName} · Abwesenheit`,
            message,
            date: Utils.nowISO(),
            read: false,
            type: 'absence'
        });
        await Store.saveNotifications(notifications.slice(-2000));
        await Store.addGlobalLog('Vertretung benachrichtigt', `Vertretung: ${substitute.name || substitute.username}, für: ${absentName}\n${message}`);
        await Notifications.refresh();
    },

    // Admin legt ein Ticket im Namen einer anderen Person an (Telefonanruf, am Schalter, etc.)
    openCreateTicketModal: async () => {
        let modal = q('#admin-create-ticket-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-create-ticket-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('plus', 18)}Neues Ticket anlegen</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field field-wide">
                            <label for="act-on-behalf-search">Im Namen von</label>
                            <input type="text" id="act-on-behalf-search" placeholder="Nach Namen oder Benutzername suchen...">
                            <div id="act-on-behalf-list" class="user-picker-list"></div>
                            <p class="hint">Person nicht dabei? Lege sie zuerst in der Benutzerverwaltung an.</p>
                        </div>
                        <div class="field field-wide">
                            <label for="act-title">Betreff</label>
                            <input id="act-title" type="text" placeholder="Kurzer Titel">
                        </div>
                        <div class="field field-wide">
                            <label for="act-desc">Beschreibung</label>
                            <textarea id="act-desc" rows="6" placeholder="Worum geht es?"></textarea>
                        </div>
                        <div class="field">
                            <label for="act-prio">Priorität</label>
                            <select id="act-prio">
                                <option value="Niedrig">Niedrig</option>
                                <option value="Normal">Normal</option>
                                <option value="Hoch">Hoch</option>
                                <option value="Kritisch">Kritisch</option>
                            </select>
                        </div>
                        <div class="field">
                            <label>Kategorie</label>
                            <div id="act-cat-container"></div>
                        </div>
                        <div id="act-custom-fields" class="field-wide custom-fields-fill"></div>
                        <div class="field field-wide">
                            <label>Anhänge</label>
                            <label for="act-files" class="dropzone" id="act-files-dropzone">
                                <i data-lucide="upload-cloud"></i>
                                <span class="dropzone-text"><strong>Dateien hierher ziehen</strong> oder klicken zum Auswählen</span>
                                <input id="act-files" type="file" multiple>
                            </label>
                            <div id="act-files-preview" class="file-preview"></div>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="act-cancel">Abbrechen</button>
                        <button class="btn-primary" id="act-submit">${Icon('plus', 16)}Ticket anlegen</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
            modal.querySelector('#act-cancel').onclick = () => modal.classList.remove('open');
        }
        const users = (await Store.getUsers()).slice().sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
        let selectedBehalfUsername = '';
        const listEl = q('#act-on-behalf-list');
        const searchInput = q('#act-on-behalf-search');
        const renderUserPicker = (filter = '') => {
            const term = filter.toLowerCase().trim();
            const filtered = term ? users.filter(u => (u.name || '').toLowerCase().includes(term) || u.username.toLowerCase().includes(term)) : users;
            listEl.innerHTML = filtered.length ? filtered.map(u => `
                <div class="user-picker-row${u.username === selectedBehalfUsername ? ' selected' : ''}" data-username="${Utils.esc(u.username)}">
                    <span class="user-picker-name">${Utils.esc(u.name || u.username)}</span>
                    <span class="user-picker-meta">${Utils.esc(u.username)} · ${u.role === 'user' ? 'Benutzer' : 'Admin'}</span>
                </div>`).join('') : '<div class="empty-state compact">Keine Treffer.</div>';
            listEl.querySelectorAll('.user-picker-row').forEach(row => {
                row.onclick = () => {
                    selectedBehalfUsername = row.dataset.username;
                    renderUserPicker(searchInput.value);
                };
            });
        };
        renderUserPicker();
        searchInput.value = '';
        searchInput.oninput = () => renderUserPicker(searchInput.value);
        q('#act-title').value = '';
        q('#act-desc').value = '';
        q('#act-prio').value = 'Normal';
        AdminBoard.createTicketFiles = [];
        q('#act-files-preview').innerHTML = '';
        q('#act-files-preview').style.display = 'none';
        const renderActFilePreview = () => {
            const preview = q('#act-files-preview');
            preview.innerHTML = '';
            preview.style.display = AdminBoard.createTicketFiles.length ? 'flex' : 'none';
            AdminBoard.createTicketFiles.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'file-chip';
                chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="Entfernen" aria-label="${Utils.esc(file.name)} entfernen">${Icon('x', 13)}</button>`;
                chip.querySelector('button').onclick = () => {
                    AdminBoard.createTicketFiles.splice(index, 1);
                    renderActFilePreview();
                };
                preview.appendChild(chip);
            });
            if (window.lucide) lucide.createIcons();
        };
        const actFileInput = q('#act-files');
        actFileInput.value = '';
        actFileInput.onchange = () => {
            AdminBoard.createTicketFiles.push(...Array.from(actFileInput.files || []));
            actFileInput.value = '';
            renderActFilePreview();
        };
        const actDropzone = q('#act-files-dropzone');
        ['dragenter', 'dragover'].forEach(evt => actDropzone.addEventListener(evt, (e) => { e.preventDefault(); actDropzone.classList.add('drag-over'); }));
        ['dragleave', 'dragend'].forEach(evt => actDropzone.addEventListener(evt, (e) => { e.preventDefault(); actDropzone.classList.remove('drag-over'); }));
        actDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            actDropzone.classList.remove('drag-over');
            AdminBoard.createTicketFiles.push(...Array.from(e.dataTransfer?.files || []));
            renderActFilePreview();
        });
        const settings = await Store.getSettings();
        const categories = settings.categories && settings.categories.length ? settings.categories : ['Allgemein'];
        const refreshActCustomFields = (selectedCats) => {
            UI.renderCustomFieldsForm(q('#act-custom-fields'), Store.getCustomFieldsForCategories(selectedCats, settings));
        };
        AdminBoard.createTicketCategoryInstance = UI.createMultiSelect(q('#act-cat-container'), categories, [categories[0]], refreshActCustomFields);
        refreshActCustomFields([categories[0]]);
        q('#act-submit').onclick = async () => {
            const title = q('#act-title').value.trim();
            const desc = q('#act-desc').value.trim();
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#act-custom-fields'));
            if (missingFields.length) return UI.toast(`Bitte Pflichtfeld${missingFields.length > 1 ? 'er' : ''} ausfüllen: ${missingFields.join(', ')}`);
            const onBehalfUser = users.find(u => u.username === selectedBehalfUsername);
            if (!onBehalfUser) return UI.toast('Bitte eine Person auswählen.');
            if (AdminBoard.createTicketFiles.some(file => file.size > 15 * 1024 * 1024)) {
                UI.toast('Anhänge dürfen maximal 15 MB groß sein.');
                return;
            }
            let attachments = [];
            try {
                attachments = await Promise.all(AdminBoard.createTicketFiles.map(file => Store.saveAttachment(file)));
            } catch (error) {
                console.error(error);
                UI.toast('Anhänge konnten nicht gespeichert werden. Bitte erneut versuchen.');
                return;
            }
            const tickets = await Store.getTickets();
            const cat = AdminBoard.createTicketCategoryInstance.getValue();
            const category = cat.length ? cat : ['Allgemein'];
            let ticketNumberData;
            try {
                ticketNumberData = Store.nextTicketNumber(tickets, category, settings);
            } catch (error) {
                UI.toast('Ticketnummernformat ungültig: Das Format muss {number} enthalten.');
                return;
            }
            const actor = await Store.currentUser();
            const newTicket = {
                id: Utils.uid(),
                title,
                desc,
                prio: q('#act-prio').value,
                category,
                status: 'Neu',
                author: onBehalfUser.username,
                authorName: onBehalfUser.name || onBehalfUser.username,
                createdAt: Utils.nowISO(),
                comments: [],
                chat: [],
                attachments,
                archived: false,
                ticketNumber: ticketNumberData.ticketNumber,
                ticketNumberSequence: ticketNumberData.ticketNumberSequence,
                assignees: [],
                participants: [],
                owner: '',
                todos: [],
                createdByAdmin: actor?.username,
                customFieldValues
            };
            const autoTeam = Store.autoAssignTeam(newTicket, settings, await Store.getGroups());
            if (autoTeam) {
                newTicket.team = autoTeam.id;
                newTicket.assignees = [...new Set([...newTicket.assignees, ...autoTeam.members])];
            }
            tickets.push(newTicket);
            await Store.addLog(newTicket, `Ticket im Namen von ${newTicket.authorName} angelegt (durch ${actor?.name || actor?.username || 'Admin'})${autoTeam ? ` – automatisch Team "${autoTeam.name}" zugewiesen` : ''}`);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Ticket im Namen eines Benutzers erstellt', `Ticket: ${title}, Im Namen von: ${newTicket.authorName}`);
            modal.classList.remove('open');
            UI.toast('Ticket wurde angelegt.');
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    openIncidentCreateModal: async () => {
        q('#generic-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = Lang.t('createIncident');
        const settings = await Store.getSettings();
        const categories = settings.categories && settings.categories.length ? settings.categories : ['Allgemein'];
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label>${Lang.t('incidentTitle')}</label>
                <input id="incident-title" type="text" placeholder="z. B. VPN-Störung">
            </div>
            <div class="field">
                <label>${Lang.t('incidentNotice')}</label>
                <textarea id="incident-notice" rows="4" placeholder="Kurze Beschreibung der Störung und was betroffen ist."></textarea>
            </div>
            <div class="form-grid">
                <div class="field">
                    <label>${Lang.t('priority')}</label>
                    <select id="incident-prio">
                        <option value="Normal">Normal</option>
                        <option value="Hoch">Hoch</option>
                        <option value="Kritisch">Kritisch</option>
                    </select>
                </div>
                <div class="field">
                    <label>Kategorie</label>
                    <select id="incident-category">
                        ${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        saveBtn.textContent = 'Störung erstellen';
        saveBtn.onclick = async () => {
            const title = q('#incident-title').value.trim();
            const notice = q('#incident-notice').value.trim();
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            if (!notice) return UI.toast('Bitte einen sichtbaren Hinweis eintragen.');
            const tickets = await Store.getTickets();
            const category = [q('#incident-category').value || 'Allgemein'];
            let ticketNumberData;
            try {
                ticketNumberData = Store.nextTicketNumber(tickets, category, settings);
            } catch {
                return UI.toast('Ticketnummernformat ungültig: Das Format muss {number} enthalten.');
            }
            const actor = await Store.currentUser();
            const incidentTicket = {
                id: Utils.uid(),
                title,
                desc: notice,
                prio: q('#incident-prio').value,
                category,
                status: 'Neu',
                author: actor?.username || 'admin',
                authorName: actor?.name || actor?.username || 'Administrator',
                createdAt: Utils.nowISO(),
                comments: [],
                chat: [],
                attachments: [],
                archived: false,
                ticketNumber: ticketNumberData.ticketNumber,
                ticketNumberSequence: ticketNumberData.ticketNumberSequence,
                assignees: [],
                participants: [],
                owner: '',
                todos: [],
                isMajorIncident: true,
                incidentNotice: notice
            };
            tickets.push(incidentTicket);
            await Store.addLog(incidentTicket, 'Störung erstellt', notice);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Störung erstellt', `Ticket: ${title}`);
            modal.classList.remove('open');
            UI.toast('Störung wurde erstellt.');
            await AdminBoard.render();
            await AdminBoard.openModal(incidentTicket.id);
        };
        modal.classList.add('open');
        q('#incident-title').focus();
        if (window.lucide) lucide.createIcons();
    },

    editTicket: async (id) => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(item => item.id === id);
        if (!ticket || ticket.archived) return;
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = `Ticket bearbeiten · ${ticket.ticketNumber || ticket.id}`;
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field"><label for="edit-ticket-title">Titel</label><input id="edit-ticket-title" type="text" value="${Utils.esc(ticket.title)}"></div>
            <div class="field"><label for="edit-ticket-desc">Beschreibung</label><textarea id="edit-ticket-desc" rows="8">${Utils.esc(ticket.desc || '')}</textarea></div>`;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const title = q('#edit-ticket-title').value.trim();
            const desc = q('#edit-ticket-desc').value.trim();
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            if (title === ticket.title && desc === (ticket.desc || '')) return modal.classList.remove('open');
            const before = `${ticket.title}\n${ticket.desc || ''}`;
            ticket.title = title;
            ticket.desc = desc;
            await Store.addLog(ticket, 'Ticketdaten bearbeitet', `Vorher: ${before}\nNachher: ${title}\n${desc}`);
            await Store.saveTickets(tickets);
            const actor = await Store.currentUser();
            await Store.addNotifications([ticket.author], ticket, 'Titel oder Beschreibung wurde vom Support angepasst.', actor?.username, 'ticketEdited');
            await Store.addGlobalLog('Ticketdaten bearbeitet', `Ticket ${ticket.ticketNumber || ticket.id}: ${title}`);
            modal.classList.remove('open');
            q('#m-title').textContent = `${ticket.ticketNumber || ticket.id} - ${ticket.title}`;
            q('#m-desc').textContent = ticket.desc || 'Keine Beschreibung';
            await AdminBoard.render();
            await Notifications.refresh();
        };
        modal.classList.add('open');
        q('#edit-ticket-title').focus();
    },

    // Großstörung: ein Agent markiert eine bekannte Störung. Benutzer sehen beim Erstellen
    // eines neuen Tickets einen Hinweis und können sich verknüpfen, statt ein Dubletten-Ticket
    // anzulegen. Wird das Haupt-Ticket geschlossen, bekommen alle verknüpften Tickets die
    // Lösung automatisch als Chat-Nachricht mitgeteilt.
    // Manuell gesetzte Frist für einzelne Tickets (überschreibt die berechnete Lösungsfrist vollständig).
    openCustomDueModal: async (id) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        q('#custom-due-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'custom-due-modal';
        modal.querySelector('.modal-header h3').textContent = Lang.t('dueDate');
        const currentDue = Store.ticketSlaDueAt(t, await Store.getSettings());
        const initialMs = t.customDueAt ? new Date(t.customDueAt).getTime() : currentDue;
        const initialDate = initialMs ? new Date(initialMs) : null;
        modal.querySelector('.modal-body').innerHTML = `
            <div class="form-grid">
                <div class="field">
                    <label>${Lang.t('dateFormatLabel')}</label>
                    <div class="date-input-row">
                        <input id="custom-due-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${initialDate ? Utils.fmtDateOnly(initialDate) : ''}">
                        <button type="button" class="btn-ghost btn-icon" id="custom-due-calendar-btn" title="Kalender öffnen" aria-label="Kalender öffnen">${Icon('calendar', 16)}</button>
                    </div>
                </div>
                <div class="field">
                    <label>${Lang.t('time')}</label>
                    <input id="custom-due-time" type="text" inputmode="numeric" placeholder="17:00" value="${initialDate ? Utils.fmtTimeOnly(initialDate) : '17:00'}">
                </div>
            </div>
            <div id="custom-due-dtp-host" style="display:none;">${UI.dateTimePickerMarkup('custom-due-dtp')}</div>
            <p class="hint">${t.customDueAt ? 'Diese Frist wurde manuell gesetzt und ersetzt die automatische Berechnung.' : 'Standardmäßig wird die Frist aus Priorität und Geschäftszeiten berechnet. Hier kannst du sie für dieses Ticket überschreiben.'}</p>
            ${t.customDueAt ? `<button type="button" class="btn-secondary btn-sm" id="custom-due-reset">${Icon('rotate-ccw', 15)}Automatisch berechnen (zurücksetzen)</button>` : ''}
        `;
        const dtpPicker = UI.createDateTimePicker(q('#custom-due-dtp'), {
            value: initialMs,
            anchor: q('#custom-due-calendar-btn'),
            onChange: (ms) => {
                if (!ms) return;
                const d = new Date(ms);
                q('#custom-due-date').value = Utils.fmtDateOnly(d);
                q('#custom-due-time').value = Utils.fmtTimeOnly(d);
            }
        });
        q('#custom-due-calendar-btn').onclick = () => dtpPicker.open();
        modal.querySelector('.modal-footer .btn-primary').textContent = 'Speichern';
        const resetBtn = q('#custom-due-reset');
        if (resetBtn) resetBtn.onclick = async () => {
            delete t.customDueAt;
            await Store.addLog(t, 'Manuelle Frist zurückgesetzt');
            await Store.saveTickets(tickets);
            modal.classList.remove('open');
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const pickedMs = Utils.parseGermanDateTime(q('#custom-due-date').value, q('#custom-due-time').value);
            if (!pickedMs) { UI.toast('Bitte ein Datum/Uhrzeit wählen.'); return; }
            t.customDueAt = new Date(pickedMs).toISOString();
            await Store.addLog(t, 'Eigene Frist gesetzt', Utils.fmtDate(t.customDueAt));
            await Store.saveTickets(tickets);
            modal.classList.remove('open');
            UI.toast('Frist gespeichert.');
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    toggleMajorIncident: async (id) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        if (t.isMajorIncident) {
            UI.confirm('Großstörung wirklich aufheben? Neue Tickets erhalten dann keinen Hinweis mehr auf diese Störung.', async () => {
                t.isMajorIncident = false;
                delete t.incidentNotice;
                await Store.addLog(t, 'Großstörung aufgehoben');
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Großstörung aufgehoben', `Ticket: ${t.title}`);
                await AdminBoard.openModal(id);
                await AdminBoard.render();
            });
            return;
        }
        q('#generic-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = 'Als Störung markieren';
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label>Sichtbarer Hinweis für Benutzer</label>
                <textarea id="incident-existing-notice" rows="4">${Utils.esc(t.incidentNotice || t.title)}</textarea>
            </div>
            <p class="hint">Diese Störung wird Benutzern beim Erstellen eines Tickets angeboten.</p>
        `;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const notice = q('#incident-existing-notice').value.trim();
            if (!notice) return UI.toast('Bitte einen Hinweis eintragen.');
            t.isMajorIncident = true;
            t.incidentNotice = notice;
            await Store.addLog(t, 'Als Großstörung markiert', notice);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Großstörung markiert', `Ticket: ${t.title}, Hinweis: ${notice}`);
            modal.classList.remove('open');
            UI.toast('Als Störung markiert. Benutzer können Tickets damit verknüpfen.');
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        q('#incident-existing-notice').focus();
    },

    // Beim Schließen eines Großstörungs-Tickets bekommen alle verknüpften Tickets die
    // Lösung automatisch als Chat-Nachricht mitgeteilt, damit niemand einzeln nachfragen muss.
    notifyLinkedIncidentTickets: async (incidentTicket, resolutionText) => {
        const tickets = await Store.getTickets();
        const linked = tickets.filter(t => t.linkedIncidentId === incidentTicket.id && !t.archived);
        if (!linked.length) return;
        const actor = await Store.currentUser();
        for (const t of linked) {
            if (!Array.isArray(t.chat)) t.chat = [];
            t.chat.push({
                text: `Update zur bekannten Störung "${incidentTicket.title}": ${resolutionText || 'Die Störung wurde behoben.'}`,
                author: actor?.name || actor?.username || 'Support',
                authorUsername: actor?.username,
                date: Utils.nowISO(),
                role: 'admin',
                files: []
            });
            await Store.addLog(t, 'Lösung der verknüpften Großstörung automatisch mitgeteilt');
            await Store.addNotifications([t.author], t, 'Es gibt ein Update zur bekannten Störung, die dein Ticket betrifft.', actor?.username, 'newMessage');
        }
        await Store.saveTickets(tickets);
        await Store.addGlobalLog('Großstörung behoben – verknüpfte Tickets informiert', `Haupt-Ticket: ${incidentTicket.title}, Betroffene Tickets: ${linked.length}`);
        UI.toast(`${linked.length} verknüpfte Ticket(s) wurden über die Lösung informiert.`);
    },

    openPrintOptions: async (id) => {
        let modal = q('#print-options-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'print-options-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('printer', 18)}Ticket drucken</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <p class="hint">Wähle aus, welche Inhalte mit ausgedruckt werden sollen.</p>
                        <div class="checkbox-list">
                            <label class="check-row"><input type="checkbox" id="pp-todos" checked>Teilaufgaben</label>
                            <label class="check-row"><input type="checkbox" id="pp-admin-chat" checked>Admin-Chat (intern)</label>
                            <label class="check-row"><input type="checkbox" id="pp-solution" checked>Lösungsweg (intern)</label>
                            <label class="check-row"><input type="checkbox" id="pp-chat" checked>Chat-Verlauf mit Benutzer</label>
                            <label class="check-row"><input type="checkbox" id="pp-time" checked>Zeiterfassung</label>
                            <label class="check-row"><input type="checkbox" id="pp-log">Ticket-Protokoll</label>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="pp-cancel">Abbrechen</button>
                        <button class="btn-primary" id="pp-confirm">${Icon('printer', 16)}Drucken</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
            modal.querySelector('#pp-cancel').onclick = () => modal.classList.remove('open');
        }
        modal.querySelector('#pp-confirm').onclick = async () => {
            modal.classList.remove('open');
            await AdminBoard.printTicket(id, {
                todos: q('#pp-todos').checked,
                adminChat: q('#pp-admin-chat').checked,
                solution: q('#pp-solution').checked,
                chat: q('#pp-chat').checked,
                time: q('#pp-time').checked,
                log: q('#pp-log').checked
            });
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    printTicket: async (id, options = {}) => {
        const opts = { todos: true, adminChat: true, solution: true, chat: true, time: true, log: false, ...options };
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        const users = await Store.getUsers();
        const nameFor = (username) => {
            if (!username) return '-';
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const settings = await Store.getSettings();
        const company = settings.companyConfig || {};
        const actor = await Store.currentUser();
        const slaCountdown = Store.formatSlaCountdown(t, settings);
        const todos = opts.todos ? (t.todos || []).map(d => `<li>${d.done ? '☑' : '☐'} ${Utils.esc(d.title)}${d.assignee ? ' – ' + Utils.esc(nameFor(d.assignee)) : ''}</li>`).join('') : '';
        const entryRow = (c) => `
            <div class="p-entry"><strong>${Utils.esc(c.author)}</strong> <span>${Utils.esc(Utils.fmtDate(c.date))}</span>
            <p>${Utils.esc(c.text || '')}</p></div>`;
        const adminChatEntries = opts.adminChat ? (t.comments || []).filter(c => (c.channel || 'solution') === 'admin-chat').map(entryRow).join('') : '';
        const solutionEntries = opts.solution ? (t.comments || []).filter(c => (c.channel || 'solution') === 'solution').map(entryRow).join('') : '';
        const chat = opts.chat ? (t.chat || []).map(entryRow).join('') : '';
        const logEntries = opts.log ? (t.logs || []).map(l => `
            <div class="p-entry"><strong>${Utils.esc(l.user || '-')}</strong> <span>${Utils.esc(Utils.fmtDate(l.date))}</span>
            <p>${Utils.esc(l.action || '')}${l.details ? ' – ' + Utils.esc(l.details) : ''}</p></div>`).join('') : '';
        const fmtMinutesPrint = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} Std.` : `${mins} Min.`;
        const totalMinutes = (t.timeEntries || []).reduce((sum, e) => sum + (e.minutes || 0), 0);
        const timeEntries = opts.time ? (t.timeEntries || []).map(e => `
            <div class="p-entry"><strong>${Utils.esc(nameFor(e.username))}</strong> <span>${Utils.esc(Utils.fmtDate(e.date))} – ${fmtMinutesPrint(e.minutes)}</span>
            ${e.note ? `<p>${Utils.esc(e.note)}</p>` : ''}</div>`).join('') : '';
        const participants = [...new Set([t.owner, ...(t.participants || [])].filter(Boolean))].map(nameFor).join(', ') || '-';
        const incidentOf = t.linkedIncidentId ? tickets.find(x => x.id === t.linkedIncidentId) : null;
        const linkedToIncident = t.isMajorIncident ? tickets.filter(x => x.linkedIncidentId === t.id && !x.archived) : [];
        const incidentSection = t.isMajorIncident ? `<h2>Großstörung</h2>
            <p class="desc">${Utils.esc(t.incidentNotice || '')}</p>
            <div class="grid"><div><strong>Zugeordnete Tickets</strong>${linkedToIncident.length}</div></div>
            ${linkedToIncident.length ? `<ul>${linkedToIncident.map(x => `<li>${Utils.esc(x.ticketNumber || x.id)} · ${Utils.esc(x.title)} – ${Utils.esc(nameFor(x.author) || x.author || '-')} – ${Utils.esc(x.status)}</li>`).join('')}</ul>` : '<p class="desc">Keine Tickets zugeordnet.</p>'}` : incidentOf ? `<h2>Großstörung</h2><p class="desc">Zugeordnet zu ${Utils.esc(incidentOf.ticketNumber || incidentOf.id)} · ${Utils.esc(incidentOf.title)}</p>` : '';
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${Utils.esc(t.ticketNumber || t.id)}</title>
            <style>
                body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;max-width:800px;margin:0 auto;}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain;}
                h1{font-size:20px;margin:0 0 4px;}
                .meta{color:#555;font-size:12px;margin-bottom:16px;}
                .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:16px;font-size:13px;}
                .grid div strong{display:block;font-size:11px;color:#555;text-transform:uppercase;}
                h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px;}
                .desc{white-space:pre-wrap;font-size:13px;}
                ul{padding-left:20px;font-size:13px;}
                .p-entry{border-bottom:1px solid #eee;padding:6px 0;font-size:12px;}
                .p-entry span{color:#777;margin-left:8px;}
                .p-entry p{margin:4px 0 0;white-space:pre-wrap;}
            </style></head><body>
            <div class="print-head">
                <div>
                    <h1>${Utils.esc(t.ticketNumber || t.id)} &middot; ${Utils.esc(t.title)}</h1>
                    <div class="meta">Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))}</div>
                </div>
                ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}
            </div>
            <div class="grid">
                <div><strong>Von</strong>${Utils.esc(nameFor(t.author) || t.author)}</div>
                <div><strong>Erstellt am</strong>${Utils.esc(Utils.fmtDate(t.createdAt))}</div>
                <div><strong>Status</strong>${Utils.esc(t.status)}</div>
                <div><strong>Priorität</strong>${Utils.esc(t.prio)}</div>
                <div><strong>Kategorie</strong>${Utils.esc((t.category || []).join(', ') || '-')}</div>
                <div><strong>Hauptverantwortlicher</strong>${Utils.esc(nameFor(t.owner))}</div>
                <div><strong>Beteiligte Personen</strong>${Utils.esc(participants)}</div>
                ${slaCountdown ? `<div><strong>Frist</strong>${Utils.esc(slaCountdown.label)} (${Utils.esc(slaCountdown.dueDateLabel)})</div>` : ''}
            </div>
            <h2>Beschreibung</h2>
            <p class="desc">${Utils.esc(t.desc || 'Keine Beschreibung')}</p>
            ${incidentSection}
            ${todos ?`<h2>Teilaufgaben</h2><ul>${todos}</ul>` : ''}
            ${adminChatEntries ? `<h2>Admin-Chat</h2>${adminChatEntries}` : ''}
            ${solutionEntries ? `<h2>Lösungsweg</h2>${solutionEntries}` : ''}
            ${chat ? `<h2>Chat-Verlauf</h2>${chat}` : ''}
            ${timeEntries ? `<h2>Zeiterfassung (gesamt: ${Utils.esc(fmtMinutesPrint(totalMinutes))})</h2>${timeEntries}` : ''}
            ${logEntries ? `<h2>Ticket-Protokoll</h2>${logEntries}` : ''}
            </body></html>`;
        UI.printHTML(html);
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

            q('#m-title').textContent = `${t.ticketNumber || t.id} · ${t.title}${t.archived ? ' [ARCHIVIERT]' : ''}`;
            q('#m-desc').textContent = t.desc || 'Keine Beschreibung';
            {
                const fieldsSettings = await Store.getSettings();
                UI.renderCustomFieldsDisplay(q('#m-custom-fields-display'), Store.getCustomFieldsForCategories(t.category, fieldsSettings), t.customFieldValues || {});
            }
            AdminBoard.renderTicketAttachments(t, '#m-ticket-attachments');
            AdminBoard.renderIncidentLinkedTickets(t, tickets);

            // Elements
            const prioSel = q('#m-prio-edit');
            const statusSel = q('#m-status-edit');
            const catSel = q('#m-cat-edit');
            const commentInput = q('#m-new-comment');
            const commentBtn = q('#btn-add-comment');
            const chatInput = q('#m-chat-input');
            const chatSend = q('#btn-chat-send');
            const btnArch = q('#btn-archive-ticket');
            const btnLogs = q('#m-logs');
            const btnEditTicket = q('#m-edit-ticket');
            if (btnEditTicket) {
                btnEditTicket.style.display = t.archived ? 'none' : '';
                btnEditTicket.onclick = () => AdminBoard.editTicket(t.id);
            }
            const btnPrint = q('#m-print');
            if (btnPrint) btnPrint.onclick = () => AdminBoard.openPrintOptions(t.id);

            const btnIncident = q('#btn-mark-incident');
            if (btnIncident) {
                btnIncident.style.display = (t.archived || t.linkedIncidentId) ? 'none' : '';
                btnIncident.innerHTML = t.isMajorIncident ? `${Icon('siren', 16)}Großstörung aufheben` : `${Icon('siren', 16)}Als Großstörung markieren`;
                btnIncident.classList.toggle('btn-danger', !!t.isMajorIncident);
                btnIncident.onclick = () => AdminBoard.toggleMajorIncident(t.id);
            }

            const btnAssignIncident = q('#btn-assign-incident');
            if (btnAssignIncident) {
                const activeIncidents = tickets.filter(x => x.isMajorIncident && !x.archived && x.status !== 'Geschlossen' && x.id !== t.id);
                btnAssignIncident.style.display = (t.archived || t.isMajorIncident || t.linkedIncidentId || !activeIncidents.length) ? 'none' : '';
                btnAssignIncident.onclick = async () => {
                    const choice = await UI.askIncidentLink(activeIncidents, { title: 'Ticket einer Störung zuordnen', confirmLabel: 'Zuordnen' });
                    if (choice) {
                        await AdminBoard.linkTicketToIncident(t.id, choice);
                        await AdminBoard.openModal(t.id);
                    }
                };
            }

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
            if (statusSel) {
                statusSel.value = t.status;
                statusSel.disabled = t.archived;
                statusSel.onchange = async () => {
                    const newStatus = statusSel.value;
                    let waitingMessage = '';
                    if (newStatus === 'Warten auf Benutzer') {
                        const request = await AdminBoard.chooseWaitingStatus(newStatus);
                        if (!request) {
                            statusSel.value = t.status;
                            return;
                        }
                        waitingMessage = request.message;
                    }
                    const changed = await AdminBoard.changeStatus(t.id, newStatus, waitingMessage);
                    if (!changed) statusSel.value = t.status;
                };
            }
            if (catSel) catSel.disabled = t.archived;
            if (commentInput) commentInput.disabled = t.archived;
            if (commentBtn) commentBtn.disabled = t.archived;
            ['#m-note-type', '#m-note-bold', '#m-note-italic', '#m-note-list', '#m-note-numbered', '#m-note-table', '#m-note-file-input', '#m-note-pin', '#m-note-resolution', '#m-admin-note-type', '#m-admin-note-bold', '#m-admin-note-italic', '#m-admin-note-list', '#m-admin-note-file-input', '#m-admin-note-pin'].forEach(selector => {
                const el = q(selector);
                if (el) el.disabled = t.archived;
            });
            if (q('#m-admin-new-comment')) q('#m-admin-new-comment').disabled = t.archived;
            if (q('#btn-add-admin-comment')) q('#btn-add-admin-comment').disabled = t.archived;
            if (chatInput) chatInput.disabled = t.archived || !!t.authorArchived;
            if (chatSend) chatSend.disabled = t.archived || !!t.authorArchived;

            // Metadata
            if (q('#m-author')) q('#m-author').textContent = t.authorName || t.author;
            if (q('#m-date')) q('#m-date').textContent = Utils.fmtDate(t.createdAt);

            // Lösungsfrist: Badge mit verbleibender/überschrittener Zeit, dazu ein dezenter
            // roter Rahmen ums Popup, wenn die Frist schon überschritten ist.
            const slaItem = q('#m-sla-item');
            const slaBadge = q('#m-sla-badge');
            const slaSettingsForModal = await Store.getSettings();
            const slaCountdown = Store.formatSlaCountdown(t, slaSettingsForModal);
            if (slaItem && slaBadge) {
                slaItem.hidden = !slaCountdown;
                if (slaCountdown) {
                    slaBadge.className = `sla-badge sla-badge-${slaCountdown.tone}`;
                    slaBadge.title = `Frist: ${slaCountdown.dueDateLabel}${t.customDueAt ? ' (manuell gesetzt)' : ''}`;
                    slaBadge.innerHTML = `${Icon(slaCountdown.overdue ? 'triangle-alert' : 'timer', 13)}${Utils.esc(slaCountdown.dueDateLabel)} · ${Utils.esc(slaCountdown.label)}${t.customDueAt ? ' ' + Icon('pin', 11) : ''}`;
                }
            }
            q('#ticket-modal .modal')?.classList.toggle('is-sla-overdue', !!slaCountdown?.overdue);
            const slaEditBtn = q('#m-sla-edit');
            if (slaEditBtn) slaEditBtn.onclick = () => AdminBoard.openCustomDueModal(t.id);

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
                    await AdminBoard.setupMentionAutocomplete(t);
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
            await AdminBoard.setupMentionAutocomplete(t);

            AdminBoard.noteFiles = {
                'admin-chat': [],
                solution: []
            };
            AdminBoard.renderNoteFilePreview('admin-chat');
            AdminBoard.renderNoteFilePreview('solution');
            AdminBoard.renderInternalComments(t, 'admin-chat');
            AdminBoard.renderInternalComments(t, 'solution');
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
        if (q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
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

        const renderToken = AdminBoard.historyRenderToken = (AdminBoard.historyRenderToken || 0) + 1;
        const words = searchInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        content.innerHTML = '';

        const tickets = (await Store.getTickets())
            .filter(x => x.author === username)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (renderToken !== AdminBoard.historyRenderToken) return;

        const haystackOf = t => [
            t.ticketNumber, t.id, t.title, t.desc, Lang.status(t.status), t.status,
            ...(Array.isArray(t.category) ? t.category : [t.category]),
            t.authorName, Utils.fmtDate(t.createdAt)
        ].filter(Boolean).join(' ').toLowerCase();
        const filtered = tickets.filter(t => words.every(word => haystackOf(t).includes(word)));

        if (filtered.length === 0) {
            content.innerHTML = `<div class="empty-state">${words.length ? 'Keine Treffer' : 'Keine Historie vorhanden'}</div>`;
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

    renderInternalComments: (t, channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const box = q(channel === 'admin-chat' ? '#m-admin-comments' : '#m-comments');
        if (!box) return;
        box.innerHTML = '';
        const searchWrap = q(`#${prefix}-search-wrap`);
        const searchInput = q(`#${prefix}-search`);
        const commentsRaw = (t.comments || [])
            .map((comment, index) => ({
                ...comment,
                originalIndex: index
            }))
            .filter(comment => (comment.channel || 'solution') === channel);
        const countSelector = channel === 'admin-chat' ? '#m-admin-note-count' : '#m-solution-note-count';
        if (q(countSelector)) q(countSelector).textContent = String(commentsRaw.length);
        if (searchWrap) searchWrap.style.display = commentsRaw.length ? 'flex' : 'none';
        if (commentsRaw.length === 0 && searchInput) searchInput.value = '';
        if (commentsRaw.length === 0) {
            box.innerHTML = `<div class="empty-state compact">${channel === 'admin-chat' ? 'Noch keine Admin-Nachrichten.' : 'Noch keine Lösungsversuche dokumentiert.'}</div>`;
            return;
        }
        const renderText = (value = '') => {
            const lines = Utils.esc(value).replace(/\r/g, '').split('\n');
            const inline = text => text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
            const cellsFrom = line => {
                const trimmed = line.trim();
                if (!trimmed.startsWith('|')) return null;
                return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
            };
            const isTableSeparator = cells => cells?.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
            const output = [];
            let listType = '';
            const closeList = () => {
                if (listType) output.push(`</${listType}>`);
                listType = '';
            };

            for (let index = 0; index < lines.length;) {
                const header = cellsFrom(lines[index]);
                const separator = cellsFrom(lines[index + 1] || '');
                if (header?.length > 1 && isTableSeparator(separator)) {
                    closeList();
                    const rows = [];
                    let rowIndex = index + 2;
                    while (rowIndex < lines.length) {
                        const cells = cellsFrom(lines[rowIndex]);
                        if (!cells) break;
                        rows.push(cells);
                        rowIndex++;
                    }
                    output.push(`<div class="note-table-wrap"><table class="note-markdown-table"><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
                    index = rowIndex;
                    continue;
                }

                const bullet = lines[index].match(/^\s*-\s+(.*)$/);
                const numbered = lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
                const listItem = bullet || numbered;
                if (listItem) {
                    const nextType = bullet ? 'ul' : 'ol';
                    if (listType !== nextType) {
                        closeList();
                        listType = nextType;
                        output.push(`<${listType}>`);
                    }
                    output.push(`<li>${inline(listItem[1])}</li>`);
                    index++;
                    continue;
                }
                closeList();
                output.push(lines[index] ? `${inline(lines[index])}<br>` : '<br>');
                index++;
            }
            closeList();
            return output.join('');
        };
        const query = (searchInput?.value || '').toLowerCase().trim();
        const comments = [...commentsRaw]
            .map(comment => ({
                ...comment,
                index: comment.originalIndex
            }))
            .filter(c => !query || [
                c.text,
                c.author,
                c.type,
                Utils.fmtDate(c.date),
                ...(c.files || []).map(f => f.name)
            ].join(' ').toLowerCase().includes(query))
            .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Number(!!b.resolution) - Number(!!a.resolution) || new Date(b.date) - new Date(a.date));
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
                        ${c.resolution ? `<span class="note-type note-resolution">${Icon('check-circle', 12)}Endgültige Lösung</span>` : ''}
                    </div>
                    <div class="note-actions">
                        <span>${Utils.fmtDate(c.date)}</span>
                        <button class="btn-ghost btn-icon btn-xs note-edit" title="Kommentar bearbeiten" aria-label="Kommentar bearbeiten">${Icon('pencil', 13)}</button>
                    </div>
                </div>
                <div class="note-body">${renderText(c.text)}</div>
                ${(c.files || []).length ? `
                    <div class="note-attachments">
                        ${c.files.map((file, fileIndex) => `<button type="button" class="file-chip note-attachment-preview" data-file-index="${fileIndex}">${Icon('paperclip', 12)}<span>${Utils.esc(file.name)}</span></button>`).join('')}
                    </div>
                ` : ''}
            `;
            div.querySelector('.note-edit')?.addEventListener('click', () => AdminBoard.editInternalComment(Number(div.dataset.index), channel));
            div.querySelectorAll('.note-attachment-preview').forEach(btn => {
                btn.onclick = () => AdminBoard.openAttachmentPreview(c.files[Number(btn.dataset.fileIndex)]);
            });
            box.appendChild(div);
        });
        box.scrollTop = 0;
        if (window.lucide) lucide.createIcons();
    },

    renderNoteFilePreview: (channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const files = AdminBoard.noteFiles[channel];
        const pan = q(`#${prefix}-file-preview`);
        if (!pan) return;
        pan.innerHTML = '';
        pan.style.display = files.length ? 'flex' : 'none';
        files.forEach((f, idx) => {
            const tag = document.createElement('div');
            tag.className = 'file-chip';
            tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
            tag.querySelector('button').onclick = () => {
                files.splice(idx, 1);
                AdminBoard.renderNoteFilePreview(channel);
            };
            pan.appendChild(tag);
        });
        if (window.lucide) lucide.createIcons();
    },

    editInternalComment: async (index, channel = 'solution') => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === AdminBoard.currentTicketId);
        const note = t?.comments?.[index];
        if (!note) return;
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const input = q(channel === 'admin-chat' ? '#m-admin-new-comment' : '#m-new-comment');
        input.value = note.text || '';
        if (q(`#${prefix}-type`)) q(`#${prefix}-type`).value = note.type || (channel === 'admin-chat' ? 'Abstimmung' : 'Analyse');
        if (q(`#${prefix}-pin`)) q(`#${prefix}-pin`).checked = !!note.pinned;
        if (q('#m-note-resolution')) q('#m-note-resolution').checked = !!note.resolution;
        const saveBtn = q(channel === 'admin-chat' ? '#btn-add-admin-comment' : '#btn-add-comment');
        if (saveBtn) {
            saveBtn.dataset.editIndex = String(index);
            saveBtn.innerHTML = `${Icon('save', 16)}Eintrag aktualisieren`;
        }
        input.focus();
        if (window.lucide) lucide.createIcons();
    },

    postInternalComment: async (channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const input = q(channel === 'admin-chat' ? '#m-admin-new-comment' : '#m-new-comment');
        const txt = input.value.trim();
        const filesToUpload = [...AdminBoard.noteFiles[channel]];
        const saveBtn = q(channel === 'admin-chat' ? '#btn-add-admin-comment' : '#btn-add-comment');
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
            channel,
            type: q(`#${prefix}-type`)?.value || 'Notiz',
            pinned: !!q(`#${prefix}-pin`)?.checked,
            resolution: channel === 'solution' && !!q('#m-note-resolution')?.checked,
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
        const mentionedUsers = new Set([...txt.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map(match => match[1].toLowerCase()));
        const mentionedAdmins = channel === 'admin-chat' ? (await Store.getUsers()).filter(person =>
            person.username !== user.username &&
            AdminBoard.canAccessTicket(person, t) &&
            mentionedUsers.has(person.username.toLowerCase())
        ) : [];
        await Store.addNotifications(mentionedAdmins.map(person => person.username), t, `${user.name || user.username} hat dich in einem internen Kommentar erwähnt.`, user.username, 'mention');
        const mentionSettings = await Store.getSettings();
        if (mentionSettings.emailConfig?.host) {
            for (const admin of mentionedAdmins) {
                if (!admin.email) continue;
                const pref = await Store.resolveNotifPref(admin, 'mention');
                if (pref.email) Store.sendEmail(admin.email, `Erwähnung in Ticket: ${t.title}`, `${user.name || user.username} hat dich in einem internen Kommentar erwähnt.`);
            }
        }
        await Notifications.refresh();
        input.value = '';
        if (q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
        AdminBoard.noteFiles[channel] = [];
        if (saveBtn) {
            delete saveBtn.dataset.editIndex;
            saveBtn.innerHTML = `${Icon('plus', 16)}Eintrag speichern`;
        }
        if (q(`#${prefix}-pin`)) q(`#${prefix}-pin`).checked = false;
        if (channel === 'solution' && q('#m-note-resolution')) q('#m-note-resolution').checked = false;
        AdminBoard.renderNoteFilePreview(channel);
        AdminBoard.renderInternalComments(t, channel);
        await AdminBoard.render();
    },

    editChatMessage: async (ticketId, messageIndex, containerSelector) => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(item => item.id === ticketId);
        const message = ticket?.chat?.[messageIndex];
        const user = await Store.currentUser();
        if (!ticket || !message || ticket.archived || !user) return;
        const isAuthor = message.authorUsername ? message.authorUsername === user.username :
            (message.author === user.username || message.author === user.name);
        if (!isAuthor) return UI.toast('Du kannst nur eigene Nachrichten bearbeiten.');
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = 'Chatnachricht bearbeiten';
        modal.querySelector('.modal-body').innerHTML = '<div class="field"><label for="edit-chat-message">Nachricht</label><textarea id="edit-chat-message" rows="7"></textarea></div>';
        q('#edit-chat-message').value = message.text || '';
        const saveButton = modal.querySelector('.modal-footer .btn-primary');
        saveButton.textContent = 'Speichern';
        saveButton.onclick = async () => {
            const nextText = q('#edit-chat-message').value.trim();
            if (!nextText) return UI.toast('Die Nachricht darf nicht leer sein.');
            const previousText = message.text;
            message.text = nextText;
            message.editedAt = Utils.nowISO();
            message.editedBy = user.name || user.username;
            await Store.addLog(ticket, 'Chatnachricht bearbeitet', `Vorher: ${previousText}\nNachher: ${nextText}`);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Chatnachricht bearbeitet', `Ticket ${ticket.ticketNumber || ticket.id}`);
            modal.classList.remove('open');
            await AdminBoard.renderChat(ticket, containerSelector);
        };
        modal.classList.add('open');
        q('#edit-chat-message').focus();
    },

    // data: URIs werden von Chrome in iframes/embed häufig blockiert ("Diese Seite wurde von
    // Chrome blockiert"). blob:-URLs aus demselben Origin sind davon nicht betroffen -- daher
    // wird jeder Anhang vor der Anzeige einmal in ein Blob umgewandelt.
    dataUriToBlobUrl: (dataUri, mime) => {
        const commaIdx = dataUri.indexOf(',');
        const meta = dataUri.slice(5, commaIdx);
        const isBase64 = meta.includes(';base64');
        const payload = dataUri.slice(commaIdx + 1);
        const byteString = isBase64 ? atob(payload) : decodeURIComponent(payload);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime || meta.split(';')[0] || 'application/octet-stream' });
        return URL.createObjectURL(blob);
    },

    openAttachmentPreview: async (file) => {
        let attachment = file;
        if (!attachment?.data && (attachment?.attachmentId || attachment?.id)) {
            attachment = await Store.getAttachment(attachment.attachmentId || attachment.id);
        }
        if (!attachment?.data) return UI.toast('Anhang nicht gefunden.');
        if (AdminBoard._lastPreviewBlobUrl) {
            URL.revokeObjectURL(AdminBoard._lastPreviewBlobUrl);
            AdminBoard._lastPreviewBlobUrl = null;
        }
        let blobUrl = null;
        try {
            blobUrl = AdminBoard.dataUriToBlobUrl(attachment.data, attachment.type);
            AdminBoard._lastPreviewBlobUrl = blobUrl;
        } catch (error) {
            console.error(error);
        }

        let modal = q('#attachment-preview-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'attachment-preview-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-xl attachment-preview-modal">
                    <div class="modal-header">
                        <h3 id="attachment-preview-title"></h3>
                        <div class="modal-actions">
                            <a class="btn-ghost btn-icon" id="attachment-preview-open" target="_blank" rel="noopener" title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">${Icon('external-link', 16)}</a>
                            <a class="btn-ghost btn-icon" id="attachment-preview-download" title="Herunterladen" aria-label="Herunterladen">${Icon('download', 16)}</a>
                            <button class="btn-ghost btn-icon" data-close-preview title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body attachment-preview-body" id="attachment-preview-body"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('[data-close-preview]').onclick = () => modal.classList.remove('open');
            modal.onclick = event => {
                if (event.target === modal) modal.classList.remove('open');
            };
        }
        const name = String(attachment.name || '').toLowerCase();
        const mime = attachment.type || 'application/octet-stream';
        q('#attachment-preview-title').textContent = attachment.name || 'Anhang';
        const topDownload = q('#attachment-preview-download');
        const topOpen = q('#attachment-preview-open');
        const previewSrc = blobUrl || attachment.data;
        if (topDownload) {
            topDownload.href = previewSrc;
            topDownload.download = attachment.name || 'Anhang';
        }
        if (topOpen) {
            topOpen.href = previewSrc;
            topOpen.style.display = 'inline-flex';
        }
        const body = q('#attachment-preview-body');
        body.replaceChildren();
        const addText = text => {
            const pre = document.createElement('pre');
            pre.className = 'attachment-text-preview';
            pre.textContent = text;
            body.appendChild(pre);
        };
        if (mime === 'application/pdf' || name.endsWith('.pdf')) {
            if (blobUrl) {
                const frameWrap = document.createElement('div');
                frameWrap.className = 'attachment-document-frame-wrap';
                const frame = document.createElement('iframe');
                frame.className = 'attachment-document-frame';
                frame.src = blobUrl;
                frame.title = attachment.name || 'PDF-Vorschau';
                frameWrap.appendChild(frame);
                body.appendChild(frameWrap);
            } else {
                const message = document.createElement('div');
                message.className = 'attachment-download-fallback';
                message.innerHTML = `${Icon('file-text', 28)}<strong>PDF-Vorschau konnte nicht geladen werden</strong><span>Nutze oben das Öffnen- oder Download-Icon.</span>`;
                body.appendChild(message);
            }
        } else if (mime.startsWith('image/')) {
            const image = document.createElement('img');
            image.className = 'attachment-image-preview';
            image.src = previewSrc;
            image.alt = attachment.name || 'Bildanhang';
            body.append(image);
        } else if (/\.(txt|csv|tsv|json|xml|md|log|html?)$/.test(name) || mime.startsWith('text/')) {
            try {
                addText(await (await fetch(previewSrc)).text());
            } catch {
                addText('Diese Datei kann nicht als Text gelesen werden.');
            }
        } else if (/\.(docx|xlsx|xls|pptx)$/.test(name)) {
            try {
                const buffer = await (await fetch(previewSrc)).arrayBuffer();
                if (name.endsWith('.docx') && window.mammoth) {
                    const result = await window.mammoth.extractRawText({
                        arrayBuffer: buffer
                    });
                    addText(result.value || 'Das Dokument enthält keinen extrahierbaren Text.');
                } else if (/\.(xlsx|xls)$/.test(name) && window.XLSX) {
                    const workbook = window.XLSX.read(buffer, {
                        type: 'array'
                    });
                    workbook.SheetNames.forEach(sheetName => {
                        const heading = document.createElement('h4');
                        heading.textContent = sheetName;
                        body.appendChild(heading);
                        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
                            header: 1,
                            raw: false
                        }).slice(0, 300);
                        const table = document.createElement('table');
                        table.className = 'attachment-spreadsheet-preview';
                        rows.forEach(row => {
                            const tr = table.insertRow();
                            row.forEach(value => {
                                const cell = tr.insertCell();
                                cell.textContent = String(value ?? '');
                            });
                        });
                        body.appendChild(table);
                    });
                } else if (name.endsWith('.pptx') && window.JSZip) {
                    const archive = await window.JSZip.loadAsync(buffer);
                    const slides = Object.keys(archive.files)
                        .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
                        .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
                    for (const [index, path] of slides.entries()) {
                        const xml = await archive.files[path].async('text');
                        const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
                        const text = Array.from(documentXml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't'))
                            .map(node => node.textContent)
                            .filter(Boolean)
                            .join(' ');
                        const heading = document.createElement('h4');
                        heading.textContent = `Folie ${index + 1}`;
                        const paragraph = document.createElement('p');
                        paragraph.textContent = text || 'Kein Text auf dieser Folie.';
                        body.append(heading, paragraph);
                    }
                } else {
                    addText('Die Office-Vorschau konnte nicht geladen werden.');
                }
            } catch {
                addText('Die Datei konnte nicht geöffnet werden. Nutze das Download-Icon oben.');
            }
        } else if (mime.startsWith('audio/') || mime.startsWith('video/')) {
            const media = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video');
            media.controls = true;
            media.className = 'attachment-media-preview';
            media.src = previewSrc;
            body.append(media);
        } else {
            const message = document.createElement('p');
            message.className = 'empty-state';
            message.textContent = 'Für dieses Dateiformat ist keine sichere Vorschau verfügbar. Nutze das Download-Icon oben.';
            body.append(message);
        }
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    renderChat: async (ticket, containerSelector) => {
        const box = q(containerSelector);
        if (!box) return;
        box.innerHTML = '';

        const msgs = ticket.chat || [];

        if (msgs.length === 0) {
            box.innerHTML = '<div class="empty-state">Keine Nachrichten</div>';
            return;
        }

        const currentUser = await Store.currentUser();

        msgs.forEach((m, messageIndex) => {
            const el = document.createElement('div');
            const isMe = m.authorUsername ? m.authorUsername === currentUser.username :
                (m.author === currentUser.name || m.author === currentUser.username);
            const roleClass = ['admin', 'superadmin'].includes(m.role) ? 'from-admin' : m.role === 'user' ? 'from-user' : '';
            el.className = `chat-bubble ${isMe ? 'me' : 'other'} ${roleClass}`.trim();

            let fileHtml = '';
            // Supports multiple files?
            // If data structure changed to array of files:
            if (m.files && Array.isArray(m.files)) {
                m.files.forEach((f, fileIndex) => {
                    if (f.type?.startsWith('image/') && f.data) {
                        fileHtml += `<img src="${f.data}" class="msg-img attachment-preview" data-message-index="${messageIndex}" data-file-index="${fileIndex}" alt="${Utils.esc(f.name)}">`;
                    } else {
                        fileHtml += `<button type="button" class="msg-file attachment-preview" data-message-index="${messageIndex}" data-file-index="${fileIndex}">${Icon('paperclip', 13)}${Utils.esc(f.name)}</button>`;
                    }
                });
            } else if (m.file) { // Legacy single file
                if (m.file.type?.startsWith('image/') && m.file.data) {
                    fileHtml = `<img src="${m.file.data}" class="msg-img attachment-preview" data-message-index="${messageIndex}" data-file-index="-1" alt="${Utils.esc(m.file.name)}">`;
                } else {
                    fileHtml = `<button type="button" class="msg-file attachment-preview" data-message-index="${messageIndex}" data-file-index="-1">${Icon('paperclip', 13)}${Utils.esc(m.file.name)}</button>`;
                }
            }

            const htmlText = Utils.formatRichText(m.text || '');

            el.innerHTML = `
                <div class="msg-meta">
                    <span>${Utils.esc(m.author)}</span>
                    <span class="msg-meta-actions">${Utils.fmtDate(m.date)}${m.editedAt ? ' · bearbeitet' : ''}${isMe && !ticket.archived ? `<button type="button" class="btn-ghost btn-icon btn-xs chat-message-edit" data-message-index="${messageIndex}" title="Nachricht bearbeiten" aria-label="Nachricht bearbeiten">${Icon('pencil', 12)}</button>` : ''}</span>
                </div>
                ${htmlText}
                ${fileHtml}
            `;
            box.appendChild(el);
            el.querySelector('.chat-message-edit')?.addEventListener('click', () => AdminBoard.editChatMessage(ticket.id, messageIndex, containerSelector));
            el.querySelectorAll('.attachment-preview').forEach(preview => {
                preview.onclick = () => {
                    const index = Number(preview.dataset.fileIndex);
                    const attachment = index < 0 ? m.file : m.files?.[index];
                    AdminBoard.openAttachmentPreview(attachment);
                };
            });
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
            authorUsername: user.username,
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
        const users = await Store.getUsers();
        let notifyUsers;
        if (role === 'user') {
            notifyUsers = [...new Set([t.owner, ...(t.participants || []), ...(t.assignees || [])].filter(Boolean))];
            if (!notifyUsers.length) notifyUsers = users.filter(person => person.role === 'admin' || person.role === 'superadmin').map(person => person.username);
        } else {
            notifyUsers = [t.author];
        }
        await Store.addNotifications(notifyUsers, t, `${user.name || user.username}: ${txt || 'Dateianhang'}`, user.username, 'newMessage');
        await Notifications.refresh();

        const settings = await Store.getSettings();
        if (settings.emailConfig?.host) {
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

            for (const [email, recipient] of recipients) {
                const pref = await Store.resolveNotifPref(recipient, 'newMessage');
                if (pref.email) Store.sendEmail(email, `Neue Nachricht: ${t.title}`, `${user.name || user.username}: ${txt || 'Dateianhang'}`);
            }
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

        const blob = new Blob([csv], {
            type: 'text/csv'
        });
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
    await Notifications.init();
    UI.initTooltips();
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
            } else if (Auth.lastError === 'archived') {
                UI.toast('Dieses Konto ist archiviert. Bitte wende dich an den Support.');
            } else if (Auth.lastError === 'locked') {
                UI.toast('Dieses Konto ist gesperrt. Bitte wende dich an den Support.');
            } else if (Auth.lastError === 'tempLocked') {
                UI.toast(`Zu viele Fehlversuche. Erneut versuchen ab ${new Date(Auth.lockedUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`);
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
