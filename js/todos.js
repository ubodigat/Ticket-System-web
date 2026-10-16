import { q, Icon, Utils } from './utils.js';
import { Store, Notifications } from './store.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';

export const TodoList = {
    items: [], tab: 'all', showDone: false, timer: null,
    async request(path = '', method = 'GET', body) {
        const response = await fetch(`/api/v2/todos${path}`, { method, credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!response.ok) throw new Error('Aufgaben konnten nicht gespeichert oder geladen werden.');
        return response.json();
    },
    async init() {
        const user = await Store.currentUser();
        if (!['admin', 'superadmin'].includes(user?.role) || !q('.topbar-right')) return;
        const button = document.createElement('button');
        button.id = 'btn-todos'; button.className = 'btn-ghost btn-icon';
        button.title = 'Todo-Liste'; button.setAttribute('aria-label', 'Todo-Liste');
        button.innerHTML = Icon('list-todo', 18);
        button.onclick = () => TodoList.open();
        q('.topbar-right').insertBefore(button, q('#btn-notifications') || q('.topbar-right').firstChild);
        document.addEventListener('open-todos', () => TodoList.open());
    },
    async open() {
        let modal = q('#todo-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'todo-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `<div class="modal todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-heading">
                <div class="modal-header"><h3 id="todo-heading">${Icon('list-todo', 18)}Todo-Liste</h3>
                    <button class="btn-ghost btn-icon" data-close title="Schließen" aria-label="Schließen">${Icon('x', 18)}</button></div>
                <div class="modal-body">
                    <div class="todo-toolbar"><div class="todo-tabs" role="tablist" aria-label="Aufgaben">
                        <button class="tab-btn active" role="tab" data-kind="all">Alle</button>
                        <button class="tab-btn" role="tab" data-kind="ticket">Teilaufgaben</button>
                        <button class="tab-btn" role="tab" data-kind="personal">Eigene Aufgaben</button></div>
                        <button class="btn-secondary btn-icon" id="todo-show-done" title="Erledigte einblenden" aria-label="Erledigte einblenden" aria-pressed="false">${Icon('list-checks', 18)}</button>
                        <button class="btn-primary btn-icon" id="todo-add" title="Neue Aufgabe" aria-label="Neue Aufgabe">${Icon('plus', 18)}</button></div>
                    <input type="search" id="todo-search" placeholder="Aufgaben, Tickets oder Fälligkeit suchen" aria-label="Aufgaben suchen">
                    <form id="todo-form" hidden>
                        <label for="todo-content">Aufgabe</label><textarea id="todo-content" required maxlength="5000" rows="3"></textarea>
                        <div class="todo-form-grid"><div><label for="todo-due">Fälligkeit (optional)</label><input id="todo-due" type="datetime-local"></div>
                        <div><label for="todo-recipients">Zusätzlich zuweisen</label><div id="todo-recipients" class="todo-recipients"></div></div></div>
                        <div class="todo-form-actions"><button class="btn-secondary" type="button" data-cancel>Abbrechen</button><button class="btn-primary" type="submit">${Icon('plus', 16)}Hinzufügen</button></div>
                    </form><div id="todo-items" aria-live="polite"></div>
                </div></div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('[data-kind]').forEach(button => {
                button.classList.toggle('active', button.dataset.kind === TodoList.tab);
                button.setAttribute('aria-selected', String(button.dataset.kind === TodoList.tab));
            });
            modal.querySelector('[data-close]').onclick = () => { modal.classList.remove('open'); clearTimeout(TodoList.timer); };
            modal.addEventListener('keydown', e => { if (e.key === 'Escape') modal.querySelector('[data-close]').click(); });
            modal.querySelectorAll('[data-kind]').forEach(button => button.onclick = () => {
                TodoList.tab = button.dataset.kind;
                modal.querySelectorAll('[data-kind]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-selected', String(b === button)); });
                TodoList.render();
            });
            q('#todo-search').oninput = () => TodoList.render();
            q('#todo-show-done').onclick = e => {
                TodoList.showDone = !TodoList.showDone;
                e.currentTarget.setAttribute('aria-pressed', String(TodoList.showDone));
                e.currentTarget.title = TodoList.showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden';
                e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
                TodoList.render();
            };
            q('#todo-add').onclick = async () => {
                try {
                    const user = await Store.currentUser();
                    const admins = (await Store.getUserDirectory()).filter(u => ['admin', 'superadmin'].includes(u.role) && u.id !== user.id && !u.accountArchived);
                    q('#todo-recipients').innerHTML = admins.map(u => `<label class="check-row"><input type="checkbox" value="${Utils.esc(u.id)}"><span>${Utils.esc(u.name || u.username)}</span></label>`).join('');
                    q('#todo-form').hidden = false; q('#todo-content').focus();
                } catch (error) { UI.toast(error.message); }
            };
            modal.querySelector('[data-cancel]').onclick = () => { q('#todo-form').hidden = true; };
            q('#todo-form').onsubmit = async e => {
                e.preventDefault();
                const save = e.currentTarget.querySelector('[type=submit]'); save.disabled = true;
                try {
                    await TodoList.request('', 'POST', { content: q('#todo-content').value,
                        due_at: q('#todo-due').value ? new Date(q('#todo-due').value).toISOString() : null,
                        recipient_ids: [...q('#todo-recipients').querySelectorAll('input:checked')].map(c => c.value) });
                    q('#todo-form').reset(); q('#todo-form').hidden = true;
                    await TodoList.refresh(); await Notifications.refresh();
                } catch (error) { UI.toast(error.message); } finally { save.disabled = false; }
            };
        }
        modal.classList.add('open');
        await TodoList.refresh();
        q('#todo-search').focus();
    },
    async refresh() {
        clearTimeout(TodoList.timer);
        try { TodoList.items = (await TodoList.request()).todos; TodoList.render(); }
        catch (error) { UI.toast(error.message); }
        if (q('#todo-modal')?.classList.contains('open')) TodoList.timer = setTimeout(() => TodoList.refresh(), 15000);
    },
    render() {
        const query = q('#todo-search').value;
        const items = TodoList.items.filter(t => (TodoList.showDone || !t.done) &&
            (TodoList.tab === 'all' || t.kind === TodoList.tab) && Utils.matchesSearch(query, t))
            .sort((a, b) => Number(a.done) - Number(b.done) || (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
        const list = q('#todo-items'); list.replaceChildren();
        for (const item of items) {
            const row = document.createElement('div'); row.className = `todo-row${item.done ? ' is-done' : ''}`;
            const overdue = !item.done && item.due_at && new Date(item.due_at) < new Date();
            row.innerHTML = `<input type="checkbox" ${item.done ? 'checked' : ''} aria-label="Aufgabe erledigt">
                <div class="todo-copy"><div class="todo-title">${Utils.esc(item.content)}</div>
                ${item.ticket_id ? `<button class="btn-ghost todo-ticket">${Utils.esc(item.ticket_number)} · ${Utils.esc(item.ticket_title)}</button>` : '<small>Eigene Aufgabe</small>'}
                ${item.due_at ? `<time class="${overdue ? 'todo-overdue' : ''}">${Icon('calendar-clock', 13)}${Utils.esc(Utils.fmtDate(item.due_at))}</time>` : ''}</div>
                ${item.kind === 'personal' ? `<button class="btn-ghost btn-icon" data-remove title="Aus meiner Liste entfernen" aria-label="Aus meiner Liste entfernen">${Icon('trash-2', 16)}</button>` : ''}`;
            row.querySelector('input').onchange = async e => {
                e.target.disabled = true;
                try {
                    if (item.kind === 'personal') await TodoList.request(`/${item.id}`, 'PATCH', { done: e.target.checked });
                    else {
                        const res = await fetch(`/api/v2/tickets/${item.ticket_id}/todos/${item.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: e.target.checked }) });
                        if (!res.ok) throw new Error('Teilaufgabe konnte nicht gespeichert werden.');
                    }
                    await TodoList.refresh();
                } catch (error) { e.target.checked = item.done; e.target.disabled = false; UI.toast(error.message); }
            };
            if (item.ticket_id) row.querySelector('.todo-ticket').onclick = async () => { q('#todo-modal').classList.remove('open'); clearTimeout(TodoList.timer); await AdminBoard.openModal(item.ticket_id); };
            if (item.kind === 'personal') row.querySelector('[data-remove]').onclick = async () => {
                try { await TodoList.request(`/${item.id}`, 'DELETE'); await TodoList.refresh(); } catch (error) { UI.toast(error.message); }
            };
            list.appendChild(row);
        }
        if (!items.length) list.innerHTML = '<div class="empty-state">Keine Aufgaben</div>';
        if (window.lucide) lucide.createIcons();
    }
};
