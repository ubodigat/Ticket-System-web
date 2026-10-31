/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Suche + Filter fuer die Wissensdatenbank -- gemeinsam genutzt von der Wissensdatenbank selbst
// (mit Bearbeitung) und der reinen Suche aus jedem Ticket heraus (nur lesen).
import { Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { UI } from './ui.js';
import { Store } from './store.js';
import { AdminBoard } from './admin-board.js';

const PERIOD_DAYS = { all: 0, d7: 7, d30: 30, d90: 90, y1: 365 };
const option = (value, label, selected = false) => `<option value="${Utils.esc(value)}"${selected ? ' selected' : ''}>${Utils.esc(label)}</option>`;
const plainText = html => (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
const time = value => new Date(value || 0).getTime() || 0;

export const KbSearch = {
    filtersMarkup: prefix => `
        <div class="kb-filters">
            <input type="search" id="${prefix}-q" class="section-search" placeholder="${Utils.esc(Lang.t('kbSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('kbSearchPlaceholder'))}">
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

    // Verdrahtet Filter und Ergebnisliste innerhalb von root; liefert refresh() und die Kategorien.
    bind: (root, prefix, { list, canEdit = false } = {}) => {
        let articles = [];
        let categories = [];
        const el = id => root.querySelector(`#${prefix}-${id}`);
        const categoryOptions = current => {
            const names = categories.map(c => c.name);
            if (current && !names.includes(current)) names.push(current);
            return option('', Lang.t('kbNoCategory'), !current) + names.map(name => option(name, name, name === current)).join('');
        };
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
            list.innerHTML = items.length ? items.map(a => `
                <details class="kb-article" data-id="${Utils.esc(a.id)}">
                    <summary><strong>${Utils.esc(a.title)}</strong>
                        <span class="kb-article-meta">${a.category ? `<span class="t-category">${Utils.esc(a.category)}</span>` : ''}<span class="hint">${Utils.esc(a.createdByName || '–')} · ${Utils.esc(Utils.fmtDate(a.createdAt))}</span></span>
                    </summary>
                    <div class="desc-text rich-content">${Utils.sanitizeRichHtml(a.body)}</div>
                    <div class="file-preview kb-article-attachments" hidden></div>
                    ${canEdit ? `<div class="kb-article-actions">
                        <label><span>${Utils.esc(Lang.t('kbFilterCategory'))}</span><select class="kb-set-category" data-id="${Utils.esc(a.id)}">${categoryOptions(a.category)}</select></label>
                        <button class="btn-ghost btn-sm kb-del" type="button" data-id="${Utils.esc(a.id)}">${Icon('trash-2', 14)}${Utils.esc(Lang.t('delete'))}</button>
                    </div>` : ''}
                </details>`).join('') : `<div class="empty-state compact">${Utils.esc(Lang.t('noArticlesFound'))}</div>`;
            list.querySelectorAll('.kb-del').forEach(btn => btn.onclick = () => {
                UI.confirm(Lang.t('kbConfirmDeleteArticle'), async () => {
                    if (!(await Store.deleteKbArticle(btn.dataset.id))) return UI.toast(Lang.t('saveFailed'));
                    await refresh();
                });
            });
            list.querySelectorAll('.kb-set-category').forEach(select => select.onchange = async () => {
                if (!(await Store.updateKbArticle(select.dataset.id, { category: select.value || null }))) UI.toast(Lang.t('saveFailed'));
                await refresh();
            });
            // Anhaenge je Artikel erst beim Aufklappen laden, nicht pauschal fuer alle Treffer.
            list.querySelectorAll('.kb-article').forEach(details => {
                let loaded = false;
                details.addEventListener('toggle', async () => {
                    if (!details.open || loaded) return;
                    loaded = true;
                    const box = details.querySelector('.kb-article-attachments');
                    const attachments = await Store.getKbArticleAttachments(details.dataset.id);
                    box.hidden = attachments.length === 0;
                    box.innerHTML = attachments.map(file => `<button type="button" class="file-chip kb-att" data-id="${Utils.esc(file.id)}">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span></button>`).join('');
                    box.querySelectorAll('.kb-att').forEach(btn => btn.onclick = async () => {
                        const full = await Store.getKbAttachment(btn.dataset.id);
                        if (full) AdminBoard.openAttachmentPreview(full);
                    });
                    if (window.lucide) lucide.createIcons();
                });
            });
            if (window.lucide) lucide.createIcons();
        };
        const refresh = async () => {
            const [loadedArticles, loadedCategories] = await Promise.all([Store.getKbArticles(), Store.getKbCategories()]);
            categories = loadedCategories;
            articles = loadedArticles.map(a => ({ ...a,
                searchText: `${a.title} ${plainText(a.body)} ${a.category || ''} ${a.createdByName || ''}`.toLocaleLowerCase() }));
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

    // Reine Suche (nur lesen), z.B. aus einem Ticket heraus.
    open: async () => {
        const user = await Store.currentUser();
        const mayRead = user?.role === 'superadmin' || (user?.role === 'admin' && ['read', 'edit'].includes(user?.permissions?.kb));
        if (!mayRead) return UI.toast(Lang.t('kbNoPermission'));
        const modal = AdminBoard.openDialog({
            id: 'kb-search-modal',
            title: Lang.t('kbSearchTitle'),
            icon: 'book-open',
            size: 'xl',
            body: `${KbSearch.filtersMarkup('kbs')}<div id="kbs-list" class="mt-3"></div>`
        });
        const view = KbSearch.bind(modal, 'kbs', { list: modal.querySelector('#kbs-list') });
        await view.refresh();
        modal.querySelector('#kbs-q').focus();
    }
};
