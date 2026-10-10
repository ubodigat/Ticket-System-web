/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q } from './utils.js';
import { Store } from './store.js';

// --- i18n ---
export const Lang = {
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
        const setIconText = (selector, iconName, size, text) => {
            const el = q(selector);
            if (!el) return;
            const icon = document.createElement('i');
            icon.dataset.lucide = iconName;
            icon.setAttribute('width', String(size));
            icon.setAttribute('height', String(size));
            el.replaceChildren(icon, document.createTextNode(text));
        };
        const setText = (selector, text) => {
            const el = q(selector);
            if (el) el.textContent = text;
        };
        setIconText('#btn-to-dash', 'layout-dashboard', 16, Lang.t('dashboard'));
        setIconText('#btn-global-logs', 'bell', 16, Lang.t('systemLogs'));
        setIconText('#btn-archive', 'archive', 16, Lang.t('archive'));
        setIconText(
            '#btn-list-view',
            q('#list-view')?.style.display === 'block' ? 'layout-grid' : 'table-properties',
            16,
            q('#list-view')?.style.display === 'block' ? Lang.t('board') : Lang.t('list')
        );
        setIconText('#btn-admin-create-ticket', 'plus', 16, Lang.t('newTicket'));
        setIconText('#btn-admin-create-incident', 'siren', 16, Lang.t('createIncident'));
        const adminSearchLabel = q('label[for="admin-ticket-search"]');
        if (adminSearchLabel) adminSearchLabel.textContent = Lang.t('searchTickets');
        const adminTicketSearch = q('#admin-ticket-search');
        if (adminTicketSearch) adminTicketSearch.placeholder = Lang.t('ticketSearchPlaceholder');
        const notifBtn = q('#btn-notifications');
        if (notifBtn) {
            notifBtn.title = Lang.t('notifications');
            notifBtn.setAttribute('aria-label', Lang.t('notifications'));
        }
        setIconText('#archive-view .archive-header h3', 'archive', 18, Lang.t('archivedTickets'));
        setIconText('#btn-back-kanban', 'arrow-left', 16, Lang.t('backToOverview'));
        const archiveSearch = q('#archive-search');
        if (archiveSearch) archiveSearch.placeholder = Lang.current === 'en' ? 'Search archive (title, author, content)...' : 'Suche im Archiv (Titel, Autor, Inhalt)...';
        setText('#requests-board .request-banner-title', Lang.t('requests'));
        setText('#overdue-board .request-banner-title', Lang.t('overdue'));
        const replaceCountLabel = (currentSelector, id, label, className = '') => {
            const current = q(currentSelector);
            const wrapper = current?.parentElement;
            if (!wrapper) return;
            const value = current.textContent || '0';
            wrapper.textContent = '';
            const count = document.createElement('b');
            count.id = id;
            if (className) count.className = className;
            count.textContent = value;
            wrapper.append(count, document.createTextNode(` ${label}`));
        };
        replaceCountLabel('#request-count', 'request-count', Lang.t('open'));
        replaceCountLabel('#overdue-ticket-count', 'overdue-ticket-count', Lang.t('tickets'), 'overdue-count');
        setIconText('#requests-modal-title', 'user-round-plus', 18, Lang.t('requests'));
        setIconText('#col-new .col-header span:first-child', 'inbox', 16, Lang.t('statusNew'));
        setIconText('#col-doing .col-header span:first-child', 'loader', 16, Lang.t('statusDoing'));
        setIconText('#col-waiting .col-header span:first-child', 'pause-circle', 16, Lang.t('statusWaiting'));
        setIconText('#col-done .col-header span:first-child', 'check-circle', 16, Lang.t('statusClosed'));
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
        setIconText('#btn-archive-ticket', 'archive', 16, Lang.t('archive'));
        setIconText('#approve-modal h3', 'user-plus', 18, Lang.t('createUser'));
        setIconText('#user-man-modal h3', 'users', 18, Lang.t('userManagement'));
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
// Das frühere clientseitige TOTP-Objekt (eigenes Secret im Browser erzeugt, Prüfung im Browser,
// mit einem Fallback der token === '123456' akzeptierte, falls OTPAuth nicht geladen war) ist
// entfernt. 2FA läuft jetzt ausschließlich serverseitig über /api/v2/mfa/* und
// /api/v1/auth/mfa-verify (siehe Auth.login/Auth.verifyMfa, AdminBoard/Settings-2FA-Dialoge).
