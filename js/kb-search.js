/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Wissensdatenbank: Kachelansicht mit Suche/Filtern, jede Loesung in einem eigenen Popup,
// Bearbeiten in einem Editor-Popup und direkte Zuordnung einer Loesung zu einem Ticket.
// Gemeinsam genutzt von der Wissensdatenbank selbst und der Suche aus einem Ticket heraus.
import { Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { UI } from './ui.js';
import { Store } from './store.js';
import { AdminBoard } from './admin-board.js';
import { insertMarkdownTable } from './ticket-helpers.js';

const PERIOD_DAYS = { all: 0, d7: 7, d30: 30, d90: 90, y1: 365 };
const option = (value, label, selected = false) => `<option value="${Utils.esc(value)}"${selected ? ' selected' : ''}>${Utils.esc(label)}</option>`;
const plainText = html => (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
const time = value => new Date(value || 0).getTime() || 0;
const excerpt = text => text.length > 180 ? `${text.slice(0, 177).trimEnd()} …` : text;
// Ausschnitt rund um den ersten Suchtreffer statt immer des Textanfangs.
const snippet = (text, words) => {
    const lower = text.toLocaleLowerCase();
    const hit = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0];
    if (hit === undefined || hit < 120) return excerpt(text);
    const start = Math.max(0, hit - 60);
    return `… ${excerpt(text.slice(start))}`;
};
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Suchbegriffe hervorheben (Text wird vorher maskiert).
const highlight = (text, words) => {
    let html = Utils.esc(text);
    for (const word of words) html = html.replace(new RegExp(escapeRegExp(Utils.esc(word)), 'gi'), match => `<mark>${match}</mark>`);
    return html;
};
const readingMinutes = text => Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
const fileSize = bytes => !bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString(Lang.current === 'en' ? 'en-US' : 'de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
const fileIcon = name => {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg'].includes(ext) ? 'file-image' : ['xlsx', 'ods', 'csv'].includes(ext) ? 'file-spreadsheet' : ext === 'pdf' ? 'file-text' : ['txt', 'log'].includes(ext) ? 'file-type' : 'file';
};
// Werkzeugleiste des Artikel-Editors: [Befehl, Icon, Beschriftung]; '|' trennt Gruppen.
const EDITOR_TOOLS = [
    ['undo', 'undo-2', 'undo'], ['redo', 'redo-2', 'redo'], '|',
    ['h2', 'heading-2', 'heading2'], ['h3', 'heading-3', 'heading3'], ['p', 'pilcrow', 'paragraph'], '|',
    ['bold', 'bold', 'bold'], ['italic', 'italic', 'italic'], ['underline', 'underline', 'underline'], ['strikeThrough', 'strikethrough', 'strikethrough'], ['code', 'code', 'inlineCode'], '|',
    ['insertUnorderedList', 'list', 'list'], ['insertOrderedList', 'list-ordered', 'numberedList'], ['outdent', 'indent-decrease', 'outdent'], ['indent', 'indent-increase', 'indent'], '|',
    ['blockquote', 'quote', 'quote'], ['pre', 'square-code', 'codeBlock'], ['insertHorizontalRule', 'minus', 'horizontalRule'], ['table', 'table', 'insertTable'], ['link', 'link', 'insertLink'], '|',
    ['removeFormat', 'remove-formatting', 'clearFormatting']
];
const relative = ms => {
    if (!ms) return '–';
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days < 1) return Lang.t('kbToday');
    if (days === 1) return Lang.t('kbYesterday');
    if (days < 30) return Lang.format('kbDaysAgo', { count: days });
    return Utils.fmtDateOnly(ms);
};

export const KbSearch = {
    // Leserecht wie serverseitig: Superadmin immer, Admin mit Lese- oder Schreibrecht.
    access: async () => {
        const user = await Store.currentUser();
        const canEdit = user?.role === 'superadmin' || (user?.role === 'admin' && user?.permissions?.kb === 'edit');
        const canRead = canEdit || (user?.role === 'admin' && user?.permissions?.kb === 'read');
        return { canRead, canEdit };
    },

    filtersMarkup: prefix => `
        <div class="kb-filters">
            <div class="kb-search-row kb-search-hero">
                <span class="kb-search-icon">${Icon('search', 18)}</span>
                <input type="search" id="${prefix}-q" class="section-search" placeholder="${Utils.esc(Lang.t('kbSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('kbSearchPlaceholder'))}">
            </div>
            <div class="kb-filter-row">
                <select id="${prefix}-category" class="kb-hidden-select" aria-label="${Utils.esc(Lang.t('kbFilterCategory'))}"></select>
                <label><span>${Utils.esc(Lang.t('kbFilterCreator'))}</span><select id="${prefix}-creator"></select></label>
                <label><span>${Utils.esc(Lang.t('kbFilterPeriod'))}</span><select id="${prefix}-period">
                    ${option('all', Lang.t('kbPeriodAll'))}${option('d7', Lang.t('kbPeriod7'))}${option('d30', Lang.t('kbPeriod30'))}${option('d90', Lang.t('kbPeriod90'))}${option('y1', Lang.t('kbPeriod365'))}
                </select></label>
                <label><span>${Utils.esc(Lang.t('kbFilterSort'))}</span><select id="${prefix}-sort">
                    ${option('updated', Lang.t('kbSortUpdated'))}${option('newest', Lang.t('kbSortNewest'))}${option('oldest', Lang.t('kbSortOldest'))}${option('title', Lang.t('kbSortTitle'))}${option('linked', Lang.t('kbSortLinked'))}
                </select></label>
                <div class="kb-view-toggle" role="group" aria-label="${Utils.esc(Lang.t('kbViewLabel'))}">
                    <button type="button" class="btn-ghost btn-icon btn-sm" data-view="grid" title="${Utils.esc(Lang.t('kbViewGrid'))}" aria-label="${Utils.esc(Lang.t('kbViewGrid'))}">${Icon('layout-grid', 16)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-sm" data-view="list" title="${Utils.esc(Lang.t('kbViewList'))}" aria-label="${Utils.esc(Lang.t('kbViewList'))}">${Icon('list', 16)}</button>
                </div>
                <button type="button" class="btn-ghost btn-sm" id="${prefix}-reset">${Icon('rotate-ccw', 14)}${Utils.esc(Lang.t('kbFilterReset'))}</button>
            </div>
            <div class="hint kb-result-count" id="${prefix}-count" role="status"></div>
        </div>`,

    // Verdrahtet Filter, Kategorienleiste, Kennzahlen und Artikelliste innerhalb von root. ticket:
    // Ticket, dem Loesungen direkt zugeordnet werden koennen (Suche aus einem Ticket heraus).
    bind: (root, prefix, { list, canEdit = false, ticket = null, categoryNav = null, stats = null } = {}) => {
        let articles = [];
        let categories = [];
        let view = 'grid';
        try { view = localStorage.getItem('kb-view') === 'list' ? 'list' : 'grid'; } catch { view = 'grid'; }
        const el = id => root.querySelector(`#${prefix}-${id}`);
        const words = () => el('q').value.trim().toLocaleLowerCase().split(/\s+/).filter(word => word.length > 1);
        const fillSelects = () => {
            const keepCategory = el('category').value;
            const keepCreator = el('creator').value;
            el('category').innerHTML = option('', Lang.t('kbAllCategories')) + option('__none__', Lang.t('kbNoCategory'))
                + categories.map(c => option(c.name, c.name)).join('');
            const creators = [...new Map(articles.filter(a => a.createdByUserId).map(a => [a.createdByUserId, a.createdByName || '–'])).entries()]
                .sort((a, b) => a[1].localeCompare(b[1], Lang.current));
            el('creator').innerHTML = option('', Lang.t('kbAllCreators')) + creators.map(([id, name]) => option(id, name)).join('');
            if ([...el('category').options].some(o => o.value === keepCategory)) el('category').value = keepCategory;
            if ([...el('creator').options].some(o => o.value === keepCreator)) el('creator').value = keepCreator;
        };
        // Kategorienleiste mit Anzahl je Kategorie; leere Kategorien erscheinen gedimmt am Ende.
        const renderCategoryNav = () => {
            if (!categoryNav) return;
            const active = el('category').value;
            const count = name => articles.filter(a => name === '__none__' ? !a.category : a.category === name).length;
            const names = [...new Set([...categories.map(c => c.name), ...articles.map(a => a.category).filter(Boolean)])]
                .sort((a, b) => (count(b) > 0) - (count(a) > 0) || a.localeCompare(b, Lang.current));
            const entry = (value, label, n, icon) => `<button type="button" class="kb-cat${active === value ? ' is-active' : ''}${n ? '' : ' is-empty'}" data-category="${Utils.esc(value)}">${Icon(icon, 15)}<span>${Utils.esc(label)}</span><span class="kb-cat-count">${n}</span></button>`;
            categoryNav.innerHTML = entry('', Lang.t('kbAllCategories'), articles.length, 'library')
                + names.map(name => entry(name, name, count(name), 'folder')).join('')
                + (count('__none__') ? entry('__none__', Lang.t('kbNoCategory'), count('__none__'), 'folder-x') : '');
            categoryNav.querySelectorAll('.kb-cat').forEach(btn => btn.onclick = () => { el('category').value = btn.dataset.category; render(); });
        };
        const renderStats = () => {
            if (!stats) return;
            const recent = articles.filter(a => time(a.createdAt) >= Date.now() - 30 * 86400000).length;
            const linked = articles.filter(a => a.linkedTicketCount > 0).length;
            const latest = articles.reduce((max, a) => Math.max(max, time(a.updatedAt || a.createdAt)), 0);
            const stat = (icon, label, value) => `<div class="kb-stat">${Icon(icon, 16)}<div><dt>${Utils.esc(label)}</dt><dd>${Utils.esc(String(value))}</dd></div></div>`;
            stats.innerHTML = stat('book-open', Lang.t('kbStatArticles'), articles.length)
                + stat('folder', Lang.t('kbStatCategories'), new Set(articles.map(a => a.category).filter(Boolean)).size)
                + stat('ticket', Lang.t('kbStatLinked'), linked)
                + stat('sparkles', Lang.t('kbStatNew'), recent)
                + stat('history', Lang.t('kbStatLatest'), latest ? relative(latest) : '–');
        };
        const filtered = () => {
            const query = words();
            const category = el('category').value;
            const creator = el('creator').value;
            const days = PERIOD_DAYS[el('period').value] || 0;
            const since = days ? Date.now() - days * 86400000 : 0;
            const sorters = {
                updated: (a, b) => time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt),
                newest: (a, b) => time(b.createdAt) - time(a.createdAt),
                oldest: (a, b) => time(a.createdAt) - time(b.createdAt),
                title: (a, b) => a.title.localeCompare(b.title, Lang.current),
                linked: (a, b) => b.linkedTicketCount - a.linkedTicketCount || time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt)
            };
            // Bei einer Suche zuerst Treffer im Titel.
            const score = a => query.reduce((sum, word) => sum + (a.title.toLocaleLowerCase().includes(word) ? 2 : 0), 0);
            return articles.filter(a => (!query.length || query.every(word => a.searchText.includes(word)))
                && (!category || (category === '__none__' ? !a.category : a.category === category))
                && (!creator || a.createdByUserId === creator)
                && (!since || time(a.createdAt) >= since))
                .sort((a, b) => (query.length ? score(b) - score(a) : 0) || (sorters[el('sort').value] || sorters.updated)(a, b));
        };
        const render = () => {
            const items = filtered();
            const query = words();
            el('count').textContent = Lang.format('kbResultCount', { count: items.length, total: articles.length });
            root.querySelectorAll('.kb-view-toggle [data-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === view));
            renderCategoryNav();
            list.className = view === 'list' ? 'kb-list-view' : 'kb-grid';
            const badges = a => {
                const created = time(a.createdAt); const updated = time(a.updatedAt);
                const out = [];
                if (created >= Date.now() - 14 * 86400000) out.push(`<span class="kb-badge is-new">${Utils.esc(Lang.t('kbBadgeNew'))}</span>`);
                else if (updated && updated - created > 60000 && updated >= Date.now() - 14 * 86400000) out.push(`<span class="kb-badge is-updated">${Utils.esc(Lang.t('kbBadgeUpdated'))}</span>`);
                return out.join('');
            };
            list.innerHTML = items.length ? items.map(a => `
                <button type="button" class="kb-tile" data-id="${Utils.esc(a.id)}">
                    <span class="kb-tile-head">
                        <span class="kb-tile-icon">${Icon('lightbulb', 18)}</span>
                        <span class="kb-tile-tags">${badges(a)}${a.category ? `<span class="t-category">${Utils.esc(a.category)}</span>` : `<span class="kb-tile-nocat">${Utils.esc(Lang.t('kbNoCategory'))}</span>`}</span>
                    </span>
                    <strong class="kb-tile-title">${highlight(a.title, query)}</strong>
                    <span class="kb-tile-excerpt">${highlight(snippet(a.plain, query), query)}</span>
                    <span class="kb-tile-meta">
                        <span title="${Utils.esc(Lang.t('kbCreatedBy'))}">${Icon('user-round', 13)}${Utils.esc(a.createdByName || '–')}</span>
                        <span title="${Utils.esc(Lang.format('kbUpdatedOn', { date: Utils.fmtDate(a.updatedAt || a.createdAt) }))}">${Icon('history', 13)}${Utils.esc(relative(time(a.updatedAt || a.createdAt)))}</span>
                        <span title="${Utils.esc(Lang.t('kbReadingTime'))}">${Icon('clock', 13)}${Utils.esc(Lang.format('kbMinutes', { count: readingMinutes(a.plain) }))}</span>
                        ${a.linkedTicketCount ? `<span title="${Utils.esc(Lang.t('kbLinkedTickets'))}">${Icon('ticket', 13)}${a.linkedTicketCount}</span>` : ''}
                    </span>
                </button>`).join('') : `<div class="empty-state compact kb-empty">${Icon('search-x', 22)}<strong>${Utils.esc(Lang.t('noArticlesFound'))}</strong><span>${Utils.esc(Lang.t('kbNoResultsHint'))}</span></div>`;
            list.querySelectorAll('.kb-tile').forEach(tile => tile.onclick = () => {
                const article = articles.find(a => a.id === tile.dataset.id);
                if (article) KbSearch.openArticle(article, { canEdit, ticket, categories, onChange: refresh });
            });
            if (window.lucide) lucide.createIcons();
        };
        const refresh = async () => {
            const [loadedArticles, loadedCategories] = await Promise.all([Store.getKbArticles(), Store.getKbCategories()]);
            categories = loadedCategories;
            articles = loadedArticles.map(a => {
                const plain = plainText(a.body);
                return { ...a, plain, searchText: `${a.title} ${plain} ${a.category || ''} ${a.createdByName || ''}`.toLocaleLowerCase() };
            });
            fillSelects();
            renderStats();
            render();
        };
        el('q').oninput = render;
        ['category', 'creator', 'period', 'sort'].forEach(id => { el(id).onchange = render; });
        root.querySelectorAll('.kb-view-toggle [data-view]').forEach(btn => btn.onclick = () => {
            view = btn.dataset.view;
            try { localStorage.setItem('kb-view', view); } catch { /* nur Komfort */ }
            render();
        });
        el('reset').onclick = () => {
            el('q').value = ''; el('category').value = ''; el('creator').value = ''; el('period').value = 'all'; el('sort').value = 'updated';
            render();
            el('q').focus();
        };
        return { refresh, getCategories: () => categories };
    },

    // Einzelne Loesung im eigenen Popup: Inhalt, Anhaenge, zugeordnete Tickets und Aktionen.
    openArticle: async (article, { canEdit = false, ticket = null, categories = [], onChange = null } = {}) => {
        const modal = AdminBoard.openDialog({
            id: 'kb-article-modal',
            title: article.title,
            icon: 'lightbulb',
            size: 'xl',
            headerButtons: canEdit ? [
                { id: 'kba-edit', icon: 'pencil', title: Lang.t('edit') },
                { id: 'kba-delete', icon: 'trash-2', title: Lang.t('delete') }
            ] : [],
            body: `
                <div class="kb-article-view">
                    <article class="kb-article-main">
                        <div class="kb-article-meta-bar">
                            <span id="kba-category-chip">${article.category ? `<span class="t-category">${Utils.esc(article.category)}</span>` : `<span class="kb-tile-nocat">${Utils.esc(Lang.t('kbNoCategory'))}</span>`}</span>
                            <span class="hint">${Icon('history', 13)} ${Utils.esc(Lang.format('kbUpdatedOn', { date: Utils.fmtDate(article.updatedAt || article.createdAt) }))}</span>
                            <span class="hint">${Icon('clock', 13)} ${Utils.esc(Lang.format('kbReadingTimeValue', { count: readingMinutes(plainText(article.body)) }))}</span>
                        </div>
                        <div class="desc-text rich-content kb-article-body">${Utils.sanitizeRichHtml(article.body)}</div>
                    </article>
                    <section class="kb-info-bar" aria-labelledby="kba-info-title">
                        <div class="kb-section-head">
                            <h4 class="section-title" id="kba-info-title">${Icon('info', 14)}${Utils.esc(Lang.t('kbArticleInfo'))}</h4>
                            ${ticket
                                ? `<button type="button" class="btn-primary btn-sm" id="kba-link-current">${Icon('link', 15)}${Utils.esc(Lang.format('kbLinkToThisTicket', { number: ticket.ticketNumber || '' }))}</button>`
                                : `<button type="button" class="btn-secondary btn-sm" id="kba-link-pick">${Icon('link', 15)}${Utils.esc(Lang.t('kbLinkToTicket'))}</button>`}
                        </div>
                        <dl class="kb-info-grid">
                            <div><dt>${Icon('user-round', 13)}${Utils.esc(Lang.t('kbCreatedBy'))}</dt><dd>${Utils.esc(article.createdByName || '–')}</dd></div>
                            <div><dt>${Icon('calendar-plus', 13)}${Utils.esc(Lang.t('kbCreatedAt'))}</dt><dd>${Utils.esc(Utils.fmtDate(article.createdAt))}</dd></div>
                            <div><dt>${Icon('history', 13)}${Utils.esc(Lang.t('kbUpdatedAt'))}</dt><dd>${Utils.esc(Utils.fmtDate(article.updatedAt || article.createdAt))}</dd></div>
                            <div><dt>${Icon('ticket', 13)}${Utils.esc(Lang.t('kbLinkedTickets'))}</dt><dd id="kba-ticket-count">${article.linkedTicketCount || 0}</dd></div>
                            <div class="kb-info-category"><dt>${Icon('folder', 13)}${Utils.esc(Lang.t('kbFilterCategory'))}</dt><dd>${canEdit ? '<div id="kba-category"></div>' : Utils.esc(article.category || Lang.t('kbNoCategory'))}</dd></div>
                        </dl>
                    </section>
                    <section class="kb-article-section" id="kba-attachments-box" hidden>
                        <div class="kb-section-head">
                            <h4 class="section-title">${Icon('paperclip', 14)}${Utils.esc(Lang.t('attachments'))}<span class="kb-section-count" id="kba-attachment-count"></span></h4>
                            ${canEdit ? `<label class="btn btn-secondary btn-sm" id="kba-add-files" tabindex="0">${Icon('upload', 15)}${Utils.esc(Lang.t('kbAddAttachments'))}<input type="file" id="kba-file" hidden multiple></label>` : ''}
                        </div>
                        <div class="kb-attachment-grid" id="kba-attachments"></div>
                        ${canEdit ? `<p class="hint kb-drop-hint">${Icon('upload-cloud', 13)} ${Utils.esc(Lang.t('kbDropHint'))}</p>` : ''}
                    </section>
                    <section class="kb-article-section">
                        <div class="kb-section-head">
                            <h4 class="section-title">${Icon('ticket', 14)}${Utils.esc(Lang.t('kbLinkedTickets'))}<span class="kb-section-count" id="kba-ticket-count-head"></span></h4>
                        </div>
                        <div class="kb-ticket-list" id="kba-tickets"><span class="hint">${Utils.esc(Lang.t('kbLoading'))}</span></div>
                    </section>
                </div>`
        });
        const renderTickets = async () => {
            const box = modal.querySelector('#kba-tickets');
            const tickets = await Store.getKbArticleTickets(article.id);
            modal.querySelector('#kba-ticket-count').textContent = String(tickets.length);
            modal.querySelector('#kba-ticket-count-head').textContent = tickets.length ? String(tickets.length) : '';
            box.innerHTML = tickets.length ? tickets.map(t => `
                <div class="kb-ticket-row" data-id="${Utils.esc(t.id)}">
                    <button type="button" class="kb-ticket-open">
                        <strong>${Utils.esc(t.ticketNumber)}</strong>
                        <span class="kb-ticket-title">${Utils.esc(t.title || '–')}</span>
                        <span class="status-badge">${t.archived ? Utils.esc(Lang.t('archivedState')) : Utils.esc(Lang.status(t.status))}</span>
                    </button>
                    ${canEdit && !t.archived ? `<button type="button" class="btn-ghost btn-icon btn-xs btn-danger kb-ticket-unlink" title="${Utils.esc(Lang.t('kbUnlinkTicket'))}" aria-label="${Utils.esc(Lang.t('kbUnlinkTicket'))}">${Icon('link-2-off', 14)}</button>` : ''}
                </div>`).join('')
                : `<div class="empty-state compact">${Icon('ticket', 18)}<span>${Utils.esc(Lang.t('kbNoLinkedTickets'))}</span></div>`;
            box.querySelectorAll('.kb-ticket-open').forEach(btn => btn.onclick = () => { modal.remove(); AdminBoard.openModal(btn.closest('[data-id]').dataset.id); });
            box.querySelectorAll('.kb-ticket-unlink').forEach(btn => btn.onclick = () => {
                const ticketId = btn.closest('[data-id]').dataset.id;
                UI.confirm(Lang.t('kbConfirmUnlinkTicket'), async () => {
                    if (!(await Store.unlinkKbArticle(ticketId, article.id))) return UI.toast(Lang.t('saveFailed'));
                    await renderTickets();
                    if (AdminBoard.currentTicketId === ticketId) AdminBoard.renderKbLinks(ticketId);
                    if (onChange) onChange();
                });
            });
            if (window.lucide) lucide.createIcons();
        };
        const link = async (target) => {
            const result = await Store.linkKbArticle(target.id, article.id);
            if (!result.ok) return UI.toast(Lang.t(result.error === 'ticket_archived' ? 'kbLinkArchived' : 'saveFailed'));
            UI.toast(Lang.format(result.already ? 'kbAlreadyLinked' : 'kbLinkedToast', { number: target.ticketNumber || '' }));
            await renderTickets();
            if (AdminBoard.currentTicketId === target.id) AdminBoard.renderKbLinks(target.id);
            if (onChange) onChange();
        };
        const current = modal.querySelector('#kba-link-current');
        if (current) current.onclick = () => link(ticket);
        const pick = modal.querySelector('#kba-link-pick');
        if (pick) pick.onclick = async () => { const target = await KbSearch.pickTicket(); if (target) await link(target); };
        if (canEdit) {
            modal.querySelector('#kba-edit').onclick = () => { modal.remove(); KbSearch.openEditor({ article, categories, onSaved: onChange }); };
            modal.querySelector('#kba-delete').onclick = () => UI.confirm(Lang.t('kbConfirmDeleteArticle'), async () => {
                if (!(await Store.deleteKbArticle(article.id))) return UI.toast(Lang.t('saveFailed'));
                modal.remove();
                if (onChange) onChange();
            });
            // Kategorie direkt hier aendern -- Auswahl mit Suche.
            const names = [...new Set([...categories.map(c => c.name), ...(article.category ? [article.category] : [])])];
            UI.createMultiSelect(modal.querySelector('#kba-category'), names.map(name => ({ value: name, label: name })), article.category || '', async value => {
                if (!(await Store.updateKbArticle(article.id, { category: value || null }))) return UI.toast(Lang.t('saveFailed'));
                article.category = value || null;
                modal.querySelector('#kba-category-chip').innerHTML = article.category ? `<span class="t-category">${Utils.esc(article.category)}</span>` : `<span class="kb-tile-nocat">${Utils.esc(Lang.t('kbNoCategory'))}</span>`;
                UI.toast(Lang.t('kbCategorySaved'));
                if (onChange) onChange();
            }, { single: true, emptyLabel: Lang.t('kbNoCategory') });
        }
        const renderAttachments = async () => {
            const attachments = await Store.getKbArticleAttachments(article.id);
            const box = modal.querySelector('#kba-attachments');
            modal.querySelector('#kba-attachments-box').hidden = !attachments.length && !canEdit;
            modal.querySelector('#kba-attachment-count').textContent = attachments.length ? String(attachments.length) : '';
            box.innerHTML = attachments.length
                ? attachments.map(file => `<div class="kb-attachment" data-id="${Utils.esc(file.id)}">
                    <button type="button" class="kb-attachment-open" title="${Utils.esc(Lang.t('showPreview'))}">${Icon(fileIcon(file.name), 20)}<span><strong>${Utils.esc(file.name)}</strong><small>${Utils.esc(fileSize(file.size))}</small></span></button>
                    ${canEdit ? `<button type="button" class="btn-ghost btn-icon btn-xs btn-danger kb-attachment-delete" title="${Utils.esc(Lang.t('removeFile'))}" aria-label="${Utils.esc(Lang.format('removeFileAriaLabel', { name: file.name }))}">${Icon('trash-2', 14)}</button>` : ''}
                </div>`).join('')
                : `<div class="empty-state compact">${Icon('paperclip', 18)}<span>${Utils.esc(Lang.t('kbNoAttachments'))}</span></div>`;
            box.querySelectorAll('.kb-attachment-open').forEach(btn => btn.onclick = async () => {
                const full = await Store.getKbAttachment(btn.closest('[data-id]').dataset.id);
                if (!full) return UI.toast(Lang.t('saveFailed'));
                // Kleine Dateien ohne ID: die Server-Vorschau gilt nur fuer Ticket-Anhaenge.
                const { id, ...local } = full;
                AdminBoard.openAttachmentPreview(full.size > 15 * 1024 * 1024 ? full : local);
            });
            box.querySelectorAll('.kb-attachment-delete').forEach(btn => btn.onclick = () => UI.confirm(Lang.t('kbConfirmDeleteAttachment'), async () => {
                if (!(await Store.deleteKbAttachment(btn.closest('[data-id]').dataset.id))) return UI.toast(Lang.t('saveFailed'));
                await renderAttachments();
                if (onChange) onChange();
            }));
            if (window.lucide) lucide.createIcons();
        };
        const uploadToArticle = async (list) => {
            const chosen = Array.from(list || []);
            if (!chosen.length) return;
            const box = modal.querySelector('#kba-attachments');
            box.insertAdjacentHTML('beforeend', `<div class="kb-attachment is-uploading">${Icon('loader-circle', 18)}<span>${Utils.esc(Lang.format('kbUploading', { count: chosen.length }))}</span></div>`);
            if (window.lucide) lucide.createIcons();
            const { saved, errors } = await Store.uploadFiles(chosen, file => Store.saveKbAttachment(article.id, file));
            if (errors.length) UI.toast(errors.join(' '));
            else UI.toast(Lang.format('kbAttachmentsAdded', { count: saved.length }));
            await renderAttachments();
            if (onChange) onChange();
        };
        const fileInput = modal.querySelector('#kba-file');
        if (fileInput) {
            fileInput.accept = Store.uploadAccept();
            fileInput.onchange = async () => { const list = Array.from(fileInput.files || []); fileInput.value = ''; await uploadToArticle(list); };
            modal.querySelector('#kba-add-files').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } };
            UI.bindFileDrop(modal.querySelector('#kba-attachments-box'), uploadToArticle);
        }
        await renderAttachments();
        await renderTickets();
    },

    // Auswahl eines offenen Tickets (Nummer oder Titel), dem eine Loesung zugeordnet werden soll.
    pickTicket: () => new Promise(async resolve => {
        const tickets = (await Store.getTickets()).filter(t => !t.archived);
        let settled = false;
        const finish = value => { if (settled) return; settled = true; modal.remove(); resolve(value); };
        const modal = AdminBoard.openDialog({
            id: 'kb-ticket-picker',
            title: Lang.t('kbLinkToTicket'),
            icon: 'link',
            size: 'sm',
            body: `<input type="search" id="kbp-q" class="section-search" placeholder="${Utils.esc(Lang.t('kbTicketSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('kbTicketSearchPlaceholder'))}">
                   <div id="kbp-list" class="kb-ticket-pick-list"></div>`
        });
        modal.querySelector('[data-dialog-close]').onclick = () => finish(null);
        modal.onclick = event => { if (event.target === modal) finish(null); };
        const render = () => {
            const term = modal.querySelector('#kbp-q').value.trim().toLocaleLowerCase();
            const hits = tickets.filter(t => !term || `${t.ticketNumber} ${t.title}`.toLocaleLowerCase().includes(term)).slice(0, 50);
            const list = modal.querySelector('#kbp-list');
            list.innerHTML = hits.length ? hits.map(t => `<button type="button" class="kb-ticket-pick" data-id="${Utils.esc(t.id)}"><strong>${Utils.esc(t.ticketNumber)}</strong><span>${Utils.esc(t.title)}</span></button>`).join('')
                : `<div class="empty-state compact">${Utils.esc(Lang.t('noTickets'))}</div>`;
            list.querySelectorAll('.kb-ticket-pick').forEach(btn => btn.onclick = () => finish(tickets.find(t => t.id === btn.dataset.id)));
        };
        modal.querySelector('#kbp-q').oninput = render;
        render();
        modal.querySelector('#kbp-q').focus();
    }),

    // Mehrere Loesungen mit Suche auswaehlen und gemeinsam einem Ticket zuordnen.
    pickArticles: async ({ ticket, linkedIds = [], onDone = null }) => {
        const [articles, categories] = await Promise.all([Store.getKbArticles(), Store.getKbCategories()]);
        const linked = new Set(linkedIds);
        const chosen = new Set();
        const modal = AdminBoard.openDialog({
            id: 'kb-article-picker',
            title: Lang.t('kbPickSolutions'),
            icon: 'book-open-check',
            size: 'md',
            body: `<p class="hint">${Utils.esc(Lang.t('kbPickHint'))}</p>
                <div class="kb-pick-filters">
                    <input type="search" id="kbm-q" class="section-search" placeholder="${Utils.esc(Lang.t('kbPickSearch'))}" aria-label="${Utils.esc(Lang.t('kbPickSearch'))}">
                    <select id="kbm-category" aria-label="${Utils.esc(Lang.t('kbFilterCategory'))}">${option('', Lang.t('kbFilterCategory'))}${categories.map(c => option(c.name, c.name)).join('')}</select>
                </div>
                <div id="kbm-list" class="kb-article-pick-list"></div>
                <div class="modal-footer modal-footer-visible">
                    <button type="button" class="btn-secondary" id="kbm-cancel">${Utils.esc(Lang.t('cancel'))}</button>
                    <button type="button" class="btn-primary" id="kbm-confirm" disabled></button>
                </div>`
        });
        const confirm = modal.querySelector('#kbm-confirm');
        const updateConfirm = () => {
            confirm.disabled = !chosen.size;
            confirm.innerHTML = `${Icon('link', 15)}${Utils.esc(Lang.format('kbPickConfirm', { count: chosen.size }))}`;
            if (window.lucide) lucide.createIcons();
        };
        const render = () => {
            const term = modal.querySelector('#kbm-q').value.trim().toLocaleLowerCase();
            const category = modal.querySelector('#kbm-category').value;
            const hits = articles.filter(a => (!category || a.category === category)
                && (!term || `${a.title} ${a.category || ''} ${plainText(a.body)}`.toLocaleLowerCase().includes(term))).slice(0, 100);
            const list = modal.querySelector('#kbm-list');
            list.innerHTML = hits.length ? hits.map(a => {
                const isLinked = linked.has(a.id);
                return `<label class="check-row kb-article-pick${isLinked ? ' is-linked' : ''}">
                    <input type="checkbox" value="${Utils.esc(a.id)}"${isLinked ? ' checked disabled' : chosen.has(a.id) ? ' checked' : ''}>
                    <span class="check-text"><strong>${Utils.esc(a.title)}</strong><span>${Utils.esc(a.category || Lang.t('kbNoCategory'))}${isLinked ? ` · ${Utils.esc(Lang.t('kbPickAlreadyLinked'))}` : ''}</span></span>
                </label>`;
            }).join('') : `<div class="empty-state compact">${Utils.esc(Lang.t('kbPickNone'))}</div>`;
            list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(box => box.onchange = () => {
                if (box.checked) chosen.add(box.value); else chosen.delete(box.value);
                updateConfirm();
            });
        };
        modal.querySelector('#kbm-q').oninput = render;
        modal.querySelector('#kbm-category').onchange = render;
        modal.querySelector('#kbm-cancel').onclick = () => modal.remove();
        confirm.onclick = async () => {
            confirm.disabled = true;
            let count = 0; let failed = false;
            for (const articleId of chosen) {
                const result = await Store.linkKbArticle(ticket.id, articleId);
                if (result.ok) count++;
                else { failed = true; if (result.error === 'ticket_archived') break; }
            }
            modal.remove();
            UI.toast(failed ? `${Lang.format('kbPickedToast', { count })} ${Lang.t('saveFailed')}` : Lang.format('kbPickedToast', { count }));
            if (onDone) await onDone();
        };
        updateConfirm();
        render();
        modal.querySelector('#kbm-q').focus();
    },

    // Artikel anlegen oder bearbeiten -- eigenes Popup mit Formatierung und Anhaengen.
    // draft: Vorbefuellung fuer einen neuen Artikel (z.B. aus der Loesungsdokumentation eines
    // Tickets, sourceTicketId ordnet den Artikel diesem Ticket nach dem Speichern zu).
    openEditor: async ({ article = null, categories = null, onSaved = null, draft = null, sourceTicketId = null } = {}) => {
        const allCategories = categories || await Store.getKbCategories();
        const initialCategory = article ? article.category : draft?.category || null;
        const files = [];
        const modal = AdminBoard.openDialog({
            id: 'kb-editor-modal',
            title: article ? Lang.t('kbEditArticle') : Lang.t('newArticle'),
            icon: article ? 'pencil' : 'file-plus-2',
            size: 'lg',
            body: `
                <div class="kb-editor-form">
                    ${draft ? `<p class="hint">${Utils.esc(Lang.t('kbDraftFromTicketHint'))}</p>` : ''}
                    <div class="field"><label for="kbe-title">${Lang.t('titleLabel')}</label><input id="kbe-title" type="text" maxlength="500" value="${Utils.esc(article?.title || draft?.title || '')}"></div>
                    <div class="field"><label for="kbe-category">${Utils.esc(Lang.t('kbFilterCategory'))}</label>
                        <select id="kbe-category">${option('', Lang.t('kbNoCategory'), !initialCategory)}${allCategories.map(c => option(c.name, c.name, c.name === initialCategory)).join('')}</select></div>
                    <div class="field">
                        <label for="kbe-body">${Lang.t('content')}</label>
                        <div class="note-toolbar kb-editor-toolbar" role="toolbar" aria-label="${Utils.esc(Lang.t('formattingToggle'))}">
                            ${EDITOR_TOOLS.map(tool => tool === '|' ? '<span class="toolbar-sep" aria-hidden="true"></span>'
                                : `<button type="button" class="btn-ghost btn-icon btn-sm" data-tool="${tool[0]}" title="${Utils.esc(Lang.t(tool[2]))}" aria-label="${Utils.esc(Lang.t(tool[2]))}">${Icon(tool[1], 15)}</button>`).join('')}
                            <span class="toolbar-sep" aria-hidden="true"></span>
                            <label class="btn btn-ghost btn-icon btn-sm" title="${Lang.t('addAttachment')}" aria-label="${Lang.t('addAttachment')}">${Icon('paperclip', 15)}<input type="file" id="kbe-file" hidden multiple accept="${Utils.esc(Store.uploadAccept())}"></label>
                        </div>
                        <div id="kbe-body" class="rich-editor kb-rich-editor" contenteditable="true" data-placeholder="${Lang.t('richEditorPlaceholder')}">${article ? Utils.sanitizeRichHtml(article.body) : draft ? Utils.sanitizeRichHtml(draft.body || '') : ''}</div>
                        <div id="kbe-existing" class="file-preview"></div>
                        <div id="kbe-files" class="file-preview"></div>
                    </div>
                </div>`,
            onSave: async m => {
                const title = m.querySelector('#kbe-title').value.trim();
                const bodyEl = m.querySelector('#kbe-body');
                if (!title || !bodyEl.textContent.trim()) return UI.toast(Lang.t('enterTitleAndContent'));
                const body = Utils.sanitizeRichHtml(bodyEl.innerHTML);
                const category = m.querySelector('#kbe-category').value || null;
                let articleId = article?.id || null;
                if (article) {
                    if (!(await Store.updateKbArticle(article.id, { title, content: body, category }))) return UI.toast(Lang.t('saveFailed'));
                } else {
                    articleId = await Store.createKbArticle(title, body, sourceTicketId || undefined, category);
                    if (!articleId) return UI.toast(Lang.t('saveFailed'));
                    if (sourceTicketId) await Store.linkKbArticle(sourceTicketId, articleId);
                }
                // Nacheinander hochladen; eine Fehlermeldung ersetzt die Erfolgsmeldung statt von ihr
                // sofort ueberdeckt zu werden.
                const { errors } = await Store.uploadFiles(files, file => Store.saveKbAttachment(articleId, file));
                m.remove();
                UI.toast(errors.length ? Lang.format('articleSavedAttachmentsFailed', { details: errors.join(' ') }) : Lang.t('articleSavedToast'));
                if (onSaved) await onSaved();
            }
        });
        const bodyInput = modal.querySelector('#kbe-body');
        // Klicks auf die Werkzeugleiste duerfen die Auswahl im Editor nicht aufheben.
        modal.querySelectorAll('.note-toolbar button').forEach(btn => { btn.onmousedown = e => e.preventDefault(); });
        const insertLink = async () => {
            const sel = window.getSelection();
            const savedRange = (sel && sel.rangeCount && bodyInput.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : null;
            const selectedText = savedRange ? savedRange.toString() : '';
            const href = await UI.promptText({ title: Lang.t('insertLink'), label: Lang.t('linkAddress'), value: '', placeholder: Lang.t('linkPlaceholderExample'), saveLabel: Lang.t('insertLink') });
            if (!href || !href.trim()) return;
            if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) return UI.toast(Lang.t('onlyHttpMailtoLinksAllowed'));
            bodyInput.focus();
            const selection = window.getSelection();
            selection.removeAllRanges();
            if (savedRange) selection.addRange(savedRange);
            if (selectedText) document.execCommand('createLink', false, href.trim());
            else document.execCommand('insertHTML', false, `<a href="${Utils.esc(href.trim())}" target="_blank" rel="noopener noreferrer">${Utils.esc(href.trim())}</a>`);
        };
        // Bloecke ueber formatBlock (Ueberschrift, Absatz, Zitat, Codeblock), Inline-Code als <code>.
        const blocks = { h2: '<h2>', h3: '<h3>', p: '<p>', blockquote: '<blockquote>', pre: '<pre>' };
        modal.querySelectorAll('[data-tool]').forEach(btn => btn.onclick = () => {
            const tool = btn.dataset.tool;
            bodyInput.focus();
            if (tool === 'table') return insertMarkdownTable(bodyInput);
            if (tool === 'link') return insertLink();
            if (blocks[tool]) return document.execCommand('formatBlock', false, blocks[tool]);
            if (tool === 'code') {
                const text = window.getSelection()?.toString() || '';
                return document.execCommand('insertHTML', false, `<code>${Utils.esc(text || Lang.t('inlineCode'))}</code>&nbsp;`);
            }
            if (tool === 'removeFormat') { document.execCommand('removeFormat'); return document.execCommand('formatBlock', false, '<p>'); }
            document.execCommand(tool);
        });
        const renderFiles = () => {
            const preview = modal.querySelector('#kbe-files');
            preview.replaceChildren(...files.map((file, index) => AdminBoard.stagedFileChip(file, () => { files.splice(index, 1); renderFiles(); })));
            if (window.lucide) lucide.createIcons();
        };
        // Unpassende Dateien sofort mit Grund ablehnen (Typ, Groesse), statt erst beim Speichern.
        const addFiles = list => {
            const errors = [];
            list.forEach(file => { try { Store.assertUploadAllowed(file); files.push(file); } catch (error) { errors.push(Store.uploadErrorMessage(error)); } });
            if (errors.length) UI.toast(errors.join(' '));
            renderFiles();
        };
        modal.querySelector('#kbe-file').onchange = event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; };
        UI.bindFileDrop(modal.querySelector('.kb-editor-form'), addFiles);
        UI.bindPasteFiles(bodyInput, addFiles);
        if (article) {
            const existing = await Store.getKbArticleAttachments(article.id);
            const box = modal.querySelector('#kbe-existing');
            box.innerHTML = existing.map(file => `<div class="file-chip">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" data-id="${Utils.esc(file.id)}" title="${Lang.t('removeFile')}" aria-label="${Utils.esc(Lang.format('removeFileAriaLabel', { name: file.name }))}">${Icon('x', 13)}</button></div>`).join('');
            box.querySelectorAll('button').forEach(btn => btn.onclick = () => UI.confirm(Lang.t('kbConfirmDeleteAttachment'), async () => {
                if (!(await Store.deleteKbAttachment(btn.dataset.id))) return UI.toast(Lang.t('saveFailed'));
                btn.closest('.file-chip').remove();
            }));
            if (window.lucide) lucide.createIcons();
        }
        modal.querySelector('#kbe-title').focus();
    },

    // Zusaetzliche, reine Wissensdatenbank-Kategorien verwalten.
    openCategories: async (onChange) => {
        const modal = AdminBoard.openDialog({
            id: 'kb-categories-modal',
            title: Lang.t('kbManageCategories'),
            icon: 'tags',
            size: 'sm',
            body: `<p class="hint">${Utils.esc(Lang.t('kbCategoryHint'))}</p>
                   <div class="kb-add-category">
                       <input id="kbc-name" type="text" maxlength="128" placeholder="${Utils.esc(Lang.t('kbNewCategoryPlaceholder'))}" aria-label="${Utils.esc(Lang.t('kbNewCategoryPlaceholder'))}">
                       <button type="button" class="btn-secondary btn-sm" id="kbc-add">${Icon('plus', 14)}${Utils.esc(Lang.t('kbAddCategory'))}</button>
                   </div>
                   <div id="kbc-list" class="file-preview mt-3"></div>`
        });
        const render = async () => {
            const own = (await Store.getKbCategories()).filter(c => c.source === 'kb');
            const box = modal.querySelector('#kbc-list');
            box.innerHTML = own.length ? own.map(c => `<span class="file-chip">${Icon('tag', 13)}<span>${Utils.esc(c.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" data-id="${Utils.esc(c.id)}" data-name="${Utils.esc(c.name)}" title="${Utils.esc(Lang.t('kbDeleteCategory'))}" aria-label="${Utils.esc(Lang.t('kbDeleteCategory'))}">${Icon('x', 13)}</button></span>`).join('')
                : `<span class="hint">${Utils.esc(Lang.t('kbNoOwnCategories'))}</span>`;
            box.querySelectorAll('button').forEach(btn => btn.onclick = () => UI.confirm(Lang.format('kbConfirmDeleteCategory', { name: btn.dataset.name }), async () => {
                if (!(await Store.deleteKbCategory(btn.dataset.id))) return UI.toast(Lang.t('saveFailed'));
                await render();
                if (onChange) onChange();
            }));
            if (window.lucide) lucide.createIcons();
        };
        const add = async () => {
            const input = modal.querySelector('#kbc-name');
            const name = input.value.trim();
            if (!name) return input.focus();
            const result = await Store.createKbCategory(name);
            if (!result.ok) return UI.toast(result.error === 'category_exists' ? Lang.t('kbCategoryExists') : Lang.t('saveFailed'));
            input.value = '';
            await render();
            if (onChange) onChange();
        };
        modal.querySelector('#kbc-add').onclick = add;
        modal.querySelector('#kbc-name').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); add(); } };
        await render();
    },

    // Wissensdatenbank (Kacheln). ticket: aus einem Ticket heraus geoeffnet -> direkt zuordnen.
    open: async ({ ticket = null } = {}) => {
        const { canRead, canEdit } = await KbSearch.access();
        if (!canRead) return UI.toast(Lang.t('kbNoPermission'));
        let view = null;
        const modal = AdminBoard.openDialog({
            id: 'kb-modal',
            title: ticket ? Lang.format('kbForTicket', { number: ticket.ticketNumber || '' }) : Lang.t('knowledgeBase'),
            icon: 'book-open',
            size: 'full',
            headerButtons: canEdit ? [
                { id: 'kb-new', icon: 'file-plus-2', title: Lang.t('newArticle'), onClick: () => KbSearch.openEditor({ categories: view.getCategories(), onSaved: () => view.refresh() }) },
                { id: 'kb-cats', icon: 'tags', title: Lang.t('kbManageCategories'), onClick: () => KbSearch.openCategories(() => view.refresh()) }
            ] : [],
            body: `
                <div class="kb-shell">
                    <aside class="kb-sidebar">
                        <div class="kb-sidebar-title">${Utils.esc(Lang.t('kbStatsTitle'))}</div>
                        <dl class="kb-stats" id="kb-stats"></dl>
                        <div class="kb-sidebar-title">${Utils.esc(Lang.t('kbCategoriesTitle'))}</div>
                        <nav class="kb-cat-nav" id="kb-cat-nav" aria-label="${Utils.esc(Lang.t('kbCategoriesTitle'))}"></nav>
                    </aside>
                    <div class="kb-main">
                        ${ticket ? `<div class="callout callout-info">${Utils.esc(Lang.t('kbForTicketHint'))}</div>` : ''}
                        ${KbSearch.filtersMarkup('kb')}
                        <div id="kb-list" class="kb-grid"></div>
                    </div>
                </div>`
        });
        modal.classList.add('kb-library');
        view = KbSearch.bind(modal, 'kb', { list: modal.querySelector('#kb-list'), canEdit, ticket, categoryNav: modal.querySelector('#kb-cat-nav'), stats: modal.querySelector('#kb-stats') });
        await view.refresh();
        modal.querySelector('#kb-q').focus();
    }
};
