/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
// F&A je Kategorie: schnelle Tipps vor dem Ticketformular (Benutzer-Dashboard) und der Editor dafuer.
// Antworten sind reiner Text im einfachen Markdown-Dialekt (Utils.renderMarkdown maskiert alles).
import { Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { UI } from './ui.js';
import { Store } from './store.js';
import { AdminBoard } from './admin-board.js';

const ICONS = [['hardware', 'monitor'], ['drucker', 'printer'], ['print', 'printer'], ['zugang', 'key-round'], ['account', 'key-round'], ['konto', 'key-round'],
    ['passwort', 'key-round'], ['software', 'laptop'], ['bestell', 'package'], ['netz', 'wifi'], ['telefon', 'phone'], ['mail', 'mail'],
    ['abrechnung', 'receipt'], ['allgemein', 'circle-help']];

export const CategoryFaq = {
    iconFor: name => (ICONS.find(([needle]) => String(name || '').toLocaleLowerCase().includes(needle)) || [null, 'folder'])[1],

    // Pflegen duerfen Superadmins sowie Admins mit "Kategorien" oder "F&A pflegen".
    canEdit: user => user?.role === 'superadmin' || (user?.role === 'admin' && (user.permissions?.settingsCategories === true || user.permissions?.categoryFaq === true)),

    // F&A-Seite einer Kategorie; unten fuehrt "Ticket erstellen" mit vorausgewaehlter Kategorie ins Formular.
    open: async (category, { onCreateTicket = null, onChanged = null } = {}) => {
        const user = await Store.currentUser();
        const canEdit = CategoryFaq.canEdit(user);
        const faq = category.faq || { intro: '', items: [] };
        const modal = AdminBoard.openDialog({
            id: 'category-faq-modal',
            title: Lang.format('faqTitle', { name: category.name }),
            icon: CategoryFaq.iconFor(category.name),
            size: 'md',
            headerButtons: canEdit ? [{ id: 'faq-edit', icon: 'pencil', title: Lang.t('faqEdit') }] : [],
            body: `
                <div class="faq-page">
                    ${faq.intro ? `<div class="faq-intro rich-content">${Utils.renderMarkdown(faq.intro)}</div>` : ''}
                    <div class="faq-search">${Icon('search', 15)}<input type="search" id="faq-search" placeholder="${Utils.esc(Lang.t('faqSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('faqSearchPlaceholder'))}"></div>
                    <div class="faq-list" id="faq-list">
                        ${faq.items.length ? faq.items.map((item, index) => `
                            <details class="faq-item"${index === 0 && faq.items.length <= 3 ? ' open' : ''}>
                                <summary>${Icon('circle-help', 16)}<span>${Utils.esc(item.question)}</span>${Icon('chevron-down', 16)}</summary>
                                <div class="faq-answer rich-content">${Utils.renderMarkdown(item.answer)}</div>
                            </details>`).join('')
                        : `<div class="empty-state compact faq-empty">${Icon('lightbulb', 20)}<span>${Utils.esc(Lang.t('faqEmpty'))}</span></div>`}
                    </div>
                    <div class="empty-state compact" id="faq-no-hits" hidden>${Utils.esc(Lang.t('faqNoHits'))}</div>
                    <div class="faq-cta">
                        <div><strong>${Utils.esc(Lang.t('faqNotSolved'))}</strong><span>${Utils.esc(Lang.format('faqNotSolvedHint', { name: category.name }))}</span></div>
                        <button type="button" class="btn-primary" id="faq-create-ticket">${Icon('plus', 16)}${Utils.esc(Lang.t('faqCreateTicket'))}</button>
                    </div>
                </div>`
        });
        const search = modal.querySelector('#faq-search');
        if (search) search.oninput = () => {
            const term = search.value.trim().toLocaleLowerCase();
            let hits = 0;
            modal.querySelectorAll('.faq-item').forEach(item => {
                const match = !term || item.textContent.toLocaleLowerCase().includes(term);
                item.hidden = !match;
                if (match) { hits++; if (term) item.open = true; }
            });
            modal.querySelector('#faq-no-hits').hidden = hits > 0;
        };
        modal.querySelector('#faq-create-ticket').onclick = () => { modal.remove(); if (onCreateTicket) onCreateTicket(category); };
        if (canEdit) modal.querySelector('#faq-edit').onclick = () => {
            modal.remove();
            CategoryFaq.edit(category, { onSaved: async saved => { category.faq = saved; if (onChanged) await onChanged(); await CategoryFaq.open(category, { onCreateTicket, onChanged }); } });
        };
        (search || modal.querySelector('#faq-create-ticket')).focus();
        return modal;
    },

    // Editor: Einleitung und beliebig viele Frage-Antwort-Paare (Reihenfolge per Pfeil).
    edit: async (category, { onSaved = null } = {}) => {
        const items = (category.faq?.items || []).map(item => ({ ...item }));
        const modal = AdminBoard.openDialog({
            id: 'category-faq-editor',
            title: Lang.format('faqEditTitle', { name: category.name }),
            icon: 'lightbulb',
            size: 'lg',
            body: `
                <p class="hint">${Utils.esc(Lang.t('faqEditorHint'))}</p>
                <div class="field"><label for="faq-intro">${Utils.esc(Lang.t('faqIntroLabel'))}</label>
                    <textarea id="faq-intro" rows="3" maxlength="2000" placeholder="${Utils.esc(Lang.t('faqIntroPlaceholder'))}">${Utils.esc(category.faq?.intro || '')}</textarea></div>
                <div class="faq-editor-list" id="faq-editor-list"></div>
                <button type="button" class="btn-secondary btn-sm" id="faq-add">${Icon('plus', 15)}${Utils.esc(Lang.t('faqAddItem'))}</button>`,
            onSave: async m => {
                sync();
                const cleaned = items.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })).filter(item => item.question || item.answer);
                const incomplete = cleaned.findIndex(item => !item.question || !item.answer);
                if (incomplete >= 0) {
                    m.querySelectorAll('.faq-editor-item')[incomplete]?.querySelector(cleaned[incomplete].question ? '.faq-a' : '.faq-q')?.focus();
                    return UI.toast(Lang.t('faqItemIncomplete'));
                }
                const faq = { intro: m.querySelector('#faq-intro').value.trim(), items: cleaned };
                if (!(await Store.saveCategoryFaq(category.id, faq))) return UI.toast(Lang.t('saveFailed'));
                m.remove();
                UI.toast(Lang.t('faqSaved'));
                if (onSaved) await onSaved(faq);
            }
        });
        const list = modal.querySelector('#faq-editor-list');
        const sync = () => list.querySelectorAll('.faq-editor-item').forEach((row, index) => {
            items[index].question = row.querySelector('.faq-q').value;
            items[index].answer = row.querySelector('.faq-a').value;
        });
        const render = () => {
            list.innerHTML = items.length ? items.map((item, index) => `
                <div class="faq-editor-item">
                    <div class="faq-editor-head">
                        <span class="faq-editor-no">${index + 1}</span>
                        <input type="text" class="faq-q" maxlength="300" value="${Utils.esc(item.question)}" placeholder="${Utils.esc(Lang.t('faqQuestionPlaceholder'))}" aria-label="${Utils.esc(Lang.t('faqQuestion'))}">
                        <button type="button" class="btn-ghost btn-icon btn-sm" data-move="-1" title="${Utils.esc(Lang.t('moveUp'))}" aria-label="${Utils.esc(Lang.t('moveUp'))}"${index === 0 ? ' disabled' : ''}>${Icon('arrow-up', 15)}</button>
                        <button type="button" class="btn-ghost btn-icon btn-sm" data-move="1" title="${Utils.esc(Lang.t('moveDown'))}" aria-label="${Utils.esc(Lang.t('moveDown'))}"${index === items.length - 1 ? ' disabled' : ''}>${Icon('arrow-down', 15)}</button>
                        <button type="button" class="btn-ghost btn-icon btn-sm btn-danger" data-remove title="${Utils.esc(Lang.t('delete'))}" aria-label="${Utils.esc(Lang.t('delete'))}">${Icon('trash-2', 15)}</button>
                    </div>
                    <textarea class="faq-a" rows="3" maxlength="5000" placeholder="${Utils.esc(Lang.t('faqAnswerPlaceholder'))}" aria-label="${Utils.esc(Lang.t('faqAnswer'))}">${Utils.esc(item.answer)}</textarea>
                </div>`).join('') : `<div class="empty-state compact">${Utils.esc(Lang.t('faqEditorEmpty'))}</div>`;
            list.querySelectorAll('.faq-editor-item').forEach((row, index) => {
                row.querySelectorAll('[data-move]').forEach(btn => btn.onclick = () => {
                    sync();
                    const target = index + Number(btn.dataset.move);
                    [items[index], items[target]] = [items[target], items[index]];
                    render();
                });
                row.querySelector('[data-remove]').onclick = () => { sync(); items.splice(index, 1); render(); };
                UI.bindListContinuation?.(row.querySelector('.faq-a'));
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#faq-add').onclick = () => {
            sync();
            if (items.length >= 30) return UI.toast(Lang.t('faqTooMany'));
            items.push({ question: '', answer: '' });
            render();
            list.querySelector('.faq-editor-item:last-child .faq-q')?.focus();
        };
        render();
        modal.querySelector('#faq-intro').focus();
    }
};
