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
import { getStatusColorClass, getPrioValue, compareTicketUrgency, isPendingApprover, insertMarkdownLink, insertMarkdownTable } from './ticket-helpers.js';

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
        ['btn-to-dash', 'btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings', 'btn-todos', 'btn-notifications', 'theme-toggle', 'btn-settings', 'logout'].forEach(id => {
            const el = q(`#${id}`);
            if (el && el.parentElement === nav) nav.appendChild(el);
        });
    },

    canAccessTicket: (user, ticket) => {
        if (!user || !ticket || !['admin', 'superadmin'].includes(user.role)) return false;
        if (user.role === 'superadmin') return true;
        if (!ticket.owner && !(ticket.assignees || []).length) return true;
        const departments = Array.isArray(user.dept) ? user.dept : [user.dept || 'Allgemein'];
        const categories = Array.isArray(ticket.category) ? ticket.category : [ticket.category || 'Allgemein'];
        const assignedUsers = [ticket.owner, ticket.assignee, ...(ticket.assignees || []), ...(ticket.participants || [])];
        return departments.includes('All') || categories.some(category => departments.includes(category)) || assignedUsers.includes(user.username);
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
        const visibleTickets = tickets.filter(ticket => !ticket.archived &&
            (user?.role !== 'admin' || AdminBoard.canAccessTicket(user, ticket)));
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
            !ticket.archived && (user?.role !== 'admin' || AdminBoard.canAccessTicket(user, ticket)) &&
            Store.isTicketOverdue(ticket, settings)
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
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220))}px`;
        menu.hidden = false;
    },

    renderFilePreview: () => {
        const pan = q('#m-chat-file-preview');
        if (!pan) return;
        pan.innerHTML = '';
        if (AdminBoard.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            AdminBoard.selectedFiles.forEach((f, idx) => {
                const tag = document.createElement('div');
                tag.className = 'file-chip';
                tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
                tag.querySelector('.remove-file').onclick = () => {
                    AdminBoard.selectedFiles.splice(idx, 1);
                    AdminBoard.renderFilePreview();
                };
                pan.appendChild(tag);
            });
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
                });
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
            input.onchange = async () => {
                try { for (const file of input.files) await Store.saveAttachment(file, { ticketId: ticket.id }); }
                catch { UI.toast(Lang.t('attachmentUploadFailed')); }
                await AdminBoard.renderTicketAttachments(ticket, container, { manage });
            };
            container.appendChild(add);
        }
        if (window.lucide) lucide.createIcons();
    },

    init: async () => {
        if (!q('.kanban-board')) return;

        const internalPane = q('#tab-internal');
        const internalSection = q('#tab-details .comments-section');
        if (internalPane && internalSection && internalSection.parentElement !== internalPane) {
            internalPane.appendChild(internalSection);
        }

        // Superadmin UI Injection
        // Admin UI Visibility
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';
        const canManageUsers = isSuper || !!user?.canManageUsers;
        const canManage2FA = isSuper || !!user?.canManage2FA;
        const canUsers = canManageUsers || canManage2FA;
        const canReqs = isSuper || (user && user.canManageRequests);

        const actionsForAbsence = q('.topbar-right');
        if (actionsForAbsence && !q('#btn-absence-overview')) {
            const btn = document.createElement('button');
            btn.id = 'btn-absence-overview';
            btn.className = 'btn-ghost';
            btn.title = 'Abwesenheiten';
            btn.setAttribute('aria-label', 'Abwesenheiten');
            btn.innerHTML = `${Icon('plane', 16)}Abwesend`;
            btn.onclick = () => AdminBoard.openAbsenceOverview();
            actionsForAbsence.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
        }
        await AdminBoard.processAbsences();
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
                if (isSuper && !q('#btn-sys-settings')) {
                    const btn = document.createElement('button');
                    btn.id = 'btn-sys-settings';
                    btn.className = 'btn-ghost';
                    btn.innerHTML = `${Icon('sliders', 16)}${Lang.t('system')}`;
                    btn.onclick = AdminBoard.openSystemSettings;
                    actions.insertBefore(btn, q('#theme-toggle') || q('#btn-settings') || q('#logout'));
                }
                AdminBoard.orderTopbar();
            }
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
        qa('.internal-stream-tab').forEach(button => {
            button.onclick = () => {
                const selected = button.dataset.stream;
                qa('.internal-stream-tab').forEach(tab => {
                    const active = tab === button;
                    tab.classList.toggle('active', active);
                    tab.setAttribute('aria-selected', String(active));
                });
                qa('.internal-stream').forEach(stream => {
                    stream.classList.toggle('active', stream.dataset.stream === selected);
                });
            };
        });

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
            if (fileInput) fileInput.onchange = () => {
                Array.from(fileInput.files).forEach(file => AdminBoard.noteFiles[channel].push(file));
                AdminBoard.renderNoteFilePreview(channel);
                fileInput.value = '';
            };
            if (noteInput) {
                q(`#${prefix}-bold`).onclick = () => insertMarkdown(noteInput, '**');
                q(`#${prefix}-italic`).onclick = () => insertMarkdown(noteInput, '*');
                q(`#${prefix}-list`).onclick = () => {
                    const start = noteInput.selectionStart;
                    const end = noteInput.selectionEnd;
                    const selected = noteInput.value.substring(start, end) || 'Punkt';
                    const listText = selected.split('\n').map(line => `- ${line}`).join('\n');
                    noteInput.value = noteInput.value.substring(0, start) + listText + noteInput.value.substring(end);
                    noteInput.focus();
                };
                const numberedListButton = q(`#${prefix}-numbered`);
                if (numberedListButton) numberedListButton.onclick = () => {
                    const start = noteInput.selectionStart;
                    const end = noteInput.selectionEnd;
                    const selected = noteInput.value.substring(start, end) || 'Punkt';
                    const listText = selected.split('\n').map((line, index) => `${index + 1}. ${line}`).join('\n');
                    noteInput.value = noteInput.value.substring(0, start) + listText + noteInput.value.substring(end);
                    noteInput.focus();
                };
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

        // Filter by Department (if not Superadmin)
        if (user?.role === 'admin') tickets = tickets.filter(ticket => AdminBoard.canAccessTicket(user, ticket));
        const slaSettings = await Store.getSettings();
        await AdminBoard.refreshOverdueIndicator(tickets, user, slaSettings);
        const query = q('#admin-ticket-search')?.value || '';
        if (query.trim()) tickets = tickets.filter(ticket => Utils.matchesSearch(query, ticket));
        // Superadmin sees all (no filter)

        const deadlines = new Map(tickets.map(t => [t.id, Store.ticketSlaDueAt(t, slaSettings)]));
        tickets.sort((a, b) => compareTicketUrgency(a, b, t => deadlines.get(t.id)));

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
            const pendingApproval = (t.approvals || []).some(a => a.status === 'pending');
            const tone = pendingApproval ? 'approval' : isOverdue ? 'overdue' : t.isMajorIncident ? 'incident' : t.prio === 'Kritisch' ? 'critical' : '';
            card.classList.add('card-v2');
            if (tone) card.classList.add(`card-tone-${tone}`);
            card.innerHTML = `
                <div class="card-line card-meta-line">
                    <span title="${Utils.esc(catList.join(', ') || '-')}">${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(categoryText)} · ${Utils.fmtDate(t.createdAt).split(' ')[0]}</span>
                </div>
                <div class="card-title">${Utils.esc(t.title)}</div>
                <div class="card-line card-deadline-row">
                    ${pendingApproval ? `<span class="card-deadline approval-badge" title="Wartet auf Genehmigung">${Icon('hourglass', 11)}Genehmigung</span>` : sla ? `<span class="card-deadline sla-text-${sla.tone}" title="Frist: ${Utils.esc(sla.dueDateLabel)}">${Icon(sla.overdue ? 'triangle-alert' : 'timer', 11)}${Utils.esc(sla.label)}</span>` : '<span></span>'}
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
            return card;
        }
    },

    // START OF MISSING FUNCTIONS
    archiveCurrent: () => {
        UI.confirm(Lang.t('confirmArchiveTicket'), async () => {
            const id = AdminBoard.currentTicketId;
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t) {
                t.archived = true;
                t.archivedAt = Utils.nowISO(); // Save archive timestamp
                await Store.addLog(t, 'Ticket archiviert');
                await Store.saveTickets(tickets);
                await Store.addGlobalLog('Ticket archiviert', `Titel: ${t.title}`);
                AdminBoard.closeModal();
                await AdminBoard.render();
                UI.toast(Lang.t('ticketArchivedToast'));
            }
        });
    },

    openGlobalLogsModal: async () => {
        let modal = q('#global-logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'global-logs-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-xl">
                    <div class="modal-header">
                        <h3>${Icon('bell', 18)} ${Lang.t('systemLog')}</h3>
                        <div class="modal-actions">
                            <input type="text" id="gl-search" placeholder="${Lang.t('searchLogsPlaceholder')}">
                            <button class="btn-ghost btn-icon" id="btn-gl-print" title="${Lang.t('printLog')}" aria-label="${Lang.t('printLog')}">${Icon('printer', 16)}</button>
                            <button class="btn-ghost btn-icon" id="global-logs-modal-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="log-datetime-filters">
                        <label>${Lang.t('from')} ${UI.dateTimePickerMarkup('gl-from')}</label>
                        <label>${Lang.t('until')} ${UI.dateTimePickerMarkup('gl-to')}</label>
                    </div>
                    <div class="log-term-filters">
                        <label><span>${Lang.t('contains')}</span><input type="text" id="gl-include" placeholder="${Lang.t('termsCommaSeparated')}"></label>
                        <label><span>${Lang.t('doesNotContain')}</span><input type="text" id="gl-exclude" placeholder="${Lang.t('termsCommaSeparated')}"></label>
                    </div>
                    <div class="modal-body flush" id="gl-body"></div>
                </div>`;
            document.body.appendChild(modal);

            q('#gl-search').oninput = () => AdminBoard.renderGlobalLogs();
            q('#gl-include').oninput = () => AdminBoard.renderGlobalLogs();
            q('#gl-exclude').oninput = () => AdminBoard.renderGlobalLogs();
            AdminBoard.glFromMs = null;
            AdminBoard.glToMs = null;
            UI.createDateTimePicker(q('#gl-from'), { onChange: (ms) => { AdminBoard.glFromMs = ms; AdminBoard.renderGlobalLogs(); } });
            UI.createDateTimePicker(q('#gl-to'), { onChange: (ms) => { AdminBoard.glToMs = ms; AdminBoard.renderGlobalLogs(); } });
            q('#btn-gl-print').onclick = () => AdminBoard.printGlobalLogs();
            q('#global-logs-modal-close').onclick = () => modal.classList.remove('open');
        }

        AdminBoard.renderGlobalLogs();
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    getFilteredGlobalLogs: async () => {
        const logs = await Store.getGlobalLogs();
        const search = q('#gl-search')?.value.toLowerCase().trim() || '';
        const from = AdminBoard.glFromMs ?? -Infinity;
        const to = AdminBoard.glToMs ? AdminBoard.glToMs + 59999 : Infinity;
        const terms = value => String(value || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const include = terms(q('#gl-include')?.value);
        const exclude = terms(q('#gl-exclude')?.value);
        const filtered = logs.filter(log => {
            const timestamp = new Date(log.date).getTime();
            const text = `${log.user || ''} ${log.action || ''} ${log.details || ''}`.toLowerCase();
            return Utils.matchesSearch(search, log)
                && timestamp >= from && timestamp <= to
                && include.every(term => text.includes(term))
                && !exclude.some(term => text.includes(term));
        });
        return filtered.slice().reverse();
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

        const visibleLogs = await AdminBoard.getFilteredGlobalLogs();
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
        body.innerHTML = visibleLogs.length ?
            visibleLogs.map(l => UI.logRow({
                icon: iconForLog(l.action),
                user: l.user,
                date: l.date,
                action: l.action,
                details: l.details
            })).join('') :
            `<div class="empty-state">${Lang.t('noEntriesFound')}</div>`;
        if (window.lucide) lucide.createIcons();
    },

    // User Manager Logic
    openUserManager: async () => {
        const modal = q('#user-man-modal');
        modal.classList.add('open');
        await AdminBoard.renderUserManager('users'); // Default tab

        // Setup UM Tabs
        const user = await Store.currentUser();
        const isSuper = user && user.role === 'superadmin';

        let tabs = modal.querySelector('.um-tabs');
        if (tabs) tabs.remove();

        tabs = document.createElement('div');
        tabs.className = 'um-tabs tabs';

        tabs.innerHTML = `
            <div class="tab-btn active" data-view="users">Benutzer</div>
            ${isSuper ? `<div class="tab-btn" data-view="admins">Admins</div>` : ''}
            ${isSuper ? `<div class="tab-btn" data-view="groups">Gruppen</div>` : ''}
            ${isSuper ? `<div class="tab-btn" data-view="cats">Kategorien</div>` : ''}
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
            actions.innerHTML = `<button class="btn-primary" id="btn-add-group">${Icon('plus', 16)}Neue Gruppe</button>`;
            actions.querySelector('#btn-add-group').onclick = () => AdminBoard.openEditGroupModal(null);
        } else {
            actions.innerHTML = `<button class="btn-primary" id="btn-add-cat">${Icon('plus', 16)}Neue Kategorie</button>`;
            actions.querySelector('#btn-add-cat').onclick = () => AdminBoard.openEditCategoryModal(null);
        }

        if (view === 'groups') {
            const groups = await Store.getGroups();
            const filteredGroups = groups.filter(g => Utils.matchesSearch(searchTerm, g));

            filteredGroups.forEach(g => {
                const el = document.createElement('div');
                el.className = 'table-row user-manager-row';
                el.innerHTML = `
                    <div class="user-manager-text">
                        <span class="user-manager-name">${Icon('users-round', 15)}${Utils.esc(g.name)}</span>
                        <span class="row-sub">${Utils.esc(g.description || '-')}</span>
                        <span class="badge">${(g.members || []).length} ${(g.members || []).length === 1 ? Lang.t('member') : Lang.t('members')}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon members-g" title="${Lang.t('viewMembers')}" aria-label="${Lang.t('viewMembers')}">${Icon('list', 16)}</button>
                        <button class="btn-ghost btn-icon edit-g" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-g" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                `;
                el.querySelector('.members-g').onclick = () => AdminBoard.openGroupMembers(g);
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

        if (view === 'cats') {
            const categories = (await Store.getCategories()).filter(c => !c.archived);
            categories.filter(c => Utils.matchesSearch(searchTerm, c.name)).forEach(c => {
                const el = document.createElement('div');
                el.className = 'table-row user-manager-row';
                el.innerHTML = `
                    <div class="user-manager-text">
                        <span class="user-manager-name">${Icon('tag', 15)}${Utils.esc(c.name)}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon edit-c" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-c" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                `;
                el.querySelector('.edit-c').onclick = () => AdminBoard.openEditCategoryModal(c);
                el.querySelector('.del-c').onclick = () => {
                    UI.confirm(Lang.format('confirmDeleteCategory', { name: c.name }), async () => {
                        if (!(await Store.updateCategory(c.id, { archived: true }))) return UI.toast(Lang.t('categoryDeleteFailed'));
                        AdminBoard.renderUserManager('cats');
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
    openEditCategoryModal: async (category) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');

        const groups = await Store.getGroups();

        title.textContent = category ? 'Kategorie bearbeiten' : 'Neue Kategorie';
        content.innerHTML = `
            <div class="field">
                <label>${Lang.t('name')}</label>
                <input type="text" id="g-input" value="${Utils.esc(category?.name || '')}" placeholder="${Lang.t('egTechnik')}">
            </div>
            <div class="field">
                <label>${Lang.t('autoAssignToGroup')}</label>
                <div id="cat-auto-group"></div>
            </div>
            <div class="field field-wide">
                <label>${Lang.t('customFieldsForCategory')}</label>
                <p class="hint">${Lang.t('customFieldsHint')}</p>
                <div id="cat-custom-fields" class="custom-fields-editor"></div>
                <button type="button" class="btn-secondary btn-sm" id="cat-add-field">${Icon('plus', 15)}${Lang.t('addField')}</button>
            </div>
        `;
        const autoGroupPicker = UI.createMultiSelect(q('#cat-auto-group'), groups.map(g => ({ value: g.id, label: g.name })), category?.autoAssignGroupId || '', null, { single: true, emptyLabel: Lang.t('none') });

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

            const ok = category
                ? await Store.updateCategory(category.id, { name: val, autoAssignGroupId, customFields: collectedFields })
                : await Store.createCategory({ name: val, autoAssignGroupId, customFields: collectedFields });
            if (!ok) return UI.toast(Lang.t('categorySaveFailed'));

            modal.classList.remove('open');
            AdminBoard.renderUserManager('cats');
            UI.toast(category ? Lang.t('categoryEdited') : Lang.t('categoryCreated'));
        };
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
                await Store.setGroupMembers([username], null);
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
                    await Store.setGroupMembers(chosen, group.id);
                    m.remove();
                    await render();
                    AdminBoard.renderUserManager('groups');
                }
            });
            const picker = UI.createMultiSelect(addModal.querySelector('#gma-picker'), candidates.map(u => ({ value: u.username, label: u.name || u.username })), []);
        };
        modal.querySelector('#gm-print').onclick = async () => {
            const settings = await Store.getSettings();
            const company = settings.companyConfig || {};
            const companyLogo = company.logoUrl || settings.companyBrandingConfig?.logoDataUrl || '';
            const actor = await Store.currentUser();
            const users = await Store.getUsers();
            const members = users.filter(u => (group.members || []).includes(u.username));
            UI.printHTML(`<!DOCTYPE html><html lang="${Lang.current}"><head><meta charset="UTF-8"><title>${Lang.format('membersOfGroup', { name: Utils.esc(group.name) })}</title>
                <link rel="stylesheet" href="/js/print.css"></head>
                <body><div class="print-head"><div><h1>${Lang.format('companyGroupHeading', { company: Utils.esc(company.name || 'Support Portal'), group: Utils.esc(group.name) })}</h1>
                <div class="meta">${Lang.format('membersPrintedByOn', { count: members.length, name: Utils.esc(actor?.name || actor?.username || '-'), date: Utils.esc(Utils.fmtDate(new Date().toISOString())) })}</div></div>
                ${companyLogo ? `<img src="${Utils.esc(companyLogo)}" alt="Logo">` : ''}</div>
                <table><thead><tr><th>${Lang.t('name')}</th><th>${Lang.t('username')}</th><th>${Lang.t('email')}</th><th>${Lang.t('role')}</th></tr></thead><tbody>
                ${members.map(u => `<tr><td>${Utils.esc(u.name || '-')}</td><td>${Utils.esc(u.username)}</td><td>${Utils.esc(u.email || '-')}</td><td>${Utils.esc(u.role)}</td></tr>`).join('')}
                </tbody></table></body></html>`);
        };
        await render();
    },

    // Eine Person gehört höchstens einer Gruppe an (department_group_id im Backend) -- Auswahl
    // hier entfernt eine Person automatisch aus ihrer bisherigen Gruppe.
    openEditGroupModal: async (group) => {
        const modal = q('#generic-modal') || AdminBoard.createGenericModal();
        const title = modal.querySelector('h3');
        const content = modal.querySelector('.modal-body');
        const confirmBtn = modal.querySelector('.btn-primary');
        const users = await Store.getUsers();
        const members = group?.members || [];

        title.textContent = group ? Lang.format('editGroupName', { name: group.name }) : Lang.t('newGroup');
        content.innerHTML = `
            <div class="field"><label>${Lang.t('name')}</label><input id="ge-name" type="text" value="${group?.name || ''}" placeholder="${Lang.t('egVerwaltung')}"></div>
            <div class="field">
                <label>${Lang.t('members')}</label>
                <p class="hint">${Lang.t('onePersonOneGroupHint')}</p>
                <div class="checkbox-list">
                    ${users.map(u => `
                        <label class="check-row">
                            <input type="checkbox" value="${u.username}" ${members.includes(u.username) ? 'checked' : ''}>
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

            let groupId = group?.id;
            if (group) {
                if (name !== group.name && !(await Store.renameGroup(group.id, name))) {
                    return UI.toast(Lang.t('groupRenameFailed'));
                }
            } else {
                const createRes = await fetch('/api/v2/groups', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name })
                }).catch(() => null);
                if (!createRes || !createRes.ok) return UI.toast(Lang.t('groupCreateFailed'));
                groupId = (await createRes.json()).id;
            }

            const removedMembers = members.filter(m => !selectedMembers.includes(m));
            if (removedMembers.length) await Store.setGroupMembers(removedMembers, null);
            if (selectedMembers.length) await Store.setGroupMembers(selectedMembers, groupId);

            modal.classList.remove('open');
            AdminBoard.renderUserManager('groups');
            UI.toast(group ? Lang.t('groupSavedToast') : Lang.t('groupCreatedToast'));
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    openEditUserModal: async (user, viewContext) => {
        let editModal = q('#user-edit-modal');
        if (!editModal) {
            editModal = document.createElement('div');
            editModal.id = 'user-edit-modal';
            editModal.className = 'modal-overlay';
            editModal.innerHTML = `
                <div class="modal modal-lg">
                    <div class="modal-header">
                        <h3>${Lang.t('editUser')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="ue-save-head" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field"><label>${Lang.t('username')}</label><input id="ue-user" type="text"></div>
                        <div class="field"><label>${Lang.t('name')}</label><input id="ue-name" type="text"></div>
                        <div class="field"><label>${Lang.t('email')}</label><input id="ue-email" type="email"></div>
                        <div class="field field-wide" id="ue-similar-hint" hidden></div>
                        <div class="field"><label>${Lang.t('passwordLeaveEmptyUnchanged')}</label><input id="ue-pass" type="password"></div>
                        <div class="field field-wide" id="ue-validity-box"><label for="ue-valid-until">${Lang.t('validUntilInclusiveOptional')}</label>${UI.dateFieldMarkup('ue-valid-until')}</div>
                        <div class="field field-wide" id="ue-contact-box">
                            <label>${Lang.t('contactData')}</label>
                            <div class="perm-grid">
                                <div class="field"><label>${Lang.t('phone')}</label><input id="ue-phone" type="text"></div>
                                <div class="field"><label>${Lang.t('mobile')}</label><input id="ue-mobile" type="text"></div>
                                <div class="field"><label>${Lang.t('jobTitle')}</label><input id="ue-job-title" type="text"></div>
                                <div class="field"><label>${Lang.t('location')}</label><input id="ue-office-location" type="text"></div>
                            </div>
                        </div>
                        <div class="field field-wide" id="ue-role-box"><label>${Lang.t('role')}</label><select id="ue-role"><option value="user">User</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></div>
                        <div class="field field-wide" id="ue-ldap-box" hidden>
                            <label class="check-row"><input type="checkbox" id="ue-ldap-enabled"><span>${Lang.t('allowLdapLoginForAccount')}</span></label>
                            <div class="hint">${Lang.t('ldapHintText')}</div>
                        </div>
                        <div class="field field-wide" id="ue-groups-box">
                            <label>${Lang.t('group')}</label>
                            <div id="ue-groups-list"></div>
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('supervisor')}</label>
                            <div id="ue-supervisor"></div>
                        </div>
                        <div class="field field-wide" id="ue-man-box" hidden>
                            <label>${Lang.t('administration')}</label>
                            <div class="perm-grid">
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-req"><span>${Lang.t('manageAccountRequests')}</span></label>
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-users"><span>${Lang.t('userManagementUsersOnly')}</span></label>
                                <label class="check-row"><input type="checkbox" id="ue-can-view-logs"><span>${Lang.t('viewSystemLogs')}</span></label>
                                <label class="check-row"><input type="checkbox" id="ue-can-manage-2fa"><span>${Lang.t('resetUsersMfaPermission')}</span></label>
                            </div>
                            <label>${Lang.t('additionalFeatures')}</label>
                            <div class="perm-grid">
                                <label class="check-row"><input type="checkbox" data-perm="textBlocks"><span>${Lang.t('manageTextBlocks')}</span></label>
                                <label class="check-row"><input type="checkbox" data-perm="reports"><span>${Lang.t('viewReports')}</span></label>
                                <label class="check-row"><input type="checkbox" data-perm="approvals"><span>${Lang.t('decideApprovals')}</span></label>
                                <label class="check-row"><input type="checkbox" data-perm="recurring"><span>${Lang.t('manageRecurringTickets')}</span></label>
                            </div>
                            <label for="ue-kb">${Lang.t('knowledgeBase')}</label>
                            <select id="ue-kb">
                                <option value="none">${Lang.t('noAccess')}</option>
                                <option value="read">${Lang.t('readOnly')}</option>
                                <option value="edit">${Lang.t('readAndEdit')}</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer action-footer">
                        <button class="btn-secondary close-m footer-cancel">${Lang.t('cancel')}</button>
                        <button class="btn-primary" id="ue-save">${Lang.t('save')}</button>
                    </div>
                </div>`;
            document.body.appendChild(editModal);
            editModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => editModal.classList.remove('open'));
            editModal.querySelector('#ue-save-head').onclick = () => q('#ue-save')?.click();
            if (window.lucide) lucide.createIcons();
        }

        // Fill Data
        const isNew = !user;
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';
        const canSetValidity = isSuper || !!currentUser?.canManageUsers;
        editModal._validityPicker?.destroy();
        q('#ue-validity-box').innerHTML = `<label for="ue-valid-until">${Lang.t('validUntilInclusiveOptional')}</label>${UI.dateFieldMarkup('ue-valid-until')}`;
        q('#ue-validity-box').hidden = !canSetValidity;
        const validUntil = user?.accountValidUntil || null;
        q('#ue-valid-until').value = validUntil ? validUntil.split('-').reverse().join('.') : '';
        editModal._validityPicker = UI.bindDateField('ue-valid-until', { initialMs: validUntil ? new Date(validUntil + 'T12:00:00').getTime() : null });
        if (window.lucide) lucide.createIcons();

        q('#ue-user').value = isNew ? '' : user.username;
        q('#ue-user').disabled = !isNew;
        q('#ue-name').value = isNew ? '' : (user.name || '');
        q('#ue-email').value = isNew ? '' : (user.email || '');
        q('#ue-pass').value = '';
        UI.bindPasswordRequirements(q('#ue-pass'));
        q('#ue-phone').value = isNew ? '' : (user.phone || '');
        q('#ue-mobile').value = isNew ? '' : (user.mobile || '');
        q('#ue-job-title').value = isNew ? '' : (user.jobTitle || '');
        q('#ue-office-location').value = isNew ? '' : (user.officeLocation || '');

        // Prüfung auf bestehende/ähnliche Benutzer -- nur beim Neuanlegen sinnvoll (beim
        // Bearbeiten würde die Person immer "sich selbst" als Treffer bekommen). Bei exakter
        // Übereinstimmung (Name UND E-Mail gleich, oder E-Mail bereits vergeben) wird das
        // Anlegen blockiert; bei nur ähnlichem Namen gibt es lediglich einen Hinweis.
        const hintBox = q('#ue-similar-hint');
        let hasExactDuplicate = false;
        if (isNew && hintBox) {
            hintBox.hidden = true;
            hintBox.innerHTML = '';
            let similarCheckTimer = null;
            const runSimilarCheck = () => {
                clearTimeout(similarCheckTimer);
                similarCheckTimer = setTimeout(async () => {
                    const name = q('#ue-name').value.trim();
                    const email = q('#ue-email').value.trim();
                    if (!name && !email) { hintBox.hidden = true; hasExactDuplicate = false; return; }
                    const result = await Store.checkSimilarUser(name, email);
                    hasExactDuplicate = !!result.exact;
                    if (!result.similar || !result.similar.length) { hintBox.hidden = true; return; }
                    const describe = (s) => `${Utils.esc(s.name)} (${Utils.esc(s.username)}, ${Utils.esc(s.email)})`;
                    hintBox.hidden = false;
                    hintBox.className = `field field-wide callout ${result.exact ? 'callout-danger' : ''}`;
                    hintBox.innerHTML = result.exact
                        ? Lang.format('userAlreadyExistsBlocked', { list: result.similar.map(describe).join(', ') })
                        : Lang.format('similarUsersFound', { list: result.similar.map(describe).join(', ') });
                }, 350);
            };
            q('#ue-name').oninput = runSimilarCheck;
            q('#ue-email').oninput = runSimilarCheck;
        } else if (hintBox) {
            hintBox.hidden = true;
            q('#ue-name').oninput = null;
            q('#ue-email').oninput = null;
        }

        const roleSel = q('#ue-role');
        roleSel.value = isNew ? (viewContext === 'admins' ? 'admin' : 'user') : user.role;

        // Permissions check for roles
        if (!isSuper) {
            q('#ue-role-box').style.display = 'none'; // Admins cannot change roles
        }

        // Zusatzrechte: nur Superadmin darf sie vergeben, nur bei Rolle "admin" sinnvoll.
        const manBox = q('#ue-man-box');
        const updateManBoxVisibility = () => { if (manBox) manBox.hidden = !(isSuper && q('#ue-role').value === 'admin'); };
        q('#ue-can-manage-req').checked = user ? !!user.canManageRequests : false;
        q('#ue-can-manage-users').checked = user ? !!user.canManageUsers : false;
        q('#ue-can-view-logs').checked = user ? !!user.canViewLogs : false;
        q('#ue-can-manage-2fa').checked = user ? !!user.canManage2FA : false;
        editModal.querySelectorAll('#ue-man-box [data-perm]').forEach(box => { box.checked = !!user?.permissions?.[box.dataset.perm]; });
        q('#ue-kb').value = user?.permissions?.kb || 'none';

        // Security-Audit N7: LDAP-Login ist Opt-in je Konto und nur fuer Nicht-Superadmin-Ziele
        // relevant (Superadmins sind serverseitig ohnehin hart ausgeschlossen).
        const ldapBox = q('#ue-ldap-box');
        const updateLdapBoxVisibility = () => { if (ldapBox) ldapBox.hidden = !(isSuper && q('#ue-role').value !== 'superadmin'); };
        q('#ue-ldap-enabled').checked = user ? !!user.ldapLoginEnabled : false;

        roleSel.onchange = () => { updateManBoxVisibility(); updateLdapBoxVisibility(); };
        updateManBoxVisibility();
        updateLdapBoxVisibility();

        // Gruppe: höchstens eine pro Person (department_group_id im Backend)
        const groupList = q('#ue-groups-list');
        let groupPicker = null;
        if (groupList) {
            const groups = await Store.getGroups();
            groupPicker = UI.createMultiSelect(groupList, groups.map(g => ({ value: g.id, label: g.name })), user?.department_group_id || '', null, { single: true, emptyLabel: Lang.t('none') });
        }
        // Vorgesetzte Person -- genutzt vom automatischen Genehmigungsworkflow (Systemeinstellungen).
        const supervisorBox = q('#ue-supervisor');
        let supervisorPicker = null;
        if (supervisorBox) {
            const allUsers = await Store.getUsers();
            const choices = allUsers.filter(u => u.id !== user?.id && !u.accountArchived).map(u => ({ value: u.id, label: u.name || u.username }));
            supervisorPicker = UI.createMultiSelect(supervisorBox, choices, user?.supervisorUserId || '', null, { single: true, emptyLabel: Lang.t('none') });
        }

        editModal.querySelector('h3').textContent = isNew ? Lang.t('createNewUser') : Lang.format('editUserName', { username: user.username });
        editModal.classList.add('open');

        q('#ue-save').onclick = async () => {
            const uVal = q('#ue-user').value.trim();
            const nVal = q('#ue-name').value.trim();
            const eVal = q('#ue-email').value.trim();
            const pVal = q('#ue-pass').value.trim();
            const phoneVal = q('#ue-phone').value.trim();
            const mobileVal = q('#ue-mobile').value.trim();
            const jobTitleVal = q('#ue-job-title').value.trim();
            const officeLocationVal = q('#ue-office-location').value.trim();
            const validityText = q('#ue-valid-until').value.trim();
            const validityParts = validityText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
            if (canSetValidity && validityText && (!validityParts || !Number.isFinite(Utils.parseGermanDateTime(validityText, '12:00')))) {
                return UI.toast(Lang.t('validityDateFormatHint'));
            }
            const validityVal = validityParts ? `${validityParts[3]}-${validityParts[2]}-${validityParts[1]}` : null;
            const rVal = q('#ue-role').value;
            const groupVal = groupPicker?.getValue() || null;
            const supervisorVal = supervisorPicker?.getValue() || null;
            const permissionsVal = rVal === 'admin' ? {
                ...Object.fromEntries([...editModal.querySelectorAll('#ue-man-box [data-perm]')].map(b => [b.dataset.perm, b.checked])),
                kb: q('#ue-kb').value
            } : {};
            const canManageReqVal = rVal === 'admin' ? q('#ue-can-manage-req').checked : false;
            const canManageUsersVal = rVal === 'admin' ? q('#ue-can-manage-users').checked : false;
            const canViewLogsVal = rVal === 'admin' ? q('#ue-can-view-logs').checked : false;
            const canManage2FAVal = rVal === 'admin' ? q('#ue-can-manage-2fa').checked : false;
            const ldapLoginEnabledVal = (isSuper && rVal !== 'superadmin') ? q('#ue-ldap-enabled').checked : false;

            if (!uVal) {
                UI.toast(Lang.t('usernameMissing'));
                return;
            }
            if (!eVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eVal)) {
                UI.toast(Lang.t('validEmailMissing'));
                return;
            }
            if (isNew && hasExactDuplicate) {
                UI.toast(Lang.t('userExistsCreateAborted'));
                return;
            }

            const users = await Store.getUsers();

            if (isNew) {
                if (users.find(x => x.username === uVal)) {
                    UI.toast(Lang.t('userAlreadyExists'));
                    return;
                }
                if (!pVal) {
                    UI.toast(Lang.t('passwordMissing'));
                    return;
                }
                if (pVal.length < 14) {
                    UI.toast(Lang.t('passwordMinLength'));
                    return;
                }
                users.push({
                    id: Utils.uid(),
                    username: uVal,
                    name: nVal,
                    email: eVal,
                    password: pVal,
                    role: rVal,
                    department_group_id: groupVal,
                    supervisorUserId: supervisorVal,
                    phone: phoneVal,
                    mobile: mobileVal,
                    jobTitle: jobTitleVal,
                    officeLocation: officeLocationVal,
                    accountValidUntil: canSetValidity ? validityVal : null,
                    ldapLoginEnabled: ldapLoginEnabledVal,
                    permissions: isSuper ? { ...permissionsVal, canManageRequests: canManageReqVal, canManageUsers: canManageUsersVal, canViewLogs: canViewLogsVal, canManage2FA: canManage2FAVal } : undefined
                });
            } else {
                const target = users.find(x => x.id === user.id);
                if (target) {
                    target.name = nVal;
                    target.email = eVal;
                    if (pVal) target.password = pVal;
                    if (isSuper) {
                        target.role = rVal;
                        target.permissions = permissionsVal;
                        target.canManageRequests = canManageReqVal;
                        target.canManageUsers = canManageUsersVal;
                        target.canViewLogs = canViewLogsVal;
                        target.canManage2FA = canManage2FAVal;
                    }
                    target.department_group_id = groupVal;
                    target.supervisorUserId = supervisorVal;
                    target.phone = phoneVal;
                    target.mobile = mobileVal;
                    target.jobTitle = jobTitleVal;
                    target.officeLocation = officeLocationVal;
                    if (canSetValidity) target.accountValidUntil = validityVal;
                    if (isSuper) target.ldapLoginEnabled = ldapLoginEnabledVal;
                }
            }
            const ok = await Store.saveUsers(users);
            if (!ok) {
                const errText = Store.lastError || '';
                const friendly = errText.includes('email_taken') ? Lang.t('emailTakenError')
                    : errText.includes('last_superadmin') ? Lang.t('lastSuperadminError')
                    : errText.includes('username_taken') ? Lang.t('usernameTakenError')
                    : Lang.t('saveFailedGeneric');
                UI.toast(friendly);
                return;
            }
            editModal.classList.remove('open');
            AdminBoard.renderUserManager(viewContext);
            UI.toast(Lang.t('savedToast'));
        };
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

    // Übersichtlicher Fortschritt statt nur "Schritt: build" als Text -- ein docker build
    // --no-cache kann mehrere Minuten dauern, ohne sichtbaren Fortschritt wirkt das wie ein
    // Haenger. job.step bleibt auch nach einem Fehler auf dem Namen des zuletzt gestarteten
    // Schritts stehen (updater-server.mjs), job.failed zeigt den Fehlschlag separat an.
    updateSteps: [
        { key: 'fetch', get label() { return Lang.t('stepFetch'); } },
        { key: 'reset', get label() { return Lang.t('stepUpdate'); } },
        { key: 'build', get label() { return Lang.t('stepBuild'); } },
        { key: 'migrate', get label() { return Lang.t('stepMigrate'); } },
        { key: 'restart', get label() { return Lang.t('stepRestart'); } }
    ],
    renderUpdateProgress: (job) => {
        const steps = AdminBoard.updateSteps;
        const done = job.step === 'done' || job.ok;
        let currentIndex = steps.findIndex(s => s.key === job.step);
        if (done) currentIndex = steps.length;
        if (currentIndex === -1 && !done) currentIndex = 0; // "starting" -- noch vor dem ersten Schritt
        const percent = done ? 100 : Math.round((currentIndex / steps.length) * 100);
        return `
            <div class="update-progress">
                <div class="update-progress-bar"><div class="update-progress-fill ${job.failed ? 'failed' : done ? 'ok' : ''}" data-percent="${percent}"></div></div>
                <div class="update-progress-steps">
                    ${steps.map((s, i) => {
                        const state = job.failed && i === currentIndex ? 'failed' : (i < currentIndex || done) ? 'done' : i === currentIndex ? 'active' : '';
                        return `<span class="update-progress-step${state ? ' ' + state : ''}">${Utils.esc(s.label)}</span>`;
                    }).join('')}
                </div>
            </div>`;
    },

    // pollTimer: l&auml;uft ein Update, fragt diese Funktion den Status alle 4s erneut ab, damit der
    // Fortschritt live sichtbar ist (ein docker build --no-cache kann mehrere Minuten dauern) --
    // ohne dass die Person manuell auf "Pruefen" klicken muss.
    updatePollTimer: null,
    renderUpdateStatus: async () => {
        const area = q('#sys-update-status');
        if (!area) return;
        clearTimeout(AdminBoard.updatePollTimer);
        if (q('#sys-update-run')) q('#sys-update-run').disabled = true;
        const actor = await Store.currentUser();
        if (actor?.role !== 'superadmin') {
            area.textContent = Lang.t('onlySuperadminsCanUpdate');
            return;
        }
        area.innerHTML = `<div class="empty-state compact">${Icon('loader-circle', 16)} ${Lang.t('updateStatusChecking')}</div>`;
        const status = await Store.getUpdateStatus();
        if (!q('#sys-update-status')) return; // Modal inzwischen geschlossen
        // httpStatus unterscheidet, WARUM der Abruf fehlschlug -- vorher zeigte jeder Fehlschlag
        // (auch ein voruebergehender Gateway-Timeout waehrend eines laufenden Updates) dieselbe,
        // irrefuehrende "nicht konfiguriert"-Meldung.
        if (status.httpStatus === 0) {
            area.innerHTML = `<div class="callout callout-danger">${Lang.t('serverUnreachableRetry')}</div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.error === 'update_service_disabled' || status.error === 'update_service_not_configured') {
            area.innerHTML = `<div class="callout callout-info">${Lang.t('onlineUpdatesDisabled')}</div>`;
            const runBtn = q('#sys-update-run');
            if (runBtn) runBtn.disabled = true;
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.error === 'update_signature_not_configured') {
            area.innerHTML = `<div class="callout callout-info">${Lang.t('updatesLockedNoSignature')}</div>`;
            if (q('#sys-update-run')) q('#sys-update-run').disabled = true;
            return;
        }
        if (status.error === 'update_runner_disabled' || status.enabled === false) {
            area.innerHTML = `<div class="callout callout-info">${Lang.t('updaterDeploymentDisabled')}</div>`;
            const runBtn = q('#sys-update-run');
            if (runBtn) runBtn.disabled = true;
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.httpStatus === 503 || status.httpStatus === 504 || status.httpStatus === 502) {
            area.innerHTML = `<div class="callout callout-danger">${Lang.format('updaterNotResponding', { code: Utils.esc(String(status.httpStatus)) })}</div>
                <button class="btn-secondary btn-sm" id="sys-update-retry" type="button">${Icon('refresh-cw', 15)}${Lang.t('checkAgain')}</button>`;
            q('#sys-update-retry').onclick = () => AdminBoard.renderUpdateStatus();
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.error === 'github_unreachable') {
            area.innerHTML = `<div class="callout callout-danger">${Lang.t('githubUnreachable')}</div>`;
            if (q('#sys-update-run')) q('#sys-update-run').disabled = true;
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.error || status.httpStatus !== 200) {
            area.innerHTML = `<div class="callout callout-danger">${Lang.format('updateStatusLoadFailed', { code: Utils.esc(String(status.httpStatus)) })}</div>`;
            return;
        }
        const job = status.job;
        const updateAvailable = !!status.updateAvailable;
        // Fuer die Bestaetigungsdialoge der Klick-Handler weiter unten (Commit-Pinning).
        AdminBoard._lastUpdateStatus = status;
        area.innerHTML = `
            <div class="settings-summary-grid">
                <div class="summary-card"><span>${Lang.t('localVersion')}</span><strong>${Utils.esc((status.localCommit || '').slice(0, 12) || '-')}</strong><small>${Utils.esc(status.localSubject || '')}</small></div>
                <div class="summary-card"><span>${Lang.t('githubVersion')}</span><strong>${Utils.esc((status.remoteCommit || '').slice(0, 12) || '-')}</strong><small>${Utils.esc(status.remoteSubject || '')}</small></div>
                <div class="summary-card"><span>${Lang.t('status')}</span><strong>${updateAvailable ? Lang.format('updatesAvailable', { count: status.commitsBehind || 1 }) : Lang.t('upToDate')}</strong><small>${Utils.esc(status.branch || 'main')}</small></div>
            </div>
            ${job ? `<div class="update-log ${job.failed ? 'failed' : job.ok ? 'ok' : 'running'}">
                <strong>${job.running ? Lang.t('updateRunning') : job.ok ? Lang.t('lastUpdateSuccessful') : job.failed ? Lang.t('lastUpdateFailed') : ''}</strong>
                ${AdminBoard.renderUpdateProgress(job)}
                <pre>${Utils.esc((job.log || []).slice(-18).join('\n'))}</pre>
            </div>` : ''}
        `;
        const runBtn = q('#sys-update-run');
        // Ist kein neues Update verfügbar, der letzte Lauf aber fehlgeschlagen (z.B. Build/
        // Migration/Neustart abgebrochen), bleibt die Installation trotzdem anklickbar: der
        // lokale Stand ist bereits auf der neuesten Version, nur die restlichen Schritte
        // (Build/Migration/Neustart) müssen erneut laufen. Ohne das könnte man einen
        // fehlgeschlagenen Lauf nie wiederholen, solange GitHub keinen weiteren Commit liefert.
        const canRetryFailed = !updateAvailable && !!job?.failed;
        if (runBtn) {
            runBtn.disabled = (!updateAvailable && !canRetryFailed) || !!job?.running;
            runBtn.innerHTML = canRetryFailed
                ? `${Icon('refresh-cw', 15)}${Lang.t('reinstallLastUpdate')}`
                : `${Icon('download-cloud', 15)}${Lang.t('installUpdate')}`;
        }
        if (canRetryFailed) {
            area.insertAdjacentHTML('beforeend', `<div class="callout callout-info">${Lang.t('noNewCommitButFailedRun')}</div>`);
        }
        // Rollback-Button: nur sichtbar, wenn der Updater einen Commit von vor dem letzten
        // erfolgreichen Update kennt (siehe updater-server.mjs runUpdate -> writeHistory).
        if (status.rollbackAvailable && !job?.running) {
            area.insertAdjacentHTML('beforeend', `
                <div class="setting-row">
                    <span class="hint">${Lang.format('rollbackHint', { commit: `<code>${Utils.esc((status.rollbackCommit || '').slice(0, 12))}</code>` })}</span>
                    <button class="btn-secondary btn-sm" id="sys-update-rollback" type="button">${Icon('undo-2', 15)}${Lang.t('rollback')}</button>
                </div>`);
            q('#sys-update-rollback').onclick = async () => {
                const stepUp = await AdminBoard.confirmStepUp(Lang.t('rollbackConfirmMessage'), (status.rollbackCommit || '').slice(0, 12));
                if (!stepUp) return;
                q('#sys-update-rollback').disabled = true;
                const result = await Store.runRollback(status.rollbackCommit, stepUp.password, stepUp.totpCode);
                if (!result || ![200, 202].includes(result.httpStatus)) {
                    UI.toast(result?.error === 'wrong_password' ? Lang.t('wrongPassword') : result?.error === 'invalid_totp_code' ? Lang.t('invalidMfaCode') : Lang.t('rollbackFailed'));
                    await AdminBoard.renderUpdateStatus();
                    return;
                }
                UI.toast(Lang.t('rollbackStarted'));
                await AdminBoard.renderUpdateStatus();
            };
        }
        if (window.lucide) lucide.createIcons();
        if (job?.running) {
            AdminBoard.updatePollTimer = setTimeout(() => AdminBoard.renderUpdateStatus(), 4000);
        }
    },

    openSystemSettings: async () => {
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
                        <button class="tab-btn active" data-tab="sys-general">
                            <i data-lucide="sliders"></i><span>${Lang.t('general')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-security">
                            <i data-lucide="shield"></i><span>Sicherheit</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-notifications">
                            <i data-lucide="bell"></i><span>Benachrichtigungen</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-email">
                            <i data-lucide="mail"></i><span>E-Mail Einstellungen / Benachrichtigungen</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-ldap">
                            <i data-lucide="server"></i><span>LDAP</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-outlook">
                            <i data-lucide="mail-check"></i><span>${Lang.t('outlookSetupTab')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-company">
                            <i data-lucide="building-2"></i><span>${Lang.t('companySettingsTab')}</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-update">
                            <i data-lucide="download-cloud"></i><span>${Lang.t('update')}</span>
                        </button>
                    </nav>
                    <div class="modal-body sys-settings-content">
                        <div class="callout" hidden>Microsoft-Graph/Outlook-Integration gibt es im aktuellen Backend nicht -- dieses Feld
                            wurde entfernt statt ungespeichert vorzutäuschen. Automatische Zuweisung l&auml;uft über die Kategorie
                            (Benutzerverwaltung → Kategorien → „Automatische Zuweisung an Gruppe").</div>
                        <!-- Sicherheit -->
                        <div id="sys-security" class="tab-content">
                            <div class="field">
                                <label>${Lang.t('enforce2FA')}</label>
                                <select id="sys-2fa-enforce">
                                    <option value="none">${Lang.t('enforceNone')}</option>
                                    <option value="all">${Lang.t('enforceAll')}</option>
                                    <option value="admin">${Lang.t('enforceAdminOnly')}</option>
                                    <option value="user">${Lang.t('enforceUserOnly')}</option>
                                </select>
                                <div class="hint">${Lang.t('enforce2FAHint')}</div>
                            </div>
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
                            <div class="settings-section-title">${Lang.t('accountSelfManagement')}</div>
                            <div class="hint">${Lang.t('accountSelfManagementHint')}</div>
                            <label class="check-row"><input type="checkbox" id="sys-acc-name"><span>${Lang.t('name')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-email"><span>${Lang.t('email')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-dept"><span>${Lang.t('department')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-phone"><span>${Lang.t('phone')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-mobile"><span>${Lang.t('mobile')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-jobTitle"><span>${Lang.t('jobTitle')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-officeLocation"><span>${Lang.t('location')}</span></label>
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
                        <div id="sys-outlook" class="tab-content">
                            <div class="callout">${Lang.format('outlookIntegrationCallout', { help: FieldHelp(Lang.t('outlookIntegrationHelp')) })}</div>
                            <div class="callout callout-info">${Lang.format('outlookPersonalCalendarHint', { redirectUri: `<code>${Utils.esc(window.location.origin + '/api/v2/outlook/callback')}</code>` })}</div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-enabled"><span><strong>${Lang.t('outlookEnableIntegration')}</strong></span></label>
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('tenantId')} ${FieldHelp(Lang.t('tenantIdHelp'))}</label><input id="sys-outlook-tenant" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
                                <div class="field"><label>${Lang.t('clientId')} ${FieldHelp(Lang.t('clientIdHelp'))}</label><input id="sys-outlook-client" type="text" placeholder="App Registration Client-ID"></div>
                            </div>
                            <div class="field"><label>${Lang.t('clientSecret')} ${FieldHelp(Lang.t('clientSecretHelp'))}</label><input id="sys-outlook-secret" type="password" placeholder="${Lang.t('leaveEmptyUnchanged')}"></div>
                            <div class="field"><label>${Lang.t('supportMailbox')} ${FieldHelp(Lang.t('supportMailboxHelp'))}</label><input id="sys-outlook-mailbox" type="email" placeholder="support@example.com"></div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-sync" disabled><span>${Lang.t('outlookSyncNotAvailable')}</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-create" disabled><span>${Lang.t('outlookCreateNotAvailable')}</span></label>
                            <div class="setting-row">
                                <span class="hint" id="sys-outlook-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-outlook-save" type="button">${Icon('save', 15)}${Lang.t('saveOutlookSettings')}</button>
                            </div>
                        </div>

                        <!-- Update -->
                        <div id="sys-update" class="tab-content">
                            <div class="callout">${Lang.t('updateTabCallout')}</div>
                            <div class="update-status" id="sys-update-status">
                                <div class="empty-state compact">${Lang.t('notCheckedYet')}</div>
                            </div>
                            <div class="setting-row">
                                <span class="hint">${Lang.t('onlySuperadminsCanStartUpdates')}</span>
                                <div class="button-row">
                                    <button class="btn-secondary btn-sm" id="sys-update-check" type="button">${Icon('refresh-cw', 15)}${Lang.t('check')}</button>
                                    <button class="btn-primary btn-sm" id="sys-update-run" type="button">${Icon('download-cloud', 15)}${Lang.t('installUpdate')}</button>
                                </div>
                            </div>
                            <div class="setting-row">
                                <span class="hint">${Lang.t('dbBehindCodeHint')}</span>
                                <div class="button-row">
                                    <button class="btn-secondary btn-sm" id="sys-update-migrate" type="button">${Icon('database', 15)}${Lang.t('runDbMigrations')}</button>
                                </div>
                            </div>
                        </div>

                        <!-- LDAP -->
                        <div id="sys-ldap" class="tab-content">
                            <div class="callout">${Lang.t('ldapSupplementCallout')}</div>
                            <label class="check-row"><input type="checkbox" id="sys-ldap-enabled"><span><strong>${Lang.t('enableLdapLogin')}</strong></span></label>
                            <div class="field"><label>${Lang.t('serverUrl')}</label><input id="sys-ldap-url" type="text" placeholder="ldap://dc.example.com:389 oder ldaps://..."></div>
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
                            <div class="field field-wide"><label>${Lang.t('emailTemplate')} ${FieldHelp(Lang.t('emailTemplateHelp'))}</label><textarea id="sys-email-template" rows="4" placeholder="{{ticketTitle}}, {{status}}, {{message}}"></textarea></div>
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
                                <div class="field"><label>${Lang.t('transportSecurity')} ${FieldHelp(Lang.t('transportSecurityHelp'))}</label><select id="sys-email-transport"><option value="starttls">${Lang.t('forceStarttls')}</option><option value="tls">${Lang.t('forceTls')}</option><option value="opportunistic">${Lang.t('opportunistic')}</option></select></div>
                                <div class="field"><label>${Lang.t('certificateCheck')} ${FieldHelp(Lang.t('certificateCheckHelp'))}</label><select id="sys-email-cert-mode"><option value="strict">${Lang.t('checkStrict')}</option><option value="allow-self-signed">${Lang.t('allowSelfSigned')}</option><option value="disabled">${Lang.t('disabled')}</option></select></div>
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
                                <div class="field"><label>${Lang.t('defaultTimezone')}</label><input id="sys-company-timezone" type="text" placeholder="Europe/Berlin"></div>
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
                            <div class="form-grid">
                                <div class="field"><label>${Lang.t('defaultFormat')}</label><input id="sys-ticket-number-format" type="text" placeholder="{prefix}-{number}"></div>
                                <div class="field"><label>${Lang.t('prefixLabel')}</label><input id="sys-ticket-number-prefix" type="text" placeholder="TS"></div>
                                <div class="field"><label>${Lang.t('sequenceDigits')}</label><input id="sys-ticket-number-padding" type="number" min="1" max="12" placeholder="5"></div>
                            </div>
                            <div class="field field-wide">
                                <label>${Lang.t('categoryFormats')}</label>
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

            // Tab Logic
            modal.querySelectorAll('.tab-btn').forEach(btn => {
                btn.onclick = () => {
                    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    q('#' + btn.dataset.tab).classList.add('active');
                    if (btn.dataset.tab === 'sys-update') AdminBoard.renderUpdateStatus();
                    else clearTimeout(AdminBoard.updatePollTimer);
                    if (window.lucide) lucide.createIcons();
                };
            });

            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => {
                modal.classList.remove('open');
                clearTimeout(AdminBoard.updatePollTimer);
            });
            q('#sys-update-check').onclick = () => AdminBoard.renderUpdateStatus();
            q('#sys-update-run').onclick = async () => {
                // Commit-Pinning: der Ziel-Commit ist IMMER der zuletzt angezeigte Stand (bei
                // "neues Update verfügbar" der entfernte, bei "letztes Update erneut
                // installieren" der bereits lokale) -- die Person bestätigt damit genau das, was
                // sie zuletzt auf dem Bildschirm gesehen hat, siehe update.ts Commit-Pinning.
                const status = AdminBoard._lastUpdateStatus || {};
                const targetCommit = status.updateAvailable ? status.remoteCommit : status.localCommit;
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
            q('#sys-update-migrate').onclick = async () => {
                const stepUp = await AdminBoard.confirmStepUp(Lang.t('migrateConfirmMessage'));
                if (!stepUp) return;
                const btn = q('#sys-update-migrate');
                btn.disabled = true;
                UI.toast(Lang.t('migrationsRunning'));
                const result = await Store.runMigrate(stepUp.password, stepUp.totpCode);
                btn.disabled = false;
                if (!result || result.httpStatus !== 200) {
                    const msg = result?.error === 'wrong_password' ? Lang.t('wrongPassword')
                        : result?.error === 'invalid_totp_code' ? Lang.t('invalidMfaCode')
                        : result?.log ? Lang.format('migrationsFailedWithLog', { log: result.log.slice(0, 200) })
                        : Lang.t('migrationsFailedUnreachable');
                    UI.toast(msg);
                    return;
                }
                UI.toast(Lang.t('dbNowUpToDate'));
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
        q('#sys-default-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(general.defaultPrio) ? general.defaultPrio : 'Normal';
        q('#sys-wait-remind').value = general.waitingReminderDays ?? 2;
        q('#sys-wait-close').value = general.waitingAutoCloseDays ?? 7;
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
        q('#sys-company-timezone').value = companyBranding.timezone || 'Europe/Berlin';
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
            const categories = (await Store.getCategories()).filter(c => !c.archived);
            categoryFormatList.innerHTML = categories.length ? categories.map(c => `
                <div class="ticket-number-category-row">
                    <label>${Utils.esc(c.name)}</label>
                    <input type="text" data-ticket-category="${Utils.esc(c.name)}" placeholder="{prefix}-{number}" value="${Utils.esc(categoryFormatValues[c.name] || '')}">
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noCategoriesCreated')}</div>`;
        }

        q('#sys-2fa-enforce').value = security.force2FA || 'none';
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
        q('#sys-email-text-signature').value = emailAdvanced.signature || '';
        q('#sys-email-html-enabled').checked = !!emailAdvanced.htmlEnabled;
        q('#sys-email-signature').value = emailAdvanced.htmlSignature || '';
        q('#sys-email-transport').value = emailAdvanced.transportSecurity || 'starttls';
        q('#sys-email-cert-mode').value = emailAdvanced.certificateValidation || 'strict';
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
        q('#sys-outlook-sync').checked = !!outlook.syncIncoming;
        q('#sys-outlook-create').checked = !!outlook.createTicketsFromMail;
        const outlookServer = await Store.getOutlookConfig();
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
                        mailbox: q('#sys-outlook-mailbox').value.trim()
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
        q('#sys-acc-name').checked = accEditable.name !== false;
        q('#sys-acc-email').checked = accEditable.email !== false;
        q('#sys-acc-dept').checked = !!accEditable.department;
        q('#sys-acc-phone').checked = !!accEditable.phone;
        q('#sys-acc-mobile').checked = !!accEditable.mobile;
        q('#sys-acc-jobTitle').checked = !!accEditable.jobTitle;
        q('#sys-acc-officeLocation').checked = !!accEditable.officeLocation;

        const appr = settings.approvalConfig || {};
        q('#sys-appr-enabled').checked = !!appr.enabled;
        qa('.sys-appr-prio').forEach(cb => { cb.checked = (appr.priorities || []).includes(cb.value); });
        const apprFallbackUsers = (await Store.getUsers()).filter(u => !u.accountArchived);
        apprFallbackPicker = UI.createMultiSelect(
            q('#sys-appr-fallback'),
            apprFallbackUsers.map(u => ({ value: u.id, label: u.name || u.username })),
            appr.fallbackApproverUserId || '', null, { single: true, emptyLabel: Lang.t('noneAutoSuperadmin') }
        );

        const smtp = await Store.getSmtpConfig();
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

        const ldap = await Store.getLdapConfig();
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
        if (q('#sys-update')?.classList.contains('active')) AdminBoard.renderUpdateStatus();

        q('#sys-save').onclick = async () => {
            const padding = Math.max(1, Math.min(12, parseInt(q('#sys-ticket-number-padding').value, 10) || 5));
            const accFieldIdMap = { department: 'dept' };
            const accountSelfServiceFields = ['name', 'email', 'department', 'phone', 'mobile', 'jobTitle', 'officeLocation'].filter(f => q(`#sys-acc-${accFieldIdMap[f] || f}`).checked);
            const ok = await Store.updateServerSettings({
                companyName: q('#sys-company-name').value.trim(),
                portalName: q('#sys-portal-name').value.trim() || 'Support Portal',
                config: {
                    autoArchiveClosedAfterDays: Math.max(0, parseInt(q('#sys-auto-archive').value, 10) || 0),
                    waitingReminderDays: Math.max(1, parseInt(q('#sys-wait-remind').value, 10) || 2),
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
                    securityConfig: {
                        force2FA: q('#sys-2fa-enforce').value,
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
                        certificateValidation: q('#sys-email-cert-mode').value,
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
                    accountSelfServiceFields,
                    approvalWorkflow: {
                        enabled: q('#sys-appr-enabled').checked,
                        priorities: qa('.sys-appr-prio:checked').map(cb => cb.value),
                        fallbackApproverUserId: apprFallbackPicker?.getValue() || null
                    }
                }
            });
            if (!ok) {
                console.error('Systemeinstellungen speichern fehlgeschlagen:', Store.lastError);
                return UI.toast(Lang.t('systemSettingsSaveFailed'));
            }
            if (q('.kanban-board')) await AdminBoard.render();
            if (q('#user-tickets')) await UserDash.renderList();
            modal.classList.remove('open');
            UI.toast(Lang.t('systemSettingsSaved'));
        };
    },

    // Listenansicht: Tabelle mit sortierbaren Spalten, Filtern, gespeicherten Ansichten
    // und Mehrfachauswahl für Sammelaktionen -- für Admins mit vielen offenen Tickets,
    // wo ein Kanban-Board nicht mehr überschaubar ist.
    listViewState: { sortKey: 'prio', sortDir: 'desc', selected: new Set() },

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
                            <label class="check-row compact"><input type="checkbox" id="lv-sla-risk">${Lang.t('slaAtRisk')}</label>
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
                            <th data-sort="sla">${Lang.t('colDeadline')}</th>
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
        teamSel.innerHTML = `<option value="">${Lang.t('allTeams')}</option>` + groups.map(g => `<option value="${Utils.esc(g.id)}" ${g.id === curTeam ? 'selected' : ''}>${Utils.esc(g.name)}</option>`).join('');
        const viewsSel = q('#lv-saved-views');
        viewsSel.innerHTML = `<option value="">${Lang.t('savedViewPlaceholder')}</option>` + views.filter(v => v.ownerUserId === actor?.id || v.isShared).map(v => `<option value="${v.id}">${Utils.esc(v.name)}${v.isShared ? ` (${Lang.t('shared')})` : ''}</option>`).join('');
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
        const slaRiskOnly = q('#lv-sla-risk').checked;

        let visible = tickets.filter(t => !t.archived);
        if (actor?.role === 'admin') visible = visible.filter(t => AdminBoard.canAccessTicket(actor, t));
        if (search.trim()) visible = visible.filter(t => Utils.matchesSearch(search, t));
        if (statusFilter) visible = visible.filter(t => t.status === statusFilter);
        if (prioFilter) visible = visible.filter(t => t.prio === prioFilter);
        if (catFilter) visible = visible.filter(t => (Array.isArray(t.category) ? t.category : [t.category]).includes(catFilter));
        if (teamFilter) visible = visible.filter(t => t.team === teamFilter);
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

        const body = q('#lv-body');
        body.innerHTML = visible.length ? visible.map(t => {
            const team = t.team ? groups.find(g => g.id === t.team) : null;
            const countdown = Store.formatSlaCountdown(t, settings);
            const checked = AdminBoard.listViewState.selected.has(t.id) ? 'checked' : '';
            const pendingApproval = (t.approvals || []).some(a => a.status === 'pending');
            return `<tr data-id="${Utils.esc(t.id)}" data-ctx="ticket" class="lv-row">
                <td><input type="checkbox" data-id="${Utils.esc(t.id)}" ${checked}></td>
                <td>${Utils.esc(t.ticketNumber || t.id)}</td>
                <td class="lv-title" title="${Utils.esc(t.title)}">${t.isMajorIncident ? `<span class="t-incident-badge lv-incident-icon" title="${Lang.t('majorIncident')}">${Icon('siren', 12)}</span> ` : ''}${Utils.esc(t.title)}</td>
                <td>${pendingApproval ? `<span class="approval-badge" title="${Lang.t('awaitingApproval')}">${Icon('hourglass', 12)}${Lang.t('approvals')}</span>` : `<span class="status-badge">${Utils.esc(Lang.status(t.status))}</span>`}</td>
                <td><span class="t-tag prio-${t.prio}">${Utils.esc(Lang.prio(t.prio))}</span></td>
                <td>${Utils.esc((Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean).join(', ') || '-')}${team ? ` <span class="t-team">${Icon('route', 10)}${Utils.esc(team.name)}</span>` : ''}</td>
                <td>${Utils.esc(nameFor(t.owner))}</td>
                <td>${Utils.esc(Utils.fmtDate(t.createdAt))}</td>
                <td>${countdown ? `<span class="sla-mini-badge sla-badge-${countdown.tone}" title="${Lang.t('deadline')}: ${Utils.esc(countdown.dueDateLabel)}">${Utils.esc(countdown.dueDateLabel)} · ${Utils.esc(countdown.label)}</span>` : '-'}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty-state">${Lang.t('noTickets')}</div></td></tr>`;

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
        // Die In-App-Benachrichtigung an die jeweiligen Ticketersteller erzeugt die Server-PATCH-
        // Route bereits pro geaendertem Ticket. Hier keine zweite Client-Benachrichtigung senden.
        const requestDetails = newStatus === 'Warten auf Benutzer' ? `\nAnforderung: ${ticket.waitingMessage}` : '';
        await Store.addGlobalLog('Ticket Status geändert', `Ticket: ${ticket.title}, Status: ${newStatus}${requestDetails}`);
        const notificationMessage = newStatus === 'Warten auf Benutzer' ?
            Lang.format('infoNeededColon', { message: ticket.waitingMessage }) :
            Lang.format('statusChangedTo', { status: Lang.status(newStatus) });
        const statusNotifType = newStatus === 'Geschlossen' ? 'ticketClosed' : 'statusChange';
        const participantRecipients = (ticket.participants || []).filter(name => name && name !== ticket.author);
        if (participantRecipients.length) {
            await Store.addNotifications(participantRecipients, ticket, notificationMessage, actor?.username, statusNotifType);
        }

        const settings = await Store.getSettings();
        const author = (await Store.getUsers()).find(user => user.username === ticket.author);
        if (author?.email && settings.emailConfig?.host) {
            const statusPref = await Store.resolveNotifPref(author, statusNotifType);
            if (statusNotifType === 'ticketClosed' && statusPref.email) {
                await Store.sendEmail(author.email, Lang.format('ticketClosedEmailSubject', { title: ticket.title }), Lang.t('ticketClosedEmailBody'));
            } else if (statusNotifType === 'statusChange' && statusPref.email) {
                await Store.sendEmail(author.email, Lang.format('ticketUpdateEmailSubject', { title: ticket.title }), Lang.format('ticketUpdateEmailBody', { status: Lang.status(newStatus) }) + (newStatus === 'Warten auf Benutzer' ? `\n\n${Lang.format('infoNeededColon', { message: ticket.waitingMessage })}` : ''));
            }
        }
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
                        ${staff.map(u => `<option value="${u.username}">${u.name || u.username}</option>`).join('')}
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
        const commentsSection = details.querySelector('.comments-section');
        if (commentsSection) commentsSection.before(section);
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
        const fmt = ms => new Date(ms).toLocaleDateString('de-DE');
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
        const fmt = ms => new Date(ms).toLocaleDateString('de-DE');
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
        await Store.addNotifications([username], ticket, Lang.format('ticketAssignedWhileAbsent', { title: ticket.title }), actorUsername, 'newTicket');
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
            ['btn-approvals', 'badge-check', 'Genehmigungen', 'approvals', () => AdminBoard.openApprovals()],
            ['btn-recurring', 'repeat', 'Wiederkehrende Tickets', 'recurring', () => AdminBoard.openRecurring()]
        ];
        extras.filter(([, , , perm]) => AdminBoard.can(user, perm)).forEach(([id, icon, label, , handler]) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.type = 'button';
            btn.className = 'btn-ghost';
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
                <div id="tb-list"></div>
                <div class="field"><label for="tb-title">${Lang.t('titleLabel')}</label><input id="tb-title" type="text" placeholder="${Lang.t('egDeviceTypeQuery')}"></div>
                <div class="field"><label for="tb-text">${Lang.t('textLabel')}</label><textarea id="tb-text" rows="4" placeholder="${Lang.t('chatInsertTextPlaceholder')}"></textarea></div>
                <div class="setting-row"><span class="hint">${Lang.t('textBlocksAvailableHint')}</span>
                    <button class="btn-primary btn-sm" id="tb-add" type="button">${Icon('plus', 15)}${Lang.t('add')}</button>
                </div>`
        });
        const render = async () => {
            const list = await Store.getTextBlocks();
            modal.querySelector('#tb-list').innerHTML = list.length ? list.map(b => `
                <div class="absence-overview-row">
                    <div><strong>${Utils.esc(b.title)}</strong><span class="hint">${Utils.esc(b.text)}</span></div>
                    <button class="btn-ghost btn-icon btn-danger tb-del" type="button" data-id="${Utils.esc(b.id)}" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noTextBlocksYet')}</div>`;
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
            if (!(await Store.createTextBlock(title, text))) return UI.toast(Lang.t('saveFailed'));
            modal.querySelector('#tb-title').value = '';
            modal.querySelector('#tb-text').value = '';
            await render();
        };
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

    openKnowledgeBase: async () => {
        const user = await Store.currentUser();
        // Wie in der lokalen Version: Superadmin darf immer bearbeiten, ein normaler Admin nur
        // mit explizit zugewiesenem permissions.kb = 'edit'.
        const canEdit = user?.role === 'superadmin' || user?.permissions?.kb === 'edit';
        const modal = AdminBoard.openDialog({
            id: 'kb-modal',
            title: Lang.t('knowledgeBase'),
            icon: 'book-open',
            size: 'md',
            body: `<input type="search" id="kb-search" class="section-search" placeholder="${Lang.t('searchArticlesPlaceholder')}">
                   <div id="kb-list" class="mt-3"></div>
                   ${canEdit ? `<div class="kb-editor">
                       <h4 class="section-title">${Lang.t('newArticle')}</h4>
                       <div class="field"><label for="kb-new-title">${Lang.t('titleLabel')}</label><input id="kb-new-title" type="text"></div>
                       <div class="field">
                           <label for="kb-new-body">${Lang.t('content')}</label>
                           <div class="note-toolbar">
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-bold" title="${Lang.t('bold')}" aria-label="${Lang.t('bold')}">${Icon('bold', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-italic" title="${Lang.t('italic')}" aria-label="${Lang.t('italic')}">${Icon('italic', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-list" title="${Lang.t('list')}" aria-label="${Lang.t('list')}">${Icon('list', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-numbered" title="${Lang.t('numberedList')}" aria-label="${Lang.t('numberedList')}">${Icon('list-ordered', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-table" title="${Lang.t('insertTable')}" aria-label="${Lang.t('insertTable')}">${Icon('table', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-link" title="${Lang.t('insertLink')}" aria-label="${Lang.t('insertLink')}">${Icon('link', 15)}</button>
                               <label class="btn btn-ghost btn-icon btn-sm" title="${Lang.t('addAttachment')}" aria-label="${Lang.t('addAttachment')}">${Icon('paperclip', 15)}<input type="file" id="kb-file-input" hidden multiple></label>
                           </div>
                           <div id="kb-new-body" class="rich-editor" contenteditable="true" data-placeholder="${Lang.t('richEditorPlaceholder')}"></div>
                           <div id="kb-file-preview" class="file-preview"></div>
                       </div>
                   </div>` : ''}`,
            onSave: canEdit ? async (m) => {
                const title = m.querySelector('#kb-new-title').value.trim();
                const bodyEl = m.querySelector('#kb-new-body');
                const body = Utils.sanitizeRichHtml(bodyEl.innerHTML);
                if (!title || !bodyEl.textContent.trim()) return UI.toast(Lang.t('enterTitleAndContent'));
                const articleId = await Store.createKbArticle(title, body);
                if (!articleId) return UI.toast(Lang.t('saveFailed'));
                if (AdminBoard.kbFiles.length) {
                    try {
                        await Promise.all(AdminBoard.kbFiles.map(f => Store.saveKbAttachment(articleId, f)));
                    } catch (e) {
                        UI.toast(e.message === 'ATTACHMENT_TOO_LARGE' ? Lang.t('attachmentTooLarge15MB') : Lang.t('articleSavedAttachmentFailed'));
                    }
                }
                m.querySelector('#kb-new-title').value = '';
                bodyEl.innerHTML = '';
                AdminBoard.kbFiles = [];
                renderKbFilePreview();
                UI.toast(Lang.t('articleSavedToast'));
                await render();
            } : null
        });
        AdminBoard.kbFiles = [];
        const renderKbFilePreview = () => {
            const preview = modal.querySelector('#kb-file-preview');
            if (!preview) return;
            preview.innerHTML = '';
            AdminBoard.kbFiles.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'file-chip';
                chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="${Lang.t('removeFile')}" aria-label="${Lang.format('removeFileAriaLabel', { name: file.name })}">${Icon('x', 13)}</button>`;
                chip.querySelector('button').onclick = () => {
                    AdminBoard.kbFiles.splice(index, 1);
                    renderKbFilePreview();
                };
                preview.appendChild(chip);
            });
            if (window.lucide) lucide.createIcons();
        };
        if (canEdit) {
            const bodyInput = modal.querySelector('#kb-new-body');
            // Verhindert, dass ein Klick auf die Werkzeugleiste den Fokus/die Auswahl im Editor verliert
            modal.querySelectorAll('.kb-editor .note-toolbar button').forEach(btn => { btn.onmousedown = e => e.preventDefault(); });
            modal.querySelector('#kb-fmt-bold').onclick = () => { bodyInput.focus(); document.execCommand('bold'); };
            modal.querySelector('#kb-fmt-italic').onclick = () => { bodyInput.focus(); document.execCommand('italic'); };
            modal.querySelector('#kb-fmt-list').onclick = () => { bodyInput.focus(); document.execCommand('insertUnorderedList'); };
            modal.querySelector('#kb-fmt-numbered').onclick = () => { bodyInput.focus(); document.execCommand('insertOrderedList'); };
            modal.querySelector('#kb-fmt-table').onclick = () => insertMarkdownTable(bodyInput);
            modal.querySelector('#kb-fmt-link').onclick = async () => {
                const sel = window.getSelection();
                const savedRange = (sel && sel.rangeCount && bodyInput.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : null;
                const selectedText = savedRange ? savedRange.toString() : '';
                const href = await UI.promptText({ title: Lang.t('insertLink'), label: Lang.t('linkAddress'), value: '', placeholder: Lang.t('linkPlaceholderExample'), saveLabel: Lang.t('insertLink') });
                if (!href || !href.trim()) return;
                if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) return UI.toast(Lang.t('onlyHttpMailtoLinksAllowed'));
                bodyInput.focus();
                const sel2 = window.getSelection();
                sel2.removeAllRanges();
                if (savedRange) sel2.addRange(savedRange);
                if (selectedText) document.execCommand('createLink', false, href.trim());
                else document.execCommand('insertHTML', false, `<a href="${Utils.esc(href.trim())}" target="_blank" rel="noopener noreferrer">${Utils.esc(href.trim())}</a>`);
                bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
            };
            const kbFileInput = modal.querySelector('#kb-file-input');
            kbFileInput.onchange = (e) => {
                AdminBoard.kbFiles.push(...Array.from(e.target.files || []));
                renderKbFilePreview();
                e.target.value = '';
            };
            const addKbFiles = files => {
                AdminBoard.kbFiles.push(...files);
                renderKbFilePreview();
            };
            UI.bindFileDrop(modal.querySelector('.kb-editor'), addKbFiles);
            UI.bindPasteFiles(bodyInput, addKbFiles);
        }
        const render = async () => {
            const term = modal.querySelector('#kb-search').value.toLowerCase().trim();
            const articles = (await Store.getKbArticles()).filter(a => !term || `${a.title} ${a.body}`.toLowerCase().includes(term));
            modal.querySelector('#kb-list').innerHTML = articles.length ? articles.map(a => `
                <details class="kb-article" data-id="${Utils.esc(a.id)}">
                    <summary><strong>${Utils.esc(a.title)}</strong> <span class="hint">${Utils.esc(a.source || '')} · ${Utils.fmtDate(a.createdAt)}</span></summary>
                    <div class="desc-text rich-content">${Utils.sanitizeRichHtml(a.body)}</div>
                    <div class="file-preview kb-article-attachments" hidden></div>
                    ${canEdit ? `<button class="btn-ghost btn-sm kb-del" type="button" data-id="${Utils.esc(a.id)}">${Icon('trash-2', 14)}${Lang.t('delete')}</button>` : ''}
                </details>`).join('') : `<div class="empty-state compact">${Lang.t('noArticlesFound')}</div>`;
            modal.querySelectorAll('.kb-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteKbArticle(btn.dataset.id);
                await render();
            });
            // Anhänge je Artikel erst beim Aufklappen laden, nicht pauschal für alle Treffer.
            modal.querySelectorAll('.kb-article').forEach(details => {
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
        modal.querySelector('#kb-search').oninput = render;
        await render();
    },

    // t.comments existiert nicht mehr lokal (immer [], siehe mapApiTicketToLegacy) -- vorher
    // fand dieser Knopf dadurch NIE einen Lösungsweg und meldete immer "gibt noch keinen
    // Lösungsweg", selbst wenn einer dokumentiert war. Lädt die echten Notizen jetzt frisch.
    addSolutionToKnowledgeBase: async (t) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/notes`, { credentials: 'same-origin' }).catch(() => null);
        const notes = res && res.ok ? (await res.json()).notes || [] : [];
        const solution = notes.filter(n => n.stream === 'solution');
        if (!solution.length) return UI.toast(Lang.t('noSolutionYetInTicket'));
        const title = await UI.promptText({ title: Lang.t('knowledgeArticle'), label: Lang.t('articleTitle'), value: t.title, saveLabel: Lang.t('save') });
        if (!title || !title.trim()) return;
        const body = solution.map(n => n.content || '').join('\n\n');
        if (!(await Store.createKbArticle(title.trim(), body, t.id))) return UI.toast(Lang.t('saveFailed'));
        UI.toast(Lang.t('savedAsKnowledgeArticle'));
    },

    // Ausführung l&auml;uft serverseitig per Timer (jobs/maintenance.ts runRecurringTickets),
    // next_run_at wird dort nach jedem Lauf automatisch weitergerechnet -- kein Client-Trigger
    // und kein "Tag im Monat/Wochentag"-Modell mehr, sondern ein konkreter Start-Zeitpunkt.
    openRecurring: async () => {
        const settings = await Store.getSettings();
        const categories = settings.categories || ['Allgemein'];
        const modal = AdminBoard.openDialog({
            id: 'recurring-modal',
            title: Lang.t('recurringTickets'),
            icon: 'repeat',
            size: 'md',
            body: `
                <div id="rec-list"></div>
                <div class="field"><label for="rec-title">${Lang.t('subject')}</label><input id="rec-title" type="text" placeholder="${Lang.t('egCheckBackup')}"></div>
                <div class="field"><label for="rec-desc">${Lang.t('description')}</label><textarea id="rec-desc" rows="3"></textarea></div>
                <div class="form-grid">
                    <div class="field"><label for="rec-cat">${Lang.t('category')}</label><select id="rec-cat">${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}</select></div>
                    <div class="field"><label for="rec-prio">${Lang.t('priority')}</label><select id="rec-prio"><option>${Lang.t('low')}</option><option selected>${Lang.t('normal')}</option><option>${Lang.t('high')}</option><option>${Lang.t('critical')}</option></select></div>
                    <div class="field"><label for="rec-interval">${Lang.t('unit')}</label><select id="rec-interval"><option value="day">${Lang.t('days')}</option><option value="week" selected>${Lang.t('weeks')}</option><option value="month">${Lang.t('months')}</option></select></div>
                    <div class="field"><label for="rec-count">${Lang.t('everyHowManyUnits')}</label><input id="rec-count" type="number" min="1" value="1"></div>
                </div>
                <div class="field"><label>${Lang.t('firstRun')}</label>${UI.dateTimePickerMarkup('rec-next-run')}</div>
                <div class="setting-row"><span class="hint">${Lang.t('firstTicketAutoCreatedHint')}</span>
                    <button class="btn-primary btn-sm" id="rec-add" type="button">${Icon('plus', 15)}${Lang.t('add')}</button>
                </div>`
        });
        let recNextRunMs = Date.now();
        UI.createDateTimePicker(modal.querySelector('#rec-next-run'), { onChange: (ms) => { recNextRunMs = ms; } });
        const unitLabel = { day: Lang.t('days'), week: Lang.t('weeks'), month: Lang.t('months') };
        const render = async () => {
            const list = await Store.getRecurringRules();
            modal.querySelector('#rec-list').innerHTML = list.length ? list.map(r => `
                <div class="absence-overview-row">
                    <div><strong>${Utils.esc(r.title)}</strong><span class="hint">${Lang.format('recurringRuleSummary', { count: r.intervalCount, unit: unitLabel[r.intervalUnit] || r.intervalUnit, date: Utils.fmtDate(r.nextRunAt), category: Utils.esc(r.category || '-'), prio: Utils.esc(r.prio) })}${r.active ? '' : ' · ' + Lang.t('paused')}</span></div>
                    <button class="btn-ghost btn-icon btn-danger rec-del" type="button" data-id="${Utils.esc(r.id)}" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                </div>`).join('') : `<div class="empty-state compact">${Lang.t('noRecurringTickets')}</div>`;
            modal.querySelectorAll('.rec-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteRecurringRule(btn.dataset.id);
                await render();
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#rec-add').onclick = async () => {
            const title = modal.querySelector('#rec-title').value.trim();
            if (!title) return UI.toast(Lang.t('enterASubject'));
            const ok = await Store.createRecurringRule({
                title,
                desc: modal.querySelector('#rec-desc').value.trim(),
                category: modal.querySelector('#rec-cat').value,
                prio: modal.querySelector('#rec-prio').value,
                intervalUnit: modal.querySelector('#rec-interval').value,
                intervalCount: Math.max(1, parseInt(modal.querySelector('#rec-count').value, 10) || 1),
                nextRunAt: new Date(recNextRunMs).toISOString()
            });
            if (!ok) return UI.toast(Lang.t('saveFailed'));
            modal.querySelector('#rec-title').value = '';
            modal.querySelector('#rec-desc').value = '';
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

    openApprovals: async () => {
        const me = await Store.currentUser();
        const settings = await Store.getSettings();
        const modal = AdminBoard.openDialog({ id: 'approvals-modal', title: Lang.t('approvals'), icon: 'badge-check', size: 'lg', body: '<div id="apr-list"></div>' });
        const render = async () => {
            const tickets = (await Store.getTickets()).filter(t => (t.approvals || []).some(a => isPendingApprover(a, me.id)));
            const box = modal.querySelector('#apr-list');
            box.innerHTML = tickets.length ? tickets.map(t => {
                const a = t.approvals.find(x => isPendingApprover(x, me.id));
                const fields = Store.getCustomFieldsForCategories(t.category, settings.customFields || {});
                return `<details class="kb-article apr-row" open data-id="${Utils.esc(t.id)}">
                    <summary>
                        <strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong>
                        <span class="hint">${Lang.format('requestedBy', { name: Utils.esc(a.requestedByName) })}${a.reason ? ' · ' + Utils.esc(a.reason) : ''}</span>
                    </summary>
                    <div class="meta-grid">
                        <div class="meta-item"><strong>${Lang.t('priority')}</strong><span class="meta-value">${Utils.esc(t.prio)}</span></div>
                        <div class="meta-item"><strong>${Lang.t('category')}</strong><span class="meta-value">${Utils.esc((t.category || []).join(', ') || '-')}</span></div>
                    </div>
                    <h4 class="section-title">${Lang.t('description')}</h4>
                    <p class="desc-text">${Utils.esc(t.desc || '-')}</p>
                    ${fields.length ? `<div class="apr-fields"></div>` : ''}
                    <div class="apr-attachments"></div>
                    <div class="field approval-comment"><label>${Lang.t('decisionCommentLabel')}</label><textarea class="apr-comment" rows="3" maxlength="5000" placeholder="${Lang.t('decisionCommentPlaceholder')}"></textarea></div>
                    <div class="aa-actions">
                        <button class="btn-secondary btn-sm apr-open" type="button">${Icon('external-link', 14)}${Lang.t('openTicket')}</button>
                        <button class="btn-primary btn-sm apr-yes" type="button">${Icon('check', 14)}${Lang.t('approve')}</button>
                        <button class="btn-secondary btn-sm btn-danger apr-no" type="button">${Icon('x', 14)}${Lang.t('decline')}</button>
                    </div></details>`;
            }).join('') : `<div class="empty-state compact">${Lang.t('noOpenApprovalsHint')}</div>`;
            box.querySelectorAll('.apr-row').forEach(row => {
                const t = tickets.find(x => x.id === row.dataset.id);
                const fieldsBox = row.querySelector('.apr-fields');
                if (fieldsBox) UI.renderCustomFieldsDisplay(fieldsBox, Store.getCustomFieldsForCategories(t.category, settings.customFields || {}), t.customFieldValues || {});
                AdminBoard.renderTicketAttachments(t, row.querySelector('.apr-attachments'));
                row.querySelector('.apr-open').onclick = async () => {
                    modal.remove();
                    await AdminBoard.openTicketForCurrentPage(t.id);
                };
                const decide = async (status, reason) => {
                    if (!(await AdminBoard.decideApproval(row.dataset.id, status, reason))) return;
                    await render();
                    await AdminBoard.render();
                };
                row.querySelector('.apr-yes').onclick = () => decide('approved', row.querySelector('.apr-comment').value.trim());
                row.querySelector('.apr-no').onclick = async () => {
                    const reason = row.querySelector('.apr-comment').value.trim();
                    if (!reason || !reason.trim()) return UI.toast(Lang.t('enterAReason'));
                    await decide('rejected', reason.trim());
                };
            });
            if (window.lucide) lucide.createIcons();
        };
        await render();
    },

    // Nur Admin/Superadmin dürfen später über /approval-decision entscheiden (serverseitige
    // Rechteprüfung) -- deshalb werden hier auch nur Admin/Superadmin als Prüfer angeboten.
    requestApproval: async (t) => {
        const me = await Store.currentUser();
        const approvers = (await Store.getUsers()).filter(u => u.id !== me.id && u.role !== 'user' && !u.accountArchived);
        if (!approvers.length) return UI.toast(Lang.t('noOtherApproversAvailable'));
        const modal = AdminBoard.openDialog({
            id: 'approval-request-modal',
            title: Lang.t('requestApprovalTitle'),
            icon: 'badge-check',
            size: 'sm',
            body: `<div class="field"><label>${Lang.t('approvingPerson')}</label><div id="apr-approver"></div></div>
                   <div class="field"><label for="apr-note">${Lang.t('noteLabel')}</label><textarea id="apr-note" rows="3" placeholder="${Lang.t('whatShouldBeApprovedPlaceholder')}"></textarea></div>`,
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
        const owner = (await Store.getUsers()).find(u => u.username === t.author);
        const preselect = (owner?.supervisor && approvers.some(u => u.username === owner.supervisor))
            ? approvers.find(u => u.username === owner.supervisor)?.id
            : (approvers[0]?.id || '');
        const approverPicker = UI.createMultiSelect(modal.querySelector('#apr-approver'), approvers.map(u => ({ value: u.id, label: u.name || u.username })), preselect, null, { single: true, emptyLabel: Lang.t('pleaseChoose') });
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

    openAbsenceOverview: async () => {
        const users = await Store.getUsers();
        const absent = users.filter(u => u.absence?.active && u.absence?.visible);
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
                        <div class="field field-wide">
                            <label for="act-on-behalf-search">${Lang.t('onBehalfOf')}</label>
                            <input type="text" id="act-on-behalf-search" placeholder="${Lang.t('searchByNameOrUsername')}">
                            <div id="act-on-behalf-list" class="user-picker-list"></div>
                            <p class="hint">${Lang.t('personNotListedHint')}</p>
                        </div>
                        <div class="field field-wide">
                            <label for="act-title">${Lang.t('subject')}</label>
                            <input id="act-title" type="text" placeholder="${Lang.t('titlePlaceholder')}">
                        </div>
                        <div class="field field-wide">
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
                        <div class="field">
                            <label>${Lang.t('category')}</label>
                            <div id="act-cat-container"></div>
                        </div>
                        <div id="act-custom-fields" class="field-wide custom-fields-fill"></div>
                        <div class="field field-wide">
                            <label>${Lang.t('attachments')}</label>
                            <label for="act-files" class="dropzone" id="act-files-dropzone">
                                <i data-lucide="upload-cloud"></i>
                                <span class="dropzone-text"><strong>${Lang.t('dragFilesHere')}</strong> ${Lang.t('orClickToSelect')}</span>
                                <input id="act-files" type="file" multiple>
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
                chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="${Lang.t('removeFile')}" aria-label="${Lang.format('removeFileAriaLabel', { name: file.name })}">${Icon('x', 13)}</button>`;
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
        const categories = settings.categories && settings.categories.length ? settings.categories : ['Allgemein'];
        const refreshActCustomFields = (selectedCats) => {
            UI.renderCustomFieldsForm(q('#act-custom-fields'), Store.getCustomFieldsForCategories(selectedCats, settings));
        };
        AdminBoard.createTicketCategoryInstance = UI.createMultiSelect(q('#act-cat-container'), categories, [categories[0]], refreshActCustomFields);
        refreshActCustomFields([categories[0]]);
        q('#act-submit').onclick = async () => {
            const title = q('#act-title').value.trim();
            const desc = q('#act-desc').value.trim();
            if (!title) return UI.toast(Lang.t('enterATitle'));
            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#act-custom-fields'));
            if (missingFields.length) return UI.toast(Lang.format('requiredFieldsMissing', { fields: missingFields.join(', ') }));
            const onBehalfUser = users.find(u => u.username === selectedBehalfUsername);
            if (!onBehalfUser) return UI.toast(Lang.t('selectAPerson'));
            if (AdminBoard.createTicketFiles.some(file => file.size > 15 * 1024 * 1024)) {
                UI.toast(Lang.t('attachmentsTooLarge'));
                return;
            }
            const cat = AdminBoard.createTicketCategoryInstance.getValue();
            const category = cat.length ? cat : ['Allgemein'];
            const newTicket = await Store.createTicket({
                title, desc, prio: q('#act-prio').value, category,
                onBehalfOfUserId: onBehalfUser.id, customFieldValues
            });
            if (!newTicket) {
                UI.toast(Lang.t('ticketCreateFailed'));
                return;
            }
            if (AdminBoard.createTicketFiles.length) {
                try {
                    await Promise.all(AdminBoard.createTicketFiles.map(file => Store.saveAttachment(file, { ticketId: newTicket.id })));
                } catch (error) {
                    console.error(error);
                    UI.toast(Lang.t('ticketCreatedAttachmentsFailed'));
                }
            }
            Store._ticketsCache = null;
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
            const actor = await Store.currentUser();
            await Store.addNotifications([ticket.author], ticket, 'Titel oder Beschreibung wurde vom Support angepasst.', actor?.username, 'ticketEdited');
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
                `<li>${Icon('calendar-check', 13)}${Utils.esc(e.subject)} -- ${Utils.esc(Utils.fmtDate(e.startAt))}${e.webLink ? ` <a href="${Utils.esc(e.webLink)}" target="_blank" rel="noopener">${Icon('external-link', 11)}</a>` : ''}</li>`
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
            const attendeeEmails = attendeeUsers.filter(u => attendeeIds.includes(u.id)).map(u => u.email);
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
                    outlook_event_create_failed: Lang.t('outlookEventCreateFailedError')
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
            todos = list.map(d => `<li>${d.done ? '☑' : '☐'} ${Utils.esc(d.content)}${d.assignee_username ? ' – ' + Utils.esc(nameFor(d.assignee_username)) : ''}</li>`).join('');
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
                <div><strong>${Lang.t('status')}</strong>${Utils.esc(t.status)}</div>
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
            if (!t) return;

            const user = await Store.currentUser();
            const isSuper = user && user.role === 'superadmin';

            q('#m-title').textContent = `${t.ticketNumber || t.id} · ${t.title}${t.archived ? ' [ARCHIVIERT]' : ''}`;
            q('#m-desc').textContent = t.desc || 'Keine Beschreibung';
            {
                const fieldsSettings = await Store.getSettings();
                UI.renderCustomFieldsDisplay(q('#m-custom-fields-display'), Store.getCustomFieldsForCategories(t.category, fieldsSettings), t.customFieldValues || {});
            }
            await AdminBoard.renderTicketAttachments(t, '#m-ticket-attachments', { manage: true });
            AdminBoard.renderIncidentLinkedTickets(t, tickets);

            const pendingApproval = (t.approvals || []).find(a => a.status === 'pending');
            const approvalPendingBox = q('#m-approval-pending');
            if (approvalPendingBox) {
                approvalPendingBox.hidden = !pendingApproval;
                const approvalActions = q('#m-approval-actions');
                if (pendingApproval) {
                    const approverName = await Store.describeApprover(pendingApproval);
                    q('#m-approval-pending-text').textContent = `Wartet auf Genehmigung durch ${approverName} (seit ${Utils.fmtDate(pendingApproval.requestedAt)})`;
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
            const approvalRejectedBox = q('#m-approval-rejected');
            if (approvalRejectedBox) {
                approvalRejectedBox.hidden = !t.rejectedApproval;
                if (t.rejectedApproval) {
                    q('#m-approval-rejected-text').textContent = `${t.rejectedApproval.byName || t.rejectedApproval.by} hat diese Anfrage abgelehnt: ${t.rejectedApproval.reason || '-'}`;
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
                    <button class="btn-secondary" id="m-request-approval" type="button">${Icon('badge-check', 16)}Genehmigung anfordern</button>
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
            ['#m-note-type', '#m-note-bold', '#m-note-italic', '#m-note-list', '#m-note-numbered', '#m-note-table', '#m-note-file-input', '#m-note-pin', '#m-note-resolution', '#m-admin-note-type', '#m-admin-note-bold', '#m-admin-note-italic', '#m-admin-note-list', '#m-admin-note-file-input', '#m-admin-note-pin'].forEach(selector => {
                const el = q(selector);
                if (el) el.disabled = t.archived;
            });
            if (q('#m-admin-new-comment')) q('#m-admin-new-comment').disabled = t.archived;
            if (q('#btn-add-admin-comment')) q('#btn-add-admin-comment').disabled = t.archived;
            if (chatInput) chatInput.disabled = t.archived || !!t.authorArchived;
            if (chatSend) chatSend.disabled = t.archived || !!t.authorArchived;

            // Metadata
            if (q('#m-author')) q('#m-author').textContent = t.authorName || t.author;
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

                    // Email Notification
                    const s = await Store.getSettings();
                    if (s.emailConfig && s.emailConfig.host) {
                        const users = await Store.getUsers();
                        const author = users.find(u => u.username === t.author);
                        if (author && author.email) {
                            Store.sendEmail(author.email, Lang.format('ticketUpdateEmailSubject', { title: t.title }), Lang.format('priorityChangedTo', { prio: t.prio }));
                        }
                    }
                    await Store.addGlobalLog('Ticket Priorität geändert', `Ticket: ${t.title}, Priorität: ${t.prio}`);
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

            AdminBoard.noteFiles = {
                'admin-chat': [],
                solution: []
            };
            AdminBoard.renderNoteFilePreview('admin-chat');
            AdminBoard.renderNoteFilePreview('solution');
            AdminBoard.renderInternalComments(t, 'admin-chat');
            AdminBoard.renderInternalComments(t, 'solution');
            await AdminBoard.renderChat(t, '#m-chat-msgs');

            if (btnLogs) btnLogs.onclick = () => UI.showLogs(t.id);

            // History Toggle
            const authorEl = q('#m-author');
            if (authorEl) {
                authorEl.classList.add('link');
                authorEl.title = 'Historie anzeigen';
                authorEl.onclick = () => AdminBoard.renderHistory(t.author, t.id);
            }

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

    closeModal: () => {
        q('#ticket-modal').classList.remove('open');
        if (q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
        const sidebar = q('#m-history-sidebar');
        if (sidebar) sidebar.classList.remove('open');
        AdminBoard.currentTicketId = null;
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

    // Lädt über /api/v2/tickets/:id/notes -- t.comments existiert nicht mehr. Dateianhänge an
    // internen Notizen sind in dieser Umstellung noch nicht angebunden.
    renderInternalComments: async (t, channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const box = q(channel === 'admin-chat' ? '#m-admin-comments' : '#m-comments');
        if (!box) return;
        box.innerHTML = '';
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

        const countSelector = channel === 'admin-chat' ? '#m-admin-note-count' : '#m-solution-note-count';
        if (q(countSelector)) q(countSelector).textContent = String(commentsRaw.length);
        if (searchWrap) searchWrap.style.display = commentsRaw.length ? 'flex' : 'none';
        if (commentsRaw.length === 0 && searchInput) searchInput.value = '';
        if (commentsRaw.length === 0) {
            box.innerHTML = `<div class="empty-state compact">${channel === 'admin-chat' ? Lang.t('noAdminMessagesYet') : Lang.t('noSolutionAttemptsYet')}</div>`;
            return;
        }
        const renderText = (value = '') => highlightMentions(Utils.renderMarkdown(value));
        const query = (searchInput?.value || '').toLowerCase().trim();
        const comments = [...commentsRaw]
            .filter(c => !query || [c.content, c.author_name, c.note_type, Utils.fmtDate(c.created_at)].join(' ').toLowerCase().includes(query))
            .sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned) || Number(!!b.is_resolution) - Number(!!a.is_resolution) || new Date(b.created_at) - new Date(a.created_at));
        if (comments.length === 0) {
            box.innerHTML = `<div class="empty-state compact">${Lang.t('noMatchingInternalComments')}</div>`;
            return;
        }
        comments.forEach(c => {
            const div = document.createElement('div');
            div.className = `note-item ${c.is_pinned ? 'is-pinned' : ''} ${c.is_resolution ? 'is-resolution' : ''}`;
            div.dataset.id = c.id;
            div.innerHTML = `
                <div class="note-meta">
                    <div class="note-author">
                        ${c.is_pinned ? Icon('pin', 13) : ''}
                        <strong>${Utils.esc(c.author_name || c.author_username)}</strong>
                        <span class="note-type">${Utils.esc(c.note_type || Lang.t('noteFallback'))}</span>
                        ${c.is_resolution ? `<span class="note-type note-resolution">${Icon('check-circle', 12)}${Lang.t('finalSolution')}</span>` : ''}
                    </div>
                    <div class="note-actions">
                        <span>${Utils.fmtDate(c.created_at)}</span>
                        <button class="btn-ghost btn-icon btn-xs note-edit" title="${Lang.t('editComment')}" aria-label="${Lang.t('editComment')}">${Icon('pencil', 13)}</button>
                    </div>
                </div>
                <div class="note-body">${renderText(c.content)}</div>
            `;
            div.querySelector('.note-edit')?.addEventListener('click', () => AdminBoard.editInternalComment(c.id, channel));
            box.appendChild(div);
        });
        box.scrollTop = 0;
        if (window.lucide) lucide.createIcons();
    },

    renderNoteFilePreview: (channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const files = AdminBoard.noteFiles[channel];
        const pan = q(`#${prefix}-file-preview`);
        if (!pan) return;
        pan.innerHTML = '';
        pan.style.display = files.length ? 'flex' : 'none';
        files.forEach((f, idx) => {
            const tag = document.createElement('div');
            tag.className = 'file-chip';
            tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
            tag.querySelector('button').onclick = () => {
                files.splice(idx, 1);
                AdminBoard.renderNoteFilePreview(channel);
            };
            pan.appendChild(tag);
        });
        if (window.lucide) lucide.createIcons();
    },

    editInternalComment: async (noteId, channel = 'solution') => {
        const note = (AdminBoard._currentNotes || []).find(n => n.id === noteId);
        if (!note) return;
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const input = q(channel === 'admin-chat' ? '#m-admin-new-comment' : '#m-new-comment');
        input.value = note.content || '';
        if (q(`#${prefix}-type`)) q(`#${prefix}-type`).value = note.note_type || (channel === 'admin-chat' ? 'Abstimmung' : 'Analyse');
        if (q(`#${prefix}-pin`)) q(`#${prefix}-pin`).checked = !!note.is_pinned;
        if (q('#m-note-resolution')) q('#m-note-resolution').checked = !!note.is_resolution;
        const saveBtn = q(channel === 'admin-chat' ? '#btn-add-admin-comment' : '#btn-add-comment');
        if (saveBtn) {
            saveBtn.dataset.editId = noteId;
            saveBtn.innerHTML = `${Icon('save', 16)}Eintrag aktualisieren`;
        }
        input.focus();
        if (window.lucide) lucide.createIcons();
    },

    // Speichert über /api/v2/tickets/:id/notes (bzw. PATCH beim Bearbeiten). Datei-Anhänge und
    // automatische @Erwähnungs-Benachrichtigungen sind in dieser Umstellung noch nicht
    // angebunden (eigener, noch offener Schritt).
    postInternalComment: async (channel = 'solution') => {
        const prefix = channel === 'admin-chat' ? 'm-admin-note' : 'm-note';
        const input = q(channel === 'admin-chat' ? '#m-admin-new-comment' : '#m-new-comment');
        const txt = input.value.trim();
        const saveBtn = q(channel === 'admin-chat' ? '#btn-add-admin-comment' : '#btn-add-comment');
        const editId = saveBtn?.dataset.editId;
        const isEditing = !!editId;
        if (!txt) return;
        const id = AdminBoard.currentTicketId;

        const body = {
            content: txt,
            note_type: q(`#${prefix}-type`)?.value || 'Notiz',
            is_pinned: !!q(`#${prefix}-pin`)?.checked,
            is_resolution: channel === 'solution' && !!q('#m-note-resolution')?.checked
        };
        if (!isEditing) body.stream = channel;

        const res = await fetch(
            isEditing ? `/api/v2/tickets/${encodeURIComponent(id)}/notes/${encodeURIComponent(editId)}` : `/api/v2/tickets/${encodeURIComponent(id)}/notes`,
            {
                method: isEditing ? 'PATCH' : 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body)
            }
        ).catch(() => null);
        if (!res || !res.ok) {
            UI.toast('Speichern fehlgeschlagen.');
            return;
        }

        input.value = '';
        if (q('#m-admin-mention-picker')) q('#m-admin-mention-picker').hidden = true;
        if (saveBtn) {
            delete saveBtn.dataset.editId;
            saveBtn.innerHTML = `${Icon('plus', 16)}Eintrag speichern`;
        }
        if (q(`#${prefix}-pin`)) q(`#${prefix}-pin`).checked = false;
        if (channel === 'solution' && q('#m-note-resolution')) q('#m-note-resolution').checked = false;
        const t = (await Store.getTickets()).find(x => x.id === id);
        await AdminBoard.renderInternalComments(t, channel);
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
            box.innerHTML = '<div class="empty-state">Keine Nachrichten</div>';
            return;
        }

        const currentUser = await Store.currentUser();

        msgs.forEach(m => {
            const el = document.createElement('div');
            const isMe = m.sender_user_id === currentUser.id;
            const roleClass = ['admin', 'superadmin'].includes(m.sender_role) ? 'from-admin' : m.sender_role === 'user' ? 'from-user' : '';
            el.className = `chat-bubble ${isMe ? 'me' : 'other'} ${roleClass}`.trim();

            const htmlText = Utils.formatRichText(m.content || '');

            el.innerHTML = `
                <div class="msg-meta">
                    <span>${Utils.esc(m.sender_name || m.sender_username)}</span>
                    <span class="msg-meta-actions">${Utils.fmtDate(m.created_at)}${isMe && !ticket.archived ? `<button type="button" class="btn-ghost btn-icon btn-xs chat-message-edit" data-message-id="${m.id}" title="Nachricht bearbeiten" aria-label="Nachricht bearbeiten">${Icon('pencil', 12)}</button>` : ''}</span>
                </div>
                ${htmlText}
            `;
            box.appendChild(el);
            el.querySelector('.chat-message-edit')?.addEventListener('click', () => AdminBoard.editChatMessage(ticket.id, m.id, containerSelector));
        });
        box.scrollTop = box.scrollHeight;
        if (window.lucide) lucide.createIcons();
    },

    // Sendet direkt über /api/v2/tickets/:id/messages -- Benachrichtigung an die jeweils andere
    // Seite erzeugt der Server dabei automatisch (siehe tickets.ts). Dateianhänge im Chat sind
    // in dieser Umstellung noch nicht angebunden (siehe README "Daten Und Funktionen").
    postChat: async (role) => {
        const id = AdminBoard.currentTicketId || UserDash.currentTicketId;
        const prefix = (role === 'admin') ? '#m' : '#u';
        const txtInput = q(`${prefix}-chat-input`);
        const txt = txtInput.value.trim();
        if (!txt) return;

        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: txt })
        }).catch(() => null);
        if (!res || !res.ok) {
            UI.toast('Nachricht konnte nicht gesendet werden.');
            return;
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
        UI.toast('Nachricht gesendet');
    },

    openApproveModal: async (req) => {
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        AdminBoard.currentReq = req;
        q('#a-name-disp').textContent = req.name;
        q('#a-username').value = req.name.toLowerCase().replace(/\s+/g, '');
        q('#a-password').value = Utils.secureToken(18);
        UI.bindPasswordRequirements(q('#a-password'));
        q('#approve-modal').classList.add('open');

        // Permissions check: only superadmins can set role/dept
        const roleField = q('#a-role')?.parentElement;
        const deptField = q('#a-dept-field');

        q('#a-role').value = 'user';
        q('#approve-modal .modal').classList.remove('approval-admin-mode');
        let permissions = q('#a-permissions');
        if (!permissions) {
            permissions = document.createElement('div'); permissions.id = 'a-permissions';
            permissions.innerHTML = `<label>${Lang.t('adminRights')}</label><div class="perm-grid">${[
                ['canManageRequests', Lang.t('manageAccountRequests')], ['canManageUsers', Lang.t('userManagementUsersOnly')],
                ['canViewLogs', Lang.t('viewSystemLogs')], ['canManage2FA', Lang.t('reset2FA')],
                ['textBlocks', Lang.t('manageTextBlocks')], ['reports', Lang.t('viewReports')],
                ['approvals', Lang.t('decideApprovals')], ['recurring', Lang.t('manageRecurringTickets')]
            ].map(([key, label]) => `<label class="check-row"><input type="checkbox" data-permission="${key}"><span>${label}</span></label>`).join('')}</div>
            <label for="a-kb">${Lang.t('knowledgeBase')}</label><select id="a-kb"><option value="none">${Lang.t('noAccess')}</option><option value="read">${Lang.t('readOnly')}</option><option value="edit">${Lang.t('readAndEdit')}</option></select>`;
            q('#a-dept-field').after(permissions);
        }
        permissions.hidden = true;
        permissions.querySelectorAll('input').forEach(box => { box.checked = false; });
        q('#a-kb').value = 'none';
        q('#a-role').onchange = () => {
            const show = isSuper && q('#a-role').value === 'admin';
            permissions.hidden = !show;
            q('#approve-modal .modal').classList.toggle('approval-admin-mode', show);
            if (deptField) deptField.style.display = show ? '' : 'none';
        };
        if (deptField) deptField.style.display = 'none';

        if (roleField) roleField.style.display = isSuper ? 'block' : 'none';
        // deptField display is handled by onchange in ApproveModal listeners usually,
        // but here we just hide the whole capability for non-supers

        q('#a-confirm').onclick = AdminBoard.confirmApprove;
        q('#a-close').onclick = AdminBoard.closeApprove;

        // Listen for Enter key in inputs
        const inputs = [q('#a-username'), q('#a-password')];
        inputs.forEach(i => {
            i.onkeydown = (e) => {
                if (e.key === 'Enter') AdminBoard.confirmApprove();
            };
        });
    },
    closeApprove: () => {
        q('#approve-modal').classList.remove('open');
        AdminBoard.currentReq = null;
    },
    exportUsersCSV: async () => {
        const users = await Store.getUsers();
        if (users.length === 0) {
            UI.toast('Keine User zum Exportieren');
            return;
        }

        // Header
        let csv = 'id,username,name,email,role,dept\n';

        users.forEach(u => {
            const dept = Array.isArray(u.dept) ? u.dept.join(';') : (u.dept || '');
            const row = [
                u.id,
                u.username,
                u.name || '',
                u.email || '',
                u.role,
                dept
            ].map(f => `"${String(f).replace(/"/g, '""')}"`).join(',');
            csv += row + '\n';
        });

        const blob = new Blob([csv], {
            type: 'text/csv'
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `users_export_${Utils.nowISO().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await Store.addGlobalLog('Benutzer exportiert', `Anzahl: ${users.length}`);
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
                password: Utils.secureToken(18)
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
    },

    confirmApprove: async () => {
        if (!AdminBoard.currentReq) return;
        const currentUser = await Store.currentUser();
        const isSuper = currentUser && currentUser.role === 'superadmin';

        const username = q('#a-username').value.trim();
        const password = q('#a-password').value.trim();
        const role = isSuper ? q('#a-role').value : 'user'; // Enforce 'user' if not super
        const dept = q('#a-dept').value;

        if (!username || !password) {
            UI.toast(Lang.t('fillFields'));
            return;
        }
        if (password.length < 14) {
            UI.toast(Lang.t('passwordMinLength'));
            return;
        }

        const users = await Store.getUsers();
        if (users.find(u => u.username === username)) {
            UI.toast('Benutzername existiert bereits');
            return;
        }

        const newUser = {
            id: Utils.uid(),
            username,
            password,
            name: AdminBoard.currentReq.name,
            email: AdminBoard.currentReq.email,
            role: role
        };

        if (isSuper && role === 'admin') {
            newUser.department = dept;
            newUser.permissions = { ...Object.fromEntries([...q('#a-permissions').querySelectorAll('[data-permission]')].map(b => [b.dataset.permission, b.checked])), kb: q('#a-kb').value };
        }

        users.push(newUser);
        if (!await Store.saveUsers(users)) return UI.toast(Store.lastError || 'Benutzer konnte nicht erstellt werden.');
        if (!await Store.decideAccountRequest(AdminBoard.currentReq.id, 'approved')) return UI.toast('Benutzer erstellt; Kontoanfrage konnte nicht aktualisiert werden.');

        AdminBoard.closeApprove();
        await AdminBoard.renderRequests();
        UI.toast('Benutzer erfolgreich erstellt!');
    }
};
