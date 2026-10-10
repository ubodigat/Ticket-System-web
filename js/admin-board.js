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
import { UserDash } from './user-dash.js';
import { getStatusColor, getPrioValue, isPendingApprover, insertMarkdownLink, insertMarkdownTable } from './ticket-helpers.js';

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
        ['btn-to-dash', 'btn-archive', 'btn-global-logs', 'btn-manage-users', 'btn-sys-settings', 'btn-notifications', 'theme-toggle', 'btn-settings', 'logout'].forEach(id => {
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
                        <button class="btn-ghost btn-icon" data-close-sla title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
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
                        <span>${Lang.prio(ticket.prio)} · Frist ${Utils.fmtDate(new Date(deadline).toISOString())}</span>
                        <span>Hauptverantwortlicher: ${Utils.esc(ownerLabel)}</span>
                        <time>${overdueText}</time>
                    </span>
                </button>`;
        }).join('') : `<div class="empty-state">${Lang.current === 'en' ? 'No overdue tickets' : 'Keine überfälligen Tickets'}</div>`;
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
            empty.textContent = 'Keine Admins mit Ticketzugriff gefunden';
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
    renderTicketAttachments: async (ticket, selector) => {
        const container = typeof selector === 'string' ? q(selector) : selector;
        if (!container) return;
        const attachments = await Store.getTicketAttachments(ticket.id);
        container.innerHTML = '';
        container.hidden = attachments.length === 0;
        if (!attachments.length) return;
        const heading = document.createElement('h4');
        heading.className = 'section-title';
        heading.textContent = 'Anhänge';
        const list = document.createElement('div');
        list.className = 'ticket-attachment-list';
        attachments.forEach((file, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-chip';
            button.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name || 'Anhang')}</span>`;
            button.onclick = () => AdminBoard.openAttachmentPreview(attachments[index]);
            list.appendChild(button);
        });
        container.append(heading, list);
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
                btnLogs.style.display = 'inline-flex';
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
                q('#list-view').style.display = 'none';
                q('.board-banners').hidden = true;
                setListViewButtonState(false);
                AdminBoard.renderArchive();
            };
            btnBack.onclick = () => {
                viewArchive.style.display = 'none';
                viewKanban.style.display = 'block';
                q('#list-view').style.display = 'none';
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
                const isListActive = q('#list-view').style.display === 'block';
                viewArchive.style.display = 'none';
                q('.board-banners').hidden = false;
                if (isListActive) {
                    q('#list-view').style.display = 'none';
                    viewKanban.style.display = 'block';
                    setListViewButtonState(false);
                    await AdminBoard.render();
                } else {
                    viewKanban.style.display = 'none';
                    q('#list-view').style.display = 'block';
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
                if (dept) dept.style.display = roleSel.value === 'admin' ? '' : 'none';
            };
        }

        if (q('#um-close')) q('#um-close').onclick = () => q('#user-man-modal').classList.remove('open');
    },

    // ... render methods ...
    render: async () => {
        const user = await Store.currentUser();
        const rawTickets = await Store.getTickets();
        let tickets = rawTickets.filter(t => !t.archived);

        // Filter by Department (if not Superadmin)
        if (user.role === 'admin') tickets = tickets.filter(ticket => AdminBoard.canAccessTicket(user, ticket));
        const slaSettings = await Store.getSettings();
        await AdminBoard.refreshOverdueIndicator(tickets, user, slaSettings);
        const query = q('#admin-ticket-search')?.value || '';
        if (query.trim()) tickets = tickets.filter(ticket => Utils.matchesSearch(query, ticket));
        // Superadmin sees all (no filter)

        // Sort by Priority then Date
        tickets.sort((a, b) => {
            const pA = getPrioValue(a.prio);
            const pB = getPrioValue(b.prio);
            if (pA !== pB) return pB - pA;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

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
                    <span title="Anhänge">${Icon('paperclip', 12)}${attachmentCount}</span>
                    <span title="${todoDone} von ${todoTotal} Teilaufgaben erledigt">${Icon('list-checks', 12)}${todoDone}/${todoTotal}</span>
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
                    if (linked) UI.toast('Ticket mit Großstörung verknüpft.');
                });
            }
            card.addEventListener('click', () => AdminBoard.openModal(t.id));
            return card;
        }
    },

    // START OF MISSING FUNCTIONS
    archiveCurrent: () => {
        UI.confirm('Ticket ins Archiv verschieben? Es wird aus dem Board entfernt.', async () => {
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
                UI.toast('Ticket archiviert');
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
                        <h3>${Icon('bell', 18)} System-Protokoll</h3>
                        <div class="modal-actions">
                            <input type="text" id="gl-search" placeholder="Benutzer, Aktion, Details, Datum oder Uhrzeit suchen...">
                            <button class="btn-ghost btn-icon" id="btn-gl-print" title="Protokoll drucken" aria-label="Protokoll drucken">${Icon('printer', 16)}</button>
                            <button class="btn-ghost btn-icon" id="global-logs-modal-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="log-datetime-filters">
                        <label>Von ${UI.dateTimePickerMarkup('gl-from')}</label>
                        <label>Bis ${UI.dateTimePickerMarkup('gl-to')}</label>
                    </div>
                    <div class="log-term-filters">
                        <label><span>Enthält</span><input type="text" id="gl-include" placeholder="Begriffe, mit Komma trennen"></label>
                        <label><span>Enthält nicht</span><input type="text" id="gl-exclude" placeholder="Begriffe, mit Komma trennen"></label>
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
        const actor = await Store.currentUser();
        const rows = visibleLogs.map(l => `
            <tr>
                <td>${Utils.esc(Utils.fmtDate(l.date))}</td>
                <td>${Utils.esc(l.user || '-')}</td>
                <td>${Utils.esc(l.action || '-')}</td>
                <td>${Utils.esc(l.details || '')}</td>
            </tr>`).join('');
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>System-Protokoll</title>
            <style>
                body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain;}
                h1{font-size:18px;margin:0 0 4px;}
                .meta{color:#555;font-size:12px;margin-bottom:16px;}
                table{width:100%;border-collapse:collapse;font-size:12px;}
                th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;white-space:pre-line;}
                th{background:#f0f0f0;}
                tr:nth-child(even){background:#fafafa;}
            </style></head><body>
            <div class="print-head">
                <div>
                    <h1>System-Protokoll</h1>
                    <div class="meta">Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))} &middot; ${visibleLogs.length} Einträge</div>
                </div>
                ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}
            </div>
            <table><thead><tr><th>Datum/Uhrzeit</th><th>Benutzer</th><th>Aktion</th><th>Details</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">Keine Einträge gefunden.</td></tr>'}</tbody></table>
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
            '<div class="empty-state">Keine Einträge gefunden.</div>';
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
                        <span class="badge">${(g.members || []).length} ${(g.members || []).length === 1 ? 'Mitglied' : 'Mitglieder'}</span>
                    </div>
                    <div class="user-manager-actions">
                        <button class="btn-ghost btn-icon members-g" title="Mitglieder anzeigen" aria-label="Mitglieder anzeigen">${Icon('list', 16)}</button>
                        <button class="btn-ghost btn-icon edit-g" title="${Lang.t('edit')}" aria-label="${Lang.t('edit')}">${Icon('pencil', 16)}</button>
                        <button class="btn-ghost btn-icon btn-danger del-g" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('trash-2', 16)}</button>
                    </div>
                `;
                el.querySelector('.members-g').onclick = () => AdminBoard.openGroupMembers(g);
                el.querySelector('.edit-g').onclick = () => AdminBoard.openEditGroupModal(g);
                el.querySelector('.del-g').onclick = () => {
                    UI.confirm(`Gruppe "${g.name}" löschen?`, async () => {
                        if (!(await Store.deleteGroup(g.id))) return UI.toast('Gruppe löschen fehlgeschlagen.');
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
                    UI.confirm(`Kategorie "${c.name}" löschen?`, async () => {
                        if (!(await Store.updateCategory(c.id, { archived: true }))) return UI.toast('Kategorie löschen fehlgeschlagen.');
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
        archivedToggle.innerHTML = `<input type="checkbox" ${AdminBoard.showArchivedUsers ? 'checked' : ''}><span>Archivierte anzeigen</span>`;
        archivedToggle.querySelector('input').onchange = e => {
            AdminBoard.showArchivedUsers = e.target.checked;
            AdminBoard.renderUserManager(view);
        };
        list.appendChild(archivedToggle);

        filtered.forEach(u => {
            const el = document.createElement('div');
            el.className = 'table-row user-manager-row';

            const roleInfo = u.role.toUpperCase();
            const userGroups = groups
                .filter(g => (g.members || []).includes(u.username) || (u.groups || []).includes(g.id))
                .map(g => g.name);

            el.innerHTML = `
                <div class="user-manager-text">
                    <span class="user-manager-name">${Utils.esc(u.username)}${u.twoFactorEnabled ? `<span class="badge badge-accent" title="2FA aktiv">${Icon('shield-check', 12)}2FA</span>` : ''}${u.accountLocked ? `<span class="badge badge-danger" title="Nach Fehlversuchen oder manuell gesperrt">${Icon('lock', 12)}Gesperrt</span>` : ''}${u.lockedUntil && u.lockedUntil > Date.now() ? `<span class="badge badge-danger" title="Vorübergehend nach Fehlversuchen gesperrt">${Icon('lock', 12)}Gesperrt bis ${new Date(u.lockedUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}${u.accountArchived ? `<span class="badge" title="Archiviert">${Icon('archive', 12)}Archiviert</span>` : ''}</span>
                    <span class="row-sub">${Utils.esc(u.name || '-')} · ${Utils.esc(u.email || 'Keine E-Mail')}</span>
                    <div class="group-chip-row">
                        <span class="badge">${Utils.esc(roleInfo)}</span>
                        ${userGroups.map(name => `<span class="group-chip">${Icon('users-round', 12)}${Utils.esc(name)}</span>`).join('')}
                        ${u.absence?.active ? `<span class="badge badge-accent" title="${Utils.esc(AdminBoard.absenceInfoText(u.absence))}">${Icon('plane', 12)}Abwesend${u.absence.substitute ? ' → ' + Utils.esc((users.find(x => x.username === u.absence.substitute)?.name) || u.absence.substitute) : ' → zurück ins Team'} · ${Utils.esc(AdminBoard.absenceInfoText(u.absence).split(' · ')[0])}</span>` : ''}
                        ${u.absence?.pending ? `<span class="badge" title="${Utils.esc(AdminBoard.absenceInfoText(u.absence))}">${Icon('plane', 12)}Geplant · ${Utils.esc(AdminBoard.absenceInfoText(u.absence))}</span>` : ''}
                    </div>
                </div>
                <div class="user-manager-actions">
                    ${(isSuper || canManage2FA) && u.twoFactorEnabled ? `<button class="btn-ghost btn-sm reset-2fa" title="2FA zurücksetzen">${Icon('unlock-keyhole', 15)}2FA</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' && !u.accountArchived ? `<button class="btn-ghost btn-icon lock-u" title="${u.accountLocked ? 'Entsperren' : 'Sperren'}" aria-label="${u.accountLocked ? 'Entsperren' : 'Sperren'}">${Icon(u.accountLocked ? 'lock-open' : 'lock', 16)}</button>` : ''}
                    ${canManageUsers && u.username !== 'admin' ? `<button class="btn-ghost btn-icon archive-u" title="${u.accountArchived ? 'Reaktivieren' : 'Archivieren'}" aria-label="${u.accountArchived ? 'Reaktivieren' : 'Archivieren'}">${Icon(u.accountArchived ? 'archive-restore' : 'archive', 16)}</button>` : ''}
                    ${view === 'admins' && canManageUsers ? `<button class="btn-ghost btn-icon absence-btn" title="Abwesenheit &amp; Vertretung" aria-label="Abwesenheit und Vertretung">${Icon('plane', 16)}</button>` : ''}
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
                UI.toast(target.accountLocked ? 'Konto gesperrt.' : 'Konto entsperrt.');
                AdminBoard.renderUserManager(view);
            };

            const archiveBtn = el.querySelector('.archive-u');
            if (archiveBtn) archiveBtn.onclick = () => {
                const restoring = !!u.accountArchived;
                UI.confirm(restoring ? `${u.username} reaktivieren?` : `${u.username} archivieren? Das Konto kann sich dann nicht mehr anmelden.`, async () => {
                    const users = await Store.getUsers();
                    const target = users.find(x => x.id === u.id);
                    if (!target) return;
                    target.accountArchived = !restoring;
                    if (restoring) target.accountLocked = false;
                    target.failedLogins = 0;
                    await Store.saveUsers(users);
                    await AdminBoard.applyArchiveConsequences(target, restoring);
                    await Store.addGlobalLog(restoring ? 'Konto reaktiviert' : 'Konto archiviert', `Benutzer: ${u.username}`);
                    UI.toast(restoring ? 'Konto reaktiviert.' : 'Konto archiviert.');
                    AdminBoard.renderUserManager(view);
                });
            };

            if (el.querySelector('.reset-2fa')) {
                el.querySelector('.reset-2fa').onclick = () => {
                    UI.confirm(`2FA für ${u.username} zurücksetzen?`, async () => {
                        const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}/mfa-reset`, {
                            method: 'POST',
                            credentials: 'same-origin'
                        }).catch(() => null);
                        if (res && res.ok) {
                            UI.toast('2FA zurückgesetzt');
                            AdminBoard.renderUserManager(view);
                        } else {
                            UI.toast('2FA-Zurücksetzen fehlgeschlagen.');
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

                title.textContent = 'Benutzer löschen';
                content.innerHTML = `
                    <p>Möchtest du <strong>${Utils.esc(u.username)}</strong> wirklich löschen? Was soll mit den Tickets dieses Benutzers geschehen?</p>
                    <div class="checkbox-list">
                        <label class="check-row"><input type="radio" name="del-opt" value="archive" checked><span>Tickets archivieren (empfohlen)</span></label>
                        <label class="check-row"><input type="radio" name="del-opt" value="delete"><span>Tickets unwiderruflich löschen</span></label>
                    </div>
                `;

                footer.innerHTML = `
                    <button class="btn-secondary close-m">Abbrechen</button>
                    <button class="btn-danger" id="btn-perform-del">${Icon('trash-2', 16)}Löschen</button>
                `;

                confirmModal.querySelectorAll('.close-m').forEach(b => b.onclick = () => confirmModal.classList.remove('open'));
                if (window.lucide) lucide.createIcons();

                confirmModal.querySelector('#btn-perform-del').onclick = async () => {
                    const opt = confirmModal.querySelector('input[name="del-opt"]:checked').value;
                    const res = await fetch(`/api/v2/users/${encodeURIComponent(u.id)}?tickets=${opt}`, {
                        method: 'DELETE', credentials: 'same-origin'
                    }).catch(() => null);
                    if (!res || !res.ok) return UI.toast('Benutzer löschen fehlgeschlagen.');
                    Store._usersCache = null;
                    Store._ticketsCache = null;
                    UI.toast(`Benutzer ${u.username} gelöscht.`);
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
                <label>Name</label>
                <input type="text" id="g-input" value="${Utils.esc(category?.name || '')}" placeholder="z. B. Technik">
            </div>
            <div class="field">
                <label>Automatische Zuweisung an Gruppe</label>
                <div id="cat-auto-group"></div>
            </div>
            <div class="field field-wide">
                <label>Eigene Felder für diese Kategorie</label>
                <p class="hint">Zusätzliche Angaben, die beim Erstellen eines Tickets in dieser Kategorie abgefragt werden, z. B. Standort, Raum, Gerätenummer oder Kostenstelle.</p>
                <div id="cat-custom-fields" class="custom-fields-editor"></div>
                <button type="button" class="btn-secondary btn-sm" id="cat-add-field">${Icon('plus', 15)}Feld hinzufügen</button>
            </div>
        `;
        const autoGroupPicker = UI.createMultiSelect(q('#cat-auto-group'), groups.map(g => ({ value: g.id, label: g.name })), category?.autoAssignGroupId || '', null, { single: true, emptyLabel: 'Keine' });

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
                    <input type="text" class="cf-option-input" placeholder="Option" value="${Utils.esc(opt)}">
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger cf-option-remove" title="Option entfernen" aria-label="Option entfernen">${Icon('x', 13)}</button>
                </div>`).join('') || '<div class="hint">Noch keine Optionen.</div>';
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
                        <input type="text" class="cf-label" placeholder="Feldname (z. B. Standort)" value="${Utils.esc(f.label || '')}">
                        <select class="cf-type">
                            <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
                            <option value="number" ${f.type === 'number' ? 'selected' : ''}>Zahl</option>
                            <option value="select" ${f.type === 'select' ? 'selected' : ''}>Auswahl</option>
                        </select>
                        <label class="check-row compact"><input type="checkbox" class="cf-required" ${f.required ? 'checked' : ''}>Pflicht</label>
                        <button type="button" class="btn-ghost btn-icon btn-xs btn-danger cf-remove" title="Feld entfernen" aria-label="Feld entfernen">${Icon('x', 14)}</button>
                    </div>
                    <div class="cf-options-editor" style="${f.type === 'select' ? '' : 'display:none;'}">
                        <div class="cf-options-list"></div>
                        <button type="button" class="btn-ghost btn-sm cf-add-option">${Icon('plus', 13)}Option hinzufügen</button>
                    </div>
                </div>`).join('') : '<div class="empty-state compact">Keine eigenen Felder definiert.</div>';
            fieldsContainer.querySelectorAll('.custom-field-row').forEach(row => {
                const i = Number(row.dataset.index);
                const f = existingFields[i];
                renderOptionsList(row, f, i);
                row.querySelector('.cf-type').onchange = (e) => {
                    row.querySelector('.cf-options-editor').style.display = e.target.value === 'select' ? '' : 'none';
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
            if (!ok) return UI.toast('Kategorie speichern fehlgeschlagen.');

            modal.classList.remove('open');
            AdminBoard.renderUserManager('cats');
            UI.toast(category ? 'Kategorie bearbeitet' : 'Kategorie erstellt');
        };
    },

    openGroupMembers: async (group) => {
        const modal = AdminBoard.openDialog({
            id: 'group-members-modal',
            title: `Mitglieder · ${group.name}`,
            icon: 'users-round',
            size: 'sm',
            headerButtons: [
                { id: 'gm-add', icon: 'user-plus', title: 'Mitglied hinzufügen' },
                { id: 'gm-print', icon: 'printer', title: 'Drucken' }
            ],
            body: `<input type="search" id="gm-search" class="section-search" placeholder="Mitglied suchen...">
                   <div id="gm-list" style="margin-top:var(--space-3)"></div>`
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
                    <button type="button" class="btn-ghost btn-icon btn-xs btn-danger gm-remove" title="Aus Gruppe entfernen" aria-label="Aus Gruppe entfernen">${Icon('x', 14)}</button>
                </div>`).join('') : '<div class="empty-state compact">Keine Mitglieder.</div>';
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
            if (!candidates.length) return UI.toast('Alle Benutzer sind bereits Mitglied.');
            const addModal = AdminBoard.openDialog({
                id: 'group-members-add-modal',
                title: 'Mitglieder hinzufügen',
                icon: 'user-plus',
                size: 'sm',
                body: `<div class="field"><label>Personen auswählen</label><div id="gma-picker"></div></div>`,
                onSave: async (m) => {
                    const chosen = picker.getValue();
                    if (!chosen.length) return UI.toast('Bitte mindestens eine Person wählen.');
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
            const actor = await Store.currentUser();
            const users = await Store.getUsers();
            const members = users.filter(u => (group.members || []).includes(u.username));
            UI.printHTML(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Mitglieder · ${Utils.esc(group.name)}</title>
                <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;border-bottom:1px solid #ccc;padding-bottom:12px}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain}.print-head h1{font-size:20px;margin:0 0 4px}.print-head .meta{color:#555;font-size:12px}
                table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}</style></head>
                <body><div class="print-head"><div><h1>${Utils.esc(company.name || 'Support Portal')} · Gruppe ${Utils.esc(group.name)}</h1>
                <div class="meta">${members.length} Mitglieder &middot; Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))}</div></div>
                ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}</div>
                <table><thead><tr><th>Name</th><th>Benutzername</th><th>E-Mail</th><th>Rolle</th></tr></thead><tbody>
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

        title.textContent = group ? `Gruppe ${group.name} bearbeiten` : 'Neue Gruppe';
        content.innerHTML = `
            <div class="field"><label>Name</label><input id="ge-name" type="text" value="${group?.name || ''}" placeholder="z.B. Verwaltung"></div>
            <div class="field">
                <label>Mitglieder</label>
                <p class="hint">Eine Person gehört höchstens einer Gruppe an.</p>
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
                UI.toast('Bitte Gruppennamen angeben');
                return;
            }
            const selectedMembers = qa('#generic-modal .checkbox-list input:checked').map(x => x.value);

            let groupId = group?.id;
            if (group) {
                if (name !== group.name && !(await Store.renameGroup(group.id, name))) {
                    return UI.toast('Gruppe umbenennen fehlgeschlagen.');
                }
            } else {
                const createRes = await fetch('/api/v2/groups', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name })
                }).catch(() => null);
                if (!createRes || !createRes.ok) return UI.toast('Gruppe erstellen fehlgeschlagen.');
                groupId = (await createRes.json()).id;
            }

            const removedMembers = members.filter(m => !selectedMembers.includes(m));
            if (removedMembers.length) await Store.setGroupMembers(removedMembers, null);
            if (selectedMembers.length) await Store.setGroupMembers(selectedMembers, groupId);

            modal.classList.remove('open');
            AdminBoard.renderUserManager('groups');
            UI.toast(group ? 'Gruppe gespeichert' : 'Gruppe erstellt');
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
                        <h3>Benutzer bearbeiten</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="ue-save-head" title="Speichern" aria-label="Speichern">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field"><label>Benutzername</label><input id="ue-user" type="text"></div>
                        <div class="field"><label>Name</label><input id="ue-name" type="text"></div>
                        <div class="field"><label>E-Mail</label><input id="ue-email" type="email"></div>
                        <div class="field"><label>Passwort (leer = unverändert)</label><input id="ue-pass" type="password"></div>
                        <div class="field field-wide" id="ue-role-box"><label>Rolle</label><select id="ue-role"><option value="user">User</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></div>
                        <div class="field field-wide" id="ue-groups-box">
                            <label>Gruppe</label>
                            <div id="ue-groups-list"></div>
                        </div>
                        <div class="field field-wide">
                            <label>Vorgesetzte Person</label>
                            <div id="ue-supervisor"></div>
                        </div>
                    </div>
                    <div class="modal-footer action-footer">
                        <button class="btn-secondary close-m footer-cancel">Abbrechen</button>
                        <button class="btn-primary" id="ue-save">Speichern</button>
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

        q('#ue-user').value = isNew ? '' : user.username;
        q('#ue-user').disabled = !isNew;
        q('#ue-name').value = isNew ? '' : (user.name || '');
        q('#ue-email').value = isNew ? '' : (user.email || '');
        q('#ue-pass').value = '';

        const roleSel = q('#ue-role');
        roleSel.value = isNew ? (viewContext === 'admins' ? 'admin' : 'user') : user.role;

        // Permissions check for roles
        if (!isSuper) {
            q('#ue-role-box').style.display = 'none'; // Admins cannot change roles
        }

        // Gruppe: höchstens eine pro Person (department_group_id im Backend)
        const groupList = q('#ue-groups-list');
        let groupPicker = null;
        if (groupList) {
            const groups = await Store.getGroups();
            groupPicker = UI.createMultiSelect(groupList, groups.map(g => ({ value: g.id, label: g.name })), user?.department_group_id || '', null, { single: true, emptyLabel: 'Keine' });
        }
        // Vorgesetzte Person -- genutzt vom automatischen Genehmigungsworkflow (Systemeinstellungen).
        const supervisorBox = q('#ue-supervisor');
        let supervisorPicker = null;
        if (supervisorBox) {
            const allUsers = await Store.getUsers();
            const choices = allUsers.filter(u => u.id !== user?.id && !u.accountArchived).map(u => ({ value: u.id, label: u.name || u.username }));
            supervisorPicker = UI.createMultiSelect(supervisorBox, choices, user?.supervisorUserId || '', null, { single: true, emptyLabel: 'Keine' });
        }

        editModal.querySelector('h3').textContent = isNew ? 'Neuen Benutzer anlegen' : `Benutzer ${user.username} bearbeiten`;
        editModal.classList.add('open');

        q('#ue-save').onclick = async () => {
            const uVal = q('#ue-user').value.trim();
            const nVal = q('#ue-name').value.trim();
            const eVal = q('#ue-email').value.trim();
            const pVal = q('#ue-pass').value.trim();
            const rVal = q('#ue-role').value;
            const groupVal = groupPicker?.getValue() || null;
            const supervisorVal = supervisorPicker?.getValue() || null;

            if (!uVal) {
                UI.toast('Benutzername fehlt');
                return;
            }

            const users = await Store.getUsers();

            if (isNew) {
                if (users.find(x => x.username === uVal)) {
                    UI.toast('Benutzer existiert schon');
                    return;
                }
                if (!pVal) {
                    UI.toast('Passwort fehlt');
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
                    supervisorUserId: supervisorVal
                });
            } else {
                const target = users.find(x => x.id === user.id);
                if (target) {
                    target.name = nVal;
                    target.email = eVal;
                    if (pVal) target.password = pVal;
                    if (isSuper) target.role = rVal;
                    target.department_group_id = groupVal;
                    target.supervisorUserId = supervisorVal;
                }
            }
            await Store.saveUsers(users);
            editModal.classList.remove('open');
            AdminBoard.renderUserManager(viewContext);
            UI.toast('Gespeichert');
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
                    <button class="btn-secondary close-m footer-cancel">Abbrechen</button>
                    <button class="btn-primary">Speichern</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => modal.classList.remove('open'));
        modal.querySelector('#generic-save-head').onclick = () => modal.querySelector('.modal-footer .btn-primary')?.click();
        if (window.lucide) lucide.createIcons();
        return modal;
    },

    // Das generische Modal versteckt seine Fußzeile standardmäßig (Speichern läuft über das
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

    // pollTimer: läuft ein Update, fragt diese Funktion den Status alle 4s erneut ab, damit der
    // Fortschritt live sichtbar ist (ein docker build --no-cache kann mehrere Minuten dauern) --
    // ohne dass die Person manuell auf "Prüfen" klicken muss.
    updatePollTimer: null,
    renderUpdateStatus: async () => {
        const area = q('#sys-update-status');
        if (!area) return;
        clearTimeout(AdminBoard.updatePollTimer);
        area.innerHTML = `<div class="empty-state compact">${Icon('loader-circle', 16)} Update-Status wird geprüft...</div>`;
        const status = await Store.getUpdateStatus();
        if (!q('#sys-update-status')) return; // Modal inzwischen geschlossen
        if (!status) {
            area.innerHTML = `<div class="callout callout-danger">Updater ist nicht erreichbar oder nicht konfiguriert. Bitte Docker-Stack mit dem aktuellen Compose neu starten.</div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }
        if (status.error === 'github_unreachable') {
            area.innerHTML = `<div class="callout callout-danger">GitHub ist vom Server aus nicht erreichbar -- Internetverbindung des Updater-Dienstes prüfen.</div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }
        const job = status.job;
        const updateAvailable = !!status.updateAvailable;
        area.innerHTML = `
            <div class="settings-summary-grid">
                <div class="summary-card"><span>Lokale Version</span><strong>${Utils.esc((status.localCommit || '').slice(0, 12) || '-')}</strong><small>${Utils.esc(status.localSubject || '')}</small></div>
                <div class="summary-card"><span>GitHub Version</span><strong>${Utils.esc((status.remoteCommit || '').slice(0, 12) || '-')}</strong><small>${Utils.esc(status.remoteSubject || '')}</small></div>
                <div class="summary-card"><span>Status</span><strong>${updateAvailable ? `${status.commitsBehind || 1} Update(s) verfügbar` : 'Aktuell'}</strong><small>${Utils.esc(status.branch || 'main')}</small></div>
            </div>
            ${job ? `<div class="update-log ${job.ok ? 'ok' : job.running ? 'running' : 'failed'}">
                <strong>${job.running ? 'Update läuft...' : job.ok ? 'Letztes Update erfolgreich' : 'Letztes Update fehlgeschlagen'}</strong>
                <span>Schritt: ${Utils.esc(job.step || '-')}</span>
                <pre>${Utils.esc((job.log || []).slice(-18).join('\n'))}</pre>
            </div>` : ''}
        `;
        const runBtn = q('#sys-update-run');
        if (runBtn) runBtn.disabled = !updateAvailable || !!job?.running;
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
                            <i data-lucide="mail-check"></i><span>Outlook Einrichtung</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-company">
                            <i data-lucide="building-2"></i><span>Unternehmenseinstellungen</span>
                        </button>
                        <button class="tab-btn" data-tab="sys-update">
                            <i data-lucide="download-cloud"></i><span>Update</span>
                        </button>
                    </nav>
                    <div class="modal-body sys-settings-content">
                        <div class="callout" hidden>Microsoft-Graph/Outlook-Integration gibt es im aktuellen Backend nicht -- dieses Feld
                            wurde entfernt statt ungespeichert vorzutäuschen. Automatische Zuweisung läuft über die Kategorie
                            (Benutzerverwaltung → Kategorien → „Automatische Zuweisung an Gruppe").</div>
                        <!-- Sicherheit -->
                        <div id="sys-security" class="tab-content">
                            <div class="settings-section-title">Anmeldung &amp; Sitzungen</div>
                            <div class="form-grid">
                                <div class="field"><label>Mindestlänge Passwort</label><input id="sys-sec-pass-min" type="number" min="8" max="128" placeholder="14"></div>
                                <div class="field"><label>Sitzungslaufzeit (Minuten)</label><input id="sys-sec-session" type="number" min="5" max="10080" placeholder="480"></div>
                                <div class="field"><label>Max. Fehlversuche</label><input id="sys-sec-attempts" type="number" min="1" max="50" placeholder="5"></div>
                            </div>
                            <label class="check-row"><input type="checkbox" id="sys-sec-2fa-admins"><span><strong>2FA für Administratoren erzwingen</strong></span></label>
                            <label class="check-row"><input type="checkbox" id="sys-sec-permanent"><span>Dauerhafte Sitzungen erlauben</span></label>
                        </div>

                        <!-- Benachrichtigungen -->
                        <div id="sys-notifications" class="tab-content">
                            <div class="settings-section-title">${Icon('sliders-horizontal', 15)}Richtlinie je Ereignis (Benutzer &amp; Admins getrennt)</div>
                            <p class="hint">Standardwerte gelten, solange eine Person nichts Eigenes einstellt (unter Portaleinstellungen &gt; Benachrichtigungen). Wird ein Kästchen unter „anpassbar" deaktiviert, ist der Standardwert für alle verbindlich.</p>
                            <div id="sys-notif-matrix" class="notif-matrix"></div>
                        </div>

                        <!-- Outlook -->
                        <div id="sys-outlook" class="tab-content">
                            <div class="callout">Outlook/Microsoft Graph kann hier vorbereitet werden. Für den produktiven Mailimport muss im Backend ein Graph-Connector mit den hinterlegten Daten betrieben werden.</div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-enabled"><span><strong>Outlook/Graph Integration aktivieren</strong></span></label>
                            <div class="form-grid">
                                <div class="field"><label>Tenant-ID</label><input id="sys-outlook-tenant" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
                                <div class="field"><label>Client-ID</label><input id="sys-outlook-client" type="text" placeholder="App Registration Client-ID"></div>
                            </div>
                            <div class="field"><label>Support-Postfach</label><input id="sys-outlook-mailbox" type="email" placeholder="support@example.com"></div>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-sync"><span>Eingehende E-Mails synchronisieren</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-outlook-create"><span>Aus E-Mails automatisch Tickets erstellen</span></label>
                        </div>

                        <!-- Update -->
                        <div id="sys-update" class="tab-content">
                            <div class="callout">Prüft den aktuellen Stand gegen GitHub und aktualisiert die Serverinstallation per internem Updater. Während des Updates wird der App-Container neu gebaut und kurz neu gestartet.</div>
                            <div class="update-status" id="sys-update-status">
                                <div class="empty-state compact">Noch nicht geprüft.</div>
                            </div>
                            <div class="setting-row">
                                <span class="hint">Nur Superadmins können Updates starten.</span>
                                <div class="button-row">
                                    <button class="btn-secondary btn-sm" id="sys-update-check" type="button">${Icon('refresh-cw', 15)}Prüfen</button>
                                    <button class="btn-primary btn-sm" id="sys-update-run" type="button">${Icon('download-cloud', 15)}Update installieren</button>
                                </div>
                            </div>
                        </div>

                        <!-- LDAP -->
                        <div id="sys-ldap" class="tab-content">
                            <div class="callout">LDAP-Login ist eine ERGÄNZUNG zum lokalen Passwort, kein Ersatz: Die Person
                                braucht weiterhin ein lokales Konto mit demselben Benutzernamen (Benutzerverwaltung) -- Rolle und
                                Rechte kommen immer aus dieser Datenbank, nie aus LDAP-Gruppen. Passt das lokale Passwort nicht,
                                wird zusätzlich ein LDAP-Bind versucht.</div>
                            <label class="check-row"><input type="checkbox" id="sys-ldap-enabled"><span><strong>LDAP-Login aktivieren</strong></span></label>
                            <div class="field"><label>Server-URL</label><input id="sys-ldap-url" type="text" placeholder="ldap://dc.example.com:389 oder ldaps://..."></div>
                            <div class="field"><label>Such-Basis (Base DN)</label><input id="sys-ldap-base-dn" type="text" placeholder="dc=example,dc=com"></div>
                            <div class="field"><label>Benutzer-Filter</label><input id="sys-ldap-filter" type="text" placeholder="(uid={username})"></div>
                            <div class="settings-section-title">Service-Account (für die Suche nach Personen)</div>
                            <div class="field"><label>Bind-DN</label><input id="sys-ldap-bind-dn" type="text" placeholder="cn=service,dc=example,dc=com"></div>
                            <div class="field"><label>Bind-Passwort</label><input id="sys-ldap-bind-pass" type="password" placeholder="Leer lassen = unverändert"></div>
                            <div class="setting-row">
                                <span class="hint" id="sys-ldap-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-ldap-save" type="button">${Icon('save', 15)}Speichern</button>
                            </div>
                            <div class="settings-section-title">Verbindung testen</div>
                            <div class="hint">Testet Service-Bind, Suche und Bind als die eigene Person (dein LDAP-Konto muss denselben Benutzernamen wie hier haben).</div>
                            <div class="form-grid">
                                <div class="field"><label>Eigenes LDAP-Passwort</label><input id="sys-ldap-test-pass" type="password"></div>
                            </div>
                            <button class="btn-secondary btn-sm" id="sys-ldap-test" type="button">${Icon('send', 15)}Verbindung testen</button>
                        </div>
                        <!-- E-Mail / SMTP -->
                        <div id="sys-email" class="tab-content">
                            <div class="callout">Wird hier ein SMTP-Server eingetragen, verschickt der Server echte E-Mails bei
                                Benachrichtigungen (neues Ticket, Statusänderung, Genehmigung, ...), zusätzlich zur In-App-Benachrichtigung.</div>
                            <div class="field"><label>SMTP-Host</label><input id="sys-smtp-host" type="text" placeholder="smtp.example.com"></div>
                            <div class="form-grid">
                                <div class="field"><label>Port</label><input id="sys-smtp-port" type="number" placeholder="587"></div>
                                <div class="field"><label>Verschlüsselung</label><select id="sys-smtp-secure"><option value="false">STARTTLS (empfohlen)</option><option value="true">TLS/SSL</option></select></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>Benutzername</label><input id="sys-smtp-user" type="text" placeholder="support@example.com"></div>
                                <div class="field"><label>Passwort</label><input id="sys-smtp-pass" type="password" placeholder="Leer lassen = unverändert"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>Absender-Adresse</label><input id="sys-smtp-from" type="email" placeholder="support@example.com"></div>
                                <div class="field"><label>Absender-Name</label><input id="sys-smtp-fromname" type="text" placeholder="Support Portal"></div>
                            </div>
                            <div class="form-grid">
                                <div class="field"><label>Antwort-an Adresse</label><input id="sys-email-replyto" type="email" placeholder="reply@example.com"></div>
                                <div class="field"><label>BCC Archiv-Adresse</label><input id="sys-email-bcc" type="email" placeholder="archiv@example.com"></div>
                            </div>
                            <div class="field field-wide"><label>HTML-Signatur</label><textarea id="sys-email-signature" rows="5" placeholder="<p>Mit freundlichen Grüßen</p><strong>IT Service Desk</strong>"></textarea></div>
                            <div class="settings-section-title">E-Mail Sicherheit</div>
                            <div class="form-grid">
                                <div class="field"><label>Transport-Sicherheit</label><select id="sys-email-transport"><option value="starttls">STARTTLS erzwingen</option><option value="tls">TLS/SSL</option><option value="none">Keine Verschlüsselung</option></select></div>
                                <div class="field"><label>Zertifikatsprüfung</label><select id="sys-email-cert-mode"><option value="strict">Strikt prüfen</option><option value="opportunistic">Opportunistisch</option></select></div>
                            </div>
                            <div class="field field-wide"><label>S/MIME Zertifikat (PEM)</label><textarea id="sys-email-smime-cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
                            <div class="field field-wide"><label>S/MIME Private Key (PEM)</label><textarea id="sys-email-smime-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
                            <div class="setting-row">
                                <span class="hint" id="sys-smtp-status"></span>
                                <button class="btn-secondary btn-sm" id="sys-smtp-save-test" type="button">${Icon('send', 15)}Speichern &amp; Test-E-Mail senden</button>
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
                                <label>Standard-Priorität für neue Tickets</label>
                                <select id="sys-default-prio">
                                    <option value="Normal">Normal</option>
                                    <option value="Hoch">Hoch</option>
                                    <option value="Niedrig">Niedrig</option>
                                </select>
                            </div>
                            <div class="settings-section-title">Warten auf Benutzer</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-wait-remind">Erinnerung nach (Tagen)</label><input id="sys-wait-remind" type="number" min="1" placeholder="2"></div>
                                <div class="field"><label for="sys-wait-close">Automatisch schließen nach (Tagen)</label><input id="sys-wait-close" type="number" min="1" placeholder="7"></div>
                            </div>
                            <div class="settings-section-title">Lösungsfrist je Priorität</div>
                            <div class="hint">Zeit bis zur Lösung, wahlweise in Stunden oder Tagen.</div>
                            <div class="form-grid">
                                <div class="field"><label for="sys-sla-low">Niedrig</label><div class="sla-field-row"><input id="sys-sla-low" type="number" min="0.25" step="0.25"><select id="sys-sla-low-unit" aria-label="Einheit Niedrig"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-normal">Normal</label><div class="sla-field-row"><input id="sys-sla-normal" type="number" min="0.25" step="0.25"><select id="sys-sla-normal-unit" aria-label="Einheit Normal"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-high">Hoch</label><div class="sla-field-row"><input id="sys-sla-high" type="number" min="0.25" step="0.25"><select id="sys-sla-high-unit" aria-label="Einheit Hoch"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                                <div class="field"><label for="sys-sla-critical">Kritisch</label><div class="sla-field-row"><input id="sys-sla-critical" type="number" min="0.25" step="0.25"><select id="sys-sla-critical-unit" aria-label="Einheit Kritisch"><option value="hours">Stunden</option><option value="days">Tage</option></select></div></div>
                            </div>
                            <label class="check-row sla-user-visibility-row">
                                <input type="checkbox" id="sys-sla-show-users">
                                <span class="check-text"><strong>Frist auch Benutzern anzeigen</strong><span>Dezenter Hinweis im Ticket, ohne Alarmfarben – auch wenn die Frist überschritten ist.</span></span>
                            </label>

                            <div class="settings-section-title">Geschäftszeiten für Fristen</div>
                            <label class="check-row">
                                <input type="checkbox" id="sys-bh-enabled">
                                <span class="check-text"><strong>Geschäftszeiten berücksichtigen</strong><span>Außerhalb dieser Zeiten sowie an Feiertagen läuft die Lösungsfrist nicht weiter.</span></span>
                            </label>
                            <div class="field field-wide">
                                <label>Geschäftszeiten je Tag</label>
                                <div class="business-hours-grid" id="sys-bh-days">
                                    ${[1, 2, 3, 4, 5, 6, 0].map(i => ({ i, d: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][i] })).map(({ i, d }) => `
                                        <div class="business-day-row" data-day="${i}">
                                            <label class="check-row compact"><input type="checkbox" class="bh-day-enabled" value="${i}"><span>${d}</span></label>
                                            <input class="bh-day-start" type="time" aria-label="${d} Beginn">
                                            <span class="business-day-sep">bis</span>
                                            <input class="bh-day-end" type="time" aria-label="${d} Ende">
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="field field-wide">
                                <label for="sys-bh-holidays">Feiertage (ein Datum pro Zeile, dd.mm.jjjj)</label>
                                <textarea id="sys-bh-holidays" rows="4" placeholder="01.01.2026&#10;25.12.2026"></textarea>
                            </div>
                        </div>

                        <!-- Unternehmenseinstellungen -->
                        <div id="sys-company" class="tab-content">
                            <div class="field"><label>Firmenname</label><input id="sys-company-name" type="text" placeholder="Muster GmbH"></div>
                            <div class="settings-section-title">Branding &amp; Kontaktdaten</div>
                            <div class="field"><label>Firmenlogo / Logo-URL</label><input id="sys-company-logo" type="text" placeholder="https://example.com/logo.png oder Data-URL"></div>
                            <div class="form-grid">
                                <div class="field"><label>Support-E-Mail</label><input id="sys-company-support" type="email" placeholder="support@example.com"></div>
                                <div class="field"><label>Telefon</label><input id="sys-company-phone" type="text" placeholder="+49 ..."></div>
                            </div>
                            <div class="field field-wide"><label>Adresse</label><textarea id="sys-company-address" rows="3" placeholder="Straße, PLZ Ort"></textarea></div>
                            <div class="form-grid">
                                <div class="field"><label>Impressum-URL</label><input id="sys-company-imprint" type="url" placeholder="https://example.com/impressum"></div>
                                <div class="field"><label>Datenschutz-URL</label><input id="sys-company-privacy" type="url" placeholder="https://example.com/datenschutz"></div>
                            </div>
                            <div class="settings-section-title">Ticketnummern für neue Tickets</div>
                            <div class="callout">Formatvorlagen unterstützen <code>{prefix}</code>, <code>{category}</code> (Code der ersten Ticketkategorie) und <code>{number}</code>. Jede Vorlage muss <code>{number}</code> enthalten. Bestehende Ticketnummern bleiben unverändert.</div>
                            <div class="form-grid">
                                <div class="field"><label>Format (Standard)</label><input id="sys-ticket-number-format" type="text" placeholder="{prefix}-{number}"></div>
                                <div class="field"><label>Zusatz / Präfix</label><input id="sys-ticket-number-prefix" type="text" placeholder="TS"></div>
                                <div class="field"><label>Stellen der laufenden Nummer</label><input id="sys-ticket-number-padding" type="number" min="1" max="12" placeholder="5"></div>
                            </div>
                            <div class="field field-wide">
                                <label>Kategorieformate (leer = Standardformat)</label>
                                <div id="sys-ticket-category-formats" class="ticket-number-category-formats"></div>
                            </div>
                            <div class="settings-section-title">Konto-Selbstverwaltung</div>
                            <div class="hint">Welche Angaben dürfen Benutzer in ihrem Konto selbst ändern?</div>
                            <label class="check-row"><input type="checkbox" id="sys-acc-name"><span>Name</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-email"><span>E-Mail</span></label>
                            <label class="check-row"><input type="checkbox" id="sys-acc-dept"><span>Einrichtung / Abteilung</span></label>
                            <div class="settings-section-title">Genehmigungen durch Vorgesetzte</div>
                            <div class="hint">Wenn eine Person mit hinterlegter Vorgesetzter Person ein Ticket mit einer der gewählten Prioritäten anlegt, wird automatisch eine Genehmigung angefordert. Vorgesetzte Person wird je Benutzer unter Benutzerverwaltung festgelegt.</div>
                            <label class="check-row"><input type="checkbox" id="sys-appr-enabled"><span><strong>Genehmigungsworkflow aktivieren</strong></span></label>
                            <div class="perm-grid">
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Niedrig"><span>Niedrig</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Normal"><span>Normal</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Hoch"><span>Hoch</span></label>
                                <label class="check-row"><input type="checkbox" class="sys-appr-prio" value="Kritisch"><span>Kritisch</span></label>
                            </div>
                            <div class="field">
                                <label>Ersatzperson ohne Vorgesetzte(n)</label>
                                <p class="hint">Wird verwendet, wenn die erstellende Person keine Vorgesetzte Person hinterlegt hat. Ohne Auswahl springt die Anfrage an eine beliebige Superadmin-Person.</p>
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
                    if (window.lucide) lucide.createIcons();
                };
            });

            modal.querySelectorAll('.close-m').forEach(b => b.onclick = () => {
                modal.classList.remove('open');
                clearTimeout(AdminBoard.updatePollTimer);
            });
            q('#sys-update-check').onclick = () => AdminBoard.renderUpdateStatus();
            q('#sys-update-run').onclick = async () => {
                q('#sys-update-run').disabled = true;
                UI.toast('Update wurde gestartet. Die Anwendung wird gleich neu gebaut und kurz neu gestartet.');
                await Store.runUpdate();
                await AdminBoard.renderUpdateStatus();
            };
        }

        const settings = await Store.getSettings();
        const general = settings.generalConfig || {};
        const company = settings.companyConfig || {};
        const security = settings.securityConfig || {};
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
        q('#sys-company-logo').value = companyBranding.logoDataUrl || '';
        q('#sys-company-support').value = companyBranding.supportEmail || '';
        q('#sys-company-phone').value = companyBranding.phone || '';
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
                </div>`).join('') : '<div class="empty-state compact">Keine Kategorien angelegt.</div>';
        }

        q('#sys-sec-pass-min').value = security.passwordMinLength ?? 14;
        q('#sys-sec-session').value = security.sessionTimeoutMinutes ?? 480;
        q('#sys-sec-attempts').value = security.maxLoginAttempts ?? 5;
        q('#sys-sec-2fa-admins').checked = !!security.require2faForAdmins;
        q('#sys-sec-permanent').checked = !!security.allowPermanentSessions;

        AdminBoard.renderNotifMatrix(q('#sys-notif-matrix'), await Store.getNotifPolicy());

        q('#sys-email-replyto').value = emailAdvanced.replyTo || '';
        q('#sys-email-bcc').value = emailAdvanced.bccArchive || '';
        q('#sys-email-signature').value = emailAdvanced.htmlSignature || '';
        q('#sys-email-transport').value = emailAdvanced.transportSecurity || 'starttls';
        q('#sys-email-cert-mode').value = emailAdvanced.certificateValidation || 'strict';
        q('#sys-email-smime-cert').value = emailAdvanced.smimeCertificatePem || '';
        q('#sys-email-smime-key').value = emailAdvanced.smimePrivateKeyPem || '';

        q('#sys-outlook-enabled').checked = !!outlook.enabled;
        q('#sys-outlook-tenant').value = outlook.tenantId || '';
        q('#sys-outlook-client').value = outlook.clientId || '';
        q('#sys-outlook-mailbox').value = outlook.mailbox || '';
        q('#sys-outlook-sync').checked = !!outlook.syncIncoming;
        q('#sys-outlook-create').checked = !!outlook.createTicketsFromMail;

        const accEditable = settings.accountConfig?.editable || {};
        q('#sys-acc-name').checked = accEditable.name !== false;
        q('#sys-acc-email').checked = accEditable.email !== false;
        q('#sys-acc-dept').checked = !!accEditable.department;

        const appr = settings.approvalConfig || {};
        q('#sys-appr-enabled').checked = !!appr.enabled;
        qa('.sys-appr-prio').forEach(cb => { cb.checked = (appr.priorities || []).includes(cb.value); });
        const apprFallbackUsers = (await Store.getUsers()).filter(u => !u.accountArchived);
        apprFallbackPicker = UI.createMultiSelect(
            q('#sys-appr-fallback'),
            apprFallbackUsers.map(u => ({ value: u.id, label: u.name || u.username })),
            appr.fallbackApproverUserId || '', null, { single: true, emptyLabel: 'Keine (Superadmin automatisch)' }
        );

        const smtp = await Store.getSmtpConfig();
        q('#sys-smtp-host').value = smtp?.host || '';
        q('#sys-smtp-port').value = smtp?.port || 587;
        q('#sys-smtp-secure').value = smtp?.secure ? 'true' : 'false';
        q('#sys-smtp-user').value = smtp?.user || '';
        q('#sys-smtp-pass').value = '';
        q('#sys-smtp-pass').placeholder = smtp?.hasPassword ? 'Leer lassen = unverändert' : 'Passwort eingeben';
        q('#sys-smtp-from').value = smtp?.from || '';
        q('#sys-smtp-fromname').value = smtp?.fromName || '';
        q('#sys-smtp-status').textContent = smtp?.configured ? 'SMTP ist konfiguriert.' : 'SMTP ist noch nicht konfiguriert.';
        q('#sys-smtp-save-test').onclick = async () => {
            const host = q('#sys-smtp-host').value.trim();
            const from = q('#sys-smtp-from').value.trim();
            if (!host || !from) return UI.toast('Bitte Host und Absender-Adresse angeben.');
            const user = await Store.currentUser();
            if (!user?.email) return UI.toast('Kein E-Mail im eigenen Profil hinterlegt -- wohin soll die Test-Mail gehen?');
            const ok = await Store.updateSmtpConfig({
                host, port: parseInt(q('#sys-smtp-port').value, 10) || 587,
                secure: q('#sys-smtp-secure').value === 'true',
                user: q('#sys-smtp-user').value.trim() || null,
                password: q('#sys-smtp-pass').value || undefined,
                from, fromName: q('#sys-smtp-fromname').value.trim() || null
            });
            if (!ok) return UI.toast('SMTP-Einstellungen speichern fehlgeschlagen.');
            UI.toast('SMTP-Einstellungen gespeichert, sende Test-E-Mail...');
            const sent = await Store.sendTestSmtpEmail(user.email);
            UI.toast(sent ? `Test-E-Mail an ${user.email} gesendet.` : 'Test-E-Mail senden fehlgeschlagen -- bitte Zugangsdaten prüfen.');
            q('#sys-smtp-pass').value = '';
            q('#sys-smtp-status').textContent = 'SMTP ist konfiguriert.';
        };

        const ldap = await Store.getLdapConfig();
        q('#sys-ldap-enabled').checked = !!ldap?.enabled;
        q('#sys-ldap-url').value = ldap?.url || '';
        q('#sys-ldap-base-dn').value = ldap?.baseDn || '';
        q('#sys-ldap-filter').value = ldap?.userFilter || '(uid={username})';
        q('#sys-ldap-bind-dn').value = ldap?.bindDn || '';
        q('#sys-ldap-bind-pass').value = '';
        q('#sys-ldap-bind-pass').placeholder = ldap?.hasBindPassword ? 'Leer lassen = unverändert' : 'Passwort eingeben';
        q('#sys-ldap-status').textContent = ldap?.enabled ? 'LDAP-Login ist aktiviert.' : 'LDAP-Login ist deaktiviert.';
        q('#sys-ldap-save').onclick = async () => {
            const url = q('#sys-ldap-url').value.trim();
            const baseDn = q('#sys-ldap-base-dn').value.trim();
            const bindDn = q('#sys-ldap-bind-dn').value.trim();
            if (!url || !baseDn || !bindDn) return UI.toast('Bitte Server-URL, Such-Basis und Bind-DN angeben.');
            const ok = await Store.updateLdapConfig({
                enabled: q('#sys-ldap-enabled').checked,
                url, baseDn, bindDn,
                bindPassword: q('#sys-ldap-bind-pass').value || undefined,
                userFilter: q('#sys-ldap-filter').value.trim() || '(uid={username})'
            });
            if (!ok) return UI.toast('LDAP-Einstellungen speichern fehlgeschlagen.');
            UI.toast('LDAP-Einstellungen gespeichert.');
            q('#sys-ldap-bind-pass').value = '';
            q('#sys-ldap-status').textContent = q('#sys-ldap-enabled').checked ? 'LDAP-Login ist aktiviert.' : 'LDAP-Login ist deaktiviert.';
        };
        q('#sys-ldap-test').onclick = async () => {
            const password = q('#sys-ldap-test-pass').value;
            if (!password) return UI.toast('Bitte das eigene LDAP-Passwort eingeben.');
            UI.toast('Teste LDAP-Verbindung...');
            const ok = await Store.testLdapConfig(password);
            UI.toast(ok ? 'LDAP-Test erfolgreich.' : 'LDAP-Test fehlgeschlagen -- Konfiguration oder Passwort prüfen.');
            q('#sys-ldap-test-pass').value = '';
        };

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
        AdminBoard.renderUpdateStatus();

        q('#sys-save').onclick = async () => {
            const padding = Math.max(1, Math.min(12, parseInt(q('#sys-ticket-number-padding').value, 10) || 5));
            const accountSelfServiceFields = ['name', 'email', 'department'].filter(f => q(`#sys-acc-${f === 'department' ? 'dept' : f}`).checked);
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
                        passwordMinLength: Math.max(8, Math.min(128, parseInt(q('#sys-sec-pass-min').value, 10) || 14)),
                        sessionTimeoutMinutes: Math.max(5, Math.min(10080, parseInt(q('#sys-sec-session').value, 10) || 480)),
                        maxLoginAttempts: Math.max(1, Math.min(50, parseInt(q('#sys-sec-attempts').value, 10) || 5)),
                        require2faForAdmins: q('#sys-sec-2fa-admins').checked,
                        allowPermanentSessions: q('#sys-sec-permanent').checked
                    },
                    notifPolicy: AdminBoard.readNotifMatrix(q('#sys-notif-matrix')),
                    emailAdvancedConfig: {
                        replyTo: q('#sys-email-replyto').value.trim() || null,
                        bccArchive: q('#sys-email-bcc').value.trim() || null,
                        htmlSignature: q('#sys-email-signature').value,
                        transportSecurity: q('#sys-email-transport').value,
                        certificateValidation: q('#sys-email-cert-mode').value,
                        smimeCertificatePem: q('#sys-email-smime-cert').value,
                        smimePrivateKeyPem: q('#sys-email-smime-key').value
                    },
                    outlookConfig: {
                        enabled: q('#sys-outlook-enabled').checked,
                        tenantId: q('#sys-outlook-tenant').value.trim(),
                        clientId: q('#sys-outlook-client').value.trim(),
                        mailbox: q('#sys-outlook-mailbox').value.trim(),
                        syncIncoming: q('#sys-outlook-sync').checked,
                        createTicketsFromMail: q('#sys-outlook-create').checked
                    },
                    companyBrandingConfig: {
                        logoDataUrl: q('#sys-company-logo').value.trim(),
                        supportEmail: q('#sys-company-support').value.trim(),
                        phone: q('#sys-company-phone').value.trim(),
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
            if (!ok) return UI.toast('Systemeinstellungen speichern fehlgeschlagen.');
            if (q('.kanban-board')) await AdminBoard.render();
            if (q('#user-tickets')) await UserDash.renderList();
            modal.classList.remove('open');
            UI.toast('Systemeinstellungen gespeichert');
        };
    },

    // Listenansicht: Tabelle mit sortierbaren Spalten, Filtern, gespeicherten Ansichten
    // und Mehrfachauswahl für Sammelaktionen -- für Admins mit vielen offenen Tickets,
    // wo ein Kanban-Board nicht mehr überschaubar ist.
    listViewState: { sortKey: 'createdAt', sortDir: 'desc', selected: new Set() },

    openListView: async () => {
        const container = q('#list-view');
        if (!container.dataset.built) {
            container.dataset.built = '1';
            container.innerHTML = `
                <div class="list-view-toolbar">
                    <input type="search" id="lv-search" class="section-search" placeholder="Suchen...">
                    <select id="lv-status"><option value="">Alle Status</option></select>
                    <select id="lv-prio"><option value="">Alle Prioritäten</option><option>Niedrig</option><option>Normal</option><option>Hoch</option><option>Kritisch</option></select>
                    <select id="lv-category"><option value="">Alle Kategorien</option></select>
                    <select id="lv-team"><option value="">Alle Teams</option></select>
                    <details class="lv-more">
                        <summary class="btn-secondary btn-sm">${Icon('sliders-horizontal', 15)}Filter &amp; Ansichten</summary>
                        <div class="lv-more-body">
                            <label class="check-row compact"><input type="checkbox" id="lv-mine">Nur meine</label>
                            <label class="check-row compact"><input type="checkbox" id="lv-sla-risk">SLA in Gefahr</label>
                            <select id="lv-saved-views"><option value="">Gespeicherte Ansicht...</option></select>
                            <button id="lv-save-view" class="btn-secondary btn-sm">${Icon('bookmark-plus', 15)}Ansicht speichern</button>
                            <button id="lv-delete-view" class="btn-ghost btn-icon btn-danger btn-sm" title="Ausgewählte Ansicht löschen" aria-label="Ausgewählte Ansicht löschen">${Icon('trash-2', 15)}</button>
                        </div>
                    </details>
                </div>
                <div id="lv-bulk-bar" class="list-view-bulk-bar" hidden>
                    <span id="lv-selected-count"></span>
                    <select id="lv-bulk-status">
                        <option value="">Status setzen...</option>
                        <option value="Neu">Neu</option>
                        <option value="In Bearbeitung">In Bearbeitung</option>
                        <option value="Geschlossen">Geschlossen</option>
                    </select>
                    <button id="lv-bulk-apply-status" class="btn-secondary btn-sm">Anwenden</button>
                    <button id="lv-bulk-archive" class="btn-secondary btn-sm">${Icon('archive', 15)}Archivieren</button>
                </div>
                <div class="list-view-table-wrap">
                    <table class="list-view-table">
                        <thead><tr>
                            <th><input type="checkbox" id="lv-select-all"></th>
                            <th data-sort="ticketNumber">Ticket-Nr</th>
                            <th data-sort="title">Titel</th>
                            <th data-sort="status">Status</th>
                            <th data-sort="prio">Priorität</th>
                            <th data-sort="category">Kategorie</th>
                            <th data-sort="owner">Verantwortlich</th>
                            <th data-sort="createdAt">Erstellt</th>
                            <th data-sort="sla">Frist</th>
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
                        AdminBoard.listViewState.sortDir = 'asc';
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
                    title: 'Ansicht speichern',
                    label: 'Name der Ansicht',
                    placeholder: 'z. B. Meine offenen oder SLA in Gefahr',
                    saveLabel: 'Ansicht speichern'
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
                UI.toast(ok ? 'Ansicht gespeichert.' : 'Ansicht speichern fehlgeschlagen.');
                await AdminBoard.populateListViewFilters();
            };
            q('#lv-delete-view').onclick = async () => {
                const id = q('#lv-saved-views').value;
                if (!id) return UI.toast('Bitte zuerst eine gespeicherte Ansicht auswählen.');
                UI.confirm('Diese gespeicherte Ansicht löschen?', async () => {
                    const ok = await Store.deleteListView(id);
                    UI.toast(ok ? 'Ansicht gelöscht.' : 'Löschen fehlgeschlagen.');
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
                UI.toast(`${changed} Ticket(s) aktualisiert.`);
                AdminBoard.listViewState.selected = new Set();
                await AdminBoard.renderListView();
            };
            q('#lv-bulk-archive').onclick = async () => {
                if (!AdminBoard.listViewState.selected.size) return;
                UI.confirm(`${AdminBoard.listViewState.selected.size} ausgewählte Ticket(s) archivieren?`, async () => {
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
                    UI.toast(changed ? `${changed} Ticket(s) archiviert.` : 'Nur geschlossene Tickets können archiviert werden.');
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
        statusSel.innerHTML = '<option value="">Alle Status</option>' + ['Neu', 'In Bearbeitung', 'Warten auf Benutzer', 'Warten auf externen Dienstleister', 'Warten auf interne Rückmeldung', 'Geschlossen'].map(s => `<option ${s === curStatus ? 'selected' : ''}>${Utils.esc(s)}</option>`).join('');
        const catSel = q('#lv-category');
        const curCat = catSel.value;
        catSel.innerHTML = '<option value="">Alle Kategorien</option>' + (settings.categories || []).map(c => `<option ${c === curCat ? 'selected' : ''}>${Utils.esc(c)}</option>`).join('');
        const teamSel = q('#lv-team');
        const curTeam = teamSel.value;
        teamSel.innerHTML = '<option value="">Alle Teams</option>' + groups.map(g => `<option value="${Utils.esc(g.id)}" ${g.id === curTeam ? 'selected' : ''}>${Utils.esc(g.name)}</option>`).join('');
        const viewsSel = q('#lv-saved-views');
        viewsSel.innerHTML = '<option value="">Gespeicherte Ansicht...</option>' + views.filter(v => v.ownerUserId === actor?.id || v.isShared).map(v => `<option value="${v.id}">${Utils.esc(v.name)}${v.isShared ? ' (geteilt)' : ''}</option>`).join('');
    },

    updateListViewBulkBar: () => {
        const bar = q('#lv-bulk-bar');
        const count = AdminBoard.listViewState.selected.size;
        bar.hidden = count === 0;
        q('#lv-selected-count').textContent = `${count} ausgewählt`;
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
        const sortValue = (t) => {
            if (sortKey === 'category') return (Array.isArray(t.category) ? t.category[0] : t.category) || '';
            if (sortKey === 'owner') return nameFor(t.owner);
            if (sortKey === 'sla') { const d = Store.ticketSlaDueAt(t, settings); return d ?? Infinity; }
            if (sortKey === 'createdAt') return new Date(t.createdAt).getTime();
            return t[sortKey] || '';
        };
        visible.sort((a, b) => {
            const va = sortValue(a), vb = sortValue(b);
            const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return sortDir === 'asc' ? cmp : -cmp;
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
                <td>${pendingApproval ? `<span class="approval-badge" title="Wartet auf Genehmigung">${Icon('hourglass', 12)}Genehmigung</span>` : `<span class="status-badge">${Utils.esc(Lang.status(t.status))}</span>`}</td>
                <td><span class="t-tag prio-${t.prio}">${Utils.esc(Lang.prio(t.prio))}</span></td>
                <td>${Utils.esc((Array.isArray(t.category) ? t.category : [t.category]).filter(Boolean).join(', ') || '-')}${team ? ` <span class="t-team">${Icon('route', 10)}${Utils.esc(team.name)}</span>` : ''}</td>
                <td>${Utils.esc(nameFor(t.owner))}</td>
                <td>${Utils.esc(Utils.fmtDate(t.createdAt))}</td>
                <td>${countdown ? `<span class="sla-mini-badge sla-badge-${countdown.tone}" title="Frist: ${Utils.esc(countdown.dueDateLabel)}">${Utils.esc(countdown.dueDateLabel)} · ${Utils.esc(countdown.label)}</span>` : '-'}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty-state">Keine Tickets gefunden.</div></td></tr>`;

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
                <span class="status-dot" style="--dot:${getStatusColor(t.status)}"></span>
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
            list.innerHTML = '<div class="empty-state compact">Keine offenen Anfragen</div>';
            return;
        }
        const existingUsers = await Store.getUsers();
        reqs.forEach(r => {
            const el = document.createElement('div');
            el.className = 'ticket-card request-card';
            const match = existingUsers.find(u => u.email && u.email.toLowerCase() === String(r.email || '').toLowerCase());
            const restoreLabel = match?.accountArchived ? 'Reaktivieren' : 'Entsperren';
            const showRestore = !!match && (match.accountLocked || match.accountArchived);
            el.innerHTML = `
                <div class="req-name">${Utils.esc(r.name)}</div>
                <div class="req-mail">${Utils.esc(r.email)}</div>
                <div class="req-actions">
                    <button class="btn-primary btn-sm req-accept">${Icon('check', 15)}Annehmen</button>
                    ${showRestore ? `<button class="btn-secondary btn-sm req-restore">${Icon(match.accountArchived ? 'archive-restore' : 'lock-open', 15)}${restoreLabel}</button>` : ''}
                    <button class="btn-secondary btn-sm req-decline">${Icon('x', 15)}Ablehnen</button>
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
                UI.toast(`${target.username} wurde ${restoreLabel === 'Reaktivieren' ? 'reaktiviert' : 'entsperrt'}.`);
                AdminBoard.renderRequests();
            };
            el.querySelector('.req-decline').onclick = () => {
                UI.confirm('Anfrage ablehnen?', async () => {
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

        if (Lang.current === 'en') {
            select.options[0].textContent = 'Choose a reason';
            select.options[1].textContent = 'Waiting for user';
            select.options[2].textContent = 'Waiting for external provider';
            select.options[3].textContent = 'Waiting for internal feedback';
            q('#waiting-status-title').lastChild.textContent = fixedStatus ? 'What do you need from the user?' : 'What are you waiting for?';
            reasonField.querySelector('label').textContent = 'Waiting reason';
            messageField.querySelector('label').textContent = 'Message to the user';
            messageInput.placeholder = 'Describe what you need from the user.';
            confirm.title = confirm.ariaLabel = 'Apply';
            cancel.title = cancel.ariaLabel = 'Cancel';
        } else {
            select.options[0].textContent = 'Bitte auswählen';
            select.options[1].textContent = 'Auf Benutzer';
            select.options[2].textContent = 'Auf externen Dienstleister';
            select.options[3].textContent = 'Auf interne Rückmeldung';
            q('#waiting-status-title').lastChild.textContent = fixedStatus ? 'Was wird vom Benutzer benötigt?' : 'Worauf wird gewartet?';
            reasonField.querySelector('label').textContent = 'Wartegrund';
            messageField.querySelector('label').textContent = 'Nachricht an den Benutzer';
            messageInput.placeholder = 'Was wird vom Benutzer benötigt?';
            confirm.title = confirm.ariaLabel = 'Übernehmen';
            cancel.title = cancel.ariaLabel = 'Abbrechen';
        }

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
            UI.toast('Bitte beschreiben, was vom Benutzer benötigt wird.');
            return false;
        }
        if (newStatus !== 'Geschlossen' && (ticket.approvals || []).some(a => a.status === 'pending')) {
            UI.toast('Dieses Ticket wartet noch auf eine Genehmigung.');
            return false;
        }
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

        await Store.saveTickets(tickets);
        if (newStatus === 'Geschlossen' && ticket.isMajorIncident) {
            await AdminBoard.notifyLinkedIncidentTickets(ticket, ticket.desc);
        }
        if (linkedForNotify.length) {
            await Store.addNotifications(linkedForNotify.map(lt => lt.author).filter(Boolean), ticket, `Status der Großstörung wurde auf "${Lang.status(newStatus)}" geändert.`, actor?.username, 'statusChange');
        }
        const requestDetails = newStatus === 'Warten auf Benutzer' ? `\nAnforderung: ${ticket.waitingMessage}` : '';
        await Store.addGlobalLog('Ticket Status geändert', `Ticket: ${ticket.title}, Status: ${newStatus}${requestDetails}`);
        const notificationMessage = newStatus === 'Warten auf Benutzer' ?
            `Wir benötigen noch folgende Angaben: ${ticket.waitingMessage}` :
            `Status geändert: ${Lang.status(newStatus)}`;
        const statusNotifType = newStatus === 'Geschlossen' ? 'ticketClosed' : 'statusChange';
        await Store.addNotifications([ticket.author, ...(ticket.participants || [])], ticket, notificationMessage, actor?.username, statusNotifType);

        const settings = await Store.getSettings();
        const author = (await Store.getUsers()).find(user => user.username === ticket.author);
        if (author?.email && settings.emailConfig?.host) {
            const statusPref = await Store.resolveNotifPref(author, statusNotifType);
            if (statusNotifType === 'ticketClosed' && statusPref.email) {
                await Store.sendEmail(author.email, `Ticket geschlossen: ${ticket.title}`, 'Dein Ticket wurde geschlossen. Du kannst den Verlauf weiterhin im Portal einsehen.');
            } else if (statusNotifType === 'statusChange' && statusPref.email) {
                await Store.sendEmail(author.email, `Ticket Update: ${ticket.title}`, `Status geändert auf: ${Lang.status(newStatus)}${newStatus === 'Warten auf Benutzer' ? `\n\nWir benötigen noch folgende Angaben:\n${ticket.waitingMessage}` : ''}`);
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
                        if (changed) UI.toast(`Status geändert: ${Lang.status(waitingChoice.status)}`);
                    } else {
                        const changed = await AdminBoard.changeStatus(id, newStatus);
                        if (changed) UI.toast(`Status geändert: ${Lang.status(newStatus)}`);
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

    syncTodoAssignees: async (ticket) => {
        const allowed = new Set([ticket.owner, ...(ticket.participants || [])].filter(Boolean));
        const cleared = [];
        (ticket.todos || []).forEach(todo => {
            if (todo.assignee && !allowed.has(todo.assignee)) {
                cleared.push(todo.title);
                todo.assignee = '';
            }
        });
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
            <div class="section-title">${Icon('user-check', 15)} Zuständigkeiten</div>
            <div class="responsibility-grid">
                <div class="field">
                    <label>Hauptverantwortlicher</label>
                    <select id="m-owner-select">
                        <option value="">Nicht zugewiesen</option>
                        ${staff.map(u => `<option value="${u.username}">${u.name || u.username}</option>`).join('')}
                    </select>
                </div>
                <div class="field">
                    <label>Beteiligte Personen</label>
                    <div id="participants-multi" class="multi-select-container"></div>
                </div>
            </div>
            <div class="ticket-todo-panel">
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('list-checks', 15)}Teilaufgaben</span><span id="todo-progress-count" class="todo-progress-count"></span></div>
                <div id="todo-progress-bar" class="todo-progress-bar" hidden><div id="todo-progress-fill" class="todo-progress-fill"></div></div>
                <div id="ticket-todos" class="ticket-todos"></div>
                <div class="todo-create-row">
                    <input id="todo-title" type="text" placeholder="Neue Teilaufgabe">
                    <select id="todo-assignee">
                        <option value="">Ohne Zuweisung</option>
                        ${AdminBoard.getTodoAssigneeOptions(t, staff, actor?.username).map(u => `<option value="${Utils.esc(u.username)}"${u.username === actor?.username ? ' selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                    </select>
                    <button class="btn-primary" id="todo-add" type="button">${Icon('plus', 16)}Hinzufügen</button>
                </div>
            </div>
            <div class="time-tracking-panel">
                <div class="section-title todo-section-title"><span class="todo-title-group">${Icon('clock', 15)}Zeiterfassung</span><span id="time-total-label" class="todo-progress-count"></span></div>
                <div id="time-entry-list" class="time-entry-list"></div>
                <div class="todo-create-row">
                    <input id="time-minutes" type="number" min="1" step="5" placeholder="Minuten">
                    <input id="time-note" type="text" placeholder="Notiz (optional)">
                    <button class="btn-primary" id="time-add" type="button">${Icon('plus', 16)}Hinzufügen</button>
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
                UI.toast('Beteiligte speichern fehlgeschlagen.');
                return;
            }
            t.participants = filtered;
            await AdminBoard.syncTodoAssignees(t);
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
        const fmtMinutes = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} Std.` : `${mins} Min.`;
        const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        const totalLabel = q('#time-total-label');
        if (totalLabel) totalLabel.textContent = totalMinutes ? `${fmtMinutes(totalMinutes)} erfasst` : '';
        list.innerHTML = entries.length ? entries.slice().reverse().map(e => `
            <div class="time-entry-row" data-id="${Utils.esc(e.id)}">
                <span class="time-entry-duration">${fmtMinutes(e.minutes)}</span>
                <span class="time-entry-meta">${Utils.esc(e.username)} · ${Utils.esc(Utils.fmtDate(e.created_at))}${e.note ? ' · ' + Utils.esc(e.note) : ''}</span>
                <button type="button" class="btn-ghost btn-icon btn-xs btn-danger time-entry-remove" title="Eintrag entfernen" aria-label="Eintrag entfernen">${Icon('x', 13)}</button>
            </div>`).join('') : '<div class="empty-state compact">Noch keine Zeit erfasst.</div>';
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
                UI.toast('Bitte eine gültige Dauer in Minuten angeben.');
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
                    <h3>${Icon('list-tree', 18)}Tickets zur Störung hinzufügen</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" id="iam-save" title="Hinzufügen" aria-label="Hinzufügen">${Icon('save', 16)}</button>
                        <button class="btn-ghost btn-icon" id="iam-close" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body">
                    <input type="search" id="iam-search" class="section-search" placeholder="Ticket-Nr, Titel oder Person suchen...">
                    <div class="checkbox-list" id="iam-list">${candidates.map(t => `
                        <label class="check-row" data-search="${Utils.esc(`${t.ticketNumber || ''} ${t.title} ${t.authorName || ''} ${t.author || ''}`.toLowerCase())}"><input type="checkbox" value="${Utils.esc(t.id)}">
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>${Utils.esc(t.authorName || t.author || '-')} · ${Lang.status(t.status)}</span></span>
                        </label>`).join('')}</div>
                    <div class="empty-state compact" id="iam-empty" ${candidates.length ? 'hidden' : ''}>Keine Treffer.</div>
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
            if (!ids.length) return UI.toast('Bitte mindestens ein Ticket auswählen.');
            for (const ticketId of ids) await AdminBoard.linkTicketToIncident(ticketId, incidentId);
            close();
            UI.toast(`${ids.length} Ticket(s) zur Störung hinzugefügt.`);
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
            </div>` : '<div class="empty-state compact">Noch keine Tickets zugeordnet.</div>'}
        `;
        box.querySelectorAll('.incident-linked-open').forEach(btn => {
            btn.onclick = () => AdminBoard.openModal(btn.closest('[data-ticket-id]').dataset.ticketId);
        });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-secondary btn-sm incident-linked-add';
        addBtn.innerHTML = `${Icon('plus', 14)}Ticket hinzufügen`;
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
                </label>
                <div class="todo-meta">
                    ${todo.assignee_username ? `<span class="badge">${Icon('user-round', 12)}${esc(getName(todo.assignee_username))}</span>` : '<span class="badge">Nicht zugewiesen</span>'}
                    <button class="btn-ghost btn-icon btn-sm todo-edit" title="Teilaufgabe bearbeiten" aria-label="Teilaufgabe bearbeiten" ${t.archived ? 'disabled' : ''}>${Icon('pencil', 14)}</button>
                    <button class="btn-ghost btn-icon btn-sm btn-danger todo-delete" title="Teilaufgabe löschen" aria-label="Teilaufgabe löschen" ${t.archived ? 'disabled' : ''}>${Icon('trash-2', 15)}</button>
                </div>
            </div>
        `).join('') : '<div class="empty-state compact">Noch keine Teilaufgaben.</div>';

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
                        <input class="todo-title-edit" type="text" value="${esc(todo.content)}" aria-label="Teilaufgabe">
                        <select class="todo-assignee-edit" aria-label="Zuständige Person">
                            <option value="">Ohne Zuweisung</option>
                            ${assigneeOptions.map(user => `<option value="${esc(user.username)}">${esc(user.name || user.username)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="todo-meta">
                        <button class="btn-ghost btn-icon btn-sm todo-save" title="Speichern" aria-label="Speichern">${Icon('check', 14)}</button>
                        <button class="btn-ghost btn-icon btn-sm todo-cancel" title="Abbrechen" aria-label="Abbrechen">${Icon('x', 14)}</button>
                    </div>`;
                const select = row.querySelector('.todo-assignee-edit');
                if (assigneeOptions.some(user => user.username === todo.assignee_username)) select.value = todo.assignee_username;
                row.querySelector('.todo-save').onclick = async () => {
                    const title = row.querySelector('.todo-title-edit').value.trim();
                    if (!title) return UI.toast('Bitte einen Titel angeben.');
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
        modal.querySelector('.modal-header h3').textContent = `Abwesenheit · ${target.name || target.username}`;
        modal.querySelector('.modal-body').innerHTML = `
            <label class="check-row"><input type="checkbox" id="abs-active" ${target.absence?.active ? 'checked' : ''}>Als abwesend markieren</label>
            ${Settings.absencePeriodMarkup(target.absence, 'abm')}
            <label class="check-row"><input type="checkbox" id="abs-visible" ${target.absence?.visible ? 'checked' : ''}>Anderen Admins anzeigen, dass ich abwesend bin</label>
            <div class="field">
                <label for="abs-substitute">Vertretung</label>
                <select id="abs-substitute">
                    <option value="">Keine – Tickets zurück ins Team</option>
                    ${substitutes.map(u => `<option value="${Utils.esc(u.username)}" ${target.absence?.substitute === u.username ? 'selected' : ''}>${Utils.esc(u.name || u.username)}</option>`).join('')}
                </select>
            </div>
            <p class="hint">Beim Aktivieren werden alle offenen Tickets, bei denen ${Utils.esc(target.name || target.username)} Hauptverantwortlicher ist, sofort an die Vertretung übergeben – oder ohne Vertretung dem Team zur erneuten Verteilung zurückgegeben.</p>`;
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
            UI.toast('Abwesenheit speichern fehlgeschlagen.');
            return;
        }
        if (fromMs && fromMs > now) {
            await Store.addGlobalLog('Abwesenheit geplant', `Benutzer: ${target.name || username}, von ${fmt(fromMs)} bis ${untilMs ? fmt(untilMs) : 'offen'}, Vertretung: ${substitute ? (substitute.name || substitute.username) : 'keine'}, Anzeige für andere Admins: ${visible ? 'ja' : 'nein'}`);
            UI.toast(`Abwesenheit geplant ab ${fmt(fromMs)}.`);
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
        UI.toast(openTickets.length ? `${openTickets.length} Ticket(s) übergeben.` : 'Abwesenheit aktiviert.');
        await AdminBoard.render();
    },

    endAbsence: async (target, users) => {
        const me = await Store.currentUser();
        const isSelf = me?.id === target.id;
        const result = await Store.setUserAbsence(isSelf ? null : target.id, { active: false });
        if (!result) {
            UI.toast('Abwesenheit beenden fehlgeschlagen.');
            return;
        }
        await Store.addGlobalLog('Abwesenheit beendet', `Benutzer: ${target.name || target.username}`);
        UI.toast('Abwesenheit beendet.');
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
            const message = `${absent?.name || absentUsername} hat ${list.length} Ticket(s) zurückgeholt:\n` + list.map(t => `${t.ticketNumber || t.id} „${t.title}“ · Status: ${Lang.status(t.status)}`).join('\n');
            await Store.addNotifications([fromUser], { id: null }, message, null, 'absence');
        }
        await Notifications.refresh();
        if (ticketIds.length) UI.toast(`${ticketIds.length} Ticket(s) zurückgeholt.`);
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
                    <h3>${Icon('plane', 20)}Abwesenheit beendet – Tickets zurückholen?</h3>
                </div>
                <div class="modal-body">
                    <p class="hint">Diese Tickets lagen während deiner Abwesenheit bei deiner Vertretung. Wähle aus, welche du zurückholen möchtest.</p>
                    <div class="checkbox-list">${tickets.map(t => {
                        const owner = users.find(u => u.username === t.owner);
                        return `<label class="check-row"><input type="checkbox" value="${Utils.esc(t.id)}" checked>
                            <span class="check-text"><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span>Status: ${Utils.esc(Lang.status(t.status))} · Aktuell bei: ${Utils.esc(owner?.name || t.owner || 'niemandem')}</span></span>
                        </label>`;
                    }).join('')}</div>
                </div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-secondary" id="arp-keep">Nicht zurückholen</button>
                    <button class="btn-primary" id="arp-return">${Icon('undo-2', 16)}Ausgewählte zurückholen</button>
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
        const period = absence.fromMs && absence.untilMs ? `von ${fmt(absence.fromMs)} bis ${fmt(absence.untilMs)}`
            : absence.untilMs ? `bis ${fmt(absence.untilMs)}`
            : absence.fromMs ? `ab ${fmt(absence.fromMs)}, unbefristet`
            : 'unbefristet';
        const visibility = absence.visible ? 'für andere Admins sichtbar' : 'nur für dich sichtbar';
        return `${period} · ${visibility}`;
    },

    // Wird eine abwesende Person einem Ticket zugewiesen/markiert, bekommen sowohl sie als auch ihre
    // Vertretung sofort einen Hinweis, damit nichts liegen bleibt, bis die Person zurück ist.
    notifyIfAbsentAssignee: async (ticket, username, actorUsername) => {
        if (!username || username === actorUsername) return;
        const users = await Store.getUsers();
        const person = users.find(u => u.username === username);
        if (!person?.absence?.active) return false;
        UI.toast(`${person.name || person.username} ist aktuell abwesend${person.absence.substitute ? ' – Vertretung: ' + (users.find(u => u.username === person.absence.substitute)?.name || person.absence.substitute) : ' – keine Vertretung hinterlegt'}.`);
        await Store.addNotifications([username], ticket, `Dir wurde ein Ticket zugewiesen, während du als abwesend markiert bist: ${ticket.title}`, actorUsername, 'newTicket');
        if (person.absence.substitute) {
            await Store.addNotifications([person.absence.substitute], ticket, `${person.name || person.username} ist abwesend und hat ein neues Ticket bekommen – bitte übernehmen: ${ticket.title}`, actorUsername, 'newTicket');
        }
        await Notifications.refresh();
        return true;
    },

    // Frühere, granulare Einzelrechte (user.permissions.kb/.textBlocks/...) gibt es im aktuellen
    // Rollenmodell nicht mehr (bewusst entfernt, siehe README "Daten Und Funktionen") -- jede
    // Admin- oder Superadmin-Person darf diese Bereiche sehen, wie bei praktisch jeder anderen
    // Admin-Funktion in diesem Board auch. Vorher prüfte dies ein nie existierendes
    // user.permissions-Objekt, wodurch normale Admins (nicht Superadmin) diese Buttons nie sahen.
    can: (user) => !!user && (user.role === 'admin' || user.role === 'superadmin'),

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
                        ${onSave ? `<button class="btn-ghost btn-icon" data-dialog-save title="Speichern" aria-label="Speichern">${Icon('save', 16)}</button>` : ''}
                        <button class="btn-ghost btn-icon" data-dialog-close title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
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
        btn.title = 'Textbaustein einfügen';
        btn.setAttribute('aria-label', 'Textbaustein einfügen');
        btn.innerHTML = Icon('message-square-plus', 16);
        btn.onclick = () => AdminBoard.pickTextBlock('#m-chat-input');
        link.before(btn);
        if (window.lucide) lucide.createIcons();
    },

    openTextBlocks: async () => {
        const modal = AdminBoard.openDialog({
            id: 'textblocks-modal',
            title: 'Textbausteine',
            icon: 'message-square-plus',
            size: 'md',
            body: `
                <div id="tb-list"></div>
                <div class="field"><label for="tb-title">Titel</label><input id="tb-title" type="text" placeholder="z. B. Rückfrage Gerätetyp"></div>
                <div class="field"><label for="tb-text">Text</label><textarea id="tb-text" rows="4" placeholder="Der Text, der im Chat eingefügt wird"></textarea></div>
                <div class="setting-row"><span class="hint">Die Bausteine stehen im Chat über das Symbol neben den Formatierungsoptionen bereit.</span>
                    <button class="btn-primary btn-sm" id="tb-add" type="button">${Icon('plus', 15)}Hinzufügen</button>
                </div>`
        });
        const render = async () => {
            const list = await Store.getTextBlocks();
            modal.querySelector('#tb-list').innerHTML = list.length ? list.map(b => `
                <div class="absence-overview-row">
                    <div><strong>${Utils.esc(b.title)}</strong><span class="hint">${Utils.esc(b.text)}</span></div>
                    <button class="btn-ghost btn-icon btn-danger tb-del" type="button" data-id="${Utils.esc(b.id)}" title="Löschen" aria-label="Löschen">${Icon('trash-2', 16)}</button>
                </div>`).join('') : '<div class="empty-state compact">Noch keine Textbausteine.</div>';
            modal.querySelectorAll('.tb-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteTextBlock(btn.dataset.id);
                await render();
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#tb-add').onclick = async () => {
            const title = modal.querySelector('#tb-title').value.trim();
            const text = modal.querySelector('#tb-text').value.trim();
            if (!title || !text) return UI.toast('Bitte Titel und Text eingeben.');
            if (!(await Store.createTextBlock(title, text))) return UI.toast('Speichern fehlgeschlagen.');
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
            title: 'Textbaustein einfügen',
            icon: 'message-square',
            size: 'sm',
            body: list.length ? `${list.length > 5 ? '<input type="search" id="tb-pick-search" class="section-search" placeholder="Textbaustein suchen...">' : ''}<div class="checkbox-list" id="tb-pick-list">${list.map(b => `
                <button type="button" class="btn-secondary tb-pick" data-id="${Utils.esc(b.id)}" data-search="${Utils.esc(`${b.title} ${b.text}`.toLowerCase())}" style="justify-content:flex-start;width:100%">${Utils.esc(b.title)}</button>`).join('')}</div>`
                : '<div class="empty-state compact">Noch keine Textbausteine. Lege sie unter Verwaltung → Textbausteine an.</div>'
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
            const actor = await Store.currentUser();
            const rangeLabel = modal.querySelector('#rep-range').selectedOptions[0]?.textContent || '';
            UI.printHTML(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Auswertung</title>
                <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px}h4{margin:20px 0 8px;font-size:13px;text-transform:uppercase;color:#555}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;border-bottom:1px solid #ccc;padding-bottom:12px}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain}
                .print-head h1{font-size:20px;margin:0 0 4px}
                .print-head .meta{color:#555;font-size:12px}
                .report-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.report-kpi{border:1px solid #ccc;border-radius:6px;padding:10px}
                .report-kpi span{display:block;font-size:11px;color:#555}.report-kpi strong{font-size:18px}
                table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
                .report-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:13px}</style></head>
                <body>
                <div class="print-head">
                    <div>
                        <h1>${Utils.esc(company.name || 'Support Portal')} · Auswertung</h1>
                        <div class="meta">Zeitraum: ${Utils.esc(rangeLabel)} &middot; Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))}</div>
                    </div>
                    ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}
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
            const firstResponse = t => {
                const times = [...(t.chat || []).filter(c => c.role !== 'user'), ...(t.comments || [])].map(c => new Date(c.date).getTime()).sort((a, b) => a - b);
                return times.length ? times[0] - new Date(t.createdAt).getTime() : null;
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
                personal = `<h4 class="section-title">Pro Mitarbeiter</h4><table class="list-view-table"><thead><tr><th>Name</th><th>Tickets (Verantwortlich)</th><th>Geschlossen</th><th>Ø Erstreaktion</th></tr></thead><tbody>${admins.map(a => {
                    const owned = created.filter(t => t.owner === a.username);
                    const ownedClosed = closed.filter(x => x.t.owner === a.username).length;
                    const responseTimes = owned.map(firstResponse).filter(v => v != null);
                    return `<tr><td>${Utils.esc(a.name || a.username)}</td><td>${owned.length}</td><td>${ownedClosed}</td><td>${fmtDuration(avg(responseTimes))}</td></tr>`;
                }).join('')}</tbody></table>`;
            }
            const kpi = (label, value) => `<div class="report-kpi"><span>${Utils.esc(label)}</span><strong>${Utils.esc(String(value))}</strong></div>`;
            modal.querySelector('#rep-body').innerHTML = `
                <div class="report-kpis">
                    ${kpi('Tickets erstellt', created.length)}
                    ${kpi('Geschlossen', closed.length)}
                    ${kpi('Ø Erstreaktion', fmtDuration(avg(responses)))}
                    ${kpi('Ø Lösungszeit', fmtDuration(avg(resolutions)))}
                    ${kpi('Fristen eingehalten', dueMet == null ? '–' : dueMet + ' %')}
                </div>
                <h4 class="section-title">Nach Status</h4>
                <div class="report-list">${Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="report-row"><span>${Utils.esc(Lang.status(k))}</span><strong>${v}</strong></div>`).join('') || '<div class="empty-state compact">Keine Daten.</div>'}</div>
                <h4 class="section-title">Nach Kategorie</h4>
                <div class="report-list">${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="report-row"><span>${Utils.esc(k)}</span><strong>${v}</strong></div>`).join('') || '<div class="empty-state compact">Keine Daten.</div>'}</div>
                ${personal}`;
        };
        modal.querySelector('#rep-range').onchange = render;
        await render();
    },

    openKnowledgeBase: async () => {
        const user = await Store.currentUser();
        // Server erlaubt Schreiben über /api/v2/kb/articles jedem Admin/Superadmin (requireAdmin) --
        // nicht nur Superadmin, wie das alte, nie durchgesetzte permissions.kb-Flag es vorsah.
        const canEdit = user?.role === 'admin' || user?.role === 'superadmin';
        const modal = AdminBoard.openDialog({
            id: 'kb-modal',
            title: 'Wissensdatenbank',
            icon: 'book-open',
            size: 'md',
            body: `<input type="search" id="kb-search" class="section-search" placeholder="Artikel durchsuchen...">
                   <div id="kb-list" style="margin-top:var(--space-3)"></div>
                   ${canEdit ? `<div class="kb-editor">
                       <h4 class="section-title">Neuer Artikel</h4>
                       <div class="field"><label for="kb-new-title">Titel</label><input id="kb-new-title" type="text"></div>
                       <div class="field">
                           <label for="kb-new-body">Inhalt</label>
                           <div class="note-toolbar">
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-bold" title="Fett" aria-label="Fett">${Icon('bold', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-italic" title="Kursiv" aria-label="Kursiv">${Icon('italic', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-list" title="Liste" aria-label="Liste">${Icon('list', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-numbered" title="Nummerierte Liste" aria-label="Nummerierte Liste">${Icon('list-ordered', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-table" title="Tabelle einfügen" aria-label="Tabelle einfügen">${Icon('table', 15)}</button>
                               <button type="button" class="btn-ghost btn-icon btn-sm" id="kb-fmt-link" title="Link einfügen" aria-label="Link einfügen">${Icon('link', 15)}</button>
                           </div>
                           <div id="kb-new-body" class="rich-editor" contenteditable="true" data-placeholder="Schreibe wie in einem Textverarbeitungsprogramm: Formatierungen, Listen und Tabellen direkt bearbeiten."></div>
                       </div>
                   </div>` : ''}`,
            onSave: canEdit ? async (m) => {
                const title = m.querySelector('#kb-new-title').value.trim();
                const bodyEl = m.querySelector('#kb-new-body');
                const body = Utils.sanitizeRichHtml(bodyEl.innerHTML);
                if (!title || !bodyEl.textContent.trim()) return UI.toast('Bitte Titel und Inhalt eingeben.');
                if (!(await Store.createKbArticle(title, body))) return UI.toast('Speichern fehlgeschlagen.');
                m.querySelector('#kb-new-title').value = '';
                bodyEl.innerHTML = '';
                UI.toast('Artikel gespeichert.');
                await render();
            } : null
        });
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
                const href = await UI.promptText({ title: 'Link einfügen', label: 'Link-Adresse', value: '', placeholder: 'https://example.com oder mailto:name@example.com', saveLabel: 'Link einfügen' });
                if (!href || !href.trim()) return;
                if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) return UI.toast('Nur http-, https- und mailto-Links sind erlaubt.');
                bodyInput.focus();
                const sel2 = window.getSelection();
                sel2.removeAllRanges();
                if (savedRange) sel2.addRange(savedRange);
                if (selectedText) document.execCommand('createLink', false, href.trim());
                else document.execCommand('insertHTML', false, `<a href="${Utils.esc(href.trim())}" target="_blank" rel="noopener noreferrer">${Utils.esc(href.trim())}</a>`);
                bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
            };
        }
        const render = async () => {
            const term = modal.querySelector('#kb-search').value.toLowerCase().trim();
            const articles = (await Store.getKbArticles()).filter(a => !term || `${a.title} ${a.body}`.toLowerCase().includes(term));
            modal.querySelector('#kb-list').innerHTML = articles.length ? articles.map(a => `
                <details class="kb-article">
                    <summary><strong>${Utils.esc(a.title)}</strong> <span class="hint">${Utils.esc(a.source || '')} · ${Utils.fmtDate(a.createdAt)}</span></summary>
                    <div class="desc-text rich-content">${a.body}</div>
                    ${canEdit ? `<button class="btn-ghost btn-sm kb-del" type="button" data-id="${Utils.esc(a.id)}">${Icon('trash-2', 14)}Löschen</button>` : ''}
                </details>`).join('') : '<div class="empty-state compact">Keine Artikel gefunden.</div>';
            modal.querySelectorAll('.kb-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteKbArticle(btn.dataset.id);
                await render();
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#kb-search').oninput = render;
        await render();
    },

    addSolutionToKnowledgeBase: async (t) => {
        const solution = (t.comments || []).filter(c => (c.channel || 'solution') === 'solution');
        if (!solution.length) return UI.toast('Es gibt noch keinen Lösungsweg in diesem Ticket.');
        const title = await UI.promptText({ title: 'Wissensartikel', label: 'Titel des Artikels', value: t.title, saveLabel: 'Speichern' });
        if (!title || !title.trim()) return;
        const body = solution.map(c => `${c.text || ''}`).join('\n\n');
        if (!(await Store.createKbArticle(title.trim(), body, t.id))) return UI.toast('Speichern fehlgeschlagen.');
        UI.toast('Als Wissensartikel gespeichert.');
    },

    // Ausführung läuft serverseitig per Timer (jobs/maintenance.ts runRecurringTickets),
    // next_run_at wird dort nach jedem Lauf automatisch weitergerechnet -- kein Client-Trigger
    // und kein "Tag im Monat/Wochentag"-Modell mehr, sondern ein konkreter Start-Zeitpunkt.
    openRecurring: async () => {
        const settings = await Store.getSettings();
        const categories = settings.categories || ['Allgemein'];
        const modal = AdminBoard.openDialog({
            id: 'recurring-modal',
            title: 'Wiederkehrende Tickets',
            icon: 'repeat',
            size: 'md',
            body: `
                <div id="rec-list"></div>
                <div class="field"><label for="rec-title">Betreff</label><input id="rec-title" type="text" placeholder="z. B. Backup prüfen"></div>
                <div class="field"><label for="rec-desc">Beschreibung</label><textarea id="rec-desc" rows="3"></textarea></div>
                <div class="form-grid">
                    <div class="field"><label for="rec-cat">Kategorie</label><select id="rec-cat">${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}</select></div>
                    <div class="field"><label for="rec-prio">Priorität</label><select id="rec-prio"><option>Niedrig</option><option selected>Normal</option><option>Hoch</option><option>Kritisch</option></select></div>
                    <div class="field"><label for="rec-interval">Einheit</label><select id="rec-interval"><option value="day">Tag(e)</option><option value="week" selected>Woche(n)</option><option value="month">Monat(e)</option></select></div>
                    <div class="field"><label for="rec-count">Alle wie viele Einheiten</label><input id="rec-count" type="number" min="1" value="1"></div>
                </div>
                <div class="field"><label>Erste Ausführung</label>${UI.dateTimePickerMarkup('rec-next-run')}</div>
                <div class="setting-row"><span class="hint">Das erste Ticket wird zum gewählten Zeitpunkt automatisch angelegt, danach jeweils im gewählten Abstand.</span>
                    <button class="btn-primary btn-sm" id="rec-add" type="button">${Icon('plus', 15)}Hinzufügen</button>
                </div>`
        });
        let recNextRunMs = Date.now();
        UI.createDateTimePicker(modal.querySelector('#rec-next-run'), { onChange: (ms) => { recNextRunMs = ms; } });
        const unitLabel = { day: 'Tag(e)', week: 'Woche(n)', month: 'Monat(e)' };
        const render = async () => {
            const list = await Store.getRecurringRules();
            modal.querySelector('#rec-list').innerHTML = list.length ? list.map(r => `
                <div class="absence-overview-row">
                    <div><strong>${Utils.esc(r.title)}</strong><span class="hint">Alle ${r.intervalCount} ${unitLabel[r.intervalUnit] || r.intervalUnit} · nächste Ausführung ${Utils.fmtDate(r.nextRunAt)} · ${Utils.esc(r.category || '-')} · ${Utils.esc(r.prio)}${r.active ? '' : ' · pausiert'}</span></div>
                    <button class="btn-ghost btn-icon btn-danger rec-del" type="button" data-id="${Utils.esc(r.id)}" title="Löschen" aria-label="Löschen">${Icon('trash-2', 16)}</button>
                </div>`).join('') : '<div class="empty-state compact">Keine wiederkehrenden Tickets.</div>';
            modal.querySelectorAll('.rec-del').forEach(btn => btn.onclick = async () => {
                await Store.deleteRecurringRule(btn.dataset.id);
                await render();
            });
            if (window.lucide) lucide.createIcons();
        };
        modal.querySelector('#rec-add').onclick = async () => {
            const title = modal.querySelector('#rec-title').value.trim();
            if (!title) return UI.toast('Bitte einen Betreff eingeben.');
            const ok = await Store.createRecurringRule({
                title,
                desc: modal.querySelector('#rec-desc').value.trim(),
                category: modal.querySelector('#rec-cat').value,
                prio: modal.querySelector('#rec-prio').value,
                intervalUnit: modal.querySelector('#rec-interval').value,
                intervalCount: Math.max(1, parseInt(modal.querySelector('#rec-count').value, 10) || 1),
                nextRunAt: new Date(recNextRunMs).toISOString()
            });
            if (!ok) return UI.toast('Speichern fehlgeschlagen.');
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
    // Entscheidung läuft direkt über den dedizierten Endpunkt, der auch die Prüfer-Autorisierung
    // (IDOR-Schutz: nur die eingetragene Person oder Superadmin) serverseitig durchsetzt.
    decideApproval: async (ticketId, status, reason) => {
        const res = await fetch(`/api/v2/tickets/${encodeURIComponent(ticketId)}/approval-decision`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ decision: status, reason: reason || undefined })
        }).catch(() => null);
        if (!res || !res.ok) {
            UI.toast(res && res.status === 403 ? 'Keine Berechtigung für diese Entscheidung.' : 'Entscheidung fehlgeschlagen.');
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
        const modal = AdminBoard.openDialog({ id: 'approvals-modal', title: 'Genehmigungen', icon: 'badge-check', size: 'lg', body: '<div id="apr-list"></div>' });
        const render = async () => {
            const tickets = (await Store.getTickets()).filter(t => (t.approvals || []).some(a => isPendingApprover(a, me.id)));
            const box = modal.querySelector('#apr-list');
            box.innerHTML = tickets.length ? tickets.map(t => {
                const a = t.approvals.find(x => isPendingApprover(x, me.id));
                const fields = Store.getCustomFieldsForCategories(t.category, settings.customFields || {});
                return `<details class="kb-article apr-row" open data-id="${Utils.esc(t.id)}">
                    <summary>
                        <strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong>
                        <span class="hint">Angefragt von ${Utils.esc(a.requestedByName)}${a.reason ? ' · ' + Utils.esc(a.reason) : ''}</span>
                    </summary>
                    <div class="meta-grid">
                        <div class="meta-item"><strong>Priorität</strong><span class="meta-value">${Utils.esc(t.prio)}</span></div>
                        <div class="meta-item"><strong>Kategorie</strong><span class="meta-value">${Utils.esc((t.category || []).join(', ') || '-')}</span></div>
                    </div>
                    <h4 class="section-title">Beschreibung</h4>
                    <p class="desc-text">${Utils.esc(t.desc || '-')}</p>
                    ${fields.length ? `<div class="apr-fields"></div>` : ''}
                    <div class="apr-attachments"></div>
                    <div class="aa-actions">
                        <button class="btn-secondary btn-sm apr-open" type="button">${Icon('external-link', 14)}Ticket öffnen</button>
                        <button class="btn-primary btn-sm apr-yes" type="button">${Icon('check', 14)}Freigeben</button>
                        <button class="btn-secondary btn-sm btn-danger apr-no" type="button">${Icon('x', 14)}Ablehnen</button>
                    </div></details>`;
            }).join('') : '<div class="empty-state compact">Keine offenen Genehmigungen. Hier erscheinen Anfragen, die deine Zustimmung brauchen.</div>';
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
                row.querySelector('.apr-yes').onclick = () => decide('approved');
                row.querySelector('.apr-no').onclick = async () => {
                    const reason = await UI.promptText({ title: 'Genehmigung ablehnen', label: 'Warum lehnst du diese Anfrage ab? Die Begründung sieht die antragstellende Person.', saveLabel: 'Ablehnen' });
                    if (!reason || !reason.trim()) return UI.toast('Bitte eine Begründung angeben.');
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
        if (!approvers.length) return UI.toast('Keine weiteren Personen zum Genehmigen vorhanden.');
        const modal = AdminBoard.openDialog({
            id: 'approval-request-modal',
            title: 'Genehmigung anfordern',
            icon: 'badge-check',
            size: 'sm',
            body: `<div class="field"><label>Genehmigende Person</label><div id="apr-approver"></div></div>
                   <div class="field"><label for="apr-note">Hinweis</label><textarea id="apr-note" rows="3" placeholder="Was soll genehmigt werden?"></textarea></div>`,
            onSave: async (m) => {
                const approverId = approverPicker.getValue();
                const note = m.querySelector('#apr-note').value.trim();
                if (!approverId) return UI.toast('Bitte eine genehmigende Person wählen.');
                const res = await fetch(`/api/v2/tickets/${encodeURIComponent(t.id)}/request-approval`, {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ approver_user_id: approverId, text: note || undefined })
                }).catch(() => null);
                if (!res || !res.ok) return UI.toast('Genehmigung anfordern fehlgeschlagen.');
                Store._ticketsCache = null;
                await Notifications.refresh();
                m.remove();
                UI.toast('Genehmigung angefordert.');
                await AdminBoard.openModal(t.id);
                await AdminBoard.render();
            }
        });
        const owner = (await Store.getUsers()).find(u => u.username === t.author);
        const preselect = (owner?.supervisor && approvers.some(u => u.username === owner.supervisor))
            ? approvers.find(u => u.username === owner.supervisor)?.id
            : (approvers[0]?.id || '');
        const approverPicker = UI.createMultiSelect(modal.querySelector('#apr-approver'), approvers.map(u => ({ value: u.id, label: u.name || u.username })), preselect, null, { single: true, emptyLabel: 'Bitte wählen...' });
        return modal;
    },

    linkRelatedTicket: async (t) => {
        const all = await Store.getTickets();
        const existingRelatedIds = await Store.getRelatedTicketIds(t.id);
        const modal = AdminBoard.openDialog({
            id: 'related-modal',
            title: 'Verwandtes Ticket verknüpfen',
            icon: 'link',
            size: 'md',
            body: `<input type="search" id="rel-search" class="section-search" placeholder="Ticket-Nr oder Titel suchen...">
                   <label class="check-row compact" style="margin-top:var(--space-2)"><input type="checkbox" id="rel-show-archived"><span>Auch geschlossene/archivierte Tickets anzeigen</span></label>
                   <div class="checkbox-list" id="rel-list" style="margin-top:var(--space-3)"></div>`,
            onSave: async (m) => {
                const ids = [...m.querySelectorAll('input[type="checkbox"].rel-pick:checked')].map(cb => cb.value);
                if (!ids.length) return UI.toast('Bitte mindestens ein Ticket auswählen.');
                const results = await Promise.all(ids.map(id => Store.linkRelatedTicketIds(t.id, id)));
                m.remove();
                UI.toast(results.every(Boolean) ? 'Verknüpft.' : 'Verknüpfen teilweise fehlgeschlagen.');
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
            title: 'Ticket zusammenführen',
            icon: 'git-merge',
            size: 'md',
            body: `<p class="hint">Chat, Notizen, Teilaufgaben, Zeiten, Anhänge und Beteiligte von <strong>${Utils.esc(t.ticketNumber || t.id)}</strong> werden in das gewählte Ticket übernommen. Das Ursprungsticket wird archiviert.</p>
                   <label class="check-row compact"><input type="checkbox" id="merge-show-archived"><span>Auch geschlossene/archivierte Tickets anzeigen</span></label>
                   <div class="field"><label>Zielticket</label><div id="merge-target"></div></div>`,
            onSave: async (m) => {
                const targetId = mergeTargetPicker.getValue();
                if (!targetId) return UI.toast('Bitte ein Zielticket wählen.');
                if (!(await Store.mergeTickets(t.id, targetId))) return UI.toast('Zusammenführen fehlgeschlagen.');
                m.remove();
                UI.toast('Tickets zusammengeführt.');
                await AdminBoard.render();
            }
        });
        let mergeTargetPicker;
        const renderTargetPicker = () => {
            const showArchived = modal.querySelector('#merge-show-archived').checked;
            const candidates = all.filter(x => x.id !== t.id && (showArchived || !x.archived));
            const current = mergeTargetPicker?.getValue();
            mergeTargetPicker = UI.createMultiSelect(modal.querySelector('#merge-target'), candidates.map(x => ({ value: x.id, label: `${x.ticketNumber || x.id} · ${x.title}${x.archived ? ' (archiviert)' : ''}` })), current && candidates.some(c => c.id === current) ? current : '', null, { single: true, emptyLabel: 'Bitte wählen...' });
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
        const pending = all.filter(n => n.recipient === user.username && n.type === 'absence' && !n.read);
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
                    <h3>${Icon('archive', 18)}Ticket-Ersteller archiviert</h3>
                </div>
                <div class="modal-body" id="aa-body"></div>
            </div>`;
        document.body.appendChild(modal);
        const body = modal.querySelector('#aa-body');
        body.innerHTML = `<p class="hint">Der Ersteller dieser Tickets wurde archiviert und kann nicht mehr antworten. Entscheide je Ticket, wie es weitergeht.</p>` + open.map(t => {
            const author = users.find(u => u.username === t.author);
            return `
                <div class="absence-overview-row aa-row" data-id="${Utils.esc(t.id)}">
                    <div><strong>${Utils.esc(t.ticketNumber || t.id)} · ${Utils.esc(t.title)}</strong><span class="hint">Ersteller: ${Utils.esc(author?.name || t.author)}</span></div>
                    <div class="aa-actions">
                        <select class="aa-assign"><option value="">Zuordnen an…</option>${admins.map(a => `<option value="${Utils.esc(a.username)}">${Utils.esc(a.name || a.username)}</option>`).join('')}</select>
                        <button class="btn-secondary btn-sm aa-assign-btn" type="button">Zuordnen</button>
                        <button class="btn-secondary btn-sm aa-keep" type="button">Weiter bearbeiten</button>
                        <button class="btn-secondary btn-sm aa-archive" type="button">Archivieren</button>
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
                if (!newOwner) return UI.toast('Bitte einen Benutzer auswählen.');
                updateTicket(id, t => {
                    t.owner = newOwner;
                    t.ownerUserId = admins.find(a => a.username === newOwner)?.id || null;
                }, `Ticket nach Archivierung des Erstellers neu zugeordnet an ${newOwner}`);
            };
            row.querySelector('.aa-keep').onclick = () => updateTicket(id, t => { t.archivedAuthorAck = true; }, 'Ticket nach Archivierung des Erstellers weiter bearbeitet (Ersteller kann nicht antworten)');
            row.querySelector('.aa-archive').onclick = () => UI.confirm('Ticket archivieren?', () => updateTicket(id, t => { t.archived = true; }, 'Ticket nach Archivierung des Erstellers archiviert'));
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
                <strong>${Icon('plane', 14)}Du bist als abwesend markiert</strong>
                <span>Vertretung: ${sub ? Utils.esc(sub.name || sub.username) : 'keine – Tickets liegen im Team'}</span>
                <span>${Utils.esc(AdminBoard.absenceInfoText(me.absence))}</span>
            </div>
            <button class="btn-secondary btn-sm" id="absence-banner-end">Abwesenheit beenden</button>`;
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
        modal.querySelector('.modal-header h3').textContent = 'Abwesenheiten';
        modal.querySelector('#generic-save-head')?.remove();
        modal.querySelector('.modal-body').innerHTML = absent.length ? absent.map(u => {
            const sub = u.absence.substitute ? users.find(x => x.username === u.absence.substitute) : null;
            return `<div class="absence-overview-row"><div><strong>${Utils.esc(u.name || u.username)}</strong><span class="hint">${Utils.esc(AdminBoard.absenceInfoText(u.absence))}</span></div><span>Vertretung: ${sub ? Utils.esc(sub.name || sub.username) : 'keine – Team'}</span></div>`;
        }).join('') : '<div class="empty-state compact">Aktuell ist niemand abwesend.</div>';
        modal.querySelector('.modal-body').insertAdjacentHTML('beforeend', `
            <div class="setting-row" style="margin-top:var(--space-3);">
                <button type="button" class="btn-primary btn-sm" id="abs-overview-own">${Icon('plane', 15)}Meine Abwesenheit einstellen</button>
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
            lines.push(`Als Hauptverantwortlicher übernommen (${transferred.length}): ` + transferred.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
        }
        if (addedAsParticipant.length) {
            lines.push(`Als Beteiligter hinzugefügt (${addedAsParticipant.length}): ` + addedAsParticipant.map(t => `${t.ticketNumber || t.id} ${t.title}`).join('; '));
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
                        <h3>${Icon('plus', 18)}Neues Ticket anlegen</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field field-wide">
                            <label for="act-on-behalf-search">Im Namen von</label>
                            <input type="text" id="act-on-behalf-search" placeholder="Nach Namen oder Benutzername suchen...">
                            <div id="act-on-behalf-list" class="user-picker-list"></div>
                            <p class="hint">Person nicht dabei? Lege sie zuerst in der Benutzerverwaltung an.</p>
                        </div>
                        <div class="field field-wide">
                            <label for="act-title">Betreff</label>
                            <input id="act-title" type="text" placeholder="Kurzer Titel">
                        </div>
                        <div class="field field-wide">
                            <label for="act-desc">Beschreibung</label>
                            <textarea id="act-desc" rows="6" placeholder="Worum geht es?"></textarea>
                        </div>
                        <div class="field">
                            <label for="act-prio">Priorität</label>
                            <select id="act-prio">
                                <option value="Niedrig">Niedrig</option>
                                <option value="Normal">Normal</option>
                                <option value="Hoch">Hoch</option>
                                <option value="Kritisch">Kritisch</option>
                            </select>
                        </div>
                        <div class="field">
                            <label>Kategorie</label>
                            <div id="act-cat-container"></div>
                        </div>
                        <div id="act-custom-fields" class="field-wide custom-fields-fill"></div>
                        <div class="field field-wide">
                            <label>Anhänge</label>
                            <label for="act-files" class="dropzone" id="act-files-dropzone">
                                <i data-lucide="upload-cloud"></i>
                                <span class="dropzone-text"><strong>Dateien hierher ziehen</strong> oder klicken zum Auswählen</span>
                                <input id="act-files" type="file" multiple>
                            </label>
                            <div id="act-files-preview" class="file-preview"></div>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="act-cancel">Abbrechen</button>
                        <button class="btn-primary" id="act-submit">${Icon('plus', 16)}Ticket anlegen</button>
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
                    <span class="user-picker-meta">${Utils.esc(u.username)} · ${u.role === 'user' ? 'Benutzer' : 'Admin'}</span>
                </div>`).join('') : '<div class="empty-state compact">Keine Treffer.</div>';
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
                chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="Entfernen" aria-label="${Utils.esc(file.name)} entfernen">${Icon('x', 13)}</button>`;
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
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#act-custom-fields'));
            if (missingFields.length) return UI.toast(`Bitte Pflichtfeld${missingFields.length > 1 ? 'er' : ''} ausfüllen: ${missingFields.join(', ')}`);
            const onBehalfUser = users.find(u => u.username === selectedBehalfUsername);
            if (!onBehalfUser) return UI.toast('Bitte eine Person auswählen.');
            if (AdminBoard.createTicketFiles.some(file => file.size > 15 * 1024 * 1024)) {
                UI.toast('Anhänge dürfen maximal 15 MB groß sein.');
                return;
            }
            const cat = AdminBoard.createTicketCategoryInstance.getValue();
            const category = cat.length ? cat : ['Allgemein'];
            const newTicket = await Store.createTicket({
                title, desc, prio: q('#act-prio').value, category,
                onBehalfOfUserId: onBehalfUser.id, customFieldValues
            });
            if (!newTicket) {
                UI.toast('Ticket konnte nicht erstellt werden.');
                return;
            }
            if (AdminBoard.createTicketFiles.length) {
                try {
                    await Promise.all(AdminBoard.createTicketFiles.map(file => Store.saveAttachment(file, { ticketId: newTicket.id })));
                } catch (error) {
                    console.error(error);
                    UI.toast('Ticket wurde angelegt, aber Anhänge konnten nicht gespeichert werden.');
                }
            }
            Store._ticketsCache = null;
            modal.classList.remove('open');
            UI.toast('Ticket wurde angelegt.');
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
                <input id="incident-title" type="text" placeholder="z. B. VPN-Störung">
            </div>
            <div class="field">
                <label>${Lang.t('incidentNotice')}</label>
                <textarea id="incident-notice" rows="4" placeholder="Kurze Beschreibung der Störung und was betroffen ist."></textarea>
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
                    <label>Kategorie</label>
                    <select id="incident-category">
                        ${categories.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        saveBtn.textContent = 'Störung erstellen';
        saveBtn.onclick = async () => {
            const title = q('#incident-title').value.trim();
            const notice = q('#incident-notice').value.trim();
            if (!title) return UI.toast('Bitte einen Titel angeben.');
            if (!notice) return UI.toast('Bitte einen sichtbaren Hinweis eintragen.');
            const tickets = await Store.getTickets();
            const category = [q('#incident-category').value || 'Allgemein'];
            let ticketNumberData;
            try {
                ticketNumberData = Store.nextTicketNumber(tickets, category, settings);
            } catch {
                return UI.toast('Ticketnummernformat ungültig: Das Format muss {number} enthalten.');
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
            UI.toast('Störung wurde erstellt.');
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
                        <button type="button" class="btn-ghost btn-icon" id="custom-due-calendar-btn" title="Kalender öffnen" aria-label="Kalender öffnen">${Icon('calendar', 16)}</button>
                    </div>
                </div>
                <div class="field">
                    <label>${Lang.t('time')}</label>
                    <input id="custom-due-time" type="text" inputmode="numeric" placeholder="17:00" value="${initialDate ? Utils.fmtTimeOnly(initialDate) : '17:00'}">
                </div>
            </div>
            <div id="custom-due-dtp-host" style="display:none;">${UI.dateTimePickerMarkup('custom-due-dtp')}</div>
            <p class="hint">${t.customDueAt ? 'Diese Frist wurde manuell gesetzt und ersetzt die automatische Berechnung.' : 'Standardmäßig wird die Frist aus Priorität und Geschäftszeiten berechnet. Hier kannst du sie für dieses Ticket überschreiben.'}</p>
            ${t.customDueAt ? `<button type="button" class="btn-secondary btn-sm" id="custom-due-reset">${Icon('rotate-ccw', 15)}Automatisch berechnen (zurücksetzen)</button>` : ''}
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
        modal.querySelector('.modal-footer .btn-primary').textContent = 'Speichern';
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
            if (!pickedMs) { UI.toast('Bitte ein Datum/Uhrzeit wählen.'); return; }
            t.customDueAt = new Date(pickedMs).toISOString();
            await Store.addLog(t, 'Eigene Frist gesetzt', Utils.fmtDate(t.customDueAt));
            await Store.saveTickets(tickets);
            modal.classList.remove('open');
            UI.toast('Frist gespeichert.');
            await AdminBoard.openModal(id);
            await AdminBoard.render();
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
            UI.confirm('Großstörung wirklich aufheben? Neue Tickets erhalten dann keinen Hinweis mehr auf diese Störung.', async () => {
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
        modal.querySelector('.modal-header h3').textContent = 'Als Störung markieren';
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label>Sichtbarer Hinweis für Benutzer</label>
                <textarea id="incident-existing-notice" rows="4">${Utils.esc(t.incidentNotice || t.title)}</textarea>
            </div>
            <p class="hint">Diese Störung wird Benutzern beim Erstellen eines Tickets angeboten.</p>
        `;
        modal.querySelector('.modal-footer .btn-primary').onclick = async () => {
            const notice = q('#incident-existing-notice').value.trim();
            if (!notice) return UI.toast('Bitte einen Hinweis eintragen.');
            const res = await fetch(`/api/v2/tickets/${encodeURIComponent(id)}`, {
                method: 'PATCH', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'incident', incident_notice: notice })
            }).catch(() => null);
            if (!res || !res.ok) return UI.toast('Als Störung markieren fehlgeschlagen.');
            modal.classList.remove('open');
            UI.toast('Als Störung markiert. Benutzer können Tickets damit verknüpfen.');
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
                body: JSON.stringify({ content: `Update zur bekannten Störung "${incidentTicket.title}": ${resolutionText || 'Die Störung wurde behoben.'}` })
            }).catch(() => {});
        }
        await Store.addGlobalLog('Großstörung behoben – verknüpfte Tickets informiert', `Haupt-Ticket: ${incidentTicket.title}, Betroffene Tickets: ${linked.length}`);
        UI.toast(`${linked.length} verknüpfte Ticket(s) wurden über die Lösung informiert.`);
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
                        <h3>${Icon('printer', 18)}Ticket drucken</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <p class="hint">Wähle aus, welche Inhalte mit ausgedruckt werden sollen.</p>
                        <div class="checkbox-list">
                            <label class="check-row"><input type="checkbox" id="pp-todos" checked>Teilaufgaben</label>
                            <label class="check-row"><input type="checkbox" id="pp-admin-chat" checked>Admin-Chat (intern)</label>
                            <label class="check-row"><input type="checkbox" id="pp-solution" checked>Lösungsweg (intern)</label>
                            <label class="check-row"><input type="checkbox" id="pp-chat" checked>Chat-Verlauf mit Benutzer</label>
                            <label class="check-row"><input type="checkbox" id="pp-time" checked>Zeiterfassung</label>
                            <label class="check-row"><input type="checkbox" id="pp-log">Ticket-Protokoll</label>
                        </div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="pp-cancel">Abbrechen</button>
                        <button class="btn-primary" id="pp-confirm">${Icon('printer', 16)}Drucken</button>
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
        const t = tickets.find(x => x.id === id);
        if (!t) return;
        const users = await Store.getUsers();
        const nameFor = (username) => {
            if (!username) return '-';
            const u = users.find(x => x.username === username);
            return u ? (u.name || u.username) : username;
        };
        const settings = await Store.getSettings();
        const company = settings.companyConfig || {};
        const actor = await Store.currentUser();
        const slaCountdown = Store.formatSlaCountdown(t, settings);
        const todos = opts.todos ? (t.todos || []).map(d => `<li>${d.done ? '☑' : '☐'} ${Utils.esc(d.title)}${d.assignee ? ' – ' + Utils.esc(nameFor(d.assignee)) : ''}${d.done && d.doneAt ? ` – erledigt am ${Utils.esc(Utils.fmtDate(d.doneAt))}` : ''}</li>`).join('') : '';
        const entryRow = (c) => `
            <div class="p-entry"><strong>${Utils.esc(c.author)}</strong> <span>${Utils.esc(Utils.fmtDate(c.date))}</span>
            <p>${Utils.esc(c.text || '')}</p></div>`;
        const adminChatEntries = opts.adminChat ? (t.comments || []).filter(c => (c.channel || 'solution') === 'admin-chat').map(entryRow).join('') : '';
        const solutionEntries = opts.solution ? (t.comments || []).filter(c => (c.channel || 'solution') === 'solution').map(entryRow).join('') : '';
        const chat = opts.chat ? (t.chat || []).map(entryRow).join('') : '';
        const logEntries = opts.log ? (t.logs || []).slice().reverse().map(l => `
            <div class="p-entry"><strong>${Utils.esc(l.user || '-')}</strong> <span>${Utils.esc(Utils.fmtDate(l.date))}</span>
            <p>${Utils.esc(l.action || '')}${l.details ? ' – ' + Utils.esc(l.details) : ''}</p></div>`).join('') : '';
        const fmtMinutesPrint = (mins) => mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)} Std.` : `${mins} Min.`;
        const totalMinutes = (t.timeEntries || []).reduce((sum, e) => sum + (e.minutes || 0), 0);
        const timeEntries = opts.time ? (t.timeEntries || []).map(e => `
            <div class="p-entry"><strong>${Utils.esc(nameFor(e.username))}</strong> <span>${Utils.esc(Utils.fmtDate(e.date))} – ${fmtMinutesPrint(e.minutes)}</span>
            ${e.note ? `<p>${Utils.esc(e.note)}</p>` : ''}</div>`).join('') : '';
        const participants = [...new Set([t.owner, ...(t.participants || [])].filter(Boolean))].map(nameFor).join(', ') || '-';
        const incidentOf = t.linkedIncidentId ? tickets.find(x => x.id === t.linkedIncidentId) : null;
        const linkedToIncident = t.isMajorIncident ? tickets.filter(x => x.linkedIncidentId === t.id && !x.archived) : [];
        const incidentSection = t.isMajorIncident ? `<h2>Großstörung</h2>
            <p class="desc">${Utils.esc(t.incidentNotice || '')}</p>
            <div class="grid"><div><strong>Zugeordnete Tickets</strong>${linkedToIncident.length}</div></div>
            ${linkedToIncident.length ? `<ul>${linkedToIncident.map(x => `<li>${Utils.esc(x.ticketNumber || x.id)} · ${Utils.esc(x.title)} – ${Utils.esc(nameFor(x.author) || x.author || '-')} – ${Utils.esc(x.status)}</li>`).join('')}</ul>` : '<p class="desc">Keine Tickets zugeordnet.</p>'}` : incidentOf ? `<h2>Großstörung</h2><p class="desc">Zugeordnet zu ${Utils.esc(incidentOf.ticketNumber || incidentOf.id)} · ${Utils.esc(incidentOf.title)}</p>` : '';
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${Utils.esc(t.ticketNumber || t.id)}</title>
            <style>
                body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;max-width:800px;margin:0 auto;}
                .print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
                .print-head img{max-height:48px;max-width:180px;object-fit:contain;}
                h1{font-size:20px;margin:0 0 4px;}
                .meta{color:#555;font-size:12px;margin-bottom:16px;}
                .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:16px;font-size:13px;}
                .grid div strong{display:block;font-size:11px;color:#555;text-transform:uppercase;}
                h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px;}
                .desc{white-space:pre-wrap;font-size:13px;}
                ul{padding-left:20px;font-size:13px;}
                .p-entry{border-bottom:1px solid #eee;padding:6px 0;font-size:12px;}
                .p-entry span{color:#777;margin-left:8px;}
                .p-entry p{margin:4px 0 0;white-space:pre-wrap;}
            </style></head><body>
            <div class="print-head">
                <div>
                    <h1>${Utils.esc(t.ticketNumber || t.id)} &middot; ${Utils.esc(t.title)}</h1>
                    <div class="meta">Gedruckt von ${Utils.esc(actor?.name || actor?.username || '-')} am ${Utils.esc(Utils.fmtDate(new Date().toISOString()))}</div>
                </div>
                ${company.logoUrl ? `<img src="${Utils.esc(company.logoUrl)}" alt="Logo">` : ''}
            </div>
            <div class="grid">
                <div><strong>Von</strong>${Utils.esc(nameFor(t.author) || t.author)}</div>
                <div><strong>Erstellt am</strong>${Utils.esc(Utils.fmtDate(t.createdAt))}</div>
                <div><strong>Status</strong>${Utils.esc(t.status)}</div>
                <div><strong>Priorität</strong>${Utils.esc(t.prio)}</div>
                <div><strong>Kategorie</strong>${Utils.esc((t.category || []).join(', ') || '-')}</div>
                <div><strong>Hauptverantwortlicher</strong>${Utils.esc(nameFor(t.owner))}</div>
                <div><strong>Beteiligte Personen</strong>${Utils.esc(participants)}</div>
                ${slaCountdown ? `<div><strong>Frist</strong>${Utils.esc(slaCountdown.label)} (${Utils.esc(slaCountdown.dueDateLabel)})</div>` : ''}
            </div>
            <h2>Beschreibung</h2>
            <p class="desc">${Utils.esc(t.desc || 'Keine Beschreibung')}</p>
            ${incidentSection}
            ${todos ?`<h2>Teilaufgaben</h2><ul>${todos}</ul>` : ''}
            ${adminChatEntries ? `<h2>Admin-Chat</h2>${adminChatEntries}` : ''}
            ${solutionEntries ? `<h2>Lösungsweg</h2>${solutionEntries}` : ''}
            ${chat ? `<h2>Chat-Verlauf</h2>${chat}` : ''}
            ${timeEntries ? `<h2>Zeiterfassung (gesamt: ${Utils.esc(fmtMinutesPrint(totalMinutes))})</h2>${timeEntries}` : ''}
            ${logEntries ? `<h2>Ticket-Protokoll</h2>${logEntries}` : ''}
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
            await AdminBoard.renderTicketAttachments(t, '#m-ticket-attachments');
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
                    const canDecideHere = isPendingApprover(pendingApproval, user.username);
                    if (approvalActions) approvalActions.hidden = !canDecideHere;
                    if (canDecideHere) {
                        q('#m-approval-yes').onclick = async () => {
                            if (await AdminBoard.decideApproval(t.id, 'approved')) {
                                UI.toast('Genehmigung erteilt.');
                                await AdminBoard.openModal(t.id);
                                await AdminBoard.render();
                            }
                        };
                        q('#m-approval-no').onclick = async () => {
                            const reason = await UI.promptText({ title: 'Genehmigung ablehnen', label: 'Warum lehnst du diese Anfrage ab? Die Begründung sieht die antragstellende Person.', saveLabel: 'Ablehnen' });
                            if (!reason || !reason.trim()) return UI.toast('Bitte eine Begründung angeben.');
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
                btnIncident.innerHTML = t.isMajorIncident ? `${Icon('siren', 16)}Großstörung aufheben` : `${Icon('siren', 16)}Als Großstörung markieren`;
                btnIncident.classList.toggle('btn-danger', !!t.isMajorIncident);
                btnIncident.onclick = () => AdminBoard.toggleMajorIncident(t.id);
            }

            const actionsRow = q('#ticket-modal .actions-row');
            if (actionsRow) {
                let extra = q('#m-extra-actions');
                if (!extra) {
                    extra = document.createElement('div');
                    extra.id = 'm-extra-actions';
                    extra.className = 'actions-row';
                    actionsRow.after(extra);
                }
                let related = q('#m-related');
                if (!related) {
                    related = document.createElement('div');
                    related.id = 'm-related';
                    related.className = 'incident-linked-list';
                    extra.after(related);
                }
                extra.innerHTML = t.archived ? '' : `
                    <button class="btn-secondary" id="m-link-related" type="button">${Icon('link', 16)}Verwandt verknüpfen</button>
                    <button class="btn-secondary" id="m-merge" type="button">${Icon('git-merge', 16)}Zusammenführen</button>
                    <button class="btn-secondary" id="m-request-approval" type="button">${Icon('badge-check', 16)}Genehmigung anfordern</button>
                    <button class="btn-secondary" id="m-kb-add" type="button">${Icon('book-open', 16)}Als Wissensartikel übernehmen</button>`;
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
                            <button type="button" class="btn-ghost btn-icon btn-xs btn-danger incident-linked-unlink" title="Verknüpfung aufheben" aria-label="Verknüpfung aufheben">${Icon('link-2-off', 14)}</button>
                        </div>`).join('')}</div>` : '';
                related.querySelectorAll('.incident-linked-open').forEach(btn => { btn.onclick = () => AdminBoard.openModal(btn.closest('[data-ticket-id]').dataset.ticketId); });
                related.querySelectorAll('.incident-linked-unlink').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const otherId = btn.closest('[data-ticket-id]').dataset.ticketId;
                        const other = tickets.find(x => x.id === otherId);
                        UI.confirm(`Verknüpfung zwischen diesem Ticket und "${other?.ticketNumber || otherId} · ${other?.title || ''}" aufheben?`, async () => {
                            const ok = await Store.unlinkRelatedTicketIds(t.id, otherId);
                            UI.toast(ok ? 'Verknüpfung aufgehoben.' : 'Verknüpfung aufheben fehlgeschlagen.');
                            await AdminBoard.openModal(t.id);
                        });
                    };
                });
            }

            const btnAssignIncident = q('#btn-assign-incident');
            if (btnAssignIncident) {
                const activeIncidents = tickets.filter(x => x.isMajorIncident && !x.archived && x.status !== 'Geschlossen' && x.id !== t.id);
                btnAssignIncident.style.display = (t.archived || t.isMajorIncident || t.linkedIncidentId || !activeIncidents.length) ? 'none' : '';
                btnAssignIncident.onclick = async () => {
                    const choice = await UI.askIncidentLink(activeIncidents, { title: 'Ticket einer Störung zuordnen', confirmLabel: 'Zuordnen' });
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
                if (btnArch) btnArch.style.display = 'none';
                if (btnReact) {
                    btnReact.style.display = isSuper ? 'inline-flex' : 'none';
                    btnReact.onclick = () => AdminBoard.reactivateTicket(t.id);
                }
            } else {
                if (btnReact) btnReact.style.display = 'none';
                if (btnArch) {
                    btnArch.style.display = (t.status === 'Geschlossen') ? 'inline-flex' : 'none';
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
                            Store.sendEmail(author.email, `Ticket Update: ${t.title}`, `Priorität geändert auf: ${t.prio}`);
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
            UI.toast('Fehler beim Öffnen des Tickets');
        }
    },

    // Direkter PATCH statt ueber die Volllisten-Diff (Store.saveTickets): archivierte Tickets
    // stehen gar nicht in Store.getTickets() (siehe getArchivedTickets), waeren im Diff also nie
    // gefunden worden.
    reactivateTicket: (id) => {
        UI.confirm('Möchtest du dieses Ticket reaktivieren?', async () => {
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
            box.innerHTML = `<div class="empty-state compact">${channel === 'admin-chat' ? 'Noch keine Admin-Nachrichten.' : 'Noch keine Lösungsversuche dokumentiert.'}</div>`;
            return;
        }
        const renderText = (value = '') => highlightMentions(Utils.renderMarkdown(value));
        const query = (searchInput?.value || '').toLowerCase().trim();
        const comments = [...commentsRaw]
            .filter(c => !query || [c.content, c.author_name, c.note_type, Utils.fmtDate(c.created_at)].join(' ').toLowerCase().includes(query))
            .sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned) || Number(!!b.is_resolution) - Number(!!a.is_resolution) || new Date(b.created_at) - new Date(a.created_at));
        if (comments.length === 0) {
            box.innerHTML = '<div class="empty-state compact">Keine passenden internen Kommentare gefunden.</div>';
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
                        <span class="note-type">${Utils.esc(c.note_type || 'Notiz')}</span>
                        ${c.is_resolution ? `<span class="note-type note-resolution">${Icon('check-circle', 12)}Endgültige Lösung</span>` : ''}
                    </div>
                    <div class="note-actions">
                        <span>${Utils.fmtDate(c.created_at)}</span>
                        <button class="btn-ghost btn-icon btn-xs note-edit" title="Kommentar bearbeiten" aria-label="Kommentar bearbeiten">${Icon('pencil', 13)}</button>
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
    dataUriToBlobUrl: (dataUri, mime) => {
        const commaIdx = dataUri.indexOf(',');
        const meta = dataUri.slice(5, commaIdx);
        const isBase64 = meta.includes(';base64');
        const payload = dataUri.slice(commaIdx + 1);
        const byteString = isBase64 ? atob(payload) : decodeURIComponent(payload);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime || meta.split(';')[0] || 'application/octet-stream' });
        return URL.createObjectURL(blob);
    },

    openAttachmentPreview: async (file) => {
        let attachment = file;
        if (!attachment?.data && (attachment?.attachmentId || attachment?.id)) {
            attachment = await Store.getAttachment(attachment.attachmentId || attachment.id);
        }
        if (!attachment?.data) return UI.toast('Anhang nicht gefunden.');
        if (AdminBoard._lastPreviewBlobUrl) {
            URL.revokeObjectURL(AdminBoard._lastPreviewBlobUrl);
            AdminBoard._lastPreviewBlobUrl = null;
        }
        let blobUrl = null;
        try {
            blobUrl = AdminBoard.dataUriToBlobUrl(attachment.data, attachment.type);
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
                            <a class="btn-ghost btn-icon" id="attachment-preview-open" target="_blank" rel="noopener" title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">${Icon('external-link', 16)}</a>
                            <a class="btn-ghost btn-icon" id="attachment-preview-download" title="Herunterladen" aria-label="Herunterladen">${Icon('download', 16)}</a>
                            <button class="btn-ghost btn-icon" data-close-preview title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body attachment-preview-body" id="attachment-preview-body"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('[data-close-preview]').onclick = () => modal.classList.remove('open');
            modal.onclick = event => {
                if (event.target === modal) modal.classList.remove('open');
            };
        }
        const name = String(attachment.name || '').toLowerCase();
        const mime = attachment.type || 'application/octet-stream';
        q('#attachment-preview-title').textContent = attachment.name || 'Anhang';
        const topDownload = q('#attachment-preview-download');
        const topOpen = q('#attachment-preview-open');
        const previewSrc = blobUrl || attachment.data;
        if (topDownload) {
            topDownload.href = previewSrc;
            topDownload.download = attachment.name || 'Anhang';
        }
        if (topOpen) {
            topOpen.href = previewSrc;
            topOpen.style.display = 'inline-flex';
        }
        const body = q('#attachment-preview-body');
        body.replaceChildren();
        const addText = text => {
            const pre = document.createElement('pre');
            pre.className = 'attachment-text-preview';
            pre.textContent = text;
            body.appendChild(pre);
        };
        if (mime === 'application/pdf' || name.endsWith('.pdf')) {
            if (blobUrl) {
                const frameWrap = document.createElement('div');
                frameWrap.className = 'attachment-document-frame-wrap';
                const frame = document.createElement('iframe');
                frame.className = 'attachment-document-frame';
                frame.src = blobUrl;
                frame.title = attachment.name || 'PDF-Vorschau';
                frameWrap.appendChild(frame);
                body.appendChild(frameWrap);
            } else {
                const message = document.createElement('div');
                message.className = 'attachment-download-fallback';
                message.innerHTML = `${Icon('file-text', 28)}<strong>PDF-Vorschau konnte nicht geladen werden</strong><span>Nutze oben das Öffnen- oder Download-Icon.</span>`;
                body.appendChild(message);
            }
        } else if (mime.startsWith('image/')) {
            const image = document.createElement('img');
            image.className = 'attachment-image-preview';
            image.src = previewSrc;
            image.alt = attachment.name || 'Bildanhang';
            body.append(image);
        } else if (/\.(txt|csv|tsv|json|xml|md|log|html?)$/.test(name) || mime.startsWith('text/')) {
            try {
                addText(await (await fetch(previewSrc)).text());
            } catch {
                addText('Diese Datei kann nicht als Text gelesen werden.');
            }
        } else if (/\.(docx|xlsx|xls|pptx)$/.test(name)) {
            try {
                // Diese drei Bibliotheken sind zusammen >1,6 MB und werden nur fuer die
                // Vorschau genau dieses Dateityps gebraucht -- deshalb erst hier, nicht mehr
                // auf jedem Seitenaufruf blockierend im <head>, nachladen (siehe Utils.loadVendorScript).
                if (name.endsWith('.docx') && !window.mammoth) await Utils.loadVendorScript('/vendor/mammoth.browser.min.js').catch(() => {});
                else if (/\.(xlsx|xls)$/.test(name) && !window.XLSX) await Utils.loadVendorScript('/vendor/xlsx.full.min.js').catch(() => {});
                else if (name.endsWith('.pptx') && !window.JSZip) await Utils.loadVendorScript('/vendor/jszip.min.js').catch(() => {});
                const buffer = await (await fetch(previewSrc)).arrayBuffer();
                if (name.endsWith('.docx') && window.mammoth) {
                    const result = await window.mammoth.extractRawText({
                        arrayBuffer: buffer
                    });
                    addText(result.value || 'Das Dokument enthält keinen extrahierbaren Text.');
                } else if (/\.(xlsx|xls)$/.test(name) && window.XLSX) {
                    const workbook = window.XLSX.read(buffer, {
                        type: 'array'
                    });
                    workbook.SheetNames.forEach(sheetName => {
                        const heading = document.createElement('h4');
                        heading.textContent = sheetName;
                        body.appendChild(heading);
                        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
                            header: 1,
                            raw: false
                        }).slice(0, 300);
                        const table = document.createElement('table');
                        table.className = 'attachment-spreadsheet-preview';
                        rows.forEach(row => {
                            const tr = table.insertRow();
                            row.forEach(value => {
                                const cell = tr.insertCell();
                                cell.textContent = String(value ?? '');
                            });
                        });
                        body.appendChild(table);
                    });
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
                        heading.textContent = `Folie ${index + 1}`;
                        const paragraph = document.createElement('p');
                        paragraph.textContent = text || 'Kein Text auf dieser Folie.';
                        body.append(heading, paragraph);
                    }
                } else {
                    addText('Die Office-Vorschau konnte nicht geladen werden.');
                }
            } catch {
                addText('Die Datei konnte nicht geöffnet werden. Nutze das Download-Icon oben.');
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
            message.textContent = 'Für dieses Dateiformat ist keine sichere Vorschau verfügbar. Nutze das Download-Icon oben.';
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

        // Benutzer-Antwort öffnet ein geschlossenes/wartendes Ticket automatisch wieder.
        if (role === 'user') {
            const tickets = await Store.getTickets();
            const t = tickets.find(x => x.id === id);
            if (t && !t.archived && (t.status === 'Geschlossen' || String(t.status).startsWith('Warten auf Benutzer'))) {
                t.status = 'In Bearbeitung';
                await Store.saveTickets(tickets);
            }
        }

        txtInput.value = '';
        const t = (await Store.getTickets()).find(x => x.id === id);
        if (role === 'admin') {
            await AdminBoard.renderChat(t, '#m-chat-msgs');
            await AdminBoard.render();
        } else {
            await AdminBoard.renderChat(t, '#u-chat-msgs');
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
        q('#approve-modal').classList.add('open');

        // Permissions check: only superadmins can set role/dept
        const roleField = q('#a-role')?.parentElement;
        const deptField = q('#a-dept-field');

        q('#a-role').value = 'user';
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
            UI.toast(`${addedCount} Benutzer importiert, ${skippedCount} übersprungen`);
            await Store.addGlobalLog('Benutzer per CSV importiert', `Hinzugefügt: ${addedCount}, Übersprungen: ${skippedCount}`);
        } else {
            UI.toast(`Keine neuen Benutzer importiert (${skippedCount} Duplikate)`);
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
            UI.toast('Bitte alle Felder füllen');
            return;
        }
        if (password.length < 12) {
            UI.toast('Passwort muss mindestens 12 Zeichen lang sein');
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

        if (isSuper && role === 'admin') newUser.dept = dept;

        users.push(newUser);
        await Store.saveUsers(users);
        await Store.decideAccountRequest(AdminBoard.currentReq.id, 'approved');

        AdminBoard.closeApprove();
        await AdminBoard.renderRequests();
        UI.toast('Benutzer erfolgreich erstellt!');
    }
};
