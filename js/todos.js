import { q, Icon, Utils } from './utils.js';
import { Store, Notifications } from './store.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';

export const TodoList = {
    items: [], rules: [], tab: 'all', showDone: false, timer: null, user: null, editingId: null, formKind: 'personal',
    async request(path = '', method = 'GET', body) {
        const response = await fetch(`/api/v2/todos${path}`, { method, credentials: 'same-origin',
            ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error === 'invalid_recipient' ? 'Bitte aktive Admins auswählen.' : error.error === 'forbidden' ? 'Keine Berechtigung für diese Aufgabe.' : 'Aufgaben konnten nicht gespeichert oder geladen werden.');
        }
        return response.json();
    },
    async init() {
        TodoList.user = await Store.currentUser();
        if (!['admin', 'superadmin'].includes(TodoList.user?.role) || !q('.topbar-right') || q('#btn-todos')) return;
        const button = document.createElement('button');
        button.id = 'btn-todos'; button.className = 'btn-ghost btn-icon notification-button';
        button.title = 'Todo-Liste'; button.setAttribute('aria-label', 'Todo-Liste');
        button.innerHTML = `${Icon('list-todo', 18)}<span class="notification-count" hidden>0</span>`;
        button.onclick = () => TodoList.open();
        q('.topbar-right').insertBefore(button, q('#btn-notifications') || q('.topbar-right').firstChild);
        document.addEventListener('open-todos', () => TodoList.open());
        await TodoList.refresh(true);
    },
    close() {
        q('#todo-modal')?.classList.remove('open'); TodoList.picker?.close();
        clearTimeout(TodoList.timer); TodoList.timer = setTimeout(() => TodoList.refresh(true), 60000);
    },
    async open() {
        let modal = q('#todo-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'todo-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `<div class="modal todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-heading">
                <div class="modal-header"><h3 id="todo-heading">${Icon('list-todo', 18)}Todo-Liste</h3><div class="modal-actions">
                    <button class="btn-ghost btn-icon" id="todo-new-recurring" title="Wiederkehrende Aufgabe erstellen" aria-label="Wiederkehrende Aufgabe erstellen">${Icon('repeat', 18)}</button>
                    <button class="btn-ghost btn-icon" data-close title="Schließen" aria-label="Schließen">${Icon('x', 18)}</button></div></div>
                <div class="modal-body"><div class="todo-toolbar"><div class="todo-tabs" role="tablist" aria-label="Aufgaben">
                    <button class="tab-btn" role="tab" data-kind="all">Alle</button><button class="tab-btn" role="tab" data-kind="ticket">Teilaufgaben</button>
                    <button class="tab-btn" role="tab" data-kind="personal">Eigene Aufgaben</button><button class="tab-btn" role="tab" data-kind="recurring">Wiederkehrend</button></div>
                    <button class="btn-secondary btn-icon" id="todo-show-done" title="Erledigte einblenden" aria-label="Erledigte einblenden" aria-pressed="false">${Icon('list-checks', 18)}</button>
                    <button class="btn-primary btn-icon" id="todo-add" title="Neue Aufgabe erstellen" aria-label="Neue Aufgabe erstellen">${Icon('plus', 18)}</button></div>
                <input type="search" id="todo-search" placeholder="Aufgaben, Tickets oder Fälligkeit suchen" aria-label="Aufgaben suchen">
                <form id="todo-form" hidden><div class="field"><label for="todo-content">Aufgabe</label><textarea id="todo-content" required maxlength="5000" rows="3"></textarea></div>
                    <div class="todo-form-grid"><div class="field"><label id="todo-date-label">Fälligkeit (optional)</label>${UI.dateTimePickerMarkup('todo-date')}</div>
                    <div class="field" id="todo-recipient-field"><label>Zusätzlich zuweisen</label><div id="todo-recipients"></div></div></div>
                    <div id="todo-recurrence-fields" hidden><div class="todo-form-grid">
                        <div class="field"><label for="todo-interval">Intervall</label><div class="todo-interval"><input type="number" id="todo-interval" min="1" max="365" value="1" aria-label="Intervallanzahl"><select id="todo-unit"><option value="day">Tag(e)</option><option value="week">Woche(n)</option><option value="month">Monat(e)</option></select></div></div>
                        <div class="field"><label for="todo-due-hours">Fällig nach Erstellung (Stunden, optional)</label><input type="number" id="todo-due-hours" min="1" max="87600"></div></div></div>
                    <div class="todo-form-actions"><button class="btn-secondary" type="button" data-cancel>Abbrechen</button><button class="btn-primary" type="submit" id="todo-save">Speichern</button></div>
                </form><div id="todo-items" aria-live="polite"></div></div></div>`;
            document.body.appendChild(modal); TodoList.picker = UI.createDateTimePicker(q('#todo-date'));
            modal.querySelector('[data-close]').onclick = () => TodoList.close();
            modal.addEventListener('keydown', e => { if (e.key === 'Escape') TodoList.close(); });
            modal.querySelectorAll('[data-kind]').forEach(button => button.onclick = async () => {
                TodoList.tab = button.dataset.kind; if (TodoList.tab === 'recurring') await TodoList.loadRules(); TodoList.render();
            });
            q('#todo-search').oninput = () => TodoList.render();
            q('#todo-show-done').onclick = e => {
                TodoList.showDone = !TodoList.showDone; e.currentTarget.setAttribute('aria-pressed', String(TodoList.showDone));
                e.currentTarget.title = TodoList.showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'; e.currentTarget.setAttribute('aria-label', e.currentTarget.title); TodoList.render();
            };
            q('#todo-add').onclick = () => TodoList.openForm();
            q('#todo-new-recurring').onclick = () => TodoList.openForm(null, 'recurring');
            modal.querySelector('[data-cancel]').onclick = () => { q('#todo-form').hidden = true; TodoList.picker.close(); };
            q('#todo-form').onsubmit = e => TodoList.saveForm(e);
        }
        modal.classList.add('open'); await TodoList.refresh(); q('#todo-search').focus();
    },
    async openForm(item = null, kind = 'personal') {
        TodoList.editingId = item?.id || null; TodoList.formKind = kind;
        q('#todo-form').hidden = false; q('#todo-content').value = item?.content || ''; q('#todo-content').focus();
        q('#todo-date-label').textContent = kind === 'recurring' ? 'Erste Ausführung' : 'Fälligkeit (optional)';
        TodoList.picker.setValue(item?.due_at ? Date.parse(item.due_at) : kind === 'recurring' ? Date.now() + 300000 : null);
        q('#todo-recurrence-fields').hidden = kind !== 'recurring'; q('#todo-recipient-field').hidden = !!item;
        q('#todo-save').textContent = item ? 'Änderungen speichern' : kind === 'recurring' ? 'Wiederholung erstellen' : 'Hinzufügen';
        q('#todo-interval').value = '1'; q('#todo-unit').value = 'day'; q('#todo-due-hours').value = '';
        if (item) return;
        TodoList.recipients = UI.createMultiSelect(q('#todo-recipients'), [], [], null, { emptyLabel: 'Nur ich' });
        try {
            const admins = (await Store.getUserDirectory()).filter(u => ['admin', 'superadmin'].includes(u.role) && u.id !== TodoList.user.id && !u.accountArchived);
            TodoList.recipients = UI.createMultiSelect(q('#todo-recipients'), admins.map(u => ({ value: u.id, label: u.name || u.username })), [], null, { emptyLabel: 'Nur ich' });
        } catch { UI.toast('Personenauswahl nicht erreichbar. Du kannst die Aufgabe für dich selbst erstellen.'); }
    },
    async saveForm(e) {
        e.preventDefault(); const save = q('#todo-save'); save.disabled = true;
        try {
            const date = TodoList.picker.getValue(); const body = { content: q('#todo-content').value.trim() };
            if (!body.content) throw new Error('Bitte eine Aufgabe eingeben.');
            if (TodoList.formKind === 'recurring') {
                if (!date) throw new Error('Bitte die erste Ausführung wählen.');
                Object.assign(body, { recipient_ids: TodoList.recipients.getValue(), next_run_at: new Date(date).toISOString(), interval_count: Number(q('#todo-interval').value), interval_unit: q('#todo-unit').value,
                    due_after_hours: q('#todo-due-hours').value ? Number(q('#todo-due-hours').value) : null });
                await TodoList.request('/recurring', 'POST', body); TodoList.tab = 'recurring'; await TodoList.loadRules();
            } else {
                body.due_at = date ? new Date(date).toISOString() : null;
                if (!TodoList.editingId) body.recipient_ids = TodoList.recipients.getValue();
                await TodoList.request(TodoList.editingId ? `/${TodoList.editingId}` : '', TodoList.editingId ? 'PATCH' : 'POST', body);
            }
            q('#todo-form').hidden = true; TodoList.picker.close(); await TodoList.refresh(); await Notifications.refresh();
        } catch (error) { UI.toast(error.message); } finally { save.disabled = false; }
    },
    async loadRules() {
        try { TodoList.rules = (await TodoList.request('/recurring')).rules; } catch (error) { UI.toast(error.message); }
    },
    async refresh(silent = false) {
        clearTimeout(TodoList.timer);
        try {
            TodoList.items = (await TodoList.request()).todos;
            const count = TodoList.items.filter(t => !t.done).length; const badge = q('#btn-todos .notification-count');
            if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
            q('#btn-todos')?.setAttribute('aria-label', `Todo-Liste: ${count} offene Aufgaben`);
            if (q('#todo-modal')?.classList.contains('open')) { if (TodoList.tab === 'recurring') await TodoList.loadRules(); TodoList.render(); }
        } catch (error) { if (!silent) UI.toast(error.message); }
        TodoList.timer = setTimeout(() => TodoList.refresh(true), q('#todo-modal')?.classList.contains('open') ? 15000 : 60000);
    },
    render() {
        const query = q('#todo-search').value;
        q('#todo-modal').querySelectorAll('[data-kind]').forEach(b => { const active = b.dataset.kind === TodoList.tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
        q('#todo-show-done').hidden = TodoList.tab === 'recurring';
        const list = q('#todo-items'); list.replaceChildren();
        if (TodoList.tab === 'recurring') {
            for (const rule of TodoList.rules.filter(r => Utils.matchesSearch(query, r))) {
                const row = document.createElement('div'); row.className = 'todo-row';
                row.innerHTML = `<div class="todo-copy"><div class="todo-title">${Utils.esc(rule.content)}</div><small>Alle ${rule.interval_count} ${{ day: 'Tag(e)', week: 'Woche(n)', month: 'Monat(e)' }[rule.interval_unit]} · ${rule.active ? 'Aktiv' : 'Pausiert'}</small><time>Nächste Ausführung: ${Utils.esc(Utils.fmtDate(rule.next_run_at))}</time></div>
                    <button class="btn-ghost btn-icon" data-toggle title="${rule.active ? 'Pausieren' : 'Aktivieren'}" aria-label="${rule.active ? 'Pausieren' : 'Aktivieren'}">${Icon(rule.active ? 'pause' : 'play', 16)}</button>
                    <button class="btn-ghost btn-icon" data-delete title="Wiederholung entfernen" aria-label="Wiederholung entfernen">${Icon('trash-2', 16)}</button>`;
                row.querySelector('[data-toggle]').onclick = async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'PATCH', { active: !rule.active }); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } };
                row.querySelector('[data-delete]').onclick = () => UI.confirm('Wiederholung entfernen? Bereits erstellte Aufgaben bleiben bestehen.', async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } });
                list.appendChild(row);
            }
        } else {
            const items = TodoList.items.filter(t => (TodoList.showDone || !t.done) && (TodoList.tab === 'all' || t.kind === TodoList.tab) && Utils.matchesSearch(query, t))
                .sort((a, b) => Number(a.done) - Number(b.done) || (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
            for (const item of items) {
                const row = document.createElement('div'); row.className = `todo-row${item.done ? ' is-done' : ''}`;
                const overdue = !item.done && item.due_at && new Date(item.due_at) < new Date();
                row.innerHTML = `<input type="checkbox" ${item.done ? 'checked' : ''} aria-label="Aufgabe erledigt"><div class="todo-copy"><div class="todo-title">${Utils.esc(item.content)}</div>
                    ${item.ticket_id ? `<button class="btn-ghost todo-ticket">${Utils.esc(item.ticket_number)} · ${Utils.esc(item.ticket_title)}</button>` : '<small>Eigene Aufgabe</small>'}
                    ${item.due_at ? `<time class="${overdue ? 'todo-overdue' : ''}">${Icon('calendar-clock', 13)}${Utils.esc(Utils.fmtDate(item.due_at))}</time>` : ''}</div>
                    ${item.kind === 'personal' && item.creator_id === TodoList.user.id ? `<button class="btn-ghost btn-icon" data-edit title="Aufgabe bearbeiten" aria-label="Aufgabe bearbeiten">${Icon('pencil', 16)}</button>` : ''}
                    ${item.kind === 'personal' ? `<button class="btn-ghost btn-icon" data-remove title="Aus meiner Liste entfernen" aria-label="Aus meiner Liste entfernen">${Icon('trash-2', 16)}</button>` : ''}`;
                row.querySelector('input').onchange = async e => {
                    e.target.disabled = true;
                    try {
                        if (item.kind === 'personal') await TodoList.request(`/${item.id}`, 'PATCH', { done: e.target.checked });
                        else { const res = await fetch(`/api/v2/tickets/${item.ticket_id}/todos/${item.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: e.target.checked }) }); if (!res.ok) throw new Error('Teilaufgabe konnte nicht gespeichert werden.'); }
                        await TodoList.refresh();
                    } catch (error) { e.target.checked = item.done; e.target.disabled = false; UI.toast(error.message); }
                };
                if (item.ticket_id) row.querySelector('.todo-ticket').onclick = async () => { TodoList.close(); await AdminBoard.openTicketForCurrentPage(item.ticket_id); };
                if (row.querySelector('[data-edit]')) row.querySelector('[data-edit]').onclick = () => TodoList.openForm(item);
                if (item.kind === 'personal') row.querySelector('[data-remove]').onclick = async () => { try { await TodoList.request(`/${item.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } };
                list.appendChild(row);
            }
        }
        if (!list.children.length) list.innerHTML = '<div class="empty-state">Keine Aufgaben</div>';
        if (window.lucide) lucide.createIcons();
    }
};
