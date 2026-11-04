/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, qa, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { Store, Notifications } from './store.js';
import { UI } from './ui.js';
import { Settings } from './settings.js';
import { renderWorkbook } from './excel-preview.js';
import { renderPdfPreview } from './pdf-preview.js';
import { UserDash } from './user-dash.js';
import { WorkTimer } from './work-timer.js';
import { KbSearch } from './kb-search.js';
import { CategoryFaq } from './category-faq.js';
import { getStatusColorClass, getPrioValue, compareTicketUrgency, isPendingApprover, insertMarkdownLink, insertMarkdownTable, insertMarkdownList,
    TICKET_NUMBER_TOKENS, ticketNumberFormatProblem, ticketCategoryCode, buildTicketNumberPreview } from './ticket-helpers.js';

// Fragezeichen-Icon neben einem Einstellungs-Label: nutzt UI.initTooltips() (title-Attribut
// wird app-weit automatisch durch die gestylte Tooltip-Box ersetzt) für eine Kurzerklärung,
// wofür das Feld gut ist.
const FieldHelp = (text) => `<span class="field-help" title="${Utils.esc(text)}" tabindex="0">${Icon('circle-help', 14)}</span>`;

export const AdminBoard = {
    selectedFiles: [],
    slaRefreshTimer: null,
    noteFiles: {
        'admin-chat': [],
        solution: []
    },

    orderTopbar: () => {
        const nav = q('.topbar-right');
        if (!nav) return;
        ['btn-to-dash', 'btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings', 'btn-outlook-calendar', 'btn-todos', 'btn-notifications', 'theme-toggle', 'btn-settings', 'logout'].forEach(id => {
            const el = q(`#${id}`);
            if (el && el.parentElement === nav) nav.appendChild(el);
        });
    },

    // Gleiche Regeln wie der Server (domain/ticketAccess.ts) -- dort wird verbindlich geprueft, die
    // Ticketlisten kommen bereits gefiltert. Hier nur fuer Vorschlaege (z.B. @-Erwaehnungen anderer
    // Personen): eigene, zugewiesene oder beteiligte Tickets, Tickets der eigenen Gruppe (mit Ober-
    // und Untergruppen); ohne Gruppe zusaetzlich nicht zugewiesene und allgemeine Tickets.
    canAccessTicket: (user, ticket) => {
        if (!user || !ticket || !['admin', 'superadmin'].includes(user.role)) return false;
        if (user.role === 'superadmin') return true;
        if ((ticket.authorUserId && ticket.authorUserId === user.id) || (!ticket.authorUserId && ticket.author === user.username)) return true;
        const involved = [ticket.owner, ticket.assignee, ...(ticket.assignees || []), ...(ticket.participants || [])];
        if (involved.includes(user.username)) return true;
        if (ticket.team) return AdminBoard.inTicketGroup(user, ticket.team);
        const categories = Array.isArray(ticket.category) ? ticket.category : [ticket.category].filter(Boolean);
        return (!ticket.owner && !(ticket.assignees || []).length) || !categories.length || categories.includes('Allgemein');
    },
    // Mitglieder der zustaendigen Gruppe sehen das Ticket -- ebenso Mitglieder einer uebergeordneten
    // Gruppe ("IT" umfasst "IT › Netzwerk") und, wie bei den Server-Benachrichtigungen, Mitglieder
    // ihrer Untergruppen. Vorher zaehlten nur Abteilung/Kategorie und die zustaendige Person.
    inTicketGroup: (user, teamId) => {
        const own = user?.groupIds || [];
        if (!own.length || !teamId) return false;
        if (own.includes(teamId)) return true;
        const tree = Store._groupTree || [];
        const team = tree.find(g => g.id === teamId);
        return tree.some(g => own.includes(g.id) && (g.descendantIds || []).includes(teamId))
            || (team?.descendantIds || []).some(id => own.includes(id));
    },
    // Lokal ausgewaehlte Datei vor dem Senden ansehen (Chat, interne Kommunikation, Wissensdatenbank).
    previewLocalFile: async (file) => {
        if (file.size > 15 * 1024 * 1024) return UI.toast(Lang.t('largeLocalFileNoPreview'));
        AdminBoard.openAttachmentPreview({ name: file.name, type: file.type, data: await Store.readFile(file) });
    },
    // Dateichip mit Vorschau (Klick auf den Namen) und Entfernen-Knopf.
    stagedFileChip: (file, onRemove) => {
        const tag = document.createElement('div');
        tag.className = 'file-chip file-chip-clickable';
        tag.title = Lang.t('showPreview');
        tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('removeFile')}" aria-label="${Utils.esc(Lang.format('removeFileAriaLabel', { name: file.name }))}">${Icon('x', 13)}</button>`;
        tag.querySelector('span').onclick = () => AdminBoard.previewLocalFile(file);
        tag.querySelector('.remove-file').onclick = onRemove;
        return tag;
    },

    // SLA-Felder: intern wird immer in Stunden gespeichert, angezeigt wird in der
    // Einheit, die sich am natürlichsten liest (volle Tage als "Tage", sonst "Stunden").
    setSlaField: (key, hours) => {
        const input = q(`#sys-sla-${key}`);
        const unitSelect = q(`#sys-sla-${key}-unit`);
        if (!input || !unitSelect) return;
        const asDays = hours >= 24 && hours % 24 === 0;
        unitSelect.value = asDays ? 'days' : 'hours';
        input.value = asDays ? hours / 24 : hours;
    },
    getSlaField: (key, fallbackHours) => {
        const input = q(`#sys-sla-${key}`);
        const unitSelect = q(`#sys-sla-${key}-unit`);
        const raw = parseFloat(input?.value);
        const value = Number.isFinite(raw) && raw > 0 ? raw : fallbackHours;
        return unitSelect?.value === 'days' ? value * 24 : value;
    },

    roleLabel: { user: 'Benutzer', admin: 'Admins' },
    renderNotifMatrix: (container, policy) => {
        if (!container) return;
        const rows = [];
        Object.entries(Store.notifTypeMeta).forEach(([type, meta]) => {
            meta.roles.forEach(role => {
                const rule = policy[type]?.[role] || { appLocked: false, emailLocked: false, defaultApp: true, defaultEmail: false };
                rows.push(`
                    <div class="notif-matrix-row" data-notif-type="${type}" data-notif-role="${role}">
                        <div class="notif-matrix-label"><strong>${Utils.esc(meta.label)}</strong><span>${AdminBoard.roleLabel[role]}</span></div>
                        <label class="check-row compact"><input type="checkbox" class="nm-default-app" ${rule.defaultApp ? 'checked' : ''}>In-App (Standard)</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-default-email" ${rule.defaultEmail ? 'checked' : ''}>E-Mail (Standard)</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-app-configurable" ${!rule.appLocked ? 'checked' : ''}>In-App anpassbar</label>
                        <label class="check-row compact"><input type="checkbox" class="nm-email-configurable" ${!rule.emailLocked ? 'checked' : ''}>E-Mail anpassbar</label>
                    </div>`);
            });
        });
        container.innerHTML = rows.join('');
        const originalRows = [...container.querySelectorAll('.notif-matrix-row')];
        container.replaceChildren();
        for (const role of ['user', 'admin']) {
            const group = document.createElement('section'); group.className = 'notif-role-section';
            const heading = document.createElement('h4'); heading.textContent = role === 'user' ? Lang.t('users') : Lang.t('admins');
            group.appendChild(heading);
            originalRows.filter(row => row.dataset.notifRole === role).forEach(row => group.appendChild(row));
            container.appendChild(group);
        }
    },
    readNotifMatrix: (container) => {
        const policy = {};
        if (!container) return policy;
        container.querySelectorAll('.notif-matrix-row').forEach(row => {
            const type = row.dataset.notifType;
            const role = row.dataset.notifRole;
            policy[type] = policy[type] || {};
            policy[type][role] = {
                defaultApp: row.querySelector('.nm-default-app').checked,
                defaultEmail: row.querySelector('.nm-default-email').checked,
                appLocked: !row.querySelector('.nm-app-configurable').checked,
                emailLocked: !row.querySelector('.nm-email-configurable').checked
            };
        });
        return policy;
    },

    refreshOverdueIndicator: async (tickets, user, settings) => {
        const button = q('#btn-overdue-tickets');
        if (!button) return;
        // Die Liste kommt vom Server bereits nach Sichtbarkeit gefiltert.
        const visibleTickets = tickets.filter(ticket => !ticket.archived);
        const count = visibleTickets.filter(ticket => Store.isTicketOverdue(ticket, settings)).length;
        const section = q('#overdue-board');
        if (section) section.hidden = count === 0;
        const badge = q('#overdue-ticket-count');
        if (badge) badge.textContent = String(count);
        button.onclick = AdminBoard.openOverdueTickets;
        if (count) button.title = `${count} ${Lang.t('overdue')} ${Lang.t('tickets')}`;
    },

    openOverdueTickets: async () => {
        let modal = q('#sla-overdue-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sla-overdue-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('alarm-clock', 18)} ${Lang.t('overdue')} ${Lang.t('tickets')}</h3>
                        <button class="btn-ghost btn-icon" data-close-sla title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                    <div class="modal-body sla-overdue-list" id="sla-overdue-list"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('[data-close-sla]').onclick = () => modal.classList.remove('open');
            modal.onclick = event => {
                if (event.target === modal) modal.classList.remove('open');
            };
        }
        const user = await Store.currentUser();
        const settings = await Store.getSettings();
        const tickets = (await Store.getTickets()).filter(ticket =>
            !ticket.archived && Store.isTicketOverdue(ticket, settings)
        ).sort((a, b) => Store.ticketSlaDueAt(a, settings) - Store.ticketSlaDueAt(b, settings));
        const list = q('#sla-overdue-list');
        const users = await Store.getUsers();
        list.innerHTML = tickets.length ? tickets.map(ticket => {
            const deadline = Store.ticketSlaDueAt(ticket, settings);
            const owner = ticket.owner ? users.find(u => u.username === ticket.owner) : null;
            const ownerLabel = owner ? (owner.name || owner.username) : (ticket.owner || Lang.t('unassigned'));
            const overdueMinutes = Math.max(1, Math.floor((Date.now() - deadline) / 60000));
            const overdueDuration = overdueMinutes >= 1440 ? `${Math.floor(overdueMinutes / 1440)} ${Lang.t('dayShort')}` :
                overdueMinutes >= 60 ? `${Math.floor(overdueMinutes / 60)} ${Lang.t('hourShort')}` : `${overdueMinutes} ${Lang.t('minuteShort')}`;
            const overdueText = Lang.format('overdueSince', { time: overdueDuration });
            return `
                <button class="sla-overdue-item" type="button" data-ticket-id="${Utils.esc(ticket.id)}">
                    <span class="sla-overdue-icon">${Icon('triangle-alert', 16)}</span>
                    <span class="sla-overdue-copy">
                        <strong>${Utils.esc(ticket.ticketNumber || ticket.id)} · ${Utils.esc(ticket.title)}</strong>
                        <span>${Lang.prio(ticket.prio)} · ${Lang.t('deadline')} ${Utils.fmtDate(new Date(deadline).toISOString())}</span>
                        <span>${Lang.t('mainResponsible')}: ${Utils.esc(ownerLabel)}</span>
                        <time>${overdueText}</time>
                    </span>
                </button>`;
        }).join('') : `<div class="empty-state">${Lang.t('noOverdueTickets')}</div>`;
        list.querySelectorAll('.sla-overdue-item').forEach(item => {
            item.onclick = async () => {
                modal.classList.remove('open');
                await AdminBoard.openModal(item.dataset.ticketId);
            };
        });
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    mentionCandidates: [],
    mentionStart: 0,
    mentionEnd: 0,
    mentionActiveIndex: 0,

    setupMentionAutocomplete: async (ticket) => {
        const menu = q('#m-admin-mention-picker');
        const input = q('#m-admin-new-comment');
        if (!menu || !input) return;
        if (menu.parentElement !== document.body) document.body.appendChild(menu);
        const currentUser = await Store.currentUser();
        if (!Store._groupTree.length) await Store.getGroups().catch(() => []);
        AdminBoard.mentionCandidates = (await Store.getUsers()).filter(user =>
            user.username !== currentUser?.username && AdminBoard.canAccessTicket(user, ticket)
        );
        menu.hidden = true;
        input.oninput = () => AdminBoard.renderMentionSuggestions(input, menu);
        input.onkeydown = event => {
            if (menu.hidden) return;
            const options = [...menu.querySelectorAll('[role="option"]')];
            if (event.key === 'Escape') {
                menu.hidden = true;
            } else if (options.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                AdminBoard.mentionActiveIndex = (AdminBoard.mentionActiveIndex + direction + options.length) % options.length;
                options.forEach((option, index) => {
                    option.classList.toggle('is-active', index === AdminBoard.mentionActiveIndex);
                    option.setAttribute('aria-selected', String(index === AdminBoard.mentionActiveIndex));
                });
            } else if (event.key === 'Enter' && options.length) {
                event.preventDefault();
                options[AdminBoard.mentionActiveIndex]?.click();
            }
        };
        menu.onmousedown = event => event.preventDefault();
    },

    renderMentionSuggestions: (input, menu) => {
        const beforeCursor = input.value.slice(0, input.selectionStart);
        const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
        if (!match) {
            menu.hidden = true;
            return;
        }
        const query = match[1].toLowerCase();
        const matches = AdminBoard.mentionCandidates.filter(user =>
            user.username.toLowerCase().includes(query) || String(user.name || '').toLowerCase().includes(query)
        );
        AdminBoard.mentionStart = input.selectionStart - match[1].length - 1;
        AdminBoard.mentionEnd = input.selectionStart;
        AdminBoard.mentionActiveIndex = 0;
        menu.replaceChildren();
        matches.forEach((user, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.role = 'option';
            option.className = `mention-suggestion${index === 0 ? ' is-active' : ''}`;
            option.textContent = `${user.name || user.username} (@${user.username})`;
            option.setAttribute('aria-selected', String(index === 0));
            option.onclick = () => {
                // Direkt den Namen einsetzen statt des Benutzernamens, damit es im Textfeld schon so
                // aussieht wie später in der Anzeige (Hervorhebung erfolgt dann beim Rendern).
                input.setRangeText(`@${user.name || user.username} `, AdminBoard.mentionStart, AdminBoard.mentionEnd, 'end');
                menu.hidden = true;
                input.focus();
                input.dispatchEvent(new Event('input', {
                    bubbles: true
                }));
            };
            menu.appendChild(option);
        });
        if (!matches.length) {
            const empty = document.createElement('span');
            empty.className = 'mention-suggestion-empty';
            empty.textContent = Lang.t('noAdminsWithAccess');
            menu.appendChild(empty);
        }
        const rect = input.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left)}px`;
        menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        menu.hidden = false;
        if (rect.bottom + 4 + menu.offsetHeight > window.innerHeight - 8) menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
    },

    renderFilePreview: () => {
        const pan = q('#m-chat-file-preview');
        if (!pan) return;
        pan.innerHTML = '';
        if (AdminBoard.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            AdminBoard.selectedFiles.forEach((f, idx) => pan.appendChild(AdminBoard.stagedFileChip(f, () => {
                AdminBoard.selectedFiles.splice(idx, 1);
                AdminBoard.renderFilePreview();
            })));
            if (window.lucide) lucide.createIcons();
        } else {
            pan.style.display = 'none';
        }
    },

    // ticket.attachments gibt es in der v2-API nicht (nie persistiert) -- echte Liste kommt über
    // GET /api/v2/tickets/:id/attachments.
    renderTicketAttachments: async (ticket, selector, { manage = false } = {}) => {
        const container = typeof selector === 'string' ? q(selector) : selector;
        if (!container) return;
        const attachments = await Store.getTicketAttachments(ticket.id);
        const actor = await Store.currentUser();
        const mayManage = manage && ['admin', 'superadmin'].includes(actor?.role) && !ticket.archived;
        container.innerHTML = '';
        container.hidden = attachments.length === 0 && !mayManage;
        if (!attachments.length && !mayManage) return;
        const heading = document.createElement('h4');
        heading.className = 'section-title';
        heading.textContent = Lang.t('attachments');
        const list = document.createElement('div');
        list.className = 'ticket-attachment-list';
        attachments.forEach((file, index) => {
            const item = document.createElement('div'); item.className = 'ticket-attachment-item';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-chip';
            button.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name || Lang.t('attachment'))}</span>`;
            button.onclick = () => AdminBoard.openAttachmentPreview(attachments[index]);
            item.appendChild(button);
            if (mayManage && file.uploadedByUserId === actor.id) {
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-ghost btn-icon btn-sm';
                remove.title = Lang.t('removeOwnAttachment'); remove.setAttribute('aria-label', Lang.t('removeOwnAttachment')); remove.innerHTML = Icon('trash-2', 15);
                remove.onclick = () => UI.confirm(Lang.t('confirmRemoveOwnAttachment'), async () => {
                    const response = await fetch(`/api/v2/attachments/${encodeURIComponent(file.id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
                    if (!response?.ok) return UI.toast(Lang.t('attachmentRemoveFailed'));
                    await AdminBoard.renderTicketAttachments(ticket, container, { manage });
                }, file.name || Lang.t('attachment'));
                item.appendChild(remove);
            }
            list.appendChild(item);
        });
        container.append(heading, list);
        if (mayManage) {
            const add = document.createElement('label'); add.className = 'btn-secondary btn-icon attachment-add';
            add.title = Lang.t('addAttachments'); add.setAttribute('aria-label', Lang.t('addAttachments')); add.tabIndex = 0;
            add.innerHTML = `${Icon('paperclip', 16)}<input type="file" multiple hidden>`;
            const input = add.querySelector('input');
            add.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
            input.accept = Store.uploadAccept();
            input.onchange = async () => {
                const { errors } = await Store.uploadFiles(Array.from(input.files), file => Store.saveAttachment(file, { ticketId: ticket.id }));
                input.value = '';
                if (errors.length) UI.toast(errors.join(' '));
                await AdminBoard.renderTicketAttachments(ticket, container, { manage });
            };
            container.appendChild(add);
        }
        if (window.lucide) lucide.createIcons();
    },

    init: async () => {
        if (!q('.kanban-board')) return;
        if (q('#m-calendar-event-btn') && q('#m-print')) {
            q('#m-calendar-event-btn').classList.remove('btn-xs');
            q('#m-print').before(q('#m-calendar-event-btn'));
        }

        // Superadmin UI Injection
        // Admin UI Visibility
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        const canManageUsers = isSuper || !!user?.canManageUsers;
        const canManage2FA = isSuper || !!user?.canManage2FA;
        const canUsers = canManageUsers || canManage2FA;
        const canReqs = isSuper || (user && user.canManageRequests);

        if (isSuper) AdminBoard.showMfaPolicyHint().catch(() => {});
        const linkedTicket = new URLSearchParams(location.search).get('ticket');
        if (linkedTicket && /^[0-9a-f-]{36}$/i.test(linkedTicket)) {
            history.replaceState(null, '', location.pathname);
            setTimeout(() => AdminBoard.openModal(linkedTicket), 0);
        }

        const actionsForAbsence = q('.topbar-right');
        if (actionsForAbsence && !q('#btn-absence-overview')) {
            const btn = document.createElement('button');
            btn.id = 'btn-absence-overview';
            btn.type = 'button';
            btn.className = 'btn-ghost btn-icon notification-button';
            btn.hidden = true;
            btn.innerHTML = `${Icon('plane', 18)}<span class="notification-count is-neutral"></span>`;
            btn.onclick = () => AdminBoard.openAbsenceOverview();
            actionsForAbsence.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
        }
        await AdminBoard.processAbsences();
        await AdminBoard.refreshAbsenceBadge();
        // Erinnerung/Auto-Schließen bei "Warten auf Benutzer" und wiederkehrende Tickets laufen
        // serverseitig per Timer (jobs/maintenance.ts), kein Client-Trigger mehr noetig.
        AdminBoard.renderAbsenceBanner(user);
        await AdminBoard.openAbsenceReturnPopup(user);
        AdminBoard.openArchivedAuthorDecisions(user);
        AdminBoard.openSubstituteNoticePopups(user);

        if (canUsers) {
            const actions = q('.topbar-right');
            if (actions) {
                if (!q('#btn-manage-users')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-manage-users';
                    btn.className = 'btn-ghost';
                    btn.innerHTML = `${Icon(canManageUsers ? 'users' : 'shield-check', 16)}${canManageUsers ? Lang.t('userMgmt') : '2FA-Verwaltung'}`;
                    btn.onclick = AdminBoard.openUserManager;
                    actions.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
                }
                AdminBoard.orderTopbar();
            }
        }
        // Systemeinstellungen: Superadmins sowie Admins mit mindestens einem Einstellungsbereich.
        if (AdminBoard.settingsTabs(user).length && !q('#btn-sys-settings') && q('.topbar-right')) {
            const btn = document.createElement('button');
            btn.id = 'btn-sys-settings';
            btn.className = 'btn-ghost';
            btn.innerHTML = `${Icon('sliders', 16)}${Lang.t('system')}`;
            btn.onclick = () => AdminBoard.openSystemSettings();
            q('.topbar-right').insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
            AdminBoard.orderTopbar();
        }
        if (isSuper || user?.canViewLogs) {
            const btnLogs = q('#btn-global-logs');
            if (btnLogs) {
                btnLogs.hidden = false;
                btnLogs.onclick = AdminBoard.openGlobalLogsModal;
            }
        }
        AdminBoard.orderTopbar();
        if (window.lucide) lucide.createIcons();

        const reqBoard = q('#requests-board');
        if (reqBoard) {
            reqBoard.style.display = canReqs ? '' : 'none';
        }

        if (q('#btn-open-requests')) q('#btn-open-requests').onclick = async () => {
            await AdminBoard.renderRequests();
            q('#requests-modal').classList.add('open');
        };
        if (q('#requests-modal-close')) q('#requests-modal-close').onclick = () => q('#requests-modal').classList.remove('open');
        if (q('#requests-modal')) q('#requests-modal').onclick = event => {
            if (event.target === q('#requests-modal')) q('#requests-modal').classList.remove('open');
        };

        AdminBoard.groupTopbarMenu(user);
        await UserDash.refreshApprovalBadge();
        await AdminBoard.render();
        AdminBoard.setupDrag();
        if (!AdminBoard.slaRefreshTimer) AdminBoard.slaRefreshTimer = window.setInterval(() => AdminBoard.render(), 60000);

        q('#btn-to-dash')?.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

        // Archive View Toggle
        const btnArch = q('#btn-archive');
        const btnBack = q('#btn-back-kanban');
        const viewKanban = q('#kanban-view');
        const viewArchive = q('#archive-view');

        if (btnArch && viewKanban && viewArchive) {
            btnArch.onclick = () => {
                viewKanban.style.display = 'none';
                viewArchive.style.display = 'block';
                q('#list-view').hidden = true;
                q('.board-banners').hidden = true;
                setListViewButtonState(false);
                AdminBoard.renderArchive();
            };
            btnBack.onclick = () => {
                viewArchive.style.display = 'none';
                viewKanban.style.display = 'block';
                q('#list-view').hidden = true;
                q('.board-banners').hidden = false;
                AdminBoard.render();
            };
        }

        const btnListView = q('#btn-list-view');
        const setListViewButtonState = (active) => {
            if (!btnListView) return;
            btnListView.innerHTML = active ? `${Icon('layout-grid', 16)}${Lang.t('board')}` : `${Icon('table-properties', 16)}${Lang.t('list')}`;
            btnListView.title = active ? Lang.t('switchToBoard') : Lang.t('switchToList');
        };
        if (btnListView) {
            setListViewButtonState(false);
            btnListView.onclick = async () => {
                // Bugfix: style.css [hidden] { display: none !important; } sticht eine per JS
                // gesetzte inline style.display -- #list-view muss deshalb ueber die hidden-
                // Eigenschaft sichtbar/unsichtbar geschaltet werden, nicht ueber style.display.
                const isListActive = !q('#list-view').hidden;
                viewArchive.style.display = 'none';
                q('.board-banners').hidden = false;
                if (isListActive) {
                    q('#list-view').hidden = true;
                    viewKanban.style.display = 'block';
                    setListViewButtonState(false);
                    await AdminBoard.render();
                } else {
                    viewKanban.style.display = 'none';
                    q('#list-view').hidden = false;
                    setListViewButtonState(true);
                    await AdminBoard.openListView();
                }
            };
        }

        const archSearch = q('#archive-search');
        if (archSearch) {
            archSearch.oninput = () => AdminBoard.renderArchive();
        }
        const ticketSearch = q('#admin-ticket-search');
        if (ticketSearch) ticketSearch.oninput = () => AdminBoard.render();
        const btnCreateTicket = q('#btn-admin-create-ticket');
        if (btnCreateTicket) btnCreateTicket.onclick = () => AdminBoard.openCreateTicketModal();
        const btnCreateIncident = q('#btn-admin-create-incident');
        if (btnCreateIncident) btnCreateIncident.onclick = () => AdminBoard.openIncidentCreateModal();

        // Setup Modal
        if (q('#m-close')) q('#m-close').onclick = AdminBoard.closeModal;
        if (q('#ticket-modal')) {
            q('#ticket-modal').onclick = (e) => {
                if (e.target.id === 'ticket-modal' || e.target.classList.contains('modal-container')) {
                    AdminBoard.closeModal();
                }
            };
        }
        // Chat Send (Admin)
        if (q('#btn-chat-send')) {
            q('#btn-chat-send').onclick = () => AdminBoard.postChat('admin');
            q('#m-chat-input').onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') AdminBoard.postChat('admin');
            };
        }

        const noteChannels = [{
                channel: 'admin-chat',
                prefix: 'm-admin-note',
                input: '#m-admin-new-comment',
                send: '#btn-add-admin-comment'
            },
            {
                channel: 'solution',
                prefix: 'm-note',
                input: '#m-new-comment',
                send: '#btn-add-comment'
            }
        ];
        noteChannels.forEach(({
            channel,
            prefix,
            input: inputSelector,
            send
        }) => {
            const noteInput = q(inputSelector);
            const fileInput = q(`#${prefix}-file-input`);
            if (q(send)) q(send).onclick = () => AdminBoard.postInternalComment(channel);
            // Formatierungsleiste nur bei Bedarf einblenden.
            const formatToggle = q(`#${prefix}-format`);
            const toolbar = q(`#${prefix}-toolbar`);
            if (formatToggle && toolbar) formatToggle.onclick = () => {
                toolbar.hidden = !toolbar.hidden;
                formatToggle.setAttribute('aria-expanded', String(!toolbar.hidden));
                formatToggle.classList.toggle('active', !toolbar.hidden);
            };
            const cancelEdit = q(`#${prefix}-cancel`);
            if (cancelEdit) cancelEdit.onclick = () => AdminBoard.resetNoteComposer(channel);
            // Strg/Cmd + Enter sendet; eine offene @-Auswahl verarbeitet Enter vorher selbst.
            if (noteInput) noteInput.addEventListener('keydown', event => {
                if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
                event.preventDefault();
                AdminBoard.postInternalComment(channel);
            });
            if (fileInput) fileInput.onchange = () => {
                Array.from(fileInput.files).forEach(file => AdminBoard.noteFiles[channel].push(file));
                AdminBoard.renderNoteFilePreview(channel);
                fileInput.value = '';
            };
            if (noteInput) {
                q(`#${prefix}-bold`).onclick = () => insertMarkdown(noteInput, '**');
                q(`#${prefix}-italic`).onclick = () => insertMarkdown(noteInput, '*');
                q(`#${prefix}-list`).onclick = () => insertMarkdownList(noteInput);
                const numberedListButton = q(`#${prefix}-numbered`);
                if (numberedListButton) numberedListButton.onclick = () => insertMarkdownList(noteInput, true);
                const tableButton = q(`#${prefix}-table`);
                if (tableButton) tableButton.onclick = () => insertMarkdownTable(noteInput);
                UI.bindListContinuation(noteInput);
                UI.bindPasteFiles(noteInput, files => {
                    files.forEach(file => AdminBoard.noteFiles[channel].push(file));
                    AdminBoard.renderNoteFilePreview(channel);
                });
            }
            const composer = noteInput?.closest('.internal-note-composer');
            if (composer) UI.bindFileDrop(composer, files => {
                files.forEach(file => AdminBoard.noteFiles[channel].push(file));
                AdminBoard.renderNoteFilePreview(channel);
            });
            const search = q(`#${prefix}-search`);
            if (search) search.oninput = async () => {
                const tickets = await Store.getTickets();
                const ticket = tickets.find(item => item.id === AdminBoard.currentTicketId);
                if (ticket) AdminBoard.renderInternalComments(ticket, channel);
            };
        });

        qa('#m-note-type input').forEach(radio => radio.addEventListener('change', AdminBoard.syncSolutionType));
        AdminBoard.syncSolutionType();

        // Date input (Admin) + Formatting
        const fileAdmin = q('#m-chat-file-input');
        if (fileAdmin) {
            fileAdmin.style.display = 'none'; // Ensure hidden
            fileAdmin.onchange = () => {
                Array.from(fileAdmin.files).forEach(f => AdminBoard.selectedFiles.push(f));
                AdminBoard.renderFilePreview();
                fileAdmin.value = '';
            };
        const addAdminChatFiles = files => {
            AdminBoard.selectedFiles.push(...files);
            AdminBoard.renderFilePreview();
        };
        UI.bindPasteFiles(q('#m-chat-input'), addAdminChatFiles);
        UI.bindFileDrop(q('#m-chat-input')?.closest('.chat-composer') || q('#m-chat-input')?.parentElement, addAdminChatFiles);
        }

        // Formatting Buttons
        const boldBtn = q('#m-chat-bold');
        const italicBtn = q('#m-chat-italic');
        const inputArea = q('#m-chat-input');

        if (boldBtn && inputArea) {
            boldBtn.onclick = () => insertMarkdown(inputArea, '**');
        }
        if (italicBtn && inputArea) {
            italicBtn.onclick = () => insertMarkdown(inputArea, '*');
        }
        if (q('#m-chat-link') && inputArea) q('#m-chat-link').onclick = () => insertMarkdownLink(inputArea);

        function insertMarkdown(area, char) {
            const start = area.selectionStart;
            const end = area.selectionEnd;
            const val = area.value;
            const sel = val.substring(start, end);
            const replace = char + sel + char;
            area.value = val.substring(0, start) + replace + val.substring(end);
            area.focus();
            area.selectionStart = start + char.length;
            area.selectionEnd = end + char.length;
        }

        // Archive Action
        if (q('#btn-archive-ticket')) {
            q('#btn-archive-ticket').onclick = AdminBoard.archiveCurrent;
        }

        // Tabs
        qa('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                const parent = btn.parentElement;
                parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const targetId = btn.getAttribute('data-tab');
                const modalBody = parent.parentElement;
                modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                const target = modalBody.querySelector(`#tab-${targetId}`) || modalBody.querySelector(`#${targetId}`);
                if (target) target.classList.add('active');

                if (targetId.includes('chat')) {
                    const box = modalBody.querySelector('.chat-messages');
                    if (box) box.scrollTop = box.scrollHeight;
                }
            };
        });

        // Approve Modal role toggle
        const roleSel = q('#a-role');
        if (roleSel) {
            roleSel.onchange = () => {
                const dept = q('#a-dept-field');
                if (dept) dept.hidden = roleSel.value !== 'admin';
            };
        }

        if (q('#um-close')) q('#um-close').onclick = () => q('#user-man-modal').classList.remove('open');
    },

    // ... render methods ...
    // Eigene laufende Zeiterfassung ({ ticketId, stopped }), gesetzt von WorkTimer.
    activeTimer: null,

    // Rot pulsierendes Symbol an dem Ticket in Board und Liste, fuer das die Zeiterfassung laeuft.
    syncTimerBadges: () => {
        qa('.work-timer-badge').forEach(el => el.remove());
        const timer = AdminBoard.activeTimer;
        if (!timer?.ticketId) return;
        const label = Lang.t(timer.stopped ? 'workTimerPendingBadge' : 'workTimerRunningBadge');
        const badge = () => {
            const el = document.createElement('span');
            el.className = `work-timer-badge${timer.stopped ? ' is-pending' : ''}`;
            el.title = label;
            el.setAttribute('role', 'img');
            el.setAttribute('aria-label', label);
            return el;
        };
        const id = CSS.escape(timer.ticketId);
        qa(`.ticket-card[data-id="${id}"] .card-meta-line`).forEach(line => line.prepend(badge()));
        qa(`#lv-body tr.lv-row[data-id="${id}"] td:nth-child(2)`).forEach(cell => cell.prepend(badge()));
    },

    render: async () => {
        const user = await Store.currentUser();
        // currentUser() liefert null sowohl bei 401 (Sitzung abgelaufen, das behandelt bereits
        // Auth.checkGuard() beim Laden der Seite) als auch bei einem vorübergehenden
        // Serverfehler (z.B. 502 während eines Updates/Neustarts) -- ein harter Abbruch hier
        // ("if (!user) return;") verhinderte zwar den alten Absturz, ließ das Board aber bei
        // JEDEM einzelnen fehlgeschlagenen /users/me-Abruf (z.B. kurzzeitig unter Last, da
        // render() bei jeder Ticket-Aktion erneut aufgerufen wird) komplett unberührt -- eine
        // gerade erfolgreich per Drag&Drop geänderte Spalte oder ein frisch angelegtes Ticket
        // blieb dadurch unsichtbar, obwohl die Änderung auf dem Server längst da war. Jetzt wird
        // nur noch der abteilungsbezogene Filter übersprungen (sicherer Fallback: alles zeigen),
        // das eigentliche Board wird unabhängig davon immer neu aufgebaut.
        const rawTickets = await Store.getTickets();
        let tickets = rawTickets.filter(t => !t.archived);

        // Sichtbarkeit (Gruppe, Zuweisung, Beteiligung) prueft der Server; die Liste ist bereits gefiltert.
        const slaSettings = await Store.getSettings();
        await AdminBoard.refreshOverdueIndicator(tickets, user, slaSettings);
        AdminBoard.refreshAbsenceBadge().catch(() => {});
        const query = q('#admin-ticket-search')?.value || '';
        if (query.trim()) tickets = tickets.filter(ticket => Utils.matchesSearch(query, ticket));
        // Superadmin sees all (no filter)

        const deadlines = new Map(tickets.map(t => [t.id, Store.ticketSlaDueAt(t, slaSettings)]));
        tickets.sort((a, b) => compareTicketUrgency(a, b, t => deadlines.get(t.id)));
        // Arbeitsansichten: jede Person sieht sofort ihre naechsten Aufgaben (Bewertung 11/2026, Abschnitt 4).
        const queues = AdminBoard.boardQueues(user, deadlines, Date.now());
        AdminBoard.renderQueueBar(tickets, queues);
        const activeQueue = queues[AdminBoard.boardQueue] || queues.open;
        const showClosed = AdminBoard.showClosed && AdminBoard.boardQueue === 'open';
        tickets = tickets.filter(t => t.status === 'Geschlossen' ? showClosed : activeQueue.match(t));
        if (q('#col-done')) q('#col-done').hidden = !showClosed;

        const cols = {
            'Neu': q('#list-new'),
            'In Bearbeitung': q('#list-doing'),
            'Warten': q('#list-waiting'),
            'Geschlossen': q('#list-done')
        };
        const counts = {
            'Neu': 0,
            'In Bearbeitung': 0,
            'Warten': 0,
            'Geschlossen': 0
        };

        Object.values(cols).forEach(c => {
            if (c) c.innerHTML = '';
        });

        // Loop tickets but await createCard since it calls Store.getUsers()?
        // createCard uses Store.getUsers() to show assignees properly.
        const allUsers = await Store.getUsers();
        const allGroups = await Store.getGroups();

        let boardTickets = tickets.filter(t => !t.linkedIncidentId);
        if (query.trim()) {
            const incidentIds = new Set(tickets.filter(t => t.linkedIncidentId).map(t => t.linkedIncidentId));
            const incidentsWithHits = rawTickets.filter(t => incidentIds.has(t.id) && !t.archived && !boardTickets.some(b => b.id === t.id));
            boardTickets = boardTickets.concat(incidentsWithHits);
        }
        boardTickets.forEach(t => {
            const boardStatus = String(t.status).startsWith('Warten auf') ? 'Warten' : t.status;
            if (!cols[boardStatus]) {
                if (cols['Neu']) cols['Neu'].appendChild(createCard(t, allUsers));
                return;
            }
            counts[boardStatus]++;
            cols[boardStatus].appendChild(createCard(t, allUsers));
        });

        if (q('#count-new')) q('#count-new').textContent = counts['Neu'];
        if (q('#count-doing')) q('#count-doing').textContent = counts['In Bearbeitung'];
        if (q('#count-waiting')) q('#count-waiting').textContent = counts['Warten'];
        if (q('#count-done')) q('#count-done').textContent = counts['Geschlossen'];
        AdminBoard.syncTimerBadges();
        if (window.lucide) lucide.createIcons();

        AdminBoard.renderRequests();

        function createCard(t, usersList) {
            const card = document.createElement('div');
            const isWaiting = String(t.status || '').startsWith('Warten auf');
            const statusClass = isWaiting ? 'ticket-status-warten' : `ticket-status-${String(t.status || 'Neu').toLowerCase().replace(/\s+/g, '-')}`;
            const isOverdue = Store.isTicketOverdue(t, slaSettings);
            card.className = `ticket-card ${statusClass}${isOverdue ? ' is-overdue' : ''}`;
            card.draggable = true;
            card.dataset.id = t.id;
            card.dataset.ctx = 'ticket';

            const ownerUsername = t.owner || (Array.isArray(t.assignees) ? t.assignees[0] : t.assignee);
            const owner = ownerUsername ? usersList.find(x => x.username === ownerUsername) : null;
            const ownerLabel = owner ? (owner.name || owner.username) : (ownerUsername || Lang.t('unassigned'));
            // Zaehlungen und "letzte Nachricht von Benutzer?" kommen direkt aus der Listen-API
            // (tickets.ts GET /api/v2/tickets) -- t.chat/t.todos/t.comments sind in der Kartenansicht
            // absichtlich leer (echte Inhalte laedt erst die Detailansicht je Ticket nach).
            const awaitingReply = !!t.awaitingReply;
            const todoTotal = t.todoTotal || 0;
            const todoDone = t.todoDone || 0;
            const waitingReason = String(t.status || '').startsWith('Warten auf') ? Lang.status(t.status) : '';

            const linkedCount = t.isMajorIncident ? rawTickets.filter(x => x.linkedIncidentId === t.id && !x.archived).length : 0;
            const catList = (Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean);
            const categoryText = catList.length ? catList.slice(0, 2).join(', ') + (catList.length > 2 ? ` +${catList.length - 2}` : '') : '-';
            const sla = Store.formatSlaCountdown(t, slaSettings);
            const attachmentCount = t.attachmentCount || 0;
            const pendingApprovalEntry = (t.approvals || []).find(a => a.status === 'pending');
            const pendingApproval = !!pendingApprovalEntry;
            const tone = pendingApproval ? 'approval' : isOverdue ? 'overdue' : t.isMajorIncident ? 'incident' : t.prio === 'Kritisch' ? 'critical' : '';
            card.classList.add('card-v2');
            if (tone) card.classList.add(`card-tone-${tone}`);
            card.innerHTML = `
                <div class="card-line card-meta-line">
                    <span title="${Utils.esc(catList.join(', ') || '-')}">${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(categoryText)} · ${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                </div>
                <div class="card-title">${Utils.esc(t.title)}</div>
                <div class="card-line card-deadline-row">
                    ${pendingApproval ? `<span class="card-deadline approval-badge" title="${Utils.esc(pendingApprovalEntry.requestedAt ? Lang.format('awaitingApprovalSince', { date: Utils.fmtDate(pendingApprovalEntry.requestedAt) }) : Lang.t('awaitingApproval'))}">${Icon('hourglass', 11)}${Utils.esc(Lang.t('approvals'))}</span>` : sla ? `<span class="card-deadline sla-text-${sla.tone}" title="Frist: ${Utils.esc(sla.dueDateLabel)}">${Icon(sla.overdue ? 'triangle-alert' : 'timer', 11)}${Utils.esc(sla.label)}</span>` : '<span></span>'}
                    <span class="card-prio-outline prio-${t.prio}">${Lang.prio(t.prio)}</span>
                </div>
                <div class="card-line card-owner-line${ownerUsername ? '' : ' is-unassigned'}">
                    ${waitingReason ? `<span class="card-icon" title="${Utils.esc(waitingReason)}">${Icon('pause-circle', 12)}</span>` : ''}
                    ${awaitingReply ? `<span class="card-icon" title="${Lang.t('replyPending')}">${Icon('message-circle', 12)}</span>` : ''}
                    ${Icon('user', 12)}<span>${Utils.esc(ownerLabel)}</span>
                    ${t.isMajorIncident ? `<span class="t-incident-badge card-incident-badge" title="${Utils.esc(t.incidentNotice || Lang.t('majorIncident'))}">${Icon('siren', 11)}${Lang.t('majorIncident')} · ${linkedCount}</span>` : ''}
                </div>
                <div class="card-hover-meta" aria-hidden="true">
                    <span title="${Lang.t('messages')}">${Icon('message-square', 12)}${t.chatCount || 0}</span>
                    <span title="${Lang.t('internalNotesShort')}">${Icon('notebook-tabs', 12)}${t.noteCount || 0}</span>
                    <span title="${Lang.t('attachments')}">${Icon('paperclip', 12)}${attachmentCount}</span>
                    <span title="${Lang.format('subtasksDoneOf', { done: todoDone, total: todoTotal })}">${Icon('list-checks', 12)}${todoDone}/${todoTotal}</span>
                </div>
            `;
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', t.id);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            if (t.isMajorIncident) {
                card.addEventListener('dragover', e => {
                    const draggedId = e.dataTransfer.types.includes('text/plain');
                    if (!draggedId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    card.classList.add('incident-drop-target');
                });
                card.addEventListener('dragleave', () => card.classList.remove('incident-drop-target'));
                card.addEventListener('drop', async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    card.classList.remove('incident-drop-target');
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (!draggedId || draggedId === t.id) return;
                    const linked = await AdminBoard.linkTicketToIncident(draggedId, t.id);
                    if (linked) UI.toast(Lang.t('ticketLinkedToIncident'));
                });
            }
            card.addEventListener('click', () => AdminBoard.openModal(t.id));
            if (t.status === 'Geschlossen' && !t.archived) {
                const archiveBtn = document.createElement('button');
                archiveBtn.type = 'button';
                archiveBtn.className = 'btn-ghost btn-icon btn-xs card-archive-btn';
                archiveBtn.title = Lang.t('moveToArchive');
                archiveBtn.setAttribute('aria-label', `${Lang.t('moveToArchive')}: ${t.ticketNumber || t.id}`);
                archiveBtn.draggable = false;
                archiveBtn.innerHTML = Icon('archive', 14);
                archiveBtn.addEventListener('click', event => { event.stopPropagation(); AdminBoard.archiveTicketById(t.id); });
                card.classList.add('has-archive-action');
                card.appendChild(archiveBtn);
            }
            return card;
        }
    },

    // START OF MISSING FUNCTIONS
    archiveCurrent: () => AdminBoard.archiveTicketById(AdminBoard.currentTicketId),

    // Archiviert ein Ticket nach Rueckfrage -- aus dem Ticketfenster oder direkt von Karte/Listenzeile.
    archiveTicketById: (id) => {
        UI.confirm(Lang.t('confirmArchiveTicket'), async () => {
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (!t) return;
            t.archived = true;
            t.archivedAt = Utils.nowISO(); // Save archive timestamp
            await Store.addLog(t, 'Ticket archiviert');
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Ticket archiviert', `Titel: ${t.title}`);
            if (AdminBoard.currentTicketId === id && q('#ticket-modal.open')) AdminBoard.closeModal();
            await AdminBoard.render();
            if (q('#list-view') && !q('#list-view').hidden) await AdminBoard.renderListView();
            UI.toast(Lang.t('ticketArchivedToast'));
        });
    },

    // Systemprotokoll mit Filterleiste wie in der Listenansicht: Suche, Person, Bereich, Aktion,
    // Ergebnis und Zeitraum; weitere Filter (eigener Zeitraum, enthaelt/enthaelt nicht) aufklappbar.
    openGlobalLogsModal: async () => {
        let modal = q('#global-logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'global-logs-modal';
            modal.className = 'modal-overlay';
            const opt = (value, key) => `<option value="${value}">${Utils.esc(Lang.t(key))}</option>`;
            modal.innerHTML = `
                <div class="modal modal-xl">
                    <div class="modal-header">
                        <h3>${Icon('scroll-text', 18)} ${Lang.t('systemLog')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="btn-gl-print" title="${Lang.t('printLog')}" aria-label="${Lang.t('printLog')}">${Icon('printer', 16)}</button>
                            <button class="btn-ghost btn-icon" id="global-logs-modal-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="list-view-toolbar log-toolbar">
                        <input type="search" id="gl-search" class="section-search" placeholder="${Lang.t('searchLogsPlaceholder')}" aria-label="${Lang.t('searchLogsPlaceholder')}">
                        <select id="gl-user" aria-label="${Utils.esc(Lang.t('logFilterUser'))}"><option value="">${Utils.esc(Lang.t('logAllUsers'))}</option></select>
                        <select id="gl-area" aria-label="${Utils.esc(Lang.t('logFilterArea'))}">${opt('', 'logAllAreas')}${opt('auth', 'logAreaAuth')}${opt('tickets', 'logAreaTickets')}${opt('users', 'logAreaUsers')}${opt('kb', 'logAreaKb')}${opt('system', 'logAreaSystem')}${opt('other', 'logAreaOther')}</select>
                        <select id="gl-kind" aria-label="${Utils.esc(Lang.t('logFilterKind'))}">${opt('', 'logAllKinds')}${opt('read', 'logKindRead')}${opt('create', 'logKindCreate')}${opt('update', 'logKindUpdate')}${opt('delete', 'logKindDelete')}${opt('auth', 'logKindAuth')}</select>
                        <select id="gl-result" aria-label="${Utils.esc(Lang.t('logFilterResult'))}">${opt('', 'logAllResults')}${opt('ok', 'logResultOk')}${opt('failed', 'logResultFailed')}</select>
                        <select id="gl-range" aria-label="${Utils.esc(Lang.t('logFilterRange'))}">${opt('', 'logRangeAll')}${opt('1h', 'logRangeHour')}${opt('today', 'logRangeToday')}${opt('7d', 'logRange7')}${opt('30d', 'logRange30')}${opt('custom', 'logRangeCustom')}</select>
                        <details class="lv-more" id="gl-more">
                            <summary class="btn-secondary btn-sm">${Icon('sliders-horizontal', 15)}${Lang.t('logMoreFilters')}</summary>
                            <div class="lv-more-body log-more-body">
                                <label>${Lang.t('from')} ${UI.dateTimePickerMarkup('gl-from')}</label>
                                <label>${Lang.t('until')} ${UI.dateTimePickerMarkup('gl-to')}</label>
                                <label><span>${Lang.t('contains')}</span><input type="text" id="gl-include" placeholder="${Lang.t('termsCommaSeparated')}"></label>
                                <label><span>${Lang.t('doesNotContain')}</span><input type="text" id="gl-exclude" placeholder="${Lang.t('termsCommaSeparated')}"></label>
                            </div>
                        </details>
                        <button type="button" class="btn-ghost btn-sm" id="gl-reset">${Icon('rotate-ccw', 14)}${Lang.t('kbFilterReset')}</button>
                        <span class="hint log-count" id="gl-count" role="status"></span>
                    </div>
                    <div class="modal-body flush" id="gl-body"></div>
                </div>`;
            document.body.appendChild(modal);

            const rerender = () => AdminBoard.renderGlobalLogs();
            ['#gl-search', '#gl-include', '#gl-exclude'].forEach(selector => { q(selector).oninput = rerender; });
            ['#gl-user', '#gl-area', '#gl-kind', '#gl-result'].forEach(selector => { q(selector).onchange = rerender; });
            AdminBoard.glFromMs = null;
            AdminBoard.glToMs = null;
            const reload = async () => { await AdminBoard.loadGlobalLogs(); AdminBoard.renderGlobalLogs(); };
            const fromPicker = UI.createDateTimePicker(q('#gl-from'), { onChange: async (ms) => { AdminBoard.glFromMs = ms; q('#gl-range').value = 'custom'; await reload(); } });
            const toPicker = UI.createDateTimePicker(q('#gl-to'), { onChange: async (ms) => { AdminBoard.glToMs = ms; q('#gl-range').value = 'custom'; await reload(); } });
            // Schnellauswahl Zeitraum: setzt den Beginn und laedt die Eintraege dieses Zeitraums vom Server.
            q('#gl-range').onchange = async () => {
                const range = q('#gl-range').value;
                if (range === 'custom') { q('#gl-more').open = true; return; }
                const now = Date.now();
                const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
                AdminBoard.glFromMs = { '1h': now - 3600000, today: startOfDay.getTime(), '7d': now - 7 * 86400000, '30d': now - 30 * 86400000 }[range] ?? null;
                AdminBoard.glToMs = null;
                fromPicker?.setValue?.(AdminBoard.glFromMs);
                toPicker?.setValue?.(null);
                await reload();
            };
            q('#gl-reset').onclick = async () => {
                ['#gl-search', '#gl-include', '#gl-exclude'].forEach(selector => { q(selector).value = ''; });
                ['#gl-user', '#gl-area', '#gl-kind', '#gl-result', '#gl-range'].forEach(selector => { q(selector).value = ''; });
                const reloadNeeded = AdminBoard.glFromMs || AdminBoard.glToMs;
                AdminBoard.glFromMs = null; AdminBoard.glToMs = null;
                fromPicker?.setValue?.(null); toPicker?.setValue?.(null);
                if (reloadNeeded) await AdminBoard.loadGlobalLogs();
                AdminBoard.renderGlobalLogs();
            };
            q('#btn-gl-print').onclick = () => AdminBoard.printGlobalLogs();
            q('#global-logs-modal-close').onclick = () => modal.classList.remove('open');
        }

        await AdminBoard.loadGlobalLogs();
        AdminBoard.renderGlobalLogs();
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Laedt die erste Seite fuer den gewaehlten Zeitraum neu oder haengt (append) die naechstaelteren an.
    glEntries: [],
    glHasMore: false,
    loadGlobalLogs: async (append = false) => {
        const last = append ? AdminBoard.glEntries[AdminBoard.glEntries.length - 1] : null;
        const page = await Store.getGlobalLogs({
            from: AdminBoard.glFromMs ?? null,
            to: AdminBoard.glToMs ? AdminBoard.glToMs + 59999 : null,
            before: last?.raw?.created_at ?? null,
            beforeId: last?.raw?.id ?? null
        });
        AdminBoard.glEntries = append ? [...AdminBoard.glEntries, ...page.entries] : page.entries;
        AdminBoard.glHasMore = page.hasMore;
    },

    getFilteredGlobalLogs: async () => {
        const logs = AdminBoard.glEntries || [];
        const search = q('#gl-search')?.value.toLowerCase().trim() || '';
        const from = AdminBoard.glFromMs ?? -Infinity;
        const to = AdminBoard.glToMs ? AdminBoard.glToMs + 59999 : Infinity;
        const terms = value => String(value || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const include = terms(q('#gl-include')?.value);
        const exclude = terms(q('#gl-exclude')?.value);
        const user = q('#gl-user')?.value || '';
        const area = q('#gl-area')?.value || '';
        const kind = q('#gl-kind')?.value || '';
        const result = q('#gl-result')?.value || '';
        return logs.filter(log => {
            const timestamp = new Date(log.date).getTime();
            const text = `${log.user || ''} ${log.action || ''} ${log.details || ''}`.toLowerCase();
            return Utils.matchesSearch(search, log)
                && timestamp >= from && timestamp <= to
                && (!user || log.user === user)
                && (!area || log.area === area)
                && (!kind || log.kind === kind)
                && (!result || (result === 'failed') === !!log.failed)
                && include.every(term => text.includes(term))
                && !exclude.some(term => text.includes(term));
        });
    },

    printGlobalLogs: async () => {
        const visibleLogs = await AdminBoard.getFilteredGlobalLogs();
        const settings = await Store.getSettings();
        const company = settings.companyConfig || {};
        const companyLogo = company.logoUrl || settings.companyBrandingConfig?.logoDataUrl || '';
        const actor = await Store.currentUser();
        const rows = visibleLogs.map(l => `
            <tr>
                <td>${Utils.esc(Utils.fmtDate(l.date))}</td>
                <td>${Utils.esc(l.user || '-')}</td>
                <td>${Utils.esc(l.action || '-')}</td>
                <td>${Utils.esc(l.details || '')}</td>
            </tr>`).join('');
        const html = `<!DOCTYPE html><html lang="${Lang.current}"><head><meta charset="UTF-8"><title>${Lang.t('systemLog')}</title>
            <link rel="stylesheet" href="/js/print.css"></head><body>
            <div class="print-head">
                <div>
                    <h1>${Lang.t('systemLog')}</h1>
                    <div class="meta">${Lang.format('printedByOnEntries', { name: Utils.esc(actor?.name || actor?.username || '-'), date: Utils.esc(Utils.fmtDate(new Date().toISOString())), count: visibleLogs.length })}</div>
                </div>
                ${companyLogo ? `<img src="${Utils.esc(companyLogo)}" alt="Logo">` : ''}
            </div>
            <table><thead><tr><th>${Lang.t('dateTime')}</th><th>${Lang.t('user')}</th><th>${Lang.t('action')}</th><th>${Lang.t('details')}</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4">${Lang.t('noEntriesFound')}</td></tr>`}</tbody></table>
            </body></html>`;
        UI.printHTML(html);
    },

    renderGlobalLogs: async () => {
        const body = q('#gl-body');
        if (!body) return;

        const userSelect = q('#gl-user');
        if (userSelect) {
            const keep = userSelect.value;
            const people = [...new Set((AdminBoard.glEntries || []).map(log => log.user).filter(Boolean))].sort((a, b) => a.localeCompare(b, Lang.current));
            userSelect.innerHTML = `<option value="">${Utils.esc(Lang.t('logAllUsers'))}</option>` + people.map(name => `<option value="${Utils.esc(name)}">${Utils.esc(name)}</option>`).join('');
            if (people.includes(keep)) userSelect.value = keep;
        }
        const visibleLogs = await AdminBoard.getFilteredGlobalLogs();
        const countEl = q('#gl-count');
        if (countEl) countEl.textContent = Lang.format(AdminBoard.glHasMore ? 'logCountMore' : 'logCount', { count: visibleLogs.length, total: (AdminBoard.glEntries || []).length });
        const iconForLog = (action = '') => {
            const text = action.toLowerCase();
            if (text.includes('geloescht') || text.includes('geaendert')) return text.includes('geloescht') ? 'trash-2' : 'refresh-cw';
            if (text.includes('gelöscht') || text.includes('geleert')) return 'trash-2';
            if (text.includes('erstellt') || text.includes('genehmigt')) return 'plus-circle';
            if (text.includes('status') || text.includes('geändert') || text.includes('bearbeitet')) return 'refresh-cw';
            if (text.includes('anmeldung')) return 'log-in';
            if (text.includes('abmeldung')) return 'log-out';
            if (text.includes('ticket')) return 'ticket';
            if (text.includes('benutzer')) return 'user-round';
            return 'activity';
        };
        body.innerHTML = (visibleLogs.length ?
            visibleLogs.map(l => UI.logRow({
                icon: l.icon || iconForLog(l.action),
                user: l.user,
                date: l.date,
                action: l.action,
                details: l.details
            })).join('') :
            `<div class="empty-state">${Lang.t('noEntriesFound')}</div>`)
            + (AdminBoard.glHasMore ? `<div class="log-load-more"><button type="button" class="btn-secondary btn-sm" id="gl-load-more">${Lang.t('loadOlderEntries')}</button></div>` : '');
        const more = q('#gl-load-more');
        if (more) more.onclick = async () => {
            more.disabled = true;
            await AdminBoard.loadGlobalLogs(true);
            AdminBoard.renderGlobalLogs();
        };
        if (window.lucide) lucide.createIcons();
    },

    // User Manager Logic
    // view: 'users' | 'admins' | 'groups'. Kategorien liegen in den Systemeinstellungen (Querverweis per Symbol).
    openUserManager: async (view = 'users') => {
        const modal = q('#user-man-modal');
        modal.classList.add('open');

        // Setup UM Tabs
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        if (!isSuper || typeof view !== 'string') view = 'users';
        await AdminBoard.renderUserManager(view);

        let tabs = modal.querySelector('.um-tabs');
        if (tabs) tabs.remove();

        tabs = document.createElement('div');
        tabs.className = 'um-tabs tabs';

        tabs.innerHTML = `
            <div class="tab-btn${view === 'users' ? ' active' : ''}" data-view="users">${Utils.esc(Lang.t('usersTab'))}</div>
            ${isSuper ? `<div class="tab-btn${view === 'admins' ? ' active' : ''}" data-view="admins">${Utils.esc(Lang.t('adminsTab'))}</div>` : ''}
            ${isSuper ? `<div class="tab-btn${view === 'groups' ? ' active' : ''}" data-view="groups">${Utils.esc(Lang.t('groupsTab'))}</div>` : ''}
        `;

        const header = modal.querySelector('.modal-header');
        header.insertAdjacentElement('afterend', tabs);

        tabs.querySelectorAll('.tab-btn').forEach(b => {
            b.onclick = () => {
                tabs.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                AdminBoard.renderUserManager(b.dataset.view);
            };
        });
    },

    renderUserManager: async (view) => {
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';
        const canManageUsers = isSuper || !!currentUser?.canManageUsers;
        const canManage2FA = isSuper || !!currentUser?.canManage2FA;
        // Non-supers can ONLY see 'users'
        if (!isSuper) view = 'users';

        const listContainer = q('#um-list');
        listContainer.className = 'user-list-container';

        // Skeleton for search and actions
        if (!q('#um-search')) {
            listContainer.innerHTML = `
                <div class="um-controls">
                    <input type="text" id="um-search" class="um-search" placeholder="Durchsuchen...">
                    <div id="um-actions" class="um-actions"></div>
                </div>
                <div id="um-results"></div>
            `;
            q('#um-search').focus();
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        } else {
            q('#um-search').oninput = () => AdminBoard.renderUserManager(view);
        }

        const searchTerm = q('#um-search').value.toLowerCase();
        const actions = q('#um-actions');
        const list = q('#um-results');
        list.className = 'user-list';
        list.innerHTML = '';

        if (view === 'users' || view === 'admins') {
            actions.innerHTML = `
                ${canManageUsers ? `<button class="btn-secondary btn-icon" id="btn-csv-export" title="CSV-Export" aria-label="CSV-Export">${Icon('download', 16)}</button>` : ''}
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-csv-import" title="CSV-Import" aria-label="CSV-Import">${Icon('upload', 16)}</button>` : ''}
                ${isSuper ? `<button class="btn-secondary btn-icon" id="btn-ldap-sync" title="LDAP-Sync" aria-label="LDAP-Sync">${Icon('refresh-cw', 16)}</button>` : ''}
                ${canManageUsers ? `<button class="btn-primary" id="btn-add-user">${Icon('plus', 16)}Neu</button>` : ''}
            `;
            if (actions.querySelector('#btn-add-user')) actions.querySelector('#btn-add-user').onclick = () => AdminBoard.openEditUserModal(null, view);
            if (actions.querySelector('#btn-csv-export')) actions.querySelector('#btn-csv-export').onclick = () => AdminBoard.exportUsersCSV();
            if (isSuper) {
                actions.querySelector('#btn-csv-import').onclick = () => AdminBoard.importUsersCSV();
                actions.querySelector('#btn-ldap-sync').onclick = () => {
                    UI.toast('LDAP Sync gestartet...');
                    setTimeout(() => UI.toast('LDAP Sync erfolgreich (Simuliert)'), 1500);
                };
            }
        } else if (view === 'groups') {
            actions.innerHTML = `<button class="btn-secondary" id="btn-goto-cats" title="${Utils.esc(Lang.t('manageCategoriesLink'))}">${Icon('tags', 16)}${Utils.esc(Lang.t('categoriesLabel'))}</button>
                <button class="btn-primary" id="btn-add-group">${Icon('plus', 16)}${Utils.esc(Lang.t('newGroup'))}</button>`;
            actions.querySelector('#btn-add-group').onclick = () => AdminBoard.openEditGroupModal(null);
            actions.querySelector('#btn-goto-cats').onclick = () => AdminBoard.openSystemSettings('sys-categories');
        }

        if (view === 'groups') {
            const groups = await Store.getGroups();
            const filteredGroups = groups.filter(g => Utils.matchesSearch(searchTerm, g));

            const parentLabel = id => groups.find(item => item.id === id)?.label || '';
            filteredGroups.forEach(g => {
                const el = document.createElement('div');
                el.className = 'table-row user-manager-row group-row';
                // Bei einer Suche flach anzeigen, sonst nach Ebene eingerueckt.
                el.style.setProperty('--group-depth', searchTerm ? 0 : g.depth || 0);
                el.innerHTML = `
                    <div class="user-manager-text">
                        <span class="user-manager-name">${g.depth && !searchTerm ? '<span class="group-branch" aria-hidden="true">↳</span>' : ''}${Icon(g.depth ? 'users' : 'users-round', 15)}${Utils.esc(g.name)}</span>
                        <span class="row-sub">${g.parentId ? Utils.esc(Lang.format('subgroupOf', { name: parentLabel(g.parentId) })) : Utils.esc(g.description || '-')}</span>
                        <span class="badge">${(g.members || []).length} ${(g.members || []).length === 1 ? Lang.t('member') : Lang.t('members')}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon cats-g" title="${Utils.esc(Lang.t('categoriesOfGroup'))}" aria-label="${Utils.esc(Lang.t('categoriesOfGroup'))}">${Icon('tags', 16)}</button>
                        <button class="btn-ghost btn-icon members-g" title="${Lang.t('viewMembers')}" aria-label="${Lang.t('viewMembers')}">${Icon('list', 16)}</button>
                        <button class="btn-ghost btn-icon edit-g" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-g" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                `;
                el.querySelector('.members-g').onclick = () => AdminBoard.openGroupMembers(g);
                el.querySelector('.cats-g').onclick = () => AdminBoard.openSystemSettings('sys-categories', { groupId: g.id });
                el.querySelector('.edit-g').onclick = () => AdminBoard.openEditGroupModal(g);
                el.querySelector('.del-g').onclick = () => {
                    UI.confirm(Lang.format('confirmDeleteGroup', { name: g.name }), async () => {
                        if (!(await Store.deleteGroup(g.id))) return UI.toast(Lang.t('groupDeleteFailed'));
                        Store._usersCache = null;
                        AdminBoard.renderUserManager('groups');
                    });
                };
                list.appendChild(el);
            });
            if (window.lucide) lucide.createIcons();
            return;
        }


        const users = await Store.getUsers();
        const groups = await Store.getGroups();
        const filtered = users.filter(u => {
            const matchesView = (view === 'users' && u.role === 'user') ||
                (view === 'admins' && (u.role === 'admin' || u.role === 'superadmin'));
            if (!matchesView) return false;
            if (u.accountArchived && !AdminBoard.showArchivedUsers) return false;
            if (!canManageUsers && (!canManage2FA || !u.twoFactorEnabled)) return false;

            return Utils.matchesSearch(searchTerm, u, groups.filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id)));
        });

        const archivedToggle = document.createElement('label');
        archivedToggle.className = 'check-row compact';
        archivedToggle.innerHTML = `<input type="checkbox" ${AdminBoard.showArchivedUsers ? 'checked' : ''}><span>${Lang.t('showArchivedUsers')}</span>`;
        archivedToggle.querySelector('input').onchange = e => {
            AdminBoard.showArchivedUsers = e.target.checked;
            AdminBoard.renderUserManager(view);
        };
        list.appendChild(archivedToggle);

        filtered.forEach(u => {
            const el = document.createElement('div');
            el.className = 'table-row user-manager-row';

            const roleInfo = u.role.toUpperCase();
            const validityExpired = u.accountValidUntil && u.accountValidUntil < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
            const userGroups = groups
                .filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id))
                .map(g => g.name);

            el.innerHTML = `
                <div class="user-manager-text">
                    <span class="user-manager-name">${Utils.esc(u.username)}${u.twoFactorEnabled ? `<span class="badge badge-accent" title="${Lang.t('twoFaActive')}">${Icon('shield-check', 12)}2FA</span>` : ''}${u.accountLocked ? `<span class="badge badge-danger" title="${Lang.t('lockedAfterFailedAttempts')}">${Icon('lock', 12)}${Lang.t('locked')}</span>` : ''}${u.lockedUntil && u.lockedUntil > Date.now() ? `<span class="badge badge-danger" title="${Lang.t('temporarilyLockedAfterFailedAttempts')}">${Icon('lock', 12)}${Lang.format('lockedUntilTime', { time: new Date(u.lockedUntil).toLocaleTimeString(Lang.current === 'en' ? 'en-US' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) })}</span>` : ''}${u.accountArchived ? `<span class="badge" title="${Lang.t('archived')}">${Icon('archive', 12)}${Lang.t('archived')}</span>` : ''}</span>
                    <span class="row-sub">${Utils.esc(u.name || '-')} · ${Utils.esc(u.email || Lang.t('noEmail'))}</span>
                    ${u.accountValidUntil ? `<span class="badge ${validityExpired ? 'badge-danger' : ''}">${Icon(validityExpired ? 'lock' : 'calendar', 12)}${validityExpired ? Lang.t('expired') : Lang.t('validUntil')} ${Utils.esc(u.accountValidUntil.split('-').reverse().join('.'))}</span>` : ''}
                    <div class="group-chip-row">
                        <span class="badge">${Utils.esc(roleInfo)}</span>
                        ${userGroups.map(name => `<span class="group-chip">${Icon('users-round', 12)}${Utils.esc(name)}</span>`).join('')}
                        ${u.absence?.active ? `<span class="badge badge-accent" title="${Utils.esc(AdminBoard.absenceInfoText(u.absence))}">${Icon('plane', 12)}${Lang.t('absent')}${u.absence.substitute ? ' → ' + Utils.esc((users.find(x => x.username === u.absence.substitute)?.name) || u.absence.substitute) : ' → ' + Lang.t('backToTeam')} · ${Utils.esc(AdminBoard.absenceInfoText(u.absence).split(' · ')[0])}</span>` : ''}
                        ${u.absence?.pending ? `<span class="badge" title="${Utils.esc(AdminBoard.absenceInfoText(u.absence))}">${Icon('plane', 12)}${Lang.t('planned')} · ${Utils.esc(AdminBoard.absenceInfoText(u.absence))}</span>` : ''}
                    </div>
                </div>
                <div class="user-manager-actions">
                    ${(isSuper || canManage2FA) && u.twoFactorEnabled ? `<button class="btn-ghost btn-sm reset-2fa" title="${Lang.t('reset2FA')}">${Icon('unlock-keyhole', 15)}2FA</button>` : ''}
                    ${isSuper && u.id !== currentUser?.id ? `<button class="btn-ghost btn-icon export-u" title="${Lang.t('dataExportForUser')}" aria-label="${Lang.t('dataExportForUser')}">${Icon('file-down', 16)}</button>` : ''}
                    ${(isSuper || (canManage2FA && u.role === 'user')) && !u.twoFactorEnabled && !u.accountArchived && u.id !== currentUser?.id ? `<button class="btn-ghost btn-icon enroll-2fa" title="${Lang.t('mfaEnrollCodeCreate')}" aria-label="${Lang.t('mfaEnrollCodeCreate')}">${Icon('key-round', 16)}</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' && !u.accountArchived ? `<button class="btn-ghost btn-icon lock-u" title="${u.accountLocked ? Lang.t('unlock') : Lang.t('lock')}" aria-label="${u.accountLocked ? Lang.t('unlock') : Lang.t('lock')}">${Icon(u.accountLocked ? 'lock-open' : 'lock', 16)}</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' ? `<button class="btn-ghost btn-icon archive-u" title="${u.accountArchived ? Lang.t('reactivate') : Lang.t('archiveAction')}" aria-label="${u.accountArchived ? Lang.t('reactivate') : Lang.t('archiveAction')}">${Icon(u.accountArchived ? 'archive-restore' : 'archive', 16)}</button>` : ''}
                    ${view === 'admins' && canManageUsers ? `<button class="btn-ghost btn-icon absence-btn" title="${Lang.t('absenceAndSubstitute')}" aria-label="${Lang.t('absenceAndSubstitute')}">${Icon('plane', 16)}</button>` : ''}
                    ${canManageUsers ? `<button class="btn-ghost btn-icon edit-u" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>` : ''}
                    ${canManageUsers && u.role !== 'superadmin' && u.username !== 'admin' ? `<button class="btn-ghost btn-icon btn-danger del-u" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>` : ''}
                </div>
            `;

            const absenceBtn = el.querySelector('.absence-btn');
            if (absenceBtn) absenceBtn.onclick = () => AdminBoard.openAbsenceModal(u.username);

            const lockBtn = el.querySelector('.lock-u');
            if (lockBtn) lockBtn.onclick = async () => {
                const users = await Store.getUsers();
                const target = users.find(x => x.id === u.id);
                if (!target) return;
                target.accountLocked = !target.accountLocked;
                if (!target.accountLocked) target.failedLogins = 0;
                await Store.saveUsers(users);
                await Store.addGlobalLog(target.accountLocked ? 'Konto gesperrt' : 'Konto entsperrt', `Benutzer: ${u.username}`);
                UI.toast(target.accountLocked ? Lang.t('accountLockedToast') : Lang.t('accountUnlockedToast'));
                AdminBoard.renderUserManager(view);
            };

            const archiveBtn = el.querySelector('.archive-u');
            if (archiveBtn) archiveBtn.onclick = () => {
                const restoring = !!u.accountArchived;
                UI.confirm(restoring ? Lang.format('confirmReactivateAccount', { username: u.username }) : Lang.format('confirmArchiveAccount', { username: u.username }), async () => {
                    const users = await Store.getUsers();
                    const target = users.find(x => x.id === u.id);
                    if (!target) return;
                    target.accountArchived = !restoring;
                    if (restoring) target.accountLocked = false;
                    target.failedLogins = 0;
                    await Store.saveUsers(users);
                    await AdminBoard.applyArchiveConsequences(target, restoring);
                    await Store.addGlobalLog(restoring ? 'Konto reaktiviert' : 'Konto archiviert', `Benutzer: ${u.username}`);
                    UI.toast(restoring ? Lang.t('accountReactivatedToast') : Lang.t('accountArchivedToast2'));
                    AdminBoard.renderUserManager(view);
                });
            };

            el.querySelector('.export-u')?.addEventListener('click', async () => {
                const stepUp = await AdminBoard.confirmStepUp(Lang.format('dataExportForUserConfirm', { username: u.username }));
                if (stepUp) await Settings.downloadPersonalData(u.id, stepUp);
            });

            const enrollBtn = el.querySelector('.enroll-2fa');
            if (enrollBtn) enrollBtn.onclick = () => UI.confirm(Lang.format('mfaEnrollCodeConfirm', { username: u.username }), async () => {
                const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}/mfa-enroll-code`, { method: 'POST', credentials: 'same-origin' }).catch(() => null);
                const payload = await res?.json().catch(() => ({})) || {};
                if (!res || !res.ok || !payload.code) return UI.toast(Lang.t('mfaEnrollCodeFailed'));
                const modal = AdminBoard.openDialog({
                    id: 'mfa-enroll-code-modal',
                    title: Lang.t('mfaEnrollCodeTitle'),
                    icon: 'key-round',
                    size: 'sm',
                    body: `<p>${Utils.esc(Lang.format('mfaEnrollCodeIntro', { username: u.username, date: Utils.fmtDate(payload.expires_at) }))}</p>
                        <div class="code-copy"><pre class="update-guide-code backup-hash"><code>${Utils.esc(payload.code)}</code></pre>${AdminBoard.copyButton()}</div>
                        <p class="hint">${Lang.t('mfaEnrollCodeHint')}</p>`
                });
                modal.addEventListener('click', AdminBoard.handleCopyClick);
            });

            if (el.querySelector('.reset-2fa')) {
                el.querySelector('.reset-2fa').onclick = () => {
                    UI.confirm(Lang.format('confirmReset2FA', { username: u.username }), async () => {
                        const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}/mfa-reset`, {
                            method: 'POST',
                            credentials: 'same-origin'
                        }).catch(() => null);
                        if (res && res.ok) {
                            UI.toast(Lang.t('mfaResetToast'));
                            AdminBoard.renderUserManager(view);
                        } else {
                            UI.toast(Lang.t('mfaResetFailed'));
                        }
                    });
                };
            }

            const delBtn = el.querySelector('.del-u');
            if (delBtn) delBtn.onclick = () => {
                q('#user-delete-modal')?.remove();
                const confirmModal = AdminBoard.createGenericModal();
                confirmModal.id = 'user-delete-modal';
                const title = confirmModal.querySelector('h3');
                const content = confirmModal.querySelector('.modal-body');
                const footer = confirmModal.querySelector('.modal-footer');

                title.textContent = Lang.t('deleteUser');
                content.innerHTML = `
                    <p>${Lang.format('confirmDeleteUserBody', { username: Utils.esc(u.username) })}</p>
                    <div class="checkbox-list">
                        <label class="check-row"><input type="radio" name="del-opt" value="archive" checked><span>${Lang.t('archiveTicketsRecommended')}</span></label>
                        <label class="check-row"><input type="radio" name="del-opt" value="delete"><span>${Lang.t('deleteTicketsIrrevocably')}</span></label>
                    </div>
                `;

                footer.innerHTML = `
                    <button class="btn-secondary close-m">${Lang.t('cancel')}</button>
                    <button class="btn-danger" id="btn-perform-del">${Icon('trash-2', 16)}${Lang.t('delete')}</button>
                `;

                confirmModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => confirmModal.classList.remove('open'));
                if (window.lucide) lucide.createIcons();

                confirmModal.querySelector('#btn-perform-del').onclick = async () => {
                    const opt = confirmModal.querySelector('input[name="del-opt"]:checked').value;
                    const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}?tickets=${opt}`, {
                        method: 'DELETE', credentials: 'same-origin'
                    }).catch(() => null);
                    if (!res || !res.ok) return UI.toast(Lang.t('userDeleteFailed'));
                    Store._usersCache = null;
                    Store._ticketsCache = null;
                    UI.toast(Lang.format('userDeletedToast', { username: u.username }));
                    confirmModal.classList.remove('open');
                    AdminBoard.renderUserManager(view);
                };

                confirmModal.classList.add('open');
            };

            el.querySelector('.edit-u')?.addEventListener('click', () => AdminBoard.openEditUserModal(u, view));
            list.appendChild(el);
        });
        if (window.lucide) lucide.createIcons();
    },

    // category: Kategorie-Objekt aus Store.getCategories() (oder null für "Neu"). Die alte
    // "Admins dieser Kategorie"-Zuordnung gibt es im Backend nicht (nur auto_assign_group_id
    // für eine ganze Gruppe) und wurde entfernt, statt etwas Ungespeichertes vorzutäuschen.
    openEditCategoryModal: async (category, { onSaved = null } = {}) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');

        const groups = await Store.getGroups();
        const actor = await Store.currentUser();
        title.textContent = category ? Lang.t('editCategory') : Lang.t('newCategory');
        content.innerHTML = `
            <div class="field">
                <label for="g-input">${Lang.t('name')}</label>
                <input type="text" id="g-input" maxlength="128" value="${Utils.esc(category?.name || '')}" placeholder="${Lang.t('egTechnik')}">
            </div>
            <div class="field">
                <div class="label-row"><label>${Lang.t('autoAssignToGroup')}</label>
                    ${actor?.role === 'superadmin' ? `<button type="button" class="btn-ghost btn-icon btn-xs" id="cat-goto-groups" title="${Utils.esc(Lang.t('manageGroupsLink'))}" aria-label="${Utils.esc(Lang.t('manageGroupsLink'))}">${Icon('users-round', 14)}</button>` : ''}</div>
                <div id="cat-auto-group"></div>
            </div>
            <label class="check-row"><input type="checkbox" id="cat-show-portal"${category?.showInPortal === false ? '' : ' checked'}><span class="check-text"><strong>${Lang.t('showInServiceBar')}</strong><span>${Lang.t('showInServiceBarHint')}</span></span></label>
            ${category ? `<div class="setting-row"><span class="hint">${Utils.esc(Lang.format('faqTipCount', { count: category.faq?.items?.length || 0 }))}</span>
                <button type="button" class="btn-secondary btn-sm" id="cat-edit-faq">${Icon('lightbulb', 15)}${Lang.t('faqEdit')}</button></div>` : ''}
            <div class="field field-wide">
                <label>${Lang.t('customFieldsForCategory')}</label>
                <p class="hint">${Lang.t('customFieldsHint')}</p>
                <div id="cat-custom-fields" class="custom-fields-editor"></div>
                <button type="button" class="btn-secondary btn-sm" id="cat-add-field">${Icon('plus', 15)}${Lang.t('addField')}</button>
            </div>
        `;
        const autoGroupPicker = UI.createMultiSelect(q('#cat-auto-group'), groups.map(g => ({ value: g.id, label: g.label || g.name })), category?.autoAssignGroupId || '', null, { single: true, emptyLabel: Lang.t('none') });
        q('#cat-goto-groups')?.addEventListener('click', () => { modal.classList.remove('open'); AdminBoard.openUserManager('groups'); });
        q('#cat-edit-faq')?.addEventListener('click', () => { modal.classList.remove('open'); CategoryFaq.edit(category, { onSaved: () => (onSaved ? onSaved() : AdminBoard.renderCategorySettings()) }); });

        const existingFields = category?.customFields ? category.customFields.slice() : [];
        const fieldsContainer = q('#cat-custom-fields');
        // Aktuelle Eingaben aus dem DOM zurück ins Array schreiben, bevor neu gerendert wird --
        // sonst gehen Änderungen beim Hinzufügen/Entfernen eines anderen Feldes verloren.
        const syncFieldsFromDOM = () => {
            fieldsContainer.querySelectorAll('.custom-field-row').forEach(row => {
                const idx = Number(row.dataset.index);
                if (!existingFields[idx]) return;
                existingFields[idx].label = row.querySelector('.cf-label').value;
                existingFields[idx].type = row.querySelector('.cf-type').value;
                existingFields[idx].required = row.querySelector('.cf-required').checked;
                existingFields[idx].options = [...row.querySelectorAll('.cf-option-input')].map(i => i.value);
            });
        };
        const renderOptionsList = (row, f, i) => {
            const list = row.querySelector('.cf-options-list');
            list.innerHTML = (f.options || []).map((opt, oi) => `
                <div class="cf-option-row" data-opt-index="${oi}">
                    <input type="text" class="cf-option-input" placeholder="${Lang.t('optionPlaceholder')}" value="${Utils.esc(opt)}">
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger cf-option-remove" title="${Lang.t('removeOption')}" aria-label="${Lang.t('removeOption')}">${Icon('x', 13)}</button>
                </div>`).join('') || `<div class="hint">${Lang.t('noOptionsYet')}</div>`;
            list.querySelectorAll('.cf-option-input').forEach((input, oi) => {
                input.oninput = () => { f.options[oi] = input.value; };
            });
            list.querySelectorAll('.cf-option-remove').forEach((btn, oi) => {
                btn.onclick = () => { f.options.splice(oi, 1); renderOptionsList(row, f, i); };
            });
        };
        const renderFieldRows = () => {
            fieldsContainer.innerHTML = existingFields.length ? existingFields.map((f, i) => `
                <div class="custom-field-row" data-index="${i}">
                    <div class="custom-field-row-main">
                        <input type="text" class="cf-label" placeholder="${Lang.t('fieldNamePlaceholder')}" value="${Utils.esc(f.label || '')}">
                        <select class="cf-type">
                            <option value="text" ${f.type === 'text' ? 'selected' : ''}>${Lang.t('fieldTypeText')}</option>
                            <option value="number" ${f.type === 'number' ? 'selected' : ''}>${Lang.t('fieldTypeNumber')}</option>
                            <option value="select" ${f.type === 'select' ? 'selected' : ''}>${Lang.t('fieldTypeSelect')}</option>
                        </select>
                        <label class="check-row compact"><input type="checkbox" class="cf-required" ${f.required ? 'checked' : ''}>${Lang.t('required')}</label>
                        <button type="button" class="btn-ghost btn-icon btn-xs btn-danger cf-remove" title="${Lang.t('removeField')}" aria-label="${Lang.t('removeField')}">${Icon('x', 14)}</button>
                    </div>
                    <div class="cf-options-editor" ${f.type === 'select' ? '' : 'hidden'}>
                        <div class="cf-options-list"></div>
                        <button type="button" class="btn-ghost btn-sm cf-add-option">${Icon('plus', 13)}${Lang.t('addOption')}</button>
                    </div>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noCustomFieldsDefined')}</div>`;
            fieldsContainer.querySelectorAll('.custom-field-row').forEach(row => {
                const i = Number(row.dataset.index);
                const f = existingFields[i];
                renderOptionsList(row, f, i);
                row.querySelector('.cf-type').onchange = (e) => {
                    row.querySelector('.cf-options-editor').hidden = e.target.value !== 'select';
                };
                row.querySelector('.cf-add-option').onclick = () => {
                    syncFieldsFromDOM();
                    f.options = [...(f.options || []), ''];
                    renderOptionsList(row, f, i);
                };
            });
            fieldsContainer.querySelectorAll('.cf-remove').forEach(btn => {
                btn.onclick = () => {
                    syncFieldsFromDOM();
                    const idx = Number(btn.closest('.custom-field-row').dataset.index);
                    existingFields.splice(idx, 1);
                    renderFieldRows();
                };
            });
            if (window.lucide) lucide.createIcons();
        };
        renderFieldRows();
        q('#cat-add-field').onclick = () => {
            syncFieldsFromDOM();
            existingFields.push({ id: Utils.uid(), label: '', type: 'text', required: false, options: [] });
            renderFieldRows();
        };

        confirmBtn.textContent = Lang.t('save');
        modal.classList.add('open');
        confirmBtn.onclick = async () => {
            const val = q('#g-input').value.trim();
            if (!val) return;

            const collectedFields = Array.from(fieldsContainer.querySelectorAll('.custom-field-row')).map(row => ({
                id: existingFields[Number(row.dataset.index)]?.id || Utils.uid(),
                label: row.querySelector('.cf-label').value.trim(),
                type: row.querySelector('.cf-type').value,
                required: row.querySelector('.cf-required').checked,
                options: row.querySelector('.cf-type').value === 'select' ? [...row.querySelectorAll('.cf-option-input')].map(i => i.value.trim()).filter(Boolean) : []
            })).filter(f => f.label);
            const autoAssignGroupId = autoGroupPicker.getValue() || null;
            const showInPortal = q('#cat-show-portal').checked;

            const ok = category
                ? await Store.updateCategory(category.id, { name: val, autoAssignGroupId, customFields: collectedFields, showInPortal })
                : await Store.createCategory({ name: val, autoAssignGroupId, customFields: collectedFields, showInPortal });
            if (!ok) return UI.toast(Lang.t('categorySaveFailed'));

            modal.classList.remove('open');
            if (onSaved) await onSaved(); else await AdminBoard.renderCategorySettings();
            UI.toast(category ? Lang.t('categoryEdited') : Lang.t('categoryCreated'));
        };
    },

    // Systemeinstellungen > Kategorien: Liste mit Suche, Gruppenfilter, Themenleiste je Kategorie,
    // F&A und Querverweis zur Gruppe. groupId filtert auf Kategorien mit automatischer Zuweisung an diese Gruppe.
    categoryFilterGroupId: null,
    renderCategorySettings: async (groupId) => {
        const panel = q('#sys-categories-list');
        if (!panel) return;
        if (groupId !== undefined) AdminBoard.categoryFilterGroupId = groupId;
        const filterGroup = AdminBoard.categoryFilterGroupId;
        const [categories, groups, actor] = await Promise.all([Store.getCategories(), Store.getGroups(), Store.currentUser()]);
        const isSuper = actor?.role === 'superadmin';
        const term = (q('#sys-cat-search')?.value || '').trim().toLocaleLowerCase();
        const groupLabel = id => { const g = groups.find(item => item.id === id); return g ? (g.label || g.name) : ''; };
        const active = categories.filter(c => !c.archived);
        const visible = active.filter(c => (!filterGroup || c.autoAssignGroupId === filterGroup)
            && (!term || `${c.name} ${groupLabel(c.autoAssignGroupId)}`.toLocaleLowerCase().includes(term)));
        const note = q('#sys-cat-filter-note');
        if (note) {
            note.hidden = !filterGroup;
            note.innerHTML = filterGroup ? `${Icon('filter', 14)}<span>${Utils.esc(Lang.format('categoryFilterGroup', { name: groupLabel(filterGroup) || '–' }))}</span>
                <button type="button" class="btn-ghost btn-sm" id="sys-cat-filter-clear">${Icon('x', 14)}${Utils.esc(Lang.t('removeFilter'))}</button>` : '';
            q('#sys-cat-filter-clear')?.addEventListener('click', () => AdminBoard.renderCategorySettings(null));
        }
        panel.innerHTML = visible.length ? visible.map(c => `
            <div class="cat-row" data-id="${Utils.esc(c.id)}">
                <span class="cat-row-icon">${Icon(CategoryFaq.iconFor(c.name), 18)}</span>
                <div class="cat-row-main">
                    <strong>${Utils.esc(c.name)}</strong>
                    <span class="cat-row-meta">
                        <span>${Icon('users-round', 12)}${Utils.esc(groupLabel(c.autoAssignGroupId) || Lang.t('noAutoAssignment'))}</span>
                        <span>${Icon('list', 12)}${Utils.esc(Lang.format('customFieldCount', { count: c.customFields.length }))}</span>
                        <span>${Icon('lightbulb', 12)}${Utils.esc(Lang.format('faqTipCount', { count: c.faq.items.length }))}</span>
                    </span>
                </div>
                <label class="cat-row-switch" title="${Utils.esc(Lang.t('showInServiceBar'))}"><input type="checkbox" data-portal${c.showInPortal ? ' checked' : ''}><span class="module-switch" aria-hidden="true"></span><span class="cat-row-switch-label">${Utils.esc(Lang.t('serviceBarShort'))}</span></label>
                <div class="cat-row-actions">
                    ${isSuper && c.autoAssignGroupId ? `<button type="button" class="btn-ghost btn-icon btn-sm" data-group title="${Utils.esc(Lang.t('manageGroupsLink'))}" aria-label="${Utils.esc(Lang.t('manageGroupsLink'))}">${Icon('users-round', 16)}</button>` : ''}
                    <button type="button" class="btn-ghost btn-icon btn-sm" data-faq title="${Utils.esc(Lang.t('faqEdit'))}" aria-label="${Utils.esc(Lang.t('faqEdit'))}">${Icon('lightbulb', 16)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-sm" data-edit title="${Utils.esc(Lang.t('edit'))}" aria-label="${Utils.esc(Lang.t('edit'))}">${Icon('pencil', 16)}</button>
                    <button type="button" class="btn-ghost btn-icon btn-sm btn-danger" data-delete title="${Utils.esc(Lang.t('delete'))}" aria-label="${Utils.esc(Lang.t('delete'))}">${Icon('trash-2', 16)}</button>
                </div>
            </div>`).join('') : `<div class="empty-state compact">${Utils.esc(Lang.t(active.length ? 'noCategoriesFound' : 'noCategoriesCreated'))}</div>`;
        panel.querySelectorAll('.cat-row').forEach(row => {
            const category = categories.find(c => c.id === row.dataset.id);
            row.querySelector('[data-portal]').onchange = async event => {
                if (!(await Store.updateCategory(category.id, { showInPortal: event.target.checked }))) {
                    event.target.checked = !event.target.checked;
                    return UI.toast(Lang.t('categorySaveFailed'));
                }
                UI.toast(Lang.format(event.target.checked ? 'categoryShownInBar' : 'categoryHiddenFromBar', { name: category.name }));
            };
            row.querySelector('[data-group]')?.addEventListener('click', async () => {
                const group = groups.find(g => g.id === category.autoAssignGroupId);
                await AdminBoard.openUserManager('groups');
                if (group) AdminBoard.openEditGroupModal(group);
            });
            row.querySelector('[data-faq]').onclick = () => CategoryFaq.edit(category, { onSaved: () => AdminBoard.renderCategorySettings() });
            row.querySelector('[data-edit]').onclick = () => AdminBoard.openEditCategoryModal(category);
            row.querySelector('[data-delete]').onclick = () => UI.confirm(Lang.format('confirmDeleteCategory', { name: category.name }), async () => {
                if (!(await Store.updateCategory(category.id, { archived: true }))) return UI.toast(Lang.t('categoryDeleteFailed'));
                await AdminBoard.renderCategorySettings();
            });
        });
        if (window.lucide) lucide.createIcons();
    },

    openGroupMembers: async (group) => {
        const modal = AdminBoard.openDialog({
            id: 'group-members-modal',
            title: Lang.format('membersOfGroup', { name: group.name }),
            icon: 'users-round',
            size: 'sm',
            headerButtons: [
                { id: 'gm-add', icon: 'user-plus', title: Lang.t('addMember') },
                { id: 'gm-print', icon: 'printer', title: Lang.t('print') }
            ],
            body: `<input type="search" id="gm-search" class="section-search" placeholder="${Lang.t('searchMemberPlaceholder')}">
                   <div id="gm-list" class="mt-3"></div>`
        });
        const render = async () => {
            const groups = await Store.getGroups();
            const current = groups.find(g => g.id === group.id) || group;
            group.members = current.members || [];
            const users = await Store.getUsers();
            const term = modal.querySelector('#gm-search').value.toLowerCase().trim();
            const members = users.filter(u => (group.members || []).includes(u.username) && (!term || Utils.matchesSearch(term, u.name, u.username, u.email)));
            modal.querySelector('#gm-list').innerHTML = members.length ? members.map(u => `
                <div class="absence-overview-row" data-username="${Utils.esc(u.username)}">
                    <div><strong>${Utils.esc(u.name || u.username)}</strong><span class="hint">${Utils.esc(u.username)}${u.email ? ' · ' + Utils.esc(u.email) : ''} · ${Utils.esc(u.role)}</span></div>
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger gm-remove" title="${Lang.t('removeFromGroup')}" aria-label="${Lang.t('removeFromGroup')}">${Icon('x', 14)}</button>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noMembers')}</div>`;
            modal.querySelectorAll('.gm-remove').forEach(btn => btn.onclick = async () => {
                const username = btn.closest('[data-username]').dataset.username;
                const member = users.find(u => u.username === username);
                if (!member || !(await Store.updateGroupMembers(group.id, { remove: [member.id] }))) return UI.toast(Lang.t('groupMembersSaveFailed'));
                await render();
                AdminBoard.renderUserManager('groups');
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#gm-search').oninput = render;
        modal.querySelector('#gm-add').onclick = async () => {
            const users = await Store.getUsers();
            const candidates = users.filter(u => !(group.members || []).includes(u.username) && !u.accountArchived);
            if (!candidates.length) return UI.toast(Lang.t('allUsersAlreadyMembers'));
            const addModal = AdminBoard.openDialog({
                id: 'group-members-add-modal',
                title: Lang.t('addMembers'),
                icon: 'user-plus',
                size: 'sm',
                body: `<div class="field"><label>${Lang.t('selectPeople')}</label><div id="gma-picker"></div></div>`,
                onSave: async (m) => {
                    const chosen = picker.getValue();
                    if (!chosen.length) return UI.toast(Lang.t('selectAtLeastOnePerson'));
                    if (!(await Store.updateGroupMembers(group.id, { add: chosen }))) return UI.toast(Lang.t('groupMembersSaveFailed'));
                    m.remove();
                    await render();
                    AdminBoard.renderUserManager('groups');
                }
            });
            const picker = UI.createMultiSelect(addModal.querySelector('#gma-picker'), candidates.map(u => ({ value: u.id, label: u.name || u.username })), []);
        };
        modal.querySelector('#gm-print').onclick = async () => {
            const settings = await Store.getSettings();
            const company = settings.companyConfig || {};
            const companyLogo = company.logoUrl || settings.companyBrandingConfig?.logoDataUrl || '';
            const actor = await Store.currentUser();
            const users = await Store.getUsers();
            // Gruppe mit vollem Pfad ("IT › Netzwerk") und ihren Untergruppen jeweils als eigener Abschnitt.
            const groups = await Store.getGroups();
            const current = groups.find(g => g.id === group.id) || group;
            const sections = [current, ...groups.filter(g => (current.descendantIds || []).includes(g.id))].map(g => ({
                group: g,
                depth: Math.max(0, (g.depth || 0) - (current.depth || 0)),
                members: users.filter(u => (u.groupIds || []).includes(g.id))
            }));
            const memberCount = new Set(sections.flatMap(section => section.members.map(u => u.id))).size;
            const table = members => members.length
                ? `<table><thead><tr><th>${Lang.t('name')}</th><th>${Lang.t('username')}</th><th>${Lang.t('email')}</th><th>${Lang.t('role')}</th></tr></thead><tbody>
                    ${members.map(u => `<tr><td>${Utils.esc(u.name || '-')}</td><td>${Utils.esc(u.username)}</td><td>${Utils.esc(u.email || '-')}</td><td>${Utils.esc(u.role)}</td></tr>`).join('')}
                    </tbody></table>`
                : `<p class="meta">${Lang.t('noMembers')}</p>`;
            UI.printHTML(`<!DOCTYPE html><html lang="${Lang.current}"><head><meta charset="UTF-8"><title>${Lang.format('membersOfGroup', { name: Utils.esc(current.label || current.name) })}</title>
                <link rel="stylesheet" href="/js/print.css"></head>
                <body><div class="print-head"><div><h1>${Lang.format('companyGroupHeading', { company: Utils.esc(company.name || 'Support Portal'), group: Utils.esc(current.label || current.name) })}</h1>
                <div class="meta">${Lang.format('membersPrintedByOn', { count: memberCount, name: Utils.esc(actor?.name || actor?.username || '-'), date: Utils.esc(Utils.fmtDate(new Date().toISOString())) })}</div></div>
                ${companyLogo ? `<img src="${Utils.esc(companyLogo)}" alt="Logo">` : ''}</div>
                ${sections.map((section, index) => `<section class="print-group print-depth-${Math.min(section.depth, 8)}">
                    ${index || sections.length > 1 ? `<h2>${section.depth ? '↳ ' : ''}${Utils.esc(section.group.label || section.group.name)} <small>(${section.members.length})</small></h2>` : ''}
                    ${table(section.members)}</section>`).join('')}
                </body></html>`);
        };
        await render();
    },

    // Eine Person kann mehreren Gruppen angehoeren -- hier werden nur Mitglieder dieser Gruppe
    // hinzugefuegt oder entfernt, weitere Gruppen der Personen bleiben unveraendert.
    openEditGroupModal: async (group) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');
        const users = await Store.getUsers();
        const members = group?.members || [];
        // Als uebergeordnete Gruppe nicht waehlbar: die Gruppe selbst und ihre Untergruppen (keine Zyklen).
        const allGroups = await Store.getGroups();
        const current = group ? allGroups.find(item => item.id === group.id) : null;
        const blocked = new Set(current ? [current.id, ...current.descendantIds] : []);

        title.textContent = group ? Lang.format('editGroupName', { name: group.name }) : Lang.t('newGroup');
        content.innerHTML = `
            <div class="field"><label for="ge-name">${Lang.t('name')}</label><input id="ge-name" type="text" value="${Utils.esc(group?.name || '')}" placeholder="${Lang.t('egVerwaltung')}"></div>
            <div class="field"><label for="ge-parent">${Lang.t('parentGroup')}</label>
                <select id="ge-parent"><option value="">${Lang.t('noParentGroup')}</option>${allGroups.filter(item => !blocked.has(item.id)).map(item => `<option value="${Utils.esc(item.id)}"${current?.parentId === item.id ? ' selected' : ''}>${Utils.esc(item.label)}</option>`).join('')}</select>
                <p class="hint">${Lang.t('parentGroupHint')}</p>
            </div>
            <div class="field">
                <label>${Lang.t('members')}</label>
                <p class="hint">${Lang.t('onePersonOneGroupHint')}</p>
                <div class="checkbox-list">
                    ${users.map(u => `
                        <label class="check-row">
                            <input type="checkbox" value="${Utils.esc(u.username)}" ${members.includes(u.username) ? 'checked' : ''}>
                            <span>${Utils.esc(u.name || u.username)} <small>(${Utils.esc(u.username)})</small></span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
        confirmBtn.textContent = Lang.t('save');
        confirmBtn.onclick = async () => {
            const name = q('#ge-name').value.trim();
            if (!name) {
                UI.toast(Lang.t('enterGroupName'));
                return;
            }
            const selectedMembers = qa('#generic-modal .checkbox-list input:checked').map(x => x.value);
            const parentId = q('#ge-parent').value || null;
            const groupError = error => UI.toast(Lang.t(error === 'group_too_deep' ? 'groupTooDeep' : error === 'group_cycle' || error === 'invalid_parent' ? 'groupParentInvalid' : group ? 'groupRenameFailed' : 'groupCreateFailed'));

            let groupId = group?.id;
            if (group) {
                if (name !== group.name || parentId !== (current?.parentId || null)) {
                    const error = await Store.updateGroup(group.id, { name, parent_id: parentId });
                    if (error) return groupError(error);
                }
            } else {
                const createRes = await fetch('/api/v2/groups', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name, parent_id: parentId })
                }).catch(() => null);
                if (!createRes || !createRes.ok) return groupError((await createRes?.json().catch(() => null))?.error);
                groupId = (await createRes.json()).id;
            }

            const idOf = username => users.find(u => u.username === username)?.id;
            const add = selectedMembers.filter(m => !members.includes(m)).map(idOf).filter(Boolean);
            const remove = members.filter(m => !selectedMembers.includes(m)).map(idOf).filter(Boolean);
            if ((add.length || remove.length) && !(await Store.updateGroupMembers(groupId, { add, remove }))) return UI.toast(Lang.t('groupMembersSaveFailed'));

            modal.classList.remove('open');
            AdminBoard.renderUserManager('groups');
            UI.toast(group ? Lang.t('groupSavedToast') : Lang.t('groupCreatedToast'));
        };
        modal.classList.add('open');
        // Querverweis: Kategorien, die automatisch an diese Gruppe gehen (Systemeinstellungen > Kategorien).
        if (group) {
            const linked = (await Store.getCategories()).filter(c => !c.archived && c.autoAssignGroupId === group.id);
            const box = document.createElement('div');
            box.className = 'setting-row group-category-link';
            box.innerHTML = `<span class="hint">${Icon('tags', 14)} ${Utils.esc(linked.length ? Lang.format('groupLinkedCategories', { list: linked.map(c => c.name).join(', ') }) : Lang.t('groupNoLinkedCategories'))}</span>
                <button type="button" class="btn-secondary btn-sm">${Icon('tags', 15)}${Utils.esc(Lang.t('manageCategoriesLink'))}</button>`;
            box.querySelector('button').onclick = () => { modal.classList.remove('open'); AdminBoard.openSystemSettings('sys-categories', { groupId: group.id }); };
            content.appendChild(box);
        }
        if (window.lucide) lucide.createIcons();
    },

    openEditUserModal: async (user, viewContext) => AdminBoard.openUserWizard({ user, viewContext }),

    // Rechte fuer Admin-Konten mit Oberbegriffen (Server: domain/adminPermissions.ts PERMISSION_GROUPS).
    // [Schluessel, Beschriftung, Hinweis, Modul]; die vier Verwaltungsrechte stehen am Benutzerobjekt selbst.
    ADMIN_FLAGS: ['canManageRequests', 'canManageUsers', 'canManage2FA', 'canViewLogs'],
    PERMISSION_GROUPS: [
        { key: 'administration', icon: 'shield', label: 'permGroupAdministration', items: [
            ['canManageRequests', 'manageAccountRequests'], ['canManageUsers', 'userManagementUsersOnly'],
            ['canManage2FA', 'resetUsersMfaPermission'], ['canViewLogs', 'viewSystemLogs']] },
        { key: 'features', icon: 'sparkles', label: 'permGroupFeatures', items: [
            ['textBlocks', 'manageTextBlocks'], ['reports', 'viewReports'], ['recurring', 'manageRecurringTickets'],
            ['categoryFaq', 'permCategoryFaq', 'permCategoryFaqHint']] },
        { key: 'modules', icon: 'blocks', label: 'permGroupModules', items: [
            ['approvals', 'decideApprovals', null, 'approvals'], ['settingsApprovals', 'permSettingsApprovals', 'permSettingsApprovalsHint', 'approvals'],
            ['settingsSla', 'permSettingsSla', 'permSettingsSlaHint', 'sla']] },
        { key: 'settings', icon: 'sliders', label: 'permGroupSettings', items: [
            ['settingsGeneral', 'permSettingsGeneral', 'permSettingsGeneralHint'], ['settingsTicketForm', 'permSettingsTicketForm', 'permSettingsTicketFormHint'],
            ['settingsCategories', 'permSettingsCategories', 'permSettingsCategoriesHint'], ['settingsCompany', 'permSettingsCompany', 'permSettingsCompanyHint'],
            ['settingsTicketNumbers', 'permSettingsTicketNumbers', 'permSettingsTicketNumbersHint'], ['settingsNotifications', 'permSettingsNotifications', 'permSettingsNotificationsHint']] }
    ],
    permissionsMarkup: (user) => {
        const isOn = key => AdminBoard.ADMIN_FLAGS.includes(key) ? !!user?.[key] : !!user?.permissions?.[key];
        return `
            <div class="perm-toolbar">
                <button type="button" class="btn-ghost btn-sm" data-perm-all>${Icon('check-check', 14)}${Utils.esc(Lang.t('permSelectAll'))}</button>
                <button type="button" class="btn-ghost btn-sm" data-perm-none>${Icon('x', 14)}${Utils.esc(Lang.t('permSelectNone'))}</button>
            </div>
            <div class="perm-groups">${AdminBoard.PERMISSION_GROUPS.map(group => `
                <fieldset class="perm-group" data-group="${group.key}">
                    <legend><label class="perm-group-head"><input type="checkbox" data-perm-group="${group.key}"><span>${Icon(group.icon, 15)}${Utils.esc(Lang.t(group.label))}</span><small class="perm-group-count"></small></label></legend>
                    <div class="perm-list">${group.items.map(([key, label, hint, module]) => `
                        <label class="check-row"${module ? ` data-module="${module}"` : ''}><input type="checkbox" data-perm="${key}"${isOn(key) ? ' checked' : ''}>
                            <span class="check-text"><strong>${Utils.esc(Lang.t(label))}</strong>${hint ? `<span>${Utils.esc(Lang.t(hint))}</span>` : ''}</span></label>`).join('')}
                    </div>
                    ${group.key === 'features' ? `<div class="field perm-kb"><label for="uw-kb">${Lang.t('knowledgeBase')}</label><select id="uw-kb">
                        <option value="none">${Lang.t('noAccess')}</option><option value="read">${Lang.t('readOnly')}</option><option value="edit">${Lang.t('readAndEdit')}</option></select></div>` : ''}
                </fieldset>`).join('')}
            </div>`;
    },
    // Sammel-Haekchen je Oberbegriff (alle / einige / keine) und "Alle"/"Keine".
    bindPermissionGroups: (root) => {
        const sync = () => root.querySelectorAll('.perm-group').forEach(fieldset => {
            const boxes = [...fieldset.querySelectorAll('[data-perm]')].filter(box => !box.closest('[data-module]') || Store.modules[box.closest('[data-module]').dataset.module] !== false);
            const on = boxes.filter(box => box.checked).length;
            const head = fieldset.querySelector('[data-perm-group]');
            head.checked = !!boxes.length && on === boxes.length;
            head.indeterminate = on > 0 && on < boxes.length;
            fieldset.querySelector('.perm-group-count').textContent = `${on}/${boxes.length}`;
        });
        root.querySelectorAll('[data-perm-group]').forEach(head => head.onchange = () => {
            head.closest('.perm-group').querySelectorAll('[data-perm]').forEach(box => { box.checked = head.checked; });
            sync();
        });
        root.querySelectorAll('[data-perm]').forEach(box => box.addEventListener('change', sync));
        root.querySelector('[data-perm-all]')?.addEventListener('click', () => { root.querySelectorAll('[data-perm]').forEach(box => { box.checked = true; }); sync(); });
        root.querySelector('[data-perm-none]')?.addEventListener('click', () => { root.querySelectorAll('[data-perm]').forEach(box => { box.checked = false; }); sync(); });
        sync();
    },

    // Vorschlag fuer einen freien Benutzernamen aus dem Namen ("Max Muster" -> "max.muster").
    suggestUsername: (name, users) => {
        const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/ß/g, 'ss').trim().replace(/\s+/g, '.').replace(/[^a-z0-9_.-]/g, '').slice(0, 56) || 'benutzer';
        const taken = new Set(users.map(u => String(u.username || '').toLowerCase()));
        let candidate = base;
        for (let n = 2; taken.has(candidate); n++) candidate = `${base}${n}`;
        return candidate;
    },

    // Benutzer anlegen oder bearbeiten als Assistent: Konto -> Organisation -> Kontakt & Arbeitszeiten
    // -> (Rechte, nur fuer Admin-Konten) -> Uebersicht. Dieselbe Oberflaeche fuer neue Konten, fuer das
    // Bearbeiten (Schritte frei anwaehlbar, jederzeit speicherbar) und fuer das Annehmen einer
    // Kontoanfrage (vorbefuellt; die Anfrage gilt erst nach erfolgreichem Anlegen als genehmigt).
    openUserWizard: async ({ user = null, viewContext = 'users', request = null } = {}) => {
        const isNew = !user;
        const currentUser = await Store.currentUser();
        const isSuper = currentUser?.role === 'superadmin';
        const canSetValidity = isSuper || !!currentUser?.canManageUsers;
        const [allUsers, groups] = await Promise.all([Store.getUsers(), Store.getGroups()]);
        const profile = user?.profile || {};
        const workDays = profile.work_days || {};
        const DAYS = [1, 2, 3, 4, 5, 6, 0];
        const dayName = day => Lang.t(`uwDay${day}`);
        const field = (id, labelKey, value = '', attrs = '') => `<div class="field"><label for="${id}">${Utils.esc(Lang.t(labelKey))}</label><input id="${id}" type="text" value="${Utils.esc(value)}" ${attrs}></div>`;
        const steps = [
            { key: 'account', icon: 'user-round', label: 'uwStepAccount' },
            { key: 'org', icon: 'building-2', label: 'uwStepOrg' },
            { key: 'contact', icon: 'clock', label: 'uwStepContact' },
            { key: 'rights', icon: 'shield-check', label: 'uwStepRights' },
            { key: 'review', icon: 'list-checks', label: 'uwStepReview' }
        ];
        const title = request ? Lang.format('uwTitleRequest', { name: request.name }) : isNew ? Lang.t('createNewUser') : Lang.format('editUserName', { username: user.username });
        const modal = AdminBoard.openDialog({
            id: 'user-wizard',
            title,
            icon: isNew ? 'user-plus' : 'user-cog',
            size: 'lg',
            body: `
                <ol class="wizard-steps" role="tablist">${steps.map((step, index) => `
                    <li><button type="button" class="wizard-step" data-step="${step.key}" role="tab">
                        <span class="wizard-step-no">${index + 1}</span>${Icon(step.icon, 15)}<span class="wizard-step-label">${Utils.esc(Lang.t(step.label))}</span>
                    </button></li>`).join('')}</ol>
                <section class="wizard-page" data-page="account">
                    ${request ? `<div class="callout callout-info uw-request-info">
                        <strong>${Utils.esc(Lang.t('uwFromRequest'))}</strong>
                        <dl class="uw-review-list">
                            <div><dt>${Utils.esc(Lang.t('name'))}</dt><dd>${Utils.esc(request.name)}</dd></div>
                            <div><dt>${Utils.esc(Lang.t('email'))}</dt><dd>${Utils.esc(request.email)}</dd></div>
                            ${request.company ? `<div><dt>${Utils.esc(Lang.t('uwRequestCompany'))}</dt><dd>${Utils.esc(request.company)}</dd></div>` : ''}
                            ${request.reason ? `<div><dt>${Utils.esc(Lang.t('uwRequestReason'))}</dt><dd>${Utils.esc(request.reason)}</dd></div>` : ''}
                        </dl></div>` : ''}
                    <div class="form-grid">
                        ${field('uw-name', 'uwFullName', user?.name || request?.name || '', 'maxlength="255" autocomplete="off"')}
                        <div class="field"><label for="uw-email">${Utils.esc(Lang.t('email'))}</label><input id="uw-email" type="email" maxlength="255" value="${Utils.esc(user?.email || request?.email || '')}"></div>
                        ${field('uw-user', 'username', user?.username || (request ? AdminBoard.suggestUsername(request.name, allUsers) : ''), `maxlength="64" autocomplete="off"${isNew ? '' : ' disabled'}`)}
                        <div class="field">
                            <label for="uw-pass">${Utils.esc(Lang.t(isNew ? 'uwPassword' : 'passwordLeaveEmptyUnchanged'))}</label>
                            <div class="uw-password-row">
                                <input id="uw-pass" type="password" autocomplete="new-password">
                                <button type="button" class="btn-ghost btn-icon btn-sm" id="uw-pass-toggle" title="${Utils.esc(Lang.t('uwShowPassword'))}" aria-label="${Utils.esc(Lang.t('uwShowPassword'))}">${Icon('eye', 15)}</button>
                                <button type="button" class="btn-secondary btn-sm" id="uw-pass-generate">${Icon('wand-sparkles', 15)}${Utils.esc(Lang.t('uwGeneratePassword'))}</button>
                            </div>
                        </div>
                    </div>
                    <div id="uw-similar" class="callout" hidden></div>
                    <div class="form-grid">
                        ${isSuper ? `<div class="field"><label for="uw-role">${Utils.esc(Lang.t('role'))}</label><select id="uw-role">
                            <option value="user">User</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></div>` : ''}
                        ${canSetValidity ? `<div class="field"><label for="uw-valid-until">${Utils.esc(Lang.t('validUntilInclusiveOptional'))}</label>${UI.dateFieldMarkup('uw-valid-until')}</div>` : ''}
                    </div>
                    ${isSuper ? `<div class="field" id="uw-ldap-box">
                        <label class="check-row"><input type="checkbox" id="uw-ldap"${user?.ldapLoginEnabled ? ' checked' : ''}><span>${Lang.t('allowLdapLoginForAccount')}</span></label>
                        <div class="hint">${Lang.t('ldapHintText')}</div>
                    </div>` : ''}
                </section>
                <section class="wizard-page" data-page="org" hidden>
                    <div class="form-grid">
                        ${field('uw-department', 'uwDepartment', user?.department || '', 'maxlength="255"')}
                        ${field('uw-job-title', 'jobTitle', user?.jobTitle || '', 'maxlength="255"')}
                        ${field('uw-office', 'uwOffice', user?.officeLocation || '', 'maxlength="255"')}
                        ${field('uw-building', 'uwBuilding', profile.building || '', 'maxlength="128"')}
                        ${field('uw-room', 'uwRoom', profile.room || '', 'maxlength="64"')}
                        ${field('uw-employee-no', 'uwEmployeeNumber', profile.employee_number || '', 'maxlength="64"')}
                        ${field('uw-cost-center', 'uwCostCenter', profile.cost_center || '', 'maxlength="64"')}
                        <div class="field"><label for="uw-entry-date">${Utils.esc(Lang.t('uwEntryDate'))}</label>${UI.dateFieldMarkup('uw-entry-date')}</div>
                    </div>
                    <div class="field"><label>${Utils.esc(Lang.t('supervisor'))}</label><div id="uw-supervisor"></div><p class="hint">${Utils.esc(Lang.t('uwSupervisorHint'))}</p></div>
                    <div class="field"><label>${Utils.esc(Lang.t('userGroupsLabel'))}</label><div id="uw-groups"></div></div>
                </section>
                <section class="wizard-page" data-page="contact" hidden>
                    <div class="form-grid">
                        ${field('uw-phone', 'phone', user?.phone || '', 'maxlength="64" inputmode="tel"')}
                        ${field('uw-mobile', 'mobile', user?.mobile || '', 'maxlength="64" inputmode="tel"')}
                    </div>
                    <div class="field">
                        <div class="uw-schedule-head">
                            <label>${Utils.esc(Lang.t('uwWorkDays'))}</label>
                            <span class="uw-schedule-presets">
                                <button type="button" class="btn-ghost btn-sm" data-preset="week">${Utils.esc(Lang.t('uwPresetWeek'))}</button>
                                <button type="button" class="btn-ghost btn-sm" data-preset="clear">${Utils.esc(Lang.t('uwPresetClear'))}</button>
                            </span>
                        </div>
                        <p class="hint">${Utils.esc(Lang.t('uwWorkDaysHint'))}</p>
                        <div class="uw-schedule">${DAYS.map(day => {
                            const entry = workDays[day];
                            return `<div class="uw-day${entry ? ' is-on' : ''}" data-day="${day}">
                                <label class="check-row"><input type="checkbox" class="uw-day-on"${entry ? ' checked' : ''}><span>${Utils.esc(dayName(day))}</span></label>
                                <input type="time" class="uw-day-start" value="${Utils.esc(entry?.start || '08:00')}" aria-label="${Utils.esc(Lang.format('uwStartOf', { day: dayName(day) }))}"${entry ? '' : ' disabled'}>
                                <span aria-hidden="true">–</span>
                                <input type="time" class="uw-day-end" value="${Utils.esc(entry?.end || '17:00')}" aria-label="${Utils.esc(Lang.format('uwEndOf', { day: dayName(day) }))}"${entry ? '' : ' disabled'}>
                            </div>`;
                        }).join('')}</div>
                    </div>
                    <div class="field"><label for="uw-availability">${Utils.esc(Lang.t('uwAvailability'))}</label><textarea id="uw-availability" rows="2" maxlength="500" placeholder="${Utils.esc(Lang.t('uwAvailabilityPlaceholder'))}">${Utils.esc(profile.availability_note || '')}</textarea></div>
                </section>
                <section class="wizard-page" data-page="rights" hidden>
                    <p class="hint">${Utils.esc(Lang.t('uwRightsHint'))}</p>
                    ${AdminBoard.permissionsMarkup(user)}
                </section>
                <section class="wizard-page" data-page="review" hidden><div id="uw-review"></div></section>
                <div class="wizard-footer">
                    <button type="button" class="btn-secondary" id="uw-back">${Icon('arrow-left', 15)}${Utils.esc(Lang.t('uwBack'))}</button>
                    <span class="wizard-footer-spacer"></span>
                    ${isNew ? '' : `<button type="button" class="btn-secondary" id="uw-save-now">${Icon('save', 15)}${Utils.esc(Lang.t('save'))}</button>`}
                    <button type="button" class="btn-primary" id="uw-next">${Utils.esc(Lang.t('uwNext'))}${Icon('arrow-right', 15)}</button>
                </div>`
        });
        const $ = selector => modal.querySelector(selector);
        if ($('#uw-role')) $('#uw-role').value = user?.role || (viewContext === 'admins' ? 'admin' : 'user');
        if ($('#uw-kb')) $('#uw-kb').value = user?.permissions?.kb || 'none';
        AdminBoard.bindPermissionGroups(modal.querySelector('[data-page="rights"]'));
        UI.bindPasswordRequirements($('#uw-pass'));
        const validityPicker = canSetValidity ? UI.bindDateField('uw-valid-until', { initialMs: user?.accountValidUntil ? new Date(`${user.accountValidUntil}T12:00:00`).getTime() : null }) : null;
        if (canSetValidity && user?.accountValidUntil) $('#uw-valid-until').value = user.accountValidUntil.split('-').reverse().join('.');
        UI.bindDateField('uw-entry-date', { initialMs: profile.entry_date ? new Date(`${profile.entry_date}T12:00:00`).getTime() : null });
        if (profile.entry_date) $('#uw-entry-date').value = profile.entry_date.split('-').reverse().join('.');
        void validityPicker;
        const supervisorPicker = UI.createMultiSelect($('#uw-supervisor'),
            allUsers.filter(u => u.id !== user?.id && !u.accountArchived).map(u => ({ value: u.id, label: u.name || u.username })),
            user?.supervisorUserId || '', null, { single: true, emptyLabel: Lang.t('none') });
        const groupPicker = UI.createMultiSelect($('#uw-groups'), groups.map(g => ({ value: g.id, label: g.label || g.name })), user?.groupIds || [], null, { emptyLabel: Lang.t('none') });

        // Passwort: erzeugen (sichtbar, damit es weitergegeben werden kann) und ein-/ausblenden.
        $('#uw-pass-generate').onclick = async () => {
            $('#uw-pass').value = await Store.generatePassword();
            $('#uw-pass').type = 'text';
            $('#uw-pass').dispatchEvent(new Event('input'));
        };
        $('#uw-pass-toggle').onclick = () => { $('#uw-pass').type = $('#uw-pass').type === 'password' ? 'text' : 'password'; };
        if (isNew) $('#uw-pass-generate').click();
        if (isNew && !request) $('#uw-name').addEventListener('input', () => {
            if (!$('#uw-user').dataset.touched) $('#uw-user').value = $('#uw-name').value.trim() ? AdminBoard.suggestUsername($('#uw-name').value, allUsers) : '';
        });
        $('#uw-user').addEventListener('input', () => { $('#uw-user').dataset.touched = '1'; });

        // Arbeitstage
        const syncDay = row => {
            const on = row.querySelector('.uw-day-on').checked;
            row.classList.toggle('is-on', on);
            row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = !on; });
        };
        modal.querySelectorAll('.uw-day').forEach(row => { row.querySelector('.uw-day-on').onchange = () => syncDay(row); });
        modal.querySelectorAll('[data-preset]').forEach(btn => btn.onclick = () => {
            modal.querySelectorAll('.uw-day').forEach(row => {
                const day = Number(row.dataset.day);
                row.querySelector('.uw-day-on').checked = btn.dataset.preset === 'week' && day >= 1 && day <= 5;
                if (btn.dataset.preset === 'week') { row.querySelector('.uw-day-start').value = '08:00'; row.querySelector('.uw-day-end').value = '17:00'; }
                syncDay(row);
            });
        });

        // Bestehende oder aehnliche Konten (nur beim Anlegen): exakte Treffer blockieren.
        let hasExactDuplicate = false;
        if (isNew) {
            let timer = null;
            const check = () => {
                clearTimeout(timer);
                timer = setTimeout(async () => {
                    const name = $('#uw-name').value.trim();
                    const email = $('#uw-email').value.trim();
                    const box = $('#uw-similar');
                    if (!name && !email) { box.hidden = true; hasExactDuplicate = false; return; }
                    const result = await Store.checkSimilarUser(name, email);
                    hasExactDuplicate = !!result.exact;
                    if (!result.similar?.length) { box.hidden = true; return; }
                    const describe = s => `${Utils.esc(s.name)} (${Utils.esc(s.username)}, ${Utils.esc(s.email)})`;
                    box.hidden = false;
                    box.className = `callout ${result.exact ? 'callout-danger' : ''}`;
                    box.innerHTML = Lang.format(result.exact ? 'userAlreadyExistsBlocked' : 'similarUsersFound', { list: result.similar.map(describe).join(', ') });
                }, 350);
            };
            $('#uw-name').addEventListener('input', check);
            $('#uw-email').addEventListener('input', check);
            check();
        }

        const parseDate = value => {
            const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
            return match && Number.isFinite(Utils.parseGermanDateTime(value.trim(), '12:00')) ? `${match[3]}-${match[2]}-${match[1]}` : null;
        };
        const role = () => isSuper ? $('#uw-role').value : (user?.role || 'user');
        const activeSteps = () => steps.filter(step => step.key !== 'rights' || (isSuper && role() === 'admin'));
        const collect = () => {
            const days = {};
            modal.querySelectorAll('.uw-day').forEach(row => {
                if (row.querySelector('.uw-day-on').checked) days[row.dataset.day] = { start: row.querySelector('.uw-day-start').value, end: row.querySelector('.uw-day-end').value };
            });
            const permBoxes = [...modal.querySelectorAll('[data-page="rights"] [data-perm]')];
            const permOn = key => role() === 'admin' && !!permBoxes.find(box => box.dataset.perm === key)?.checked;
            const permissions = role() === 'admin' && isSuper ? {
                ...Object.fromEntries(permBoxes.filter(box => !AdminBoard.ADMIN_FLAGS.includes(box.dataset.perm)).map(box => [box.dataset.perm, box.checked])),
                kb: $('#uw-kb').value
            } : {};
            return {
                username: $('#uw-user').value.trim(), name: $('#uw-name').value.trim(), email: $('#uw-email').value.trim(), password: $('#uw-pass').value.trim(),
                role: role(), validityText: canSetValidity ? $('#uw-valid-until').value.trim() : '', ldap: isSuper && role() !== 'superadmin' ? !!$('#uw-ldap')?.checked : !!user?.ldapLoginEnabled,
                department: $('#uw-department').value.trim(), jobTitle: $('#uw-job-title').value.trim(), officeLocation: $('#uw-office').value.trim(),
                phone: $('#uw-phone').value.trim(), mobile: $('#uw-mobile').value.trim(),
                supervisorUserId: supervisorPicker.getValue() || null, groupIds: groupPicker.getValue() || [],
                entryDateText: $('#uw-entry-date').value.trim(),
                profile: {
                    building: $('#uw-building').value.trim(), room: $('#uw-room').value.trim(),
                    employee_number: $('#uw-employee-no').value.trim(), cost_center: $('#uw-cost-center').value.trim(),
                    entry_date: parseDate($('#uw-entry-date').value) || undefined,
                    work_days: days, availability_note: $('#uw-availability').value.trim()
                },
                permissions,
                canManageRequests: permOn('canManageRequests'),
                canManageUsers: permOn('canManageUsers'),
                canViewLogs: permOn('canViewLogs'),
                canManage2FA: permOn('canManage2FA')
            };
        };
        // Prueft einen Schritt; liefert eine Meldung samt Feld oder null.
        const validate = stepKey => {
            const data = collect();
            if (stepKey === 'account') {
                if (!data.name) return { message: Lang.t('uwNameMissing'), input: $('#uw-name') };
                if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { message: Lang.t('validEmailMissing'), input: $('#uw-email') };
                if (isNew && !/^[\p{L}\p{N}_.-]{1,64}$/u.test(data.username)) return { message: Lang.t('uwUsernameInvalid'), input: $('#uw-user') };
                if (isNew && allUsers.some(u => String(u.username).toLowerCase() === data.username.toLowerCase())) return { message: Lang.t('userAlreadyExists'), input: $('#uw-user') };
                if (isNew && hasExactDuplicate) return { message: Lang.t('userExistsCreateAborted'), input: $('#uw-email') };
                if ((isNew || data.password) && data.password.length < 14) return { message: Lang.t('passwordMinLength'), input: $('#uw-pass') };
                if (data.validityText && !parseDate(data.validityText)) return { message: Lang.t('validityDateFormatHint'), input: $('#uw-valid-until') };
            }
            if (stepKey === 'org' && data.entryDateText && !parseDate(data.entryDateText)) return { message: Lang.t('validityDateFormatHint'), input: $('#uw-entry-date') };
            if (stepKey === 'contact') {
                const invalid = [...modal.querySelectorAll('.uw-day')].find(row => row.querySelector('.uw-day-on').checked
                    && !(row.querySelector('.uw-day-start').value && row.querySelector('.uw-day-end').value && row.querySelector('.uw-day-start').value < row.querySelector('.uw-day-end').value));
                if (invalid) return { message: Lang.t('uwWorkTimeInvalid'), input: invalid.querySelector('.uw-day-start') };
            }
            return null;
        };

        const valueOrDash = value => value ? Utils.esc(value) : '<span class="hint">–</span>';
        const renderReview = () => {
            const data = collect();
            const nameOf = id => { const u = allUsers.find(x => x.id === id); return u ? (u.name || u.username) : ''; };
            const groupNames = data.groupIds.map(id => groups.find(g => g.id === id)).filter(Boolean).map(g => g.label || g.name).join(', ');
            const schedule = DAYS.filter(day => data.profile.work_days[day]).map(day => `${dayName(day)} ${data.profile.work_days[day].start}–${data.profile.work_days[day].end}`).join(', ');
            const rights = data.role === 'admin' && isSuper ? AdminBoard.PERMISSION_GROUPS.map(group => {
                const granted = group.items.filter(([key]) => AdminBoard.ADMIN_FLAGS.includes(key) ? data[key] : data.permissions[key]).map(([, label]) => Lang.t(label));
                if (group.key === 'features') granted.push(`${Lang.t('knowledgeBase')}: ${Lang.t({ none: 'noAccess', read: 'readOnly', edit: 'readAndEdit' }[data.permissions.kb] || 'noAccess')}`);
                return granted.length ? `${Lang.t(group.label)}: ${granted.join(', ')}` : '';
            }).filter(Boolean).join(' · ') : '';
            const section = (stepKey, labelKey, rows) => `
                <div class="uw-review-section">
                    <div class="uw-review-head"><strong>${Utils.esc(Lang.t(labelKey))}</strong><button type="button" class="btn-ghost btn-sm" data-goto="${stepKey}">${Icon('pencil', 14)}${Utils.esc(Lang.t('edit'))}</button></div>
                    <dl class="uw-review-list">${rows.map(([label, value]) => `<div><dt>${Utils.esc(Lang.t(label))}</dt><dd>${valueOrDash(value)}</dd></div>`).join('')}</dl>
                </div>`;
            $('#uw-review').innerHTML = `
                <p class="hint">${Utils.esc(Lang.t(isNew ? 'uwReviewHintNew' : 'uwReviewHintEdit'))}</p>
                ${section('account', 'uwStepAccount', [
                    ['uwFullName', data.name], ['email', data.email], ['username', data.username],
                    ['role', { user: 'User', admin: 'Admin', superadmin: 'Superadmin' }[data.role]],
                    ['uwPasswordState', data.password ? Lang.t(isNew ? 'uwPasswordSet' : 'uwPasswordChanged') : (isNew ? '' : Lang.t('uwPasswordUnchanged'))],
                    ...(canSetValidity ? [['validUntilInclusiveOptional', data.validityText]] : []),
                    ...(isSuper && data.role !== 'superadmin' ? [['uwLdapLogin', Lang.t(data.ldap ? 'uwYes' : 'uwNo')]] : [])
                ])}
                ${section('org', 'uwStepOrg', [
                    ['uwDepartment', data.department], ['jobTitle', data.jobTitle], ['uwOffice', data.officeLocation],
                    ['uwBuilding', data.profile.building], ['uwRoom', data.profile.room], ['uwEmployeeNumber', data.profile.employee_number],
                    ['uwCostCenter', data.profile.cost_center], ['uwEntryDate', data.entryDateText], ['supervisor', nameOf(data.supervisorUserId)], ['userGroupsLabel', groupNames]
                ])}
                ${section('contact', 'uwStepContact', [
                    ['phone', data.phone], ['mobile', data.mobile], ['uwWorkDays', schedule], ['uwAvailability', data.profile.availability_note]
                ])}
                ${rights ? section('rights', 'uwStepRights', [['adminRights', rights]]) : ''}`;
            modal.querySelectorAll('[data-goto]').forEach(btn => btn.onclick = () => show(btn.dataset.goto));
            if (window.lucide) lucide.createIcons();
        };

        let current = 'account';
        const visited = new Set(['account']);
        const show = stepKey => {
            const list = activeSteps();
            if (!list.some(step => step.key === stepKey)) stepKey = 'review';
            current = stepKey;
            visited.add(stepKey);
            const index = list.findIndex(step => step.key === stepKey);
            modal.querySelectorAll('.wizard-page').forEach(page => { page.hidden = page.dataset.page !== stepKey; });
            modal.querySelectorAll('.wizard-step').forEach(btn => {
                const position = list.findIndex(step => step.key === btn.dataset.step);
                btn.closest('li').hidden = position < 0;
                btn.classList.toggle('is-active', btn.dataset.step === stepKey);
                btn.classList.toggle('is-done', position >= 0 && position < index);
                btn.disabled = isNew && !visited.has(btn.dataset.step);
                btn.setAttribute('aria-selected', String(btn.dataset.step === stepKey));
                const no = btn.querySelector('.wizard-step-no');
                if (no && position >= 0) no.textContent = String(position + 1);
            });
            if (stepKey === 'review') renderReview();
            $('#uw-back').disabled = index === 0;
            $('#uw-next').innerHTML = stepKey === 'review'
                ? `${Icon(isNew ? 'user-plus' : 'save', 15)}${Utils.esc(Lang.t(isNew ? (request ? 'uwCreateAndApprove' : 'createButton') : 'save'))}`
                : `${Utils.esc(Lang.t('uwNext'))}${Icon('arrow-right', 15)}`;
            if (window.lucide) lucide.createIcons();
        };
        const fail = (issue, stepKey) => {
            show(stepKey);
            issue.input?.focus();
            UI.toast(issue.message);
        };
        modal.querySelectorAll('.wizard-step').forEach(btn => btn.onclick = () => {
            // Vorwaerts nur ueber gepruefte Schritte (beim Anlegen); zurueck und beim Bearbeiten frei.
            const list = activeSteps();
            const target = list.findIndex(step => step.key === btn.dataset.step);
            const from = list.findIndex(step => step.key === current);
            if (isNew && target > from) {
                for (const step of list.slice(from, target)) { const issue = validate(step.key); if (issue) return fail(issue, step.key); }
            }
            show(btn.dataset.step);
        });
        $('#uw-role')?.addEventListener('change', () => show(current));
        $('#uw-back').onclick = () => { const list = activeSteps(); const index = list.findIndex(step => step.key === current); if (index > 0) show(list[index - 1].key); };

        const save = async () => {
            for (const step of activeSteps()) { const issue = validate(step.key); if (issue) return fail(issue, step.key); }
            const data = collect();
            const validityVal = parseDate(data.validityText);
            const users = await Store.getUsers();
            const fields = {
                name: data.name, email: data.email, groupIds: data.groupIds, supervisorUserId: data.supervisorUserId,
                department: data.department, phone: data.phone, mobile: data.mobile, jobTitle: data.jobTitle, officeLocation: data.officeLocation,
                profile: data.profile
            };
            if (isNew) {
                users.push({
                    id: Utils.uid(), username: data.username, password: data.password, role: data.role, ...fields,
                    accountValidUntil: canSetValidity ? validityVal : null,
                    ldapLoginEnabled: data.ldap,
                    permissions: isSuper ? { ...data.permissions, canManageRequests: data.canManageRequests, canManageUsers: data.canManageUsers, canViewLogs: data.canViewLogs, canManage2FA: data.canManage2FA } : undefined
                });
            } else {
                const target = users.find(x => x.id === user.id);
                if (!target) return UI.toast(Lang.t('saveFailedGeneric'));
                Object.assign(target, fields);
                if (data.password) target.password = data.password;
                if (isSuper) Object.assign(target, {
                    role: data.role, permissions: data.permissions, ldapLoginEnabled: data.ldap,
                    canManageRequests: data.canManageRequests, canManageUsers: data.canManageUsers, canViewLogs: data.canViewLogs, canManage2FA: data.canManage2FA
                });
                if (canSetValidity) target.accountValidUntil = validityVal;
            }
            const buttons = [$('#uw-next'), $('#uw-save-now')].filter(Boolean);
            buttons.forEach(btn => { btn.disabled = true; });
            const ok = await Store.saveUsers(users);
            buttons.forEach(btn => { btn.disabled = false; });
            if (!ok) {
                const errText = Store.lastError || '';
                return UI.toast(errText.includes('email_taken') ? Lang.t('emailTakenError')
                    : errText.includes('last_superadmin') ? Lang.t('lastSuperadminError')
                    : errText.includes('username_taken') ? Lang.t('usernameTakenError')
                    : errText.includes('password_policy_failed') ? Lang.t('uwPasswordPolicyFailed')
                    : Lang.t('saveFailedGeneric'));
            }
            if (request && !(await Store.decideAccountRequest(request.id, 'approved'))) {
                modal.remove();
                await AdminBoard.renderRequests();
                return UI.toast(Lang.t('uwRequestNotUpdated'));
            }
            modal.remove();
            if (request) await AdminBoard.renderRequests();
            else if (q('#user-man-modal.open')) AdminBoard.renderUserManager(viewContext);
            UI.toast(Lang.t(request ? 'uwRequestApprovedToast' : isNew ? 'uwCreatedToast' : 'savedToast'));
        };
        $('#uw-next').onclick = () => {
            if (current === 'review') return save();
            const issue = validate(current);
            if (issue) return fail(issue, current);
            const list = activeSteps();
            show(list[list.findIndex(step => step.key === current) + 1].key);
        };
        if ($('#uw-save-now')) $('#uw-save-now').onclick = save;
        show('account');
        $('#uw-name').focus();
    },

    createGenericModal: () => {
        const modal = document.createElement('div');
        modal.id = 'generic-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3></h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="generic-save-head" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body"></div>
                <div class="modal-footer action-footer">
                    <button class="btn-secondary close-m footer-cancel">${Lang.t('cancel')}</button>
                    <button class="btn-primary">${Lang.t('save')}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
        modal.querySelector('#generic-save-head').onclick = () => modal.querySelector('.modal-footer .btn-primary')?.click();
        if (window.lucide) lucide.createIcons();
        return modal;
    },

    // Step-up-Bestätigung (Passwort + ggf. TOTP-Code) vor einer folgenreichen Aktion wie einem
    // In-App-Update, einer Migration oder einem Rollback -- gibt { password, totpCode } zurück
    // oder null bei Abbruch. Härtung statt Entfernung der Update-Funktion: eine gekaperte Session
    // allein reicht danach nicht mehr aus, um Code auf dem Server auszuführen.
    confirmStepUp: (message, commitLabel) => {
        return new Promise(resolve => {
            const modal = q('#generic-modal') || AdminBoard.createGenericModal();
            modal.querySelector('h3').textContent = Lang.t('securityConfirmationRequired');
            modal.querySelector('.modal-body').innerHTML = `
                <p>${Utils.esc(message)}</p>
                ${commitLabel ? `<div class="callout callout-info">${Lang.t('targetCommit')}: <code>${Utils.esc(commitLabel)}</code></div>` : ''}
                <div class="field"><label>${Lang.t('yourCurrentPassword')}</label><input id="stepup-password" type="password" autocomplete="current-password"></div>
                <div class="field"><label>${Lang.t('mfaCodeIfEnabled')}</label><input id="stepup-totp" type="text" inputmode="numeric" maxlength="6" placeholder="123456"></div>
            `;
            AdminBoard.makeModalFooterVisible(modal);
            const footerBtn = modal.querySelector('.modal-footer button:last-child');
            const cancelBtn = modal.querySelector('.modal-footer button:first-child');
            footerBtn.textContent = Lang.t('confirmAndContinue');
            cancelBtn.textContent = Lang.t('cancel');
            modal.classList.add('open');
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                modal.classList.remove('open');
                resolve(value);
            };
            // makeModalFooterVisible() entfernt .close-m vom Fußzeilen-Abbrechen-Button (damit er
            // nicht mehr doppelt mit dem Disketten-Icon im Kopf zusammenspielt) -- Kopf-X und
            // Fußzeile deshalb hier getrennt verdrahtet, statt sich auf die Klasse zu verlassen.
            modal.querySelectorAll('.modal-header .close-m').forEach(b => b.onclick = () => finish(null));
            cancelBtn.onclick = () => finish(null);
            footerBtn.onclick = () => {
                const password = q('#stepup-password').value;
                const totpCode = q('#stepup-totp').value.trim();
                if (!password) { UI.toast(Lang.t('passwordRequired')); return; }
                finish({ password, totpCode });
            };
        });
    },

    // Das generische Modal versteckt seine Fußzeile standardmäßig (Speichern l&auml;uft über das
    // Disketten-Icon im Kopf). Für Dialoge, bei denen ein eindeutig beschrifteter Button
    // klarer ist, blendet diese Funktion die Fußzeile sichtbar ein (nur für das übergebene,
    // bereits individualisierte Modal-Element -- nie das geteilte #generic-modal selbst).
    makeModalFooterVisible: (modal) => {
        const footer = modal.querySelector('.modal-footer');
        if (!footer) return;
        footer.classList.remove('action-footer');
        footer.classList.add('modal-footer-visible');
        footer.querySelectorAll('.footer-cancel, .close-m').forEach(btn => btn.classList.remove('footer-cancel', 'close-m'));
        // Das Disketten-Icon im Kopf wäre jetzt doppelt zum sichtbaren Speichern-Button in der Fußzeile
        modal.querySelector('#generic-save-head')?.remove();
    },

    // Fortschritt eines Update-Laufs (Schritte wie in ops/host-updater). job.step bleibt nach einem
    // Fehler auf dem zuletzt gestarteten Schritt stehen, job.failed/job.rolledBack zeigen den Ausgang.
    updateSteps: [
        { key: 'check', get label() { return Lang.t('updStepCheck'); } },
        { key: 'backup', get label() { return Lang.t('updStepBackup'); } },
        { key: 'download', get label() { return Lang.t('updStepDownload'); } },
        { key: 'build', get label() { return Lang.t('updStepBuild'); } },
        { key: 'database', get label() { return Lang.t('updStepDatabase'); } },
        { key: 'restart', get label() { return Lang.t('updStepRestart'); } }
    ],
    renderUpdateProgress: (job) => {
        const steps = AdminBoard.updateSteps;
        const done = job.step === 'done' || job.ok;
        let currentIndex = steps.findIndex(s => s.key === job.step);
        if (done) currentIndex = steps.length;
        if (currentIndex === -1 && !done) currentIndex = 0;
        const percent = done ? 100 : Math.round((currentIndex / steps.length) * 100);
        return `
            <div class="update-progress">
                <div class="update-progress-bar"><div class="update-progress-fill ${job.failed ? 'failed' : done ? 'ok' : ''}" data-percent="${percent}"></div></div>
                <ol class="update-progress-steps">
                    ${steps.map((s, i) => {
                        const state = job.failed && i === currentIndex ? 'failed' : (i < currentIndex || done) ? 'done' : i === currentIndex ? 'active' : '';
                        const icon = state === 'done' ? 'check' : state === 'failed' ? 'x' : state === 'active' ? 'loader-circle' : 'circle';
                        return `<li class="update-progress-step${state ? ' ' + state : ''}">${Icon(icon, 14)}<span>${Utils.esc(s.label)}</span></li>`;
                    }).join('')}
                </ol>
            </div>`;
    },

    // Stand der Datensicherung (ops/docker/backup.sh) mit Warnung, solange keine externe Kopie besteht.
    renderBackupState: (status) => {
        const backup = status.backup;
        if (!status.backupReady) {
            return `<div class="callout callout-warning upd-backup">${Icon('shield-alert', 16)}<div><strong>${Lang.t('updBackupMissingTitle')}</strong><p>${Lang.t('updBackupMissingText')}</p><code>bash ops/docker/backup.sh --init-keys</code></div></div>`;
        }
        const last = backup?.lastBackupAt ? Utils.fmtDate(backup.lastBackupAt) : Lang.t('updBackupNever');
        const offsite = backup?.offsite && backup.offsite !== 'none';
        const offsiteText = offsite
            ? Lang.format('updBackupOffsite', { target: backup.offsite === 's3' ? 'S3' : 'restic', date: backup.lastOffsiteAt ? Utils.fmtDate(backup.lastOffsiteAt) : Lang.t('updBackupNever') })
            : Lang.t('updBackupNoOffsite');
        const warn = !offsite || !!backup?.error;
        return `<div class="callout ${warn ? 'callout-warning' : 'callout-info'} upd-backup">${Icon(warn ? 'shield-alert' : 'shield-check', 16)}<div>
            <strong>${Lang.format('updBackupLast', { date: Utils.esc(last) })}</strong>
            <p>${Utils.esc(offsiteText)}${backup?.error ? ` ${Utils.esc(Lang.t('updBackupOffsiteFailed'))}` : ''}</p></div></div>`;
    },

    // pollTimer: laeuft ein Update, wird der Status alle 4 s neu abgefragt (ein Build dauert Minuten).
    updatePollTimer: null,
    // Anleitung im Update-Tab. Jede settings-section-title-Ueberschrift wird beim Aufbau des Dialogs
    // zu einem eigenen, einklappbaren Abschnitt (siehe Aufbau der .tab-content-Bereiche).
    // Systemeinstellungen > Info & Updates: Versionen und Zustand der Installation (nur Superadmin).
    renderSystemInfo: async () => {
        const area = q('#sys-info');
        if (!area) return;
        const actor = await Store.currentUser();
        if (actor?.role !== 'superadmin') { area.textContent = Lang.t('sysInfoSuperadminOnly'); return; }
        area.innerHTML = `<div class="empty-state compact">${Icon('loader-circle', 16)} ${Utils.esc(Lang.t('updateStatusChecking'))}</div>`;
        const info = await Store.getSystemInfo();
        if (!q('#sys-info')) return;
        if (!info) {
            area.innerHTML = `<div class="callout callout-danger">${Utils.esc(Lang.t('sysInfoLoadFailed'))}</div>`;
            return;
        }
        const v = value => Utils.esc(value === null || value === undefined || value === '' ? '–' : String(value));
        const state = on => `<span class="badge${on ? ' badge-accent' : ''}">${Utils.esc(Lang.t(on ? 'sysInfoActive' : 'sysInfoInactive'))}</span>`;
        const row = (labelKey, value) => `<div class="sys-info-row"><dt>${Utils.esc(Lang.t(labelKey))}</dt><dd>${value}</dd></div>`;
        const card = (labelKey, value, small = '') => `<div class="summary-card"><span>${Utils.esc(Lang.t(labelKey))}</span><strong>${v(value)}</strong><small>${v(small) === '–' ? '' : v(small)}</small></div>`;
        const uptime = seconds => {
            const d = Math.floor(seconds / 86400), h = Math.floor(seconds / 3600) % 24, m = Math.floor(seconds / 60) % 60;
            return Lang.current === 'en' ? `${d} d ${h} h ${m} min` : `${d} T ${h} Std. ${m} Min.`;
        };
        const commit = info.app.commit ? info.app.commit.slice(0, 12) : null;
        const libs = list => list.length
            ? list.map(lib => `<div class="sys-info-row"><dt><code>${Utils.esc(lib.name)}</code></dt><dd>${v(lib.version)}</dd></div>`).join('')
            : `<div class="sys-info-row"><dt>–</dt><dd>–</dd></div>`;
        area.innerHTML = `
            <div class="settings-summary-grid">
                ${card('sysInfoAppVersion', info.app.version, commit ? `Commit ${commit}` : Lang.t('sysInfoUnknownCommit'))}
                ${card('sysInfoNode', info.runtime.node, info.runtime.platform)}
                ${card('sysInfoDatabase', info.database.version, info.database.tls ? Lang.t('sysInfoTlsOn') : Lang.t('sysInfoTlsOff'))}
                ${card('sysInfoSchema', Lang.t(info.database.schema?.upToDate ? 'sysInfoSchemaOk' : 'sysInfoSchemaOutdated'), [Lang.format('sysInfoSchemaFingerprint', { value: (info.database.schema?.applied || '–').slice(0, 12) }), info.database.reencryptPending ? Lang.t('sysInfoReencryptPending') : ''].filter(Boolean).join(' · '))}
            </div>
            <h4 class="section-title">${Utils.esc(Lang.t('sysInfoInstallation'))}</h4>
            <dl class="sys-info-list">
                ${row('sysInfoCommit', info.app.commit ? `<span class="code-copy is-inline"><code>${v(info.app.commit)}</code>${AdminBoard.copyButton()}</span>` : v(null))}
                ${row('sysInfoBuiltAt', v(info.app.builtAt ? Utils.fmtDate(info.app.builtAt) : null))}
                ${row('sysInfoPublicUrl', v(info.installation.publicUrl))}
                ${row('sysInfoEnvironment', v(info.installation.environment))}
                ${row('sysInfoInstallationId', info.installation.installationId ? `<span class="code-copy is-inline"><code>${v(info.installation.installationId)}</code>${AdminBoard.copyButton()}</span>` : v(null))}
                ${row('sysInfoSetupAt', v(info.installation.setupCompletedAt ? Utils.fmtDate(info.installation.setupCompletedAt) : null))}
                ${row('sysInfoKernel', v(info.runtime.kernel))}
                ${row('sysInfoUptime', v(uptime(info.runtime.uptimeSeconds || 0)))}
                ${row('sysInfoMemory', v(`${info.runtime.memoryMb} MB`))}
            </dl>
            <h4 class="section-title">${Utils.esc(Lang.t('sysInfoIntegrations'))}</h4>
            <dl class="sys-info-list">
                ${row('sysInfoDbTls', state(info.database.tls) + (info.database.cipher ? ` <code>${v(info.database.cipher)}</code>` : ''))}
                ${row('sysInfoSmtp', state(info.integrations.smtp))}
                ${row('sysInfoLdap', state(info.integrations.ldap))}
                ${row('sysInfoOutlook', state(info.integrations.outlook))}
                ${row('sysInfoPasskeys', state(info.integrations.passkeys))}
                ${row('sysInfoAntivirus', state(info.integrations.antivirus))}
                ${row('sysInfoOfficePreview', state(info.integrations.officePreview))}
                ${row('sysInfoOnlyoffice', state(info.integrations.onlyoffice))}
                ${row('sysInfoUpdater', state(info.integrations.updater))}
                ${row('sysInfoProxy', v(info.integrations.trustedProxy))}
            </dl>
            <h4 class="section-title">${Utils.esc(Lang.t('sysInfoServerLibs'))}</h4>
            <dl class="sys-info-list">${libs(info.libraries.server || [])}</dl>
            <h4 class="section-title">${Utils.esc(Lang.t('sysInfoClientLibs'))}</h4>
            <dl class="sys-info-list">${libs(info.libraries.client || [])}</dl>
            <h4 class="section-title">${Utils.esc(Lang.t('sysInfoCounts'))}</h4>
            <dl class="sys-info-list">
                ${row('sysInfoUsers', v(`${info.counts.usersActive ?? '–'} / ${info.counts.usersTotal ?? '–'}`))}
                ${row('sysInfoTickets', v(`${info.counts.ticketsOpen ?? '–'} / ${info.counts.ticketsArchived ?? '–'}`))}
                ${row('sysInfoAttachments', v(info.counts.attachments))}
                ${row('sysInfoKbArticles', v(info.counts.kbArticles))}
            </dl>`;
        if (window.lucide) lucide.createIcons();
    },

    // Vorschau je Ticketnummer-Vorlage (mit Beispielnummer 42) und Pruefung aller Vorlagen,
    // Kuerzel und des Praefix. Liefert das erste Problem ({ input, message }) oder null.
    renderTicketNumberPreviews: (modal) => {
        const prefixInput = modal.querySelector('#sys-ticket-number-prefix');
        const prefix = prefixInput.value.trim();
        const padding = Math.max(1, Math.min(12, parseInt(modal.querySelector('#sys-ticket-number-padding').value, 10) || 5));
        const timeZone = modal.querySelector('#sys-company-timezone')?.value || 'Europe/Berlin';
        const defaultInput = modal.querySelector('#sys-ticket-number-format');
        const defaultFormat = defaultInput.value.trim() || (prefix ? '{prefix}-{number}' : '{number}');
        let firstIssue = null;
        const flag = (input, message) => {
            input.classList.toggle('is-invalid', !!message);
            if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
            if (message && !firstIssue) firstIssue = { input, message };
        };
        flag(prefixInput, /^[A-Za-z0-9_.-]*$/.test(prefix) ? null : Lang.t('ticketPrefixInvalid'));
        const codes = {};
        modal.querySelectorAll('[data-ticket-code]').forEach(input => {
            const code = input.value.trim();
            flag(input, !code || /^[A-Za-z0-9]{1,12}$/.test(code) ? null : Lang.t('ticketCodeInvalid'));
            codes[input.dataset.ticketCode] = code;
        });
        modal.querySelectorAll('[data-ticket-format]').forEach(input => {
            const category = input.dataset.ticketCategory || null;
            const own = input.value.trim();
            const format = own || defaultFormat;
            const preview = modal.querySelector(`[data-preview-for="${input.id}"]`);
            const problem = own || !category ? ticketNumberFormatProblem(format) : null;
            const example = problem ? '' : buildTicketNumberPreview({ format, prefix, padding, category, code: category ? codes[category] : '', timeZone });
            const longest = problem ? '' : buildTicketNumberPreview({ format, prefix, padding, category, code: category ? codes[category] : '', timeZone, sequence: Number('9'.repeat(Math.max(6, padding))) });
            const message = problem ? Lang.t(`ticketFormat_${problem}`) : longest.length > 32 ? Lang.format('ticketNumberTooLongHint', { max: 32 }) : null;
            flag(input, message);
            if (preview) {
                preview.classList.toggle('is-invalid', !!message);
                preview.textContent = message || Lang.format(own || !category ? 'ticketNumberPreview' : 'ticketNumberPreviewDefault', { example });
            }
        });
        return firstIssue;
    },

    // Verstaendliche Meldung zu einer abgelehnten Speicherung der Systemeinstellungen.
    settingsSaveErrorMessage: (raw) => {
        let error = {};
        try { error = JSON.parse(raw || '{}'); } catch { error = {}; }
        if (error.error === 'ticket_number_too_long') return Lang.format('ticketNumberTooLong', { example: error.example || '', max: error.max || 32 });
        if (error.error === 'padding_too_low') return Lang.format('ticketPaddingTooLow', { min: error.minRequired || '' });
        if (error.details?.fieldErrors?.outlookConfig) return Lang.t('outlookExternalDomainsInvalid');
        const fields = error.details?.fieldErrors || {};
        const ticketField = ['ticketNumberFormat', 'ticketNumberCategoryFormats', 'ticketNumberCategoryCodes'].find(key => fields[key]);
        if (ticketField) {
            const code = String(fields[ticketField][0] || '');
            return Lang.t(code === 'invalid_code' ? 'ticketCodeInvalid' : code === 'invalid_prefix' ? 'ticketPrefixInvalid' : `ticketFormat_${code}`) || Lang.t('systemSettingsSaveFailed');
        }
        return Lang.t('systemSettingsSaveFailed');
    },

    // Freigegebene Partnerdomains fuer Outlook-Einladungen (eine pro Zeile, ohne "@").
    outlookDomainList: () => [...new Set((q('#sys-outlook-domains')?.value || '').split(/[\s,;]+/)
        .map(domain => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))],

    // Klick auf ein Kopier-Symbol (.code-copy-btn) innerhalb eines .code-copy-Blocks.
    handleCopyClick: async (event) => {
        const button = event.target.closest('.code-copy-btn');
        if (!button) return;
        const text = button.closest('.code-copy')?.querySelector('code')?.textContent || '';
        if (!text || !(await UI.copyText(text))) return UI.toast(Lang.t('copyFailed'));
        UI.toast(Lang.t('copiedToClipboard'));
        button.classList.add('is-copied');
        button.innerHTML = Icon('check', 14);
        setTimeout(() => { button.classList.remove('is-copied'); button.innerHTML = Icon('copy', 14); if (window.lucide) lucide.createIcons(); }, 1500);
        if (window.lucide) lucide.createIcons();
    },

    // --- 9. Datenbank-Sicherung (nur Superadmin; alle Pruefungen erzwingt der Server) ---
    backupErrorMessage: (code) => Lang.t({
        wrong_password: 'wrongPassword', invalid_totp_code: 'invalidMfaCode', totp_code_required: 'backupTotpRequired',
        step_up_required: 'backupTotpRequired', mfa_required: 'backupMfaRequired', passphrase_too_short: 'backupPassphraseTooShort',
        backup_hash_mismatch: 'backupHashMismatch', backup_installation_mismatch: 'backupInstallationMismatch',
        backup_schema_mismatch: 'backupSchemaMismatch', backup_decrypt_failed: 'backupDecryptFailed', backup_invalid_file: 'backupInvalidFile',
        backup_invalid_content: 'backupInvalidFile', backup_too_large: 'backupTooLarge', backup_busy: 'backupBusy',
        backup_upload_missing: 'backupUploadMissing', confirmation_required: 'backupConfirmationRequired', rate_limited: 'backupRateLimited'
    }[code] || 'backupFailed'),

    openBackupCreate: () => {
        const modal = AdminBoard.openDialog({
            id: 'backup-create-modal',
            title: Lang.t('backupCreateTitle'),
            icon: 'database-backup',
            size: 'sm',
            body: `
                <p class="hint">${Lang.t('backupCreateIntro')}</p>
                <div class="field"><label for="bk-pass">${Lang.t('backupPassphrase')}</label><input id="bk-pass" type="password" autocomplete="new-password" minlength="16" maxlength="1024"><p class="hint">${Lang.t('backupPassphraseHint')}</p></div>
                <div class="field"><label for="bk-pass2">${Lang.t('backupPassphraseRepeat')}</label><input id="bk-pass2" type="password" autocomplete="new-password" maxlength="1024"></div>
                <div class="field"><label for="bk-pw">${Lang.t('yourCurrentPassword')}</label><input id="bk-pw" type="password" autocomplete="current-password"></div>
                <div class="field"><label for="bk-totp">${Lang.t('backupTotpLabel')}</label><input id="bk-totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div>
                <div class="button-row backup-actions"><button type="button" class="btn-primary" id="bk-go">${Icon('download', 15)}${Lang.t('backupCreateButton')}</button></div>
                <p class="hint" id="bk-status" role="status"></p>`
        });
        modal.querySelector('#bk-go').onclick = async () => {
            const passphrase = modal.querySelector('#bk-pass').value;
            if (passphrase.length < 16) return UI.toast(Lang.t('backupPassphraseTooShort'));
            if (passphrase !== modal.querySelector('#bk-pass2').value) return UI.toast(Lang.t('backupPassphraseMismatch'));
            const password = modal.querySelector('#bk-pw').value;
            if (!password) return UI.toast(Lang.t('passwordRequired'));
            const button = modal.querySelector('#bk-go');
            button.disabled = true;
            modal.querySelector('#bk-status').textContent = Lang.t('backupCreating');
            const result = await Store.createBackup({ passphrase, password, totp_code: modal.querySelector('#bk-totp').value.trim() || undefined });
            button.disabled = false;
            modal.querySelector('#bk-status').textContent = '';
            if (result.error) return UI.toast(AdminBoard.backupErrorMessage(result.error));
            const url = URL.createObjectURL(result.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = result.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            modal.remove();
            AdminBoard.showBackupHash(result.hash, result.name);
        };
        modal.querySelector('#bk-pass').focus();
    },

    showBackupHash: (hash, name) => {
        const modal = AdminBoard.openDialog({
            id: 'backup-hash-modal',
            title: Lang.t('backupCreatedTitle'),
            icon: 'shield-check',
            size: 'sm',
            body: `
                <div class="callout callout-info">${Utils.esc(Lang.format('backupCreatedIntro', { name }))}</div>
                <label class="backup-hash-label">${Lang.t('backupHashLabel')}</label>
                <div class="code-copy"><pre class="update-guide-code backup-hash"><code>${Utils.esc(hash)}</code></pre>${AdminBoard.copyButton()}</div>
                <p class="hint">${Lang.t('backupHashHint')}</p>`
        });
        modal.addEventListener('click', AdminBoard.handleCopyClick);
    },

    openBackupRestore: () => {
        const modal = AdminBoard.openDialog({
            id: 'backup-restore-modal',
            title: Lang.t('backupRestoreTitle'),
            icon: 'database-zap',
            size: 'md',
            body: `
                <div class="callout callout-danger">${Lang.t('backupRestoreWarning')}</div>
                <div class="field"><label for="br-file">${Lang.t('backupFile')}</label><input id="br-file" type="file" accept=".tsbackup,application/octet-stream"></div>
                <div class="field"><label for="br-hash">${Lang.t('backupHashLabel')}</label><input id="br-hash" type="text" class="mono" spellcheck="false" autocomplete="off" placeholder="${Lang.t('backupHashPlaceholder')}"><p class="hint">${Lang.t('backupHashRestoreHint')}</p></div>
                <div class="field"><label for="br-pass">${Lang.t('backupPassphrase')}</label><input id="br-pass" type="password" autocomplete="off" maxlength="1024"></div>
                <div class="field"><label for="br-pw">${Lang.t('yourCurrentPassword')}</label><input id="br-pw" type="password" autocomplete="current-password"></div>
                <div class="field"><label for="br-totp">${Lang.t('backupTotpLabel')}</label><input id="br-totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div>
                <div class="field"><label for="br-confirm">${Lang.format('backupConfirmLabel', { word: 'WIEDERHERSTELLEN' })}</label><input id="br-confirm" type="text" autocomplete="off" spellcheck="false"></div>
                <div class="button-row backup-actions"><button type="button" class="btn-danger" id="br-go">${Icon('database-zap', 15)}${Lang.t('backupRestoreButton')}</button></div>
                <p class="hint" id="br-status" role="status"></p>`
        });
        modal.querySelector('#br-go').onclick = async () => {
            const file = modal.querySelector('#br-file').files[0];
            if (!file) return UI.toast(Lang.t('backupChooseFile'));
            const sha256 = modal.querySelector('#br-hash').value.replace(/[\s:-]/g, '').toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(sha256)) return UI.toast(Lang.t('backupHashFormat'));
            const passphrase = modal.querySelector('#br-pass').value;
            if (passphrase.length < 16) return UI.toast(Lang.t('backupPassphraseTooShort'));
            const password = modal.querySelector('#br-pw').value;
            if (!password) return UI.toast(Lang.t('passwordRequired'));
            const confirm = modal.querySelector('#br-confirm').value.trim();
            if (confirm !== 'WIEDERHERSTELLEN') return UI.toast(Lang.t('backupConfirmationRequired'));
            const button = modal.querySelector('#br-go');
            const status = modal.querySelector('#br-status');
            button.disabled = true;
            status.textContent = Lang.t('backupUploading');
            const upload = await Store.uploadBackup(file);
            if (upload.error) {
                button.disabled = false;
                status.textContent = '';
                return UI.toast(AdminBoard.backupErrorMessage(upload.error));
            }
            status.textContent = Lang.t('backupRestoring');
            const result = await Store.restoreBackup({ sha256, passphrase, password, totp_code: modal.querySelector('#br-totp').value.trim() || undefined, confirm });
            if (result.error) {
                await Store.discardBackupUpload();
                button.disabled = false;
                status.textContent = '';
                return UI.toast(AdminBoard.backupErrorMessage(result.error));
            }
            // Alle Sitzungen wurden serverseitig beendet -- zur Anmeldung.
            status.textContent = Lang.format('backupRestored', { rows: result.rows ?? '–' });
            UI.toast(Lang.t('backupRestoredToast'));
            setTimeout(() => { window.location.href = '/'; }, 4000);
        };
    },

    // Kopier-Symbol fuer Codebloecke/Kennungen; ausgewertet per Delegation in openSystemSettings.
    copyButton: () => `<button type="button" class="btn-ghost btn-icon btn-xs code-copy-btn" title="${Utils.esc(Lang.t('copyToClipboard'))}" aria-label="${Utils.esc(Lang.t('copyToClipboard'))}">${Icon('copy', 14)}</button>`,

    updateGuideMarkup: () => {
        const code = text => `<div class="code-copy"><pre class="update-guide-code"><code>${Utils.esc(text)}</code></pre>${AdminBoard.copyButton()}</div>`;
        const p = key => `<p class="update-guide-text">${Utils.esc(Lang.t(key))}</p>`;
        const step = (key, command) => `<li>${Utils.esc(Lang.t(key))}${command ? code(command) : ''}</li>`;
        const title = key => `<div class="settings-section-title">${Utils.esc(Lang.t(key))}</div>`;
        const cd = 'cd /opt/ticket-system';
        return `
            ${title('updateGuideSecurityTitle')}
            ${p('updateGuideSecurityText1')}
            ${p('updateGuideSecurityText2')}
            <div class="callout callout-info">${Utils.esc(Lang.t('updateGuideSecurityRecommendation'))}</div>
            ${title('updateGuideEnableTitle')}
            ${p('updateGuideEnableOneText')}
            <ol class="update-guide-steps">
                ${step('updateGuideEnableStep1', cd)}
                ${step('updateGuideEnableOne', 'sudo bash ops/online-updates.sh enable')}
                ${step('updateGuideEnableFingerprint', 'sudo bash ops/online-updates.sh enable --fingerprint=<FINGERABDRUCK>')}
                ${step('updateGuideEnableStep5')}
            </ol>
            ${p('updateGuideSigningNote')}
            ${code('git config --global user.signingkey <KEY-ID>\ngit config --global commit.gpgsign true\ngpg --armor --export <KEY-ID> > release-signing-key.asc\n# alternativ je Release ein signierter Tag:\ngit tag -s v1.2.3 -m "Release 1.2.3"\ngit push origin v1.2.3')}
            ${p('updateGuideGithubCommitsNote')}
            ${title('updateGuideDisableTitle')}
            ${p('updateGuideDisableText')}
            <ol class="update-guide-steps">
                ${step('updateGuideDisableStep1', cd)}
                ${step('updateGuideDisableOne', 'sudo bash ops/online-updates.sh disable')}
                ${step('updateGuideStatusOne', 'sudo bash ops/online-updates.sh status')}
            </ol>
            ${p('updateGuideStateNote')}
            ${title('updateGuideManualTitle')}
            ${p('updateGuideManualText')}
            <ol class="update-guide-steps">
                ${step('updateGuideManualStep1', 'gpg --import /root/release-signing-key.asc')}
                ${step('updateGuideManualStep2', `${cd}\nbash ops/docker/backup.sh\nbash ops/verify-and-pull.sh\nbash install.sh`)}
            </ol>`;
    },

    renderUpdateStatus: async () => {
        const area = q('#sys-update-status');
        if (!area) return;
        clearTimeout(AdminBoard.updatePollTimer);
        const runBtn = q('#sys-update-run');
        if (runBtn) runBtn.hidden = true;
        const actor = await Store.currentUser();
        if (actor?.role !== 'superadmin') { area.textContent = Lang.t('onlySuperadminsCanUpdate'); return; }
        area.innerHTML = `<div class="empty-state compact">${Icon('loader-circle', 16)} ${Lang.t('updateStatusChecking')}</div>`;
        const status = await Store.getUpdateStatus();
        if (!q('#sys-update-status')) return;
        // Solange ein Wiederherstellungs-Kit auf dem Server liegt, deutlich warnen (Security-Audit 11/2026).
        const kitWarning = Number(status.recoveryKits) > 0
            ? `<div class="callout callout-danger upd-kit">${Icon('key-round', 16)}<div><strong>${Lang.t('recoveryKitOnServerTitle')}</strong><p>${Lang.t('recoveryKitOnServerText')}</p><code>shred -u ops/recovery-kit-*</code></div></div>`
            : '';
        const notice = (kind, text, retry = false) => {
            area.innerHTML = `${kitWarning}<div class="callout callout-${kind}">${text}</div>${retry ? `<button class="btn-secondary btn-sm" id="sys-update-retry" type="button">${Icon('refresh-cw', 15)}${Lang.t('checkAgain')}</button>` : ''}`;
            q('#sys-update-retry')?.addEventListener('click', () => AdminBoard.renderUpdateStatus());
            if (window.lucide) lucide.createIcons();
        };
        if (status.httpStatus === 0) return notice('danger', Lang.t('serverUnreachableRetry'), true);
        const command = text => `<div class="code-copy"><pre class="update-guide-code"><code>${Utils.esc(text)}</code></pre>${AdminBoard.copyButton()}</div>`;
        if (status.error === 'update_service_disabled' || status.error === 'update_service_not_configured') return notice('info', `${Utils.esc(Lang.t('onlineUpdatesDisabled'))}<p>${Utils.esc(Lang.t('onlineUpdatesEnableHow'))}</p>${command('sudo bash ops/online-updates.sh enable')}`);
        if (status.error === 'update_signature_not_configured') return notice('warning', `${Utils.esc(Lang.t('updatesLockedNoSignature'))}${command('sudo bash ops/online-updates.sh enable --key=/pfad/release-signing-key.asc')}`);
        if (status.error === 'update_runner_disabled' || status.enabled === false) return notice('info', Lang.t('updaterDeploymentDisabled'));
        if ([502, 503, 504].includes(status.httpStatus)) return notice('danger', Lang.format('updaterNotResponding', { code: Utils.esc(String(status.httpStatus)) }), true);
        if (status.error === 'github_unreachable') return notice('danger', Lang.t('githubUnreachable'), true);
        if (status.error || status.httpStatus !== 200) return notice('danger', Lang.format('updateStatusLoadFailed', { code: Utils.esc(String(status.httpStatus)) }), true);

        const job = status.job;
        const updateAvailable = !!status.updateAvailable;
        AdminBoard._lastUpdateStatus = status;
        const short = commit => Utils.esc((commit || '').slice(0, 7) || '-');
        const date = value => value ? Utils.esc(Utils.fmtDate(value)) : '';
        const changes = (status.changes || []).map(c => `<li><span class="upd-change-date">${Utils.esc(Utils.fmtDate(c.date).split(' ')[0])}</span><span>${Utils.esc(c.subject)}</span></li>`).join('');
        const hero = updateAvailable
            ? `<div class="upd-hero is-available">${Icon('sparkles', 22)}<div>
                    <strong>${Lang.format('updNewVersion', { count: status.commitsBehind || 1 })}</strong>
                    <span>${Lang.format('updVersionLine', { commit: short(status.remoteCommit), date: date(status.remoteDate) })}</span>
                </div></div>
                ${changes ? `<details class="upd-changes" open><summary>${Lang.t('updWhatsNew')}</summary><ul>${changes}</ul></details>` : ''}
                <div class="upd-plan">
                    <strong>${Lang.t('updPlanTitle')}</strong>
                    <ol>${['updPlanBackup', 'updPlanCheck', 'updPlanInstall', 'updPlanDatabase', 'updPlanRestart'].map(key => `<li>${Lang.t(key)}</li>`).join('')}</ol>
                    <p class="hint">${Lang.t('updPlanHint')}</p>
                </div>`
            : `<div class="upd-hero is-current">${Icon('circle-check', 22)}<div>
                    <strong>${Lang.t('upToDate')}</strong>
                    <span>${Lang.format('updVersionLine', { commit: short(status.localCommit), date: date(status.localDate) })}</span>
                </div></div>`;
        const jobBox = job ? `<div class="update-log ${job.failed ? 'failed' : job.ok ? 'ok' : 'running'}">
                <strong>${job.running ? Lang.t('updateRunning') : job.ok ? Lang.t('lastUpdateSuccessful') : job.rolledBack ? Lang.t('updRolledBack') : job.failed ? Lang.t('lastUpdateFailed') : ''}</strong>
                ${job.ok && job.needsInstaller ? `<div class="callout callout-info">${Lang.t('updateNeedsInstaller')}</div>` : ''}
                ${AdminBoard.renderUpdateProgress(job)}
                <details${job.failed ? ' open' : ''}><summary>${Lang.t('updShowLog')}</summary><pre>${Utils.esc((job.log || []).slice(-30).join('\n'))}</pre></details>
            </div>` : '';
        // Online-Updates sind aktiv: deutlich darauf hinweisen und zeigen, wie man sie wieder abschaltet.
        const enabledWarning = `<div class="callout callout-warning upd-enabled-warning">${Icon('shield-alert', 18)}<div>
                <strong>${Utils.esc(Lang.t('onlineUpdatesActiveTitle'))}</strong><p>${Utils.esc(Lang.t('onlineUpdatesActiveText'))}</p>
                ${command('sudo bash ops/online-updates.sh disable')}</div></div>`;
        area.innerHTML = `${kitWarning}${enabledWarning}${hero}${AdminBoard.renderBackupState(status)}${jobBox}`;

        if (runBtn) {
            runBtn.hidden = !updateAvailable || !!job?.running;
            runBtn.disabled = !!job?.running;
        }
        // Abgebrochener Lauf ohne neue Version: den aktuellen Stand erneut ausrollen.
        if (!updateAvailable && job?.failed && !job.running) {
            area.insertAdjacentHTML('beforeend', `<div class="setting-row"><span class="hint">${Lang.t('updRepairHint')}</span>
                <button class="btn-secondary btn-sm" id="sys-update-repair" type="button">${Icon('wrench', 15)}${Lang.t('updRepair')}</button></div>`);
            q('#sys-update-repair').onclick = async () => {
                const stepUp = await AdminBoard.confirmStepUp(Lang.t('updRepairConfirm'));
                if (!stepUp) return;
                q('#sys-update-repair').disabled = true;
                const result = await Store.runRepair(stepUp.password, stepUp.totpCode);
                UI.toast(result && [200, 202].includes(result.httpStatus) ? Lang.t('updateStartedToast')
                    : result?.error === 'wrong_password' ? Lang.t('wrongPassword') : result?.error === 'invalid_totp_code' ? Lang.t('invalidMfaCode') : Lang.t('updateDisabledOrUnreachable'));
                await AdminBoard.renderUpdateStatus();
            };
        }
        // Zurueck auf die Version vor dem letzten Update (Daten bleiben erhalten).
        if (status.rollbackAvailable && !job?.running) {
            area.insertAdjacentHTML('beforeend', `<div class="setting-row"><span class="hint">${Lang.format('rollbackHint', { commit: `<code>${short(status.rollbackCommit)}</code>` })}</span>
                <button class="btn-secondary btn-sm" id="sys-update-rollback" type="button">${Icon('undo-2', 15)}${Lang.t('rollback')}</button></div>`);
            q('#sys-update-rollback').onclick = async () => {
                const stepUp = await AdminBoard.confirmStepUp(Lang.t('rollbackConfirmMessage'), (status.rollbackCommit || '').slice(0, 12));
                if (!stepUp) return;
                q('#sys-update-rollback').disabled = true;
                const result = await Store.runRollback(status.rollbackCommit, stepUp.password, stepUp.totpCode);
                UI.toast(result && [200, 202].includes(result.httpStatus) ? Lang.t('rollbackStarted')
                    : result?.error === 'wrong_password' ? Lang.t('wrongPassword') : result?.error === 'invalid_totp_code' ? Lang.t('invalidMfaCode') : Lang.t('rollbackFailed'));
                await AdminBoard.renderUpdateStatus();
            };
        }
        if (window.lucide) lucide.createIcons();
        if (job?.running) AdminBoard.updatePollTimer = setTimeout(() => AdminBoard.renderUpdateStatus(), 4000);
    },

    // Review 11/2026, Punkt 2: brauchen Admin-Konten keinen zweiten Faktor, sieht jeder Superadmin
    // einen Hinweis mit Direktlink in die Sicherheitseinstellungen (je Person ausblendbar).
    showMfaPolicyHint: async () => {
        const security = (await Store.getSettings()).securityConfig || {};
        const viaMode = ['totp', 'passkey', 'either', 'both'].includes(security.mfaMode) && ['all', 'admin', undefined].includes(security.mfaRoles);
        const viaForce = ['all', 'admin'].includes(security.force2FA);
        const prefs = await Store.getPersonalPreferences().catch(() => ({}));
        if (viaMode || viaForce || prefs.mfaHintDismissed || q('#mfa-policy-hint')) return;
        const hint = document.createElement('div');
        hint.id = 'mfa-policy-hint';
        hint.className = 'callout callout-warning mfa-policy-hint';
        hint.setAttribute('role', 'status');
        hint.innerHTML = `${Icon('shield-alert', 18)}<div><strong>${Lang.t('mfaHintTitle')}</strong><p>${Lang.t('mfaHintText')}</p></div>
            <div class="mfa-policy-hint-actions"><button type="button" class="btn-primary btn-sm" data-act="open">${Lang.t('mfaHintOpen')}</button>
            <button type="button" class="btn-ghost btn-sm" data-act="dismiss">${Lang.t('mfaHintLater')}</button></div>`;
        q('main.container')?.prepend(hint);
        hint.querySelector('[data-act="open"]').onclick = async () => {
            await AdminBoard.openSystemSettings();
            q('.sys-settings-nav [data-tab="sys-security"]')?.click();
        };
        hint.querySelector('[data-act="dismiss"]').onclick = () => {
            hint.remove();
            Store.patchPersonalPreferences({ mfaHintDismissed: true }).catch(error => UI.toast(error.message));
        };
        if (window.lucide) lucide.createIcons();
    },

    // Arbeitsansichten ueber dem Board; Auswahl und "Geschlossene anzeigen" merkt sich der Browser.
    boardQueue: (() => { try { return localStorage.getItem('board-queue') || 'open'; } catch { return 'open'; } })(),
    showClosed: (() => { try { return localStorage.getItem('board-show-closed') === '1'; } catch { return false; } })(),
    boardQueues: (user, deadlines, now) => {
        const open = t => t.status !== 'Geschlossen';
        const atRisk = t => {
            const due = deadlines.get(t.id);
            return open(t) && !String(t.status).startsWith('Warten') && due !== null && due !== undefined && due - now < 4 * 3600000;
        };
        return {
            open: { icon: 'layers', label: 'queueOpen', match: open },
            mine: { icon: 'user-check', label: 'queueMine', match: t => open(t) && t.owner === user?.username },
            unassigned: { icon: 'user-x', label: 'queueUnassigned', match: t => open(t) && !t.owner },
            reply: { icon: 'message-circle-reply', label: 'queueReply', match: t => open(t) && !!t.awaitingReply },
            sla: { icon: 'alarm-clock', label: 'queueSla', match: atRisk }
        };
    },
    renderQueueBar: (tickets, queues) => {
        const tools = q('#kanban-view .board-tools');
        if (!tools) return;
        let bar = q('#board-queues');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'board-queues';
            bar.className = 'board-queues';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', Lang.t('queueToolbar'));
            tools.appendChild(bar);
        }
        bar.innerHTML = Object.entries(queues).map(([key, queue]) => {
            const count = tickets.filter(queue.match).length;
            const active = AdminBoard.boardQueue === key;
            return `<button type="button" class="queue-chip${active ? ' is-active' : ''}${key === 'sla' && count ? ' is-alert' : ''}" data-queue="${key}" aria-pressed="${active}">${Icon(queue.icon, 15)}<span>${Utils.esc(Lang.t(queue.label))}</span><span class="queue-count">${count}</span></button>`;
        }).join('') + `<label class="check-row compact queue-closed"><input type="checkbox" id="board-show-closed"${AdminBoard.showClosed ? ' checked' : ''}${AdminBoard.boardQueue === 'open' ? '' : ' disabled'}><span>${Utils.esc(Lang.t('queueShowClosed'))}</span></label>`;
        bar.querySelectorAll('[data-queue]').forEach(btn => btn.onclick = () => {
            AdminBoard.boardQueue = btn.dataset.queue;
            try { localStorage.setItem('board-queue', AdminBoard.boardQueue); } catch { /* nur Komfort */ }
            AdminBoard.render();
        });
        bar.querySelector('#board-show-closed').onchange = event => {
            AdminBoard.showClosed = event.target.checked;
            try { localStorage.setItem('board-show-closed', AdminBoard.showClosed ? '1' : '0'); } catch { /* nur Komfort */ }
            AdminBoard.render();
        };
        if (window.lucide) lucide.createIcons();
    },

    // Einstellungsbereiche je Recht (Server: domain/adminPermissions.ts SETTINGS_SECTION_KEYS).
    SETTINGS_SECTION_KEYS: {
        settingsGeneral: ['portalName', 'autoArchiveClosedAfterDays', 'uploadConfig', 'avatarConfig', 'timeTrackingConfig', 'defaultPrio',
            'waitingReminderDays', 'waitingAutoCloseDays', 'waitingAfterAction', 'waitingReminderEnabled'],
        settingsTicketForm: ['ticketFormConfig'],
        settingsSla: ['slaHoursByPriority', 'showSlaToUsers', 'businessHours'],
        settingsApprovals: ['approvalWorkflow'],
        settingsCompany: ['companyName', 'companyBrandingConfig'],
        settingsTicketNumbers: ['ticketNumberFormat', 'ticketNumberCategoryFormats', 'ticketNumberCategoryCodes'],
        settingsNotifications: ['notifPolicy', 'notifConfig']
    },
    SETTINGS_TAB_PERMISSIONS: {
        'sys-general': ['settingsGeneral'], 'sys-ticketform': ['settingsTicketForm'], 'sys-categories': ['settingsCategories'],
        'sys-sla': ['settingsSla'], 'sys-approvals': ['settingsApprovals'], 'sys-notifications': ['settingsNotifications'],
        'sys-company': ['settingsCompany', 'settingsTicketNumbers']
    },
    // Reiter der Systemeinstellungen, die eine Person oeffnen darf (Superadmin: alle).
    settingsTabs: (user) => {
        const all = ['sys-general', 'sys-ticketform', 'sys-categories', 'sys-modules', 'sys-sla', 'sys-approvals', 'sys-outlook', 'sys-security',
            'sys-profiles', 'sys-notifications', 'sys-email', 'sys-ldap', 'sys-company', 'sys-update'];
        if (user?.role === 'superadmin') return all;
        if (user?.role !== 'admin') return [];
        // Reiter abgeschalteter Module gibt es fuer Admins nicht (nur Superadmins schalten Module um).
        const moduleOff = { 'sys-sla': Store.modules.sla === false, 'sys-approvals': Store.modules.approvals === false };
        return all.filter(tab => !moduleOff[tab] && (AdminBoard.SETTINGS_TAB_PERMISSIONS[tab] || []).some(perm => user.permissions?.[perm] === true));
    },
    // Konto-Selbstverwaltung (Felder wie Store.SELF_SERVICE_FIELDS) und Kontaktangaben fuer Admins.
    SELF_FIELD_GROUPS: [
        ['uwStepAccount', [['name', 'name'], ['email', 'email']]],
        ['uwStepOrg', [['department', 'uwDepartment'], ['jobTitle', 'jobTitle'], ['officeLocation', 'uwOffice'], ['building', 'uwBuilding'], ['room', 'uwRoom'],
            ['employeeNumber', 'uwEmployeeNumber'], ['costCenter', 'uwCostCenter'], ['entryDate', 'uwEntryDate']]],
        ['uwStepContact', [['phone', 'phone'], ['mobile', 'mobile'], ['workDays', 'uwWorkDays'], ['availability', 'uwAvailability']]]
    ],
    CONTACT_FIELDS: [['email', 'email'], ['phone', 'phone'], ['mobile', 'mobile'], ['department', 'uwDepartment'], ['jobTitle', 'jobTitle'],
        ['officeLocation', 'uwOffice'], ['building', 'uwBuilding'], ['room', 'uwRoom'], ['supervisor', 'supervisor'], ['groups', 'userGroupsLabel'],
        ['workTimes', 'uwWorkDays'], ['availability', 'uwAvailability'], ['employeeNumber', 'uwEmployeeNumber'], ['costCenter', 'uwCostCenter'], ['entryDate', 'uwEntryDate']],
    DEFAULT_CONTACT_FIELDS: ['email', 'phone', 'mobile', 'department', 'jobTitle', 'officeLocation', 'building', 'room', 'supervisor', 'groups', 'workTimes', 'availability'],

    // tab: Reiter, der geoeffnet werden soll (z. B. 'sys-categories'); options.groupId filtert die Kategorien.
    openSystemSettings: async (tab = null, options = {}) => {
        if (typeof tab !== 'string') tab = null;
        const actor = await Store.currentUser();
        const isSuper = actor?.role === 'superadmin';
        const allowedTabs = AdminBoard.settingsTabs(actor);
        if (!allowedTabs.length) return UI.toast(Lang.t('noSettingsPermission'));
        const can = perm => isSuper || actor?.permissions?.[perm] === true;
        let apprFallbackPicker;
        let modal = q('#sys-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sys-settings-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-xl">
                    <div class="modal-header">
                        <h3>${Icon('sliders', 18)}${Lang.t('systemSettings')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="sys-save-head" title="${Lang.t('saveSettings')}" aria-label="${Lang.t('saveSettings')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="sys-settings-shell">
                    <nav class="sys-settings-nav" aria-label="${Lang.t('systemSettings')}">
                        <div class="sys-settings-search">${Icon('search', 15)}<input type="search" id="sys-settings-search" placeholder="${Utils.esc(Lang.t('settingsSearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('settingsSearchPlaceholder'))}"></div>
                        <button class="tab-btn active" data-tab="sys-general">
                            <i data-lucide="sliders"></i><span>${Lang.t('general')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-ticketform">
                            <i data-lucide="file-pen-line"></i><span>${Lang.t('ticketFormTab')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-categories">
                            <i data-lucide="tags"></i><span>${Lang.t('categoriesLabel')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-modules">
                            <i data-lucide="blocks"></i><span>${Lang.t('modulesTab')}</span>
                        </button>
                        <div class="sys-nav-group-label">${Lang.t('settingsModuleGroup')}</div>
                        <button class="tab-btn is-module" data-tab="sys-sla" data-module="sla">
                            <i data-lucide="timer"></i><span>${Lang.t('moduleSla')}</span>
                        </button>
                        <button class="tab-btn is-module" data-tab="sys-approvals" data-module="approvals">
                            <i data-lucide="badge-check"></i><span>${Lang.t('moduleApprovals')}</span>
                        </button>
                        <button class="tab-btn is-module" data-tab="sys-outlook" data-module="outlook">
                            <i data-lucide="calendar-days"></i><span>${Lang.t('moduleOutlook')}</span>
                        </button>
                        <div class="sys-nav-group-label">${Lang.t('settingsSystemGroup')}</div>
                        <button class="tab-btn" data-tab="sys-security">
                            <i data-lucide="shield"></i><span>${Lang.t('security')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-profiles">
                            <i data-lucide="contact-round"></i><span>${Lang.t('profilesTab')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-notifications">
                            <i data-lucide="bell"></i><span>Benachrichtigungen</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-email">
                            <i data-lucide="mail"></i><span>${Lang.t('emailSettings')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-ldap">
                            <i data-lucide="server"></i><span>LDAP</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-company">
                            <i data-lucide="building-2"></i><span>${Lang.t('companySettingsTab')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-update">
                            <i data-lucide="info"></i><span>${Lang.t('infoAndUpdates')}</span>
                        </button>
                    </nav>
                    <div class="modal-body sys-settings-content">
                        <div class="callout" hidden>Microsoft-Graph/Outlook-Integration gibt es im aktuellen Backend nicht -- dieses Feld
                            wurde entfernt statt ungespeichert vorzutäuschen. Automatische Zuweisung l&auml;uft über die Kategorie
                            (Benutzerverwaltung → Kategorien → „Automatische Zuweisung an Gruppe").</div>
                        <!-- Sicherheit -->
                        <div id="sys-security" class="tab-content">
                            <div class="settings-section-title">${Lang.t('mfaPolicyTitle')}</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-mfa-mode">${Lang.t('mfaPolicyModeLabel')}</label>
                                    <select id="sys-mfa-mode"><option value="disabled">${Lang.t('mfaPolicyNone')}</option><option value="totp">${Lang.t('mfaPolicyTotp')}</option><option value="passkey">${Lang.t('mfaPolicyPasskey')}</option><option value="either">${Lang.t('mfaPolicyEither')}</option><option value="both">${Lang.t('mfaPolicyBoth')}</option></select></div>
                                <div class="field"><label for="sys-mfa-roles">${Lang.t('mfaPolicyRolesLabel')}</label><select id="sys-mfa-roles"><option value="all">${Lang.t('mfaPolicyRolesAll')}</option><option value="admin">${Lang.t('mfaPolicyRolesAdmin')}</option><option value="user">${Lang.t('mfaPolicyRolesUser')}</option></select></div>
                            </div>
                            <p class="hint">${Lang.t('mfaPolicyHint')}</p>
                            <div class="field"><label for="sys-passkey-days">${Lang.current === 'en' ? 'TOTP + passkey: verify passkey again after days (0 = every login)' : 'TOTP + Passkey: erneuter Passkey-Nachweis nach Tagen (0 = jede Anmeldung)'}</label><input id="sys-passkey-days" type="number" min="0" max="365"><p class="hint">${Lang.current === 'en' ? 'Passkeys need a trusted HTTPS domain. Phones and security keys are supported by the browser. First enroll an authenticator as a recovery method. SMS / push require an external provider.' : 'Passkeys benötigen einen vertrauenswürdigen HTTPS-Domainnamen. Handy und Sicherheitsschlüssel werden über den Browser unterstützt. Zuerst einen Authenticator als Wiederherstellungsweg einrichten. SMS / Push benötigen einen externen Anbieter.'}</p></div>
                            <div class="settings-section-title">${Lang.current === 'en' ? 'Login and sessions' : 'Anmeldung und Sitzungen'}</div>
                            <div class="field">
                                <label>${Lang.t('sessionTimeoutMinutes')}</label>
                                <input id="sys-session-timeout" type="number" placeholder="480" min="5">
                                <div class="hint">${Lang.t('sessionTimeoutHint')}</div>
                            </div>
                            <div class="field">
                                <label>${Lang.t('idleTimeoutMinutes')}</label>
                                <input id="sys-idle-timeout" type="number" placeholder="60" min="1">
                                <div class="hint">${Lang.t('idleTimeoutHint')}</div>
                            </div>
                            <div class="field">
                                <label>${Lang.t('maxLoginAttempts')}</label>
                                <input id="sys-max-login-attempts" type="number" placeholder="5" min="1">
                                <div class="hint">${Lang.t('maxLoginAttemptsHint')}</div>
                            </div>
                            <div class="field">
                                <label>${Lang.t('afterFailedAttemptsQuestion')}</label>
                                <select id="sys-lockout-action">
                                    <option value="temp">${Lang.t('lockoutActionTemp')}</option>
                                    <option value="none">${Lang.t('lockoutActionLogOnly')}</option>
                                </select>
                                <div class="hint">${Lang.t('lockoutActionHint')}</div>
                            </div>
                            <div class="field" id="sys-lockout-minutes-field">
                                <label>${Lang.t('lockoutDurationMinutes')}</label>
                                <input id="sys-lockout-minutes" type="number" placeholder="15" min="1">
                            </div>
                            <div class="settings-section-title">${Lang.t('passwordRequirementsTitle')}</div>
                            <div class="form-grid">${Object.entries({ minLength: 'passwordLength', minLowercase: 'passwordLowercase', minUppercase: 'passwordUppercase', minDigits: 'passwordDigits', minSpecial: 'passwordSpecial' }).map(([key, label]) => `<div class="field"><label for="sys-pw-${key}">${Lang.t(label)}</label><input id="sys-pw-${key}" type="number" min="${key === 'minLength' ? 14 : 0}" max="${key === 'minLength' ? 128 : 16}" required></div>`).join('')}</div>
                        </div>

                        <!-- Ticketformular im Benutzer-Dashboard -->
                        <div id="sys-ticketform" class="tab-content">
                            <div class="settings-section-title">${Lang.t('priorityModeTitle')}</div>
                            <p class="hint">${Lang.t('priorityModeHint')}</p>
                            <div class="choice-cards" role="radiogroup" aria-label="${Utils.esc(Lang.t('priorityModeTitle'))}">
                                <label class="choice-card"><input type="radio" name="sys-prio-mode" value="impact">
                                    <span class="choice-card-body"><strong>${Icon('users', 16)}${Lang.t('priorityModeImpact')}</strong><span>${Lang.t('priorityModeImpactHint')}</span>
                                    <span class="choice-preview"><span>${Lang.t('impactQuestion')}</span><span>${Lang.t('urgencyQuestion')}</span></span></span></label>
                                <label class="choice-card"><input type="radio" name="sys-prio-mode" value="priority">
                                    <span class="choice-card-body"><strong>${Icon('signal', 16)}${Lang.t('priorityModePriority')}</strong><span>${Lang.t('priorityModePriorityHint')}</span>
                                    <span class="choice-preview"><span>${Lang.t('low')}</span><span>${Lang.t('normal')}</span><span>${Lang.t('high')}</span></span></span></label>
                            </div>
                            <div class="settings-section-title">${Lang.t('serviceBarTitle')}</div>
                            <label class="check-row"><input type="checkbox" id="sys-show-service-bar"><span class="check-text"><strong>${Lang.t('serviceBarShow')}</strong><span>${Lang.t('serviceBarShowHint')}</span></span></label>
                            <div class="setting-row"><span class="hint">${Lang.t('serviceBarCategoriesHint')}</span>
                                <button type="button" class="btn-secondary btn-sm" id="sys-goto-categories">${Icon('tags', 15)}${Lang.t('categoriesLabel')}</button></div>
                        </div>

                        <!-- Kategorien (vorher Benutzerverwaltung) -->
                        <div id="sys-categories" class="tab-content">
                            <div class="settings-section-title">${Lang.t('categoriesLabel')}</div>
                            <p class="hint">${Lang.t('categoriesSettingsHint')}</p>
                            <div class="cat-settings-toolbar">
                                <div class="module-search">${Icon('search', 16)}<input type="search" id="sys-cat-search" class="section-search" placeholder="${Utils.esc(Lang.t('categorySearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('categorySearchPlaceholder'))}"></div>
                                <button type="button" class="btn-secondary btn-sm" id="sys-cat-groups" hidden>${Icon('users-round', 15)}${Lang.t('groupsTab')}</button>
                                <button type="button" class="btn-primary btn-sm" id="sys-cat-add">${Icon('plus', 15)}${Lang.t('newCategory')}</button>
                            </div>
                            <div class="callout callout-info cat-filter-note" id="sys-cat-filter-note" hidden></div>
                            <div id="sys-categories-list" class="cat-settings-list"></div>
                        </div>

                        <!-- Kontaktdaten & Profile (nur Superadmin) -->
                        <div id="sys-profiles" class="tab-content">
                            <div class="settings-section-title">${Lang.t('accountSelfManagement')}</div>
                            <p class="hint">${Lang.t('accountSelfManagementHintExtended')}</p>
                            <div class="field-group-grid">${AdminBoard.SELF_FIELD_GROUPS.map(([group, fields]) => `
                                <fieldset class="field-group"><legend>${Lang.t(group)}</legend>
                                    ${fields.map(([key, label]) => `<label class="check-row compact"><input type="checkbox" data-self-field="${key}"><span>${Lang.t(label)}</span></label>`).join('')}
                                </fieldset>`).join('')}</div>
                            <div class="settings-section-title">${Lang.t('contactVisibilityTitle')}</div>
                            <p class="hint">${Lang.t('contactVisibilityHint')}</p>
                            <div class="field"><label>${Lang.t('contactVisibilityDefaults')}</label>
                                <div class="perm-grid">${AdminBoard.CONTACT_FIELDS.map(([key, label]) => `<label class="check-row compact"><input type="checkbox" data-cv-default="${key}"><span>${Lang.t(label)}</span></label>`).join('')}</div></div>
                            <div class="field field-wide"><label>${Lang.t('contactVisibilityGroups')}</label>
                                <div id="sys-cv-groups" class="cv-rule-list"></div>
                                <button type="button" class="btn-secondary btn-sm" id="sys-cv-group-add">${Icon('plus', 15)}${Lang.t('contactVisibilityAddGroup')}</button></div>
                            <div class="field field-wide"><label>${Lang.t('contactVisibilityUsers')}</label>
                                <div id="sys-cv-users" class="cv-rule-list"></div>
                                <button type="button" class="btn-secondary btn-sm" id="sys-cv-user-add">${Icon('plus', 15)}${Lang.t('contactVisibilityAddUser')}</button></div>
                        </div>

                        <!-- Benachrichtigungen -->
                        <div id="sys-notifications" class="tab-content">
                            <div class="settings-section-title">${Icon('bell-ring', 15)}${Lang.t('emailAutoSendHeading')}</div>
                            <div class="checkbox-list">
                                <label class="check-row">
                                    <input type="checkbox" id="notif-account-approved">
                                    <span class="check-text"><strong>${Lang.t('accountApproved')}</strong><span>${Lang.t('accountApprovedHint')}</span></span>
                                </label>
                            </div>
                            <div class="settings-section-title">${Icon('sliders-horizontal', 15)}${Lang.t('policyPerEvent')}</div>
                            <p class="hint">${Lang.t('policyPerEventHint')}</p>
                            <div id="sys-notif-matrix" class="notif-matrix"></div>
                        </div>

                        <!-- Outlook -->
                        <div id="sys-outlook" class="tab-content" data-module="outlook">
                            <div class="callout">${Lang.format('outlookIntegrationCallout', { help: FieldHelp(Lang.t('outlookIntegrationHelp')) })}</div>
                            <div class="callout callout-info">${Lang.format('outlookPersonalCalendarHint', { redirectUri: `<code>${Utils.esc(window.location.origin + '/api/v2/outlook/callback')}</code>` })}</div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-enabled"><span><strong>${Lang.t('outlookEnableIntegration')}</strong></span></label>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('tenantId')} ${FieldHelp(Lang.t('tenantIdHelp'))}</label><input id="sys-outlook-tenant" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
                                <div class="field"><label>${Lang.t('clientId')} ${FieldHelp(Lang.t('clientIdHelp'))}</label><input id="sys-outlook-client" type="text" placeholder="App Registration Client-ID"></div>
                            </div>
                            <div class="field"><label>${Lang.t('clientSecret')} ${FieldHelp(Lang.t('clientSecretHelp'))}</label><input id="sys-outlook-secret" type="password" placeholder="${Lang.t('leaveEmptyUnchanged')}"></div>
                            <div class="field"><label>${Lang.t('supportMailbox')} ${FieldHelp(Lang.t('supportMailboxHelp'))}</label><input id="sys-outlook-mailbox" type="email" placeholder="support@example.com"></div>
                            <div class="field"><label for="sys-outlook-domains">${Lang.t('outlookExternalDomains')}</label><textarea id="sys-outlook-domains" rows="3" placeholder="partner.example&#10;lieferant.example"></textarea><p class="hint">${Lang.t('outlookExternalDomainsHint')}</p></div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-sync" disabled><span>${Lang.t('outlookSyncNotAvailable')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-create" disabled><span>${Lang.t('outlookCreateNotAvailable')}</span></label>
                            <div class="setting-row">
                                <span class="hint" id="sys-outlook-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-outlook-save" type="button">${Icon('save', 15)}${Lang.t('saveOutlookSettings')}</button>
                            </div>
                        </div>

                        <!-- Update -->
                        <div id="sys-update" class="tab-content">
                            <div class="settings-section-title">${Lang.t('sysInfoTitle')}</div>
                            <div id="sys-info"><div class="empty-state compact">${Lang.t('notCheckedYet')}</div></div>
                            <div class="settings-section-title">${Lang.t('update')}</div>
                            <div class="update-status" id="sys-update-status">
                                <div class="empty-state compact">${Lang.t('notCheckedYet')}</div>
                            </div>
                            <div class="upd-actions">
                                <button class="btn-secondary btn-sm" id="sys-update-check" type="button">${Icon('refresh-cw', 15)}${Lang.t('check')}</button>
                                <button class="btn-primary" id="sys-update-run" type="button" hidden>${Icon('download-cloud', 16)}${Lang.t('updRunNow')}</button>
                            </div>
                            <div class="settings-section-title">${Lang.t('backupSectionTitle')}</div>
                            <div class="callout">${Lang.t('backupSectionCallout')}</div>
                            <div class="backup-grid">
                                <div class="backup-card">
                                    <span class="module-icon">${Icon('database-backup', 20)}</span>
                                    <div><strong>${Lang.t('backupCreateTitle')}</strong><p class="hint">${Lang.t('backupCreateCardHint')}</p></div>
                                    <button class="btn-secondary btn-sm" id="sys-backup-create" type="button">${Icon('download', 15)}${Lang.t('backupCreateButton')}</button>
                                </div>
                                <div class="backup-card is-danger">
                                    <span class="module-icon">${Icon('database-zap', 20)}</span>
                                    <div><strong>${Lang.t('backupRestoreTitle')}</strong><p class="hint">${Lang.t('backupRestoreCardHint')}</p></div>
                                    <button class="btn-secondary btn-sm" id="sys-backup-restore" type="button">${Icon('upload', 15)}${Lang.t('backupRestoreButton')}</button>
                                </div>
                            </div>
                            ${AdminBoard.updateGuideMarkup()}
                        </div>

                        <!-- LDAP -->
                        <div id="sys-ldap" class="tab-content">
                            <div class="callout">${Lang.t('ldapSupplementCallout')}</div>
                            <label class="check-row"><input type="checkbox" id="sys-ldap-enabled"><span><strong>${Lang.t('enableLdapLogin')}</strong></span></label>
                            <div class="field"><label>${Lang.t('serverUrl')}</label><input id="sys-ldap-url" type="text" placeholder="ldaps://dc.example.com:636"></div>
                            <div class="field"><label>${Lang.t('searchBaseDn')}</label><input id="sys-ldap-base-dn" type="text" placeholder="dc=example,dc=com"></div>
                            <div class="field"><label>${Lang.t('userFilter')}</label><input id="sys-ldap-filter" type="text" placeholder="(uid={username})"></div>
                            <div class="settings-section-title">${Lang.t('serviceAccountForPersonSearch')}</div>
                            <div class="field"><label>${Lang.t('bindDn')}</label><input id="sys-ldap-bind-dn" type="text" placeholder="cn=service,dc=example,dc=com"></div>
                            <div class="field"><label>${Lang.t('bindPassword')}</label><input id="sys-ldap-bind-pass" type="password" placeholder="${Lang.t('leaveEmptyUnchanged')}"></div>
                            <div class="setting-row">
                                <span class="hint" id="sys-ldap-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-ldap-save" type="button">${Icon('save', 15)}${Lang.t('save')}</button>
                            </div>
                            <div class="settings-section-title">${Lang.t('testConnection')}</div>
                            <div class="hint">${Lang.t('testConnectionHint')}</div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('ownLdapPassword')}</label><input id="sys-ldap-test-pass" type="password"></div>
                            </div>
                            <button class="btn-secondary btn-sm" id="sys-ldap-test" type="button">${Icon('send', 15)}${Lang.t('testConnection')}</button>
                        </div>
                        <!-- E-Mail / SMTP -->
                        <div id="sys-email" class="tab-content">
                            <div class="callout">${Lang.t('smtpIntroCallout')}</div>
                            <div class="field"><label>${Lang.t('smtpHost')} ${FieldHelp(Lang.t('smtpHostHelp'))}</label><input id="sys-smtp-host" type="text" placeholder="smtp.example.com"></div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('smtpPort')} ${FieldHelp(Lang.t('smtpPortHelp'))}</label><input id="sys-smtp-port" type="number" placeholder="587"></div>
                                <div class="field"><label>${Lang.t('encryption')} ${FieldHelp(Lang.t('encryptionHelp'))}</label><select id="sys-smtp-secure"><option value="false">${Lang.t('starttlsRecommended')}</option><option value="true">TLS/SSL</option></select></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('smtpUsername')} ${FieldHelp(Lang.t('smtpUsernameHelp'))}</label><input id="sys-smtp-user" type="text" placeholder="support@example.com"></div>
                                <div class="field"><label>${Lang.t('smtpPassword')} ${FieldHelp(Lang.t('smtpPasswordHelp'))}</label><input id="sys-smtp-pass" type="password" placeholder="${Lang.t('leaveEmptyUnchanged')}"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('senderAddress')} ${FieldHelp(Lang.t('senderAddressHelp'))}</label><input id="sys-smtp-from" type="email" placeholder="support@example.com"></div>
                                <div class="field"><label>${Lang.t('senderName')} ${FieldHelp(Lang.t('senderNameHelp'))}</label><input id="sys-smtp-fromname" type="text" placeholder="Support Portal"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('replyToAddress')} ${FieldHelp(Lang.t('replyToAddressHelp'))}</label><input id="sys-email-replyto" type="email" placeholder="reply@example.com"></div>
                                <div class="field"><label>${Lang.t('bccArchiveAddress')} ${FieldHelp(Lang.t('bccArchiveAddressHelp'))}</label><input id="sys-email-bcc" type="email" placeholder="archiv@example.com"></div>
                            </div>
                            <div class="settings-section-title">${Icon('mail-check', 15)}${Lang.t('templateAndSignature')}</div>
                            <div class="field field-wide"><label>${Lang.t('emailTemplate')} ${FieldHelp(Lang.t('emailTemplateHelp'))}</label><div class="email-template-variables">${['subject', 'message', 'recipient', 'recipientName', 'username', 'company', 'portalName', 'portalUrl', 'supportEmail', 'date', 'time', 'year'].map(key => `<button type="button" class="btn-secondary btn-sm email-variable" data-variable="${key}"><code>{{${key}}}</code></button>`).join('')}</div><p class="hint">${Lang.current === 'en' ? 'Click to insert. Name and username are available for account notifications; other messages use the email address as name.' : 'Zum Einfügen anklicken. Name und Benutzername sind bei Kontobenachrichtigungen verfügbar; sonst wird die E-Mail-Adresse als Name verwendet.'}</p><textarea id="sys-email-template" rows="4" placeholder="{{subject}}\n\n{{message}}"></textarea></div>
                            <div class="field field-wide"><label>${Lang.t('signatureText')} ${FieldHelp(Lang.t('signatureTextHelp'))}</label><textarea id="sys-email-text-signature" rows="4" placeholder="Mit freundlichen Grüßen&#10;IT Service Desk"></textarea></div>
                            <div class="field">
                                <label class="check-row">
                                    <input type="checkbox" id="sys-email-html-enabled">
                                    <span class="check-text"><strong>${Lang.t('enableHtmlEmails')}</strong><span>${Lang.t('enableHtmlEmailsHint')}</span></span>
                                </label>
                            </div>
                            <div class="field field-wide"><label>${Lang.t('signatureHtml')} ${FieldHelp(Lang.t('signatureHtmlHelp'))}</label><textarea id="sys-email-signature" rows="5" placeholder="<p>Mit freundlichen Grüßen</p><strong>IT Service Desk</strong>"></textarea></div>
                            <div class="settings-section-title">${Icon('shield-check', 15)}${Lang.t('securityAndCertificates')}</div>
                            <div class="callout">${Lang.t('emailSecurityCallout')}</div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('transportSecurity')} ${FieldHelp(Lang.t('transportSecurityHelp'))}</label><select id="sys-email-transport"><option value="starttls">${Lang.t('forceStarttls')}</option><option value="tls">${Lang.t('forceTls')}</option></select></div>
                                <div class="field"><label>${Lang.t('certificateCheck')} ${FieldHelp(Lang.t('certificateCheckHelp'))}</label><select id="sys-email-cert-mode" disabled><option value="strict">${Lang.t('checkStrict')}</option></select></div>
                            </div>
                            <div class="field field-wide"><label>${Lang.t('smimeCert')} ${FieldHelp(Lang.t('smimeCertHelp'))}</label><textarea id="sys-email-smime-cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
                            <div class="field field-wide"><label>${Lang.t('smimeKey')} ${FieldHelp(Lang.t('smimeKeyHelp'))}</label><textarea id="sys-email-smime-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('keyPassphrase')} ${FieldHelp(Lang.t('keyPassphraseHelp'))}</label><input id="sys-email-smime-pass" type="password" placeholder="Optional"></div>
                                <div class="field"><label>${Lang.t('dkimSelector')} ${FieldHelp(Lang.t('dkimSelectorHelp'))}</label><input id="sys-email-dkim-selector" type="text" placeholder="default"></div>
                            </div>
                            <div class="field"><label>${Lang.t('dkimDomain')} ${FieldHelp(Lang.t('dkimDomainHelp'))}</label><input id="sys-email-dkim-domain" type="text" placeholder="example.com"></div>
                            <div class="field field-wide"><label>${Lang.t('dkimPrivateKey')} ${FieldHelp(Lang.t('dkimPrivateKeyHelp'))}</label><textarea id="sys-email-dkim-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
                            <div class="setting-row">
                                <span class="hint" id="sys-smtp-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-smtp-save-test" type="button">${Icon('send', 15)}${Lang.t('saveAndSendTestEmail')}</button>
                            </div>
                        </div>
                        <!-- Allgemein -->
                        <div id="sys-general" class="tab-content active">
                            <div class="field">
                                <label>${Lang.t('portalName')}</label>
                                <input id="sys-portal-name" type="text" placeholder="Support Portal">
                            </div>
                            <div class="field">
                                <label>${Lang.t('autoArchiveDays')}</label>
                                <input id="sys-auto-archive" type="number" placeholder="0" min="0">
                            </div>
                            <div class="field">
                                <label for="sys-upload-limit">${Lang.t('uploadLimitLabel')}</label>
                                <input id="sys-upload-limit" type="number" min="500" max="2000" step="1" placeholder="1024">
                                <div class="hint">${Lang.t('uploadLimitHint')}</div>
                            </div>
                            <div class="field">
                                <label for="sys-avatars">${Lang.t('avatarModeLabel')}</label>
                                <select id="sys-avatars">
                                    <option value="on">${Lang.t('avatarModeOn')}</option>
                                    <option value="off">${Lang.t('avatarModeOff')}</option>
                                </select>
                                <div class="hint">${Lang.t('avatarModeHint')}</div>
                            </div>
                            <label class="check-row"><input type="checkbox" id="sys-require-activity"><span>${Lang.t('requireTimerActivity')}</span></label>
                            <div class="field">
                                <label>${Lang.t('defaultPriorityForNewTickets')}</label>
                                <select id="sys-default-prio">
                                    <option value="Normal">${Lang.t('normal')}</option>
                                    <option value="Hoch">${Lang.t('high')}</option>
                                    <option value="Niedrig">${Lang.t('low')}</option>
                                </select>
                            </div>
                            <div class="settings-section-title">${Lang.t('waitingForUser')}</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-wait-remind">${Lang.t('reminderAfterDays')}</label><input id="sys-wait-remind" type="number" min="1" placeholder="2"></div>
                                <div class="field"><label for="sys-wait-close">${Lang.t('autoCloseAfterDays')}</label><input id="sys-wait-close" type="number" min="1" placeholder="7"></div>
                            </div>
                            <div class="settings-section-title">${Lang.t('resolutionDeadlinePerPriority')}</div>
                            <div class="hint">${Lang.t('resolutionTimeHint')}</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-sla-low">${Lang.t('low')}</label><div class="sla-field-row"><input id="sys-sla-low" type="number" min="0.25" step="0.25"><select id="sys-sla-low-unit" aria-label="${Lang.format('unitFor', { name: Lang.t('low') })}"><option value="hours">${Lang.t('hoursUnit')}</option><option value="days">${Lang.t('daysUnit')}</option></select></div></div>
                                <div class="field"><label for="sys-sla-normal">${Lang.t('normal')}</label><div class="sla-field-row"><input id="sys-sla-normal" type="number" min="0.25" step="0.25"><select id="sys-sla-normal-unit" aria-label="${Lang.format('unitFor', { name: Lang.t('normal') })}"><option value="hours">${Lang.t('hoursUnit')}</option><option value="days">${Lang.t('daysUnit')}</option></select></div></div>
                                <div class="field"><label for="sys-sla-high">${Lang.t('high')}</label><div class="sla-field-row"><input id="sys-sla-high" type="number" min="0.25" step="0.25"><select id="sys-sla-high-unit" aria-label="${Lang.format('unitFor', { name: Lang.t('high') })}"><option value="hours">${Lang.t('hoursUnit')}</option><option value="days">${Lang.t('daysUnit')}</option></select></div></div>
                                <div class="field"><label for="sys-sla-critical">${Lang.t('critical')}</label><div class="sla-field-row"><input id="sys-sla-critical" type="number" min="0.25" step="0.25"><select id="sys-sla-critical-unit" aria-label="${Lang.format('unitFor', { name: Lang.t('critical') })}"><option value="hours">${Lang.t('hoursUnit')}</option><option value="days">${Lang.t('daysUnit')}</option></select></div></div>
                            </div>
                            <label class="check-row sla-user-visibility-row">
                                <input type="checkbox" id="sys-sla-show-users">
                                <span class="check-text"><strong>${Lang.t('showDeadlineToUsers')}</strong><span>${Lang.t('showDeadlineToUsersHint')}</span></span>
                            </label>

                            <div class="settings-section-title">${Lang.t('businessHoursForDeadlines')}</div>
                            <label class="check-row">
                                <input type="checkbox" id="sys-bh-enabled">
                                <span class="check-text"><strong>${Lang.t('considerBusinessHours')}</strong><span>${Lang.t('businessHoursHint')}</span></span>
                            </label>
                            <div class="field field-wide">
                                <label>${Lang.t('businessHoursPerDay')}</label>
                                <div class="business-hours-grid" id="sys-bh-days">
                                    ${[1, 2, 3, 4, 5, 6, 0].map(i => ({ i, d: Lang.t(['daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday', 'dayThursday', 'dayFriday', 'daySaturday'][i]) })).map(({ i, d }) => `
                                        <div class="business-day-row" data-day="${i}">
                                            <label class="check-row compact"><input type="checkbox" class="bh-day-enabled" value="${i}"><span>${d}</span></label>
                                            <input class="bh-day-start" type="time" aria-label="${Lang.format('dayStart', { day: d })}">
                                            <span class="business-day-sep">${Lang.t('to')}</span>
                                            <input class="bh-day-end" type="time" aria-label="${Lang.format('dayEnd', { day: d })}">
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="field field-wide">
                                <label for="sys-bh-holidays">${Lang.t('holidaysOneDatePerLine')}</label>
                                <textarea id="sys-bh-holidays" rows="4" placeholder="01.01.2026&#10;25.12.2026"></textarea>
                            </div>
                        </div>

                        <!-- Module: optionale Funktionsbereiche, nur aktiv und sichtbar, wenn eingeschaltet -->
                        <div id="sys-modules" class="tab-content">
                            <p class="hint">${Lang.t('modulesHint')}</p>
                            <div class="module-search">${Icon('search', 16)}<input type="search" id="sys-module-search" class="section-search" placeholder="${Lang.t('moduleSearchPlaceholder')}" aria-label="${Lang.t('moduleSearchPlaceholder')}"></div>
                            <div class="module-list">
                                <label class="module-card"><input type="checkbox" id="sys-module-sla"><span class="module-icon">${Icon('timer', 20)}</span><span class="module-text"><strong>${Lang.t('moduleSla')}</strong><span>${Lang.t('moduleSlaHint')}</span></span><span class="module-switch" aria-hidden="true"></span></label>
                                <label class="module-card"><input type="checkbox" id="sys-module-approvals"><span class="module-icon">${Icon('badge-check', 20)}</span><span class="module-text"><strong>${Lang.t('moduleApprovals')}</strong><span>${Lang.t('moduleApprovalsHint')}</span></span><span class="module-switch" aria-hidden="true"></span></label>
                                <label class="module-card"><input type="checkbox" id="sys-module-outlook"><span class="module-icon">${Icon('calendar-days', 20)}</span><span class="module-text"><strong>${Lang.t('moduleOutlook')}</strong><span>${Lang.t('moduleOutlookHint')}</span></span><span class="module-switch" aria-hidden="true"></span></label>
                                <div class="module-card is-upcoming" aria-disabled="true"><span class="module-icon">${Icon('monitor-smartphone', 20)}</span><span class="module-text"><strong>${Lang.t('moduleDevices')}</strong><span>${Lang.t('moduleDevicesHint')}</span></span><span class="badge">${Lang.t('comingSoon')}</span></div>
                            </div>
                            <div class="empty-state compact" id="sys-module-empty" hidden>${Lang.t('noModulesFound')}</div>
                        </div>

                        <!-- Modul-Kacheln: Inhalte werden nach dem Aufbau aus Allgemein/Unternehmen hierher verschoben -->
                        <div id="sys-sla" class="tab-content"></div>
                        <div id="sys-approvals" class="tab-content"></div>
                        <div class="empty-state" id="sys-search-empty" hidden>${Lang.t('settingsSearchNoResults')}</div>

                        <!-- Unternehmenseinstellungen -->
                        <div id="sys-company" class="tab-content">
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('companyName')}</label><input id="sys-company-name" type="text" placeholder="Muster GmbH"></div>
                                <div class="field"><label>${Lang.t('supportDepartment')}</label><input id="sys-company-dept" type="text" placeholder="IT Service Desk"></div>
                            </div>
                            <div class="settings-section-title">${Lang.t('brandingAndContactData')}</div>
                            <div class="field">
                                <label>${Lang.t('companyLogoUrl')}</label>
                                <div class="form-grid company-logo-grid">
                                    <input id="sys-company-logo" type="text" placeholder="https://example.com/logo.png oder hochladen">
                                    <label class="btn btn-secondary btn-sm nowrap">${Icon('upload', 15)}${Lang.t('upload')}<input type="file" id="sys-company-logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden></label>
                                </div>
                                <div class="hint" id="sys-company-logo-hint"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('supportEmail')}</label><input id="sys-company-support" type="email" placeholder="support@example.com"></div>
                                <div class="field"><label>${Lang.t('phone')}</label><input id="sys-company-phone" type="text" placeholder="+49 ..."></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-company-timezone">${Lang.t('defaultTimezone')}</label><select id="sys-company-timezone"></select></div>
                                <div class="field"><label>${Lang.t('locationRegion')}</label><input id="sys-company-location" type="text" placeholder="Deutschland"></div>
                            </div>
                            <div class="field field-wide"><label>${Lang.t('address')}</label><textarea id="sys-company-address" rows="3" placeholder="Straße, PLZ Ort"></textarea></div>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('imprintUrl')}</label><input id="sys-company-imprint" type="url" placeholder="https://example.com/impressum"></div>
                                <div class="field"><label>${Lang.t('privacyUrl')}</label><input id="sys-company-privacy" type="url" placeholder="https://example.com/datenschutz"></div>
                            </div>
                            <div class="hint">${Lang.t('emailSignatureManagedElsewhere')}</div>
                            <div class="settings-section-title">${Lang.t('ticketNumbersForNewTickets')}</div>
                            <div class="callout">${Lang.format('ticketNumberFormatCallout', {})}</div>
                            <div class="ticket-token-bar" role="group" aria-label="${Lang.t('ticketTokensLabel')}">
                                <span class="ticket-token-label">${Lang.t('ticketTokensLabel')}</span>
                                ${TICKET_NUMBER_TOKENS.map(token => `<button type="button" class="ticket-token${token === '{number}' ? ' is-required' : ''}" data-token="${token}" title="${Utils.esc(Lang.t(`ticketTokenHint_${token.slice(1, -1)}`))}"><span>${Utils.esc(Lang.t(`ticketToken_${token.slice(1, -1)}`))}</span><code>${token}</code></button>`).join('')}
                                <span class="ticket-token-divider" aria-hidden="true"></span>
                                ${['-', '/', '_', '.'].map(sep => `<button type="button" class="ticket-token is-separator" data-token="${sep}" title="${Utils.esc(Lang.t('ticketTokenSeparator'))}"><code>${sep}</code></button>`).join('')}
                            </div>
                            <p class="hint">${Lang.t('ticketTokenUsageHint')}</p>
                            <div class="form-grid">
                                <div class="field"><label for="sys-ticket-number-format">${Lang.t('defaultFormat')}</label><input id="sys-ticket-number-format" type="text" maxlength="64" data-ticket-format placeholder="{prefix}-{number}"><div class="ticket-number-preview" data-preview-for="sys-ticket-number-format"></div></div>
                                <div class="field"><label>${Lang.t('prefixLabel')}</label><input id="sys-ticket-number-prefix" type="text" maxlength="16" placeholder="TS"></div>
                                <div class="field"><label>${Lang.t('sequenceDigits')}</label><input id="sys-ticket-number-padding" type="number" min="1" max="12" placeholder="5"></div>
                            </div>
                            <div class="field field-wide">
                                <label>${Lang.t('categoryFormats')}</label>
                                <p class="hint">${Lang.t('categoryFormatsHint')}</p>
                                <div id="sys-ticket-category-formats" class="ticket-number-category-formats"></div>
                            </div>
                            <div class="settings-section-title">${Lang.t('supervisorApprovals')}</div>
                            <div class="hint">${Lang.t('supervisorApprovalsHint')}</div>
                            <label class="check-row"><input type="checkbox" id="sys-appr-enabled"><span><strong>${Lang.t('enableApprovalWorkflow')}</strong></span></label>
                            <div class="perm-grid">
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Niedrig"><span>${Lang.t('low')}</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Normal"><span>${Lang.t('normal')}</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Hoch"><span>${Lang.t('high')}</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Kritisch"><span>${Lang.t('critical')}</span></label>
                            </div>
                            <div class="field">
                                <label>${Lang.t('fallbackApproverNoSupervisor')}</label>
                                <p class="hint">${Lang.t('fallbackApproverHint')}</p>
                                <div id="sys-appr-fallback"></div>
                            </div>
                            <div class="field field-wide">
                                <label>${Lang.t('fallbackRulesLabel')}</label>
                                <p class="hint">${Lang.t('fallbackRulesHint')}</p>
                                <div id="sys-appr-rules" class="appr-rule-list"></div>
                                <button type="button" class="btn-secondary btn-sm" id="sys-appr-rule-add">${Icon('plus', 15)}${Lang.t('fallbackRuleAdd')}</button>
                            </div>
                        </div>
                    </div>
                    </div>
                    <div class="modal-footer action-footer">
                        <button class="btn-secondary close-m footer-cancel">${Lang.t('closeSystemSettings')}</button>
                        <button class="btn-primary" id="sys-save">${Icon('save', 16)}${Lang.t('saveSettings')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#sys-save-head').onclick = () => q('#sys-save')?.click();
            modal.querySelector('#sys-update').addEventListener('click', AdminBoard.handleCopyClick);
            modal.querySelector('#sys-backup-create').onclick = () => AdminBoard.openBackupCreate();
            modal.querySelector('#sys-backup-restore').onclick = () => AdminBoard.openBackupRestore();
            const company = modal.querySelector('#sys-company');
            const headings = [...company.querySelectorAll('.settings-section-title')];
            const numbering = headings.find(heading => heading.textContent === Lang.t('ticketNumbersForNewTickets'));
            const approval = headings.find(heading => heading.textContent === Lang.t('supervisorApprovals'));
            const moveFrom = (start, target) => {
                const nodes = []; for (let node = start; node; node = node.nextSibling) nodes.push(node);
                nodes.forEach(node => target.appendChild(node));
            };
            if (approval) moveFrom(approval, modal.querySelector('#sys-approvals'));
            const slaHeading = [...modal.querySelectorAll('#sys-general .settings-section-title')].find(heading => heading.textContent === Lang.t('resolutionDeadlinePerPriority'));
            if (slaHeading) moveFrom(slaHeading, modal.querySelector('#sys-sla'));
            if (numbering) numbering.dataset.permission = 'settingsTicketNumbers';
            const updatePanel = modal.querySelector('#sys-update');
            const preferences = await Store.getPersonalPreferences(true);
            modal.querySelectorAll('.tab-content').forEach(panel => {
                if (!panel.firstElementChild?.classList.contains('settings-section-title')) {
                    const heading = document.createElement('div'); heading.className = 'settings-section-title';
                    heading.textContent = modal.querySelector(`[data-tab="${panel.id}"]`)?.textContent.trim() || panel.id;
                    panel.prepend(heading);
                }
                [...panel.querySelectorAll('.settings-section-title')].forEach((heading, index) => {
                    const key = `${panel.id}:${index}`;
                    const details = document.createElement('details');
                    details.className = 'settings-section';
                    details.dataset.preferenceKey = key;
                    if (heading.dataset.permission) details.dataset.permission = heading.dataset.permission;
                    else if (panel.id === 'sys-company') details.dataset.permission = 'settingsCompany';
                    details.open = !preferences.collapsedSections?.[key];
                    const summary = document.createElement('summary');
                    while (heading.firstChild) summary.appendChild(heading.firstChild);
                    const nodes = [];
                    for (let node = heading.nextSibling; node && !(node.nodeType === 1 && node.classList.contains('settings-section-title')); node = node.nextSibling) nodes.push(node);
                    heading.replaceWith(details); details.appendChild(summary);
                    nodes.forEach(node => details.appendChild(node));
                    details._preferenceOpen = details.open;
                    details.addEventListener('toggle', () => {
                        if (details.open === details._preferenceOpen) return;
                        details._preferenceOpen = details.open;
                        Store.patchPersonalPreferences({ collapsedSections: { [key]: !details.open } })
                            .catch(error => UI.toast(error.message));
                    });
                });
            });

            // Einstellungssuche: zeigt alle passenden Abschnitte aller Bereiche untereinander; aufgeklappt
            // wird nur fuer die Suche (der gespeicherte Auf-/Zuklapp-Zustand bleibt unveraendert).
            const searchInput = modal.querySelector('#sys-settings-search');
            const content = modal.querySelector('.sys-settings-content');
            const panels = [...content.querySelectorAll(':scope > .tab-content')];
            panels.forEach(panel => { panel.dataset.searchTitle = modal.querySelector(`.sys-settings-nav [data-tab="${panel.id}"]`)?.textContent.trim() || ''; });
            const runSettingsSearch = () => {
                const term = searchInput.value.trim().toLocaleLowerCase();
                content.classList.toggle('is-searching', !!term);
                let total = 0;
                panels.forEach(panel => {
                    const nav = modal.querySelector(`.sys-settings-nav [data-tab="${panel.id}"]`);
                    const moduleOff = (nav?.dataset.module && Store.modules[nav.dataset.module] === false) || panel.dataset.locked === '1';
                    let hits = 0;
                    panel.querySelectorAll('details.settings-section').forEach(section => {
                        if (term && !('searchOpen' in section.dataset)) section.dataset.searchOpen = section.open ? '1' : '0';
                        const match = !!term && !moduleOff && !section.dataset.locked && `${panel.dataset.searchTitle} ${section.textContent}`.toLocaleLowerCase().includes(term);
                        section.classList.toggle('search-miss', !!term && !match);
                        if (match) { hits++; section._preferenceOpen = true; section.open = true; }
                        if (!term && 'searchOpen' in section.dataset) {
                            const wasOpen = section.dataset.searchOpen === '1';
                            delete section.dataset.searchOpen;
                            section._preferenceOpen = wasOpen; section.open = wasOpen;
                        }
                    });
                    panel.classList.toggle('search-hit', hits > 0);
                    nav?.classList.toggle('has-search-hits', hits > 0);
                    total += hits;
                });
                modal.querySelector('#sys-search-empty').hidden = !term || total > 0;
            };
            searchInput.addEventListener('input', runSettingsSearch);
            searchInput.addEventListener('keydown', event => { if (event.key === 'Escape' && searchInput.value) { event.stopPropagation(); searchInput.value = ''; runSettingsSearch(); } });

            // Tab Logic
            modal.querySelectorAll('.tab-btn').forEach(btn => {
                btn.onclick = () => {
                    if (searchInput.value) { searchInput.value = ''; runSettingsSearch(); }
                    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    q('#' + btn.dataset.tab).classList.add('active');
                    if (btn.dataset.tab === 'sys-update') { AdminBoard.renderSystemInfo(); AdminBoard.renderUpdateStatus(); }
                    else clearTimeout(AdminBoard.updatePollTimer);
                    if (btn.dataset.tab === 'sys-categories') AdminBoard.renderCategorySettings();
                    if (window.lucide) lucide.createIcons();
                };
            });

            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => {
                modal.classList.remove('open');
                clearTimeout(AdminBoard.updatePollTimer);
            });
            q('#sys-update-check').onclick = () => AdminBoard.renderUpdateStatus();
            q('#sys-goto-categories').onclick = () => modal.querySelector('.sys-settings-nav [data-tab="sys-categories"]')?.click();
            q('#sys-cat-search').oninput = () => AdminBoard.renderCategorySettings();
            q('#sys-cat-add').onclick = () => AdminBoard.openEditCategoryModal(null);
            q('#sys-cat-groups').hidden = !isSuper;
            q('#sys-cat-groups').onclick = () => AdminBoard.openUserManager('groups');
            // Nur freigegebene Reiter und Abschnitte zeigen (Server prueft zusaetzlich jeden Schluessel).
            modal.querySelectorAll('.sys-settings-nav .tab-btn').forEach(btn => { btn.hidden = !allowedTabs.includes(btn.dataset.tab); });
            modal.querySelectorAll('.sys-settings-content > .tab-content').forEach(panel => { if (!allowedTabs.includes(panel.id)) panel.dataset.locked = '1'; });
            modal.querySelectorAll('details[data-permission]').forEach(section => { if (!can(section.dataset.permission)) { section.hidden = true; section.dataset.locked = '1'; } });
            modal.querySelectorAll('.sys-nav-group-label').forEach(label => {
                const buttons = []; for (let node = label.nextElementSibling; node && !node.classList.contains('sys-nav-group-label'); node = node.nextElementSibling) buttons.push(node);
                label.hidden = !buttons.some(btn => !btn.hidden);
            });
            q('#sys-update-run').onclick = async () => {
                // Commit-Pinning: der Ziel-Commit ist IMMER der zuletzt angezeigte Stand (bei
                // "neues Update verfügbar" der entfernte, bei "letztes Update erneut
                // installieren" der bereits lokale) -- die Person bestätigt damit genau das, was
                // sie zuletzt auf dem Bildschirm gesehen hat, siehe update.ts Commit-Pinning.
                const status = AdminBoard._lastUpdateStatus || {};
                const targetCommit = status.updateAvailable ? status.remoteCommit : null;
                if (!targetCommit) { UI.toast(Lang.t('noTargetCommitKnown')); return; }
                const stepUp = await AdminBoard.confirmStepUp(Lang.t('updateConfirmMessage'), targetCommit.slice(0, 12));
                if (!stepUp) return;
                q('#sys-update-run').disabled = true;
                const result = await Store.runUpdate(targetCommit, stepUp.password, stepUp.totpCode);
                if (!result || ![200, 202].includes(result.httpStatus)) {
                    const msg = result?.error === 'wrong_password' ? Lang.t('wrongPassword')
                        : result?.error === 'invalid_totp_code' ? Lang.t('invalidMfaCode')
                        : result?.error === 'commit_mismatch' ? Lang.t('commitMismatchError')
                        : Lang.t('updateDisabledOrUnreachable');
                    UI.toast(msg);
                    await AdminBoard.renderUpdateStatus();
                    return;
                }
                UI.toast(Lang.t('updateStartedToast'));
                await AdminBoard.renderUpdateStatus();
            };
        }

        const settings = await Store.getSettings();
        const general = settings.generalConfig || {};
        const company = settings.companyConfig || {};
        const security = settings.securityConfig || {};
        const notif = settings.notifConfig || {};
        const emailAdvanced = settings.emailAdvancedConfig || {};
        const outlook = settings.outlookConfig || {};
        const companyBranding = settings.companyBrandingConfig || {};

        q('#sys-portal-name').value = general.portalName || 'Support Portal';
        q('#sys-auto-archive').value = general.autoArchiveDays || 0;
        q('#sys-upload-limit').value = settings.uploadConfig?.maxFileMb || 1024;
        q('#sys-avatars').value = settings.avatarConfig?.enabled === false ? 'off' : 'on';
        q('#sys-default-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(general.defaultPrio) ? general.defaultPrio : 'Normal';
        q('#sys-require-activity').checked = settings.timeTrackingConfig?.requireActivity !== false;
        q('#sys-wait-remind').value = general.waitingReminderDays ?? 2;
        q('#sys-wait-close').value = general.waitingAutoCloseDays ?? 7;
        if (!q('#sys-wait-action')) {
            const settingsFields = q('#sys-wait-close').closest('.form-grid') || q('#sys-wait-close').parentElement.parentElement;
            const info = document.createElement('p'); info.className = 'hint waiting-policy-info';
            info.textContent = Lang.current === 'en' ? 'Both periods start when a ticket begins waiting for the user. If enabled, one reminder is sent after the first period. Choose what happens after the second period. A reply ends the waiting period.' : 'Beide Fristen beginnen, sobald das Ticket auf eine Benutzerantwort wartet. Ist die Erinnerung aktiviert, wird nach der ersten Frist einmal erinnert. Für die zweite Frist wählst du die Aktion. Eine Antwort beendet die Wartephase.';
            settingsFields.before(info);
            const controls = document.createElement('div'); controls.className = 'field waiting-policy-controls';
            controls.innerHTML = `<label class="check-row"><input type="checkbox" id="sys-wait-reminder-enabled"><span>${Lang.current === 'en' ? 'Send reminder' : 'Erinnerung versenden'}</span></label><label for="sys-wait-action">${Lang.current === 'en' ? 'Action after the second period' : 'Aktion nach der zweiten Frist'}</label><select id="sys-wait-action"><option value="close">${Lang.current === 'en' ? 'Close automatically and notify user' : 'Automatisch schließen und Benutzer benachrichtigen'}</option><option value="keep_open">${Lang.current === 'en' ? 'Keep waiting; do not close automatically' : 'Weiter warten, nicht automatisch schließen'}</option></select>`;
            settingsFields.after(controls);
        }
        q('#sys-wait-reminder-enabled').checked = general.waitingReminderEnabled !== false;
        q('#sys-wait-action').value = general.waitingAfterAction || 'close';
        const updateWaitingControls = () => { q('#sys-wait-close').disabled = q('#sys-wait-action').value === 'keep_open'; q('#sys-wait-remind').disabled = !q('#sys-wait-reminder-enabled').checked; };
        q('#sys-wait-action').onchange = updateWaitingControls; q('#sys-wait-reminder-enabled').onchange = updateWaitingControls; updateWaitingControls();
        const slaHours = general.slaHours || {};
        AdminBoard.setSlaField('low', slaHours.low ?? 72);
        AdminBoard.setSlaField('normal', slaHours.normal ?? 48);
        AdminBoard.setSlaField('high', slaHours.high ?? 24);
        AdminBoard.setSlaField('critical', slaHours.critical ?? 4);
        q('#sys-sla-show-users').checked = !!general.showSlaToUsers;

        const businessHours = general.businessHours || {};
        q('#sys-bh-enabled').checked = !!businessHours.enabled;
        const bhDays = businessHours.days && businessHours.days.length ? businessHours.days : [1, 2, 3, 4, 5];
        qa('#sys-bh-days .business-day-row').forEach(row => {
            const day = Number(row.dataset.day);
            const cfg = businessHours.perDay?.[day] || businessHours.perDay?.[String(day)] || {
                enabled: bhDays.includes(day),
                start: businessHours.start || '08:00',
                end: businessHours.end || '17:00'
            };
            row.querySelector('.bh-day-enabled').checked = !!cfg.enabled;
            row.querySelector('.bh-day-start').value = cfg.start || '08:00';
            row.querySelector('.bh-day-end').value = cfg.end || '17:00';
        });
        q('#sys-bh-holidays').value = (businessHours.holidays || []).map(d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d).join('\n');

        q('#sys-company-name').value = company.name || '';
        q('#sys-company-dept').value = companyBranding.department || '';
        q('#sys-company-logo').value = companyBranding.logoDataUrl || '';
        q('#sys-company-logo-hint').textContent = (companyBranding.logoDataUrl || '').startsWith('data:') ? 'Hochgeladenes Bild gespeichert.' : '';
        q('#sys-company-logo-file').value = '';
        q('#sys-company-logo-file').onchange = async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            // logoDataUrl ist serverseitig auf 1 MB Zeichenlänge begrenzt (settings.ts) -- Base64
            // vergrößert die Rohdatei um ca. 1/3, deshalb hier konservativ bei 650 KB abschneiden
            // statt die kryptische Fehlermeldung des Servers abzuwarten.
            if (file.size > 650 * 1024) {
                UI.toast(Lang.t('imageTooLarge'));
                return;
            }
            const dataUrl = await Store.readFile(file);
            q('#sys-company-logo').value = dataUrl;
            q('#sys-company-logo-hint').textContent = Lang.format('uploadedFileSize', { name: file.name, size: Math.round(file.size / 1024) });
        };
        q('#sys-company-support').value = companyBranding.supportEmail || '';
        q('#sys-company-phone').value = companyBranding.phone || '';
        const timezoneSelect = q('#sys-company-timezone');
        const zones = new Set(['UTC', 'Europe/Berlin', companyBranding.timezone || 'Europe/Berlin', ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'])]);
        timezoneSelect.replaceChildren(...[...zones].sort().map(zone => { const option = document.createElement('option'); option.value = zone; option.textContent = zone.replaceAll('_', ' '); return option; }));
        timezoneSelect.value = companyBranding.timezone || 'Europe/Berlin';
        q('#sys-company-location').value = companyBranding.location || '';
        q('#sys-company-address').value = companyBranding.address || '';
        q('#sys-company-imprint').value = companyBranding.imprintUrl || '';
        q('#sys-company-privacy').value = companyBranding.privacyUrl || '';
        q('#sys-ticket-number-format').value = company.ticketNumberFormat || '{prefix}-{number}';
        q('#sys-ticket-number-prefix').value = company.ticketNumberPrefix || '';
        q('#sys-ticket-number-padding').value = company.ticketNumberPadding || 5;
        {
            const categoryFormatList = q('#sys-ticket-category-formats');
            const categoryFormatValues = { ...(company.ticketNumberCategoryFormats || {}) };
            const categoryCodeValues = { ...(company.ticketNumberCategoryCodes || {}) };
            const categories = (await Store.getCategories()).filter(c => !c.archived);
            categoryFormatList.innerHTML = categories.length ? `
                <div class="ticket-number-category-row is-head" aria-hidden="true"><span>${Lang.t('ticketCategoryColumn')}</span><span>${Lang.t('ticketCategoryCode')}</span><span>${Lang.t('ticketCategoryFormat')}</span></div>
                ${categories.map((c, index) => `
                <div class="ticket-number-category-row">
                    <label for="sys-ticket-cat-format-${index}">${Utils.esc(c.name)}</label>
                    <input type="text" maxlength="12" data-ticket-code="${Utils.esc(c.name)}" placeholder="${Utils.esc(ticketCategoryCode(c.name))}" value="${Utils.esc(categoryCodeValues[c.name] || '')}" aria-label="${Utils.esc(Lang.format('ticketCategoryCodeFor', { name: c.name }))}">
                    <div class="ticket-number-category-format">
                        <input type="text" maxlength="64" id="sys-ticket-cat-format-${index}" data-ticket-format data-ticket-category="${Utils.esc(c.name)}" placeholder="${Utils.esc(Lang.t('ticketUseDefaultFormat'))}" value="${Utils.esc(categoryFormatValues[c.name] || '')}">
                        <div class="ticket-number-preview" data-preview-for="sys-ticket-cat-format-${index}"></div>
                    </div>
                </div>`).join('')}` : `<div class="empty-state compact">${Lang.t('noCategoriesCreated')}</div>`;
            // Bausteine fuegen an der Cursorposition des zuletzt gewaehlten Formatfelds ein.
            let tokenTarget = q('#sys-ticket-number-format');
            modal.querySelectorAll('[data-ticket-format]').forEach(input => input.addEventListener('focus', () => { tokenTarget = input; }));
            modal.querySelectorAll('.ticket-token').forEach(button => {
                button.onmousedown = event => event.preventDefault();
                button.onclick = () => {
                    AdminBoard.insertTextAtCursor(tokenTarget, button.dataset.token);
                    AdminBoard.renderTicketNumberPreviews(modal);
                };
            });
            // Ab 5 Kategorien: Suche ueber der Liste der Kategorieformate.
            q('#sys-ticket-cat-search-box')?.remove();
            if (categories.length >= 5) {
                const searchBox = document.createElement('div');
                searchBox.id = 'sys-ticket-cat-search-box';
                searchBox.className = 'module-search ticket-cat-search';
                searchBox.innerHTML = `${Icon('search', 16)}<input type="search" class="section-search" placeholder="${Utils.esc(Lang.t('categorySearchPlaceholder'))}" aria-label="${Utils.esc(Lang.t('categorySearchPlaceholder'))}">`;
                categoryFormatList.before(searchBox);
                const empty = document.createElement('div');
                empty.className = 'empty-state compact'; empty.hidden = true; empty.textContent = Lang.t('noCategoriesFound');
                categoryFormatList.appendChild(empty);
                searchBox.querySelector('input').oninput = event => {
                    const term = event.target.value.trim().toLocaleLowerCase();
                    let hits = 0;
                    categoryFormatList.querySelectorAll('.ticket-number-category-row:not(.is-head)').forEach(row => {
                        const match = !term || row.querySelector('label').textContent.toLocaleLowerCase().includes(term);
                        row.hidden = !match;
                        if (match) hits++;
                    });
                    empty.hidden = hits > 0;
                };
            }
            ['#sys-ticket-number-format', '#sys-ticket-number-prefix', '#sys-ticket-number-padding', '#sys-company-timezone'].forEach(selector => q(selector)?.addEventListener('input', () => AdminBoard.renderTicketNumberPreviews(modal)));
            q('#sys-company-timezone')?.addEventListener('change', () => AdminBoard.renderTicketNumberPreviews(modal));
            categoryFormatList.addEventListener('input', () => AdminBoard.renderTicketNumberPreviews(modal));
            AdminBoard.renderTicketNumberPreviews(modal);
        }

        q('#sys-mfa-mode').value = security.mfaMode || (security.force2FA && security.force2FA !== 'none' ? 'totp' : 'disabled');
        q('#sys-mfa-roles').value = security.mfaRoles || (security.force2FA !== 'none' ? security.force2FA : 'all') || 'all';
        q('#sys-passkey-days').value = security.passkeyEveryDays ?? 14;
        Object.entries({ minLength: 14, minLowercase: 0, minUppercase: 0, minDigits: 0, minSpecial: 0 }).forEach(([key, fallback]) => { q(`#sys-pw-${key}`).value = security.passwordPolicy?.[key] ?? fallback; });
        q('#sys-session-timeout').value = security.sessionTimeout ?? 480;
        q('#sys-idle-timeout').value = security.idleTimeoutMinutes ?? 60;
        q('#sys-max-login-attempts').value = security.maxLoginAttempts ?? 5;
        // Security-Audit R-11: 'lock' (frueher "dauerhaft") verhaelt sich serverseitig jetzt wie
        // 'temp' -- eine automatische Sperre ist nie mehr dauerhaft. Bestehende gespeicherte 'lock'-
        // Konfigurationen werden beim Laden deshalb als 'temp' angezeigt.
        q('#sys-lockout-action').value = security.lockoutAction === 'none' ? 'none' : 'temp';
        q('#sys-lockout-minutes').value = security.lockoutMinutes || 15;

        q('#notif-account-approved').checked = !!notif.accountApproved;
        AdminBoard.renderNotifMatrix(q('#sys-notif-matrix'), await Store.getNotifPolicy());

        q('#sys-email-replyto').value = emailAdvanced.replyTo || '';
        q('#sys-email-bcc').value = emailAdvanced.bccArchive || '';
        q('#sys-email-template').value = emailAdvanced.template || '';
        modal.querySelectorAll('.email-variable').forEach(button => button.onclick = () => AdminBoard.insertTextAtCursor(q('#sys-email-template'), `{{${button.dataset.variable}}}`));
        q('#sys-email-text-signature').value = emailAdvanced.signature || '';
        q('#sys-email-html-enabled').checked = !!emailAdvanced.htmlEnabled;
        q('#sys-email-signature').value = emailAdvanced.htmlSignature || '';
        q('#sys-email-transport').value = emailAdvanced.transportSecurity === 'tls' ? 'tls' : 'starttls';
        q('#sys-email-cert-mode').value = 'strict';
        q('#sys-email-smime-cert').value = emailAdvanced.smimeCertificatePem || '';
        q('#sys-email-smime-key').value = emailAdvanced.smimePrivateKeyPem || '';
        q('#sys-email-smime-pass').value = emailAdvanced.smimePassphrase || '';
        q('#sys-email-dkim-selector').value = emailAdvanced.dkimSelector || '';
        q('#sys-email-dkim-domain').value = emailAdvanced.dkimDomain || '';
        q('#sys-email-dkim-key').value = emailAdvanced.dkimPrivateKeyPem || '';

        q('#sys-outlook-enabled').checked = !!outlook.enabled;
        q('#sys-outlook-tenant').value = outlook.tenantId || '';
        q('#sys-outlook-client').value = outlook.clientId || '';
        q('#sys-outlook-mailbox').value = outlook.mailbox || '';
        q('#sys-outlook-domains').value = (outlook.externalDomains || []).join('\n');
        q('#sys-outlook-sync').checked = !!outlook.syncIncoming;
        q('#sys-outlook-create').checked = !!outlook.createTicketsFromMail;
        const outlookServer = isSuper ? await Store.getOutlookConfig() : null;
        q('#sys-outlook-secret').value = '';
        q('#sys-outlook-secret').placeholder = outlookServer?.hasClientSecret ? Lang.t('leaveEmptyUnchanged') : Lang.t('enterClientSecret');
        q('#sys-outlook-status').textContent = outlookServer?.enabled && outlookServer?.hasClientSecret
            ? Lang.t('outlookConfigured') : Lang.t('outlookNotFullyConfigured');
        q('#sys-outlook-save').onclick = async () => {
            const secret = q('#sys-outlook-secret').value;
            const configOk = await Store.updateServerSettings({
                config: {
                    outlookConfig: {
                        enabled: q('#sys-outlook-enabled').checked,
                        tenantId: q('#sys-outlook-tenant').value.trim(),
                        clientId: q('#sys-outlook-client').value.trim(),
                        mailbox: q('#sys-outlook-mailbox').value.trim(),
                        externalDomains: AdminBoard.outlookDomainList()
                    }
                }
            });
            const secretOk = secret ? await Store.updateOutlookSecret(secret) : true;
            if (configOk && secretOk) {
                UI.toast(Lang.t('outlookSettingsSaved'));
                q('#sys-outlook-secret').value = '';
                const refreshed = await Store.getOutlookConfig();
                q('#sys-outlook-secret').placeholder = refreshed?.hasClientSecret ? Lang.t('leaveEmptyUnchanged') : Lang.t('enterClientSecret');
                q('#sys-outlook-status').textContent = refreshed?.enabled && refreshed?.hasClientSecret
                    ? Lang.t('outlookConfigured') : Lang.t('outlookNotFullyConfigured');
            } else {
                UI.toast(Lang.t('saveFailed'));
            }
        };

        const accEditable = settings.accountConfig?.editable || {};
        qa('#sys-profiles [data-self-field]').forEach(box => { box.checked = !!accEditable[box.dataset.selfField]; });

        // Ticketformular
        const prioMode = general.priorityMode === 'priority' ? 'priority' : 'impact';
        qa('input[name="sys-prio-mode"]').forEach(radio => { radio.checked = radio.value === prioMode; });
        q('#sys-show-service-bar').checked = general.showServiceBar !== false;

        // Sichtbarkeit von Kontaktdaten: Standard, je Gruppe, je Admin-Konto (genaueste Regel gilt).
        {
            const visibility = settings.contactVisibility || {};
            const defaults = Array.isArray(visibility.defaults) ? visibility.defaults : AdminBoard.DEFAULT_CONTACT_FIELDS;
            qa('#sys-profiles [data-cv-default]').forEach(box => { box.checked = defaults.includes(box.dataset.cvDefault); });
            const [cvGroups, cvUsers] = isSuper ? await Promise.all([Store.getGroups(), Store.getUsers()]) : [[], []];
            const fieldOptions = AdminBoard.CONTACT_FIELDS.map(([value, label]) => ({ value, label: Lang.t(label) }));
            const targets = {
                groups: cvGroups.map(g => ({ value: g.id, label: g.label || g.name })),
                users: cvUsers.filter(u => u.role === 'admin' && !u.accountArchived).map(u => ({ value: u.id, label: `${u.name || u.username} (${u.username})` }))
            };
            const rules = {
                groups: Object.entries(visibility.groups || {}).map(([target, fields]) => ({ target, fields })),
                users: Object.entries(visibility.users || {}).map(([target, fields]) => ({ target, fields }))
            };
            const renderRules = kind => {
                const list = q(kind === 'groups' ? '#sys-cv-groups' : '#sys-cv-users');
                list.innerHTML = rules[kind].length ? rules[kind].map((rule, index) => `
                    <div class="cv-rule-row" data-index="${index}">
                        <select class="cv-rule-target" aria-label="${Utils.esc(Lang.t(kind === 'groups' ? 'fallbackRuleGroup' : 'contactVisibilityUser'))}">
                            <option value="">${Utils.esc(Lang.t('pleaseChoose'))}</option>
                            ${targets[kind].map(o => `<option value="${Utils.esc(o.value)}"${o.value === rule.target ? ' selected' : ''}>${Utils.esc(o.label)}</option>`).join('')}
                        </select>
                        <div class="cv-rule-fields"></div>
                        <button type="button" class="btn-ghost btn-icon btn-sm btn-danger cv-rule-remove" title="${Utils.esc(Lang.t('fallbackRuleRemove'))}" aria-label="${Utils.esc(Lang.t('fallbackRuleRemove'))}">${Icon('trash-2', 15)}</button>
                    </div>`).join('') : `<p class="hint">${Utils.esc(Lang.t('contactVisibilityNoRules'))}</p>`;
                list.querySelectorAll('.cv-rule-row').forEach(row => {
                    const rule = rules[kind][Number(row.dataset.index)];
                    row.querySelector('.cv-rule-target').onchange = event => { rule.target = event.target.value; };
                    UI.createMultiSelect(row.querySelector('.cv-rule-fields'), fieldOptions, rule.fields, value => { rule.fields = value; }, { emptyLabel: Lang.t('contactVisibilityNothing') });
                    row.querySelector('.cv-rule-remove').onclick = () => { rules[kind].splice(Number(row.dataset.index), 1); renderRules(kind); };
                });
                if (window.lucide) lucide.createIcons();
            };
            q('#sys-cv-group-add').onclick = () => { rules.groups.push({ target: '', fields: [...defaults] }); renderRules('groups'); };
            q('#sys-cv-user-add').onclick = () => { rules.users.push({ target: '', fields: [...defaults] }); renderRules('users'); };
            renderRules('groups');
            renderRules('users');
            modal._contactRules = rules;
        }

        q('#sys-module-sla').checked = settings.modules?.sla !== false;
        q('#sys-module-approvals').checked = settings.modules?.approvals !== false;
        q('#sys-module-outlook').checked = settings.modules?.outlook === true;
        q('#sys-module-search').oninput = () => {
            const term = q('#sys-module-search').value.trim().toLocaleLowerCase();
            let visible = 0;
            qa('#sys-modules .module-card').forEach(card => {
                const match = !term || card.textContent.toLocaleLowerCase().includes(term);
                card.hidden = !match;
                if (match) visible++;
            });
            q('#sys-module-empty').hidden = visible > 0;
        };
        const appr = settings.approvalConfig || {};
        q('#sys-appr-enabled').checked = !!appr.enabled;
        qa('.sys-appr-prio').forEach(cb => { cb.checked = (appr.priorities || []).includes(cb.value); });
        const apprFallbackUsers = (await Store.getUsers()).filter(u => !u.accountArchived);
        apprFallbackPicker = UI.createMultiSelect(
            q('#sys-appr-fallback'),
            apprFallbackUsers.map(u => ({ value: u.id, label: u.name || u.username })),
            appr.fallbackApproverUserId || '', null, { single: true, emptyLabel: Lang.t('noneAutoSuperadmin') }
        );
        {
            // Ersatzperson je Gruppe oder Kategorie: greift vor der allgemeinen Ersatzperson.
            const [ruleGroups, ruleCategories] = await Promise.all([Store.getGroups(), Store.getCategories()]);
            const targets = {
                group: ruleGroups.map(g => ({ value: g.id, label: g.label || g.name })),
                category: ruleCategories.filter(c => !c.archived).map(c => ({ value: c.name, label: c.name }))
            };
            const options = (list, selected, empty) => `<option value="">${Utils.esc(empty)}</option>` + list.map(o => `<option value="${Utils.esc(o.value)}"${o.value === selected ? ' selected' : ''}>${Utils.esc(o.label)}</option>`).join('');
            const rules = (appr.fallbackRules || []).map(rule => ({ ...rule }));
            const list = q('#sys-appr-rules');
            const renderRules = () => {
                list.innerHTML = rules.length ? rules.map((rule, index) => `
                    <div class="appr-rule-row" data-index="${index}">
                        <select class="appr-rule-type" aria-label="${Utils.esc(Lang.t('fallbackRuleType'))}">
                            <option value="group"${rule.type === 'group' ? ' selected' : ''}>${Utils.esc(Lang.t('fallbackRuleGroup'))}</option>
                            <option value="category"${rule.type === 'category' ? ' selected' : ''}>${Utils.esc(Lang.t('fallbackRuleCategory'))}</option>
                        </select>
                        <select class="appr-rule-target" aria-label="${Utils.esc(Lang.t('fallbackRuleTarget'))}">${options(targets[rule.type] || [], rule.target, Lang.t('pleaseChoose'))}</select>
                        <select class="appr-rule-user" aria-label="${Utils.esc(Lang.t('fallbackRuleUser'))}">${options(apprFallbackUsers.map(u => ({ value: u.id, label: u.name || u.username })), rule.userId, Lang.t('pleaseChoose'))}</select>
                        <button type="button" class="btn-ghost btn-icon btn-sm btn-danger appr-rule-remove" title="${Utils.esc(Lang.t('fallbackRuleRemove'))}" aria-label="${Utils.esc(Lang.t('fallbackRuleRemove'))}">${Icon('trash-2', 15)}</button>
                    </div>`).join('') : `<p class="hint">${Utils.esc(Lang.t('fallbackRulesEmpty'))}</p>`;
                list.querySelectorAll('.appr-rule-row').forEach(row => {
                    const rule = rules[Number(row.dataset.index)];
                    row.querySelector('.appr-rule-type').onchange = event => { rule.type = event.target.value; rule.target = ''; renderRules(); };
                    row.querySelector('.appr-rule-target').onchange = event => { rule.target = event.target.value; };
                    row.querySelector('.appr-rule-user').onchange = event => { rule.userId = event.target.value; };
                    row.querySelector('.appr-rule-remove').onclick = () => { rules.splice(Number(row.dataset.index), 1); renderRules(); };
                });
                if (window.lucide) lucide.createIcons();
            };
            q('#sys-appr-rule-add').onclick = () => { rules.push({ type: 'group', target: '', userId: '' }); renderRules(); };
            renderRules();
            modal._approvalRules = rules;
        }

        const smtp = isSuper ? await Store.getSmtpConfig() : null;
        q('#sys-smtp-host').value = smtp?.host || '';
        q('#sys-smtp-port').value = smtp?.port || 587;
        q('#sys-smtp-secure').value = smtp?.secure ? 'true' : 'false';
        q('#sys-smtp-user').value = smtp?.user || '';
        q('#sys-smtp-pass').value = '';
        q('#sys-smtp-pass').placeholder = smtp?.hasPassword ? Lang.t('leaveEmptyUnchanged') : Lang.t('enterPassword');
        q('#sys-smtp-from').value = smtp?.from || '';
        q('#sys-smtp-fromname').value = smtp?.fromName || '';
        q('#sys-smtp-status').textContent = smtp?.configured ? Lang.t('smtpConfigured') : Lang.t('smtpNotConfigured');
        q('#sys-smtp-save-test').onclick = async () => {
            const host = q('#sys-smtp-host').value.trim();
            const from = q('#sys-smtp-from').value.trim();
            if (!host || !from) return UI.toast(Lang.t('enterHostAndSenderAddress'));
            const user = await Store.currentUser();
            if (!user?.email) return UI.toast(Lang.t('noEmailInOwnProfile'));
            const ok = await Store.updateSmtpConfig({
                host, port: parseInt(q('#sys-smtp-port').value, 10) || 587,
                secure: q('#sys-smtp-secure').value === 'true',
                user: q('#sys-smtp-user').value.trim() || null,
                password: q('#sys-smtp-pass').value || undefined,
                from, fromName: q('#sys-smtp-fromname').value.trim() || null
            });
            if (!ok) return UI.toast(Lang.t('smtpSaveFailed'));
            UI.toast(Lang.t('smtpSavedSendingTest'));
            const sent = await Store.sendTestSmtpEmail(user.email);
            UI.toast(sent ? Lang.format('testEmailSentTo', { email: user.email }) : Lang.t('testEmailFailed'));
            q('#sys-smtp-pass').value = '';
            q('#sys-smtp-status').textContent = Lang.t('smtpConfigured');
        };

        const ldap = isSuper ? await Store.getLdapConfig() : null;
        q('#sys-ldap-enabled').checked = !!ldap?.enabled;
        q('#sys-ldap-url').value = ldap?.url || '';
        q('#sys-ldap-base-dn').value = ldap?.baseDn || '';
        q('#sys-ldap-filter').value = ldap?.userFilter || '(uid={username})';
        q('#sys-ldap-bind-dn').value = ldap?.bindDn || '';
        q('#sys-ldap-bind-pass').value = '';
        q('#sys-ldap-bind-pass').placeholder = ldap?.hasBindPassword ? Lang.t('leaveEmptyUnchanged') : Lang.t('enterPassword');
        q('#sys-ldap-status').textContent = ldap?.enabled ? Lang.t('ldapEnabled') : Lang.t('ldapDisabled');
        q('#sys-ldap-save').onclick = async () => {
            const url = q('#sys-ldap-url').value.trim();
            const baseDn = q('#sys-ldap-base-dn').value.trim();
            const bindDn = q('#sys-ldap-bind-dn').value.trim();
            if (!url || !baseDn || !bindDn) return UI.toast(Lang.t('enterServerUrlBaseDnBindDn'));
            if (!/^ldaps:\/\/[^\s/]+/i.test(url)) return UI.toast(Lang.t('ldapsRequired'));
            const ok = await Store.updateLdapConfig({
                enabled: q('#sys-ldap-enabled').checked,
                url, baseDn, bindDn,
                bindPassword: q('#sys-ldap-bind-pass').value || undefined,
                userFilter: q('#sys-ldap-filter').value.trim() || '(uid={username})'
            });
            if (!ok) return UI.toast(Lang.t('ldapSaveFailed'));
            UI.toast(Lang.t('ldapSettingsSaved'));
            q('#sys-ldap-bind-pass').value = '';
            q('#sys-ldap-status').textContent = q('#sys-ldap-enabled').checked ? Lang.t('ldapEnabled') : Lang.t('ldapDisabled');
        };
        q('#sys-ldap-test').onclick = async () => {
            const password = q('#sys-ldap-test-pass').value;
            if (!password) return UI.toast(Lang.t('enterOwnLdapPassword'));
            UI.toast(Lang.t('testingLdapConnection'));
            const ok = await Store.testLdapConfig(password);
            UI.toast(ok ? Lang.t('ldapTestSuccess') : Lang.t('ldapTestFailed'));
            q('#sys-ldap-test-pass').value = '';
        };

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
        // Gewuenschten bzw. ersten erlaubten Reiter oeffnen.
        AdminBoard.categoryFilterGroupId = options.groupId || null;
        const activeTab = modal.querySelector('.sys-settings-nav .tab-btn.active')?.dataset.tab;
        const targetTab = tab && allowedTabs.includes(tab) ? tab : (allowedTabs.includes(activeTab) && !tab ? activeTab : allowedTabs[0]);
        modal.querySelector(`.sys-settings-nav [data-tab="${targetTab}"]`)?.click();
        if (targetTab !== 'sys-categories') AdminBoard.renderCategorySettings();

        const personalPreferences = await Store.getPersonalPreferences(true);
        modal.querySelectorAll('details[data-preference-key]').forEach(details => {
            const open = !personalPreferences.collapsedSections?.[details.dataset.preferenceKey];
            details._preferenceOpen = open; details.open = open;
        });
        q('#sys-save').onclick = async () => {
            const padding = Math.max(1, Math.min(12, parseInt(q('#sys-ticket-number-padding').value, 10) || 5));
            q('#sys-ticket-number-padding').classList.remove('is-invalid');
            q('#sys-ticket-number-padding').removeAttribute('aria-invalid');
            const ticketNumberIssue = can('settingsTicketNumbers') ? AdminBoard.renderTicketNumberPreviews(modal) : null;
            if (ticketNumberIssue) {
                modal.querySelector(`.sys-settings-nav [data-tab="${ticketNumberIssue.input.closest('.tab-content')?.id || 'sys-company'}"]`)?.click();
                ticketNumberIssue.input.focus();
                return UI.toast(ticketNumberIssue.message);
            }
            const approvalRules = modal._approvalRules || [];
            const ruleKeys = approvalRules.map(rule => `${rule.type}:${rule.target}`);
            if (can('settingsApprovals') && (approvalRules.some(rule => !rule.target || !rule.userId) || new Set(ruleKeys).size !== ruleKeys.length)) {
                modal.querySelector('.sys-settings-nav [data-tab="sys-approvals"]')?.click();
                return UI.toast(Lang.t('fallbackRulesInvalid'));
            }
            const uploadLimitMb = Number(q('#sys-upload-limit').value);
            if (can('settingsGeneral') && (!Number.isInteger(uploadLimitMb) || uploadLimitMb < 500 || uploadLimitMb > 2000)) {
                modal.querySelector('.sys-settings-nav [data-tab="sys-general"]')?.click();
                q('#sys-upload-limit').focus();
                return UI.toast(Lang.t('uploadLimitInvalid'));
            }
            const accountSelfServiceFields = qa('#sys-profiles [data-self-field]').filter(box => box.checked).map(box => box.dataset.selfField);
            const contactRules = modal._contactRules || { groups: [], users: [] };
            const contactRuleIssue = ['groups', 'users'].find(kind => {
                const targets = contactRules[kind].map(rule => rule.target);
                return targets.some(target => !target) || new Set(targets).size !== targets.length;
            });
            if (isSuper && contactRuleIssue) {
                modal.querySelector('.sys-settings-nav [data-tab="sys-profiles"]')?.click();
                return UI.toast(Lang.t('contactVisibilityInvalid'));
            }
            const contactVisibility = {
                defaults: qa('#sys-profiles [data-cv-default]').filter(box => box.checked).map(box => box.dataset.cvDefault),
                groups: Object.fromEntries(contactRules.groups.map(rule => [rule.target, rule.fields])),
                users: Object.fromEntries(contactRules.users.map(rule => [rule.target, rule.fields]))
            };
            const payload = {
                companyName: q('#sys-company-name').value.trim(),
                portalName: q('#sys-portal-name').value.trim() || 'Support Portal',
                config: {
                    autoArchiveClosedAfterDays: Math.max(0, parseInt(q('#sys-auto-archive').value, 10) || 0),
                    uploadConfig: { maxFileMb: uploadLimitMb },
                    avatarConfig: { enabled: q('#sys-avatars').value !== 'off' },
                    waitingReminderDays: Math.max(1, parseInt(q('#sys-wait-remind').value, 10) || 2),
                    waitingAfterAction: q('#sys-wait-action').value,
                    waitingReminderEnabled: q('#sys-wait-reminder-enabled').checked,
                    waitingAutoCloseDays: Math.max(1, parseInt(q('#sys-wait-close').value, 10) || 7),
                    defaultPrio: ['Niedrig', 'Normal', 'Hoch'].includes(q('#sys-default-prio').value) ? q('#sys-default-prio').value : 'Normal',
                    showSlaToUsers: !!q('#sys-sla-show-users').checked,
                    // slaHoursByPriority verlangt ganze Stunden (siehe settings.ts) -- Eingaben in
                    // Tagen oder mit Nachkommastellen werden hier in volle Stunden umgerechnet.
                    slaHoursByPriority: {
                        Niedrig: Math.max(1, Math.round(AdminBoard.getSlaField('low', 72))),
                        Normal: Math.max(1, Math.round(AdminBoard.getSlaField('normal', 48))),
                        Hoch: Math.max(1, Math.round(AdminBoard.getSlaField('high', 24))),
                        Kritisch: Math.max(1, Math.round(AdminBoard.getSlaField('critical', 4)))
                    },
                    // "enabled" immer explizit mitschicken (auch false) -- sonst würde ein Ausschalten
                    // nie beim Server ankommen, weil PATCH /settings bestehende Werte nur ergänzt,
                    // nicht ersetzt, und ein weggelassenes Feld folglich den alten Stand behält.
                    businessHours: {
                        enabled: q('#sys-bh-enabled').checked,
                        start: q('#sys-bh-start')?.value || '08:00',
                        end: q('#sys-bh-end')?.value || '17:00',
                        days: qa('#sys-bh-days .bh-day-enabled:checked').map(cb => Number(cb.value)),
                        perDay: Object.fromEntries(qa('#sys-bh-days .business-day-row').map(row => [
                            row.dataset.day,
                            {
                                enabled: row.querySelector('.bh-day-enabled').checked,
                                start: row.querySelector('.bh-day-start').value || '08:00',
                                end: row.querySelector('.bh-day-end').value || '17:00'
                            }
                        ])),
                        holidays: (q('#sys-bh-holidays')?.value || '').split('\n').map(s => s.trim()).filter(Boolean).map(value => {
                            const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                            return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
                        }).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
                    },
                    timeTrackingConfig: { requireActivity: !!q('#sys-require-activity').checked },
                    securityConfig: {
                        mfaMode: q('#sys-mfa-mode').value,
                        mfaRoles: q('#sys-mfa-roles').value,
                        passkeyEveryDays: Number(q('#sys-passkey-days').value),
                        passwordPolicy: Object.fromEntries(['minLength', 'minLowercase', 'minUppercase', 'minDigits', 'minSpecial'].map(key => [key, Number(q(`#sys-pw-${key}`).value)])),
                        force2FA: 'none',
                        sessionTimeout: Math.max(5, parseInt(q('#sys-session-timeout').value, 10) || 480),
                        idleTimeoutMinutes: Math.max(1, parseInt(q('#sys-idle-timeout').value, 10) || 60),
                        maxLoginAttempts: Math.max(1, parseInt(q('#sys-max-login-attempts').value, 10) || 5),
                        lockoutAction: q('#sys-lockout-action').value,
                        lockoutMinutes: Math.max(1, parseInt(q('#sys-lockout-minutes').value, 10) || 15)
                    },
                    notifConfig: {
                        accountApproved: q('#notif-account-approved').checked
                    },
                    notifPolicy: AdminBoard.readNotifMatrix(q('#sys-notif-matrix')),
                    emailAdvancedConfig: {
                        replyTo: q('#sys-email-replyto').value.trim() || null,
                        bccArchive: q('#sys-email-bcc').value.trim() || null,
                        template: q('#sys-email-template').value.trim(),
                        signature: q('#sys-email-text-signature').value,
                        htmlEnabled: q('#sys-email-html-enabled').checked,
                        htmlSignature: q('#sys-email-signature').value,
                        transportSecurity: q('#sys-email-transport').value,
                        certificateValidation: 'strict',
                        smimeCertificatePem: q('#sys-email-smime-cert').value,
                        smimePrivateKeyPem: q('#sys-email-smime-key').value,
                        smimePassphrase: q('#sys-email-smime-pass').value,
                        dkimSelector: q('#sys-email-dkim-selector').value.trim(),
                        dkimDomain: q('#sys-email-dkim-domain').value.trim(),
                        dkimPrivateKeyPem: q('#sys-email-dkim-key').value.trim()
                    },
                    outlookConfig: {
                        enabled: q('#sys-outlook-enabled').checked,
                        tenantId: q('#sys-outlook-tenant').value.trim(),
                        clientId: q('#sys-outlook-client').value.trim(),
                        mailbox: q('#sys-outlook-mailbox').value.trim(),
                        externalDomains: AdminBoard.outlookDomainList(),
                        syncIncoming: false,
                        createTicketsFromMail: false
                    },
                    companyBrandingConfig: {
                        department: q('#sys-company-dept').value.trim(),
                        logoDataUrl: q('#sys-company-logo').value.trim(),
                        supportEmail: q('#sys-company-support').value.trim(),
                        phone: q('#sys-company-phone').value.trim(),
                        timezone: q('#sys-company-timezone').value.trim() || 'Europe/Berlin',
                        location: q('#sys-company-location').value.trim(),
                        address: q('#sys-company-address').value,
                        imprintUrl: q('#sys-company-imprint').value.trim(),
                        privacyUrl: q('#sys-company-privacy').value.trim()
                    },
                    ticketNumberFormat: {
                        prefix: q('#sys-ticket-number-prefix').value.trim(),
                        padding,
                        format: q('#sys-ticket-number-format').value.trim() || undefined
                    },
                    ticketNumberCategoryFormats: Object.fromEntries(
                        qa('#sys-ticket-category-formats [data-ticket-category]')
                            .map(input => [input.dataset.ticketCategory, input.value.trim()])
                            .filter(([, format]) => format)
                    ),
                    ticketNumberCategoryCodes: Object.fromEntries(
                        qa('#sys-ticket-category-formats [data-ticket-code]')
                            .map(input => [input.dataset.ticketCode, input.value.trim()])
                            .filter(([, code]) => code)
                    ),
                    accountSelfServiceFields,
                    contactVisibility,
                    ticketFormConfig: {
                        priorityMode: q('input[name="sys-prio-mode"]:checked')?.value === 'priority' ? 'priority' : 'impact',
                        showServiceBar: q('#sys-show-service-bar').checked
                    },
                    modules: { sla: q('#sys-module-sla').checked, approvals: q('#sys-module-approvals').checked, outlook: q('#sys-module-outlook').checked },
                    approvalWorkflow: {
                        enabled: q('#sys-appr-enabled').checked,
                        priorities: qa('.sys-appr-prio:checked').map(cb => cb.value),
                        fallbackApproverUserId: apprFallbackPicker?.getValue() || null,
                        fallbackRules: approvalRules.map(rule => ({ type: rule.type, target: rule.target, userId: rule.userId }))
                    }
                }
            };
            // Admins senden nur die Bereiche, fuer die sie ein Recht haben.
            if (!isSuper) {
                const allowed = new Set(Object.entries(AdminBoard.SETTINGS_SECTION_KEYS).filter(([perm]) => can(perm)).flatMap(([, keys]) => keys));
                Object.keys(payload.config).forEach(key => { if (!allowed.has(key)) delete payload.config[key]; });
                if (!allowed.has('companyName')) delete payload.companyName;
                if (!allowed.has('portalName')) delete payload.portalName;
                // Nur Kategorien/Tipps freigegeben: die speichern sofort, hier gibt es nichts zu senden.
                if (!Object.keys(payload.config).length && payload.companyName === undefined && payload.portalName === undefined) {
                    modal.classList.remove('open');
                    return UI.toast(Lang.t('systemSettingsSaved'));
                }
            }
            const ok = await Store.updateServerSettings(payload);
            if (!ok) {
                const message = AdminBoard.settingsSaveErrorMessage(Store.lastError);
                let error = {};
                try { error = JSON.parse(Store.lastError || '{}'); } catch { error = {}; }
                if (error.error === 'padding_too_low') {
                    modal.querySelector('.sys-settings-nav [data-tab="sys-company"]')?.click();
                    const paddingInput = q('#sys-ticket-number-padding');
                    paddingInput.min = String(error.minRequired || 1);
                    paddingInput.classList.add('is-invalid');
                    paddingInput.setAttribute('aria-invalid', 'true');
                    paddingInput.focus();
                } else if (message === Lang.t('systemSettingsSaveFailed')) {
                    console.error('Systemeinstellungen speichern fehlgeschlagen:', Store.lastError);
                }
                return UI.toast(message);
            }
            if (can('settingsGeneral')) Store.applyAvatarSetting(q('#sys-avatars').value !== 'off');
            if (isSuper) Store.applyModules({ sla: q('#sys-module-sla').checked, approvals: q('#sys-module-approvals').checked, outlook: q('#sys-module-outlook').checked });
            const outlookSecret = q('#sys-outlook-secret').value;
            if (isSuper && outlookSecret && !await Store.updateOutlookSecret(outlookSecret)) return UI.toast(Lang.t('saveFailed'));
            q('#sys-outlook-secret').value = '';
            if (q('.kanban-board')) await AdminBoard.render();
            if (q('#user-tickets')) await UserDash.renderList();
            modal.classList.remove('open');
            UI.toast(Lang.t('systemSettingsSaved'));
        };
    },

    // Listenansicht: Tabelle mit sortierbaren Spalten, Filtern, gespeicherten Ansichten
    // und Mehrfachauswahl für Sammelaktionen -- für Admins mit vielen offenen Tickets,
    // wo ein Kanban-Board nicht mehr überschaubar ist.
    listViewState: { sortKey: 'prio', sortDir: 'desc', selected: new Set(), expandedIncidents: new Set() },

    openListView: async () => {
        const container = q('#list-view');
        if (!container.dataset.built) {
            container.dataset.built = '1';
            container.innerHTML = `
                <div class="list-view-toolbar">
                    <input type="search" id="lv-search" class="section-search" placeholder="${Lang.t('search')}">
                    <select id="lv-status"><option value="">${Lang.t('allStatuses')}</option></select>
                    <select id="lv-prio"><option value="">${Lang.t('allPriorities')}</option><option value="Niedrig">${Lang.t('low')}</option><option value="Normal">${Lang.t('normal')}</option><option value="Hoch">${Lang.t('high')}</option><option value="Kritisch">${Lang.t('critical')}</option></select>
                    <select id="lv-category"><option value="">${Lang.t('allCategories')}</option></select>
                    <select id="lv-team"><option value="">${Lang.t('allTeams')}</option></select>
                    <details class="lv-more">
                        <summary class="btn-secondary btn-sm">${Icon('sliders-horizontal', 15)}${Lang.t('filtersAndViews')}</summary>
                        <div class="lv-more-body">
                            <label class="check-row compact"><input type="checkbox" id="lv-mine">${Lang.t('onlyMine')}</label>
                            <label class="check-row compact" data-module="sla"><input type="checkbox" id="lv-sla-risk">${Lang.t('slaAtRisk')}</label>
                            <select id="lv-saved-views"><option value="">${Lang.t('savedViewPlaceholder')}</option></select>
                            <button id="lv-save-view" class="btn-secondary btn-sm">${Icon('bookmark-plus', 15)}${Lang.t('saveView')}</button>
                            <button id="lv-delete-view" class="btn-ghost btn-icon btn-danger btn-sm" title="${Lang.t('deleteSelectedView')}" aria-label="${Lang.t('deleteSelectedView')}">${Icon('trash-2', 15)}</button>
                        </div>
                    </details>
                </div>
                <div id="lv-bulk-bar" class="list-view-bulk-bar" hidden>
                    <span id="lv-selected-count"></span>
                    <select id="lv-bulk-status">
                        <option value="">${Lang.t('setStatusPlaceholder')}</option>
                        <option value="Neu">${Lang.t('statusNew')}</option>
                        <option value="In Bearbeitung">${Lang.t('statusDoing')}</option>
                        <option value="Geschlossen">${Lang.t('statusClosed')}</option>
                    </select>
                    <button id="lv-bulk-apply-status" class="btn-secondary btn-sm">${Lang.t('apply')}</button>
                    <button id="lv-bulk-archive" class="btn-secondary btn-sm">${Icon('archive', 15)}${Lang.t('archiveAction')}</button>
                </div>
                <div class="list-view-table-wrap">
                    <table class="list-view-table">
                        <thead><tr>
                            <th><input type="checkbox" id="lv-select-all"></th>
                            <th data-sort="ticketNumber">${Lang.t('colTicketNo')}</th>
                            <th data-sort="title">${Lang.t('colTitle')}</th>
                            <th data-sort="status">${Lang.t('status')}</th>
                            <th data-sort="prio">${Lang.t('prio')}</th>
                            <th data-sort="category">${Lang.t('category')}</th>
                            <th data-sort="owner">${Lang.t('colResponsible')}</th>
                            <th data-sort="createdAt">${Lang.t('colCreated')}</th>
                            <th data-sort="sla" data-module="sla">${Lang.t('colDeadline')}</th>
                        </tr></thead>
                        <tbody id="lv-body"></tbody>
                    </table>
                </div>`;

            ['lv-search'].forEach(id => q('#' + id).oninput = () => AdminBoard.renderListView());
            ['lv-status', 'lv-prio', 'lv-category', 'lv-team'].forEach(id => q('#' + id).onchange = () => AdminBoard.renderListView());
            ['lv-mine', 'lv-sla-risk'].forEach(id => q('#' + id).onchange = () => AdminBoard.renderListView());
            q('#lv-select-all').onchange = (e) => {
                qa('#lv-body input[type="checkbox"]').forEach(cb => { cb.checked = e.target.checked; });
                const ids = qa('#lv-body input[type="checkbox"]').map(cb => cb.dataset.id);
                AdminBoard.listViewState.selected = e.target.checked ? new Set(ids) : new Set();
                AdminBoard.updateListViewBulkBar();
            };
            qa('.list-view-table th[data-sort]').forEach(th => {
                th.onclick = () => {
                    const key = th.dataset.sort;
                    if (AdminBoard.listViewState.sortKey === key) {
                        AdminBoard.listViewState.sortDir = AdminBoard.listViewState.sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        AdminBoard.listViewState.sortKey = key;
                        AdminBoard.listViewState.sortDir = key === 'prio' ? 'desc' : 'asc';
                    }
                    AdminBoard.renderListView();
                };
            });
            q('#lv-saved-views').onchange = async (e) => {
                if (!e.target.value) return;
                const views = await Store.getListViews();
                const view = views.find(v => v.id === e.target.value);
                if (!view) return;
                q('#lv-search').value = view.filters.search || '';
                q('#lv-status').value = view.filters.status || '';
                q('#lv-prio').value = view.filters.prio || '';
                q('#lv-category').value = view.filters.category || '';
                q('#lv-team').value = view.filters.team || '';
                q('#lv-mine').checked = !!view.filters.mine;
                q('#lv-sla-risk').checked = !!view.filters.slaRisk;
                AdminBoard.renderListView();
            };
            q('#lv-save-view').onclick = async () => {
                const name = await UI.promptText({
                    title: Lang.t('saveView'),
                    label: Lang.t('viewName'),
                    placeholder: Lang.t('viewNamePlaceholderExample'),
                    saveLabel: Lang.t('saveView')
                });
                if (!name || !name.trim()) return;
                const ok = await Store.createListView(name.trim(), {
                    search: q('#lv-search').value,
                    status: q('#lv-status').value,
                    prio: q('#lv-prio').value,
                    category: q('#lv-category').value,
                    team: q('#lv-team').value,
                    mine: q('#lv-mine').checked,
                    slaRisk: q('#lv-sla-risk').checked
                });
                UI.toast(ok ? Lang.t('viewSavedToast') : Lang.t('viewSaveFailedToast'));
                await AdminBoard.populateListViewFilters();
            };
            q('#lv-delete-view').onclick = async () => {
                const id = q('#lv-saved-views').value;
                if (!id) return UI.toast(Lang.t('selectSavedViewFirst'));
                UI.confirm(Lang.t('confirmDeleteSavedView'), async () => {
                    const ok = await Store.deleteListView(id);
                    UI.toast(ok ? Lang.t('viewDeletedToast') : Lang.t('deleteFailedToast'));
                    await AdminBoard.populateListViewFilters();
                });
            };
            q('#lv-bulk-apply-status').onclick = async () => {
                const status = q('#lv-bulk-status').value;
                if (!status || !AdminBoard.listViewState.selected.size) return;
                const tickets = await Store.getTickets();
                let changed = 0;
                tickets.forEach(t => {
                    if (AdminBoard.listViewState.selected.has(t.id) && t.status !== status && !t.archived) {
                        t.status = status;
                        changed++;
                    }
                });
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Sammelaktion: Status geändert', `${changed} Ticket(s) auf "${status}" gesetzt`);
                UI.toast(Lang.format('ticketsUpdatedCount', { count: changed }));
                AdminBoard.listViewState.selected = new Set();
                await AdminBoard.renderListView();
            };
            q('#lv-bulk-archive').onclick = async () => {
                if (!AdminBoard.listViewState.selected.size) return;
                UI.confirm(Lang.format('confirmArchiveSelectedTickets', { count: AdminBoard.listViewState.selected.size }), async () => {
                    const tickets = await Store.getTickets();
                    let changed = 0;
                    tickets.forEach(t => {
                        if (AdminBoard.listViewState.selected.has(t.id) && t.status === 'Geschlossen' && !t.archived) {
                            t.archived = true;
                            t.archivedAt = Utils.nowISO();
                            changed++;
                        }
                    });
                    await Store.saveTickets(tickets);
                    await Store.addGlobalLog('Sammelaktion: Archiviert', `${changed} Ticket(s) archiviert`);
                    UI.toast(changed ? Lang.format('ticketsArchivedCount', { count: changed }) : Lang.t('onlyClosedTicketsCanBeArchived'));
                    AdminBoard.listViewState.selected = new Set();
                    await AdminBoard.renderListView();
                });
            };
        }
        await AdminBoard.populateListViewFilters();
        await AdminBoard.renderListView();
    },

    populateListViewFilters: async () => {
        const settings = await Store.getSettings();
        const groups = await Store.getGroups();
        const views = (await Store.getListViews());
        const actor = await Store.currentUser();
        const statusSel = q('#lv-status');
        const curStatus = statusSel.value;
        statusSel.innerHTML = `<option value="">${Lang.t('allStatuses')}</option>` + ['Neu', 'In Bearbeitung', 'Warten auf Benutzer', 'Warten auf externen Dienstleister', 'Warten auf interne Rückmeldung', 'Geschlossen'].map(s => `<option value="${Utils.esc(s)}" ${s === curStatus ? 'selected' : ''}>${Utils.esc(Lang.status(s))}</option>`).join('');
        const catSel = q('#lv-category');
        const curCat = catSel.value;
        catSel.innerHTML = `<option value="">${Lang.t('allCategories')}</option>` + (settings.categories || []).map(c => `<option ${c === curCat ? 'selected' : ''}>${Utils.esc(c)}</option>`).join('');
        const teamSel = q('#lv-team');
        const curTeam = teamSel.value;
        teamSel.innerHTML = `<option value="">${Lang.t('allTeams')}</option>` + groups.map(g => `<option value="${Utils.esc(g.id)}" ${g.id === curTeam ? 'selected' : ''}>${Utils.esc(g.label || g.name)}</option>`).join('');
        const viewsSel = q('#lv-saved-views');
        viewsSel.innerHTML = `<option value="">${Lang.t('savedViewPlaceholder')}</option>` + views.filter(v => v.ownerUserId === actor?.id || v.isShared).map(v => `<option value="${Utils.esc(v.id)}">${Utils.esc(v.name)}${v.isShared ? ` (${Lang.t('shared')})` : ''}</option>`).join('');
    },

    updateListViewBulkBar: () => {
        const bar = q('#lv-bulk-bar');
        const count = AdminBoard.listViewState.selected.size;
        bar.hidden = count === 0;
        q('#lv-selected-count').textContent = Lang.format('selectedCount', { count });
    },

    renderListView: async () => {
        const [tickets, users, groups, settings, actor] = await Promise.all([
            Store.getTickets(), Store.getUsers(), Store.getGroups(), Store.getSettings(), Store.currentUser()
        ]);
        const nameFor = (username) => {
            if (!username) return '-';
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const search = q('#lv-search').value;
        const statusFilter = q('#lv-status').value;
        const prioFilter = q('#lv-prio').value;
        const catFilter = q('#lv-category').value;
        const teamFilter = q('#lv-team').value;
        const mineOnly = q('#lv-mine').checked;
        const slaRiskOnly = Store.modules.sla !== false && q('#lv-sla-risk').checked;

        let visible = tickets.filter(t => !t.archived);
        if (search.trim()) visible = visible.filter(t => Utils.matchesSearch(search, t));
        if (statusFilter) visible = visible.filter(t => t.status === statusFilter);
        if (prioFilter) visible = visible.filter(t => t.prio === prioFilter);
        if (catFilter) visible = visible.filter(t => (Array.isArray(t.category) ? t.category : [t.category]).includes(catFilter));
        if (teamFilter) {
            // Ein Team umfasst auch seine Untergruppen.
            const teamIds = new Set([teamFilter, ...(groups.find(g => g.id === teamFilter)?.descendantIds || [])]);
            visible = visible.filter(t => teamIds.has(t.team));
        }
        if (mineOnly) visible = visible.filter(t => t.owner === actor?.username || (t.assignees || []).includes(actor?.username));
        if (slaRiskOnly) visible = visible.filter(t => { const c = Store.formatSlaCountdown(t, settings); return c && (c.tone === 'warning' || c.tone === 'danger'); });

        const { sortKey, sortDir } = AdminBoard.listViewState;
        const deadlines = new Map(visible.map(t => [t.id, Store.ticketSlaDueAt(t, settings)]));
        const urgency = (a, b) => compareTicketUrgency(a, b, t => deadlines.get(t.id));
        const sortValue = (t) => {
            if (sortKey === 'prio') return getPrioValue(t.prio);
            if (sortKey === 'category') return (Array.isArray(t.category) ? t.category[0] : t.category) || '';
            if (sortKey === 'owner') return nameFor(t.owner);
            if (sortKey === 'sla') { const d = deadlines.get(t.id); return d ?? Infinity; }
            if (sortKey === 'createdAt') return new Date(t.createdAt).getTime();
            return t[sortKey] || '';
        };
        visible.sort((a, b) => {
            const va = sortValue(a), vb = sortValue(b);
            const cmp = va === vb ? 0 : typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return (sortDir === 'asc' ? cmp : -cmp) || urgency(a, b);
        });

        qa('.list-view-table th[data-sort]').forEach(th => {
            th.classList.toggle('sorted-asc', th.dataset.sort === sortKey && sortDir === 'asc');
            th.classList.toggle('sorted-desc', th.dataset.sort === sortKey && sortDir === 'desc');
        });

        const validIds = new Set(visible.map(t => t.id));
        AdminBoard.listViewState.selected.forEach(id => { if (!validIds.has(id)) AdminBoard.listViewState.selected.delete(id); });

        // Tickets einer sichtbaren Grossstoerung stehen nicht mehr einzeln in der Liste, sondern als
        // aufklappbare Unterpunkte unter der Stoerung. Ist die Stoerung selbst ausgefiltert, bleiben
        // ihre Tickets normal sichtbar -- es verschwindet nichts.
        const incidentIds = new Set(visible.filter(t => t.isMajorIncident).map(t => t.id));
        const childrenOf = new Map();
        visible.forEach(t => {
            if (!t.linkedIncidentId || !incidentIds.has(t.linkedIncidentId) || t.id === t.linkedIncidentId) return;
            if (!childrenOf.has(t.linkedIncidentId)) childrenOf.set(t.linkedIncidentId, []);
            childrenOf.get(t.linkedIncidentId).push(t);
        });
        const expanded = AdminBoard.listViewState.expandedIncidents;
        expanded.forEach(id => { if (!childrenOf.has(id)) expanded.delete(id); });
        const rowHtml = (t, { parentId = null } = {}) => {
            const team = t.team ? groups.find(g => g.id === t.team) : null;
            const countdown = Store.formatSlaCountdown(t, settings);
            const checked = AdminBoard.listViewState.selected.has(t.id) ? 'checked' : '';
            const pendingApproval = (t.approvals || []).some(a => a.status === 'pending');
            const children = childrenOf.get(t.id) || [];
            const isOpen = expanded.has(t.id);
            const toggle = children.length
                ? `<button type="button" class="btn-ghost btn-icon btn-xs lv-expand" data-expand="${Utils.esc(t.id)}" aria-expanded="${isOpen}" title="${Utils.esc(Lang.format(isOpen ? 'lvHideIncidentTickets' : 'lvShowIncidentTickets', { count: children.length }))}" aria-label="${Utils.esc(Lang.format(isOpen ? 'lvHideIncidentTickets' : 'lvShowIncidentTickets', { count: children.length }))}">${Icon('chevron-right', 14)}</button>`
                : '';
            return `<tr data-id="${Utils.esc(t.id)}" data-ctx="ticket" class="lv-row${children.length ? ' lv-incident-row' : ''}${parentId ? ' lv-child-row' : ''}"${parentId ? ` data-parent="${Utils.esc(parentId)}"${expanded.has(parentId) ? '' : ' hidden'}` : ''}>
                <td><input type="checkbox" data-id="${Utils.esc(t.id)}" ${checked}></td>
                <td>${Utils.esc(t.ticketNumber || t.id)}</td>
                <td class="lv-title" title="${Utils.esc(t.title)}">${toggle}${parentId ? `<span class="lv-child-marker" aria-hidden="true">${Icon('corner-down-right', 12)}</span>` : ''}${t.isMajorIncident ? `<span class="t-incident-badge lv-incident-icon" title="${Lang.t('majorIncident')}">${Icon('siren', 12)}</span> ` : ''}${Utils.esc(t.title)}${children.length ? ` <span class="badge lv-incident-count" title="${Utils.esc(Lang.format('lvIncidentTicketCount', { count: children.length }))}">${children.length}</span>` : ''}</td>
                <td>${pendingApproval ? `<span class="approval-badge" title="${Lang.t('awaitingApproval')}">${Icon('hourglass', 12)}${Lang.t('approvals')}</span>` : `<span class="status-badge">${Utils.esc(Lang.status(t.status))}</span>`}${t.status === 'Geschlossen' && !t.archived ? `<button type="button" class="btn-ghost btn-icon btn-xs lv-archive-btn" data-archive="${Utils.esc(t.id)}" title="${Utils.esc(Lang.t('moveToArchive'))}" aria-label="${Utils.esc(Lang.t('moveToArchive'))}: ${Utils.esc(t.ticketNumber || t.id)}">${Icon('archive', 13)}</button>` : ''}</td>
                <td><span class="t-tag prio-${t.prio}">${Utils.esc(Lang.prio(t.prio))}</span></td>
                <td>${Utils.esc((Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean).join(', ') || '-')}${team ? ` <span class="t-team">${Icon('route', 10)}${Utils.esc(team.name)}</span>` : ''}</td>
                <td>${Utils.esc(nameFor(t.owner))}</td>
                <td>${Utils.esc(Utils.fmtDate(t.createdAt))}</td>
                <td data-module="sla">${countdown ? `<span class="sla-mini-badge sla-badge-${countdown.tone}" title="${Lang.t('deadline')}: ${Utils.esc(countdown.dueDateLabel)}">${Utils.esc(countdown.dueDateLabel)} · ${Utils.esc(countdown.label)}</span>` : '-'}</td>
            </tr>${children.map(child => rowHtml(child, { parentId: t.id })).join('')}`;
        };
        const topLevel = visible.filter(t => !(t.linkedIncidentId && incidentIds.has(t.linkedIncidentId) && t.id !== t.linkedIncidentId));
        const body = q('#lv-body');
        body.innerHTML = topLevel.length ? topLevel.map(t => rowHtml(t)).join('') : `<tr><td colspan="9"><div class="empty-state">${Lang.t('noTickets')}</div></td></tr>`;
        qa('#lv-body .lv-expand').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const id = btn.dataset.expand;
            const open = !expanded.has(id);
            if (open) expanded.add(id); else expanded.delete(id);
            qa(`#lv-body tr[data-parent="${CSS.escape(id)}"]`).forEach(row => { row.hidden = !open; });
            const count = (childrenOf.get(id) || []).length;
            const label = Lang.format(open ? 'lvHideIncidentTickets' : 'lvShowIncidentTickets', { count });
            btn.setAttribute('aria-expanded', String(open));
            btn.title = label;
            btn.setAttribute('aria-label', label);
        }));
        AdminBoard.syncTimerBadges();
        qa('#lv-body .lv-archive-btn').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            AdminBoard.archiveTicketById(btn.dataset.archive);
        }));

        qa('#lv-body tr.lv-row').forEach(row => {
            row.querySelector('td:not(:first-child)').parentElement.onclick = null;
            row.querySelectorAll('td:not(:first-child)').forEach(td => {
                td.onclick = () => AdminBoard.openModal(row.dataset.id);
                td.style.cursor = 'pointer';
            });
            const cb = row.querySelector('input[type="checkbox"]');
            cb.onclick = (e) => e.stopPropagation();
            cb.onchange = () => {
                if (cb.checked) AdminBoard.listViewState.selected.add(cb.dataset.id);
                else AdminBoard.listViewState.selected.delete(cb.dataset.id);
                AdminBoard.updateListViewBulkBar();
            };
        });
        q('#lv-select-all').checked = visible.length > 0 && visible.every(t => AdminBoard.listViewState.selected.has(t.id));
        AdminBoard.updateListViewBulkBar();
        if (window.lucide) lucide.createIcons();
    },

    // ... existing openApproveModal ...
    renderArchive: async () => {
        const list = q('#archive-list');
        if (!list) return;

        const query = (q('#archive-search')?.value || '').toLowerCase().trim();
        const allArchived = await Store.getArchivedTickets();
        const filterBox = q('#archive-filters');
        if (filterBox && !q('#archive-filter-author')) {
            filterBox.innerHTML = `
                <select id="archive-filter-author" aria-label="Benutzer filtern"><option value="">Alle Benutzer</option></select>
                <span class="archive-filter-label">Archiviert von</span>
                ${UI.dateFieldMarkup('archive-from', '', 'archive-from-dtp')}
                <span class="archive-filter-label">bis</span>
                ${UI.dateFieldMarkup('archive-until', '', 'archive-until-dtp')}`;
            UI.bindDateField('archive-from', { onChange: () => AdminBoard.renderArchive() });
            UI.bindDateField('archive-until', { onChange: () => AdminBoard.renderArchive() });
            q('#archive-from').addEventListener('change', () => AdminBoard.renderArchive());
            q('#archive-until').addEventListener('change', () => AdminBoard.renderArchive());
        }
        const authorSel = q('#archive-filter-author');
        if (authorSel) {
            const current = authorSel.value;
            const authors = [...new Map(allArchived.map(t => [t.author, t.authorName || t.author])).entries()].filter(([u]) => u);
            authorSel.innerHTML = '<option value="">Alle Benutzer</option>' + authors.map(([u, n]) => `<option value="${Utils.esc(u)}">${Utils.esc(n)}</option>`).join('');
            authorSel.value = current;
            authorSel.onchange = () => AdminBoard.renderArchive();
        }
        const fromMs = Utils.parseGermanDateTime(q('#archive-from')?.value.trim() || '', '00:00');
        const untilMs = Utils.parseGermanDateTime(q('#archive-until')?.value.trim() || '', '23:59');
        let archived = allArchived;
        if (authorSel?.value) archived = archived.filter(t => t.author === authorSel.value);
        if (fromMs) archived = archived.filter(t => new Date(t.archivedAt || 0).getTime() >= fromMs);
        if (untilMs) archived = archived.filter(t => new Date(t.archivedAt || 0).getTime() <= untilMs);

        if (query) {
            archived = archived.filter(t => Utils.matchesSearch(query, t));
        }

        archived.sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));

        list.innerHTML = '';
        if (archived.length === 0) {
            list.innerHTML = `<div class="empty-state">${query ? 'Keine Treffer im Archiv' : 'Keine archivierten Tickets'}</div>`;
            return;
        }
        list.innerHTML = `
            <div class="table-head archive-grid">
                <div></div><div>Titel</div><div>Status</div><div>Erstellt</div><div>Archiviert</div><div>Benutzer</div>
            </div>`;
        archived.forEach(t => {
            const el = document.createElement('div');
            el.className = 'table-row archive-grid archive-ticket-row';
            const cats = (Array.isArray(t.category) ? t.category : [t.category || '-']).map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('');

            el.innerHTML = `
                <span class="status-dot ${getStatusColorClass(t.status)}"></span>
                <div class="ticket-row-main">
                    <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</div>
                    <div class="ticket-row-cats">${cats}</div>
                </div>
                <div><span class="status-badge">${Lang.status(t.status)}</span></div>
                <div class="date">${Utils.fmtDate(t.createdAt)}</div>
                <div class="date">${t.archivedAt ? Utils.fmtDate(t.archivedAt) : '-'}</div>
                <div class="row-sub">${Utils.esc(t.authorName || t.author || '-')}</div>
            `;

            el.onclick = () => AdminBoard.openModal(t.id);
            list.appendChild(el);
        });
    },

    renderRequests: async () => {
        const list = q('#request-list');
        if (!list) return;
        const reqs = await Store.getRequests();
        const banner = q('#requests-board');
        const count = q('#request-count');
        if (banner) banner.hidden = reqs.length === 0;
        if (count) count.textContent = String(reqs.length);
        list.innerHTML = '';
        if (reqs.length === 0) {
            list.innerHTML = `<div class="empty-state compact">${Lang.t('noOpenRequests')}</div>`;
            return;
        }
        const existingUsers = await Store.getUsers();
        reqs.forEach(r => {
            const el = document.createElement('div');
            el.className = 'ticket-card request-card';
            const match = existingUsers.find(u => u.email && u.email.toLowerCase() === String(r.email || '').toLowerCase());
            const restoreLabel = match?.accountArchived ? Lang.t('reactivate') : Lang.t('unlock');
            const showRestore = !!match && (match.accountLocked || match.accountArchived);
            el.innerHTML = `
                <div class="req-name">${Utils.esc(r.name)}</div>
                <div class="req-mail">${Utils.esc(r.email)}</div>
                <div class="req-actions">
                    <button class="btn-primary btn-sm req-accept">${Icon('check', 15)}${Lang.t('accept')}</button>
                    ${showRestore ? `<button class="btn-secondary btn-sm req-restore">${Icon(match.accountArchived ? 'archive-restore' : 'lock-open', 15)}${restoreLabel}</button>` : ''}
                    <button class="btn-secondary btn-sm req-decline">${Icon('x', 15)}${Lang.t('decline')}</button>
                </div>
            `;
            el.querySelector('.req-accept').onclick = () => AdminBoard.openApproveModal(r);
            const restoreBtn = el.querySelector('.req-restore');
            if (restoreBtn) restoreBtn.onclick = async () => {
                const users = await Store.getUsers();
                const target = users.find(x => x.id === match.id);
                if (!target) return;
                target.accountLocked = false;
                target.accountArchived = false;
                target.failedLogins = 0;
                await Store.saveUsers(users);
                await Store.addGlobalLog('Konto über Kontoanfrage reaktiviert', `Benutzer: ${target.username}`);
                UI.toast(Lang.format(restoreLabel === Lang.t('reactivate') ? 'accountReactivatedByUsername' : 'accountUnlockedByUsername', { username: target.username }));
                AdminBoard.renderRequests();
            };
            el.querySelector('.req-decline').onclick = () => {
                UI.confirm(Lang.t('confirmDeclineRequest'), async () => {
                    await Store.decideAccountRequest(r.id, 'rejected');
                    AdminBoard.renderRequests();
                });
            };
            list.appendChild(el);
        });
        if (window.lucide) lucide.createIcons();
    },

    chooseWaitingStatus: (fixedStatus = '') => new Promise(resolve => {
        const modal = q('#waiting-status-modal');
        const select = q('#waiting-status-choice');
        const reasonField = q('#waiting-status-reason-field');
        const messageField = q('#waiting-user-message-field');
        const messageInput = q('#waiting-user-message');
        const confirm = q('#waiting-status-confirm');
        const cancel = q('#waiting-status-cancel');
        if (!modal || !select || !reasonField || !messageField || !messageInput || !confirm || !cancel) return resolve(null);

        select.options[0].textContent = Lang.t('chooseReasonPlaceholder');
        select.options[1].textContent = Lang.t('onUserOption');
        select.options[2].textContent = Lang.t('onExternalProviderOption');
        select.options[3].textContent = Lang.t('onInternalFeedbackOption');
        q('#waiting-status-title').lastChild.textContent = fixedStatus ? Lang.t('whatDoYouNeedFromUser') : Lang.t('whatAreYouWaitingFor');
        reasonField.querySelector('label').textContent = Lang.t('waitingReasonLabel');
        messageField.querySelector('label').textContent = Lang.t('messageToUserLabel');
        messageInput.placeholder = Lang.t('whatDoYouNeedFromUser');
        confirm.title = confirm.ariaLabel = Lang.t('applyShort');
        cancel.title = cancel.ariaLabel = Lang.t('cancel');

        select.value = fixedStatus;
        select.disabled = !!fixedStatus;
        reasonField.hidden = !!fixedStatus;
        messageInput.value = '';
        const updateForm = () => {
            messageField.hidden = select.value !== 'Warten auf Benutzer';
            confirm.disabled = !select.value || (select.value === 'Warten auf Benutzer' && !messageInput.value.trim());
        };
        updateForm();
        modal.classList.add('open');
        if (select.value === 'Warten auf Benutzer') messageInput.focus();
        else select.focus();

        const finish = value => {
            modal.classList.remove('open');
            modal.onclick = null;
            document.removeEventListener('keydown', onKeyDown);
            select.disabled = false;
            reasonField.hidden = false;
            messageField.hidden = true;
            messageInput.value = '';
            select.onchange = null;
            messageInput.oninput = null;
            resolve(value);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') finish(null);
        };
        select.onchange = updateForm;
        messageInput.oninput = updateForm;
        confirm.onclick = () => {
            if (!select.value || (select.value === 'Warten auf Benutzer' && !messageInput.value.trim())) return;
            finish({
                status: select.value,
                message: select.value === 'Warten auf Benutzer' ? messageInput.value.trim() : ''
            });
        };
        cancel.onclick = () => finish(null);
        modal.onclick = event => {
            if (event.target === modal) finish(null);
        };
        document.addEventListener('keydown', onKeyDown);
        if (window.lucide) lucide.createIcons();
    }),

    changeStatus: async (id, newStatus, waitingMessage = '') => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(item => item.id === id);
        if (!ticket || ticket.archived || ticket.status === newStatus) return false;
        if (newStatus === 'Warten auf Benutzer' && !waitingMessage.trim()) {
            UI.toast(Lang.t('describeWhatIsNeededFromUser'));
            return false;
        }
        if (newStatus !== 'Geschlossen' && (ticket.approvals || []).some(a => a.status === 'pending')) {
            UI.toast(Lang.t('ticketAwaitingApprovalCannotChange'));
            return false;
        }
        const beforeChange = {
            status: ticket.status,
            owner: ticket.owner,
            ownerUserId: ticket.ownerUserId,
            waitingMessage: ticket.waitingMessage
        };
        const oldStatus = ticket.status;
        const actor = await Store.currentUser();
        ticket.status = newStatus;
        if (newStatus === 'In Bearbeitung' && oldStatus !== 'In Bearbeitung' && actor && !ticket.owner) {
            ticket.owner = actor.username;
            ticket.ownerUserId = actor.id;
        }

        if (newStatus === 'Warten auf Benutzer') {
            ticket.waitingMessage = waitingMessage.trim();
            // Echte, persistierte Chat-Nachricht (statt nur lokal im inzwischen nicht mehr
            // gespeicherten ticket.chat-Array) -- damit sieht die anfragende Person die Frage
            // tatsächlich im Chat.
            await fetch(`/api/v2/tickets/${encodeURIComponent(ticket.id)}/messages`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: ticket.waitingMessage })
            }).catch(() => {});
            await Store.addLog(ticket, 'Nachricht an Benutzer gesendet', ticket.waitingMessage);
        } else {
            delete ticket.waitingMessage;
        }
        await Store.addLog(ticket, `Status geändert von ${oldStatus} zu ${newStatus}`);

        // Großstörung: verknüpfte Tickets übernehmen automatisch denselben Status.
        let linkedForNotify = [];
        if (ticket.isMajorIncident) {
            linkedForNotify = tickets.filter(t => t.linkedIncidentId === ticket.id && !t.archived && t.status !== newStatus);
            for (const lt of linkedForNotify) {
                lt.status = newStatus;
                if (newStatus === 'Warten auf Benutzer') lt.waitingMessage = ticket.waitingMessage;
                else delete lt.waitingMessage;
                await Store.addLog(lt, `Status automatisch von Großstörung übernommen: ${newStatus}`);
            }
        }

        const saved = await Store.saveTickets(tickets);
        if (!saved) {
            Object.assign(ticket, beforeChange);
            linkedForNotify.forEach(lt => {
                // Der Status der verknuepften Tickets wurde nur optimistisch gesetzt. Bei einem
                // fehlgeschlagenen Speichern laden wir direkt neu, damit keine falsche Anzeige bleibt.
                delete lt.waitingMessage;
            });
            await AdminBoard.render();
            console.error('Status speichern fehlgeschlagen:', Store.lastError);
            UI.toast(Lang.t('statusSaveFailed'));
            return false;
        }
        if (newStatus === 'Geschlossen' && ticket.isMajorIncident) {
            await AdminBoard.notifyLinkedIncidentTickets(ticket, ticket.desc);
        }
        // Benachrichtigungen (Ersteller + Beteiligte, App und E-Mail nach Einstellung) und der
        // Protokolleintrag entstehen serverseitig in PATCH /api/v2/tickets/:id.
        await AdminBoard.render();
        if (AdminBoard.currentTicketId === ticket.id && q('#ticket-modal.open')) await AdminBoard.renderChat(ticket, '#m-chat-msgs');
        if (q('#user-tickets')) await UserDash.renderList();
        await Notifications.refresh();
        return true;
    },

    setupDrag: () => {
        qa('.ticket-list').forEach(zone => {
            zone.addEventListener('dragover', e => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });
            zone.addEventListener('drop', async e => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const id = e.dataTransfer.getData('text/plain');
                const newStatus = zone.dataset.status;
                const tickets = await Store.getTickets();
                const t = tickets.find(x => x.id === id);
                if (t && t.status !== newStatus) {
                    if (newStatus === 'Warten auf Benutzer') {
                        if (String(t.status).startsWith('Warten auf')) {
                            await AdminBoard.render();
                            return;
                        }
                        const waitingChoice = await AdminBoard.chooseWaitingStatus();
                        if (!waitingChoice) {
                            await AdminBoard.render();
                            return;
                        }
                        const changed = await AdminBoard.changeStatus(id, waitingChoice.status, waitingChoice.message);
                        if (changed) UI.toast(Lang.format('statusChangedTo', { status: Lang.status(waitingChoice.status) }));
                    } else {
                        const changed = await AdminBoard.changeStatus(id, newStatus);
                        if (changed) UI.toast(Lang.format('statusChangedTo', { status: Lang.status(newStatus) }));
                    }
                }
            });
        });
    },

    // Modal Logic
    currentTicketId: null,

    getTodoAssigneeOptions: (ticket, users, currentUsername) => {
        // Wer eine Teilaufgabe anlegt, muss sie sich auch selbst zuweisen können, auch wenn er
        // (noch) nicht Hauptverantwortlicher oder Beteiligte Person dieses Tickets ist.
        const allowed = new Set([ticket.owner, ...(ticket.participants || []), currentUsername].filter(Boolean));
        return users.filter(user => allowed.has(user.username));
    },

    // ticket.todos existiert nicht mehr lokal (siehe renderTicketTodos) -- vorher iterierte diese
    // Funktion über das immer leere ticket.todos-Array und löste dadurch NIE tatsächlich eine
    // PATCH-Anfrage aus: eine Teilaufgabe blieb einer aus dem Ticket entfernten Beteiligten
    // Person weiterhin zugewiesen, sowohl auf dem Server als auch in der Anzeige. Lädt die
    // echten Teilaufgaben jetzt frisch von der API und löscht betroffene Zuweisungen dort.
    syncTodoAssignees: async (ticket) => {
        const allowed = new Set([ticket.owner, ...(ticket.participants || [])].filter(Boolean));
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticket.id)}/todos`, { credentials: 'same-origin' }).catch(() => null);
        const todos = res && res.ok ? (await res.json()).todos || [] : [];
        const cleared = [];
        for (const todo of todos) {
            if (todo.assignee_username && !allowed.has(todo.assignee_username)) {
                cleared.push(todo.content);
                await fetch(`/api/v2/tickets/${encodeURIComponent(ticket.id)}/todos/${encodeURIComponent(todo.id)}`, {
                    method: 'PATCH', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ assignee_user_id: null, assignee_username: null })
                }).catch(() => {});
            }
        }
        if (cleared.length) await Store.addLog(ticket, 'Teilaufgaben-Zuweisung entfernt', cleared.join(', '));
    },

    ensureResponsibilitySection: async (t, users, tickets) => {
        const details = q('#tab-details');
        if (!details) return;

        const staff = users.filter(u => (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived);
        const actor = await Store.currentUser();
        if (!Array.isArray(t.todos)) t.todos = [];
        // Beteiligte Personen kommen aus der echten /participants-API, nicht aus einem (nie
        // persistierten) ticket.participants-Feld -- einmal je Öffnen des Tickets geladen.
        const participantRows = await Store.getTicketParticipants(t.id);
        t.participants = participantRows.map(p => p.username);
        if (!t.owner && t.participants.length) t.owner = t.participants[0];

        q('#ticket-responsibility')?.remove();
        const section = document.createElement('div');
        section.id = 'ticket-responsibility';
        section.className = 'responsibility-section';
        section.innerHTML = `
            <div class="section-title">${Icon('user-check', 15)} ${Lang.t('responsibilities')}</div>
            <div class="responsibility-grid">
                <div class="field">
                    <label>${Lang.t('mainResponsible')}</label>
                    <select id="m-owner-select">
                        <option value="">${Lang.t('notAssigned')}</option>
                        ${staff.map(u => `<option value="${Utils.esc(u.username)}">${Utils.esc(u.name || u.username)}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label>${Lang.t('involvedPersons')}</label>
                    <div id="participants-multi" class="multi-select-container"></div>
                </div>
            </div>
            <div class="ticket-todo-panel">
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('list-checks', 15)}${Lang.t('subtasks')}</span><span id="todo-progress-count" class="todo-progress-count"></span></div>
                <div id="todo-progress-bar" class="todo-progress-bar" hidden><div id="todo-progress-fill" class="todo-progress-fill"></div></div>
                <div id="ticket-todos" class="ticket-todos"></div>
                <div class="todo-create-row">
                    <input id="todo-title" type="text" placeholder="${Lang.t('newSubtaskPlaceholder')}">
                    <select id="todo-assignee">
                        <option value="">${Lang.t('withoutAssignment')}</option>
                        ${AdminBoard.getTodoAssigneeOptions(t, staff, actor?.username).map(u => `<option value="${Utils.esc(u.username)}"${u.username === actor?.username ? ' selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                    </select>
                    <button class="btn-primary" id="todo-add" type="button">${Icon('plus', 16)}${Lang.t('add')}</button>
                </div>
            </div>
            <div class="time-tracking-panel">
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('clock', 15)}${Lang.t('timeTracking')}</span><span id="time-total-label" class="todo-progress-count"></span></div>
                <div id="time-entry-list" class="time-entry-list"></div>
                <div class="todo-create-row">
                    <input id="time-minutes" type="number" min="1" step="5" placeholder="${Lang.t('minutesPlaceholder')}">
                    <input id="time-note" type="text" placeholder="${Lang.t('notePlaceholderOptional')}">
                    <button class="btn-primary" id="time-add" type="button">${Icon('plus', 16)}${Lang.t('add')}</button>
                </div>
            </div>
        `;
        const actionsRow = details.querySelector(':scope > .actions-row');
        if (actionsRow) actionsRow.before(section);
        else details.appendChild(section);

        const ownerSelect = q('#m-owner-select');
        ownerSelect.value = t.owner || '';
        ownerSelect.disabled = !!t.archived;
        ownerSelect.onchange = async () => {
            const old = t.owner || 'Nicht zugewiesen';
            t.owner = ownerSelect.value;
            t.ownerUserId = users.find(u => u.username === t.owner)?.id || null;
            await Store.addLog(t, 'Hauptverantwortlicher geändert', `Alt: ${old} -> Neu: ${t.owner || 'Nicht zugewiesen'}`);
            await Store.saveTickets(tickets);
            await AdminBoard.notifyIfAbsentAssignee(t, t.owner, (await Store.currentUser())?.username);
            await AdminBoard.ensureResponsibilitySection(t, users, tickets);
            await AdminBoard.setupMentionAutocomplete(t);
            await AdminBoard.render();
        };

        const participantsMulti = q('#participants-multi');
        const participantOptions = staff
            .filter(u => u.username !== t.owner)
            .map(u => ({
                value: u.username,
                label: u.name || u.username
            }));
        const participantValues = (t.participants || []).filter(username => username !== t.owner);
        t.participants = participantValues;
        UI.createMultiSelect(participantsMulti, participantOptions, participantValues, async (newParticipants) => {
            const previouslyIn = new Set(t.participants || []);
            const filtered = newParticipants.filter(username => username !== t.owner);
            const userIds = filtered.map(username => users.find(u => u.username === username)?.id).filter(Boolean);
            if (!(await Store.setTicketParticipants(t.id, userIds))) {
                UI.toast(Lang.t('participantsSaveFailed'));
                return;
            }
            t.participants = filtered;
            await AdminBoard.syncTodoAssignees(t);
            AdminBoard.renderTicketTodos(t, staff, tickets);
            const actorUsername = (await Store.currentUser())?.username;
            for (const username of t.participants) {
                if (!previouslyIn.has(username)) await AdminBoard.notifyIfAbsentAssignee(t, username, actorUsername);
            }
            await AdminBoard.setupMentionAutocomplete(t);
            await AdminBoard.render();
        });
        participantsMulti.classList.toggle('is-disabled', !!t.archived);

        AdminBoard.renderTicketTodos(t, staff, tickets);
        AdminBoard.renderTimeEntries(t, users, tickets);
        if (window.lucide) lucide.createIcons();
    },

    // Zeiterfassung: aufgewendete Zeit pro Ticket, für interne Verrechnung oder Dienstleister-Abrechnung.
    // Lädt/speichert über /api/v2/tickets/:id/time-entries -- t.timeEntries existiert nicht mehr lokal.
    renderTimeEntries: async (t, users, tickets) => {
        WorkTimer.renderButton(t.id);
        const list = q('#time-entry-list');
        const addBtn = q('#time-add');
        if (!list || !addBtn) return;
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/time-entries`, { credentials: 'same-origin' }).catch(() => null);
        const entries = res && res.ok ? (await res.json()).entries || [] : [];
        const fmtMinutes = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} ${Lang.t('hoursAbbr')}` : `${mins} ${Lang.t('minutesAbbr')}`;
        const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        const totalLabel = q('#time-total-label');
        if (totalLabel) totalLabel.textContent = totalMinutes ? Lang.format('recordedTime', { label: fmtMinutes(totalMinutes) }) : '';
        list.innerHTML = entries.length ? entries.slice().reverse().map(e => `
            <div class="time-entry-row" data-id="${Utils.esc(e.id)}">
                <span class="time-entry-duration">${fmtMinutes(e.minutes)}</span>
                <span class="time-entry-meta">${Utils.esc(e.username)} · ${Utils.esc(Utils.fmtDate(e.created_at))}${e.note ? ' · ' + Utils.esc(e.note) : ''}</span>
                <button type="button" class="btn-ghost btn-icon btn-xs btn-danger time-entry-remove" title="${Lang.t('removeEntry')}" aria-label="${Lang.t('removeEntry')}">${Icon('x', 13)}</button>
            </div>`).join('') : `<div class="empty-state compact">${Lang.t('noTimeRecordedYet')}</div>`;
        list.querySelectorAll('.time-entry-remove').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.closest('.time-entry-row').dataset.id;
                await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/time-entries/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
                AdminBoard.renderTimeEntries(t, users, tickets);
            };
        });
        addBtn.disabled = !!t.archived;
        addBtn.onclick = async () => {
            const minutesInput = q('#time-minutes');
            const noteInput = q('#time-note');
            const minutes = parseInt(minutesInput.value, 10);
            if (!Number.isFinite(minutes) || minutes <= 0) {
                UI.toast(Lang.t('enterValidDurationMinutes'));
                return;
            }
            await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/time-entries`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ minutes, note: noteInput.value.trim() || undefined })
            }).catch(() => {});
            minutesInput.value = '';
            noteInput.value = '';
            AdminBoard.renderTimeEntries(t, users, tickets);
        };
    },

    // Nutzt den dedizierten Endpunkt /link-incident statt der generischen Ticket-Diff-Speicherung,
    // da incident_id (bisher linkedIncidentId) nicht Teil der flachen Felder in Store.saveTickets ist.
    linkTicketToIncident: async (ticketId, incidentId) => {
        if (ticketId === incidentId) return false;
        const tickets = await Store.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        const incident = tickets.find(t => t.id === incidentId);
        if (!ticket || !incident || !incident.isMajorIncident || ticket.isMajorIncident || ticket.linkedIncidentId === incidentId) return false;
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticketId)}/link-incident`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ incident_id: incidentId })
        }).catch(() => null);
        if (!res || !res.ok) return false;
        if (ticket.status !== incident.status) {
            await AdminBoard.changeStatus(ticketId, incident.status);
        }
        await AdminBoard.render();
        return true;
    },

    openAddTicketsToIncident: async (incidentId) => {
        const tickets = await Store.getTickets();
        const candidates = tickets.filter(t => !t.archived && !t.isMajorIncident && !t.linkedIncidentId && t.id !== incidentId);
        const modal = document.createElement('div');
        modal.id = 'incident-add-modal';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md">
                <div class="modal-header">
                    <h3>${Icon('list-tree', 18)}${Lang.t('addTicketsToIncident')}</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" id="iam-save" title="${Lang.t('add')}" aria-label="${Lang.t('add')}">${Icon('save', 16)}</button>
                        <button class="btn-ghost btn-icon" id="iam-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body">
                    <input type="search" id="iam-search" class="section-search" placeholder="${Lang.t('searchTicketNoTitlePerson')}">
                    <div class="checkbox-list" id="iam-list">${candidates.map(t => `
                        <label class="check-row" data-search="${Utils.esc(`${t.ticketNumber || ''} ${t.title} ${t.authorName || ''} ${t.author || ''}`.toLowerCase())}"><input type="checkbox" value="${Utils.esc(t.id)}">
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>${Utils.esc(t.authorName || t.author || '-')} · ${Lang.status(t.status)}</span></span>
                        </label>`).join('')}</div>
                    <div class="empty-state compact" id="iam-empty" ${candidates.length ? 'hidden' : ''}>${Lang.t('noMatches')}</div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const close = () => { modal.remove(); };
        const searchInput = modal.querySelector('#iam-search');
        searchInput.oninput = () => {
            const term = searchInput.value.trim().toLowerCase();
            let visible = 0;
            modal.querySelectorAll('#iam-list .check-row').forEach(row => {
                const match = !term || row.dataset.search.includes(term);
                row.hidden = !match;
                if (match) visible++;
            });
            modal.querySelector('#iam-empty').hidden = visible > 0;
        };
        modal.querySelector('#iam-close').onclick = close;
        modal.onclick = e => { if (e.target === modal) close(); };
        modal.querySelector('#iam-save').onclick = async () => {
            const ids = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
            if (!ids.length) return UI.toast(Lang.t('selectAtLeastOneTicket'));
            for (const ticketId of ids) await AdminBoard.linkTicketToIncident(ticketId, incidentId);
            close();
            UI.toast(Lang.format('ticketsAddedToIncident', { count: ids.length }));
            await AdminBoard.openModal(incidentId);
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    renderIncidentLinkedTickets: (ticket, allTickets) => {
        const box = q('#m-incident-linked-list');
        if (!box) return;
        if (!ticket.isMajorIncident) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const linked = allTickets.filter(item => item.linkedIncidentId === ticket.id && !item.archived);
        box.hidden = false;
        box.innerHTML = `
            <h4 class="section-title">${Icon('list-tree', 15)} ${Lang.t('linkedTickets')}</h4>
            ${linked.length ? `<div class="incident-linked-table">
                ${linked.map(item => `
                    <div class="incident-linked-row" data-ticket-id="${Utils.esc(item.id)}">
                        <button type="button" class="incident-linked-open">
                            <span><strong>${Utils.esc(item.ticketNumber || item.id)}</strong>${Utils.esc(item.title)}</span>
                            <span>${Utils.esc(item.authorName || item.author || '-')}</span>
                            <span>${Lang.status(item.status)}</span>
                        </button>
                    </div>
                `).join('')}
            </div>` : `<div class="empty-state compact">${Lang.t('noTicketsLinkedYet')}</div>`}
        `;
        box.querySelectorAll('.incident-linked-open').forEach(btn => {
            btn.onclick = () => AdminBoard.openModal(btn.closest('[data-ticket-id]').dataset.ticketId);
        });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-secondary btn-sm incident-linked-add';
        addBtn.innerHTML = `${Icon('plus', 14)}${Lang.t('addTicket')}`;
        addBtn.disabled = !!ticket.archived;
        addBtn.onclick = () => AdminBoard.openAddTicketsToIncident(ticket.id);
        box.querySelector('.section-title')?.after(addBtn);
        if (window.lucide) lucide.createIcons();
    },

    // Lädt/speichert über /api/v2/tickets/:id/todos -- t.todos existiert nicht mehr lokal.
    renderTicketTodos: async (t, users, tickets) => {
        const list = q('#ticket-todos');
        const addBtn = q('#todo-add');
        const titleInput = q('#todo-title');
        const assigneeSelect = q('#todo-assignee');
        if (!list || !addBtn || !titleInput || !assigneeSelect) return;

        const getName = (username) => {
            const found = users.find(u => u.username === username);
            return found ? (found.name || found.username) : username;
        };
        const assigneeOptions = AdminBoard.getTodoAssigneeOptions(t, users);
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos`, { credentials: 'same-origin' }).catch(() => null);
        const todos = res && res.ok ? (await res.json()).todos || [] : [];

        const todoTotal = todos.length;
        const todoDone = todos.filter(todo => todo.done).length;
        const progressCount = q('#todo-progress-count');
        if (progressCount) progressCount.textContent = todoTotal ? `${todoDone} von ${todoTotal} erledigt` : '';
        const progressBar = q('#todo-progress-bar');
        const progressFill = q('#todo-progress-fill');
        if (progressBar) progressBar.hidden = !todoTotal;
        if (progressFill) progressFill.style.width = `${todoTotal ? Math.round((todoDone / todoTotal) * 100) : 0}%`;
        const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        } [c]));

        list.innerHTML = todos.length ? todos.map(todo => `
            <div class="ticket-todo ${todo.done ? 'done' : ''}" data-id="${todo.id}">
                <label>
                    <input type="checkbox" ${todo.done ? 'checked' : ''} ${t.archived ? 'disabled' : ''}>
                    <span>${esc(todo.content)}</span>
                    ${todo.done && todo.done_at ? `<span class="todo-done-at" title="${Lang.t('doneOn')}">${Icon('check', 11)}${Utils.esc(Utils.fmtDate(todo.done_at))}</span>` : ''}
                </label>
                <div class="todo-meta">
                    ${todo.assignee_username ? `<span class="badge">${Icon('user-round', 12)}${esc(getName(todo.assignee_username))}</span>` : `<span class="badge">${Lang.t('notAssigned')}</span>`}
                    <button class="btn-ghost btn-icon btn-sm todo-edit" title="${Lang.t('editSubtask')}" aria-label="${Lang.t('editSubtask')}" ${t.archived ? 'disabled' : ''}>${Icon('pencil', 14)}</button>
                    <button class="btn-ghost btn-icon btn-sm btn-danger todo-delete" title="${Lang.t('deleteSubtask')}" aria-label="${Lang.t('deleteSubtask')}" ${t.archived ? 'disabled' : ''}>${Icon('trash-2', 15)}</button>
                </div>
            </div>
        `).join('') : `<div class="empty-state compact">${Lang.t('noSubtasksYet')}</div>`;

        list.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.onchange = async () => {
                const row = chk.closest('.ticket-todo');
                await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos/${encodeURIComponent(row.dataset.id)}`, {
                    method: 'PATCH', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ done: chk.checked })
                }).catch(() => {});
                AdminBoard.renderTicketTodos(t, users, tickets);
            };
        });

        list.querySelectorAll('.todo-edit').forEach(btn => {
            btn.onclick = () => {
                const row = btn.closest('.ticket-todo');
                const todo = todos.find(item => item.id === row.dataset.id);
                if (!todo) return;
                row.innerHTML = `
                    <div class="todo-edit-fields">
                        <input class="todo-title-edit" type="text" value="${esc(todo.content)}" aria-label="${Lang.t('subtaskLabel')}">
                        <select class="todo-assignee-edit" aria-label="${Lang.t('responsiblePerson')}">
                            <option value="">${Lang.t('withoutAssignment')}</option>
                            ${assigneeOptions.map(user => `<option value="${esc(user.username)}">${esc(user.name || user.username)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="todo-meta">
                        <button class="btn-ghost btn-icon btn-sm todo-save" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('check', 14)}</button>
                        <button class="btn-ghost btn-icon btn-sm todo-cancel" title="${Lang.t('cancel')}" aria-label="${Lang.t('cancel')}">${Icon('x', 14)}</button>
                    </div>`;
                const select = row.querySelector('.todo-assignee-edit');
                if (assigneeOptions.some(user => user.username === todo.assignee_username)) select.value = todo.assignee_username;
                row.querySelector('.todo-save').onclick = async () => {
                    const title = row.querySelector('.todo-title-edit').value.trim();
                    if (!title) return UI.toast(Lang.t('enterATitle'));
                    const assigneeUser = users.find(u => u.username === select.value);
                    await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos/${encodeURIComponent(todo.id)}`, {
                        method: 'PATCH', credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ content: title, assignee_user_id: assigneeUser?.id || null, assignee_username: select.value || null })
                    }).catch(() => {});
                    AdminBoard.renderTicketTodos(t, users, tickets);
                };
                row.querySelector('.todo-cancel').onclick = () => AdminBoard.renderTicketTodos(t, users, tickets);
                row.querySelector('.todo-title-edit').focus();
                if (window.lucide) lucide.createIcons();
            };
        });

        list.querySelectorAll('.todo-delete').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.ticket-todo');
                await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos/${encodeURIComponent(row.dataset.id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
                AdminBoard.renderTicketTodos(t, users, tickets);
            };
        });

        titleInput.disabled = !!t.archived;
        assigneeSelect.disabled = !!t.archived;
        addBtn.disabled = !!t.archived;
        addBtn.onclick = async () => {
            const title = titleInput.value.trim();
            if (!title) return;
            const assigneeUser = users.find(u => u.username === assigneeSelect.value);
            await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: title, assignee_user_id: assigneeUser?.id || null, assignee_username: assigneeSelect.value || null })
            }).catch(() => {});
            titleInput.value = '';
            assigneeSelect.value = '';
            AdminBoard.renderTicketTodos(t, users, tickets);
        };
        if (window.lucide) lucide.createIcons();
    },

    // Vertretung/Abwesenheit: offene Tickets eines abwesenden Agenten gehen an eine Vertretung
    // oder zurück ins Team (Owner wird geleert), damit nichts liegen bleibt.
    openAbsenceModal: async (username) => {
        const users = await Store.getUsers();
        const target = users.find(u => u.username === username);
        if (!target) return;
        const substitutes = users.filter(u => u.username !== username && (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived);
        q('#absence-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'absence-modal';
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = Lang.format('absenceOf', { name: target.name || target.username });
        modal.querySelector('.modal-body').innerHTML = `
            <label class="check-row"><input type="checkbox" id="abs-active" ${target.absence?.active ? 'checked' : ''}>${Lang.t('markAsAbsent')}</label>
            ${Settings.absencePeriodMarkup(target.absence, 'abm')}
            <label class="check-row"><input type="checkbox" id="abs-visible" ${target.absence?.visible ? 'checked' : ''}>${Lang.t('showOtherAdminsAbsent')}</label>
            <div class="field">
                <label for="abs-substitute">${Lang.t('substitute')}</label>
                <select id="abs-substitute">
                    <option value="">${Lang.t('noneTicketsBackToTeam')}</option>
                    ${substitutes.map(u => `<option value="${Utils.esc(u.username)}" ${target.absence?.substitute === u.username ? 'selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                </select>
            </div>
            <p class="hint">${Lang.format('absenceActivateHint', { name: Utils.esc(target.name || target.username) })}</p>`;
        Settings.bindAbsencePeriod('abm', target.absence || {});
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const active = q('#abs-active').checked;
            const substitute = q('#abs-substitute').value || null;
            let period;
            try { period = Settings.readAbsencePeriod('abm'); } catch (error) { return UI.toast(error.message); }
            await AdminBoard.setAbsence(username, active, substitute, q('#abs-visible').checked, period.fromMs, period.untilMs);
            modal.classList.remove('open');
            AdminBoard.renderUserManager('admins');
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Setzt/plant/aktualisiert die Abwesenheit einer Person über die echten Server-Endpunkte
    // (POST /users/:id/absence bzw. /users/me/absence) -- vorher mutierte diese Funktion nur
    // ein lokales JS-Objekt und "speicherte" es über Store.saveUsers, das das absence-Feld gar
    // nicht kennt; Abwesenheiten für ANDERE Personen wurden dadurch nie wirklich gespeichert.
    setAbsence: async (username, active, substituteUsername, visible = false, fromMs = null, untilMs = null) => {
        const users = await Store.getUsers();
        const target = users.find(u => u.username === username);
        if (!target) return;
        if (!active) {
            await AdminBoard.endAbsence(target, users);
            await AdminBoard.render();
            return;
        }
        const now = Date.now();
        const substitute = substituteUsername ? users.find(u => u.username === substituteUsername) : null;
        const fmt = ms => Utils.fmtDateOnly(ms);
        const me = await Store.currentUser();
        // VOR dem Server-Aufruf abfragen: applyUserAbsence haengt die Tickets server-seitig
        // sofort um, danach zeigt t.owner bereits die Vertretung, nicht mehr "username".
        const openTickets = (await Store.getTickets()).filter(t => t.owner === username && t.status !== 'Geschlossen' && !t.archived);
        const payload = {
            active: true,
            from_at: fromMs ? new Date(fromMs).toISOString() : undefined,
            until_at: untilMs ? new Date(untilMs).toISOString() : undefined,
            substitute_user_id: substitute?.id || undefined,
            visible: !!visible
        };
        const isSelf = me?.id === target.id;
        const result = await Store.setUserAbsence(isSelf ? null : target.id, payload);
        if (!result) {
            UI.toast(Lang.t('absenceSaveFailed'));
            return;
        }
        if (fromMs && fromMs > now) {
            await Store.addGlobalLog('Abwesenheit geplant', `Benutzer: ${target.name || username}, von ${fmt(fromMs)} bis ${untilMs ? fmt(untilMs) : 'offen'}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, Anzeige für andere Admins: ${visible ? 'ja' : 'nein'}`);
            UI.toast(Lang.format('absenceScheduledFrom', { date: fmt(fromMs) }));
            await AdminBoard.render();
            return;
        }
        // Server hat bereits umgehaengt (applyUserAbsence) -- openTickets ist der Stand davor,
        // genau fuer die Protokoll-/Benachrichtigungsmeldung. Die Vertretung zusaetzlich als
        // Beteiligte eintragen (macht applyUserAbsence serverseitig bewusst nicht, da dort nur
        // der Hauptverantwortliche gewechselt wird) -- eigener API-Aufruf pro Ticket.
        const addedAsParticipant = [];
        if (substitute && openTickets.length) {
            for (const t of openTickets) {
                const existingParticipants = await Store.getTicketParticipants(t.id);
                const wasParticipant = existingParticipants.some(p => p.userId === substitute.id);
                if (!wasParticipant) {
                    await Store.setTicketParticipants(t.id, [...existingParticipants.map(p => p.userId), substitute.id]);
                    addedAsParticipant.push(t);
                }
            }
        }
        if (openTickets.length) {
            const ticketLines = openTickets.map(t => `${t.ticketNumber || t.id} „${t.title}“: Hauptverantwortlicher ${target.name || username} → ${substitute ? (substitute.name || substitute.username) : 'Team (keiner)'}`);
            await Store.addGlobalLog('Abwesenheit aktiviert', `Benutzer: ${target.name || username}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, bis ${untilMs ? fmt(untilMs) : 'offen'}, ${openTickets.length} Ticket(s)\n${ticketLines.join('\n')}`);
        } else {
            await Store.addGlobalLog('Abwesenheit aktiviert', `Benutzer: ${target.name || username}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, bis ${untilMs ? fmt(untilMs) : 'offen'}, keine offenen Tickets`);
        }
        if (substitute && openTickets.length) await AdminBoard.notifySubstituteAbsence(substitute, target, openTickets, addedAsParticipant);
        UI.toast(openTickets.length ? Lang.format('ticketsHandedOver', { count: openTickets.length }) : Lang.t('absenceActivatedToast'));
        await AdminBoard.render();
    },

    endAbsence: async (target, users) => {
        const me = await Store.currentUser();
        const isSelf = me?.id === target.id;
        const result = await Store.setUserAbsence(isSelf ? null : target.id, { active: false });
        if (!result) {
            UI.toast(Lang.t('absenceEndFailed'));
            return;
        }
        await Store.addGlobalLog('Abwesenheit beendet', `Benutzer: ${target.name || target.username}`);
        UI.toast(Lang.t('absenceEndedToast'));
    },

    processAbsences: async () => {
        const now = Date.now();
        const users = await Store.getUsers();
        for (const u of users) {
            const a = u.absence || {};
            if (a.pending && a.fromMs && a.fromMs <= now) {
                await AdminBoard.setAbsence(u.username, true, a.substitute, a.visible, a.fromMs, a.untilMs);
            } else if (a.active && a.untilMs && a.untilMs < now) {
                const fresh = await Store.getUsers();
                await AdminBoard.endAbsence(fresh.find(x => x.username === u.username), fresh);
            }
        }
    },

    // Holt ausgewählte, waehrend einer Abwesenheit an die Vertretung übergebene Tickets zurück.
    // "returnPending" gibt es im normalisierten Schema nicht mehr als gespeicherte Liste -- ein
    // zurückgeholtes Ticket taucht einfach nicht mehr in Store.getTransferredTickets auf, sobald
    // assigned_to_user_id wieder die abwesende Person selbst ist.
    returnTickets: async (absentUsername, ticketIds) => {
        const users = await Store.getUsers();
        const absent = users.find(u => u.username === absentUsername);
        const tickets = await Store.getTickets();
        const byFrom = new Map();
        for (const id of ticketIds) {
            const t = tickets.find(x => x.id === id);
            if (!t || t.archived || t.owner === absentUsername) continue;
            const fromUser = t.owner;
            t.owner = absentUsername;
            t.ownerUserId = absent?.id || null;
            await Store.addLog(t, `Ticket von ${absent?.name || absentUsername} zurückgeholt (vorher Vertretung: ${fromUser || '–'})`);
            if (fromUser) byFrom.set(fromUser, [...(byFrom.get(fromUser) || []), t]);
        }
        if (ticketIds.length) await Store.saveTickets(tickets);
        for (const [fromUser, list] of byFrom) {
            const message = Lang.format('ticketsReclaimedNotification', { name: absent?.name || absentUsername, count: list.length }) + '\n' + list.map(t => Lang.format('ticketLineStatus', { num: t.ticketNumber || t.id, title: t.title, status: Lang.status(t.status) })).join('\n');
            await Store.addNotifications([fromUser], { id: null }, message, null, 'absence');
        }
        await Notifications.refresh();
        if (ticketIds.length) UI.toast(Lang.format('ticketsReclaimedToast', { count: ticketIds.length }));
    },

    openAbsenceReturnPopup: async (user) => {
        if (!user) return;
        q('#absence-return-popup')?.remove();
        const ids = await Store.getTransferredTickets(user.id);
        if (!ids.length) return;
        const users = await Store.getUsers();
        const tickets = (await Store.getTickets()).filter(t => ids.includes(t.id) && !t.archived);
        if (!tickets.length) {
            await AdminBoard.returnTickets(user.username, []);
            return;
        }
        const modal = document.createElement('div');
        modal.id = 'absence-return-popup';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md substitute-popup">
                <div class="modal-header">
                    <h3>${Icon('plane', 20)}${Lang.t('absenceEndedReclaimTickets')}</h3>
                </div>
                <div class="modal-body">
                    <p class="hint">${Lang.t('absenceReturnHint')}</p>
                    <div class="checkbox-list">${tickets.map(t => {
                        const owner = users.find(u => u.username === t.owner);
                        return `<label class="check-row"><input type="checkbox" value="${Utils.esc(t.id)}" checked>
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>${Lang.format('statusCurrentlyWith', { status: Utils.esc(Lang.status(t.status)), owner: Utils.esc(owner?.name || t.owner || Lang.t('nobody')) })}</span></span>
                        </label>`;
                    }).join('')}</div>
                </div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-secondary" id="arp-keep">${Lang.t('doNotReclaim')}</button>
                    <button class="btn-primary" id="arp-return">${Icon('undo-2', 16)}${Lang.t('reclaimSelected')}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#arp-keep').onclick = async () => {
            modal.remove();
            await AdminBoard.returnTickets(user.username, []);
        };
        modal.querySelector('#arp-return').onclick = async () => {
            const chosen = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
            modal.remove();
            await AdminBoard.returnTickets(user.username, chosen);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    sectionsFromMessage: message => {
        const [, ...lines] = String(message || '').split('\n');
        return lines.map(line => {
            const head = line.match(/^(.*?):\s(.*)$/);
            if (!head) return null;
            const items = head[2].split('; ').filter(Boolean).map(entry => {
                const parts = entry.match(/^(\S+?):?\s+(.*)$/);
                return parts ? { ticket: parts[1], text: parts[2] } : { ticket: '', text: entry };
            });
            return { title: head[1], items, checklist: /^Offene Teilaufgaben/.test(head[1]) };
        }).filter(section => section && section.items.length);
    },

    absenceInfoText: absence => {
        const fmt = ms => Utils.fmtDateOnly(ms);
        const period = absence.fromMs && absence.untilMs ? Lang.format('periodFromTo', { from: fmt(absence.fromMs), until: fmt(absence.untilMs) })
            : absence.untilMs ? Lang.format('periodUntil', { until: fmt(absence.untilMs) })
            : absence.fromMs ? Lang.format('periodFromIndefinite', { from: fmt(absence.fromMs) })
            : Lang.t('indefinite');
        const visibility = absence.visible ? Lang.t('visibleToOtherAdmins') : Lang.t('onlyVisibleToYou');
        return `${period} · ${visibility}`;
    },

    // Wird eine abwesende Person einem Ticket zugewiesen/markiert, bekommen sowohl sie als auch ihre
    // Vertretung sofort einen Hinweis, damit nichts liegen bleibt, bis die Person zurück ist.
    notifyIfAbsentAssignee: async (ticket, username, actorUsername) => {
        if (!username || username === actorUsername) return;
        const users = await Store.getUsers();
        const person = users.find(u => u.username === username);
        if (!person?.absence?.active) return false;
        UI.toast(person.absence.substitute
            ? Lang.format('personCurrentlyAbsentSubstitute', { name: person.name || person.username, substitute: users.find(u => u.username === person.absence.substitute)?.name || person.absence.substitute })
            : Lang.format('personCurrentlyAbsentNoSubstitute', { name: person.name || person.username }));
        if (person.absence.substitute) {
            await Store.addNotifications([person.absence.substitute], ticket, Lang.format('absentPersonGotNewTicket', { name: person.name || person.username, title: ticket.title }), actorUsername, 'newTicket');
        }
        await Notifications.refresh();
        return true;
    },

    // Granulare Einzelrechte wie in der lokalen Version vom 07.10.2026: Superadmin darf immer
    // alles, ein normaler Admin nur, wenn ihm die jeweilige Zusatzfunktion im Benutzer-Editor
    // explizit zugewiesen wurde (users.ts permissions_json). War zwischenzeitlich auf "jeder
    // Admin darf alles" vereinfacht, weil das zugrunde liegende user.permissions-Objekt nie
    // existierte -- jetzt wieder echt, da permissions_json tatsächlich gespeichert wird.
    can: (user, key) => {
        if (!user) return false;
        if (user.role === 'superadmin') return true;
        if (key === 'kb') return ['read', 'edit'].includes(user.permissions?.kb);
        return !!user.permissions?.[key];
    },

    groupTopbarMenu: (user) => {
        const right = q('.topbar-right');
        if (!right || q('#topbar-admin-menu')) return;
        const items = ['btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings'].map(id => q(`#${id}`)).filter(Boolean);
        if (!items.length) return;
        const menu = document.createElement('details');
        menu.id = 'topbar-admin-menu';
        menu.className = 'topbar-menu';
        menu.innerHTML = `<summary class="btn-ghost">${Icon('layout-grid', 16)}Verwaltung</summary><div class="topbar-menu-body"></div>`;
        right.insertBefore(menu, items[0]);
        const body = menu.querySelector('.topbar-menu-body');
        items.forEach(item => body.appendChild(item));
        const extras = [
            ['btn-textblocks', 'message-square-plus', 'Textbausteine', 'textBlocks', () => AdminBoard.openTextBlocks()],
            ['btn-reports', 'chart-column', 'Auswertung', 'reports', () => AdminBoard.openReports()],
            ['btn-kb', 'book-open', 'Wissensdatenbank', 'kb', () => AdminBoard.openKnowledgeBase()],
            ['btn-recurring', 'repeat', 'Wiederkehrende Tickets', 'recurring', () => AdminBoard.openRecurring()]
        ];
        extras.filter(([, , , perm]) => AdminBoard.can(user, perm)).forEach(([id, icon, label, perm, handler]) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.type = 'button';
            btn.className = 'btn-ghost';
            if (perm === 'approvals') btn.dataset.module = 'approvals';
            btn.innerHTML = `${Icon(icon, 16)}${label}`;
            btn.onclick = handler;
            body.appendChild(btn);
        });
        body.addEventListener('click', e => { if (e.target.closest('button')) menu.open = false; });
        AdminBoard.bindTextBlockButton();
        if (window.lucide) lucide.createIcons();
    },

    openDialog: ({ id, title, icon = 'layout-grid', body, size = 'md', onSave = null, headerButtons = [] }) => {
        // headerButtons: weitere Kopf-Icons neben Speichern/Schließen, z. B. [{id, icon, title, onClick}] (Drucken, …)
        q(`#${id}`)?.remove();
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal modal-${size}">
                <div class="modal-header">
                    <h3>${Icon(icon, 18)}${Utils.esc(title)}</h3>
                    <div class="modal-actions">
                        ${headerButtons.map(b => `<button class="btn-ghost btn-icon" id="${Utils.esc(b.id)}" title="${Utils.esc(b.title)}" aria-label="${Utils.esc(b.title)}">${Icon(b.icon, 16)}</button>`).join('')}
                        ${onSave ? `<button class="btn-ghost btn-icon" data-dialog-save title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>` : ''}
                        <button class="btn-ghost btn-icon" data-dialog-close title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body">${body}</div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('[data-dialog-close]').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        if (onSave) modal.querySelector('[data-dialog-save]').onclick = () => onSave(modal);
        headerButtons.forEach(b => { if (b.onClick) modal.querySelector(`#${b.id}`).onclick = () => b.onClick(modal); });
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
        return modal;
    },

    insertTextAtCursor: (input, text) => {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + text + input.value.slice(end);
        input.focus();
        input.selectionStart = input.selectionEnd = start + text.length;
    },

    bindTextBlockButton: () => {
        const link = q('#m-chat-link');
        if (!link || q('#m-chat-blocks')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'm-chat-blocks';
        btn.className = 'btn-ghost btn-icon';
        btn.title = Lang.t('insertTextBlock');
        btn.setAttribute('aria-label', Lang.t('insertTextBlock'));
        btn.innerHTML = Icon('message-square-plus', 16);
        btn.onclick = () => AdminBoard.pickTextBlock('#m-chat-input');
        link.before(btn);
        if (window.lucide) lucide.createIcons();
    },

    openTextBlocks: async () => {
        const modal = AdminBoard.openDialog({
            id: 'textblocks-modal',
            title: Lang.t('textBlocks'),
            icon: 'message-square-plus',
            size: 'md',
            body: `
                <div class="field"><label for="tb-title">${Lang.t('titleLabel')}</label><input id="tb-title" type="text" placeholder="${Lang.t('egDeviceTypeQuery')}"></div>
                <div class="field"><label for="tb-text">${Lang.t('textLabel')}</label><textarea id="tb-text" rows="4" placeholder="${Lang.t('chatInsertTextPlaceholder')}"></textarea></div>
                <div class="setting-row"><span class="hint">${Lang.t('textBlocksAvailableHint')}</span>
                    <button class="btn-primary btn-sm" id="tb-add" type="button">${Icon('plus', 15)}${Lang.t('add')}</button>
                </div><button class="btn-secondary btn-sm" id="tb-cancel-edit" type="button" hidden>${Lang.t('cancel')}</button><input type="search" id="tb-search" class="section-search" placeholder="${Lang.t('search')}" aria-label="${Lang.t('search')}"><div id="tb-list"></div>`
        });
        let editingId = null;
        let blocks = [];
        const render = async () => {
            blocks = await Store.getTextBlocks();
            const list = blocks.filter(block => Utils.matchesSearch(modal.querySelector('#tb-search').value, block));
            modal.querySelector('#tb-list').innerHTML = list.length ? list.map(b => `
                <div class="absence-overview-row">
                    <div><strong>${Utils.esc(b.title)}</strong><span class="hint">${Utils.esc(b.text)}</span></div>
                    <div class="row-actions"><button class="btn-ghost btn-icon tb-edit" type="button" data-id="${Utils.esc(b.id)}" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button><button class="btn-ghost btn-icon btn-danger tb-del" type="button" data-id="${Utils.esc(b.id)}" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button></div>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noTextBlocksYet')}</div>`;
            UI.limitList(modal.querySelector('#tb-list'), { search: modal.querySelector('#tb-search'), total: blocks.length });
            modal.querySelectorAll('.tb-edit').forEach(button => button.onclick = () => {
                const block = blocks.find(item => item.id === button.dataset.id); editingId = block.id;
                modal.querySelector('#tb-title').value = block.title; modal.querySelector('#tb-text').value = block.text;
                modal.querySelector('#tb-add').textContent = Lang.t('save');
                modal.querySelector('#tb-cancel-edit').hidden = false; modal.querySelector('#tb-title').focus();
            });
            modal.querySelectorAll('.tb-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteTextBlock(btn.dataset.id);
                await render();
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#tb-add').onclick = async () => {
            const title = modal.querySelector('#tb-title').value.trim();
            const text = modal.querySelector('#tb-text').value.trim();
            if (!title || !text) return UI.toast(Lang.t('enterTitleAndText'));
            if (!(await (editingId ? Store.updateTextBlock(editingId, title, text) : Store.createTextBlock(title, text)))) return UI.toast(Lang.t('saveFailed'));
            modal.querySelector('#tb-title').value = '';
            modal.querySelector('#tb-text').value = '';
            editingId = null; modal.querySelector('#tb-cancel-edit').hidden = true; modal.querySelector('#tb-add').textContent = Lang.t('add');
            await render();
        };
        modal.querySelector('#tb-cancel-edit').onclick = () => { editingId = null; modal.querySelector('#tb-title').value = ''; modal.querySelector('#tb-text').value = ''; modal.querySelector('#tb-add').textContent = Lang.t('add'); modal.querySelector('#tb-cancel-edit').hidden = true; };
        modal.querySelector('#tb-search').oninput = () => render();
        await render();
    },

    pickTextBlock: async (inputSelector) => {
        const list = await Store.getTextBlocks();
        const modal = AdminBoard.openDialog({
            id: 'textblock-pick-modal',
            title: Lang.t('insertTextBlock'),
            icon: 'message-square',
            size: 'sm',
            body: list.length ? `${list.length > 5 ? `<input type="search" id="tb-pick-search" class="section-search" placeholder="${Lang.t('searchTextBlockPlaceholder')}">` : ''}<div class="checkbox-list" id="tb-pick-list">${list.map(b => `
                <button type="button" class="btn-secondary tb-pick" data-id="${Utils.esc(b.id)}" data-search="${Utils.esc(`${b.title} ${b.text}`.toLowerCase())}" class="justify-start w-full">${Utils.esc(b.title)}</button>`).join('')}</div>`
                : `<div class="empty-state compact">${Lang.t('noTextBlocksYetCreateHint')}</div>`
        });
        const search = modal.querySelector('#tb-pick-search');
        if (search) search.oninput = () => {
            const term = search.value.toLowerCase().trim();
            modal.querySelectorAll('.tb-pick').forEach(btn => { btn.hidden = !!term && !btn.dataset.search.includes(term); });
        };
        modal.querySelectorAll('.tb-pick').forEach(btn => btn.onclick = () => {
            const block = list.find(b => b.id === btn.dataset.id);
            const input = q(inputSelector);
            if (block && input) AdminBoard.insertTextAtCursor(input, block.text);
            modal.remove();
        });
    },

    openReports: async () => {
        const modal = AdminBoard.openDialog({
            id: 'reports-modal',
            title: 'Auswertung',
            icon: 'chart-column',
            size: 'lg',
            headerButtons: [{ id: 'rep-print', icon: 'printer', title: 'Drucken' }],
            body: `
                <div class="report-toolbar">
                    <div class="field"><label for="rep-range">Zeitraum</label>
                        <select id="rep-range"><option value="30">Letzte 30 Tage</option><option value="90">Letzte 90 Tage</option><option value="365">Letzte 12 Monate</option></select>
                    </div>
                    <div id="rep-personal-toggle"></div>
                </div>
                <div id="rep-body"></div>`
        });
        modal.querySelector('#rep-print').onclick = async () => {
            const html = modal.querySelector('#rep-body').innerHTML;
            const settings = await Store.getSettings();
            const company = settings.companyConfig || {};
            const companyLogo = company.logoUrl || settings.companyBrandingConfig?.logoDataUrl || '';
            const actor = await Store.currentUser();
            const rangeLabel = modal.querySelector('#rep-range').selectedOptions[0]?.textContent || '';
            UI.printHTML(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Auswertung</title>
                <link rel="stylesheet" href="/js/print.css"></head>
                <body>
                <div class="print-head">
                    <div>
                        <h1>${Utils.esc(company.name || 'Support Portal')} · Auswertung</h1>
                        <div class="meta">Zeitraum: ${Utils.esc(rangeLabel)} &middot; Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))}</div>
                    </div>
                    ${companyLogo ? `<img src="${Utils.esc(companyLogo)}" alt="Logo">` : ''}
                </div>
                ${html}</body></html>`);
        };
        const user = await Store.currentUser();
        const render = async () => {
            const range = Number(modal.querySelector('#rep-range').value);
            const settings = await Store.getSettings();
            const users = await Store.getUsers();
            const personalAllowed = settings.reportingConfig?.personal !== false;
            const since = Date.now() - range * 86400000;
            const all = await Store.getTickets();
            const created = all.filter(t => new Date(t.createdAt).getTime() >= since);
            // t.logs ist aus der Listenansicht absichtlich immer leer (siehe Store.mapApiTicketToLegacy
            // -- das echte Protokoll wird erst pro Ticket einzeln nachgeladen); die serverseitig
            // gesetzte closed_at-Spalte (tickets.ts PATCH-Handler) liefert den Zeitpunkt stattdessen direkt.
            const closedAt = t => t.closedAt ? new Date(t.closedAt).getTime() : null;
            // Eigener, schlanker Endpunkt statt t.chat/t.comments (dort immer [], siehe oben) --
            // vorher lieferte "Erste Antwortzeit" dadurch immer "–", egal wie viele Tickets
            // tatsächlich beantwortet wurden.
            const firstResponseMap = await Store.getFirstResponseTimes(new Date(since).toISOString());
            const firstResponse = t => {
                const respondedAt = firstResponseMap[t.id];
                if (!respondedAt) return null;
                return new Date(respondedAt).getTime() - new Date(t.createdAt).getTime();
            };
            const closed = all.map(t => ({ t, c: closedAt(t) })).filter(x => x.c && x.c >= since);
            const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            const fmtDuration = ms => ms == null ? '–' : ms >= 86400000 ? `${(ms / 86400000).toFixed(1)} Tg.` : `${(ms / 3600000).toFixed(1)} Std.`;
            const responses = created.map(firstResponse).filter(v => v != null);
            const resolutions = closed.map(x => x.c - new Date(x.t.createdAt).getTime());
            const withDue = closed.map(x => ({ ...x, due: Store.ticketSlaDueAt(x.t, settings) })).filter(x => x.due);
            const dueMet = withDue.length ? Math.round(100 * withDue.filter(x => x.c <= x.due).length / withDue.length) : null;
            const byCategory = {};
            created.forEach(t => (Array.isArray(t.category) ? t.category : [t.category || '–']).forEach(c => { byCategory[c] = (byCategory[c] || 0) + 1; }));
            const byStatus = {};
            created.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

            modal.querySelector('#rep-personal-toggle').innerHTML = user?.role === 'superadmin'
                ? `<label class="check-row compact"><input type="checkbox" id="rep-personal" ${personalAllowed ? 'checked' : ''}><span>Personenbezogene Auswertung erlauben</span></label>`
                : '';
            const toggle = modal.querySelector('#rep-personal');
            if (toggle) toggle.onchange = async () => {
                const s = await Store.getSettings();
                s.reportingConfig = { ...(s.reportingConfig || {}), personal: toggle.checked };
                await Store.saveSettings(s);
                render();
            };

            let personal = '';
            if (personalAllowed) {
                const admins = users.filter(u => u.role === 'admin' || u.role === 'superadmin');
                personal = `<h4 class="section-title">${Lang.t('perEmployee')}</h4><table class="list-view-table"><thead><tr><th>${Lang.t('name')}</th><th>${Lang.t('ticketsResponsible')}</th><th>${Lang.t('statusClosed')}</th><th>${Lang.t('avgFirstResponse')}</th></tr></thead><tbody>${admins.map(a => {
                    const owned = created.filter(t => t.owner === a.username);
                    const ownedClosed = closed.filter(x => x.t.owner === a.username).length;
                    const responseTimes = owned.map(firstResponse).filter(v => v != null);
                    return `<tr><td>${Utils.esc(a.name || a.username)}</td><td>${owned.length}</td><td>${ownedClosed}</td><td>${fmtDuration(avg(responseTimes))}</td></tr>`;
                }).join('')}</tbody></table>`;
            }
            const kpi = (label, value) => `<div class="report-kpi"><span>${Utils.esc(label)}</span><strong>${Utils.esc(String(value))}</strong></div>`;
            modal.querySelector('#rep-body').innerHTML = `
                <div class="report-kpis">
                    ${kpi(Lang.t('ticketsCreated'), created.length)}
                    ${kpi(Lang.t('statusClosed'), closed.length)}
                    ${kpi(Lang.t('avgFirstResponse'), fmtDuration(avg(responses)))}
                    ${kpi(Lang.t('avgResolutionTime'), fmtDuration(avg(resolutions)))}
                    ${kpi(Lang.t('deadlinesMet'), dueMet == null ? '–' : dueMet + ' %')}
                </div>
                <h4 class="section-title">${Lang.t('byStatus')}</h4>
                <div class="report-list">${Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="report-row"><span>${Utils.esc(Lang.status(k))}</span><strong>${v}</strong></div>`).join('') || `<div class="empty-state compact">${Lang.t('noData')}</div>`}</div>
                <h4 class="section-title">${Lang.t('byCategory')}</h4>
                <div class="report-list">${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="report-row"><span>${Utils.esc(k)}</span><strong>${v}</strong></div>`).join('') || `<div class="empty-state compact">${Lang.t('noData')}</div>`}</div>
                ${personal}`;
        };
        modal.querySelector('#rep-range').onchange = render;
        await render();
    },

    openKnowledgeBase: () => KbSearch.open(),

    // Zugeordnete Wissensdatenbank-Loesungen im Tab "Loesungsdokumentation" (nur mit Leserecht).
    renderKbLinks: async (ticketId) => {
        const box = q('#m-kb-links');
        if (!box) return;
        const { canRead } = await KbSearch.access();
        box.hidden = !canRead;
        if (!canRead) return;
        const [tickets, links] = await Promise.all([Store.getTickets(), Store.getTicketKbLinks(ticketId)]);
        if (AdminBoard.currentTicketId !== ticketId) return;
        const ticket = tickets.find(t => t.id === ticketId);
        const locked = !ticket || !!ticket.archived;
        const list = q('#m-kb-links-list');
        list.innerHTML = links.length ? links.map(link => `
            <span class="file-chip kb-link-chip">
                <button type="button" class="kb-link-open" data-id="${Utils.esc(link.articleId)}" title="${Utils.esc(Lang.t('kbOpenSolution'))}">${Icon('lightbulb', 13)}<span>${Utils.esc(link.title)}</span></button>
                ${locked ? '' : `<button type="button" class="btn-ghost btn-icon btn-xs btn-danger kb-link-remove" data-id="${Utils.esc(link.articleId)}" title="${Utils.esc(Lang.t('kbUnlink'))}" aria-label="${Utils.esc(Lang.t('kbUnlink'))}">${Icon('x', 13)}</button>`}
            </span>`).join('') : `<span class="hint">${Utils.esc(Lang.t('kbNoLinkedSolutions'))}</span>`;
        const add = q('#m-kb-link-add');
        add.hidden = locked;
        add.onclick = () => KbSearch.pickArticles({ ticket, linkedIds: links.map(link => link.articleId), onDone: () => AdminBoard.renderKbLinks(ticketId) });
        list.querySelectorAll('.kb-link-open').forEach(btn => btn.onclick = async () => {
            const article = (await Store.getKbArticles()).find(a => a.id === btn.dataset.id);
            if (!article) return UI.toast(Lang.t('kbArticleMissing'));
            const { canEdit } = await KbSearch.access();
            KbSearch.openArticle(article, { canEdit, ticket: locked ? null : ticket, categories: await Store.getKbCategories(), onChange: () => AdminBoard.renderKbLinks(ticketId) });
        });
        list.querySelectorAll('.kb-link-remove').forEach(btn => btn.onclick = () => UI.confirm(Lang.t('kbConfirmUnlink'), async () => {
            if (!(await Store.unlinkKbArticle(ticketId, btn.dataset.id))) return UI.toast(Lang.t('saveFailed'));
            AdminBoard.renderKbLinks(ticketId);
        }));
        if (window.lucide) lucide.createIcons();
    },

    // t.comments existiert nicht mehr lokal (immer [], siehe mapApiTicketToLegacy) -- vorher
    // fand dieser Knopf dadurch NIE einen Lösungsweg und meldete immer "gibt noch keinen
    // Lösungsweg", selbst wenn einer dokumentiert war. Lädt die echten Notizen jetzt frisch.
    // Loesungsdokumentation als Wissensartikel: oeffnet den Editor vorbefuellt und gegliedert wie im
    // Ticket (Ursache, durchgefuehrte Massnahmen, Loesung, weitere Eintraege), damit vor dem Speichern
    // bearbeitet werden kann. Vorher wurde der Rohtext aller Eintraege ohne Gliederung sofort
    // gespeichert. Der neue Artikel wird dem Ticket direkt zugeordnet.
    addSolutionToKnowledgeBase: async (t) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/notes`, { credentials: 'same-origin' }).catch(() => null);
        const notes = res && res.ok ? (await res.json()).notes || [] : [];
        const solution = notes.filter(n => n.stream === 'solution' && (n.content || '').trim())
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (!solution.length) return UI.toast(Lang.t('noSolutionYetInTicket'));
        const known = ['Ursache', 'Maßnahme', 'Lösung'];
        const sections = [
            { title: Lang.t('noteTypeCause'), entries: solution.filter(n => !n.is_resolution && n.note_type === 'Ursache') },
            { title: Lang.t('solutionGroupMeasures'), entries: solution.filter(n => !n.is_resolution && n.note_type === 'Maßnahme'), numbered: true },
            { title: Lang.t('noteTypeSolution'), entries: solution.filter(n => n.is_resolution || n.note_type === 'Lösung') },
            { title: Lang.t('solutionGroupOther'), entries: solution.filter(n => !n.is_resolution && !known.includes(n.note_type)) }
        ].filter(section => section.entries.length);
        const html = value => Utils.renderMarkdown(value || '');
        // Ueberschriften als fette Absaetze: der Editor erlaubt keine h-Elemente (sanitizeRichHtml).
        const body = sections.map(section => `<p><strong>${Utils.esc(section.title)}</strong></p>${section.numbered
            ? `<ol>${section.entries.map(n => `<li>${html(n.content)}</li>`).join('')}</ol>`
            : section.entries.map(n => `<div>${html(n.content)}</div>`).join('')}`).join('');
        const category = (Array.isArray(t.category) ? t.category[0] : t.category) || null;
        await KbSearch.openEditor({
            draft: { title: t.title, body, category },
            sourceTicketId: t.id,
            onSaved: () => AdminBoard.renderKbLinks(t.id)
        });
    },

    // Ausführung l&auml;uft serverseitig per Timer (jobs/maintenance.ts runRecurringTickets),
    // next_run_at wird dort nach jedem Lauf automatisch weitergerechnet -- kein Client-Trigger
    // und kein "Tag im Monat/Wochentag"-Modell mehr, sondern ein konkreter Start-Zeitpunkt.
    openRecurring: async () => {
        const settings = await Store.getSettings();
        const categories = settings.categories || ['Allgemein'];
        // Werte bleiben die deutschen Prioritaetsnamen (Server-Enum), nur die Beschriftung wird uebersetzt.
        const priorities = [['Niedrig', 'low'], ['Normal', 'normal'], ['Hoch', 'high'], ['Kritisch', 'critical']];
        const modal = AdminBoard.openDialog({
            id: 'recurring-modal',
            title: Lang.t('recurringTickets'),
            icon: 'repeat',
            size: 'md',
            body: `
                <div class="recurring-form">
                    <div class="field"><label for="rec-title">${Lang.t('subject')}</label><input id="rec-title" type="text" placeholder="${Lang.t('egCheckBackup')}"></div>
                    <div class="field"><label for="rec-desc">${Lang.t('description')}</label><textarea id="rec-desc" rows="3"></textarea></div>
                    <div class="form-grid">
                        <div class="field"><label for="rec-cat">${Lang.t('category')}</label><select id="rec-cat">${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}</select></div>
                        <div class="field"><label for="rec-prio">${Lang.t('priority')}</label><select id="rec-prio">${priorities.map(([value, key]) => `<option value="${value}"${value === 'Normal' ? ' selected' : ''}>${Lang.t(key)}</option>`).join('')}</select></div>
                        <div class="field"><label for="rec-interval">${Lang.t('unit')}</label><select id="rec-interval"><option value="day">${Lang.t('days')}</option><option value="week" selected>${Lang.t('weeks')}</option><option value="month">${Lang.t('months')}</option></select></div>
                        <div class="field"><label for="rec-count">${Lang.t('everyHowManyUnits')}</label><input id="rec-count" type="number" min="1" max="365" value="1"></div>
                    </div>
                    <div class="field"><label>${Lang.t('firstRun')}</label>${UI.dateTimePickerMarkup('rec-next-run')}</div>
                    <div class="setting-row"><span class="hint">${Lang.t('firstTicketAutoCreatedHint')}</span>
                        <span class="row-actions">
                            <button class="btn-secondary btn-sm" id="rec-cancel-edit" type="button" hidden>${Lang.t('cancel')}</button>
                            <button class="btn-primary btn-sm" id="rec-add" type="button">${Icon('plus', 15)}${Lang.t('add')}</button>
                        </span>
                    </div>
                </div>
                <div class="recurring-list-head">
                    <div class="settings-section-title">${Lang.t('plannedRecurringTickets')} <span class="badge" id="rec-total">0</span></div>
                    <input type="search" id="rec-search" class="section-search" placeholder="${Lang.t('search')}" aria-label="${Lang.t('search')}">
                </div>
                <div id="rec-list"></div>`
        });
        const picker = UI.createDateTimePicker(modal.querySelector('#rec-next-run'), { value: Date.now() });
        const unitLabel = { day: Lang.t('days'), week: Lang.t('weeks'), month: Lang.t('months'), year: Lang.t('years') };
        const prioLabel = Object.fromEntries(priorities.map(([value, key]) => [value, Lang.t(key)]));
        const search = modal.querySelector('#rec-search');
        const addBtn = modal.querySelector('#rec-add');
        const cancelBtn = modal.querySelector('#rec-cancel-edit');
        let rules = [];
        let editingId = null;
        const resetForm = () => {
            editingId = null;
            modal.querySelector('#rec-title').value = '';
            modal.querySelector('#rec-desc').value = '';
            modal.querySelector('#rec-prio').value = 'Normal';
            modal.querySelector('#rec-interval').value = 'week';
            modal.querySelector('#rec-count').value = '1';
            picker.setValue(Date.now());
            addBtn.innerHTML = `${Icon('plus', 15)}${Lang.t('add')}`;
            cancelBtn.hidden = true;
            modal.querySelectorAll('#rec-list .is-editing').forEach(row => row.classList.remove('is-editing'));
            if (window.lucide) lucide.createIcons();
        };
        const startEdit = (rule) => {
            editingId = rule.id;
            modal.querySelector('#rec-title').value = rule.title || '';
            modal.querySelector('#rec-desc').value = rule.desc || '';
            const cat = modal.querySelector('#rec-cat');
            if (rule.category && ![...cat.options].some(option => option.value === rule.category)) cat.add(new Option(rule.category, rule.category));
            cat.value = rule.category || cat.options[0]?.value || '';
            modal.querySelector('#rec-prio').value = rule.prio || 'Normal';
            modal.querySelector('#rec-interval').value = rule.intervalUnit || 'week';
            modal.querySelector('#rec-count').value = String(rule.intervalCount || 1);
            picker.setValue(rule.nextRunAt ? new Date(rule.nextRunAt).getTime() : Date.now());
            addBtn.innerHTML = `${Icon('save', 15)}${Lang.t('save')}`;
            cancelBtn.hidden = false;
            modal.querySelectorAll('#rec-list .absence-overview-row').forEach(row => row.classList.toggle('is-editing', row.dataset.id === rule.id));
            if (window.lucide) lucide.createIcons();
            modal.querySelector('#rec-title').focus();
        };
        const render = async () => {
            rules = await Store.getRecurringRules();
            modal.querySelector('#rec-total').textContent = String(rules.length);
            const list = rules.filter(rule => Utils.matchesSearch(search.value, rule));
            modal.querySelector('#rec-list').innerHTML = list.length ? list.map(r => `
                <div class="absence-overview-row${r.id === editingId ? ' is-editing' : ''}" data-id="${Utils.esc(r.id)}">
                    <div><strong>${Utils.esc(r.title)}</strong><span class="hint">${Lang.format('recurringRuleSummary', { count: r.intervalCount, unit: unitLabel[r.intervalUnit] || r.intervalUnit, date: Utils.fmtDate(r.nextRunAt), category: Utils.esc(r.category || '-'), prio: Utils.esc(prioLabel[r.prio] || r.prio) })}${r.active ? '' : ' · ' + Lang.t('paused')}</span></div>
                    <div class="row-actions">
                        <button class="btn-ghost btn-icon rec-edit" type="button" data-id="${Utils.esc(r.id)}" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger rec-del" type="button" data-id="${Utils.esc(r.id)}" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t(search.value ? 'noMatches' : 'noRecurringTickets')}</div>`;
            UI.limitList(modal.querySelector('#rec-list'), { search, total: rules.length });
            modal.querySelectorAll('.rec-edit').forEach(btn => btn.onclick = () => startEdit(rules.find(rule => rule.id === btn.dataset.id)));
            modal.querySelectorAll('.rec-del').forEach(btn => btn.onclick = () => UI.confirm(Lang.t('confirmDeleteRecurring'), async () => {
                if (!(await Store.deleteRecurringRule(btn.dataset.id))) return UI.toast(Lang.t('saveFailed'));
                if (editingId === btn.dataset.id) resetForm();
                await render();
            }));
            if (window.lucide) lucide.createIcons();
        };
        search.oninput = () => render();
        cancelBtn.onclick = resetForm;
        addBtn.onclick = async () => {
            const title = modal.querySelector('#rec-title').value.trim();
            if (!title) return UI.toast(Lang.t('enterASubject'));
            let nextRunMs;
            try { nextRunMs = picker.getValue() || Date.now(); } catch (error) { return UI.toast(error.message); }
            const data = {
                title,
                desc: modal.querySelector('#rec-desc').value.trim(),
                category: modal.querySelector('#rec-cat').value,
                prio: modal.querySelector('#rec-prio').value,
                intervalUnit: modal.querySelector('#rec-interval').value,
                intervalCount: Math.min(365, Math.max(1, parseInt(modal.querySelector('#rec-count').value, 10) || 1)),
                nextRunAt: new Date(nextRunMs).toISOString()
            };
            const ok = editingId ? await Store.updateRecurringRule(editingId, data) : await Store.createRecurringRule(data);
            if (!ok) return UI.toast(Lang.t('saveFailed'));
            UI.toast(Lang.t(editingId ? 'recurringSaved' : 'recurringCreated'));
            resetForm();
            await render();
        };
        await render();
    },

    // Entscheidet eine ausstehende Genehmigung (freigeben/ablehnen) - genutzt von der Genehmigungs-Übersicht
    // und direkt aus dem Ticket heraus, falls die aktuell angemeldete Person selbst genehmigen darf.
    // Öffnet ein Ticket unabhängig davon, ob gerade das Admin-Board oder das Benutzer-Dashboard
    // geladen ist (z. B. aus der Genehmigungsansicht, die beide Seiten erreichen können).
    openTicketForCurrentPage: async (id) => {
        if (q('#ticket-modal')) await AdminBoard.openModal(id);
        else if (q('#u-ticket-modal')) await UserDash.openModal(id);
    },

    // approval_status/approval_reviewer_id/... sind keine flachen Store.saveTickets-Felder --
    // Entscheidung l&auml;uft direkt über den dedizierten Endpunkt, der auch die Prüfer-Autorisierung
    // (IDOR-Schutz: nur die eingetragene Person oder Superadmin) serverseitig durchsetzt.
    decideApproval: async (ticketId, status, reason) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticketId)}/approval-decision`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ decision: status, reason: reason || undefined })
        }).catch(() => null);
        if (!res || !res.ok) {
            UI.toast(res && res.status === 403 ? Lang.t('noPermissionForDecision') : Lang.t('decisionFailed'));
            return false;
        }
        Store._ticketsCache = null;
        await Notifications.refresh();
        await UserDash.refreshApprovalBadge();
        if (q('#user-tickets')) await UserDash.renderList();
        return true;
    },

    // Offene Genehmigungen der angemeldeten Person (jede Rolle) -- eigener Endpunkt: er liefert nur,
    // was fuer die Entscheidung noetig ist, und ob das volle Ticket geoeffnet werden darf.
    openApprovals: async () => {
        if (Store.modules.approvals === false) return;
        const settings = await Store.getSettings();
        const modal = AdminBoard.openDialog({ id: 'approvals-modal', title: Lang.t('approvals'), icon: 'badge-check', size: 'lg', body: '<div id="apr-list"></div>' });
        const render = async () => {
            const approvals = await Store.getPendingApprovals();
            const box = modal.querySelector('#apr-list');
            box.innerHTML = approvals.length ? approvals.map(a => `
                <details class="kb-article apr-row" open data-id="${Utils.esc(a.ticket_id)}">
                    <summary>
                        <strong>${Utils.esc(a.ticket_number || a.ticket_id)} · ${Utils.esc(a.title)}</strong>
                        <span class="hint">${Utils.esc(Lang.format('requestedBy', { name: a.requested_by || '-' }))}${a.requested_at ? ` · ${Utils.esc(Utils.fmtDate(a.requested_at))}` : ''}</span>
                    </summary>
                    ${a.request_text ? `<div class="approval-request-text"><strong>${Utils.esc(Lang.t('approvalRequestText'))}</strong><p>${Utils.esc(a.request_text)}</p></div>` : ''}
                    <div class="meta-grid">
                        <div class="meta-item"><strong>${Lang.t('priority')}</strong><span class="meta-value">${Utils.esc(Lang.prio(a.priority))}</span></div>
                        <div class="meta-item"><strong>${Lang.t('category')}</strong><span class="meta-value">${Utils.esc(a.category || '-')}</span></div>
                        <div class="meta-item"><strong>${Lang.t('approvalTicketAuthor')}</strong><span class="meta-value">${Utils.esc(a.author || '-')}</span></div>
                    </div>
                    <h4 class="section-title">${Lang.t('description')}</h4>
                    <p class="desc-text">${Utils.esc(a.description || '-')}</p>
                    <div class="apr-fields"></div>
                    ${(a.attachments || []).length ? `<div class="file-preview apr-attachments">${a.attachments.map(file => `<button type="button" class="file-chip apr-att" data-id="${Utils.esc(file.id)}" data-name="${Utils.esc(file.name)}" data-size="${Number(file.size) || 0}">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span></button>`).join('')}</div>` : ''}
                    <div class="field approval-comment"><label>${Lang.t('decisionCommentLabel')}</label><textarea class="apr-comment" rows="3" maxlength="5000" placeholder="${Lang.t('decisionCommentPlaceholder')}"></textarea></div>
                    ${a.can_open ? '' : `<p class="hint">${Utils.esc(Lang.t('approvalNoTicketAccess'))}</p>`}
                    <div class="aa-actions">
                        ${a.can_open ? `<button class="btn-secondary btn-sm apr-open" type="button">${Icon('external-link', 14)}${Lang.t('openTicket')}</button>` : ''}
                        <button class="btn-primary btn-sm apr-yes" type="button">${Icon('check', 14)}${Lang.t('approve')}</button>
                        <button class="btn-secondary btn-sm btn-danger apr-no" type="button">${Icon('x', 14)}${Lang.t('decline')}</button>
                    </div></details>`).join('') : `<div class="empty-state compact">${Lang.t('noOpenApprovalsHint')}</div>`;
            box.querySelectorAll('.apr-row').forEach(row => {
                const a = approvals.find(x => x.ticket_id === row.dataset.id);
                let values = {};
                try { values = a.custom_fields_json ? JSON.parse(a.custom_fields_json) : {}; } catch { values = {}; }
                const fields = Store.getCustomFieldsForCategories(a.category ? [a.category] : [], settings.customFields || {});
                if (fields.length) UI.renderCustomFieldsDisplay(row.querySelector('.apr-fields'), fields, values);
                row.querySelectorAll('.apr-att').forEach(btn => btn.onclick = () =>
                    AdminBoard.openAttachmentPreview({ attachmentId: btn.dataset.id, name: btn.dataset.name, size: Number(btn.dataset.size) || 0 }));
                const open = row.querySelector('.apr-open');
                if (open) open.onclick = async () => {
                    modal.remove();
                    await AdminBoard.openTicketForCurrentPage(a.ticket_id);
                };
                const decide = async (status, reason) => {
                    if (!(await AdminBoard.decideApproval(a.ticket_id, status, reason))) return;
                    UI.toast(Lang.t(status === 'approved' ? 'approvalGrantedToast' : 'approvalDeclinedToast'));
                    await render();
                    if (q('.kanban-board')) await AdminBoard.render();
                };
                row.querySelector('.apr-yes').onclick = () => decide('approved', row.querySelector('.apr-comment').value.trim());
                row.querySelector('.apr-no').onclick = async () => {
                    const reason = row.querySelector('.apr-comment').value.trim();
                    if (!reason) return UI.toast(Lang.t('enterAReason'));
                    await decide('rejected', reason);
                };
            });
            if (window.lucide) lucide.createIcons();
        };
        await render();
    },

    // Genehmigungsverlauf eines Tickets: Anfrage (wer, bei wem, Begruendung) und Entscheidung
    // (genehmigt/abgelehnt, von wem, Kommentar). Liefert die Eintraege (neueste zuerst).
    renderApprovalHistory: async (ticket, selector) => {
        const box = q(selector);
        if (!box) return [];
        const history = Store.modules.approvals === false ? [] : await Store.getTicketApprovals(ticket.id);
        box.hidden = !history.length;
        const status = {
            pending: ['approvalStatusPending', 'hourglass'],
            approved: ['approvalStatusApproved', 'circle-check'],
            rejected: ['approvalStatusRejected', 'circle-x']
        };
        box.innerHTML = history.length ? `
            <h4 class="section-title">${Icon('badge-check', 15)}${Utils.esc(Lang.t('approvalHistory'))}</h4>
            <ol class="approval-history-list">${history.map(entry => {
                const [labelKey, icon] = status[entry.status] || status.pending;
                return `<li class="approval-entry is-${Utils.esc(entry.status)}">
                    <div class="approval-entry-head">
                        <span class="approval-status-pill is-${Utils.esc(entry.status)}">${Icon(icon, 13)}${Utils.esc(Lang.t(labelKey))}</span>
                        <span class="hint">${Utils.esc(Lang.format('approvalRequestedLine', { by: entry.requested_by || '-', approver: entry.approver || '-', date: Utils.fmtDate(entry.requested_at) }))}</span>
                    </div>
                    ${entry.request_text ? `<div class="approval-text"><strong>${Utils.esc(Lang.t('approvalRequestText'))}</strong><p>${Utils.esc(entry.request_text)}</p></div>` : ''}
                    ${entry.decided_at && entry.status !== 'pending' ? `<p class="hint">${Utils.esc(Lang.format('approvalDecidedLine', { by: entry.decided_by || entry.approver || '-', date: Utils.fmtDate(entry.decided_at) }))}</p>` : ''}
                    ${entry.decision_text ? `<div class="approval-text"><strong>${Utils.esc(Lang.t('approvalDecisionText'))}</strong><p>${Utils.esc(entry.decision_text)}</p></div>` : ''}
                </li>`;
            }).join('')}</ol>` : '';
        if (window.lucide) lucide.createIcons();
        return history;
    },

    // Pruefen darf jedes aktive Konto (auch normale Benutzer, z.B. Vorgesetzte) -- nicht die eigene
    // Person und nicht das erstellende Konto. Normale Konten sehen dabei nur die Angaben zur
    // Genehmigung, nicht das ganze Ticket (siehe GET /api/v2/approvals).
    requestApproval: async (t) => {
        const me = await Store.currentUser();
        const approvers = (await Store.getUsers())
            .filter(u => u.id !== me.id && u.id !== t.authorUserId && !u.accountArchived)
            .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, Lang.current === 'en' ? 'en' : 'de'));
        if (!approvers.length) return UI.toast(Lang.t('noOtherApproversAvailable'));
        const modal = AdminBoard.openDialog({
            id: 'approval-request-modal',
            title: Lang.t('requestApprovalTitle'),
            icon: 'badge-check',
            size: 'sm',
            body: `<div class="field"><label>${Lang.t('approvingPerson')}</label><div id="apr-approver"></div><p class="hint">${Lang.t('approverAnyAccountHint')}</p></div>
                   <div class="field"><label for="apr-note">${Lang.t('noteLabel')}</label><textarea id="apr-note" rows="3" maxlength="5000" placeholder="${Lang.t('whatShouldBeApprovedPlaceholder')}"></textarea></div>`,
            onSave: async (m) => {
                const approverId = approverPicker.getValue();
                const note = m.querySelector('#apr-note').value.trim();
                if (!approverId) return UI.toast(Lang.t('selectApprovingPerson'));
                const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/request-approval`, {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ approver_user_id: approverId, text: note || undefined })
                }).catch(() => null);
                if (!res || !res.ok) return UI.toast(Lang.t('requestApprovalFailed'));
                Store._ticketsCache = null;
                await Notifications.refresh();
                m.remove();
                UI.toast(Lang.t('approvalRequestedToast'));
                await AdminBoard.openModal(t.id);
                await AdminBoard.render();
            }
        });
        const roleLabel = u => u.role === 'user' ? '' : ` · ${u.role === 'superadmin' ? 'Superadmin' : 'Admin'}`;
        const owner = (await Store.getUsers()).find(u => u.username === t.author);
        const preselect = (owner?.supervisor && approvers.some(u => u.username === owner.supervisor))
            ? approvers.find(u => u.username === owner.supervisor)?.id
            : (approvers.find(u => u.id === owner?.supervisorUserId)?.id || '');
        const approverPicker = UI.createMultiSelect(modal.querySelector('#apr-approver'), approvers.map(u => ({ value: u.id, label: `${u.name || u.username}${roleLabel(u)}` })), preselect, null, { single: true, emptyLabel: Lang.t('pleaseChoose') });
        return modal;
    },

    linkRelatedTicket: async (t) => {
        const all = await Store.getTickets();
        const existingRelatedIds = await Store.getRelatedTicketIds(t.id);
        const modal = AdminBoard.openDialog({
            id: 'related-modal',
            title: Lang.t('linkRelatedTicketTitle'),
            icon: 'link',
            size: 'md',
            body: `<input type="search" id="rel-search" class="section-search" placeholder="${Lang.t('searchTicketNoTitle')}">
                   <label class="check-row compact mt-2"><input type="checkbox" id="rel-show-archived"><span>${Lang.t('showClosedArchivedAlso')}</span></label>
                   <div class="checkbox-list mt-3" id="rel-list"></div>`,
            onSave: async (m) => {
                const ids = [...m.querySelectorAll('input[type="checkbox"].rel-pick:checked')].map(cb => cb.value);
                if (!ids.length) return UI.toast(Lang.t('selectAtLeastOneTicket'));
                const results = await Promise.all(ids.map(id => Store.linkRelatedTicketIds(t.id, id)));
                m.remove();
                UI.toast(results.every(Boolean) ? Lang.t('linkedToast') : Lang.t('linkPartiallyFailedToast'));
                await AdminBoard.openModal(t.id);
            }
        });
        const list = modal.querySelector('#rel-list');
        const renderList = () => {
            const showArchived = modal.querySelector('#rel-show-archived').checked;
            const candidates = all.filter(x => x.id !== t.id && (showArchived || !x.archived) && !existingRelatedIds.includes(x.id));
            list.innerHTML = candidates.map(x => `
                <label class="check-row" data-search="${Utils.esc(`${x.ticketNumber || ''} ${x.title}`.toLowerCase())}"><input type="checkbox" class="rel-pick" value="${Utils.esc(x.id)}">
                    <span class="check-text"><strong>${Utils.esc(x.ticketNumber || x.id)} · ${Utils.esc(x.title)}</strong>${x.archived ? ' <span class="hint">(archiviert)</span>' : ''}</span></label>`).join('')
                || '<div class="empty-state compact">Keine Tickets gefunden.</div>';
            const term = modal.querySelector('#rel-search').value.toLowerCase().trim();
            list.querySelectorAll('.check-row').forEach(row => { row.hidden = !!term && !row.dataset.search.includes(term); });
        };
        modal.querySelector('#rel-search').oninput = renderList;
        modal.querySelector('#rel-show-archived').onchange = renderList;
        renderList();
    },

    mergeTicketInto: async (t) => {
        const all = await Store.getTickets();
        const modal = AdminBoard.openDialog({
            id: 'merge-modal',
            title: Lang.t('mergeTicketsTitle'),
            icon: 'git-merge',
            size: 'md',
            body: `<p class="hint">${Lang.format('mergeTicketsHint', { number: Utils.esc(t.ticketNumber || t.id) })}</p>
                   <label class="check-row compact"><input type="checkbox" id="merge-show-archived"><span>${Lang.t('showClosedArchivedAlso')}</span></label>
                   <div class="field"><label>${Lang.t('targetTicket')}</label><div id="merge-target"></div></div>`,
            onSave: async (m) => {
                const targetId = mergeTargetPicker.getValue();
                if (!targetId) return UI.toast(Lang.t('selectTargetTicket'));
                if (!(await Store.mergeTickets(t.id, targetId))) return UI.toast(Lang.t('mergeFailed'));
                m.remove();
                UI.toast(Lang.t('ticketsMergedToast'));
                await AdminBoard.render();
            }
        });
        let mergeTargetPicker;
        const renderTargetPicker = () => {
            const showArchived = modal.querySelector('#merge-show-archived').checked;
            const candidates = all.filter(x => x.id !== t.id && (showArchived || !x.archived));
            const current = mergeTargetPicker?.getValue();
            mergeTargetPicker = UI.createMultiSelect(modal.querySelector('#merge-target'), candidates.map(x => ({ value: x.id, label: `${x.ticketNumber || x.id} · ${x.title}${x.archived ? Lang.t('archivedParenthetical') : ''}` })), current && candidates.some(c => c.id === current) ? current : '', null, { single: true, emptyLabel: Lang.t('pleaseChoose') });
        };
        modal.querySelector('#merge-show-archived').onchange = renderTargetPicker;
        renderTargetPicker();
        return modal;
    },

    renderSubstituteNotice: n => {
        const [lead, ...rest] = String(n.message || '').split('\n');
        const sectionList = n.sections || AdminBoard.sectionsFromMessage(n.message);
        const sections = sectionList.map(section => `
            <section class="substitute-section">
                <h4>${Utils.esc(section.title)}</h4>
                <ul class="substitute-list">
                    ${section.items.map(item => `
                        <li${section.checklist ? ' class="is-check"' : ''}>
                            ${section.checklist ? Icon('square', 14) : ''}
                            <span class="substitute-ticket">${Utils.esc(item.ticket)}</span>
                            <span>${Utils.esc(item.text)}</span>
                        </li>`).join('')}
                </ul>
            </section>`).join('');
        return `
            <div class="substitute-notice">
                <p class="substitute-lead">${Utils.esc(lead)}</p>
                ${sections || rest.map(line => `<p class="substitute-line">${Utils.esc(line)}</p>`).join('')}
            </div>`;
    },

    openSubstituteNoticePopups: async (user) => {
        if (!user) return;
        const all = await Store.getNotifications();
        const pending = all.filter(n => n.recipientUserId === user.id && n.type === 'absence' && !n.read);
        q('#substitute-popup')?.remove();
        if (!pending.length) return;
        const users = await Store.getUsers();
        const absentUsers = users.filter(u => u.absence && (u.absence.active || u.absence.pending) && u.absence.substitute === user.username);
        const nameOf = u => u.name || u.username;
        const belongs = (n, u) => n.absentUsername
            ? n.absentUsername === u.username
            : (n.message || '').startsWith(`${nameOf(u)} hat dich`) || (n.title || '').startsWith(`${nameOf(u)} ·`);
        const groups = absentUsers.map(u => ({ user: u, items: pending.filter(n => belongs(n, u)) }));
        const orphans = pending.filter(n => !groups.some(g => g.items.includes(n)));
        if (orphans.length || !groups.length) groups.push({ user: null, items: orphans.length ? orphans : pending });
        const panel = g => `
            ${g.user ? `<div class="substitute-absence"><span>${Utils.esc(nameOf(g.user))} ist abwesend: ${Utils.esc(AdminBoard.absenceInfoText(g.user.absence))}</span></div>` : ''}
            ${g.items.map(AdminBoard.renderSubstituteNotice).join('')}`;
        const body = groups.length > 1
            ? `<div class="tabs substitute-tabs">${groups.map((g, i) => `<button type="button" class="tab-btn${i === 0 ? ' active' : ''}" data-idx="${i}">${Utils.esc(g.user ? nameOf(g.user) : 'Weitere')}</button>`).join('')}</div>
               ${groups.map((g, i) => `<div class="substitute-panel" data-idx="${i}"${i ? ' hidden' : ''}>${panel(g)}</div>`).join('')}`
            : panel(groups[0]);
        const modal = document.createElement('div');
        modal.id = 'substitute-popup';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md substitute-popup">
                <div class="modal-header">
                    <h3>${Icon('plane', 20)}Du bist als Vertretung eingetragen</h3>
                </div>
                <div class="modal-body substitute-popup-body">${body}</div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-primary" id="substitute-popup-ok">${Icon('check', 16)}Verstanden</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.substitute-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.substitute-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
                modal.querySelectorAll('.substitute-panel').forEach(p => { p.hidden = p.dataset.idx !== btn.dataset.idx; });
            });
        });
        modal.querySelector('#substitute-popup-ok').onclick = async () => {
            for (const n of pending) await Store.markNotificationRead(n.id);
            modal.remove();
            await Notifications.refresh();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    applyArchiveConsequences: async (target, restoring) => {
        const tickets = await Store.getTickets();
        let changed = 0;
        if (target.role === 'user') {
            const ownTickets = tickets.filter(t => t.author === target.username && !t.archived && t.status !== 'Geschlossen');
            if (!restoring) {
                await Store.addGlobalLog('Ticket-Ersteller archiviert', `Benutzer: ${target.username}, offene Tickets: ${ownTickets.length}`);
            } else {
                // Bei Reaktivierung die "Weiter bearbeiten"-Bestaetigung zuruecksetzen, damit ein
                // spaeterer erneuter Archivierungs-Zyklus den Hinweis-Dialog wieder zeigt.
                ownTickets.filter(t => t.archivedAuthorAck).forEach(t => { t.archivedAuthorAck = false; changed++; });
            }
        } else if (!restoring) {
            tickets.filter(t => t.owner === target.username && !t.archived && t.status !== 'Geschlossen').forEach(t => {
                t.owner = '';
                t.ownerUserId = null;
                changed++;
            });
            if (changed) await Store.addGlobalLog('Admin archiviert – Tickets zurück ins Team', `Benutzer: ${target.username}, Tickets: ${changed}`);
        }
        if (changed) await Store.saveTickets(tickets);
    },

    // Offene Tickets eines archivierten Benutzers: Hauptverantwortliche entscheidet pro Ticket.
    openArchivedAuthorDecisions: async (user) => {
        if (!user || !(user.role === 'admin' || user.role === 'superadmin')) return;
        const tickets = await Store.getTickets();
        const open = tickets.filter(t => t.owner === user.username && t.authorArchived && !t.archivedAuthorAck && !t.archived && t.status !== 'Geschlossen');
        q('#archived-author-modal')?.remove();
        if (!open.length) return;
        const users = await Store.getUsers();
        const admins = users.filter(u => (u.role === 'admin' || u.role === 'superadmin') && !u.accountArchived && u.username !== user.username);
        const modal = document.createElement('div');
        modal.id = 'archived-author-modal';
        modal.className = 'modal-overlay modal-top';
        modal.innerHTML = `
            <div class="modal modal-md">
                <div class="modal-header">
                    <h3>${Icon('archive', 18)}${Lang.t('ticketAuthorArchivedTitle')}</h3>
                </div>
                <div class="modal-body" id="aa-body"></div>
            </div>`;
        document.body.appendChild(modal);
        const body = modal.querySelector('#aa-body');
        body.innerHTML = `<p class="hint">${Lang.t('authorArchivedDecideHint')}</p>` + open.map(t => {
            const author = users.find(u => u.username === t.author);
            return `
                <div class="absence-overview-row aa-row" data-id="${Utils.esc(t.id)}">
                    <div><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span class="hint">${Lang.format('creatorLabel', { name: Utils.esc(author?.name || t.author) })}</span></div>
                    <div class="aa-actions">
                        <select class="aa-assign"><option value="">${Lang.t('assignToEllipsis')}</option>${admins.map(a => `<option value="${Utils.esc(a.username)}">${Utils.esc(a.name || a.username)}</option>`).join('')}</select>
                        <button class="btn-secondary btn-sm aa-assign-btn" type="button">${Lang.t('assign')}</button>
                        <button class="btn-secondary btn-sm aa-keep" type="button">${Lang.t('keepWorking')}</button>
                        <button class="btn-secondary btn-sm aa-archive" type="button">${Lang.t('archiveAction')}</button>
                    </div>
                </div>`;
        }).join('');
        const close = () => { modal.remove(); };
        let updateQueue = Promise.resolve();
        const updateTicket = (id, mutate, logText) => {
            updateQueue = updateQueue.then(async () => {
                const all = await Store.getTickets();
                const t = all.find(x => x.id === id);
                if (!t) return;
                mutate(t);
                await Store.addLog(t, logText);
                await Store.saveTickets(all);
                modal.querySelector(`.aa-row[data-id="${id}"]`)?.remove();
                if (!modal.querySelector('.aa-row')) close();
                await AdminBoard.render();
            });
            return updateQueue;
        };
        modal.classList.add('open');
        body.querySelectorAll('.aa-row').forEach(row => {
            const id = row.dataset.id;
            row.querySelector('.aa-assign-btn').onclick = () => {
                const newOwner = row.querySelector('.aa-assign').value;
                if (!newOwner) return UI.toast(Lang.t('selectAUser'));
                updateTicket(id, t => {
                    t.owner = newOwner;
                    t.ownerUserId = admins.find(a => a.username === newOwner)?.id || null;
                }, `Ticket nach Archivierung des Erstellers neu zugeordnet an ${newOwner}`);
            };
            row.querySelector('.aa-keep').onclick = () => updateTicket(id, t => { t.archivedAuthorAck = true; }, 'Ticket nach Archivierung des Erstellers weiter bearbeitet (Ersteller kann nicht antworten)');
            row.querySelector('.aa-archive').onclick = () => UI.confirm(Lang.t('confirmArchiveTicketSimple'), () => updateTicket(id, t => { t.archived = true; }, 'Ticket nach Archivierung des Erstellers archiviert'));
        });
        if (window.lucide) lucide.createIcons();
    },

    renderAbsenceBanner: async (user) => {
        q('#absence-banner')?.remove();
        if (!user || !(user.role === 'admin' || user.role === 'superadmin')) return;
        const me = (await Store.getUsers()).find(u => u.id === user.id);
        if (!me?.absence?.active) return;
        const users = await Store.getUsers();
        const sub = me.absence.substitute ? users.find(u => u.username === me.absence.substitute) : null;
        const banner = document.createElement('div');
        banner.id = 'absence-banner';
        banner.className = 'absence-banner';
        banner.innerHTML = `
            <div class="absence-banner-text">
                <strong>${Icon('plane', 14)}${Lang.t('youAreMarkedAbsent')}</strong>
                <span>${sub ? Lang.format('substituteLabel', { name: Utils.esc(sub.name || sub.username) }) : Lang.t('noneTicketsStayInTeam')}</span>
                <span>${Utils.esc(AdminBoard.absenceInfoText(me.absence))}</span>
            </div>
            <button class="btn-secondary btn-sm" id="absence-banner-end">${Lang.t('endAbsenceButton')}</button>`;
        document.body.appendChild(banner);
        banner.querySelector('#absence-banner-end').onclick = async () => {
            await AdminBoard.setAbsence(me.username, false, null, false);
            await AdminBoard.openAbsenceReturnPopup(user);
        };
        if (window.lucide) lucide.createIcons();
    },

    // Zahl der aktuell (sichtbar) abwesenden Personen -- das Symbol erscheint nur, wenn es welche gibt.
    refreshAbsenceBadge: async () => {
        const btn = q('#btn-absence-overview');
        if (!btn) return [];
        const absences = await Store.getCurrentAbsences();
        const label = absences.length ? Lang.format('absentCountLabel', { count: absences.length }) : Lang.t('absencesTitle');
        btn.hidden = !absences.length;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.querySelector('.notification-count').textContent = String(absences.length);
        return absences;
    },

    // Aus /absences/overview (fuer alle Admin-Konten lesbar), nicht aus der Benutzerliste: Admins ohne
    // Benutzerverwaltung bekommen dort nur das Verzeichnis ohne Abwesenheiten.
    openAbsenceOverview: async () => {
        const [current, directory] = await Promise.all([AdminBoard.refreshAbsenceBadge(), Store.getUserDirectory().catch(() => [])]);
        const users = directory;
        const absent = current.map(a => {
            const person = directory.find(u => u.id === a.userId);
            const substitute = directory.find(u => u.id === a.substituteUserId);
            return { name: person?.name, username: a.username, absence: { fromMs: a.fromMs, untilMs: a.untilMs, visible: true, substitute: substitute?.username || null } };
        });
        q('#absence-overview-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'absence-overview-modal';
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = Lang.t('absencesTitle');
        modal.querySelector('#generic-save-head')?.remove();
        modal.querySelector('.modal-body').innerHTML = absent.length ? absent.map(u => {
            const sub = u.absence.substitute ? users.find(x => x.username === u.absence.substitute) : null;
            return `<div class="absence-overview-row"><div><strong>${Utils.esc(u.name || u.username)}</strong><span class="hint">${Utils.esc(AdminBoard.absenceInfoText(u.absence))}</span></div><span>${sub ? Lang.format('substituteLabel', { name: Utils.esc(sub.name || sub.username) }) : Lang.t('noneTeam')}</span></div>`;
        }).join('') : `<div class="empty-state compact">${Lang.t('noOneCurrentlyAbsent')}</div>`;
        modal.querySelector('.modal-body').insertAdjacentHTML('beforeend', `
            <div class="setting-row mt-3">
                <button type="button" class="btn-primary btn-sm" id="abs-overview-own">${Icon('plane', 15)}${Lang.t('setMyAbsence')}</button>
            </div>`);
        modal.querySelector('#abs-overview-own').onclick = () => {
            modal.classList.remove('open');
            Settings.openModal();
        };
        modal.querySelector('.modal-footer')?.remove();
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    notifySubstituteAbsence: async (substitute, absentUser, transferred, addedAsParticipant) => {
        const absentName = absentUser.name || absentUser.username;
        const lines = [];
        if (transferred.length) {
            lines.push(Lang.format('takenOverAsMainResponsible', { count: transferred.length }) + transferred.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
        }
        if (addedAsParticipant.length) {
            lines.push(Lang.format('addedAsParticipantLabel', { count: addedAsParticipant.length }) + addedAsParticipant.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
        }
        const todos = transferred.flatMap(t => (t.todos || []).filter(todo => !todo.done).map(todo => `${t.ticketNumber || t.id}: ${todo.title}`));
        if (todos.length) lines.push(`Offene Teilaufgaben: ` + todos.join('; '));
        const message = `${absentName} hat dich als Vertretung hinterlegt.\n` + (lines.length ? lines.join('\n') : 'Aktuell sind keine offenen Tickets betroffen.');
        await Store.addNotifications([substitute.username], { id: null }, message, null, 'absence');
        await Notifications.refresh();
    },

    // Admin legt ein Ticket im Namen einer anderen Person an (Telefonanruf, am Schalter, etc.)
    openCreateTicketModal: async () => {
        let modal = q('#admin-create-ticket-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-create-ticket-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('plus', 18)}${Lang.t('createNewTicketTitle')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field field-wide is-required">
                            <label for="act-on-behalf-search">${Lang.t('onBehalfOf')}</label>
                            <input type="text" id="act-on-behalf-search" placeholder="${Lang.t('searchByNameOrUsername')}">
                            <div id="act-on-behalf-list" class="user-picker-list"></div>
                            <p class="hint">${Lang.t('personNotListedHint')}</p>
                        </div>
                        <div class="field field-wide is-required">
                            <label for="act-title">${Lang.t('subject')}</label>
                            <input id="act-title" type="text" maxlength="255" placeholder="${Lang.t('titlePlaceholder')}">
                        </div>
                        <div class="field field-wide is-required">
                            <label for="act-desc">${Lang.t('description')}</label>
                            <textarea id="act-desc" rows="6" placeholder="${Lang.t('whatIsThisAboutPlaceholder')}"></textarea>
                        </div>
                        <div class="field">
                            <label for="act-prio">${Lang.t('priority')}</label>
                            <select id="act-prio">
                                <option value="Niedrig">${Lang.t('low')}</option>
                                <option value="Normal">${Lang.t('normal')}</option>
                                <option value="Hoch">${Lang.t('high')}</option>
                                <option value="Kritisch">${Lang.t('critical')}</option>
                            </select>
                        </div>
                        <div class="field is-required">
                            <label id="act-cat-label">${Lang.t('category')}</label>
                            <div id="act-cat-container"></div>
                        </div>
                        <div id="act-custom-fields" class="field-wide custom-fields-fill"></div>
                        <div class="field field-wide">
                            <label>${Lang.t('attachments')}</label>
                            <label for="act-files" class="dropzone" id="act-files-dropzone">
                                <i data-lucide="upload-cloud"></i>
                                <span class="dropzone-text"><strong>${Lang.t('dragFilesHere')}</strong> ${Lang.t('orClickToSelect')}</span>
                                <input id="act-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv,.log">
                            </label>
                            <div id="act-files-preview" class="file-preview"></div>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="act-cancel">${Lang.t('cancel')}</button>
                        <button class="btn-primary" id="act-submit">${Icon('plus', 16)}${Lang.t('createTicketButton')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
            modal.querySelector('#act-cancel').onclick = () => modal.classList.remove('open');
        }
        const users = (await Store.getUsers()).slice().sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
        let selectedBehalfUsername = '';
        const listEl = q('#act-on-behalf-list');
        const searchInput = q('#act-on-behalf-search');
        const renderUserPicker = (filter = '') => {
            const term = filter.toLowerCase().trim();
            const filtered = term ? users.filter(u => (u.name || '').toLowerCase().includes(term) || u.username.toLowerCase().includes(term)) : users;
            listEl.innerHTML = filtered.length ? filtered.map(u => `
                <div class="user-picker-row${u.username === selectedBehalfUsername ? ' selected' : ''}" data-username="${Utils.esc(u.username)}">
                    <span class="user-picker-name">${Utils.esc(u.name || u.username)}</span>
                    <span class="user-picker-meta">${Utils.esc(u.username)} · ${u.role === 'user' ? Lang.t('roleUserLabel') : Lang.t('roleAdminLabel')}</span>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noMatches')}</div>`;
            listEl.querySelectorAll('.user-picker-row').forEach(row => {
                row.onclick = () => {
                    selectedBehalfUsername = row.dataset.username;
                    renderUserPicker(searchInput.value);
                };
            });
        };
        renderUserPicker();
        searchInput.value = '';
        searchInput.oninput = () => renderUserPicker(searchInput.value);
        q('#act-title').value = '';
        q('#act-desc').value = '';
        q('#act-prio').value = 'Normal';
        AdminBoard.createTicketFiles = [];
        q('#act-files-preview').innerHTML = '';
        q('#act-files-preview').style.display = 'none';
        const renderActFilePreview = () => {
            const preview = q('#act-files-preview');
            preview.innerHTML = '';
            preview.style.display = AdminBoard.createTicketFiles.length ? 'flex' : 'none';
            AdminBoard.createTicketFiles.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'file-chip';
                chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="${Lang.t('removeFile')}" aria-label="${Utils.esc(Lang.format('removeFileAriaLabel', { name: file.name }))}">${Icon('x', 13)}</button>`;
                chip.querySelector('button').onclick = () => {
                    AdminBoard.createTicketFiles.splice(index, 1);
                    renderActFilePreview();
                };
                preview.appendChild(chip);
            });
            if (window.lucide) lucide.createIcons();
        };
        const actFileInput = q('#act-files');
        actFileInput.value = '';
        actFileInput.onchange = () => {
            AdminBoard.createTicketFiles.push(...Array.from(actFileInput.files || []));
            actFileInput.value = '';
            renderActFilePreview();
        };
        const actDropzone = q('#act-files-dropzone');
        ['dragenter', 'dragover'].forEach(evt => actDropzone.addEventListener(evt, (e) => { e.preventDefault(); actDropzone.classList.add('drag-over'); }));
        ['dragleave', 'dragend'].forEach(evt => actDropzone.addEventListener(evt, (e) => { e.preventDefault(); actDropzone.classList.remove('drag-over'); }));
        actDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            actDropzone.classList.remove('drag-over');
            AdminBoard.createTicketFiles.push(...Array.from(e.dataTransfer?.files || []));
            renderActFilePreview();
        });
        const addActFiles = files => {
            AdminBoard.createTicketFiles.push(...files);
            renderActFilePreview();
        };
        UI.bindFileDrop(q('#admin-create-ticket-modal .modal'), addActFiles);
        UI.bindPasteFiles(q('#act-desc'), addActFiles);
        const settings = await Store.getSettings();
        // Kategorie ist Pflicht und bewusst nicht vorausgewaehlt (wie im Benutzer-Dashboard).
        const categories = settings.categories || [];
        const refreshActCustomFields = (selected) => {
            UI.renderCustomFieldsForm(q('#act-custom-fields'), Store.getCustomFieldsForCategories(selected ? [selected] : [], settings));
        };
        AdminBoard.createTicketCategoryInstance = UI.createMultiSelect(q('#act-cat-container'), categories, '', refreshActCustomFields, { single: true, emptyLabel: Lang.t('pleaseChoose') });
        q('#act-cat-container .multi-select-header')?.setAttribute('aria-labelledby', 'act-cat-label');
        refreshActCustomFields('');
        modal.querySelectorAll('.field.is-invalid').forEach(field => field.classList.remove('is-invalid'));
        q('#act-submit').onclick = async () => {
            const title = q('#act-title').value.trim();
            const desc = q('#act-desc').value.trim();
            const missing = [[q('#act-title'), title, 'subject'], [q('#act-desc'), desc, 'description'], [q('#act-cat-container'), AdminBoard.createTicketCategoryInstance.getValue(), 'category']]
                .filter(([el, value]) => { el.closest('.field').classList.toggle('is-invalid', !value); return !value; });
            if (missing.length) {
                (missing[0][0].querySelector?.('.multi-select-header') || missing[0][0]).focus();
                return UI.toast(Lang.format('requiredFieldsMissing', { fields: missing.map(([, , label]) => Lang.t(label)).join(', ') }));
            }
            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#act-custom-fields'));
            if (missingFields.length) return UI.toast(Lang.format('requiredFieldsMissing', { fields: missingFields.join(', ') }));
            const onBehalfUser = users.find(u => u.username === selectedBehalfUsername);
            if (!onBehalfUser) return UI.toast(Lang.t('selectAPerson'));
            const invalidFiles = [];
            AdminBoard.createTicketFiles.forEach(file => { try { Store.assertUploadAllowed(file); } catch (error) { invalidFiles.push(Store.uploadErrorMessage(error)); } });
            if (invalidFiles.length) return UI.toast(invalidFiles.join(' '));
            const activeIncidents = await Store.getActiveIncidents();
            let linkedIncidentId = null;
            if (activeIncidents.length) {
                const choice = await UI.askIncidentLink(activeIncidents);
                if (choice === undefined) return;
                linkedIncidentId = choice;
            }
            const category = [AdminBoard.createTicketCategoryInstance.getValue()];
            const newTicket = await Store.createTicket({
                title, desc, prio: q('#act-prio').value, category,
                onBehalfOfUserId: onBehalfUser.id, customFieldValues
            });
            if (!newTicket) {
                UI.toast(Lang.t('ticketCreateFailed'));
                return;
            }
            if (AdminBoard.createTicketFiles.length) {
                const { errors } = await Store.uploadFiles(AdminBoard.createTicketFiles, file => Store.saveAttachment(file, { ticketId: newTicket.id }));
                if (errors.length) UI.toast(`${Lang.t('ticketCreatedAttachmentsFailed')} ${errors.join(' ')}`);
            }
            Store._ticketsCache = null;
            if (linkedIncidentId) await AdminBoard.linkTicketToIncident(newTicket.id, linkedIncidentId);
            modal.classList.remove('open');
            UI.toast(Lang.t('ticketCreatedPlain'));
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    openIncidentCreateModal: async () => {
        q('#generic-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = Lang.t('createIncident');
        const settings = await Store.getSettings();
        const categories = settings.categories && settings.categories.length ? settings.categories : ['Allgemein'];
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label>${Lang.t('incidentTitle')}</label>
                <input id="incident-title" type="text" placeholder="${Lang.t('egVpnIncident')}">
            </div>
            <div class="field">
                <label>${Lang.t('incidentNotice')}</label>
                <textarea id="incident-notice" rows="4" placeholder="${Lang.t('incidentDescriptionPlaceholder')}"></textarea>
            </div>
            <div class="form-grid">
                <div class="field">
                    <label>${Lang.t('priority')}</label>
                    <select id="incident-prio">
                        <option value="Normal">Normal</option>
                        <option value="Hoch">Hoch</option>
                        <option value="Kritisch">Kritisch</option>
                    </select>
                </div>
                <div class="field">
                    <label>${Lang.t('category')}</label>
                    <select id="incident-category">
                        ${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        saveBtn.textContent = Lang.t('createIncidentButton');
        saveBtn.onclick = async () => {
            const title = q('#incident-title').value.trim();
            const notice = q('#incident-notice').value.trim();
            if (!title) return UI.toast(Lang.t('enterATitle'));
            if (!notice) return UI.toast(Lang.t('enterVisibleNotice'));
            const tickets = await Store.getTickets();
            const category = [q('#incident-category').value || 'Allgemein'];
            let ticketNumberData;
            try {
                ticketNumberData = Store.nextTicketNumber(tickets, category, settings);
            } catch {
                return UI.toast(Lang.t('invalidTicketNumberFormat'));
            }
            const actor = await Store.currentUser();
            const incidentTicket = {
                id: Utils.uid(),
                title,
                desc: notice,
                prio: q('#incident-prio').value,
                category,
                status: 'Neu',
                author: actor?.username || 'admin',
                authorName: actor?.name || actor?.username || 'Administrator',
                createdAt: Utils.nowISO(),
                comments: [],
                chat: [],
                attachments: [],
                archived: false,
                ticketNumber: ticketNumberData.ticketNumber,
                ticketNumberSequence: ticketNumberData.ticketNumberSequence,
                assignees: [],
                participants: [],
                owner: '',
                todos: [],
                isMajorIncident: true,
                incidentNotice: notice
            };
            tickets.push(incidentTicket);
            await Store.addLog(incidentTicket, 'Störung erstellt', notice);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Störung erstellt', `Ticket: ${title}`);
            modal.classList.remove('open');
            UI.toast(Lang.t('incidentCreatedToast'));
            await AdminBoard.render();
            await AdminBoard.openModal(incidentTicket.id);
        };
        modal.classList.add('open');
        q('#incident-title').focus();
        if (window.lucide) lucide.createIcons();
    },

    editTicket: async (id) => {
        const tickets = await Store.getTickets();
        const ticket = tickets.find(item => item.id === id);
        if (!ticket || ticket.archived) return;
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = `Ticket bearbeiten · ${ticket.ticketNumber || ticket.id}`;
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field"><label for="edit-ticket-title">Titel</label><input id="edit-ticket-title" type="text" value="${Utils.esc(ticket.title)}"></div>
            <div class="field"><label for="edit-ticket-desc">Beschreibung</label><textarea id="edit-ticket-desc" rows="8">${Utils.esc(ticket.desc || '')}</textarea></div>`;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const title = q('#edit-ticket-title').value.trim();
            const desc = q('#edit-ticket-desc').value.trim();
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            if (title === ticket.title && desc === (ticket.desc || '')) return modal.classList.remove('open');
            const before = `${ticket.title}\n${ticket.desc || ''}`;
            ticket.title = title;
            ticket.desc = desc;
            await Store.addLog(ticket, 'Ticketdaten bearbeitet', `Vorher: ${before}\nNachher: ${title}\n${desc}`);
            await Store.saveTickets(tickets);
            await Store.addGlobalLog('Ticketdaten bearbeitet', `Ticket ${ticket.ticketNumber || ticket.id}: ${title}`);
            modal.classList.remove('open');
            q('#m-title').textContent = `${ticket.ticketNumber || ticket.id} - ${ticket.title}`;
            q('#m-desc').textContent = ticket.desc || 'Keine Beschreibung';
            await AdminBoard.render();
            await Notifications.refresh();
        };
        modal.classList.add('open');
        q('#edit-ticket-title').focus();
    },

    // Großstörung: ein Agent markiert eine bekannte Störung. Benutzer sehen beim Erstellen
    // eines neuen Tickets einen Hinweis und können sich verknüpfen, statt ein Dubletten-Ticket
    // anzulegen. Wird das Haupt-Ticket geschlossen, bekommen alle verknüpften Tickets die
    // Lösung automatisch als Chat-Nachricht mitgeteilt.
    // Manuell gesetzte Frist für einzelne Tickets (überschreibt die berechnete Lösungsfrist vollständig).
    openCustomDueModal: async (id) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        q('#custom-due-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'custom-due-modal';
        modal.querySelector('.modal-header h3').textContent = Lang.t('dueDate');
        const currentDue = Store.ticketSlaDueAt(t, await Store.getSettings());
        const initialMs = t.customDueAt ? new Date(t.customDueAt).getTime() : currentDue;
        const initialDate = initialMs ? new Date(initialMs) : null;
        modal.querySelector('.modal-body').innerHTML = `
            <div class="form-grid">
                <div class="field">
                    <label>${Lang.t('dateFormatLabel')}</label>
                    <div class="date-input-row">
                        <input id="custom-due-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${initialDate ? Utils.fmtDateOnly(initialDate) : ''}">
                        <button type="button" class="btn-ghost btn-icon" id="custom-due-calendar-btn" title="${Lang.t('openCalendar')}" aria-label="${Lang.t('openCalendar')}">${Icon('calendar', 16)}</button>
                    </div>
                </div>
                <div class="field">
                    <label>${Lang.t('time')}</label>
                    <input id="custom-due-time" type="text" inputmode="numeric" placeholder="17:00" value="${initialDate ? Utils.fmtTimeOnly(initialDate) : '17:00'}">
                </div>
            </div>
            <div id="custom-due-dtp-host" hidden>${UI.dateTimePickerMarkup('custom-due-dtp')}</div>
            <p class="hint">${t.customDueAt ? Lang.t('customDueManualHint') : Lang.t('customDueAutoHint')}</p>
            ${t.customDueAt ? `<button type="button" class="btn-secondary btn-sm" id="custom-due-reset">${Icon('rotate-ccw', 15)}${Lang.t('recalculateAutomatically')}</button>` : ''}
        `;
        const dtpPicker = UI.createDateTimePicker(q('#custom-due-dtp'), {
            value: initialMs,
            anchor: q('#custom-due-calendar-btn'),
            onChange: (ms) => {
                if (!ms) return;
                const d = new Date(ms);
                q('#custom-due-date').value = Utils.fmtDateOnly(d);
                q('#custom-due-time').value = Utils.fmtTimeOnly(d);
            }
        });
        q('#custom-due-calendar-btn').onclick = () => dtpPicker.open();
        UI.bindDateInput(q('#custom-due-date'));
        UI.bindTimeInput(q('#custom-due-time'));
        q('#custom-due-date').addEventListener('change', () => {
            const dateMs = Utils.parseGermanDateTime(q('#custom-due-date').value.trim(), '00:00');
            if (dateMs) dtpPicker.setValue(Utils.parseGermanDateTime(q('#custom-due-date').value.trim(), q('#custom-due-time').value.trim() || '00:00') || dateMs);
        });
        modal.querySelector('.modal-footer .btn-primary').textContent = Lang.t('save');
        const resetBtn = q('#custom-due-reset');
        if (resetBtn) resetBtn.onclick = async () => {
            delete t.customDueAt;
            await Store.addLog(t, 'Manuelle Frist zurückgesetzt');
            await Store.saveTickets(tickets);
            modal.classList.remove('open');
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const pickedMs = Utils.parseGermanDateTime(q('#custom-due-date').value, q('#custom-due-time').value);
            if (!pickedMs) { UI.toast(Lang.t('selectDateTime')); return; }
            t.customDueAt = new Date(pickedMs).toISOString();
            await Store.addLog(t, 'Eigene Frist gesetzt', Utils.fmtDate(t.customDueAt));
            await Store.saveTickets(tickets);
            modal.classList.remove('open');
            UI.toast(Lang.t('deadlineSavedToast'));
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Legt über das Backend (Microsoft Graph, App-only -- siehe graphClient.ts) einen echten
    // Outlook-Kalendertermin an und verknüpft ihn mit dem Ticket. Start wird mit der bestehenden
    // Lösungsfrist vorbelegt (falls vorhanden), damit die Frist direkt auch im Kalender sichtbar
    // gemacht werden kann.
    openCalendarEventModal: async (id) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        q('#calendar-event-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.id = 'calendar-event-modal';
        modal.querySelector('.modal-header h3').textContent = Lang.t('createOutlookEventTitle');

        const settings = await Store.getSettings();
        const dueMs = t.customDueAt ? new Date(t.customDueAt).getTime() : Store.ticketSlaDueAt(t, settings);
        const startMs = dueMs || (Date.now() + 60 * 60 * 1000);
        const endMs = startMs + 30 * 60 * 1000;
        const startInitial = new Date(startMs);
        const endInitial = new Date(endMs);

        const existingEvents = await Store.getTicketCalendarEvents(id);
        const eventsListHtml = existingEvents.length
            ? `<div class="field"><label>${Lang.t('alreadyCreatedEvents')}</label><ul class="calendar-event-list">${existingEvents.map(e =>
                `<li>${Icon('calendar-check', 13)}${Utils.esc(e.subject)} -- ${Utils.esc(Utils.fmtDate(e.startAt))}${/^https:\/\//i.test(e.webLink || '') ? ` <a href="${Utils.esc(e.webLink)}" target="_blank" rel="noopener noreferrer">${Icon('external-link', 11)}</a>` : ''}</li>`
            ).join('')}</ul></div>`
            : '';

        modal.querySelector('.modal-body').innerHTML = `
            ${eventsListHtml}
            <div class="field"><label>${Lang.t('subjectLabel')}</label><input id="cal-event-subject" type="text" value="${Utils.esc(`${t.ticketNumber || ''} ${t.title || ''}`.trim())}" maxlength="512"></div>
            <div class="form-grid">
                <div class="field">
                    <label>${Lang.t('startLabel')}</label>
                    <div class="date-input-row">
                        <input id="cal-event-start-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${Utils.fmtDateOnly(startInitial)}">
                        <button type="button" class="btn-ghost btn-icon" id="cal-event-start-calendar-btn" title="${Lang.t('openCalendar')}" aria-label="${Lang.t('openCalendar')}">${Icon('calendar', 16)}</button>
                    </div>
                    <input id="cal-event-start-time" type="text" inputmode="numeric" placeholder="17:00" value="${Utils.fmtTimeOnly(startInitial)}">
                </div>
                <div class="field">
                    <label>${Lang.t('endLabel')}</label>
                    <div class="date-input-row">
                        <input id="cal-event-end-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${Utils.fmtDateOnly(endInitial)}">
                        <button type="button" class="btn-ghost btn-icon" id="cal-event-end-calendar-btn" title="${Lang.t('openCalendar')}" aria-label="${Lang.t('openCalendar')}">${Icon('calendar', 16)}</button>
                    </div>
                    <input id="cal-event-end-time" type="text" inputmode="numeric" placeholder="17:30" value="${Utils.fmtTimeOnly(endInitial)}">
                </div>
            </div>
            <div id="cal-event-start-dtp-host" hidden>${UI.dateTimePickerMarkup('cal-event-start-dtp')}</div>
            <div id="cal-event-end-dtp-host" hidden>${UI.dateTimePickerMarkup('cal-event-end-dtp')}</div>
            <div class="field"><label>${Lang.t('attendeesLabel')}</label><div id="cal-event-attendees"></div></div>
            <div class="field"><label for="cal-event-external">${Lang.t('externalAttendees')}</label><textarea id="cal-event-external" rows="2" placeholder="person@example.com; partner@example.org"></textarea></div>
            <div class="field"><label>${Lang.t('calendarNoteLabel')}</label><textarea id="cal-event-notes" rows="3" maxlength="5000"></textarea></div>
            <p class="hint">${Lang.t('calendarEventHint')}</p>
        `;
        const startDtp = UI.createDateTimePicker(q('#cal-event-start-dtp'), {
            value: startMs,
            anchor: q('#cal-event-start-calendar-btn'),
            onChange: (ms) => {
                if (!ms) return;
                const d = new Date(ms);
                q('#cal-event-start-date').value = Utils.fmtDateOnly(d);
                q('#cal-event-start-time').value = Utils.fmtTimeOnly(d);
            }
        });
        const endDtp = UI.createDateTimePicker(q('#cal-event-end-dtp'), {
            value: endMs,
            anchor: q('#cal-event-end-calendar-btn'),
            onChange: (ms) => {
                if (!ms) return;
                const d = new Date(ms);
                q('#cal-event-end-date').value = Utils.fmtDateOnly(d);
                q('#cal-event-end-time').value = Utils.fmtTimeOnly(d);
            }
        });
        q('#cal-event-start-calendar-btn').onclick = () => startDtp.open();
        q('#cal-event-end-calendar-btn').onclick = () => endDtp.open();
        UI.bindDateInput(q('#cal-event-start-date'));
        UI.bindTimeInput(q('#cal-event-start-time'));
        UI.bindDateInput(q('#cal-event-end-date'));
        UI.bindTimeInput(q('#cal-event-end-time'));

        const attendeeUsers = (await Store.getUsers()).filter(u => !u.accountArchived && u.email);
        const attendeePicker = UI.createMultiSelect(q('#cal-event-attendees'), attendeeUsers.map(u => ({ value: u.id, label: u.name || u.username })), [], null, { emptyLabel: Lang.t('none') });

        modal.querySelector('.modal-footer .btn-primary').textContent = Lang.t('createEventButton');
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const startPickedMs = Utils.parseGermanDateTime(q('#cal-event-start-date').value, q('#cal-event-start-time').value);
            const endPickedMs = Utils.parseGermanDateTime(q('#cal-event-end-date').value, q('#cal-event-end-time').value);
            const subject = q('#cal-event-subject').value.trim();
            if (!subject) { UI.toast(Lang.t('enterASubject')); return; }
            if (!startPickedMs || !endPickedMs || endPickedMs <= startPickedMs) { UI.toast(Lang.t('selectValidStartEnd')); return; }

            const attendeeIds = attendeePicker.getValue();
            const external = q('#cal-event-external').value.split(/[;,\s]+/).filter(Boolean);
            const attendeeEmails = [...new Set([...attendeeUsers.filter(u => attendeeIds.includes(u.id)).map(u => u.email), ...external].map(email => email.toLowerCase()))];
            if (attendeeEmails.length > 20 || attendeeEmails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { UI.toast(Lang.t('invalidAttendees')); return; }
            const result = await Store.createTicketCalendarEvent(id, {
                subject,
                notes: q('#cal-event-notes').value.trim() || undefined,
                start_at: new Date(startPickedMs).toISOString(),
                end_at: new Date(endPickedMs).toISOString(),
                attendee_emails: attendeeEmails.length ? attendeeEmails : undefined
            });
            if (!result) {
                const errMap = {
                    outlook_not_configured: Lang.t('outlookNotConfiguredError'),
                    outlook_auth_failed: Lang.t('outlookAuthFailedError'),
                    outlook_event_create_failed: Lang.t('outlookEventCreateFailedError'),
                    attendee_domain_not_allowed: Lang.t('attendeeDomainNotAllowed')
                };
                UI.toast(errMap[Store.lastError] || Lang.t('eventCreateFailedGeneric'));
                return;
            }
            await Store.addLog(t, 'Outlook-Termin erstellt', subject);
            modal.classList.remove('open');
            UI.toast(Lang.t('eventCreatedToast'));
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // type/incident_notice sind keine flachen Felder in Store.saveTickets -- direkter PATCH.
    toggleMajorIncident: async (id) => {
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        if (t.isMajorIncident) {
            UI.confirm(Lang.t('confirmLiftMajorIncident'), async () => {
                await fetch(`/api/v2/tickets/${encodeURIComponent(id)}`, {
                    method: 'PATCH', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ type: 'ticket', incident_notice: null })
                }).catch(() => {});
                await AdminBoard.openModal(id);
                await AdminBoard.render();
            });
            return;
        }
        q('#generic-modal')?.remove();
        const modal = AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = Lang.t('markAsIncidentTitle');
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label>${Lang.t('visibleNoticeForUsers')}</label>
                <textarea id="incident-existing-notice" rows="4">${Utils.esc(t.incidentNotice || t.title)}</textarea>
            </div>
            <p class="hint">${Lang.t('incidentOfferedToUsersHint')}</p>
        `;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const notice = q('#incident-existing-notice').value.trim();
            if (!notice) return UI.toast(Lang.t('enterANotice'));
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}`, {
                method: 'PATCH', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'incident', incident_notice: notice })
            }).catch(() => null);
            if (!res || !res.ok) return UI.toast(Lang.t('markAsIncidentFailed'));
            modal.classList.remove('open');
            UI.toast(Lang.t('markedAsIncidentToast'));
            await AdminBoard.openModal(id);
            await AdminBoard.render();
        };
        modal.classList.add('open');
        q('#incident-existing-notice').focus();
    },

    // Beim Schließen eines Großstörungs-Tickets bekommen alle verknüpften Tickets die
    // Lösung automatisch als Chat-Nachricht mitgeteilt, damit niemand einzeln nachfragen muss.
    notifyLinkedIncidentTickets: async (incidentTicket, resolutionText) => {
        const tickets = await Store.getTickets();
        const linked = tickets.filter(t => t.linkedIncidentId === incidentTicket.id && !t.archived);
        if (!linked.length) return;
        const actor = await Store.currentUser();
        for (const t of linked) {
            await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/messages`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: Lang.format('incidentUpdateMessage', { title: incidentTicket.title, text: resolutionText || Lang.t('incidentResolvedDefault') }) })
            }).catch(() => {});
        }
        await Store.addGlobalLog('Großstörung behoben – verknüpfte Tickets informiert', `Haupt-Ticket: ${incidentTicket.title}, Betroffene Tickets: ${linked.length}`);
        UI.toast(Lang.format('linkedTicketsInformedToast', { count: linked.length }));
    },

    openPrintOptions: async (id) => {
        let modal = q('#print-options-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'print-options-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('printer', 18)}${Lang.t('printTicketTitle')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <p class="hint">${Lang.t('choosePrintContentHint')}</p>
                        <div class="checkbox-list">
                            <label class="check-row"><input type="checkbox" id="pp-todos" checked>${Lang.t('subtasks')}</label>
                            <label class="check-row"><input type="checkbox" id="pp-admin-chat" checked>${Lang.t('adminChatInternal')}</label>
                            <label class="check-row"><input type="checkbox" id="pp-solution" checked>${Lang.t('solutionPathInternal')}</label>
                            <label class="check-row"><input type="checkbox" id="pp-chat" checked>${Lang.t('chatHistoryWithUser')}</label>
                            <label class="check-row"><input type="checkbox" id="pp-time" checked>${Lang.t('timeTracking')}</label>
                            <label class="check-row"><input type="checkbox" id="pp-log">${Lang.t('ticketLog')}</label>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="pp-cancel">${Lang.t('cancel')}</button>
                        <button class="btn-primary" id="pp-confirm">${Icon('printer', 16)}${Lang.t('print')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
            modal.querySelector('#pp-cancel').onclick = () => modal.classList.remove('open');
        }
        modal.querySelector('#pp-confirm').onclick = async () => {
            modal.classList.remove('open');
            await AdminBoard.printTicket(id, {
                todos: q('#pp-todos').checked,
                adminChat: q('#pp-admin-chat').checked,
                solution: q('#pp-solution').checked,
                chat: q('#pp-chat').checked,
                time: q('#pp-time').checked,
                log: q('#pp-log').checked
            });
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    printTicket: async (id, options = {}) => {
        const opts = { todos: true, adminChat: true, solution: true, chat: true, time: true, log: false, ...options };
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id) || await Store.getTicketById(id);
        if (!t) return;
        const users = await Store.getUsers();
        const nameFor = (username) => {
            if (!username) return '-';
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const settings = await Store.getSettings();
        const company = settings.companyConfig || {};
        const companyLogo = company.logoUrl || settings.companyBrandingConfig?.logoDataUrl || '';
        const actor = await Store.currentUser();
        const slaCountdown = Store.formatSlaCountdown(t, settings);
        // Die Ticket-Liste (Store.getTickets) liefert bewusst nur Zaehlungen, keine vollen
        // Inhalte (siehe mapApiTicketToLegacy) -- vorher griff der Druck direkt auf t.todos/
        // t.comments/t.chat/t.logs/t.timeEntries zu, die dadurch IMMER leer waren: der Ausdruck
        // enthielt faktisch nur noch Kopf/Metadaten/Beschreibung, egal welche Haekchen gesetzt
        // waren. Jetzt werden die tatsaechlichen Inhalte je Abschnitt frisch von der jeweiligen
        // Detail-API geladen, genau wie die Detailansicht es auch tut.
        const entryRow = (author, date, text) => `
            <div class="p-entry"><strong>${Utils.esc(author)}</strong> <span>${Utils.esc(Utils.fmtDate(date))}</span>
            <p>${Utils.esc(text || '')}</p></div>`;

        let todos = '';
        if (opts.todos) {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/todos`, { credentials: 'same-origin' }).catch(() => null);
            const list = res && res.ok ? (await res.json()).todos || [] : [];
            todos = list.map(d => `<li>${d.done ? '☑' : '☐'} ${Utils.esc(d.content)}${d.assignee_username ? ' – ' + Utils.esc(nameFor(d.assignee_username)) : ''}${d.done && d.done_at ? ` – ${Utils.esc(Lang.t('doneOn'))} ${Utils.esc(Utils.fmtDate(d.done_at))}` : ''}</li>`).join('');
        }
        let adminChatEntries = '', solutionEntries = '';
        if (opts.adminChat || opts.solution) {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/notes`, { credentials: 'same-origin' }).catch(() => null);
            const notes = res && res.ok ? (await res.json()).notes || [] : [];
            if (opts.adminChat) adminChatEntries = notes.filter(n => n.stream === 'admin-chat').map(n => entryRow(n.author_name || n.author_username, n.created_at, n.content)).join('');
            if (opts.solution) solutionEntries = notes.filter(n => n.stream === 'solution').map(n => entryRow(n.author_name || n.author_username, n.created_at, n.content)).join('');
        }
        let chat = '';
        if (opts.chat) {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/messages`, { credentials: 'same-origin' }).catch(() => null);
            const messages = res && res.ok ? (await res.json()).messages || [] : [];
            chat = messages.map(m => entryRow(m.sender_name || (m.sender_role === 'user' ? nameFor(t.author) : '-'), m.created_at, m.content)).join('');
        }
        let logEntries = '';
        if (opts.log) {
            const log = await Store.getTicketAuditLog(t.id);
            logEntries = log.slice().reverse().map(l => `
                <div class="p-entry"><strong>${Utils.esc(l.user || '-')}</strong> <span>${Utils.esc(Utils.fmtDate(l.date))}</span>
                <p>${Utils.esc(l.action || '')}${l.details ? ' – ' + Utils.esc(l.details) : ''}</p></div>`).join('');
        }
        const fmtMinutesPrint = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} Std.` : `${mins} Min.`;
        let timeEntries = '', totalMinutes = 0;
        if (opts.time) {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/time-entries`, { credentials: 'same-origin' }).catch(() => null);
            const entries = res && res.ok ? (await res.json()).entries || [] : [];
            totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
            timeEntries = entries.map(e => `
                <div class="p-entry"><strong>${Utils.esc(nameFor(e.username))}</strong> <span>${Utils.esc(Utils.fmtDate(e.created_at))} – ${fmtMinutesPrint(e.minutes)}</span>
                ${e.note ? `<p>${Utils.esc(e.note)}</p>` : ''}</div>`).join('');
        }
        const participants = [...new Set([t.owner, ...(t.participants || [])].filter(Boolean))].map(nameFor).join(', ') || '-';
        const incidentOf = t.linkedIncidentId ? tickets.find(x => x.id === t.linkedIncidentId) : null;
        const linkedToIncident = t.isMajorIncident ? tickets.filter(x => x.linkedIncidentId === t.id && !x.archived) : [];
        const incidentSection = t.isMajorIncident ? `<h2>${Lang.t('majorIncidentHeading')}</h2>
            <p class="desc">${Utils.esc(t.incidentNotice || '')}</p>
            <div class="grid"><div><strong>${Lang.t('assignedTickets')}</strong>${linkedToIncident.length}</div></div>
            ${linkedToIncident.length ? `<ul>${linkedToIncident.map(x => `<li>${Utils.esc(x.ticketNumber || x.id)} · ${Utils.esc(x.title)} – ${Utils.esc(nameFor(x.author) || x.author || '-')} – ${Utils.esc(x.status)}</li>`).join('')}</ul>` : `<p class="desc">${Lang.t('noTicketsAssigned')}</p>`}` : incidentOf ? `<h2>${Lang.t('majorIncidentHeading')}</h2><p class="desc">${Lang.format('assignedToIncident', { ticket: Utils.esc(incidentOf.ticketNumber || incidentOf.id) + ' · ' + Utils.esc(incidentOf.title) })}</p>` : '';
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${Utils.esc(t.ticketNumber || t.id)}</title>
            <link rel="stylesheet" href="/js/print.css"></head><body>
            <div class="print-head">
                <div>
                    <h1>${Utils.esc(t.ticketNumber || t.id)} &middot; ${Utils.esc(t.title)}</h1>
                    <div class="meta">${Lang.format('printedByOn', { name: Utils.esc(actor?.name || actor?.username || '-'), date: Utils.esc(Utils.fmtDate(new Date().toISOString())) })}</div>
                </div>
                ${companyLogo ? `<img src="${Utils.esc(companyLogo)}" alt="Logo">` : ''}
            </div>
            <div class="grid">
                <div><strong>${Lang.t('from')}</strong>${Utils.esc(nameFor(t.author) || t.author)}</div>
                <div><strong>${Lang.t('createdOn')}</strong>${Utils.esc(Utils.fmtDate(t.createdAt))}</div>
                <div><strong>${Lang.t('status')}</strong>${Utils.esc(Lang.status(t.status))}${t.archived ? ` · ${Utils.esc(Lang.t('archivedState'))}${t.archivedAt ? ` (${Utils.esc(Utils.fmtDate(t.archivedAt))})` : ''}` : ''}</div>
                <div><strong>${Lang.t('priority')}</strong>${Utils.esc(t.prio)}</div>
                <div><strong>${Lang.t('category')}</strong>${Utils.esc((t.category || []).join(', ') || '-')}</div>
                <div><strong>${Lang.t('mainResponsible')}</strong>${Utils.esc(nameFor(t.owner))}</div>
                <div><strong>${Lang.t('involvedPersons')}</strong>${Utils.esc(participants)}</div>
                ${slaCountdown ? `<div><strong>${Lang.t('deadline')}</strong>${Utils.esc(slaCountdown.label)} (${Utils.esc(slaCountdown.dueDateLabel)})</div>` : ''}
            </div>
            <h2>${Lang.t('description')}</h2>
            <p class="desc">${Utils.esc(t.desc || Lang.t('noDescription'))}</p>
            ${incidentSection}
            ${todos ?`<h2>${Lang.t('subtasks')}</h2><ul>${todos}</ul>` : ''}
            ${adminChatEntries ? `<h2>${Lang.t('adminChatHeading')}</h2>${adminChatEntries}` : ''}
            ${solutionEntries ? `<h2>${Lang.t('solutionPathHeading')}</h2>${solutionEntries}` : ''}
            ${chat ? `<h2>${Lang.t('chatHistoryHeading')}</h2>${chat}` : ''}
            ${timeEntries ? `<h2>${Lang.format('timeTrackingTotal', { total: Utils.esc(fmtMinutesPrint(totalMinutes)) })}</h2>${timeEntries}` : ''}
            ${logEntries ? `<h2>${Lang.t('ticketLog')}</h2>${logEntries}` : ''}
            </body></html>`;
        UI.printHTML(html);
    },

    openModal: async (id) => {
        try {
            AdminBoard.currentTicketId = id;
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id) || await Store.getTicketById(id);
            // Kein Zugriff (serverseitig gefiltert) oder Ticket geloescht.
            if (!t) return UI.toast(Lang.t('ticketNotAccessible'));

            const user = await Store.currentUser();
            const isSuper = user && user.role === 'superadmin';

            q('#m-title').textContent = `${t.ticketNumber || t.id} · ${t.title}${t.archived ? ' [ARCHIVIERT]' : ''}`;
            AdminBoard.ensureTicketLinkButton(t);
            q('#m-desc').textContent = t.desc || 'Keine Beschreibung';
            {
                const fieldsSettings = await Store.getSettings();
                UI.renderCustomFieldsDisplay(q('#m-custom-fields-display'), Store.getCustomFieldsForCategories(t.category, fieldsSettings), t.customFieldValues || {});
            }
            await AdminBoard.renderTicketAttachments(t, '#m-ticket-attachments', { manage: true });
            AdminBoard.renderIncidentLinkedTickets(t, tickets);

            const pendingApproval = (t.approvals || []).find(a => a.status === 'pending');
            const approvalHistory = await AdminBoard.renderApprovalHistory(t, '#m-approval-history');
            const approvalPendingBox = q('#m-approval-pending');
            if (approvalPendingBox) {
                approvalPendingBox.hidden = !pendingApproval;
                const approvalActions = q('#m-approval-actions');
                if (pendingApproval) {
                    const approverName = await Store.describeApprover(pendingApproval);
                    const openRequest = approvalHistory.find(entry => entry.status === 'pending');
                    q('#m-approval-pending-text').textContent = Lang.format('awaitingApprovalBy', { name: approverName, date: Utils.fmtDate(openRequest?.requested_at || pendingApproval.requestedAt) });
                    // Darf die aktuell angemeldete Person selbst entscheiden, direkt hier Freigeben/Ablehnen anbieten
                    const canDecideHere = user.role === 'superadmin' || isPendingApprover(pendingApproval, user.id);
                    if (approvalActions) approvalActions.hidden = !canDecideHere;
                    if (canDecideHere) {
                        q('#m-approval-yes').onclick = async () => {
                            const comment = await UI.promptText({ title: 'Genehmigung freigeben', label: 'Kommentar (optional)', multiline: true, saveLabel: 'Freigeben' });
                            if (comment === null) return;
                            if (await AdminBoard.decideApproval(t.id, 'approved', comment.trim())) {
                                UI.toast('Genehmigung erteilt.');
                                await AdminBoard.openModal(t.id);
                                await AdminBoard.render();
                            }
                        };
                        q('#m-approval-no').onclick = async () => {
                            const reason = await UI.promptText({ title: Lang.t('declineApprovalTitle'), label: Lang.t('declineApprovalLabel'), saveLabel: Lang.t('decline') });
                            if (!reason || !reason.trim()) return UI.toast(Lang.t('enterAReason'));
                            if (await AdminBoard.decideApproval(t.id, 'rejected', reason.trim())) {
                                UI.toast('Genehmigung abgelehnt.');
                                await AdminBoard.openModal(t.id);
                                await AdminBoard.render();
                            }
                        };
                    }
                } else if (approvalActions) {
                    approvalActions.hidden = true;
                }
            }

            // Elements
            const prioSel = q('#m-prio-edit');
            const statusSel = q('#m-status-edit');
            const catSel = q('#m-cat-edit');
            const commentInput = q('#m-new-comment');
            const commentBtn = q('#btn-add-comment');
            const chatInput = q('#m-chat-input');
            const chatSend = q('#btn-chat-send');
            const btnArch = q('#btn-archive-ticket');
            const btnLogs = q('#m-logs');
            const btnKb = q('#m-kb-search');
            if (btnKb) btnKb.onclick = () => KbSearch.open({ ticket: t });
            AdminBoard.renderKbLinks(t.id);
            const btnEditTicket = q('#m-edit-ticket');
            if (btnEditTicket) {
                btnEditTicket.style.display = t.archived ? 'none' : '';
                btnEditTicket.onclick = () => AdminBoard.editTicket(t.id);
            }
            const btnPrint = q('#m-print');
            if (btnPrint) btnPrint.onclick = () => AdminBoard.openPrintOptions(t.id);

            const btnIncident = q('#btn-mark-incident');
            if (btnIncident) {
                btnIncident.style.display = (t.archived || t.linkedIncidentId) ? 'none' : '';
                btnIncident.innerHTML = t.isMajorIncident ? `${Icon('siren', 16)}${Lang.t('liftMajorIncidentButton')}` : `${Icon('siren', 16)}${Lang.t('markAsMajorIncidentButton')}`;
                btnIncident.classList.toggle('btn-danger', !!t.isMajorIncident);
                btnIncident.onclick = () => AdminBoard.toggleMajorIncident(t.id);
            }

            const actionsRow = q('#ticket-modal .actions-row');
            if (actionsRow) {
                // #m-extra-actions sitzt als <span style="display:contents"> IN derselben
                // .actions-row wie die statischen Buttons (admin.html) -- vorher war es ein
                // eigener, separater .actions-row-Container direkt darunter, wodurch die
                // Buttons in zwei unabhängig rechtsbündigen Zeilen mit unterschiedlicher
                // Breite/Lücke auseinanderfielen, statt als eine zusammenhängende Gruppe mit
                // einheitlichem Abstand zu wirken.
                const extra = q('#m-extra-actions');
                let related = q('#m-related');
                if (!related) {
                    related = document.createElement('div');
                    related.id = 'm-related';
                    related.className = 'incident-linked-list';
                    actionsRow.after(related);
                }
                extra.innerHTML = t.archived ? '' : `
                    <button class="btn-secondary" id="m-link-related" type="button">${Icon('link', 16)}${Lang.t('linkRelatedButton')}</button>
                    <button class="btn-secondary" id="m-merge" type="button">${Icon('git-merge', 16)}${Lang.t('mergeButton')}</button>
                    <button class="btn-secondary" id="m-request-approval" type="button" data-module="approvals">${Icon('badge-check', 16)}Genehmigung anfordern</button>
                    <button class="btn-secondary" id="m-kb-add" type="button">${Icon('book-open', 16)}${Lang.t('takeOverAsKnowledgeArticle')}</button>`;
                const bindAction = (sel, fn) => { const el = q(sel); if (el) el.onclick = () => fn(t); };
                bindAction('#m-link-related', AdminBoard.linkRelatedTicket);
                bindAction('#m-merge', AdminBoard.mergeTicketInto);
                bindAction('#m-request-approval', AdminBoard.requestApproval);
                bindAction('#m-kb-add', AdminBoard.addSolutionToKnowledgeBase);
                const relatedIds = await Store.getRelatedTicketIds(t.id);
                const relatedTickets = relatedIds.map(id => tickets.find(x => x.id === id)).filter(Boolean);
                related.hidden = !relatedTickets.length;
                related.innerHTML = relatedTickets.length ? `
                    <h4 class="section-title">${Icon('link', 15)} Verwandte Tickets</h4>
                    <div class="incident-linked-table">${relatedTickets.map(x => `
                        <div class="incident-linked-row" data-ticket-id="${Utils.esc(x.id)}">
                            <button type="button" class="incident-linked-open">
                                <span><strong>${Utils.esc(x.ticketNumber || x.id)}</strong>${Utils.esc(x.title)}</span>
                                <span>${Utils.esc(x.authorName || x.author || '-')}</span>
                                <span>${Lang.status(x.status)}</span>
                            </button>
                            <button type="button" class="btn-ghost btn-icon btn-xs btn-danger incident-linked-unlink" title="${Lang.t('unlinkIncident')}" aria-label="${Lang.t('unlinkIncident')}">${Icon('link-2-off', 14)}</button>
                        </div>`).join('')}</div>` : '';
                related.querySelectorAll('.incident-linked-open').forEach(btn => { btn.onclick = () => AdminBoard.openModal(btn.closest('[data-ticket-id]').dataset.ticketId); });
                related.querySelectorAll('.incident-linked-unlink').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const otherId = btn.closest('[data-ticket-id]').dataset.ticketId;
                        const other = tickets.find(x => x.id === otherId);
                        UI.confirm(Lang.format('confirmUnlinkIncident', { other: `${other?.ticketNumber || otherId} · ${other?.title || ''}` }), async () => {
                            const ok = await Store.unlinkRelatedTicketIds(t.id, otherId);
                            UI.toast(ok ? Lang.t('unlinkedToast') : Lang.t('unlinkFailedToast'));
                            await AdminBoard.openModal(t.id);
                        });
                    };
                });
            }

            const btnAssignIncident = q('#btn-assign-incident');
            if (btnAssignIncident) {
                const activeIncidents = tickets.filter(x => x.isMajorIncident && !x.archived && x.status !== 'Geschlossen' && x.id !== t.id);
                btnAssignIncident.hidden = t.archived || t.isMajorIncident || t.linkedIncidentId || !activeIncidents.length;
                btnAssignIncident.onclick = async () => {
                    const choice = await UI.askIncidentLink(activeIncidents, { title: Lang.t('assignToIncidentTitle'), confirmLabel: Lang.t('assignButton') });
                    if (choice) {
                        await AdminBoard.linkTicketToIncident(t.id, choice);
                        await AdminBoard.openModal(t.id);
                    }
                };
            }

            // Archive/Re-activate logic integration
            let btnReact = q('#btn-reactivate-ticket');
            if (!btnReact && btnArch) {
                btnReact = document.createElement('button');
                btnReact.id = 'btn-reactivate-ticket';
                btnReact.className = 'btn-primary';
                btnReact.innerHTML = `${Icon('rotate-ccw', 16)}Reaktivieren`;
                btnArch.parentElement.appendChild(btnReact);
            }

            if (t.archived) {
                if (btnArch) btnArch.hidden = true;
                if (btnReact) {
                    btnReact.style.display = isSuper ? 'inline-flex' : 'none';
                    btnReact.onclick = () => AdminBoard.reactivateTicket(t.id);
                }
            } else {
                if (btnReact) btnReact.style.display = 'none';
                if (btnArch) {
                    btnArch.hidden = t.status !== 'Geschlossen';
                    btnArch.onclick = () => AdminBoard.archiveCurrent();
                }
            }

            // Disable edits if archived
            if (prioSel) prioSel.disabled = t.archived;
            if (statusSel) {
                statusSel.value = t.status;
                statusSel.disabled = t.archived;
                statusSel.onchange = async () => {
                    const newStatus = statusSel.value;
                    let waitingMessage = '';
                    if (newStatus === 'Warten auf Benutzer') {
                        const request = await AdminBoard.chooseWaitingStatus(newStatus);
                        if (!request) {
                            statusSel.value = t.status;
                            return;
                        }
                        waitingMessage = request.message;
                    }
                    const changed = await AdminBoard.changeStatus(t.id, newStatus, waitingMessage);
                    if (!changed) statusSel.value = t.status;
                };
            }
            if (catSel) catSel.disabled = t.archived;
            if (commentInput) commentInput.disabled = t.archived;
            if (commentBtn) commentBtn.disabled = t.archived;
            qa('#m-note-type input').forEach(radio => { radio.disabled = t.archived; });
            ['#m-note-format', '#m-note-bold', '#m-note-italic', '#m-note-list', '#m-note-numbered', '#m-note-table', '#m-note-file-input', '#m-note-resolution', '#m-admin-note-format', '#m-admin-note-bold', '#m-admin-note-italic', '#m-admin-note-list', '#m-admin-note-file-input'].forEach(selector => {
                const el = q(selector);
                if (el) el.disabled = t.archived;
            });
            if (q('#m-admin-new-comment')) q('#m-admin-new-comment').disabled = t.archived;
            if (q('#btn-add-admin-comment')) q('#btn-add-admin-comment').disabled = t.archived;
            if (chatInput) chatInput.disabled = t.archived || !!t.authorArchived;
            if (chatSend) chatSend.disabled = t.archived || !!t.authorArchived;

            // Metadata: Name mit Menue (Kontaktdaten oder Ticket-Historie), Einschaetzung der Person.
            AdminBoard.renderPersonMenu(q('#m-author'), { userId: t.authorUserId, name: t.authorName || t.author, username: t.author, ticketId: t.id });
            AdminBoard.renderRequestAssessment(t, '#m-assessment');
            if (q('#m-date')) q('#m-date').textContent = Utils.fmtDate(t.createdAt);

            // Lösungsfrist: Badge mit verbleibender/überschrittener Zeit, dazu ein dezenter
            // roter Rahmen ums Popup, wenn die Frist schon überschritten ist.
            const slaItem = q('#m-sla-item');
            const slaBadge = q('#m-sla-badge');
            const slaSettingsForModal = await Store.getSettings();
            const slaCountdown = Store.formatSlaCountdown(t, slaSettingsForModal);
            if (slaItem && slaBadge) {
                slaItem.hidden = !slaCountdown;
                if (slaCountdown) {
                    slaBadge.className = `sla-badge sla-badge-${slaCountdown.tone}`;
                    slaBadge.title = `Frist: ${slaCountdown.dueDateLabel}${t.customDueAt ? ' (manuell gesetzt)' : ''}`;
                    slaBadge.innerHTML = `${Icon(slaCountdown.overdue ? 'triangle-alert' : 'timer', 13)}${Utils.esc(slaCountdown.dueDateLabel)} · ${Utils.esc(slaCountdown.label)}${t.customDueAt ? ' ' + Icon('pin', 11) : ''}`;
                }
            }
            q('#ticket-modal .modal')?.classList.toggle('is-sla-overdue', !!slaCountdown?.overdue);
            const slaEditBtn = q('#m-sla-edit');
            if (slaEditBtn) slaEditBtn.onclick = () => AdminBoard.openCustomDueModal(t.id);
            const calendarEventBtn = q('#m-calendar-event-btn');
            if (calendarEventBtn) calendarEventBtn.onclick = () => AdminBoard.openCalendarEventModal(t.id);

            // Populate Priority
            if (prioSel) {
                prioSel.value = t.prio;
                prioSel.onchange = async () => {
                    const old = t.prio;
                    t.prio = prioSel.value;
                    await Store.addLog(t, `Priorität geändert von ${old} zu ${t.prio}`);
                    await Store.saveTickets(tickets);
                    // Hinweis an den Ersteller ("Ticket bearbeitet") entsteht serverseitig.
                    await AdminBoard.render();
                };
            }

            // Populate Category with Custom Multi-Select
            const msContainer = q('#m-cat-container');
            if (msContainer) {
                const settings = await Store.getSettings();
                const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
                const currentCats = Array.isArray(t.category) ? t.category : [t.category || 'Allgemein'];

                UI.createMultiSelect(msContainer, categories, currentCats, async (newCats) => {
                    if (t.archived) return; // Read-only check
                    const old = Array.isArray(t.category) ? t.category.join(', ') : (t.category || '-');
                    t.category = newCats.length > 0 ? newCats : ['Allgemein'];

                    await Store.addLog(t, `Kategorien geändert`, `Alt: ${old} -> Neu: ${t.category.join(', ')}`);
                    await Store.saveTickets(tickets);
                    await Store.addGlobalLog('Ticket Kategorien geändert', `Ticket: ${t.title}, Kategorien: ${t.category.join(', ')}`);
                    await AdminBoard.setupMentionAutocomplete(t);
                    await AdminBoard.render();
                    UI.toast('Kategorien aktualisiert');
                });

                msContainer.classList.toggle('is-disabled', !!t.archived);
            }

            // Reset Tabs
            q('.tab-btn[data-tab="details"]').click();

            // History Sidebar refresh if already open
            const sidebar = q('#m-history-sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                await AdminBoard.renderHistory(t.author, id);
            }

            // --- Multi-Select Assignment ---
            const allUsers = await Store.getUsers();

            await AdminBoard.ensureResponsibilitySection(t, allUsers, tickets);
            await AdminBoard.setupMentionAutocomplete(t);

            // Entwuerfe und Bearbeitungsmodus nie in ein anderes Ticket mitnehmen.
            AdminBoard.noteFiles = { 'admin-chat': [], solution: [] };
            AdminBoard.resetNoteComposer('admin-chat');
            AdminBoard.resetNoteComposer('solution');
            AdminBoard.renderInternalComments(t, 'admin-chat');
            AdminBoard.renderInternalComments(t, 'solution');
            await AdminBoard.renderChat(t, '#m-chat-msgs');

            if (btnLogs) btnLogs.onclick = () => UI.showLogs(t.id);

            q('#ticket-modal').classList.add('open');
        } catch (e) {
            console.error('Error opening modal:', e);
            UI.toast(Lang.t('errorOpeningTicket'));
        }
    },

    // Direkter PATCH statt ueber die Volllisten-Diff (Store.saveTickets): archivierte Tickets
    // stehen gar nicht in Store.getTickets() (siehe getArchivedTickets), waeren im Diff also nie
    // gefunden worden.
    reactivateTicket: (id) => {
        UI.confirm(Lang.t('confirmReactivateTicket'), async () => {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}`, {
                method: 'PATCH', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ archived: false, status: 'In Bearbeitung' })
            }).catch(() => null);
            if (!res || !res.ok) return UI.toast('Reaktivieren fehlgeschlagen.');
            Store._ticketsCache = null;
            await AdminBoard.openModal(id);
            await AdminBoard.render();
            UI.toast('Ticket reaktiviert');
        });
    },

    // Ungesendete Texte in Chat, interner Kommunikation oder Loesung?
    // Dauerhaft sichtbare Ticketnummer mit kopierbarem Link (oeffnet das Ticket direkt).
    ensureTicketLinkButton: (ticket) => {
        let btn = q('#m-copy-link');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'm-copy-link';
            btn.type = 'button';
            btn.className = 'btn-ghost btn-icon';
            btn.innerHTML = Icon('link', 16);
            q('#m-print')?.before(btn);
            if (window.lucide) lucide.createIcons();
        }
        btn.title = Lang.t('copyTicketLink');
        btn.setAttribute('aria-label', Lang.t('copyTicketLink'));
        btn.onclick = async () => {
            const url = new URL('/admin.html', location.origin);
            url.searchParams.set('ticket', ticket.id);
            try { await navigator.clipboard.writeText(url.toString()); UI.toast(Lang.format('ticketLinkCopied', { number: ticket.ticketNumber || ticket.id })); }
            catch { UI.toast(url.toString()); }
        };
    },
    unsentTicketInput: () => ['#m-chat-input', '#m-admin-new-comment', '#m-new-comment'].some(selector => (q(selector)?.value || '').trim()),
    closeModal: (event) => {
        if (event !== 'force' && AdminBoard.unsentTicketInput()) {
            UI.confirm(Lang.t('ticketUnsentConfirm'), () => {
                ['#m-chat-input', '#m-admin-new-comment', '#m-new-comment'].forEach(selector => { if (q(selector)) q(selector).value = ''; });
                AdminBoard.closeModal('force');
            });
            return;
        }
        q('#ticket-modal').classList.remove('open');
        if (q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
        const sidebar = q('#m-history-sidebar');
        if (sidebar) sidebar.classList.remove('open');
        AdminBoard.currentTicketId = null;
    },

    // "Wer ist betroffen?" und "Wie dringend?" deutlich sichtbar (Stufe 1..3 farblich abgesetzt).
    renderRequestAssessment: (ticket, selector) => {
        const box = q(selector);
        if (!box) return;
        const impactKeys = { 1: 'impactMe', 2: 'impactTeam', 3: 'impactDepartment' };
        const urgencyKeys = { 1: 'urgencyLow', 2: 'urgencyMedium', 3: 'urgencyHigh' };
        const impact = impactKeys[ticket?.impact];
        const urgency = urgencyKeys[ticket?.urgency];
        box.hidden = !impact && !urgency;
        if (box.hidden) { box.innerHTML = ''; return; }
        const chip = (icon, label, value, level) => `<div class="assessment-chip level-${level}">
            <span class="assessment-icon">${Icon(icon, 18)}</span>
            <span class="assessment-text"><small>${Utils.esc(Lang.t(label))}</small><strong>${Utils.esc(Lang.t(value))}</strong></span>
            <span class="assessment-level" aria-label="${Utils.esc(Lang.format('assessmentLevel', { level }))}">${[1, 2, 3].map(step => `<i class="${step <= level ? 'on' : ''}"></i>`).join('')}</span>
        </div>`;
        box.innerHTML = `${impact ? chip('users', 'impactQuestion', impact, ticket.impact) : ''}${urgency ? chip('gauge', 'urgencyQuestion', urgency, ticket.urgency) : ''}`;
        if (window.lucide) lucide.createIcons();
    },

    // Name einer Person mit Ausklappmenue (Hover, Fokus oder Klick): Kontaktdaten oder Ticket-Historie.
    renderPersonMenu: (el, { userId, name, username, ticketId }) => {
        if (!el) return;
        el.classList.remove('link');
        el.removeAttribute('title');
        el.onclick = null;
        el.innerHTML = `<span class="person-menu">
            <button type="button" class="person-menu-trigger" aria-haspopup="menu" aria-expanded="false">${Icon('user-round', 14)}<span>${Utils.esc(name || username || '-')}</span>${Icon('chevron-down', 13)}</button>
            <span class="person-menu-list" role="menu">
                ${userId ? `<button type="button" role="menuitem" data-act="contact">${Icon('contact-round', 15)}<span>${Utils.esc(Lang.t('showContactDetails'))}</span></button>` : ''}
                <button type="button" role="menuitem" data-act="history">${Icon('history', 15)}<span>${Utils.esc(Lang.t('showTicketHistory'))}</span></button>
            </span>
        </span>`;
        const menu = el.querySelector('.person-menu');
        const trigger = el.querySelector('.person-menu-trigger');
        const setOpen = open => { menu.classList.toggle('is-open', open); trigger.setAttribute('aria-expanded', String(open)); };
        trigger.onclick = event => { event.stopPropagation(); setOpen(!menu.classList.contains('is-open')); };
        menu.addEventListener('mouseleave', () => setOpen(false));
        menu.addEventListener('keydown', event => { if (event.key === 'Escape') { setOpen(false); trigger.focus(); } });
        menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) setOpen(false); });
        menu.querySelector('[data-act="contact"]')?.addEventListener('click', () => { setOpen(false); AdminBoard.openContactCard(userId, { username, ticketId }); });
        menu.querySelector('[data-act="history"]').addEventListener('click', () => { setOpen(false); AdminBoard.renderHistory(username, ticketId); });
        if (window.lucide) lucide.createIcons();
    },

    // Kontaktkarte: nur die Angaben, die Systemeinstellungen > Kontaktdaten fuer die eigene Person freigeben.
    openContactCard: async (userId, { username = '', ticketId = null } = {}) => {
        const card = await Store.getContactCard(userId);
        if (!card) return UI.toast(Lang.t('contactCardFailed'));
        const f = card.fields || {};
        const days = [1, 2, 3, 4, 5, 6, 0];
        const workTimes = f.workTimes ? days.filter(day => f.workTimes[day]).map(day => `${Lang.t(`uwDay${day}`)} ${f.workTimes[day].start}–${f.workTimes[day].end}`).join(', ') : '';
        const tel = value => String(value).replace(/[^\d+]/g, '');
        const rows = (list) => list.filter(([, value]) => value).map(([label, value, href]) => `<div><dt>${Utils.esc(Lang.t(label))}</dt><dd>${href ? `<a href="${Utils.esc(href)}">${Utils.esc(value)}</a>` : Utils.esc(value)}</dd></div>`).join('');
        const sections = [
            ['contactSectionContact', 'phone', rows([['email', f.email, f.email ? `mailto:${encodeURIComponent(f.email).replace(/%40/g, '@')}` : ''], ['phone', f.phone, f.phone ? `tel:${tel(f.phone)}` : ''], ['mobile', f.mobile, f.mobile ? `tel:${tel(f.mobile)}` : '']])],
            ['contactSectionOrg', 'building-2', rows([['uwDepartment', f.department], ['jobTitle', f.jobTitle], ['supervisor', f.supervisor], ['userGroupsLabel', (f.groups || []).join(', ')],
                ['uwOffice', f.officeLocation], ['uwBuilding', f.building], ['uwRoom', f.room], ['uwEmployeeNumber', f.employeeNumber], ['uwCostCenter', f.costCenter],
                ['uwEntryDate', f.entryDate ? f.entryDate.split('-').reverse().join('.') : '']])],
            ['contactSectionAvailability', 'clock', rows([['uwWorkDays', workTimes], ['uwAvailability', f.availability]])]
        ].filter(([, , html]) => html);
        const modal = AdminBoard.openDialog({
            id: 'contact-card-modal',
            title: card.name || card.username,
            icon: 'contact-round',
            size: 'sm',
            body: `
                <div class="contact-card-head">
                    ${(Utils.setAvatar(card, card.avatar), Utils.avatarImg(card.username, 'contact-card-avatar'))}
                    <div><strong>${Utils.esc(card.name || card.username)}</strong>
                        <span class="hint">${Utils.esc(card.username)} · ${Utils.esc({ user: 'User', admin: 'Admin', superadmin: 'Superadmin' }[card.role] || card.role)}${card.account_archived ? ` · ${Utils.esc(Lang.t('archived'))}` : ''}</span></div>
                </div>
                ${sections.length ? sections.map(([label, icon, html]) => `<div class="contact-card-section"><h4>${Icon(icon, 14)}${Utils.esc(Lang.t(label))}</h4><dl class="uw-review-list">${html}</dl></div>`).join('')
                    : `<div class="empty-state compact">${Utils.esc(Lang.t('contactCardEmpty'))}</div>`}
                <div class="contact-card-actions"><button type="button" class="btn-secondary btn-sm" id="cc-history">${Icon('history', 15)}${Utils.esc(Lang.t('showTicketHistory'))}</button></div>`
        });
        modal.querySelector('#cc-history').onclick = () => { modal.remove(); AdminBoard.renderHistory(username || card.username, ticketId); };
        if (window.lucide) lucide.createIcons();
    },

    renderHistory: async (username, currentId) => {
        const sidebar = q('#m-history-sidebar');
        if (!sidebar) return;

        sidebar.classList.add('open');

        // Initialize header if needed
        let searchInput = q('#m-history-search');
        if (!searchInput) {
            sidebar.innerHTML = `
                <div class="sidebar-header">
                    <div class="sidebar-title-row">
                        <span class="panel-title">${Icon('history', 16)}Ticket-Historie</span>
                        <button class="btn-ghost btn-icon" id="m-history-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                    <div class="history-search-wrap">
                        <input type="text" id="m-history-search" class="history-search-input" placeholder="Historie durchsuchen...">
                        <span class="history-search-icon">${Icon('search', 14)}</span>
                    </div>
                </div>
                <div class="sidebar-content"></div>
            `;
            searchInput = q('#m-history-search');
            searchInput.oninput = () => AdminBoard.renderHistory(username, currentId);

            const closeBtn = q('#m-history-close');
            closeBtn.onclick = () => {
                sidebar.classList.remove('open');
            };
            if (window.lucide) lucide.createIcons();
        }

        const content = sidebar.querySelector('.sidebar-content');
        if (!content) return;

        const renderToken = AdminBoard.historyRenderToken = (AdminBoard.historyRenderToken || 0) + 1;
        const words = searchInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        content.innerHTML = '';

        const tickets = (await Store.getTickets())
            .filter(x => x.author === username)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (renderToken !== AdminBoard.historyRenderToken) return;

        const haystackOf = t => [
            t.ticketNumber, t.id, t.title, t.desc, Lang.status(t.status), t.status,
            ...(Array.isArray(t.category) ? t.category : [t.category]),
            t.authorName, Utils.fmtDate(t.createdAt)
        ].filter(Boolean).join(' ').toLowerCase();
        const filtered = tickets.filter(t => words.every(word => haystackOf(t).includes(word)));

        if (filtered.length === 0) {
            content.innerHTML = `<div class="empty-state">${words.length ? 'Keine Treffer' : 'Keine Historie vorhanden'}</div>`;
            return;
        }

        filtered.forEach(ticket => {
            const card = document.createElement('div');
            card.className = 'history-card' + (ticket.id === currentId ? ' active' : '') + (ticket.archived ? ' archived' : '');

            const isActive = !ticket.archived && ticket.status !== 'Geschlossen';

            card.innerHTML = `
                <div class="history-title">${Utils.esc(ticket.title)}</div>
                <div class="history-meta">
                    <span>${Utils.fmtDate(ticket.createdAt).split(' ')[0]}</span>
                    <span>${Lang.status(ticket.status)}</span>
                </div>
                ${isActive ? `<span class="history-badge">Aktiv</span>` : ''}
            `;

            card.onclick = () => AdminBoard.openModal(ticket.id);
            content.appendChild(card);
        });
        if (window.lucide) lucide.createIcons();
    },

    // Interne Kommunikation als ruhiger, chronologischer Verlauf (neueste unten, direkt ueber dem
    // Eingabefeld); die Loesungsdokumentation gegliedert nach endgueltiger Loesung, Ursache, Massnahmen.
    renderInternalComments: async (t, channel = 'solution') => {
        const isChat = channel === 'admin-chat';
        const prefix = isChat ? 'm-admin-note' : 'm-note';
        const box = q(isChat ? '#m-admin-comments' : '#m-comments');
        if (!box || !t) return;
        const mentionUsers = await Store.getUsers();
        const mentionRegex = Utils.buildMentionRegex(mentionUsers);
        const highlightMentions = (html) => mentionRegex ? html.replace(mentionRegex, (full, matched) => {
            const found = mentionUsers.find(u => u.username === matched || u.name === matched);
            return found ? `<span class="mention">@${Utils.esc(found.name || found.username)}</span>` : full;
        }) : html;
        const searchWrap = q(`#${prefix}-search-wrap`);
        const searchInput = q(`#${prefix}-search`);

        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/notes`, { credentials: 'same-origin' }).catch(() => null);
        const allNotes = res && res.ok ? (await res.json()).notes || [] : [];
        AdminBoard._currentNotes = allNotes;
        const commentsRaw = allNotes.filter(n => n.stream === channel);

        const countSelector = isChat ? '#m-admin-note-count' : '#m-solution-note-count';
        if (q(countSelector)) q(countSelector).textContent = String(commentsRaw.length);
        // Suche erst ab mehr als 6 Eintraegen (oder solange noch ein Suchbegriff eingegeben ist).
        if (commentsRaw.length === 0 && searchInput) searchInput.value = '';
        if (searchWrap) searchWrap.style.display = commentsRaw.length > 6 || searchInput?.value ? 'flex' : 'none';
        box.innerHTML = '';
        if (commentsRaw.length === 0) {
            box.innerHTML = isChat
                ? `<div class="empty-state compact">${Utils.esc(Lang.t('noInternalMessagesYet'))}</div>`
                : `<div class="solution-empty">${Icon('clipboard-list', 28)}<strong>${Utils.esc(Lang.t('noSolutionAttemptsYet'))}</strong><span>${Utils.esc(Lang.t('solutionEmptyHint'))}</span></div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }
        const renderText = (value = '') => highlightMentions(Utils.renderMarkdown(value));
        const query = (searchInput?.value || '').toLowerCase().trim();
        const comments = commentsRaw
            .filter(c => !query || [c.content, c.author_name, c.author_username, c.note_type, Utils.fmtDate(c.created_at)].join(' ').toLowerCase().includes(query))
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (comments.length === 0) {
            box.innerHTML = `<div class="empty-state compact">${Utils.esc(Lang.t('noMatchingInternalComments'))}</div>`;
            return;
        }
        const nameOf = c => c.author_name || c.author_username || '–';
        const avatar = (c, cls) => Utils.avatarImg(c.author_user_id || c.author_username, cls);
        const edited = c => c.edited_at
            ? `<span class="note-edited" title="${Utils.esc(Lang.format('editedAt', { date: Utils.fmtDate(c.edited_at) }))}">${Utils.esc(Lang.t('edited'))}</span>`
            : '';
        const files = c => (c.attachments || []).length
            ? `<div class="note-files">${c.attachments.map(file => `<button type="button" class="file-chip note-att" data-id="${Utils.esc(file.id)}" data-name="${Utils.esc(file.name)}" data-size="${Number(file.size) || 0}">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span></button>`).join('')}</div>`
            : '';
        const editButton = `<button type="button" class="btn-ghost btn-icon btn-xs note-edit" title="${Utils.esc(Lang.t('editComment'))}" aria-label="${Utils.esc(Lang.t('editComment'))}">${Icon('pencil', 13)}</button>`;
        const bind = (item, c) => {
            item.querySelector('.note-edit').addEventListener('click', () => AdminBoard.editInternalComment(c.id, channel));
            item.querySelectorAll('.note-att').forEach(btn => btn.addEventListener('click', () =>
                AdminBoard.openAttachmentPreview({ attachmentId: btn.dataset.id, name: btn.dataset.name, size: Number(btn.dataset.size) || 0 })));
        };
        if (isChat) {
            let previous = null;
            comments.forEach(c => {
                // Folgenachrichten derselben Person innerhalb von 5 Minuten ohne erneuten Kopf.
                const continued = !!previous && previous.author_username === c.author_username && !query
                    && new Date(c.created_at) - new Date(previous.created_at) < 5 * 60 * 1000;
                const item = document.createElement('div');
                item.dataset.id = c.id;
                item.className = `tl-item${continued ? ' is-continued' : ''}${c.is_pinned ? ' is-pinned' : ''}`;
                item.innerHTML = `
                    <div class="tl-avatar-slot">${continued ? '' : avatar(c, 'tl-avatar')}</div>
                    <div class="tl-main">
                        <div class="tl-head"${continued ? ' hidden' : ''}><strong>${Utils.esc(nameOf(c))}</strong><time datetime="${Utils.esc(c.created_at)}">${Utils.esc(Utils.fmtDate(c.created_at))}</time>${edited(c)}${c.is_pinned ? `<span class="tl-pin" title="${Utils.esc(Lang.t('pin'))}">${Icon('pin', 12)}</span>` : ''}</div>
                        <div class="tl-body note-body">${renderText(c.content)}</div>
                        ${continued && c.edited_at ? `<div class="tl-edited">${edited(c)}</div>` : ''}
                        ${files(c)}
                    </div>
                    <div class="tl-actions">${editButton}</div>`;
                bind(item, c);
                box.appendChild(item);
                previous = c;
            });
        } else {
            const groups = [
                { key: 'Ursache', label: Lang.t('noteTypeCause'), icon: 'search', tone: 'cause' },
                { key: 'Maßnahme', label: Lang.t('solutionGroupMeasures'), icon: 'wrench', tone: 'measure', numbered: true },
                { key: 'Lösung', label: Lang.t('noteTypeSolution'), icon: 'lightbulb', tone: 'solution' },
                { key: null, label: Lang.t('solutionGroupOther'), icon: 'notebook-pen', tone: 'other' }
            ];
            const known = new Set(groups.map(group => group.key).filter(Boolean));
            const entry = (c, step = 0) => {
                const item = document.createElement('article');
                item.className = 'solution-entry';
                item.dataset.id = c.id;
                // Aeltere Eintragsarten (z.B. "Analyse") bleiben als Kennzeichnung sichtbar.
                const legacyType = c.note_type && !known.has(c.note_type) && !['note', 'Notiz'].includes(c.note_type)
                    ? `<span class="note-type">${Utils.esc(c.note_type)}</span>` : '';
                item.innerHTML = `
                    ${step ? `<span class="solution-step" aria-hidden="true">${step}</span>` : ''}
                    <div class="solution-entry-main">
                        <header class="solution-entry-head">
                            ${legacyType}
                            <span class="solution-entry-meta">${avatar(c, 'solution-avatar')}<strong>${Utils.esc(nameOf(c))}</strong><time datetime="${Utils.esc(c.created_at)}">${Utils.esc(Utils.fmtDate(c.created_at))}</time>${edited(c)}</span>
                            ${editButton}
                        </header>
                        <div class="note-body">${renderText(c.content)}</div>
                        ${files(c)}
                    </div>`;
                bind(item, c);
                return item;
            };
            const section = (cls, title) => {
                const el = document.createElement('section');
                el.className = cls;
                el.innerHTML = title;
                box.appendChild(el);
                return el;
            };
            const finals = comments.filter(c => c.is_resolution);
            if (finals.length) {
                const panel = section('solution-final', `<h5 class="solution-group-title">${Icon('circle-check-big', 16)}<span>${Utils.esc(Lang.t('finalSolution'))}</span></h5>`);
                finals.forEach(c => panel.appendChild(entry(c)));
            }
            const rest = comments.filter(c => !c.is_resolution);
            groups.forEach(group => {
                const items = rest.filter(c => group.key ? c.note_type === group.key : !known.has(c.note_type));
                if (!items.length) return;
                const el = section(`solution-group tone-${group.tone}`,
                    `<h5 class="solution-group-title">${Icon(group.icon, 15)}<span>${Utils.esc(group.label)}</span><span class="solution-group-count">${items.length}</span></h5>`);
                items.forEach((c, index) => el.appendChild(entry(c, group.numbered ? index + 1 : 0)));
            });
        }
        box.scrollTop = isChat ? box.scrollHeight : 0;
        if (window.lucide) lucide.createIcons();
    },

    // "Als endgueltige Loesung markieren" gibt es nur fuer Eintraege der Art Loesung.
    syncSolutionType: () => {
        const isSolution = q('#m-note-type input:checked')?.value === 'Lösung';
        const option = q('#m-note-resolution-option');
        if (option) option.hidden = !isSolution;
        if (!isSolution && q('#m-note-resolution')) q('#m-note-resolution').checked = false;
    },

    renderNoteFilePreview: (channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const files = AdminBoard.noteFiles[channel];
        const pan = q(`#${prefix}-file-preview`);
        if (!pan) return;
        pan.innerHTML = '';
        pan.style.display = files.length ? 'flex' : 'none';
        files.forEach((f, idx) => pan.appendChild(AdminBoard.stagedFileChip(f, () => {
            files.splice(idx, 1);
            AdminBoard.renderNoteFilePreview(channel);
        })));
        if (window.lucide) lucide.createIcons();
    },

    // Beschriftung des Speichern-Knopfs je Bereich und Modus (neu / Bearbeitung).
    setNoteComposerMode: (channel, editId = null) => {
        const isChat = channel === 'admin-chat';
        const saveBtn = q(isChat ? '#btn-add-admin-comment' : '#btn-add-comment');
        if (saveBtn) {
            if (editId) saveBtn.dataset.editId = editId; else delete saveBtn.dataset.editId;
            const icon = editId ? 'save' : (isChat ? 'send' : 'plus');
            const label = editId ? Lang.t('saveChanges') : (isChat ? Lang.t('send') : Lang.t('addSolutionEntry'));
            saveBtn.innerHTML = `${Icon(icon, 16)}<span>${Utils.esc(label)}</span>`;
        }
        const cancel = q(`#${isChat ? 'm-admin-note' : 'm-note'}-cancel`);
        if (cancel) cancel.hidden = !editId;
        if (window.lucide) lucide.createIcons();
    },

    resetNoteComposer: (channel) => {
        const isChat = channel === 'admin-chat';
        const input = q(isChat ? '#m-admin-new-comment' : '#m-new-comment');
        if (input) input.value = '';
        if (!isChat && q('#m-note-resolution')) q('#m-note-resolution').checked = false;
        if (!isChat) {
            if (!q('#m-note-type input:checked')) { const fallback = q('#m-note-type input[value="Maßnahme"]'); if (fallback) fallback.checked = true; }
            AdminBoard.syncSolutionType();
        }
        if (isChat && q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
        AdminBoard.noteFiles[channel] = [];
        AdminBoard.renderNoteFilePreview(channel);
        AdminBoard.setNoteComposerMode(channel, null);
    },

    editInternalComment: async (noteId, channel = 'solution') => {
        const note = (AdminBoard._currentNotes || []).find(n => n.id === noteId);
        if (!note) return;
        const isChat = channel === 'admin-chat';
        const input = q(isChat ? '#m-admin-new-comment' : '#m-new-comment');
        input.value = note.content || '';
        if (!isChat) {
            // Aeltere Eintragsarten (z.B. "Analyse") haben keine Auswahl und bleiben beim Speichern erhalten.
            qa('#m-note-type input').forEach(radio => { radio.checked = radio.value === note.note_type; });
            AdminBoard.syncSolutionType();
            if (q('#m-note-resolution')) q('#m-note-resolution').checked = !!note.is_resolution && note.note_type === 'Lösung';
        }
        AdminBoard.setNoteComposerMode(channel, noteId);
        input.focus();
    },

    // Speichert ueber /api/v2/tickets/:id/notes (bzw. PATCH beim Bearbeiten) und laedt danach die
    // ausgewaehlten Dateien als Anhang genau dieser Notiz hoch.
    postInternalComment: async (channel = 'solution') => {
        const isChat = channel === 'admin-chat';
        const input = q(isChat ? '#m-admin-new-comment' : '#m-new-comment');
        const saveBtn = q(isChat ? '#btn-add-admin-comment' : '#btn-add-comment');
        const txt = input?.value.trim();
        if (!txt) return input?.focus();
        const editId = saveBtn?.dataset.editId || null;
        const existing = editId ? (AdminBoard._currentNotes || []).find(n => n.id === editId) : null;
        const id = AdminBoard.currentTicketId;
        // Interne Nachrichten ohne Kategorie; Loesungseintraege mit strukturierter Art. Bestehende
        // Markierungen (z.B. frueher angepinnte Eintraege) bleiben beim Bearbeiten erhalten.
        const pickedType = isChat ? null : q('#m-note-type input:checked')?.value;
        const body = {
            content: txt,
            note_type: isChat ? (existing?.note_type || 'Notiz') : (pickedType || existing?.note_type || 'Maßnahme'),
            is_pinned: !!existing?.is_pinned,
            is_resolution: !isChat && (pickedType ? pickedType === 'Lösung' && !!q('#m-note-resolution')?.checked : !!existing?.is_resolution)
        };
        if (!editId) body.stream = channel;
        if (saveBtn) saveBtn.disabled = true;
        try {
            const res = await fetch(
                editId ? `/api/v2/tickets/${encodeURIComponent(id)}/notes/${encodeURIComponent(editId)}` : `/api/v2/tickets/${encodeURIComponent(id)}/notes`,
                { method: editId ? 'PATCH' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            ).catch(() => null);
            if (!res || !res.ok) return UI.toast(Lang.t('saveFailed'));
            const noteId = editId || (await res.json().catch(() => ({}))).note?.id;
            const { errors } = await Store.uploadFiles([...(AdminBoard.noteFiles[channel] || [])], file => Store.saveAttachment(file, { ticketId: id, noteId }));
            if (errors.length) UI.toast(Lang.format('noteSavedAttachmentsFailed', { details: errors.join(' ') }));
            AdminBoard.resetNoteComposer(channel);
            const t = (await Store.getTickets()).find(x => x.id === id) || await Store.getTicketById(id);
            await AdminBoard.renderInternalComments(t, channel);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    },

    editChatMessage: async (ticketId, messageId, containerSelector) => {
        const message = (AdminBoard._currentChatMessages || []).find(m => m.id === messageId);
        const user = await Store.currentUser();
        if (!message || !user) return;
        if (message.sender_user_id !== user.id) return UI.toast('Du kannst nur eigene Nachrichten bearbeiten.');
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        modal.querySelector('.modal').classList.replace('modal-sm', 'modal-md');
        modal.querySelector('.modal-header h3').textContent = 'Chatnachricht bearbeiten';
        modal.querySelector('.modal-body').innerHTML = '<div class="field"><label for="edit-chat-message">Nachricht</label><textarea id="edit-chat-message" rows="7"></textarea></div>';
        q('#edit-chat-message').value = message.content || '';
        const saveButton = modal.querySelector('.modal-footer .btn-primary');
        saveButton.textContent = 'Speichern';
        saveButton.onclick = async () => {
            const nextText = q('#edit-chat-message').value.trim();
            if (!nextText) return UI.toast('Die Nachricht darf nicht leer sein.');
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticketId)}/messages/${encodeURIComponent(messageId)}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: nextText })
            }).catch(() => null);
            if (!res || !res.ok) return UI.toast('Bearbeiten fehlgeschlagen.');
            modal.classList.remove('open');
            const ticket = (await Store.getTickets()).find(x => x.id === ticketId);
            await AdminBoard.renderChat(ticket, containerSelector);
        };
        modal.classList.add('open');
        q('#edit-chat-message').focus();
    },

    // data: URIs werden von Chrome in iframes/embed häufig blockiert ("Diese Seite wurde von
    // Chrome blockiert"). blob:-URLs aus demselben Origin sind davon nicht betroffen -- daher
    // wird jeder Anhang vor der Anzeige einmal in ein Blob umgewandelt.
    dataUriToBlob: (dataUri, mime) => {
        const commaIdx = dataUri.indexOf(',');
        const meta = dataUri.slice(5, commaIdx);
        const isBase64 = meta.includes(';base64');
        const payload = dataUri.slice(commaIdx + 1);
        const byteString = isBase64 ? atob(payload) : decodeURIComponent(payload);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
        return new Blob([bytes], { type: mime || meta.split(';')[0] || 'application/octet-stream' });
    },
    dataUriToBlobUrl: (dataUri, mime) => {
        return URL.createObjectURL(AdminBoard.dataUriToBlob(dataUri, mime));
    },

    openAttachmentPreview: async (file) => {
        if (file?.size > 15 * 1024 * 1024) {
            UI.confirm(Lang.t('largeAttachmentDownload'), () => {
                // CodeQL js/xss-through-dom #15-#17: nur serverseitige Anhaenge (validierte ID) landen
                // im href -- lokal ausgewaehlte Dateien (File/Blob) fliessen nie in eine URL.
                if (file instanceof Blob) return UI.toast(Lang.t('largeLocalFileNoPreview'));
                const rawId = String(file?.attachmentId || file?.id || '');
                if (!/^[A-Za-z0-9_-]+$/.test(rawId)) return UI.toast('Ungültige Anhang-ID.');
                const link = document.createElement('a');
                link.href = `/api/v2/uploads/${encodeURIComponent(rawId)}/content`;
                link.download = file.name || 'Anhang'; document.body.appendChild(link); link.click(); link.remove();
            }, file.name || Lang.t('attachment'));
            return;
        }
        let attachment = file;
        if (!attachment?.data && (attachment?.attachmentId || attachment?.id)) {
            attachment = await Store.getAttachment(attachment.attachmentId || attachment.id);
        }
        if (!attachment?.data) return UI.toast('Anhang nicht gefunden.');
        AdminBoard._pdfViewer?.destroy(); AdminBoard._pdfViewer = null;
        if (AdminBoard._lastPreviewBlobUrl) {
            URL.revokeObjectURL(AdminBoard._lastPreviewBlobUrl);
            AdminBoard._lastPreviewBlobUrl = null;
        }
        let blobUrl = null;
        let previewBlob = null;
        try {
            previewBlob = AdminBoard.dataUriToBlob(attachment.data, attachment.type);
            blobUrl = URL.createObjectURL(previewBlob);
            AdminBoard._lastPreviewBlobUrl = blobUrl;
        } catch (error) {
            console.error(error);
        }

        let modal = q('#attachment-preview-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'attachment-preview-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-xl attachment-preview-modal">
                    <div class="modal-header">
                        <h3 id="attachment-preview-title"></h3>
                        <div class="modal-actions">
                            <a class="btn-ghost btn-icon" id="attachment-preview-open" target="_blank" rel="noopener" title="${Lang.t('openInNewTab')}" aria-label="${Lang.t('openInNewTab')}">${Icon('external-link', 16)}</a>
                            <a class="btn-ghost btn-icon" id="attachment-preview-download" title="${Lang.t('download')}" aria-label="${Lang.t('download')}">${Icon('download', 16)}</a>
                            <button class="btn-ghost btn-icon" data-close-preview title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body attachment-preview-body" id="attachment-preview-body"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('[data-close-preview]').onclick = () => { modal.classList.remove('open'); AdminBoard._pdfViewer?.destroy(); AdminBoard._pdfViewer = null; };
            modal.onclick = event => {
                if (event.target === modal) modal.querySelector('[data-close-preview]').click();
            };
        }
        modal.classList.add('modal-top');
        document.body.appendChild(modal);
        const name = String(attachment.name || '').toLowerCase();
        const mime = attachment.type || 'application/octet-stream';
        q('#attachment-preview-title').textContent = attachment.name || Lang.t('attachment');
        const topDownload = q('#attachment-preview-download');
        const topOpen = q('#attachment-preview-open');
        const previewSrc = blobUrl || attachment.data;
        if (topDownload) {
            topDownload.href = previewSrc;
            topDownload.download = attachment.name || Lang.t('attachment');
        }
        if (topOpen) {
            topOpen.href = previewSrc;
            topOpen.style.display = 'inline-flex';
        }
        const body = q('#attachment-preview-body');
        body.replaceChildren();
        modal.classList.add('open');
        const savedId = attachment.attachmentId || attachment.id;
        if (savedId && /\.(docx|doc|odt|xlsx|xls|ods|pptx|ppt|odp)$/.test(name)) {
            const officeResponse = await fetch(`/api/v2/attachments/${encodeURIComponent(savedId)}/office-config`, { credentials: 'same-origin' }).catch(() => null);
            const office = officeResponse?.ok ? await officeResponse.json() : null;
            if (office?.enabled) {
                const frame = document.createElement('iframe'); frame.className = 'office-document-frame'; frame.title = attachment.name || 'Office';
                frame.src = `/api/v2/attachments/${encodeURIComponent(savedId)}/office-view`; body.appendChild(frame);
                topOpen.href = frame.src;
                return;
            }
        }
        if (savedId && /\.(pdf|docx|doc|odt|xlsx|xls|ods|pptx|ppt|odp)$/.test(name)) {
            const documentUrl = `/api/v2/attachments/${encodeURIComponent(savedId)}/preview`;
            body.textContent = Lang.t('documentPreviewGenerating');
            try {
                const response = await fetch(documentUrl, { credentials: 'same-origin' });
                if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('preview_unavailable');
                AdminBoard._pdfViewer = await renderPdfPreview(await response.arrayBuffer(), body);
                topOpen.href = documentUrl;
                if (window.lucide) lucide.createIcons();
                return;
            } catch {
                body.replaceChildren();
                const hint = document.createElement('p'); hint.className = 'callout';
                hint.textContent = Lang.t('documentViewUnavailableHint');
                body.appendChild(hint);
            }
        }
        const addText = text => {
            const pre = document.createElement('pre');
            pre.className = 'attachment-text-preview';
            pre.textContent = text;
            body.appendChild(pre);
        };
        if (mime === 'application/pdf' || name.endsWith('.pdf')) {
            if (previewBlob) {
                try { AdminBoard._pdfViewer = await renderPdfPreview(await previewBlob.arrayBuffer(), body); }
                catch { addText(Lang.t('pdfPreviewFailedHint')); }
            } else {
                const message = document.createElement('div');
                message.className = 'attachment-download-fallback';
                message.innerHTML = `${Icon('file-text', 28)}<strong>${Lang.t('pdfPreviewFailedShort')}</strong><span>${Lang.t('useOpenOrDownloadIcon')}</span>`;
                body.appendChild(message);
            }
        } else if (mime.startsWith('image/')) {
            const image = document.createElement('img');
            image.className = 'attachment-image-preview';
            image.src = previewSrc;
            image.alt = attachment.name || Lang.t('imageAttachment');
            body.append(image);
        } else if (/\.(txt|csv|tsv|json|xml|md|log|html?)$/.test(name) || mime.startsWith('text/')) {
            try {
                addText(previewBlob ? await previewBlob.text() : Lang.t('fileCannotBeReadAsText'));
            } catch {
                addText(Lang.t('fileCannotBeReadAsText'));
            }
        } else if (/\.(docx|xlsx|xls|pptx)$/.test(name)) {
            try {
                // Diese drei Bibliotheken sind zusammen >1,6 MB und werden nur fuer die
                // Vorschau genau dieses Dateityps gebraucht -- deshalb erst hier, nicht mehr
                // auf jedem Seitenaufruf blockierend im <head>, nachladen (siehe Utils.loadVendorScript).
                if (name.endsWith('.docx') && !window.mammoth) await Utils.loadVendorScript('/vendor/mammoth.browser.min.js').catch(() => {});
                else if (/\.(xlsx|xls)$/.test(name) && !window.XLSX) await Utils.loadVendorScript('/vendor/xlsx.full.min.js').catch(() => {});
                else if (name.endsWith('.pptx') && !window.JSZip) await Utils.loadVendorScript('/vendor/jszip.min.js').catch(() => {});
                const buffer = previewBlob ? await previewBlob.arrayBuffer() : null;
                if (!buffer) throw new Error('preview_blob_missing');
                if (name.endsWith('.docx') && window.mammoth) {
                    const result = await window.mammoth.extractRawText({
                        arrayBuffer: buffer
                    });
                    addText(result.value || Lang.t('documentNoExtractableText'));
                } else if (/\.(xlsx|xls)$/.test(name) && window.XLSX) {
                    const workbook = window.XLSX.read(buffer, {
                        type: 'array', cellStyles: true, cellNF: true
                    });
                    renderWorkbook(workbook, body, window.XLSX);
                } else if (name.endsWith('.pptx') && window.JSZip) {
                    const archive = await window.JSZip.loadAsync(buffer);
                    const slides = Object.keys(archive.files)
                        .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
                        .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
                    for (const [index, path] of slides.entries()) {
                        const xml = await archive.files[path].async('text');
                        const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
                        const text = Array.from(documentXml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't'))
                            .map(node => node.textContent)
                            .filter(Boolean)
                            .join(' ');
                        const heading = document.createElement('h4');
                        heading.textContent = Lang.format('slideNumber', { n: index + 1 });
                        const paragraph = document.createElement('p');
                        paragraph.textContent = text || Lang.t('noTextOnSlide');
                        body.append(heading, paragraph);
                    }
                } else {
                    addText(Lang.t('officePreviewFailed'));
                }
            } catch {
                addText(Lang.t('fileCouldNotBeOpenedHint'));
            }
        } else if (mime.startsWith('audio/') || mime.startsWith('video/')) {
            const media = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video');
            media.controls = true;
            media.className = 'attachment-media-preview';
            media.src = previewSrc;
            body.append(media);
        } else {
            const message = document.createElement('p');
            message.className = 'empty-state';
            message.textContent = Lang.t('noSafePreviewForFormat');
            body.append(message);
        }
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Lädt die Nachrichten direkt von der v2-API, statt aus einem lokal gehaltenen Array --
    // ticket.chat existiert nicht mehr. Dateianhänge im Chat sind in dieser Umstellung noch
    // nicht angebunden (eigener, noch offener Schritt), Text/Bearbeiten funktioniert.
    renderChat: async (ticket, containerSelector) => {
        const box = q(containerSelector);
        if (!box) return;
        box.innerHTML = '';

        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticket.id)}/messages`, { credentials: 'same-origin' }).catch(() => null);
        const msgs = res && res.ok ? (await res.json()).messages || [] : [];
        AdminBoard._currentChatMessages = msgs;

        if (msgs.length === 0) {
            box.innerHTML = `<div class="empty-state">${Utils.esc(Lang.t('noChatMessages'))}</div>`;
            return;
        }

        const currentUser = await Store.currentUser();

        msgs.forEach(m => {
            const el = document.createElement('div');
            const isMe = m.sender_user_id === currentUser.id;
            const roleClass = ['admin', 'superadmin'].includes(m.sender_role) ? 'from-admin' : m.sender_role === 'user' ? 'from-user' : '';
            el.className = `chat-bubble ${isMe ? 'me' : 'other'} ${roleClass}`.trim();

            const htmlText = m.content ? Utils.formatRichText(m.content) : '';
            const files = (m.attachments || []).length
                ? `<div class="note-files chat-files">${m.attachments.map(file => `<button type="button" class="file-chip chat-att" data-id="${Utils.esc(file.id)}" data-name="${Utils.esc(file.name)}" data-size="${Number(file.size) || 0}">${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span></button>`).join('')}</div>`
                : '';

            el.innerHTML = `
                <div class="msg-meta">
                    <span class="msg-author">${Utils.avatarImg(m.sender_user_id || m.sender_username, 'msg-avatar')}${Utils.esc(m.sender_name || m.sender_username)}</span>
                    <span class="msg-meta-actions">${Utils.fmtDate(m.created_at)}${m.edited_at ? `<span class="msg-edited" title="${Utils.esc(Lang.format('editedAt', { date: Utils.fmtDate(m.edited_at) }))}">${Utils.esc(Lang.t('edited'))}</span>` : ''}${isMe && !ticket.archived && m.content ? `<button type="button" class="btn-ghost btn-icon btn-xs chat-message-edit" data-message-id="${m.id}" title="${Utils.esc(Lang.t('editOwnMessage'))}" aria-label="${Utils.esc(Lang.t('editOwnMessage'))}">${Icon('pencil', 12)}</button>` : ''}</span>
                </div>
                ${htmlText}
                ${files}
            `;
            box.appendChild(el);
            el.querySelector('.chat-message-edit')?.addEventListener('click', () => AdminBoard.editChatMessage(ticket.id, m.id, containerSelector));
            el.querySelectorAll('.chat-att').forEach(btn => btn.addEventListener('click', () =>
                AdminBoard.openAttachmentPreview({ attachmentId: btn.dataset.id, name: btn.dataset.name, size: Number(btn.dataset.size) || 0 })));
        });
        box.scrollTop = box.scrollHeight;
        if (window.lucide) lucide.createIcons();
    },

    // Sendet direkt über /api/v2/tickets/:id/messages -- Benachrichtigung an die jeweils andere
    // Seite erzeugt der Server dabei automatisch (siehe tickets.ts). Ausgewählte Dateien werden
    // danach mit der message_id hochgeladen; eine Nachricht darf auch nur aus Anhängen bestehen.
    postChat: async (role) => {
        const id = AdminBoard.currentTicketId || UserDash.currentTicketId;
        const prefix = (role === 'admin') ? '#m' : '#u';
        const txtInput = q(`${prefix}-chat-input`);
        const txt = txtInput.value.trim();
        const files = [...(role === 'admin' ? AdminBoard.selectedFiles : UserDash.selectedFiles)];
        if (!txt && !files.length) return txtInput.focus();
        // Unpassende Dateien sofort mit Grund melden, bevor eine Nachricht entsteht.
        const invalid = [];
        files.forEach(file => { try { Store.assertUploadAllowed(file); } catch (error) { invalid.push(Store.uploadErrorMessage(error)); } });
        if (invalid.length) return UI.toast(invalid.join(' '));

        const sendButton = q(role === 'admin' ? '#btn-chat-send' : '#u-chat-send');
        if (sendButton?.disabled) return;
        if (sendButton) sendButton.disabled = true;
        let errors = [];
        try {
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/messages`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: txt, ...(files.length ? { has_attachments: true } : {}) })
            }).catch(() => null);
            if (!res || !res.ok) {
                UI.toast(Lang.t('chatSendFailed'));
                return;
            }
            const messageId = (await res.json().catch(() => ({}))).message?.id;
            ({ errors } = await Store.uploadFiles(files, file => Store.saveAttachment(file, { ticketId: id, messageId })));
            if (role === 'admin') { AdminBoard.selectedFiles = []; AdminBoard.renderFilePreview(); }
            else { UserDash.selectedFiles = []; UserDash.renderFilePreview(); }
        } finally {
            if (sendButton) sendButton.disabled = false;
        }

        // Statuswechsel nach einer Benutzerantwort erfolgt zusammen mit der Nachricht auf dem Server.
        if (role === 'user') {
            Store._ticketsCache = null;
            Store._ticketsSnapshot = null;
            await UserDash.renderList();
        }

        txtInput.value = '';
        const t = (await Store.getTickets()).find(x => x.id === id);
        if (role === 'admin') {
            await AdminBoard.renderChat(t, '#m-chat-msgs');
            await AdminBoard.render();
        } else {
            await UserDash.openModal(id);
        }
        UI.toast(errors.length ? Lang.format('chatAttachmentsPartlyFailed', { details: errors.join(' ') }) : Lang.t('chatSent'));
    },

    openApproveModal: async (req) => AdminBoard.openUserWizard({ request: req, viewContext: 'users' }),
    // Ueber den Server-Export statt im Browser: jeder Export landet im Systemprotokoll und der
    // Server neutralisiert Formel-Zellen zentral.
    exportUsersCSV: async () => {
        const res = await fetch('/api/v2/users/export.csv', { credentials: 'same-origin' }).catch(() => null);
        if (!res || !res.ok) return UI.toast(Lang.t('saveFailed'));
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `users_export_${Utils.nowISO().split('T')[0]}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    },

    importUsersCSV: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const txt = evt.target.result;
                await AdminBoard.processCSVImport(txt);
            };
            reader.readAsText(file);
        };
        input.click();
    },

    processCSVImport: async (csvText) => {
        const lines = csvText.split(/\r?\n/);
        if (lines.length < 2) return;

        let addedCount = 0;
        let skippedCount = 0;

        const users = await Store.getUsers();

        // Simple CSV parse (robust enough for our export format)
        // headers: id,username,name,email,role,dept

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Handle quotes simple regex or split
            // For simplicity assuming no commas in inner text for now or standard quote handling
            // A simple regex for CSV: /,(?=(?:(?:[^"]*"){2})*[^"]*$)/
            const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').replace(/""/g, '"'));

            if (cols.length < 5) continue; // Min required

            const [id, username, name, email, role, deptStr] = cols;

            if (!username) continue;

            // Check duplicate by username or email
            if (users.find(u => u.username === username || (email && u.email === email))) {
                skippedCount++;
                continue;
            }

            const newUser = {
                id: Utils.uid(), // Generate new ID to avoid collisions unless ID is strictly preserved logic needed? Safe to gen new.
                username,
                name,
                email,
                role: ['user', 'admin', 'superadmin'].includes(role) ? role : 'user',
                dept: deptStr ? deptStr.split(';') : undefined,
                password: await Store.generatePassword()
            };

            users.push(newUser);
            addedCount++;
        }

        if (addedCount > 0) {
            await Store.saveUsers(users);
            AdminBoard.renderUserManager('users');
            UI.toast(Lang.format('usersImportedSkipped', { added: addedCount, skipped: skippedCount }));
            await Store.addGlobalLog('Benutzer per CSV importiert', `Hinzugefügt: ${addedCount}, Übersprungen: ${skippedCount}`);
        } else {
            UI.toast(Lang.format('noNewUsersImportedDuplicates', { count: skippedCount }));
        }
    }
};
