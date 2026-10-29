import { q, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
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
            throw new Error(error.error === 'invalid_recipient' ? Lang.t('invalidRecipient') : error.error === 'forbidden' ? Lang.t('todoForbidden') : Lang.t('todoLoadSaveFailed'));
        }
        return response.json();
    },
    async init() {
        TodoList.user = await Store.currentUser();
        if (!['admin', 'superadmin'].includes(TodoList.user?.role) || !q('.topbar-right') || q('#btn-todos')) return;
        const button = document.createElement('button');
        button.id = 'btn-todos'; button.className = 'btn-ghost btn-icon notification-button';
        button.title = Lang.t('todoList'); button.setAttribute('aria-label', Lang.t('todoList'));
        button.innerHTML = `${Icon('list-todo', 18)}<span class="notification-count" hidden>0</span>`;
        button.type = 'button';
        button.onclick = () => TodoList.open().catch(error => UI.toast(error.message));
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
                <div class="modal-header"><h3 id="todo-heading">${Icon('list-todo', 18)}${Lang.t('todoList')}</h3><div class="modal-actions">
                    <button class="btn-ghost btn-icon" id="todo-new-recurring" title="${Lang.t('createRecurringTask')}" aria-label="${Lang.t('createRecurringTask')}">${Icon('repeat', 18)}</button>
                    <button class="btn-ghost btn-icon" data-close title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 18)}</button></div></div>
                <div class="modal-body"><div class="todo-toolbar"><div class="todo-tabs" role="tablist" aria-label="${Lang.t('tasks')}">
                    <button class="tab-btn" role="tab" data-kind="all">${Lang.t('all')}</button><button class="tab-btn" role="tab" data-kind="ticket">${Lang.t('subtasks')}</button>
                    <button class="tab-btn" role="tab" data-kind="personal">${Lang.t('ownTasks')}</button><button class="tab-btn" role="tab" data-kind="recurring">${Lang.t('recurring')}</button></div>
                    <button class="btn-secondary btn-icon" id="todo-show-done" title="${Lang.t('showDone')}" aria-label="${Lang.t('showDone')}" aria-pressed="false">${Icon('list-checks', 18)}</button>
                    <button class="btn-primary btn-icon" id="todo-add" title="${Lang.t('createNewTask')}" aria-label="${Lang.t('createNewTask')}">${Icon('plus', 18)}</button></div>
                <input type="search" id="todo-search" placeholder="${Lang.t('searchTasksPlaceholder')}" aria-label="${Lang.t('searchTasksAriaLabel')}">
                <form id="todo-form" hidden><div class="field"><label for="todo-content">${Lang.t('task')}</label><textarea id="todo-content" required maxlength="5000" rows="3"></textarea></div>
                    <div class="todo-form-grid"><div class="field"><label id="todo-date-label">${Lang.t('dueDateOptional')}</label>${UI.dateTimePickerMarkup('todo-date')}</div>
                    <div class="field" id="todo-recipient-field"><label>${Lang.t('alsoAssignTo')}</label><div id="todo-recipients"></div></div></div>
                    <div id="todo-recurrence-fields" hidden><div class="todo-form-grid">
                        <div class="field"><label for="todo-interval">${Lang.t('interval')}</label><div class="todo-interval"><input type="number" id="todo-interval" min="1" max="365" value="1" aria-label="Intervallanzahl"><select id="todo-unit"><option value="day">${Lang.t('days')}</option><option value="week">${Lang.t('weeks')}</option><option value="month">${Lang.t('months')}</option><option value="year">${Lang.t('years')}</option></select></div></div>
                        <div class="field"><label for="todo-due-hours">${Lang.t('dueAfterCreationHours')}</label><input type="number" id="todo-due-hours" min="1" max="87600"></div></div></div>
                    <div class="todo-form-actions"><button class="btn-secondary" type="button" data-cancel>${Lang.t('cancel')}</button><button class="btn-primary" type="submit" id="todo-save">${Lang.t('save')}</button></div>
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
                e.currentTarget.title = TodoList.showDone ? Lang.t('hideDone') : Lang.t('showDone'); e.currentTarget.setAttribute('aria-label', e.currentTarget.title); TodoList.render();
            };
            modal.querySelectorAll('button:not([type])').forEach(button => { button.type = 'button'; });
            q('#todo-add').onclick = () => TodoList.openForm().catch(error => UI.toast(error.message));
            q('#todo-new-recurring').onclick = () => TodoList.openForm(null, 'recurring').catch(error => UI.toast(error.message));
            modal.querySelector('[data-cancel]').onclick = () => { q('#todo-form').hidden = true; TodoList.picker.close(); };
            q('#todo-form').onsubmit = e => TodoList.saveForm(e);
        }
        modal.classList.add('open'); await TodoList.refresh(); q('#todo-search').focus();
    },
    async openForm(item = null, kind = 'personal') {
        TodoList.editingId = item?.id || null; TodoList.formKind = kind;
        q('#todo-form').hidden = false; q('#todo-content').value = item?.content || ''; q('#todo-content').focus();
        q('#todo-date-label').textContent = kind === 'recurring' ? Lang.t('firstRun') : Lang.t('dueDateOptional');
        TodoList.picker.setValue(item?.due_at ? Date.parse(item.due_at) : kind === 'recurring' ? Date.now() + 300000 : null);
        q('#todo-recurrence-fields').hidden = kind !== 'recurring'; q('#todo-recipient-field').hidden = !!item;
        q('#todo-save').textContent = item ? Lang.t('saveChanges') : kind === 'recurring' ? Lang.t('createRecurrence') : Lang.t('add');
        q('#todo-interval').value = '1'; q('#todo-unit').value = 'day'; q('#todo-due-hours').value = '';
        if (item) return;
        TodoList.recipients = UI.createMultiSelect(q('#todo-recipients'), [], [], null, { emptyLabel: Lang.t('onlyMe') });
        try {
            const admins = (await Store.getUserDirectory()).filter(u => ['admin', 'superadmin'].includes(u.role) && u.id !== TodoList.user.id && !u.accountArchived);
            TodoList.recipients = UI.createMultiSelect(q('#todo-recipients'), admins.map(u => ({ value: u.id, label: u.name || u.username })), [], null, { emptyLabel: Lang.t('onlyMe') });
        } catch { UI.toast(Lang.t('recipientPickerUnavailable')); }
    },
    async saveForm(e) {
        e.preventDefault(); const save = q('#todo-save'); save.disabled = true;
        try {
            const date = TodoList.picker.getValue(); const body = { content: q('#todo-content').value.trim() };
            if (!body.content) throw new Error(Lang.t('taskRequired'));
            if (TodoList.formKind === 'recurring') {
                if (!date) throw new Error(Lang.t('firstRunRequired'));
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
            q('#btn-todos')?.setAttribute('aria-label', Lang.format('todoListOpenCount', { count }));
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
                row.innerHTML = `<div class="todo-copy"><div class="todo-title">${Utils.esc(rule.content)}</div><small>${Lang.format('everyInterval', { count: rule.interval_count, unit: Lang.t({ day: 'days', week: 'weeks', month: 'months', year: 'years' }[rule.interval_unit]) })} · ${rule.active ? Lang.t('active') : Lang.t('paused')}</small><time>${Lang.format('nextRun', { date: Utils.esc(Utils.fmtDate(rule.next_run_at)) })}</time></div>
                    <button class="btn-ghost btn-icon" data-toggle title="${rule.active ? Lang.t('pause') : Lang.t('activate')}" aria-label="${rule.active ? Lang.t('pause') : Lang.t('activate')}">${Icon(rule.active ? 'pause' : 'play', 16)}</button>
                    <button class="btn-ghost btn-icon" data-delete title="${Lang.t('removeRecurrence')}" aria-label="${Lang.t('removeRecurrence')}">${Icon('trash-2', 16)}</button>`;
                row.querySelector('[data-toggle]').onclick = async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'PATCH', { active: !rule.active }); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } };
                row.querySelector('[data-delete]').onclick = () => UI.confirm(Lang.t('confirmRemoveRecurrence'), async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } });
                list.appendChild(row);
            }
        } else {
            const items = TodoList.items.filter(t => (TodoList.showDone || !t.done) && (TodoList.tab === 'all' || t.kind === TodoList.tab) && Utils.matchesSearch(query, t))
                .sort((a, b) => Number(a.done) - Number(b.done) || (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
            for (const item of items) {
                const row = document.createElement('div'); row.className = `todo-row${item.done ? ' is-done' : ''}${item.ticket_closed ? ' is-ticket-closed' : ''}`;
                const overdue = !item.done && item.due_at && new Date(item.due_at) < new Date();
                row.innerHTML = `<input type="checkbox" ${item.done ? 'checked' : ''} aria-label="${Lang.t('taskDone')}"><div class="todo-copy"><div class="todo-title">${Utils.esc(item.content)}</div>
                    ${item.ticket_id ? `<button class="btn-ghost todo-ticket">${Utils.esc(item.ticket_number)} · ${Utils.esc(item.ticket_title)}</button>` : `<small>${Lang.t('ownTask')}</small>`}
                    ${item.due_at && !item.done ? `<time class="${overdue ? 'todo-overdue' : ''}">${Icon('calendar-clock', 13)}${Utils.esc(Utils.fmtDate(item.due_at))}</time>` : ''}
                    ${item.done ? `<span class="todo-done-at">${Icon('check', 12)}${Utils.esc(item.done_at ? `${Lang.t('doneOn')} ${Utils.fmtDate(item.done_at)}` : Lang.t('taskDone'))}</span>` : ''}
                    ${item.ticket_closed ? `<span class="todo-ticket-closed">${Icon('lock', 12)}${Utils.esc(item.ticket_closed_at ? Lang.format('ticketClosedOn', { date: Utils.fmtDate(item.ticket_closed_at) }) : Lang.t('statusClosed'))}</span>` : ''}</div>
                    ${item.kind === 'personal' && item.creator_id === TodoList.user.id ? `<button class="btn-ghost btn-icon" data-edit title="${Lang.t('editTask')}" aria-label="${Lang.t('editTask')}">${Icon('pencil', 16)}</button>` : ''}
                    ${item.kind === 'personal' ? `<button class="btn-ghost btn-icon" data-remove title="${Lang.t('removeFromMyList')}" aria-label="${Lang.t('removeFromMyList')}">${Icon('trash-2', 16)}</button>` : ''}`;
                row.querySelector('input').onchange = async e => {
                    e.target.disabled = true;
                    try {
                        if (item.kind === 'personal') await TodoList.request(`/${item.id}`, 'PATCH', { done: e.target.checked });
                        else { const res = await fetch(`/api/v2/tickets/${item.ticket_id}/todos/${item.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: e.target.checked }) }); if (!res.ok) throw new Error(Lang.t('subtaskSaveFailed')); }
                        await TodoList.refresh();
                    } catch (error) { e.target.checked = item.done; e.target.disabled = false; UI.toast(error.message); }
                };
                if (item.ticket_id) {
                    const open = async () => { TodoList.close(); await AdminBoard.openTicketForCurrentPage(item.ticket_id); };
                    row.querySelector('.todo-ticket').onclick = open;
                    const title = row.querySelector('.todo-title'); title.setAttribute('role', 'button'); title.tabIndex = 0; title.classList.add('todo-ticket-title');
                    title.onclick = open; title.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
                }
                if (row.querySelector('[data-edit]')) row.querySelector('[data-edit]').onclick = () => TodoList.openForm(item);
                if (item.kind === 'personal') row.querySelector('[data-remove]').onclick = async () => { try { await TodoList.request(`/${item.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } };
                list.appendChild(row);
            }
        }
        if (!list.children.length) list.innerHTML = `<div class="empty-state">${Lang.t('noTasks')}</div>`;
        if (window.lucide) lucide.createIcons();
    }
};
