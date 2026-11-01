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
            <div class="kb-search-row">
                <span class="kb-search-icon">${Icon('search', 16)}</span>
                <input type="search" id="${prefix}-q" class="section-search" placeholder="${Utils.esc(Lang.t('kbSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('kbSearchPlaceholder'))}">
            </div>
            <div class="kb-filter-row">
                <label><span>${Utils.esc(Lang.t('kbFilterCategory'))}</span><select id="${prefix}-category"></select></label>
                <label><span>${Utils.esc(Lang.t('kbFilterCreator'))}</span><select id="${prefix}-creator"></select></label>
                <label><span>${Utils.esc(Lang.t('kbFilterPeriod'))}</span><select id="${prefix}-period">
                    ${option('all', Lang.t('kbPeriodAll'))}${option('d7', Lang.t('kbPeriod7'))}${option('d30', Lang.t('kbPeriod30'))}${option('d90', Lang.t('kbPeriod90'))}${option('y1', Lang.t('kbPeriod365'))}
                </select></label>
                <label><span>${Utils.esc(Lang.t('kbFilterSort'))}</span><select id="${prefix}-sort">
                    ${option('updated', Lang.t('kbSortUpdated'))}${option('newest', Lang.t('kbSortNewest'))}${option('oldest', Lang.t('kbSortOldest'))}${option('title', Lang.t('kbSortTitle'))}
                </select></label>
                <button type="button" class="btn-ghost btn-sm" id="${prefix}-reset">${Icon('rotate-ccw', 14)}${Utils.esc(Lang.t('kbFilterReset'))}</button>
            </div>
            <div class="hint kb-result-count" id="${prefix}-count" role="status"></div>
        </div>`,

    // Verdrahtet Filter und Kachelraster innerhalb von root. ticket: Ticket, dem Loesungen direkt
    // zugeordnet werden koennen (Suche aus einem Ticket heraus).
    bind: (root, prefix, { list, canEdit = false, ticket = null } = {}) => {
        let articles = [];
        let categories = [];
        const el = id => root.querySelector(`#${prefix}-${id}`);
        const fillSelects = () => {
            const keepCategory = el('category').value;
            const keepCreator = el('creator').value;
            el('category').innerHTML = option('', Lang.t('kbAllCategories')) + option('__none__', Lang.t('kbNoCategory'))
                + categories.map(c => option(c.name, c.source === 'kb' ? `${c.name} (${Lang.t('kbOwnCategory')})` : c.name)).join('');
            const creators = [...new Map(articles.filter(a => a.createdByUserId).map(a => [a.createdByUserId, a.createdByName || '–'])).entries()]
                .sort((a, b) => a[1].localeCompare(b[1], Lang.current));
            el('creator').innerHTML = option('', Lang.t('kbAllCreators')) + creators.map(([id, name]) => option(id, name)).join('');
            if ([...el('category').options].some(o => o.value === keepCategory)) el('category').value = keepCategory;
            if ([...el('creator').options].some(o => o.value === keepCreator)) el('creator').value = keepCreator;
        };
        const filtered = () => {
            const query = el('q').value.trim().toLocaleLowerCase();
            const category = el('category').value;
            const creator = el('creator').value;
            const days = PERIOD_DAYS[el('period').value] || 0;
            const since = days ? Date.now() - days * 86400000 : 0;
            const sorters = {
                updated: (a, b) => time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt),
                newest: (a, b) => time(b.createdAt) - time(a.createdAt),
                oldest: (a, b) => time(a.createdAt) - time(b.createdAt),
                title: (a, b) => a.title.localeCompare(b.title, Lang.current)
            };
            return articles.filter(a => (!query || query.split(/\s+/).every(word => a.searchText.includes(word)))
                && (!category || (category === '__none__' ? !a.category : a.category === category))
                && (!creator || a.createdByUserId === creator)
                && (!since || time(a.createdAt) >= since))
                .sort(sorters[el('sort').value] || sorters.updated);
        };
        const render = () => {
            const items = filtered();
            el('count').textContent = Lang.format('kbResultCount', { count: items.length, total: articles.length });
            list.className = 'kb-grid';
            list.innerHTML = items.length ? items.map(a => `
                <button type="button" class="kb-tile" data-id="${Utils.esc(a.id)}">
                    <span class="kb-tile-head">
                        <span class="kb-tile-icon">${Icon('lightbulb', 18)}</span>
                        ${a.category ? `<span class="t-category">${Utils.esc(a.category)}</span>` : `<span class="kb-tile-nocat">${Utils.esc(Lang.t('kbNoCategory'))}</span>`}
                    </span>
                    <strong class="kb-tile-title">${Utils.esc(a.title)}</strong>
                    <span class="kb-tile-excerpt">${Utils.esc(excerpt(a.plain))}</span>
                    <span class="kb-tile-meta">
                        <span>${Icon('user-round', 13)}${Utils.esc(a.createdByName || '–')}</span>
                        <span>${Icon('calendar', 13)}${Utils.esc(Utils.fmtDate(a.updatedAt || a.createdAt))}</span>
                        ${a.linkedTicketCount ? `<span title="${Utils.esc(Lang.t('kbLinkedTickets'))}">${Icon('ticket', 13)}${a.linkedTicketCount}</span>` : ''}
                    </span>
                </button>`).join('') : `<div class="empty-state compact kb-empty">${Icon('book-open', 20)}<span>${Utils.esc(Lang.t('noArticlesFound'))}</span></div>`;
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
            render();
        };
        el('q').oninput = render;
        ['category', 'creator', 'period', 'sort'].forEach(id => { el(id).onchange = render; });
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
            size: 'lg',
            headerButtons: canEdit ? [
                { id: 'kba-edit', icon: 'pencil', title: Lang.t('edit') },
                { id: 'kba-delete', icon: 'trash-2', title: Lang.t('delete') }
            ] : [],
            body: `
                <div class="kb-article-view">
                    <div class="kb-article-meta-bar">
                        ${article.category ? `<span class="t-category">${Utils.esc(article.category)}</span>` : `<span class="kb-tile-nocat">${Utils.esc(Lang.t('kbNoCategory'))}</span>`}
                        <span class="hint">${Icon('user-round', 13)} ${Utils.esc(article.createdByName || '–')}</span>
                        <span class="hint">${Icon('calendar', 13)} ${Utils.esc(Lang.format('kbUpdatedOn', { date: Utils.fmtDate(article.updatedAt || article.createdAt) }))}</span>
                    </div>
                    <div class="kb-link-action">
                        ${ticket
                            ? `<button type="button" class="btn-primary btn-sm" id="kba-link-current">${Icon('link', 15)}${Utils.esc(Lang.format('kbLinkToThisTicket', { number: ticket.ticketNumber || '' }))}</button>`
                            : `<button type="button" class="btn-secondary btn-sm" id="kba-link-pick">${Icon('link', 15)}${Utils.esc(Lang.t('kbLinkToTicket'))}</button>`}
                    </div>
                    <div class="desc-text rich-content kb-article-body">${Utils.sanitizeRichHtml(article.body)}</div>
                    <div class="kb-article-section" id="kba-attachments-box" hidden>
                        <h4 class="section-title">${Icon('paperclip', 14)}${Utils.esc(Lang.t('attachments'))}</h4>
                        <div class="file-preview" id="kba-attachments"></div>
                    </div>
                    <div class="kb-article-section">
                        <h4 class="section-title">${Icon('ticket', 14)}${Utils.esc(Lang.t('kbLinkedTickets'))}</h4>
                        <div class="file-preview" id="kba-tickets"><span class="hint">${Utils.esc(Lang.t('kbLoading'))}</span></div>
                    </div>
                    ${canEdit ? `<div class="kb-article-section kb-article-category">
                        <label for="kba-category">${Utils.esc(Lang.t('kbFilterCategory'))}</label>
                        <select id="kba-category">${option('', Lang.t('kbNoCategory'), !article.category)}${[...new Set([...categories.map(c => c.name), ...(article.category ? [article.category] : [])])].map(name => option(name, name, name === article.category)).join('')}</select>
                    </div>` : ''}
                </div>`
        });
        const renderTickets = async () => {
            const box = modal.querySelector('#kba-tickets');
            const tickets = await Store.getKbArticleTickets(article.id);
            box.innerHTML = tickets.length ? tickets.map(t => `<button type="button" class="file-chip kba-ticket" data-id="${Utils.esc(t.id)}">${Icon('ticket', 13)}<span>${Utils.esc(t.ticketNumber)}</span>${t.archived ? `<small>${Utils.esc(Lang.t('archivedState'))}</small>` : ''}</button>`).join('')
                : `<span class="hint">${Utils.esc(Lang.t('kbNoLinkedTickets'))}</span>`;
            box.querySelectorAll('.kba-ticket').forEach(btn => btn.onclick = () => { modal.remove(); AdminBoard.openModal(btn.dataset.id); });
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
            modal.querySelector('#kba-category').onchange = async event => {
                if (!(await Store.updateKbArticle(article.id, { category: event.target.value || null }))) return UI.toast(Lang.t('saveFailed'));
                article.category = event.target.value || null;
                if (onChange) onChange();
            };
        }
        const attachments = await Store.getKbArticleAttachments(article.id);
        const box = modal.querySelector('#kba-attachments');
        modal.querySelector('#kba-attachments-box').hidden = !attachments.length;
        box.innerHTML = attachments.map(file => `<button type="button" class="file-chip kb-att" data-id="${Utils.esc(file.id)}">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span></button>`).join('');
        box.querySelectorAll('.kb-att').forEach(btn => btn.onclick = async () => {
            const full = await Store.getKbAttachment(btn.dataset.id);
            if (full) AdminBoard.openAttachmentPreview(full);
        });
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

    // Artikel anlegen oder bearbeiten -- eigenes Popup mit Formatierung und Anhaengen.
    openEditor: async ({ article = null, categories = null, onSaved = null } = {}) => {
        const allCategories = categories || await Store.getKbCategories();
        const files = [];
        const modal = AdminBoard.openDialog({
            id: 'kb-editor-modal',
            title: article ? Lang.t('kbEditArticle') : Lang.t('newArticle'),
            icon: article ? 'pencil' : 'file-plus-2',
            size: 'lg',
            body: `
                <div class="kb-editor-form">
                    <div class="field"><label for="kbe-title">${Lang.t('titleLabel')}</label><input id="kbe-title" type="text" maxlength="500" value="${Utils.esc(article?.title || '')}"></div>
                    <div class="field"><label for="kbe-category">${Utils.esc(Lang.t('kbFilterCategory'))}</label>
                        <select id="kbe-category">${option('', Lang.t('kbNoCategory'), !article?.category)}${allCategories.map(c => option(c.name, c.name, c.name === article?.category)).join('')}</select></div>
                    <div class="field">
                        <label for="kbe-body">${Lang.t('content')}</label>
                        <div class="note-toolbar">
                            <button type="button" class="btn-ghost btn-icon btn-sm" data-fmt="bold" title="${Lang.t('bold')}" aria-label="${Lang.t('bold')}">${Icon('bold', 15)}</button>
                            <button type="button" class="btn-ghost btn-icon btn-sm" data-fmt="italic" title="${Lang.t('italic')}" aria-label="${Lang.t('italic')}">${Icon('italic', 15)}</button>
                            <button type="button" class="btn-ghost btn-icon btn-sm" data-fmt="insertUnorderedList" title="${Lang.t('list')}" aria-label="${Lang.t('list')}">${Icon('list', 15)}</button>
                            <button type="button" class="btn-ghost btn-icon btn-sm" data-fmt="insertOrderedList" title="${Lang.t('numberedList')}" aria-label="${Lang.t('numberedList')}">${Icon('list-ordered', 15)}</button>
                            <button type="button" class="btn-ghost btn-icon btn-sm" id="kbe-table" title="${Lang.t('insertTable')}" aria-label="${Lang.t('insertTable')}">${Icon('table', 15)}</button>
                            <button type="button" class="btn-ghost btn-icon btn-sm" id="kbe-link" title="${Lang.t('insertLink')}" aria-label="${Lang.t('insertLink')}">${Icon('link', 15)}</button>
                            <label class="btn btn-ghost btn-icon btn-sm" title="${Lang.t('addAttachment')}" aria-label="${Lang.t('addAttachment')}">${Icon('paperclip', 15)}<input type="file" id="kbe-file" hidden multiple></label>
                        </div>
                        <div id="kbe-body" class="rich-editor kb-rich-editor" contenteditable="true" data-placeholder="${Lang.t('richEditorPlaceholder')}">${article ? Utils.sanitizeRichHtml(article.body) : ''}</div>
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
                    articleId = await Store.createKbArticle(title, body, undefined, category);
                    if (!articleId) return UI.toast(Lang.t('saveFailed'));
                }
                if (files.length) {
                    try {
                        await Promise.all(files.map(f => Store.saveKbAttachment(articleId, f)));
                    } catch (e) {
                        UI.toast(e.message === 'ATTACHMENT_TOO_LARGE' ? Lang.t('attachmentTooLarge15MB') : Lang.t('articleSavedAttachmentFailed'));
                    }
                }
                m.remove();
                UI.toast(Lang.t('articleSavedToast'));
                if (onSaved) await onSaved();
            }
        });
        const bodyInput = modal.querySelector('#kbe-body');
        // Klicks auf die Werkzeugleiste duerfen die Auswahl im Editor nicht aufheben.
        modal.querySelectorAll('.note-toolbar button').forEach(btn => { btn.onmousedown = e => e.preventDefault(); });
        modal.querySelectorAll('[data-fmt]').forEach(btn => btn.onclick = () => { bodyInput.focus(); document.execCommand(btn.dataset.fmt); });
        modal.querySelector('#kbe-table').onclick = () => insertMarkdownTable(bodyInput);
        modal.querySelector('#kbe-link').onclick = async () => {
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
        const renderFiles = () => {
            const preview = modal.querySelector('#kbe-files');
            preview.innerHTML = files.map((file, index) => `<div class="file-chip">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" data-index="${index}" title="${Lang.t('removeFile')}" aria-label="${Utils.esc(Lang.format('removeFileAriaLabel', { name: file.name }))}">${Icon('x', 13)}</button></div>`).join('');
            preview.querySelectorAll('button').forEach(btn => btn.onclick = () => { files.splice(Number(btn.dataset.index), 1); renderFiles(); });
            if (window.lucide) lucide.createIcons();
        };
        const addFiles = list => { files.push(...list); renderFiles(); };
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
            size: 'xl',
            headerButtons: canEdit ? [
                { id: 'kb-new', icon: 'file-plus-2', title: Lang.t('newArticle'), onClick: () => KbSearch.openEditor({ categories: view.getCategories(), onSaved: () => view.refresh() }) },
                { id: 'kb-cats', icon: 'tags', title: Lang.t('kbManageCategories'), onClick: () => KbSearch.openCategories(() => view.refresh()) }
            ] : [],
            body: `${ticket ? `<div class="callout callout-info">${Utils.esc(Lang.t('kbForTicketHint'))}</div>` : ''}${KbSearch.filtersMarkup('kb')}<div id="kb-list" class="kb-grid"></div>`
        });
        modal.classList.add('kb-library');
        view = KbSearch.bind(modal, 'kb', { list: modal.querySelector('#kb-list'), canEdit, ticket });
        await view.refresh();
        modal.querySelector('#kb-q').focus();
    }
};
