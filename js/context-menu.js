/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { Utils } from './utils.js';
import { Lang } from './lang.js';
import { Store } from './store.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';
import { insertMarkdownTable } from './ticket-helpers.js';
// --- Kontextmenü (Rechtsklick) -----------------------------------------------
// Ein zentraler Handler statt verstreuter contextmenu-Listener: Elemente markieren sich
// mit data-ctx="<bereich>" (und meist data-id="..."), ContextMenu.providers liefert dazu
// die Einträge. Jede Aktion muss auch anderswo erreichbar sein (siehe DESIGN.md).
export const ContextMenu = { providers: {} };

ContextMenu.providers.ticket = async (el) => {
    const id = el.dataset.id;
    const tickets = await Store.getTickets();
    const t = tickets.find(x => x.id === id);
    if (!t || t.archived) return null;
    const user = await Store.currentUser();
    const pendingApproval = (t.approvals || []).some(a => a.status === 'pending');
    const statusOptions = ['Neu', 'In Bearbeitung', 'Warten auf Benutzer', 'Geschlossen'];
    const prioOptions = ['Niedrig', 'Normal', 'Hoch', 'Kritisch'];
    const copy = async (text, label) => {
        try { await navigator.clipboard.writeText(text); UI.toast(`${label} kopiert.`); }
        catch { UI.toast('Kopieren nicht möglich.'); }
    };
    const setStatus = async (status) => {
        if (status === 'Warten auf Benutzer') {
            const choice = await AdminBoard.chooseWaitingStatus();
            if (!choice) return;
            await AdminBoard.changeStatus(t.id, choice.status, choice.message);
        } else {
            await AdminBoard.changeStatus(t.id, status);
        }
        await AdminBoard.render();
    };
    return [
        { label: 'Öffnen', icon: 'external-link', shortcut: 'Enter', run: () => AdminBoard.openModal(t.id) },
        { separator: true },
        {
            label: 'Status', icon: 'circle-dot',
            disabled: pendingApproval, title: pendingApproval ? 'Wartet noch auf Genehmigung' : undefined,
            submenu: statusOptions.map(s => ({ label: Lang.status(s), disabled: t.status === s, run: () => setStatus(s) }))
        },
        {
            label: 'Priorität', icon: 'flag',
            submenu: prioOptions.map(p => ({
                label: p, disabled: t.prio === p,
                run: async () => {
                    const all = await Store.getTickets();
                    const ticket = all.find(x => x.id === t.id);
                    if (!ticket) return;
                    ticket.prio = p;
                    await Store.addLog(ticket, 'Priorität geändert', p);
                    await Store.saveTickets(all);
                    await AdminBoard.render();
                }
            }))
        },
        {
            label: 'Mir zuweisen', icon: 'user-check', disabled: (t.assignees || []).includes(user?.username),
            run: async () => {
                const all = await Store.getTickets();
                const ticket = all.find(x => x.id === t.id);
                if (!ticket || !user) return;
                ticket.owner = user.username;
                ticket.ownerUserId = user.id;
                await Store.addLog(ticket, 'Zugewiesen an sich selbst');
                await Store.saveTickets(all);
                await AdminBoard.render();
            }
        },
        {
            label: 'Genehmigung anfordern', icon: 'badge-check',
            disabled: pendingApproval, title: pendingApproval ? 'Es läuft bereits eine Genehmigung' : undefined,
            run: () => AdminBoard.requestApproval(t)
        },
        { separator: true },
        { label: 'Ticketnummer kopieren', icon: 'copy', run: () => copy(t.ticketNumber || t.id, 'Ticketnummer') },
        { label: 'Drucken / PDF', icon: 'printer', run: () => AdminBoard.printTicket(t.id) },
        { separator: true },
        { label: 'Archivieren', icon: 'archive', danger: true, run: () => UI.confirm(`Ticket "${t.ticketNumber || t.id}" archivieren?`, async () => {
            const all = await Store.getTickets();
            const ticket = all.find(x => x.id === t.id);
            if (!ticket) return;
            ticket.archived = true;
            ticket.archivedAt = Utils.nowISO();
            await Store.addLog(ticket, 'Archiviert (Kontextmenü)');
            await Store.saveTickets(all);
            UI.toast('Ticket archiviert.');
            await AdminBoard.render();
        }) }
    ];
};

document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Shift+Rechtsklick erzwingt weiterhin das native Menü

    // Ausnahme von der Regel "kein eigenes Menü in Textfeldern": Rechtsklick auf eine
    // eingefügte Tabelle im Rich-Text-Editor darf sie erneut bearbeiten/löschen lassen.
    const table = e.target.closest('.rich-editor table');
    if (table) {
        e.preventDefault();
        const area = table.closest('.rich-editor');
        UI.contextMenu([
            { label: 'Tabelle bearbeiten', icon: 'table', run: () => insertMarkdownTable(area, table) },
            { separator: true },
            { label: 'Tabelle löschen', icon: 'trash-2', danger: true, run: () => UI.confirm('Diese Tabelle löschen?', () => {
                table.remove();
                area.dispatchEvent(new Event('input', { bubbles: true }));
            }) }
        ], e.clientX, e.clientY);
        return;
    }

    if (e.target.closest('input, textarea, [contenteditable], a')) return;
    if (window.getSelection()?.toString()) return;
    const target = e.target.closest('[data-ctx]');
    if (!target) return;
    const provider = ContextMenu.providers[target.dataset.ctx];
    if (!provider) return;
    e.preventDefault();
    Promise.resolve(provider(target)).then(items => {
        if (items?.length) UI.contextMenu(items, e.clientX, e.clientY);
    });
});
