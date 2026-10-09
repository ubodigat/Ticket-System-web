/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { Store } from './store.js';

// Protokolliert jede Änderung an Tickets, Benutzern, Gruppen, Anfragen und Einstellungen im Systemprotokoll.
export const LogDiff = {
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
