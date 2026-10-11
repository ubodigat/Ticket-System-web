/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';
import { UserDash } from './user-dash.js';
import { Settings } from './settings.js';
import { LogDiff } from './log-diff.js';

export const Store = {
    openDataDb: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('ticket_system_data', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('records', {
            keyPath: 'key'
        });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }),
    readRecord: async (key, fallback) => {
        try {
            const db = await Store.openDataDb();
            const record = await new Promise((resolve, reject) => {
                const tx = db.transaction('records', 'readonly');
                const req = tx.objectStore('records').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return record?.value ?? fallback;
        } catch {
            return fallback;
        }
    },
    writeRecord: async (key, value) => {
        const db = await Store.openDataDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('records', 'readwrite');
            tx.objectStore('records').put({ key, value });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    },
    readPersistent: async (key, fallback) => {
        // Im Serverbetrieb liegen fachliche Daten in der Datenbank. Reine Geräte-/UI-Einstellungen
        // wie Theme, Sprache, Akzentfarbe und eigenes Hintergrundbild bleiben bewusst lokal pro
        // Browser. Sonst würde die Oberfläche bei jedem Seitenwechsel auf Defaults zurückfallen.
        if (location.protocol.startsWith('http') && key !== 'app_settings') return fallback;
        return Store.readRecord(key, fallback);
    },
    writePersistent: async (key, value) => {
        if (location.protocol.startsWith('http') && key !== 'app_settings') return true;
        await Store.writeRecord(key, value);
        return true;
    },
    // Eigenes Profil inkl. Rollen-/Sperr-/2FA-Status -- /api/v2/users/me ist für JEDE angemeldete
    // Person erreichbar (im Gegensatz zu /api/v2/users, das nur Admins die ganze Liste zeigt).
    // Kurzlebiger Zwischenspeicher (3s): AdminBoard.render() ruft Store.currentUser() bei JEDER
    // Ticket-Aktion und zusätzlich per 60-Sekunden-Timer auf -- ohne Zwischenspeicher bedeutete
    // das einen frischen Netzwerk-Request pro Render-Durchlauf, rein für die Rollenanzeige. Ein
    // einzelner fehlgeschlagener Abruf (Netzwerk-Hänger, kurzzeitige Serverlast) kostete dadurch
    // unnötig oft die komplette Render-Aktualisierung. Rechteprüfungen selbst laufen weiterhin
    // serverseitig bei jeder einzelnen API-Anfrage neu (siehe app.ts onRequest-Hook) -- dieser
    // Zwischenspeicher betrifft nur die Anzeige, nie eine Sicherheitsentscheidung.
    _meCache: null,
    _meCacheAt: 0,
    fetchSessionUser: async () => {
        if (Store._meCache && Date.now() - Store._meCacheAt < 3000) return Store._meCache;
        try {
            const res = await fetch('/api/v2/users/me', { credentials: 'same-origin' });
            if (!res.ok) { Store._meCache = null; return null; }
            const payload = await res.json();
            const user = payload.user ? Store.mapApiUserToLegacy(payload.user) : null;
            Store._meCache = user;
            Store._meCacheAt = Date.now();
            return user;
        } catch {
            return Store._meCache;
        }
    },
    // Benutzer laufen NICHT mehr über die generische readPersistent/writePersistent-Brücke
    // (die sprach die inzwischen entfernte generische Alt-Schnittstelle an) -- stattdessen
    // direkt gegen die echte, rechtegeprüfte v2-API. Rückgabeform wird auf die alten Feldnamen
    // abgebildet, damit die bestehenden Aufrufstellen in diesem Modul unverändert bleiben können.
    _usersCache: null,
    mapApiUserToLegacy: (u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        role: u.role,
        department_group_id: u.department_group_id ?? null,
        department: u.department || '',
        supervisorUserId: u.supervisor_user_id ?? null,
        accountArchived: !!u.account_archived,
        accountLocked: !!u.locked_permanent,
        lockedUntil: u.locked_until ? new Date(u.locked_until).getTime() : null,
        failedLogins: 0,
        twoFactorEnabled: !!u.totp_enabled,
        // Granulare Zusatzrechte fuer normale Admin-Konten -- echte, vom Superadmin vergebene
        // Werte (users.ts permissions_json), nicht mehr pauschal auf true gesetzt. Superadmin
        // bekommt ohnehin ueberall zusaetzlich "isSuper ||" davor (siehe AdminBoard.init/can),
        // braucht diese Flags hier also nicht separat.
        canManageUsers: !!u.canManageUsers,
        canManage2FA: !!u.canManage2FA,
        canManageRequests: !!u.canManageRequests,
        canViewLogs: !!u.canViewLogs,
        permissions: u.permissions || {},
        // Echte, serverseitig berechnete Abwesenheit (siehe users.ts buildAbsence) --
        // war hier bisher hart auf null gesetzt, wodurch Abwesenheits-Badges/Vertretungslogik
        // nie griffen, obwohl die Daten in der Datenbank korrekt gespeichert waren.
        absence: u.absence ?? null
    }),
    getUsers: async () => {
        const res = await fetch('/api/v2/users', { credentials: 'same-origin' });
        if (!res.ok) {
            if (Store._usersCache) return Store._usersCache;
            throw new Error('Benutzerliste konnte nicht geladen werden.');
        }
        const payload = await res.json();
        const users = (payload.users || []).map(Store.mapApiUserToLegacy);
        Store._usersCache = users;
        return users;
    },
    // Bildet das alte "ganze Liste laden, verändern, komplett zurückschreiben"-Muster auf die
    // v2-API ab: vergleicht gegen den zuletzt bekannten Stand und schickt nur echte Änderungen
    // als gezielte POST/PATCH-Aufrufe -- keine ungeprüfte Blob-Übernahme mehr.
    // Gibt true zurück nur wenn ALLE Teiloperationen erfolgreich waren -- vorher wurde der
    // Rückgabewert jeder einzelnen Anfrage ignoriert, sodass z.B. ein vom Server abgelehntes
    // neues Konto (ungültige/zu kurze Passwort, doppelter Benutzername) der Oberfläche trotzdem
    // "Gespeichert" meldete, obwohl nichts angelegt wurde.
    saveUsers: async (users) => {
        const before = Store._usersCache || await Store.getUsers();
        const beforeById = new Map(before.map(u => [u.id, u]));
        let ok = true;
        for (const u of users) {
            const prev = u.id ? beforeById.get(u.id) : null;
            if (!prev) {
                // Neuer Benutzer: das alte UI legt dafür ein Objekt mit Klartext-Passwort an.
                const res = await fetch('/api/v2/users', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        username: u.username,
                        password: u.password || Utils.secureToken(),
                        name: u.name || u.username,
                        email: u.email || '',
                        role: u.role === 'admin' ? 'admin' : 'user',
                        department_group_id: u.department_group_id ?? null,
                        department: u.department || '',
                        supervisor_user_id: u.supervisorUserId ?? null,
                        permissions: u.permissions ?? undefined
                    })
                }).catch(() => null);
                if (!res || !res.ok) ok = false;
                continue;
            }
            const patch = {};
            if (u.name !== prev.name) patch.name = u.name;
            if (u.email !== prev.email) patch.email = u.email;
            if (u.role !== prev.role && (u.role === 'user' || u.role === 'admin')) patch.role = u.role;
            if (u.department_group_id !== prev.department_group_id) patch.department_group_id = u.department_group_id ?? null;
            if ((u.department || '') !== (prev.department || '')) patch.department = u.department || '';
            if (u.supervisorUserId !== prev.supervisorUserId) patch.supervisor_user_id = u.supervisorUserId ?? null;
            if (!!u.accountArchived !== prev.accountArchived) patch.account_archived = !!u.accountArchived;
            if (!!u.accountLocked !== prev.accountLocked) patch.locked_permanent = !!u.accountLocked;
            // Die vier "Verwaltung"-Schalter (canManageRequests/-Users/canViewLogs/canManage2FA)
            // kommen serverseitig im selben permissions-Objekt an wie die "Zusatzfunktionen"
            // (textBlocks/reports/approvals/recurring/kb) -- hier zu einem Patch zusammengeführt,
            // da das Backend (users.ts) sie nicht getrennt annimmt.
            const combinedPerms = {
                ...(u.permissions || {}),
                canManageRequests: !!u.canManageRequests,
                canManageUsers: !!u.canManageUsers,
                canViewLogs: !!u.canViewLogs,
                canManage2FA: !!u.canManage2FA
            };
            const prevCombinedPerms = {
                ...(prev.permissions || {}),
                canManageRequests: !!prev.canManageRequests,
                canManageUsers: !!prev.canManageUsers,
                canViewLogs: !!prev.canViewLogs,
                canManage2FA: !!prev.canManage2FA
            };
            if (JSON.stringify(combinedPerms) !== JSON.stringify(prevCombinedPerms)) patch.permissions = combinedPerms;
            if (Object.keys(patch).length) {
                const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}`, {
                    method: 'PATCH',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(patch)
                }).catch(() => null);
                if (!res || !res.ok) ok = false;
            }
            if (u.password && u.password !== prev.password) {
                const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}/change-password`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ new_password: u.password })
                }).catch(() => null);
                if (!res || !res.ok) ok = false;
            }
        }
        Store._usersCache = null;
        const after = await Store.getUsers();
        await LogDiff.users(before, after);
        return ok;
    },
    // Abwesenheit & Vertretung: echte Server-Endpunkte statt der frueheren client-seitigen
    // Mutation von user.absence + Store.saveUsers (das absence-Feld dort nie kannte und daher
    // nie wirklich etwas speicherte). userId=null -> eigene Abwesenheit (/users/me/absence).
    setUserAbsence: async (userId, payload) => {
        const path = userId ? `/api/v2/users/${encodeURIComponent(userId)}/absence` : '/api/v2/users/me/absence';
        const res = await fetch(path, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => null);
        if (!res || !res.ok) return null;
        Store._usersCache = null;
        return res.json();
    },
    // Tickets, die wegen einer (laufenden oder beendeten) Abwesenheit dieser Person an eine
    // Vertretung übergegangen und noch nicht zurückgeholt sind -- aus dem Audit-Log abgeleitet.
    getTransferredTickets: async (userId) => {
        const res = await fetch(`/api/v2/users/${encodeURIComponent(userId)}/absence/transferred-tickets`, { credentials: 'same-origin' }).catch(() => null);
        if (!res || !res.ok) return [];
        return (await res.json()).ticketIds || [];
    },
    // Gruppen laufen über die echte /api/v2/groups-API. Mitgliedschaft gibt es im Backend NICHT
    // als Array auf der Gruppe, sondern als department_group_id auf dem Benutzer (eine Gruppe pro
    // Person) -- "members" wird hier nur zur Anzeige aus den Benutzern abgeleitet.
    getGroups: async () => {
        const res = await fetch('/api/v2/groups', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        const users = await Store.getUsers();
        return (payload.groups || []).map(g => ({
            id: g.id,
            name: g.name,
            isDefault: !!g.is_default,
            members: users.filter(u => u.department_group_id === g.id).map(u => u.username)
        }));
    },
    createGroup: async (name) => {
        const res = await fetch('/api/v2/groups', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name })
        }).catch(() => null);
        return !!res && res.ok;
    },
    renameGroup: async (id, name) => {
        const res = await fetch(`/api/v2/groups/${encodeURIComponent(id)}`, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name })
        }).catch(() => null);
        return !!res && res.ok;
    },
    deleteGroup: async (id) => {
        const res = await fetch(`/api/v2/groups/${encodeURIComponent(id)}`, {
            method: 'DELETE', credentials: 'same-origin'
        }).catch(() => null);
        return !!res && res.ok;
    },
    // Setzt die Abteilungsgruppe der angegebenen Benutzer (eine Gruppe pro Person, siehe getGroups).
    setGroupMembers: async (usernames, groupId) => {
        const users = await Store.getUsers();
        users.forEach(u => { if (usernames.includes(u.username)) u.department_group_id = groupId; });
        await Store.saveUsers(users);
    },
    // Gespeicherte Listenansichten: echte /api/v2/list-views-API statt der entfernten Alt-Brücke.
    getListViews: async () => {
        const res = await fetch('/api/v2/list-views', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.views || []).map(v => ({ id: v.id, name: v.name, ownerUserId: v.owner_user_id, filters: v.filters, isShared: !!v.is_shared }));
    },
    createListView: async (name, filters, isShared = false) => {
        const res = await fetch('/api/v2/list-views', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, filters, is_shared: isShared })
        }).catch(() => null);
        return !!res && res.ok;
    },
    deleteListView: async (id) => {
        const res = await fetch(`/api/v2/list-views/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
        return !!res && res.ok;
    },

    // Tickets laufen NICHT mehr über die JSON-Blob-Brücke, sondern über die echte v2-API.
    // WICHTIG, ehrlich dokumentiert: Diese Abbildung deckt nur die FLACHEN Ticket-Felder ab
    // (Board/Liste, Erstellen, Status, Archivieren). Chat, interne Notizen, Teilaufgaben und
    // Protokoll sind in der v2-API eigene, erst bei Bedarf nachzuladende Ressourcen
    // (/api/v2/tickets/:id/messages|notes|todos|audit-log) -- sie werden hier absichtlich als
    // leere Arrays initialisiert, damit Code, der z.B. "(t.chat || [])" oder "t.chat.push(...)"
    // schreibt, nicht abstürzt. Die eigentliche Anbindung der Detailansicht (Chat-Tab,
    // Teilaufgaben-Tab, internes Protokoll) ist ein eigener, noch ausstehender Arbeitsschritt --
    // siehe README "Daten Und Funktionen".
    _ticketsCache: null,
    mapApiTicketToLegacy: (t) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        title: t.title,
        desc: t.description,
        prio: t.priority,
        status: t.status,
        category: t.category ? [t.category] : [],
        author: t.created_by_username,
        authorName: t.created_by_username,
        authorUserId: t.created_by_user_id,
        createdAt: t.created_at,
        owner: t.assigned_to_username || null,
        ownerUserId: t.assigned_to_user_id || null,
        assignees: t.assigned_to_username ? [t.assigned_to_username] : [],
        participants: [],
        todos: [],
        chat: [],
        comments: [],
        logs: [],
        archived: !!t.archived_at,
        archivedAt: t.archived_at,
        closedAt: t.closed_at || null,
        // Echte Zählungen/letzter Nachrichtenabsender aus der Listen-API (siehe tickets.ts GET
        // /api/v2/tickets) -- chat/comments/todos bleiben bewusst [] (siehe oben), diese Felder
        // sind fuer die Kanban-Karte gedacht, die keine vollen Inhalte braucht, nur Zahlen/Status.
        chatCount: Number(t.message_count) || 0,
        noteCount: Number(t.note_count) || 0,
        todoTotal: Number(t.todo_count) || 0,
        todoDone: Number(t.todo_done_count) || 0,
        attachmentCount: Number(t.attachment_count) || 0,
        awaitingReply: t.last_message_role === 'user',
        isMajorIncident: t.type === 'incident',
        incidentNotice: t.incident_notice || null,
        linkedIncidentId: t.incident_id || null,
        authorArchived: !!t.author_archived,
        archivedAuthorAck: !!t.archived_author_ack,
        customDueAt: t.custom_due_at,
        slaDueAt: t.sla_due_at,
        createdByAdmin: t.filed_by_username || null,
        waitingMessage: t.waiting_message || null,
        slaPausedSince: t.waiting_since || null,
        customFieldValues: t.custom_fields_json ? JSON.parse(t.custom_fields_json) : {},
        approvals: t.approval_status ? [{
            status: t.approval_status,
            approver: t.approval_reviewer_id,
            requestedByName: t.approval_requested_by,
            reason: t.approval_text
        }] : []
    }),
    getTickets: async () => {
        const res = await fetch('/api/v2/tickets', { credentials: 'same-origin' });
        if (!res.ok) {
            if (Store._ticketsCache) return Store._ticketsCache;
            throw new Error('Tickets konnten nicht geladen werden.');
        }
        const payload = await res.json();
        const tickets = (payload.tickets || []).map(Store.mapApiTicketToLegacy);
        Store._ticketsCache = tickets;
        return tickets;
    },
    // GET /api/v2/tickets schliesst archivierte Tickets serverseitig bewusst aus (Board/Liste
    // sollen sie nicht zeigen) -- das Archiv braucht den eigenen, admin-only Endpunkt.
    getArchivedTickets: async () => {
        const res = await fetch('/api/v2/tickets/archived', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.tickets || []).map(Store.mapApiTicketToLegacy);
    },
    // Fallback fuer Tickets, die GET /api/v2/tickets nicht liefert (archivierte Tickets sind dort
    // bewusst ausgeschlossen, siehe getArchivedTickets) -- Einzelabruf funktioniert unabhaengig
    // vom Archiv-Status.
    getTicketById: async (id) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return Store.mapApiTicketToLegacy((await res.json()).ticket);
    },
    // Echtes, serverseitig geschriebenes Protokoll je Ticket (ticket_audit_log) -- ersetzt die
    // alte ticket.logs-Liste, die es in der v2-API nicht gibt (immer [] via mapApiTicketToLegacy).
    ticketAuditFieldLabels: {
        title: 'Titel', description: 'Beschreibung', status: 'Status', priority: 'Priorität',
        category: 'Kategorie', assigned_to_user_id: 'Zuständige Person', assigned_to_username: 'Zuständige Person',
        sla_due_at: 'SLA-Frist', custom_due_at: 'Individuelle Frist', approval_status: 'Genehmigungsstatus',
        type: 'Typ', incident_notice: 'Störungs-Hinweis', archived: 'Archiviert'
    },
    ticketAuditActionLabels: {
        created: 'Ticket erstellt', updated: 'Ticket geändert', auto_archived: 'Automatisch archiviert',
        created_recurring: 'Automatisch angelegt (wiederkehrend)', linked_incident: 'Mit Störung verknüpft',
        approval_requested: 'Genehmigung angefordert', approval_decided: 'Genehmigung entschieden',
        created_on_behalf: 'Im Auftrag angelegt', participants_updated: 'Beteiligte geändert'
    },
    // Mehrfach-Beteiligte: echte /api/v2/tickets/:id/participants-API (ticket_participants-
    // Tabelle), nicht mehr ein nie persistiertes ticket.participants-Feld.
    getTicketParticipants: async (id) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/participants`, { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).participants || []).map(p => ({ userId: p.user_id, username: p.username }));
    },
    setTicketParticipants: async (id, userIds) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/participants`, {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds })
        }).catch(() => null);
        return !!res && res.ok;
    },
    // Verwandte Tickets: echte /api/v2/tickets/:id/related-API statt eines nie persistierten
    // ticket.relatedIds-Feldes.
    getRelatedTicketIds: async (id) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/related`, { credentials: 'same-origin' });
        if (!res.ok) return [];
        return (await res.json()).relatedTicketIds || [];
    },
    linkRelatedTicketIds: async (id, relatedId) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/related`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ related_ticket_id: relatedId })
        }).catch(() => null);
        return !!res && res.ok;
    },
    unlinkRelatedTicketIds: async (id, relatedId) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/related/${encodeURIComponent(relatedId)}`, {
            method: 'DELETE', credentials: 'same-origin'
        }).catch(() => null);
        return !!res && res.ok;
    },
    // Zusammenführen: verschiebt Chat/Notizen/Teilaufgaben/Zeiten/Anhänge/Beteiligte serverseitig
    // per Fremdschlüssel-Update auf das Zielticket und archiviert das Ursprungsticket.
    mergeTickets: async (sourceId, targetId) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(sourceId)}/merge`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target_ticket_id: targetId })
        }).catch(() => null);
        return !!res && res.ok;
    },
    // Nur fuer Auswertung (AdminBoard.openReports) -- liefert je Ticket den Zeitpunkt der ersten
    // Antwort einer Admin-/Superadmin-Person, ohne dass Store.getTickets() dafuer alle
    // Chat-Nachrichten mitladen muesste (siehe eigener Endpunkt in tickets.ts).
    getFirstResponseTimes: async (sinceIso) => {
        const url = sinceIso ? `/api/v2/tickets/first-response-times?since=${encodeURIComponent(sinceIso)}` : '/api/v2/tickets/first-response-times';
        const res = await fetch(url, { credentials: 'same-origin' }).catch(() => null);
        if (!res || !res.ok) return {};
        const rows = (await res.json()).tickets || [];
        return Object.fromEntries(rows.map(r => [r.id, r.first_response_at]));
    },
    getTicketAuditLog: async (id) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/audit-log`, { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.log || []).map(l => {
            const fieldLabel = l.field ? (Store.ticketAuditFieldLabels[l.field] || l.field) : null;
            const details = fieldLabel ? `${fieldLabel}: ${l.old_value ?? '–'} → ${l.new_value ?? '–'}` : '';
            return {
                id: l.id, user: l.actor_username || 'System',
                action: Store.ticketAuditActionLabels[l.action] || l.action,
                details, date: l.created_at
            };
        });
    },
    // Direkter POST, der das erstellte Ticket (inkl. echter id/ticket_number) zurückgibt --
    // von saveTickets fürs generische Erstellen genutzt, und direkt von den beiden
    // "Ticket anlegen"-Formularen, die danach noch Anhänge mit der echten ticket_id hochladen
    // müssen (Anhänge können serverseitig nicht ohne existierendes Ticket gespeichert werden).
    createTicket: async (t) => {
        const res = await fetch('/api/v2/tickets', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: t.title,
                description: t.desc || '',
                priority: t.prio || 'Normal',
                category: Array.isArray(t.category) ? t.category[0] : t.category,
                type: t.isMajorIncident ? 'incident' : 'ticket',
                incident_notice: t.isMajorIncident && t.incidentNotice ? t.incidentNotice : undefined,
                custom_fields: t.customFieldValues && Object.keys(t.customFieldValues).length ? t.customFieldValues : undefined,
                on_behalf_of_user_id: t.onBehalfOfUserId || undefined
            })
        }).catch(() => null);
        if (!res || !res.ok) return null;
        return Store.mapApiTicketToLegacy((await res.json()).ticket);
    },
    // Gleiches Diff-Prinzip wie Store.saveUsers: nur echte Änderungen an den flachen Feldern
    // werden als POST (neu) bzw. PATCH (geändert) an die v2-API geschickt.
    saveTickets: async (tickets) => {
        const before = Store._ticketsCache || await Store.getTickets();
        const beforeById = new Map(before.map(t => [t.id, t]));
        for (const t of tickets) {
            const prev = t.id ? beforeById.get(t.id) : null;
            if (!prev) {
                await Store.createTicket(t);
                continue;
            }
            const patch = {};
            if (t.title !== prev.title) patch.title = t.title;
            if (t.desc !== prev.desc) patch.description = t.desc;
            if (t.status !== prev.status) {
                patch.status = t.status;
                if (t.status === 'Warten auf Benutzer') patch.waiting_message = t.waitingMessage || '';
            }
            if (t.prio !== prev.prio) patch.priority = t.prio;
            const newCategory = Array.isArray(t.category) ? t.category[0] : t.category;
            const oldCategory = Array.isArray(prev.category) ? prev.category[0] : prev.category;
            if (newCategory !== oldCategory) patch.category = newCategory ?? null;
            if (t.owner !== prev.owner) {
                patch.assigned_to_username = t.owner || null;
                patch.assigned_to_user_id = t.ownerUserId || null;
            }
            if (t.customDueAt !== prev.customDueAt) patch.custom_due_at = t.customDueAt ?? null;
            if (!!t.archived !== !!prev.archived) patch.archived = !!t.archived;
            if (!!t.archivedAuthorAck !== !!prev.archivedAuthorAck) patch.archived_author_ack = !!t.archivedAuthorAck;
            if (Object.keys(patch).length) {
                await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}`, {
                    method: 'PATCH',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(patch)
                });
            }
        }
        Store._ticketsCache = null;
    },
    // Kontoanfragen laufen über die echte /api/v2/account-requests-API. Die Entscheidung
    // (annehmen/ablehnen) wird dort vermerkt (status/reviewed_by_user_id) -- das tatsächliche
    // Anlegen des Benutzerkontos bei Annahme läuft weiterhin über Store.saveUsers (neuer
    // Eintrag im Array -> POST /api/v2/users, siehe AdminBoard.confirmApprove).
    getRequests: async () => {
        const res = await fetch('/api/v2/account-requests', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.requests || []).filter(r => r.status === 'pending').map(r => ({
            id: r.id, name: r.name, email: r.email, company: r.company, reason: r.reason, createdAt: r.created_at
        }));
    },
    decideAccountRequest: async (id, status) => {
        const res = await fetch(`/api/v2/account-requests/${encodeURIComponent(id)}`, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status })
        }).catch(() => null);
        return !!res && res.ok;
    },
    // Kategorien laufen über die echte /api/v2/categories-API (eigene Tabelle inkl. eigener
    // Felder je Kategorie), nicht mehr über den app_settings-Blob. getSettings() bildet daraus
    // weiterhin settings.categories (Namen, ohne archivierte) und settings.customFields ab,
    // damit die zahlreichen reinen Lesestellen im restlichen Code unverändert bleiben.
    getCategories: async () => {
        const res = await fetch('/api/v2/categories', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.categories || []).map(c => ({
            id: c.id,
            name: c.name,
            autoAssignGroupId: c.auto_assign_group_id ?? null,
            customFields: c.custom_fields || [],
            locked: !!c.locked,
            archived: !!c.archived
        }));
    },
    createCategory: async (data) => {
        const res = await fetch('/api/v2/categories', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: data.name,
                auto_assign_group_id: data.autoAssignGroupId ?? undefined,
                custom_fields: data.customFields || []
            })
        }).catch(() => null);
        if (!res || !res.ok) return null;
        return res.json();
    },
    updateCategory: async (id, patch) => {
        const body = {};
        if (patch.name !== undefined) body.name = patch.name;
        if (patch.autoAssignGroupId !== undefined) body.auto_assign_group_id = patch.autoAssignGroupId;
        if (patch.customFields !== undefined) body.custom_fields = patch.customFields;
        if (patch.locked !== undefined) body.locked = patch.locked;
        if (patch.archived !== undefined) body.archived = patch.archived;
        const res = await fetch(`/api/v2/categories/${encodeURIComponent(id)}`, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }).catch(() => null);
        return !!res && res.ok;
    },
    // generalConfig/companyConfig/accountConfig kommen, soweit vorhanden, verbindlich aus der
    // echten /api/v2/settings-API (Server ist die einzige Quelle der Wahrheit für diese Felder --
    // siehe updateServerSettings). Nur Erscheinungsbild (theme/accentColor/lang/bgType/bgValue)
    // bleibt ein reines Browser-/Geräte-Setting ohne DB-Bezug.
    getSettings: async () => {
        const loadedSettings = await Store.readPersistent('app_settings', Settings.defaults);
        const settings = typeof structuredClone === 'function' ? structuredClone(loadedSettings) : JSON.parse(JSON.stringify(loadedSettings));
        const categories = await Store.getCategories();
        settings.categories = categories.filter(c => !c.archived).map(c => c.name);
        settings.customFields = {};
        categories.forEach(c => { if (c.customFields.length) settings.customFields[c.name] = c.customFields; });

        let serverSettings = null;
        if (location.protocol.startsWith('http')) {
            try {
                const res = await fetch('/api/v2/settings', { credentials: 'same-origin' });
                if (res.ok) serverSettings = await res.json();
                else {
                    const pub = await fetch('/api/v1/public-settings', { credentials: 'same-origin' }).catch(() => null);
                    if (pub && pub.ok) serverSettings = { portalName: (await pub.json()).portalName, companyName: undefined, config: {} };
                }
            } catch {
                // Einstellungen bleiben auch ohne Server-Antwort nutzbar (zuletzt bekannter Stand).
            }
        }
        if (serverSettings) {
            const cfg = serverSettings.config || {};
            settings.generalConfig = {
                ...(settings.generalConfig || {}),
                portalName: serverSettings.portalName || 'Support Portal',
                autoArchiveDays: cfg.autoArchiveClosedAfterDays ?? 0,
                waitingReminderDays: cfg.waitingReminderDays ?? 2,
                waitingAutoCloseDays: cfg.waitingAutoCloseDays ?? 7,
                defaultPrio: cfg.defaultPrio || 'Normal',
                showSlaToUsers: !!cfg.showSlaToUsers,
                notifPolicy: cfg.notifPolicy || {},
                slaHours: {
                    low: cfg.slaHoursByPriority?.Niedrig ?? 72,
                    normal: cfg.slaHoursByPriority?.Normal ?? 48,
                    high: cfg.slaHoursByPriority?.Hoch ?? 24,
                    critical: cfg.slaHoursByPriority?.Kritisch ?? 4
                },
                businessHours: {
                    enabled: !!cfg.businessHours?.enabled,
                    start: cfg.businessHours?.start || '08:00',
                    end: cfg.businessHours?.end || '17:00',
                    days: cfg.businessHours?.days || [1, 2, 3, 4, 5],
                    // Individuelle Zeiten je Wochentag und Feiertage -- siehe
                    // apps/server/src/domain/sla.ts (dieselbe Struktur wird dort serverseitig
                    // fuer die tatsaechliche Frist ausgewertet, nicht nur fuer die Anzeige hier).
                    perDay: cfg.businessHours?.perDay || {},
                    holidays: cfg.businessHours?.holidays || []
                }
            };
            settings.approvalConfig = {
                enabled: !!cfg.approvalWorkflow?.enabled,
                priorities: cfg.approvalWorkflow?.priorities || [],
                fallbackApproverUserId: cfg.approvalWorkflow?.fallbackApproverUserId || null
            };
            settings.companyConfig = {
                ...(settings.companyConfig || {}),
                name: serverSettings.companyName || '',
                ticketNumberFormat: cfg.ticketNumberFormat?.format || (cfg.ticketNumberFormat?.prefix ? '{prefix}-{number}' : '{number}'),
                ticketNumberPrefix: cfg.ticketNumberFormat?.prefix || '',
                ticketNumberPadding: cfg.ticketNumberFormat?.padding || 5,
                ticketNumberCategoryFormats: cfg.ticketNumberCategoryFormats || {}
            };
            settings.accountConfig = {
                editable: {
                    name: !cfg.accountSelfServiceFields || cfg.accountSelfServiceFields.includes('name'),
                    email: !cfg.accountSelfServiceFields || cfg.accountSelfServiceFields.includes('email'),
                    department: !!cfg.accountSelfServiceFields?.includes('department')
                }
            };
            settings.securityConfig = {
                ...(settings.securityConfig || {}),
                ...(cfg.securityConfig || {})
            };
            settings.notificationConfig = {
                ...(settings.notificationConfig || {}),
                ...(cfg.notificationConfig || {})
            };
            settings.notifConfig = {
                ...(settings.notifConfig || {}),
                ...(cfg.notifConfig || {})
            };
            settings.emailAdvancedConfig = {
                ...(settings.emailAdvancedConfig || {}),
                ...(cfg.emailAdvancedConfig || {})
            };
            settings.outlookConfig = {
                ...(settings.outlookConfig || {}),
                ...(cfg.outlookConfig || {})
            };
            settings.companyBrandingConfig = {
                ...(settings.companyBrandingConfig || {}),
                ...(cfg.companyBrandingConfig || {})
            };
        }
        return settings;
    },
    // Nur fuer reine Geraete-/Oberflaechen-Einstellungen (Theme/Akzentfarbe/Sprache/Hintergrund)
    // und sonstige, noch nicht ans Backend angebundene Kleinigkeiten (z.B. reportingConfig).
    // Fachliche Einstellungen mit echter DB-Spalte (SLA, Geschaeftszeiten, Ticketnummern,
    // Firmenname, Kategorien, ...) laufen ausschliesslich ueber Store.updateServerSettings bzw.
    // die Kategorien-API und werden bei jedem getSettings() ueberschrieben -- was hier fuer diese
    // Schluessel geschrieben wird, ist also folgenlos.
    saveSettings: async (settings) => {
        await Store.writePersistent('app_settings', settings);
    },
    // Schreibt gezielt gegen PATCH /api/v2/settings (nur Superadmin). patch: { companyName?,
    // portalName?, config?: {...} } -- config wird serverseitig mit dem bestehenden Stand gemerged.
    updateServerSettings: async (patch) => {
        const res = await fetch('/api/v2/settings', {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch)
        }).catch(() => null);
        return !!res && res.ok;
    },
    // SMTP: eigene, separat verschlüsselte Spalten (nicht Teil von config_json) -- das Passwort
    // wird nie vom Server zurückgegeben, siehe settings.ts.
    getSmtpConfig: async () => {
        const res = await fetch('/api/v2/settings/smtp', { credentials: 'same-origin' });
        if (!res.ok) return null;
        return res.json();
    },
    updateSmtpConfig: async (patch) => {
        const res = await fetch('/api/v2/settings/smtp', {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch)
        }).catch(() => null);
        return !!res && res.ok;
    },
    sendTestSmtpEmail: async (to) => {
        const res = await fetch('/api/v2/settings/smtp/test', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to })
        }).catch(() => null);
        return !!res && res.ok;
    },
    // LDAP: optionale Ergänzung zum lokalen Passwort (siehe apps/server/src/auth/ldap.ts) --
    // Bind-Passwort wird nie vom Server zurückgegeben.
    getLdapConfig: async () => {
        const res = await fetch('/api/v2/settings/ldap', { credentials: 'same-origin' });
        if (!res.ok) return null;
        return res.json();
    },
    updateLdapConfig: async (patch) => {
        const res = await fetch('/api/v2/settings/ldap', {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch)
        }).catch(() => null);
        return !!res && res.ok;
    },
    testLdapConfig: async (password) => {
        const res = await fetch('/api/v2/settings/ldap/test', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password })
        }).catch(() => null);
        if (!res || !res.ok) return false;
        return (await res.json()).success === true;
    },
    getUpdateStatus: async () => {
        const res = await fetch('/api/v2/update/status', { credentials: 'same-origin' }).catch(() => null);
        // HTTP-Status wird mitgegeben, auch bei Fehlschlag -- renderUpdateStatus kann so zwischen
        // "nie konfiguriert" (503), "Updater antwortet nicht/Netzwerkproblem" (504) und einem
        // reinen Gateway-/Proxy-Fehler (502, z.B. App-Container restartet gerade) unterscheiden,
        // statt pauschal "nicht erreichbar oder nicht konfiguriert" zu melden.
        if (!res) return { httpStatus: 0 };
        const body = await res.json().catch(() => ({}));
        return { ...body, httpStatus: res.status };
    },
    runUpdate: async () => {
        const res = await fetch('/api/v2/update/run', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
        if (!res) return null;
        return res.json().catch(() => null);
    },

    // Textbausteine: echte /api/v2/text-blocks-API statt settings.textBlocks-Blob.
    getTextBlocks: async () => {
        const res = await fetch('/api/v2/text-blocks', { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).blocks || []).map(b => ({ id: b.id, title: b.title, text: b.content }));
    },
    createTextBlock: async (title, text) => {
        const res = await fetch('/api/v2/text-blocks', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title, content: text })
        }).catch(() => null);
        return !!res && res.ok;
    },
    deleteTextBlock: async (id) => {
        const res = await fetch(`/api/v2/text-blocks/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
        return !!res && res.ok;
    },

    // Wissensdatenbank: echte /api/v2/kb/articles-API statt settings.knowledgeBase-Blob.
    // Anhänge an KB-Artikeln gibt es im Backend nicht (kein kb_article_id in attachments) --
    // deshalb keine Datei-Upload-Option mehr im Editor, statt etwas Ungespeichertes anzubieten.
    getKbArticles: async () => {
        const res = await fetch('/api/v2/kb/articles', { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).articles || []).map(a => ({
            id: a.id, title: a.title, body: a.content, source: a.source_ticket_id, createdAt: a.created_at
        }));
    },
    createKbArticle: async (title, content, sourceTicketId) => {
        const res = await fetch('/api/v2/kb/articles', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title, content, source_ticket_id: sourceTicketId || undefined })
        }).catch(() => null);
        if (!res || !res.ok) return null;
        return (await res.json()).id || null;
    },
    deleteKbArticle: async (id) => {
        const res = await fetch(`/api/v2/kb/articles/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
        return !!res && res.ok;
    },
    // Datei-Anhänge an Wissensdatenbank-Artikeln (gleiches Muster wie Ticket-Anhänge, siehe
    // saveAttachment/getTicketAttachments) -- eigener Endpunkt, da ein KB-Artikel kein Ticket ist.
    getKbArticleAttachments: async (articleId) => {
        const res = await fetch(`/api/v2/kb/articles/${encodeURIComponent(articleId)}/attachments`, { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).attachments || []).map(a => ({
            id: a.id, attachmentId: a.id, name: a.filename, type: a.mime_type, size: a.size_bytes
        }));
    },
    saveKbAttachment: async (articleId, fileLike) => {
        if (fileLike.size && fileLike.size > 15 * 1024 * 1024) {
            throw new Error('ATTACHMENT_TOO_LARGE');
        }
        const dataUrl = fileLike.data || await Store.readFile(fileLike);
        const data_b64 = String(dataUrl).split(',').pop();
        const name = fileLike.name || 'Anhang';
        const type = fileLike.type || 'application/octet-stream';
        const size = fileLike.size || Math.round((data_b64.length * 3) / 4);
        const res = await fetch(`/api/v2/kb/articles/${encodeURIComponent(articleId)}/attachments`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename: name, mime_type: type, size_bytes: size, data_b64 })
        }).catch(() => null);
        if (!res || !res.ok) throw new Error('ATTACHMENT_UPLOAD_FAILED');
        const saved = await res.json();
        return { id: saved.id, attachmentId: saved.id, name: saved.filename, type: saved.mime_type, size: saved.size_bytes };
    },
    getKbAttachment: async (id) => {
        const res = await fetch(`/api/v2/kb/attachments/${encodeURIComponent(id)}`, { credentials: 'same-origin' }).catch(() => null);
        if (!res || !res.ok) return null;
        const a = (await res.json()).attachment;
        if (!a) return null;
        return { id: a.id, name: a.filename, type: a.mime_type, size: a.size_bytes, data: `data:${a.mime_type};base64,${a.data_b64}` };
    },
    deleteKbAttachment: async (id) => {
        const res = await fetch(`/api/v2/kb/attachments/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
        return !!res && res.ok;
    },

    // Wiederkehrende Tickets: echte /api/v2/recurring-rules-API statt settings.recurringTickets-
    // Blob. Ausführung läuft serverseitig per Timer (jobs/maintenance.ts) -- kein Client-Trigger.
    getRecurringRules: async () => {
        const res = await fetch('/api/v2/recurring-rules', { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).rules || []).map(r => ({
            id: r.id, title: r.title, desc: r.description, category: r.category, prio: r.priority,
            intervalUnit: r.interval_unit, intervalCount: r.interval_count, nextRunAt: r.next_run_at, active: !!r.active
        }));
    },
    createRecurringRule: async (data) => {
        const res = await fetch('/api/v2/recurring-rules', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: data.title, description: data.desc || data.title, category: data.category || undefined,
                priority: data.prio, interval_unit: data.intervalUnit, interval_count: data.intervalCount || 1,
                next_run_at: data.nextRunAt
            })
        }).catch(() => null);
        return !!res && res.ok;
    },
    deleteRecurringRule: async (id) => {
        const res = await fetch(`/api/v2/recurring-rules/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
        return !!res && res.ok;
    },
    // Globales Audit-Log ist rein serverseitig erzeugt (siehe users.ts/settings.ts/tickets.ts) --
    // kein Client-Schreibpfad mehr, damit niemand sich selbst beliebige Logeinträge unterschieben
    // kann (Log-Integrität, "fehlendes Security Logging" aus der Anforderungsliste).
    globalLogActionLabels: {
        'user.created': 'Benutzer erstellt',
        'user.updated': 'Benutzer bearbeitet',
        'user.deleted': 'Benutzer gelöscht',
        'user.mfa_reset': '2FA zurückgesetzt',
        'user.csv_import': 'Benutzer per CSV importiert',
        'group.created': 'Gruppe erstellt',
        'group.updated': 'Gruppe bearbeitet',
        'group.deleted': 'Gruppe gelöscht',
        'category.created': 'Kategorie erstellt',
        'category.updated': 'Kategorie bearbeitet',
        'settings.updated': 'Systemeinstellungen gespeichert'
    },
    getGlobalLogs: async () => {
        const res = await fetch('/api/v2/audit-log', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.log || []).map(l => {
            const detail = l.detail_json ? JSON.parse(l.detail_json) : null;
            return {
                id: l.id,
                user: l.actor_username,
                action: Store.globalLogActionLabels[l.action] || l.action,
                details: detail ? Object.entries(detail).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${v}`).join(', ') : (l.target_id || ''),
                date: l.created_at
            };
        });
    },
    // Benachrichtigungen laufen über die echte /api/v2/notifications-API; Erzeugung passiert
    // serverseitig bei der jeweiligen Ticket-Aktion (siehe tickets.ts), nicht mehr clientseitig.
    getNotifications: async () => {
        const res = await fetch('/api/v2/notifications', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const payload = await res.json();
        return (payload.notifications || []).map(n => ({
            id: n.id,
            recipient: n.recipient_username,
            ticketId: n.ticket_id,
            ticketNumber: n.ticket_number,
            message: n.message,
            type: n.type,
            date: n.created_at,
            read: !!n.is_read
        }));
    },
    markNotificationRead: async (id) => {
        await fetch(`/api/v2/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    },
    markAllNotificationsRead: async () => {
        await fetch('/api/v2/notifications/read-all', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    },
    deleteNotification: async (id) => {
        await fetch(`/api/v2/notifications/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    },
    deleteAllNotifications: async () => {
        await fetch('/api/v2/notifications', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    },

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

    // Serverseitiger, admin-only Endpunkt (siehe extras.ts) -- verhindert, dass sich Benutzer
    // beliebige Benachrichtigungen selbst unterschieben. Wird von einer Nicht-Admin-Person
    // aufgerufen, antwortet der Server mit 403 und die Benachrichtigung entfällt (bewusst, nicht
    // nachgebaut: die entsprechenden Server-seitigen Aktionen erzeugen ihre Benachrichtigungen
    // bereits selbst, z.B. neues Ticket/Statusänderung/Genehmigung in tickets.ts).
    addNotifications: async (recipients, ticket, message, actorUsername, type = 'generic') => {
        const users = await Store.getUsers();
        const targets = [...new Set((recipients || []).filter(username => username && username !== actorUsername))];
        const allowed = [];
        for (const username of targets) {
            const person = users.find(u => u.username === username);
            if (!person) continue;
            const pref = await Store.resolveNotifPref(person, type);
            if (pref.app) allowed.push(person.id);
        }
        if (!allowed.length) return;
        await fetch('/api/v2/notifications', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipient_user_ids: allowed, type, ticket_id: ticket?.id, message })
        }).catch(() => {});
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
        const categoryCode = String(category).normalize('NFKD').replace(/[̀-ͯ]/g, '')
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
    // Menschenlesbarer Name der genehmigenden Person/Gruppe einer offenen Genehmigung
    // (gemeinsam genutzt von Admin- und Benutzer-Ticketansicht).
    describeApprover: async (approval) => {
        const users = await Store.getUsers();
        const u = users.find(x => x.id === approval.approver);
        return u?.name || u?.username || approval.approver;
    },
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
        // Dringlichkeitsfenster: mindestens 2 Std., bei sehr langen Fristen aber höchstens 3 Tage –
        // sonst gilt bei einer 90-Tage-Frist schon "noch 22 Tage" fälschlich als dringend (gelb).
        const urgencyWindow = Math.min(Math.max(totalMs * 0.25, 2 * 60 * 60 * 1000), 3 * 24 * 60 * 60 * 1000);
        const urgent = !overdue && diffMs <= urgencyWindow;
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
            const notifications = await Store.getNotifications();
            const unread = notifications.filter(item => !item.read).length;
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
            const own = (await Store.getNotifications()).sort((a, b) => new Date(b.date) - new Date(a.date));
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
                            <strong>${Utils.esc(item.ticketNumber || '')}</strong>
                            <span>${Utils.esc(item.message)}</span>
                            <time>${Utils.fmtDate(item.date)}</time>
                        </span>
                    </button>
                    <button class="btn-ghost btn-icon btn-sm notification-delete" type="button" title="${Lang.t('deleteNotification')}" aria-label="${Lang.t('deleteNotification')}">${Icon('trash-2', 14)}</button>
                </div>`).join('') : `<div class="empty-state">${Lang.t('noNotifications')}</div>`;
            list.querySelectorAll('.notification-item').forEach(row => {
                const selected = own.find(item => item.id === row.dataset.notificationId);
                row.querySelector('.notification-open').onclick = async () => {
                    if (!selected) return;
                    await Store.markNotificationRead(selected.id);
                    q('#notification-modal')?.classList.remove('open');
                    await Notifications.refresh();
                    if (selected.ticketId) {
                        if (q('.kanban-board')) await AdminBoard.openModal(selected.ticketId);
                        else await UserDash.openModal(selected.ticketId);
                    }
                };
                row.querySelector('.notification-delete').onclick = async () => {
                    await Store.deleteNotification(row.dataset.notificationId);
                    await Notifications.render();
                    await Notifications.refresh();
                };
            });
            if (window.lucide) lucide.createIcons();
        },

        markAllRead: async () => {
            await Store.markAllNotificationsRead();
            await Notifications.render();
            await Notifications.refresh();
        },

        deleteAll: async () => {
            const notifications = await Store.getNotifications();
            if (!notifications.length) return;
            UI.confirm(Lang.t('confirmDeleteNotifications'), async () => {
                await Store.deleteAllNotifications();
                await Notifications.render();
                await Notifications.refresh();
            });
        }
    },
    // Anhänge laufen über die echte, verschlüsselte /api/v2/attachments-API -- vorher zeigte
    // dieser Code auf einen nie existierenden /api/v1/attachments/*-Endpunkt und landete deshalb
    // unbemerkt immer im lokalen IndexedDB-Fallback (pro Browser, nicht in der Datenbank).
    // ticketId ist Pflicht (Backend-Schema), messageId/noteId optional -- Chat-/Notiz-Anhänge sind
    // in der Oberfläche noch nicht angebunden, siehe README.
    saveAttachment: async (fileLike, { ticketId, messageId, noteId } = {}) => {
        if (fileLike.size && fileLike.size > 15 * 1024 * 1024) {
            throw new Error('ATTACHMENT_TOO_LARGE');
        }
        if (!ticketId) throw new Error('ATTACHMENT_NEEDS_TICKET');
        const dataUrl = fileLike.data || await Store.readFile(fileLike);
        const data_b64 = String(dataUrl).split(',').pop();
        const name = fileLike.name || 'Anhang';
        const type = fileLike.type || 'application/octet-stream';
        const size = fileLike.size || Math.round((data_b64.length * 3) / 4);
        const res = await fetch('/api/v2/attachments', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ticket_id: ticketId, message_id: messageId || undefined, note_id: noteId || undefined,
                filename: name, mime_type: type, size_bytes: size, data_b64
            })
        }).catch(() => null);
        if (!res || !res.ok) throw new Error('ATTACHMENT_UPLOAD_FAILED');
        const saved = await res.json();
        return { id: saved.id, attachmentId: saved.id, name: saved.filename, type: saved.mime_type, size: saved.size_bytes };
    },
    getAttachment: async (id) => {
        const res = await fetch(`/api/v2/attachments/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (!res.ok) return null;
        const { attachment } = await res.json();
        return {
            id: attachment.id, name: attachment.filename, type: attachment.mime_type, size: attachment.size_bytes,
            data: `data:${attachment.mime_type};base64,${attachment.data_b64}`
        };
    },
    // Nur reine Ticket-Anhänge (kein message_id/note_id) -- siehe Backend-Kommentar.
    getTicketAttachments: async (ticketId) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticketId)}/attachments`, { credentials: 'same-origin' });
        if (!res.ok) return [];
        return ((await res.json()).attachments || []).map(a => ({
            id: a.id, attachmentId: a.id, name: a.filename, type: a.mime_type, size: a.size_bytes
        }));
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
    // Bewusst ein No-Op: das globale Audit-Log wird ausschließlich serverseitig bei der
    // jeweiligen Aktion selbst geschrieben (users.ts/settings.ts/tickets.ts), nie vom Client
    // übermittelt -- sonst könnte sich jede Person beliebige, nicht überprüfbare Logeinträge
    // unterschieben (Log-Integrität). Aufrufstellen bleiben unverändert, tun hier nur nichts mehr.
    addGlobalLog: async () => {},

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

    // Übernimmt die serverseitig geprüfte Sitzung in den lokalen Zustand, den der restliche
    // Code (Anzeige/Caches) erwartet -- behebt einen Absturz: diese Methode wurde in init()
    // bereits aufgerufen, war aber nirgends definiert (Store.syncSessionUser war undefined),
    // wodurch jede angemeldete Person beim Laden eine uncaught TypeError bekam.
    syncSessionUser: async (user) => {
        Store._sessionUserCache = user;
    },

    // Seed default data if empty
    init: async () => {
        const serverMode = location.protocol.startsWith('http');
        const sessionUser = await Store.fetchSessionUser();
        if (sessionUser) {
            await Store.syncSessionUser(sessionUser);
        } else if (serverMode) {
            return;
        }
        let users = await Store.getUsers();
        if (!serverMode) {
        // Lokaler Datei-Prototyp: Demo-Konten bekommen zufällige Startpasswörter.
        const adminIdx = users.findIndex(u => u.username === 'admin');
        if (adminIdx === -1) {
            users.push({
                id: Utils.uid(),
                username: 'admin',
                password: Utils.secureToken(18),
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
                password: Utils.secureToken(18),
                name: 'Max Mustermann',
                role: 'user'
            });
        }

        await Store.saveUsers(users);
        } else if (sessionUser) {
            users = await Store.getUsers();
        }
        if ((await Store.getGroups()).length === 0) {
            await Store.createGroup('Admins');
            await Store.createGroup('Verwaltung');
            await Store.createGroup('Support');
        }
        if ((await Store.getTickets()).length === 0) await Store.writePersistent('tickets', []);
        if ((await Store.getRequests()).length === 0) await Store.writePersistent('account_requests', []);

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
        // Auto-Archivierung laeuft serverseitig per Timer (jobs/maintenance.ts), kein Client-Trigger mehr.
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

    // Es gibt keinen lokalen Fallback mehr (kein localStorage-"currentUser"-Flag) -- angemeldet
    // ist ausschließlich, wer eine gültige, serverseitig geprüfte Sitzung hat.
    currentUser: async () => Store.fetchSessionUser(),

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
export const Notifications = Store.notificationUI;
