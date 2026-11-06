import { q, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { Store, Notifications } from './store.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';
import { WorkTimer } from './work-timer.js';

// Aufgabenliste fuer Admins: Popup mit Schnelleingabe und nach Faelligkeit gruppierter Liste, dazu ein
// verschiebbares, dauerhaft sichtbares Fenster (Position und Groesse merkt sich der Browser).
const store = {
    get: (key, fallback) => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
    set: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* nur Komfort */ } }
};
const dayKey = date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export const TodoList = {
    items: [], rules: [], tab: 'all', showDone: false, timer: null, user: null, floatKind: 'all',
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
        document.addEventListener('work-timer-changed', () => { TodoList.render(); });
        await TodoList.refresh(true);
        if (store.get('todo-float', false)) TodoList.openFloat();
    },
    close() {
        TodoList.closeForm();
        q('#todo-modal')?.classList.remove('open'); TodoList.picker?.close();
        clearTimeout(TodoList.timer); TodoList.timer = setTimeout(() => TodoList.refresh(true), 60000);
    },
    async open() {
        let modal = q('#todo-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'todo-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `<div class="modal todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-heading">
                <div class="modal-header"><h3 id="todo-heading">${Icon('list-todo', 18)}${Lang.t('todoList')}</h3><div class="modal-actions">
                    <button class="btn-ghost btn-icon" id="todo-pin" title="${Lang.t('todoPinFloat')}" aria-label="${Lang.t('todoPinFloat')}">${Icon('picture-in-picture-2', 18)}</button>
                    <button class="btn-ghost btn-icon" id="todo-new-recurring" title="${Lang.t('createRecurringTask')}" aria-label="${Lang.t('createRecurringTask')}">${Icon('repeat', 18)}</button>
                    <button class="btn-ghost btn-icon" data-close title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 18)}</button></div></div>
                <div class="modal-body">
                    <div class="todo-tabs" role="tablist" aria-label="${Lang.t('tasks')}">
                        <button class="tab-btn" role="tab" data-kind="all">${Lang.t('all')}<span class="todo-tab-count"></span></button>
                        <button class="tab-btn" role="tab" data-kind="ticket">${Lang.t('subtasks')}<span class="todo-tab-count"></span></button>
                        <button class="tab-btn" role="tab" data-kind="personal">${Lang.t('ownTasks')}<span class="todo-tab-count"></span></button>
                        <button class="tab-btn" role="tab" data-kind="recurring">${Lang.t('recurring')}<span class="todo-tab-count"></span></button>
                    </div>
                    <form class="todo-quick" id="todo-quick">
                        ${Icon('plus', 16)}<input type="text" id="todo-quick-input" maxlength="5000" placeholder="${Lang.t('todoQuickAddPlaceholder')}" aria-label="${Lang.t('createNewTask')}">
                        <button type="button" class="btn-ghost btn-sm" id="todo-list-options" title="${Lang.t('todoMoreOptionsHint')}">${Icon('sliders-horizontal', 15)}${Lang.t('todoMoreOptions')}</button>
                        <button type="submit" class="btn-primary btn-sm">${Lang.t('add')}</button>
                    </form>
                    <form id="todo-form" hidden><div class="field"><label for="todo-content">${Lang.t('task')}</label><textarea id="todo-content" required maxlength="5000" rows="3"></textarea></div>
                        <div class="todo-form-grid"><div class="field"><label id="todo-date-label">${Lang.t('dueDateOptional')}</label>${UI.dateTimePickerMarkup('todo-date')}</div>
                        <div class="field" id="todo-recipient-field"><label>${Lang.t('alsoAssignTo')}</label><div id="todo-recipients"></div></div></div>
                        <div id="todo-recurrence-fields" hidden><div class="todo-form-grid">
                            <div class="field"><label for="todo-interval">${Lang.t('interval')}</label><div class="todo-interval"><input type="number" id="todo-interval" min="1" max="365" value="1" aria-label="${Lang.t('interval')}"><select id="todo-unit"><option value="day">${Lang.t('days')}</option><option value="week">${Lang.t('weeks')}</option><option value="month">${Lang.t('months')}</option><option value="year">${Lang.t('years')}</option></select></div></div>
                            <div class="field"><label for="todo-due-hours">${Lang.t('dueAfterCreationHours')}</label><input type="number" id="todo-due-hours" min="1" max="87600"></div></div></div>
                        <div class="todo-form-actions"><button class="btn-secondary" type="button" data-cancel>${Lang.t('cancel')}</button><button class="btn-primary" type="submit" id="todo-save">${Lang.t('save')}</button></div>
                    </form>
                    <div class="todo-filter-row">
                        <div class="todo-search">${Icon('search', 15)}<input type="search" id="todo-search" placeholder="${Lang.t('searchTasksPlaceholder')}" aria-label="${Lang.t('searchTasksAriaLabel')}"></div>
                        <label class="check-row compact" id="todo-show-done-row"><input type="checkbox" id="todo-show-done"><span>${Lang.t('showDone')}</span></label>
                    </div>
                    <div id="todo-items" aria-live="polite"></div>
                </div></div>`;
            document.body.appendChild(modal); TodoList.picker = UI.createDateTimePicker(q('#todo-date'));
            modal.querySelector('[data-close]').onclick = () => TodoList.close();
            modal.onclick = event => { if (event.target === modal) TodoList.close(); };
            modal.addEventListener('keydown', e => { if (e.key === 'Escape') TodoList.close(); });
            modal.querySelectorAll('[data-kind]').forEach(button => button.onclick = async () => {
                TodoList.tab = button.dataset.kind; if (TodoList.tab === 'recurring') await TodoList.loadRules(); TodoList.render();
            });
            q('#todo-search').oninput = () => TodoList.render();
            q('#todo-show-done').onchange = event => { TodoList.showDone = event.target.checked; TodoList.render(); };
            modal.querySelectorAll('button:not([type])').forEach(button => { button.type = 'button'; });
            q('#todo-list-options').onclick = () => TodoList.openForm(null, TodoList.tab === 'recurring' ? 'recurring' : 'personal', q('#todo-quick-input').value).catch(error => UI.toast(error.message));
            q('#todo-new-recurring').onclick = () => TodoList.openForm(null, 'recurring').catch(error => UI.toast(error.message));
            q('#todo-pin').onclick = () => { TodoList.close(); TodoList.openFloat(); };
            q('#todo-quick').onsubmit = event => { event.preventDefault(); TodoList.quickAdd(q('#todo-quick-input')); };
            modal.querySelector('[data-cancel]').onclick = () => TodoList.closeForm();
            q('#todo-form').onsubmit = e => TodoList.saveForm(e);
        }
        modal.classList.add('open'); await TodoList.refresh(); q('#todo-quick-input').focus();
    },
    // Schnelleingabe: eigene Aufgabe ohne Faelligkeit; Details ueber "Optionen".
    async quickAdd(input) {
        const content = input.value.trim();
        if (!content) return input.focus();
        input.disabled = true;
        try {
            await TodoList.request('', 'POST', { content, due_at: null, recipient_ids: [] });
            input.value = '';
            UI.toast(Lang.t('todoAdded'));
            await TodoList.refresh();
        } catch (error) { UI.toast(error.message); } finally { input.disabled = false; input.focus(); }
    },
    closeForm() {
        const form = q('#todo-form');
        if (form) { form.hidden = true; q('#todo-modal .modal-body')?.insertBefore(form, q('#todo-modal .todo-filter-row')); }
        TodoList.picker?.close(); q('#todo-editor-modal')?.remove();
    },
    async openForm(item = null, kind = 'personal', prefill = '') {
        if (!q('#todo-modal')?.classList.contains('open')) await TodoList.open();
        TodoList.closeForm();
        const editor = AdminBoard.openDialog({ id: 'todo-editor-modal', title: item ? Lang.t('editTask') : Lang.t(kind === 'recurring' ? 'createRecurringTask' : 'createNewTask'), icon: 'list-todo', body: '', size: 'lg' });
        editor.querySelector('.modal-body').appendChild(q('#todo-form'));
        editor.querySelector('[data-dialog-close]').onclick = () => TodoList.closeForm();
        editor.onclick = event => { if (event.target === editor) TodoList.closeForm(); };
        editor.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); TodoList.closeForm(); } });
        TodoList.editingId = item?.id || null; TodoList.formKind = kind;
        q('#todo-form').hidden = false; q('#todo-content').value = item?.content || prefill || ''; q('#todo-content').focus();
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
            TodoList.closeForm(); q('#todo-quick-input').value = ''; await TodoList.refresh(); await Notifications.refresh();
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
            if (q('#todo-modal')?.classList.contains('open') && TodoList.tab === 'recurring') await TodoList.loadRules();
            TodoList.render();
        } catch (error) { if (!silent) UI.toast(error.message); }
        const active = q('#todo-modal')?.classList.contains('open') || !!q('#todo-float');
        TodoList.timer = setTimeout(() => TodoList.refresh(true), active ? 15000 : 60000);
    },
    // Offene Aufgaben nach Faelligkeit: ueberfaellig, heute, demnaechst, ohne Datum; erledigte am Ende.
    groups(items) {
        const now = new Date(); const today = dayKey(now);
        const sections = { overdue: [], today: [], upcoming: [], none: [], done: [] };
        for (const item of items) {
            if (item.done) { sections.done.push(item); continue; }
            if (!item.due_at) { sections.none.push(item); continue; }
            const due = new Date(item.due_at);
            if (due < now) sections.overdue.push(item);
            else if (dayKey(due) === today) sections.today.push(item);
            else sections.upcoming.push(item);
        }
        const byDue = (a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity);
        sections.done.sort((a, b) => Date.parse(b.done_at || 0) - Date.parse(a.done_at || 0));
        return [['overdue', 'todoSectionOverdue', 'alarm-clock'], ['today', 'todoSectionToday', 'sun'], ['upcoming', 'todoSectionUpcoming', 'calendar-clock'],
            ['none', 'todoSectionNoDate', 'inbox'], ['done', 'todoSectionDone', 'check-check']]
            .map(([key, label, icon]) => ({ key, label, icon, items: key === 'done' ? sections.done : sections[key].sort(byDue) }))
            .filter(section => section.items.length);
    },
    rowElement(item, { compact = false } = {}) {
        const row = document.createElement('div');
        const overdue = !item.done && item.due_at && new Date(item.due_at) < new Date();
        const dueToday = !item.done && !overdue && item.due_at && dayKey(new Date(item.due_at)) === dayKey(new Date());
        row.className = `todo-row${item.done ? ' is-done' : ''}${item.ticket_closed ? ' is-ticket-closed' : ''}${compact ? ' is-compact' : ''}`;
        row.innerHTML = `<input type="checkbox" class="todo-check" ${item.done ? 'checked' : ''} aria-label="${Lang.t('taskDone')}"><div class="todo-copy"><div class="todo-title">${Utils.esc(item.content)}</div>
            <div class="todo-meta-row">
                ${item.ticket_id ? `<button type="button" class="todo-chip todo-ticket" title="${Utils.esc(item.ticket_title || '')}">${Icon('ticket', 12)}${Utils.esc(item.ticket_number)}${compact ? '' : ` · ${Utils.esc(item.ticket_title)}`}</button>` : `<span class="todo-chip">${Icon('user-round', 12)}${Lang.t('ownTask')}</span>`}
                ${item.due_at && !item.done ? `<time class="todo-chip${overdue ? ' todo-overdue' : dueToday ? ' todo-today' : ''}">${Icon('calendar-clock', 12)}${Utils.esc(Utils.fmtDate(item.due_at))}</time>` : ''}
                ${item.done ? `<span class="todo-chip todo-done-at">${Icon('check', 12)}${Utils.esc(item.done_at ? `${Lang.t('doneOn')} ${Utils.fmtDate(item.done_at)}` : Lang.t('taskDone'))}</span>` : ''}
                ${item.ticket_closed ? `<span class="todo-chip todo-ticket-closed">${Icon('lock', 12)}${Utils.esc(item.ticket_closed_at ? Lang.format('ticketClosedOn', { date: Utils.fmtDate(item.ticket_closed_at) }) : Lang.t('statusClosed'))}</span>` : ''}
            </div></div>
            <div class="todo-row-actions">
                ${!item.done && !item.ticket_closed ? `<button type="button" class="btn-ghost btn-icon btn-sm" data-track title="${Lang.t('timeTracking')}" aria-label="${Lang.t('timeTracking')}">${Icon((item.ticket_id ? WorkTimer.timer?.ticket_id === item.ticket_id : WorkTimer.timer?.todo_id === item.id) ? 'square' : 'play', 15)}</button>` : ''}
                ${item.kind === 'personal' ? `<button type="button" class="btn-ghost btn-icon btn-sm" data-time-history title="${Lang.t('timeTracking')}" aria-label="${Lang.t('timeTracking')}">${Icon('history', 15)}</button>` : ''}
                ${item.kind === 'personal' && item.creator_id === TodoList.user.id ? `<button type="button" class="btn-ghost btn-icon btn-sm" data-edit title="${Lang.t('editTask')}" aria-label="${Lang.t('editTask')}">${Icon('pencil', 15)}</button>` : ''}
                ${item.kind === 'personal' ? `<button type="button" class="btn-ghost btn-icon btn-sm" data-remove title="${Lang.t('removeFromMyList')}" aria-label="${Lang.t('removeFromMyList')}">${Icon('trash-2', 15)}</button>` : ''}
            </div>`;
        row.querySelector('.todo-check').onchange = async e => {
            e.target.disabled = true;
            try {
                if (item.kind === 'personal') await TodoList.request(`/${item.id}`, 'PATCH', { done: e.target.checked });
                else { const res = await fetch(`/api/v2/tickets/${encodeURIComponent(item.ticket_id)}/todos/${encodeURIComponent(item.id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: e.target.checked }) }); if (!res.ok) throw new Error(Lang.t('subtaskSaveFailed')); }
                await TodoList.refresh();
            } catch (error) { e.target.checked = item.done; e.target.disabled = false; UI.toast(error.message); }
        };
        if (item.ticket_id) row.querySelector('.todo-ticket').onclick = async () => { TodoList.close(); await AdminBoard.openTicketForCurrentPage(item.ticket_id); };
        row.querySelector('[data-edit]')?.addEventListener('click', () => TodoList.openForm(item).catch(error => UI.toast(error.message)));
        row.querySelector('[data-track]')?.addEventListener('click', async event => {
            const button = event.currentTarget; button.disabled = true;
            try { await WorkTimer.toggleTarget(item.ticket_id ? { ticketId: item.ticket_id } : { todoId: item.id }); }
            catch (error) { UI.toast(error.message); }
            finally { button.disabled = false; }
        });
        row.querySelector('[data-time-history]')?.addEventListener('click', async () => {
            try {
                const { entries } = await TodoList.request(`/${encodeURIComponent(item.id)}/time-entries`);
                AdminBoard.openDialog({ id: 'todo-time-history', title: Lang.t('timeTracking'), icon: 'clock',
                    body: `<h4>${Utils.esc(item.content)}</h4><p>${entries.reduce((sum, entry) => sum + entry.minutes, 0)} min</p>
                        ${entries.map(entry => `<div class="uw-review-section"><span class="hint">${Utils.esc(Utils.fmtEntryPeriod(entry))} · ${entry.minutes} min</span><p>${Utils.esc(entry.activity)}</p></div>`).join('')}` });
            } catch (error) { UI.toast(error.message); }
        });
        row.querySelector('[data-remove]')?.addEventListener('click', async () => { try { await TodoList.request(`/${item.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } });
        return row;
    },
    renderGrouped(list, items, options = {}) {
        list.replaceChildren();
        for (const section of TodoList.groups(items)) {
            const head = document.createElement('div');
            head.className = `todo-section-head is-${section.key}`;
            head.innerHTML = `${Icon(section.icon, 14)}<span>${Utils.esc(Lang.t(section.label))}</span><span class="todo-section-count">${section.items.length}</span>`;
            list.appendChild(head);
            section.items.forEach(item => list.appendChild(TodoList.rowElement(item, options)));
        }
        if (!list.children.length) list.innerHTML = `<div class="empty-state compact">${Icon('party-popper', 18)}<span>${Lang.t('noTasks')}</span></div>`;
    },
    render() {
        TodoList.renderFloat();
        const modal = q('#todo-modal');
        if (!modal?.classList.contains('open')) return;
        const query = q('#todo-search').value;
        const open = TodoList.items.filter(t => !t.done);
        const counts = { all: open.length, ticket: open.filter(t => t.kind === 'ticket').length, personal: open.filter(t => t.kind === 'personal').length, recurring: TodoList.rules.length };
        modal.querySelectorAll('[data-kind]').forEach(b => {
            const active = b.dataset.kind === TodoList.tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active));
            b.querySelector('.todo-tab-count').textContent = counts[b.dataset.kind] ? String(counts[b.dataset.kind]) : '';
        });
        q('#todo-show-done-row').hidden = TodoList.tab === 'recurring';
        const list = q('#todo-items');
        if (TodoList.tab === 'recurring') {
            list.replaceChildren();
            for (const rule of TodoList.rules.filter(r => Utils.matchesSearch(query, r))) {
                const row = document.createElement('div'); row.className = 'todo-row';
                row.innerHTML = `<span class="todo-rule-icon">${Icon(rule.active ? 'repeat' : 'pause', 16)}</span><div class="todo-copy"><div class="todo-title">${Utils.esc(rule.content)}</div>
                    <div class="todo-meta-row"><span class="todo-chip">${Icon('repeat', 12)}${Lang.format('everyInterval', { count: rule.interval_count, unit: Lang.t({ day: 'days', week: 'weeks', month: 'months', year: 'years' }[rule.interval_unit]) })}</span>
                    <span class="todo-chip">${rule.active ? Lang.t('active') : Lang.t('paused')}</span><time class="todo-chip">${Icon('calendar-clock', 12)}${Lang.format('nextRun', { date: Utils.esc(Utils.fmtDate(rule.next_run_at)) })}</time></div></div>
                    <div class="todo-row-actions"><button type="button" class="btn-ghost btn-icon btn-sm" data-toggle title="${rule.active ? Lang.t('pause') : Lang.t('activate')}" aria-label="${rule.active ? Lang.t('pause') : Lang.t('activate')}">${Icon(rule.active ? 'pause' : 'play', 15)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-sm" data-delete title="${Lang.t('removeRecurrence')}" aria-label="${Lang.t('removeRecurrence')}">${Icon('trash-2', 15)}</button></div>`;
                row.querySelector('[data-toggle]').onclick = async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'PATCH', { active: !rule.active }); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } };
                row.querySelector('[data-delete]').onclick = () => UI.confirm(Lang.t('confirmRemoveRecurrence'), async () => { try { await TodoList.request(`/recurring/${rule.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); } });
                list.appendChild(row);
            }
            if (!list.children.length) list.innerHTML = `<div class="empty-state compact">${Lang.t('noTasks')}</div>`;
        } else {
            TodoList.renderGrouped(list, TodoList.items.filter(t => (TodoList.showDone || !t.done) && (TodoList.tab === 'all' || t.kind === TodoList.tab) && Utils.matchesSearch(query, t)));
        }
        if (window.lucide) lucide.createIcons();
    },

    // --- Schwebendes Fenster ---
    openFloat() {
        if (q('#todo-float')) return;
        store.set('todo-float', true);
        const panel = document.createElement('aside');
        panel.id = 'todo-float'; panel.className = 'todo-float';
        panel.setAttribute('aria-label', Lang.t('todoList'));
        const pos = store.get('todo-float-pos', null);
        panel.innerHTML = `<div class="todo-float-head" tabindex="0" title="${Lang.t('todoFloatMoveHint')}">
                <span class="todo-float-grip" aria-hidden="true">${Icon('grip-vertical', 14)}</span>
                <strong>${Icon('list-todo', 15)}${Lang.t('todoList')}</strong><span class="todo-float-count"></span>
                <span class="todo-float-actions">
                    <button type="button" class="btn-ghost btn-icon btn-xs" data-float-collapse title="${Lang.t('todoCollapse')}" aria-label="${Lang.t('todoCollapse')}">${Icon('minus', 14)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-xs" data-float-expand title="${Lang.t('todoExpand')}" aria-label="${Lang.t('todoExpand')}">${Icon('maximize-2', 14)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-xs" data-float-close title="${Lang.t('todoUnpinFloat')}" aria-label="${Lang.t('todoUnpinFloat')}">${Icon('x', 14)}</button>
                </span></div>
            <div class="todo-float-body">
                <form class="todo-quick is-compact" id="todo-float-quick">${Icon('plus', 15)}<input type="text" maxlength="5000" placeholder="${Lang.t('todoQuickAddPlaceholder')}" aria-label="${Lang.t('createNewTask')}"></form>
                <div class="todo-float-filter" role="group" aria-label="${Lang.t('tasks')}">
                    <button type="button" data-float-kind="all">${Lang.t('all')}</button><button type="button" data-float-kind="ticket">${Lang.t('subtasks')}</button><button type="button" data-float-kind="personal">${Lang.t('ownTasks')}</button>
                </div>
                <div class="todo-float-list" aria-live="polite"></div>
            </div>`;
        document.body.appendChild(panel);
        if (pos) Object.assign(panel.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: pos.w ? `${pos.w}px` : '', height: pos.h ? `${pos.h}px` : '' });
        panel.classList.toggle('is-collapsed', !!pos?.collapsed);
        TodoList.keepInView(panel);
        const save = () => {
            const rect = panel.getBoundingClientRect();
            const previous = store.get('todo-float-pos', {}) || {};
            const collapsed = panel.classList.contains('is-collapsed');
            store.set('todo-float-pos', { x: Math.round(rect.left), y: Math.round(rect.top), w: collapsed ? previous.w || null : Math.round(rect.width),
                h: collapsed ? previous.h || null : Math.round(rect.height), collapsed });
        };
        const head = panel.querySelector('.todo-float-head');
        let drag = null;
        head.addEventListener('pointerdown', event => {
            if (event.target.closest('button') || event.button !== 0) return;
            const rect = panel.getBoundingClientRect();
            drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            head.setPointerCapture(event.pointerId);
            panel.classList.add('is-dragging');
        });
        head.addEventListener('pointermove', event => {
            if (!drag) return;
            TodoList.moveFloat(panel, event.clientX - drag.dx, event.clientY - drag.dy);
        });
        const endDrag = () => { if (!drag) return; drag = null; panel.classList.remove('is-dragging'); save(); };
        head.addEventListener('pointerup', endDrag);
        head.addEventListener('pointercancel', endDrag);
        // Tastatur: Pfeiltasten verschieben das Fenster (Kopfzeile fokussiert).
        head.addEventListener('keydown', event => {
            const step = event.shiftKey ? 60 : 20;
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (!moves[event.key] || event.target !== head) return;
            event.preventDefault();
            const rect = panel.getBoundingClientRect();
            TodoList.moveFloat(panel, rect.left + moves[event.key][0], rect.top + moves[event.key][1]);
            save();
        });
        panel.querySelector('[data-float-collapse]').onclick = () => { panel.classList.toggle('is-collapsed'); save(); };
        panel.querySelector('[data-float-expand]').onclick = () => TodoList.open().catch(error => UI.toast(error.message));
        panel.querySelector('[data-float-close]').onclick = () => TodoList.closeFloat();
        panel.querySelector('#todo-float-quick').onsubmit = event => { event.preventDefault(); TodoList.quickAdd(event.target.querySelector('input')); };
        panel.querySelectorAll('[data-float-kind]').forEach(btn => btn.onclick = () => { TodoList.floatKind = btn.dataset.floatKind; TodoList.renderFloat(); });
        if (window.ResizeObserver) {
            let timer = null;
            new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (!panel.classList.contains('is-collapsed') && !drag) save(); }, 300); }).observe(panel);
        }
        if (!TodoList.floatResizeBound) {
            TodoList.floatResizeBound = true;
            window.addEventListener('resize', () => { const current = q('#todo-float'); if (current) TodoList.keepInView(current); });
        }
        TodoList.renderFloat();
        TodoList.refresh(true);
    },
    closeFloat() {
        q('#todo-float')?.remove();
        store.set('todo-float', false);
    },
    moveFloat(panel, x, y) {
        const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - 48);
        panel.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
        panel.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
    },
    keepInView(panel) {
        const rect = panel.getBoundingClientRect();
        if (!panel.style.left) return;
        TodoList.moveFloat(panel, rect.left, rect.top);
    },
    renderFloat() {
        const panel = q('#todo-float');
        if (!panel) return;
        const open = TodoList.items.filter(t => !t.done);
        const overdue = open.filter(t => t.due_at && new Date(t.due_at) < new Date()).length;
        panel.querySelector('.todo-float-count').innerHTML = `<span class="todo-float-badge">${open.length}</span>${overdue ? `<span class="todo-float-badge is-overdue" title="${Utils.esc(Lang.t('todoSectionOverdue'))}">${Icon('alarm-clock', 11)}${overdue}</span>` : ''}`;
        panel.querySelectorAll('[data-float-kind]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.floatKind === TodoList.floatKind));
        TodoList.renderGrouped(panel.querySelector('.todo-float-list'), open.filter(t => TodoList.floatKind === 'all' || t.kind === TodoList.floatKind), { compact: true });
        if (window.lucide) lucide.createIcons();
    }
};
