/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { Store, Notifications } from './store.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';
import { getStatusColor, isPendingApprover, insertMarkdownText, insertMarkdownLink } from './ticket-helpers.js';

// --- User Dashboard Logic ---
export const UserDash = {
    selectedFiles: [], // Staging for file uploads
    createFiles: [],
    activeIncident: null,

    // Zeigt/aktualisiert das Genehmigungs-Icon in der Topbar (für jede Person, nicht nur Admins).
    // Wird beim Laden der Seite UND jedes Mal nach einer Genehmigungs-Entscheidung neu aufgerufen,
    // damit die Zahl nie veraltet stehen bleibt.
    refreshApprovalBadge: async () => {
        const user = await Store.currentUser();
        if (!user) return;
        const pending = (await Store.getTickets()).filter(t => (t.approvals || []).some(a => isPendingApprover(a, user.id)));
        const rightNav = q('.topbar-right');
        if (!rightNav) return;
        let btn = q('#btn-user-approvals');
        if (!btn && pending.length) {
            btn = document.createElement('button');
            btn.id = 'btn-user-approvals';
            btn.className = 'btn-ghost btn-icon notification-button';
            btn.title = 'Genehmigungen';
            btn.setAttribute('aria-label', 'Genehmigungen');
            btn.innerHTML = `${Icon('badge-check', 18)}<span class="notification-count"></span>`;
            btn.onclick = () => AdminBoard.openApprovals();
            rightNav.insertBefore(btn, rightNav.firstChild);
        }
        if (btn) {
            btn.hidden = pending.length === 0;
            const countEl = btn.querySelector('.notification-count');
            if (countEl) countEl.textContent = String(pending.length);
        }
    },

    init: async () => {
        // Admin Button Injection if on dashboard (for superadmin/admin)
        const user = await Store.currentUser();
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
            const rightNav = q('.topbar-right');
            if (rightNav && !q('#btn-to-admin')) {
                const btn = document.createElement('button');
                btn.id = 'btn-to-admin';
                btn.className = 'btn-ghost';
                btn.innerHTML = `${Icon('shield', 16)}${Lang.t('adminPanel')}`;
                btn.onclick = () => window.location.href = 'admin.html';
                rightNav.insertBefore(btn, rightNav.firstChild);
            }
        }

        // Jede Person kann Vorgesetzte/r sein – zeige den Button, sobald offene Genehmigungen anstehen
        await UserDash.refreshApprovalBadge();

        if (!q('#btn-create-ticket')) return;
        const btn = q('#btn-create-ticket');
        btn.onclick = async () => {
            const title = q('#t-title').value.trim();
            const desc = q('#t-desc').value.trim();
            const settings = await Store.getSettings();
            const selectedPrio = q('#t-prio').value;
            const configuredPrio = settings.generalConfig?.defaultPrio;
            const prio = ['Niedrig', 'Normal', 'Hoch'].includes(selectedPrio) ? selectedPrio :
                (['Niedrig', 'Normal', 'Hoch'].includes(configuredPrio) ? configuredPrio : 'Normal');
            // Get values from custom multi-select
            const selectedCats = UserDash.categoryInstance ? UserDash.categoryInstance.getValue() : ['Allgemein'];
            const cat = selectedCats.length > 0 ? selectedCats : ['Allgemein'];

            if (!title) {
                UI.toast('Bitte Titel angeben');
                return;
            }

            const { values: customFieldValues, missing: missingFields } = UI.readCustomFieldsForm(q('#t-custom-fields'));
            if (missingFields.length) {
                UI.toast(`Bitte Pflichtfeld${missingFields.length > 1 ? 'er' : ''} ausfüllen: ${missingFields.join(', ')}`);
                return;
            }

            if (UserDash.createFiles.some(file => file.size > 15 * 1024 * 1024)) {
                UI.toast('Anhänge dürfen maximal 15 MB groß sein.');
                return;
            }
            const activeIncidents = (await Store.getTickets()).filter(t => t.isMajorIncident && t.status !== 'Geschlossen' && !t.archived);
            let linkedIncidentId = null;
            if (activeIncidents.length) {
                const choice = await UI.askIncidentLink(activeIncidents);
                if (choice === undefined) return;
                linkedIncidentId = choice;
            }
            const user = await Store.currentUser();
            const newTicket = await Store.createTicket({ title, desc, prio, category: cat, customFieldValues });
            if (!newTicket) {
                UI.toast('Ticket konnte nicht erstellt werden.');
                return;
            }
            if (UserDash.createFiles.length) {
                try {
                    await Promise.all(UserDash.createFiles.map(file => Store.saveAttachment(file, { ticketId: newTicket.id })));
                } catch (error) {
                    console.error(error);
                    UI.toast('Ticket wurde erstellt, aber Anhänge konnten nicht gespeichert werden.');
                }
            }
            if (linkedIncidentId) {
                await fetch(`/api/v2/tickets/${encodeURIComponent(newTicket.id)}/link-incident`, {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ incident_id: linkedIncidentId })
                }).catch(() => {});
            }
            Store._ticketsCache = null;
            const admins = (await Store.getUsers()).filter(person => person.role === 'admin' || person.role === 'superadmin');
            await Notifications.refresh();

            // Admins per E-Mail benachrichtigen, je nach persönlicher/administrativer Einstellung
            if (settings.emailConfig && settings.emailConfig.host) {
                for (const admin of admins) {
                    if (!admin.email) continue;
                    const pref = await Store.resolveNotifPref(admin, 'newTicket');
                    if (pref.email) Store.sendEmail(admin.email, `Neues Ticket: ${title}`, `Ticket #${newTicket.id} von ${user.name || user.username} erstellt.`);
                }
            }

            UI.toast('Ticket erstellt!');
            q('#t-title').value = '';
            q('#t-desc').value = '';
            UserDash.createFiles = [];
            if (q('#t-files')) q('#t-files').value = '';
            UserDash.renderCreateFilePreview();
            if (q('#t-prio')) q('#t-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(settings.generalConfig?.defaultPrio) ? settings.generalConfig.defaultPrio : 'Normal';
            UI.renderCustomFieldsForm(q('#t-custom-fields'), Store.getCustomFieldsForCategories(cat, settings));
            await UserDash.renderList();
        };

        const createFileInput = q('#t-files');
        if (createFileInput) createFileInput.onchange = () => {
            UserDash.createFiles.push(...Array.from(createFileInput.files || []));
            createFileInput.value = '';
            UserDash.renderCreateFilePreview();
        };
        const createDropzone = q('#t-files-dropzone');
        if (createDropzone) {
            ['dragenter', 'dragover'].forEach(evt => createDropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                createDropzone.classList.add('drag-over');
            }));
            ['dragleave', 'dragend'].forEach(evt => createDropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                createDropzone.classList.remove('drag-over');
            }));
            createDropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                createDropzone.classList.remove('drag-over');
                UserDash.createFiles.push(...Array.from(e.dataTransfer?.files || []));
                UserDash.renderCreateFilePreview();
            });
        }

        // ... Key listeners for Create Ticket ...
        q('#t-title').onkeydown = (e) => {
            if (e.key === 'Enter') q('#btn-create-ticket').click();
        };
        const addCreateFiles = files => {
            UserDash.createFiles.push(...files);
            UserDash.renderCreateFilePreview();
        };
        UI.bindFileDrop(q('#t-title')?.closest('.card'), addCreateFiles);
        UI.bindPasteFiles(q('#t-desc'), addCreateFiles);

        // Populate Categories dynamically with Custom Multi-Select
        const catContainer = q('#u-cat-container');
        if (catContainer) {
            const settings = await Store.getSettings();
            const categories = settings.categories || ['Allgemein', 'Technik', 'Account', 'Abrechnung'];
            if (q('#t-prio')) q('#t-prio').value = ['Niedrig', 'Normal', 'Hoch'].includes(settings.generalConfig?.defaultPrio) ? settings.generalConfig.defaultPrio : 'Normal';
            const initial = categories.includes('Allgemein') ? ['Allgemein'] : categories.slice(0, 1);
            const refreshCustomFields = (selectedCats) => {
                const fields = Store.getCustomFieldsForCategories(selectedCats, settings);
                UI.renderCustomFieldsForm(q('#t-custom-fields'), fields);
            };
            UserDash.categoryInstance = UI.createMultiSelect(catContainer, categories, initial, refreshCustomFields);
            refreshCustomFields(initial);
        }

        // Modal Events
        if (q('#u-m-close')) q('#u-m-close').onclick = UserDash.closeModal;
        if (q('#u-ticket-modal')) q('#u-ticket-modal').onclick = (e) => {
            if (e.target.id === 'u-ticket-modal') UserDash.closeModal();
        };

        // User Chat Logic
        const chatSend = q('#u-chat-send');
        if (chatSend) {
            chatSend.onclick = () => AdminBoard.postChat('user');
            q('#u-chat-input').onkeydown = (e) => {
                if (e.ctrlKey && e.key === 'Enter') AdminBoard.postChat('user');
            };

            // File Handling
            const fileIn = q('#u-chat-file');
            fileIn.onchange = () => {
                Array.from(fileIn.files).forEach(f => UserDash.selectedFiles.push(f));
                UserDash.renderFilePreview();
                fileIn.value = ''; // Reset input to allow re-selecting same file
            };
        }
        const userChatInput = q('#u-chat-input');
        if (userChatInput) {
            q('#u-chat-bold').onclick = () => insertMarkdownText(userChatInput, '**');
            q('#u-chat-italic').onclick = () => insertMarkdownText(userChatInput, '*');
            q('#u-chat-link').onclick = () => insertMarkdownLink(userChatInput);
        }

        // Tabs
        const modalBody = q('#u-ticket-modal .modal-body');
        if (modalBody) {
            const tabs = modalBody.querySelectorAll('.tab-btn');
            tabs.forEach(btn => {
                btn.onclick = () => {
                    modalBody.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const target = btn.dataset.tab; // u-details or u-chat
                    modalBody.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    const pane = q(`#u-tab-${target.replace('u-', '')}`) || q(`#${target}`);
                    if (pane) {
                        pane.classList.add('active');
                        if (target.includes('chat')) {
                            const box = q('#u-chat-msgs');
                            if (box) box.scrollTop = box.scrollHeight;
                        }
                    }
                };
            });
        }

        // Suche in der Ticketliste
        const search = q('#u-search');
        if (search) {
            search.placeholder = Lang.t('search');
            search.oninput = () => UserDash.renderList();
        }

        const archiveFilter = q('#dash-filter-archive');
        if (archiveFilter) {
            const label = archiveFilter.closest('label')?.querySelector('[data-i18n]');
            if (label) {
                label.dataset.i18n = 'showClosedArchived';
                label.textContent = Lang.t('showClosedArchived');
            }
            archiveFilter.onchange = () => {
                UserDash.displayLimit = UserDash.pageSize;
                UserDash.renderList();
            };
        }

        await UserDash.renderList();
    },

    renderFilePreview: () => {
        const pan = q('#u-chat-file-preview');
        pan.innerHTML = '';
        if (UserDash.selectedFiles.length > 0) {
            pan.style.display = 'flex';
            UserDash.selectedFiles.forEach((f, idx) => {
                const tag = document.createElement('div');
                tag.className = 'file-chip';
                tag.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(f.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger remove-file" title="${Lang.t('delete')}" aria-label="${Lang.t('delete')}">${Icon('x', 13)}</button>`;
                tag.querySelector('.remove-file').onclick = () => {
                    UserDash.selectedFiles.splice(idx, 1);
                    UserDash.renderFilePreview();
                };
                pan.appendChild(tag);
            });
            if (window.lucide) lucide.createIcons();
        } else {
            pan.style.display = 'none';
        }
    },

    renderCreateFilePreview: () => {
        const preview = q('#t-files-preview');
        if (!preview) return;
        preview.innerHTML = '';
        preview.style.display = UserDash.createFiles.length ? 'flex' : 'none';
        UserDash.createFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'file-chip file-chip-clickable';
            chip.title = 'Vorschau anzeigen';
            chip.innerHTML = `${Icon('paperclip', 13)}<span>${Utils.esc(file.name)}</span><button type="button" class="btn-ghost btn-icon btn-xs btn-danger" title="Entfernen" aria-label="${Utils.esc(file.name)} entfernen">${Icon('x', 13)}</button>`;
            chip.querySelector('span').onclick = async () => {
                const data = await Store.readFile(file);
                AdminBoard.openAttachmentPreview({ name: file.name, type: file.type, data });
            };
            chip.querySelector('button').onclick = () => {
                UserDash.createFiles.splice(index, 1);
                UserDash.renderCreateFilePreview();
            };
            preview.appendChild(chip);
        });
        if (window.lucide) lucide.createIcons();
    },

    // ... renderList, openModal, closeModal ...
    currentTicketId: null,

    openModal: async (id) => {
        UserDash.currentTicketId = id;
        const tickets = await Store.getTickets();
        const t = tickets.find(x => x.id === id) || await Store.getTicketById(id);
        if (!t) return;
        const viewer = await Store.currentUser();
        const isOwnTicket = viewer && t.author === viewer.username;

        if (q('#u-m-title')) q('#u-m-title').textContent = `${t.ticketNumber || t.id} · ${t.title}${t.archived ? ` (${Lang.t('archived')})` : ''}`;
        if (q('#u-m-desc')) q('#u-m-desc').textContent = t.desc || Lang.t('noDescription');
        {
            const incidentBox = q('#u-m-incident');
            if (incidentBox) {
                const incident = t.linkedIncidentId ? (await Store.getTickets()).find(x => x.id === t.linkedIncidentId) : null;
                incidentBox.hidden = !incident;
                incidentBox.innerHTML = incident ? `<div class="incident-notice-text"><strong>${Icon('siren', 14)}Zugeordnete Störung</strong><span>${Utils.esc(incident.ticketNumber || incident.id)} · ${Utils.esc(incident.title)}</span></div>` : '';
            }
        }
        {
            const fieldsSettings = await Store.getSettings();
            UI.renderCustomFieldsDisplay(q('#u-m-custom-fields-display'), Store.getCustomFieldsForCategories(t.category, fieldsSettings), t.customFieldValues || {});
        }
        await AdminBoard.renderTicketAttachments(t, '#u-m-ticket-attachments');

        // Read-only check for archived
        const uChatInput = q('#u-chat-input');
        const uChatSend = q('#u-chat-send');
        if (uChatInput) uChatInput.disabled = t.archived;
        if (uChatSend) uChatSend.disabled = t.archived;

        const resolveBtn = q('#u-m-resolve');
        if (resolveBtn) {
            // Wer ein Ticket nur zur Genehmigung einsieht (nicht der/die Erstellende), darf es nicht
            // selbst als gelöst schließen können.
            resolveBtn.hidden = t.archived || t.status === 'Geschlossen' || !isOwnTicket;
            resolveBtn.onclick = () => UI.confirm('Ticket als gelöst schließen? Wenn du später noch einmal antwortest, wird es automatisch wieder geöffnet.', async () => {
                const all = await Store.getTickets();
                const ticket = all.find(x => x.id === t.id);
                if (!ticket || ticket.status === 'Geschlossen') return;
                ticket.status = 'Geschlossen';
                ticket.slaPausedSince = null;
                await Store.addLog(ticket, 'Vom Benutzer als gelöst geschlossen');
                await Store.saveTickets(all);
                const actor = await Store.currentUser();
                const admins = (await Store.getUsers()).filter(u => u.role === 'admin' || u.role === 'superadmin').map(u => u.username);
                await Store.addNotifications(admins, ticket, `${actor?.name || actor?.username}: Ticket wurde vom Benutzer als gelöst geschlossen.`, actor?.username, 'ticketClosed');
                await Notifications.refresh();
                UI.toast('Ticket geschlossen.');
                await UserDash.openModal(t.id);
                await UserDash.renderList();
            });
        }

        // Metadata
        if (q('#u-m-status')) {
            q('#u-m-status').innerHTML = `<span class="status-badge"><span class="status-dot" style="--dot:${getStatusColor(t.status)}"></span>${Lang.status(t.status)}</span>`;
        }
        const waitingRequest = q('#u-waiting-request');
        if (waitingRequest) {
            const showRequest = t.status === 'Warten auf Benutzer' && !!t.waitingMessage;
            waitingRequest.hidden = !showRequest;
            q('#u-waiting-message').textContent = showRequest ? t.waitingMessage : '';
        }
        const pendingApproval = (t.approvals || []).find(a => a.status === 'pending');
        const pendingBox = q('#u-approval-pending');
        if (pendingBox) {
            pendingBox.hidden = !pendingApproval;
            if (pendingApproval) {
                const approverName = await Store.describeApprover(pendingApproval);
                q('#u-approval-pending-text').textContent = `Wartet auf Genehmigung durch ${approverName} (seit ${Utils.fmtDate(pendingApproval.requestedAt)})`;
            }
        }
        const rejectedBox = q('#u-approval-rejected');
        if (rejectedBox) {
            rejectedBox.hidden = !t.rejectedApproval;
            if (t.rejectedApproval) {
                q('#u-approval-rejected-text').textContent = `${t.rejectedApproval.byName || t.rejectedApproval.by} hat diese Anfrage abgelehnt: ${t.rejectedApproval.reason || '-'}`;
                q('#u-approval-reuse').onclick = () => {
                    q('#u-ticket-modal').classList.remove('open');
                    q('#t-title').value = t.title || '';
                    q('#t-desc').value = t.desc || '';
                    if (q('#t-prio')) q('#t-prio').value = t.prio || 'Normal';
                    if (UserDash.categoryInstance) UserDash.categoryInstance.setValue(t.category || []);
                    UI.toast('Angaben übernommen – bitte prüfen und erneut absenden.');
                    q('#t-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                };
            }
        }
        if (q('#u-m-date')) q('#u-m-date').textContent = Utils.fmtDate(t.createdAt);

        // Lösungsfrist für Benutzer: nur wenn in den Systemeinstellungen aktiviert, und
        // immer dezent (neutrale Farbe) – nie als Alarm, auch nicht bei Überschreitung.
        const slaItemUser = q('#u-m-sla-item');
        if (slaItemUser) {
            const slaSettingsForUser = await Store.getSettings();
            const slaCountdownUser = slaSettingsForUser.generalConfig?.showSlaToUsers
                ? Store.formatSlaCountdown(t, slaSettingsForUser)
                : null;
            slaItemUser.hidden = !slaCountdownUser;
            if (slaCountdownUser) {
                q('#u-m-sla-badge').innerHTML = `${Icon('timer', 13)}${Utils.esc(slaCountdownUser.label)}`;
            }
        }

        // Handle Archived Date Visibility
        if (q('#u-m-archived')) {
            const archEl = q('#u-m-archived');
            if (t.archived && t.archivedAt) {
                archEl.textContent = Utils.fmtDate(t.archivedAt);
                archEl.parentElement.style.display = '';
            } else {
                archEl.parentElement.style.display = 'none';
            }
        }

        if (q('#u-m-prio')) q('#u-m-prio').innerHTML = `<span class="prio-pill prio-${t.prio}">${Lang.prio(t.prio)}</span>`;
        if (q('#u-m-cat')) q('#u-m-cat').textContent = (Array.isArray(t.category) ? t.category.join(', ') : t.category) || '-';

        // Bearbeiter = Hauptverantwortlicher + Beteiligte Personen (der Hauptverantwortliche fehlte hier bisher)
        if (q('#u-m-assignee')) {
            const allUsers = await Store.getUsers();
            const handlers = [...new Set([t.owner, ...(t.assignees || [])].filter(Boolean))];
            if (handlers.length > 0) {
                const names = handlers.map(u => {
                    const found = allUsers.find(x => x.username === u);
                    return found ? (found.name || found.username) : u;
                });
                q('#u-m-assignee').textContent = names.join(', ');
            } else {
                q('#u-m-assignee').textContent = t.assigneeName || Lang.t('nobody');
            }
        }

        // Reset Tabs
        const btnDetails = q('.tab-btn[data-tab="u-details"]');
        if (btnDetails) btnDetails.click();

        // Reset Files
        UserDash.selectedFiles = [];
        UserDash.renderFilePreview();

        AdminBoard.renderChat(t, '#u-chat-msgs');

        // Handle Archived State
        const isArchived = t.archived === true;
        const chatInput = q('#u-chat-input');
        const chatSend = q('#u-chat-send');
        const chatFile = q('#u-chat-file');

        if (isArchived) {
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = Lang.t('archivedReadonly');
            }
            if (chatSend) chatSend.disabled = true;
            if (chatFile) chatFile.disabled = true;
        } else {
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.placeholder = Lang.t('writeMessage');
            }
            if (chatSend) chatSend.disabled = false;
            if (chatFile) chatFile.disabled = false;
        }

        q('#u-ticket-modal').classList.add('open');
    },

    closeModal: () => {
        q('#u-ticket-modal').classList.remove('open');
        UserDash.currentTicketId = null;
    },

    pageSize: 5,
    displayLimit: 5,

    renderList: async () => {
        const list = q('#user-tickets');
        if (!list) return;
        const user = await Store.currentUser();
        const userKeys = [
            user.username,
            user.name,
            user.email,
            user.id
        ].filter(Boolean).map(v => String(v).toLowerCase());

        const belongsToCurrentUser = (t) => {
            const ticketKeys = [
                t.author,
                t.authorName,
                t.requester,
                t.requesterName,
                t.createdBy,
                t.user,
                t.username,
                t.email,
                t.authorEmail
            ].filter(Boolean).map(v => String(v).toLowerCase());
            return ticketKeys.some(v => userKeys.includes(v));
        };

        let tickets = (await Store.getTickets()).filter(belongsToCurrentUser);
        const slaSettings = await Store.getSettings();

        // Default: show every still-open ticket this user created. Toggle adds closed and archived history.
        const showClosedArchived = q('#dash-filter-archive') && q('#dash-filter-archive').checked;
        tickets = tickets.filter(t => {
            const isOpen = t.status !== 'Geschlossen' && !t.archived;
            if (showClosedArchived) return true;
            return isOpen;
        });

        // Search Filter
        const query = (q('#u-search')?.value || '').toLowerCase().trim();
        if (query) {
            tickets = tickets.filter(t => Utils.matchesSearch(query, t));
        }

        // Sorting
        tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const total = tickets.length;
        const toDisplay = tickets;

        list.innerHTML = '';
        if (toDisplay.length === 0) {
            list.innerHTML = `<div class="empty-state">${Lang.t('noTickets')}</div>`;
        } else {
            toDisplay.forEach(t => {
                const isOverdue = !!slaSettings.generalConfig?.showSlaToUsers && Store.isTicketOverdue(t, slaSettings);
                const el = document.createElement('div');
                el.className = `table-row user-ticket-row${t.archived ? ' is-archived' : ''}${isOverdue ? ' is-overdue-dezent' : ''}`;

                const cats = Array.isArray(t.category) ? t.category : [t.category || '-'];
                const catBadges = cats.map(c => `<span class="t-category">${Utils.esc(c)}</span>`).join('');
                const archivedBadge = t.archived ? `<span class="archive-badge">${Icon('archive', 12)}${Lang.t('archived')}</span>` : '';
                const overdueBadge = isOverdue ? `<span class="sla-overdue-icon sla-badge-muted" title="Frist überschritten">${Icon('timer', 11)}</span>` : '';
                const pendingApproval = (t.approvals || []).some(a => a.status === 'pending');
                const approvalBadge = pendingApproval ? `<span class="approval-badge" title="Wartet auf Genehmigung">${Icon('hourglass', 12)}Genehmigung</span>` : '';

                el.innerHTML = `
                    <span class="status-dot" style="--dot:${getStatusColor(t.status)}" title="${Utils.esc(Lang.status(t.status))}"></span>
                    <div class="ticket-row-main">
                        <div class="row-title" title="${Utils.esc(t.title)}">${Utils.esc(t.title)}</div>
                        <div class="ticket-row-cats"><span class="ticket-number">${Utils.esc(t.ticketNumber || t.id)}</span>${catBadges}${archivedBadge}${overdueBadge}${approvalBadge}</div>
                    </div>
                    <div class="ticket-row-status${String(t.status).startsWith('Warten auf') ? ' is-waiting' : ''}"><span class="status-badge">${pendingApproval ? 'Wartet auf Genehmigung' : Lang.status(t.status)}</span></div>
                    <div class="ticket-row-date date">${Utils.fmtDate(t.createdAt)}</div>
                    <div class="ticket-row-prio"><span class="prio-pill prio-${t.prio}">${Lang.prio(t.prio)}</span></div>
                `;
                el.addEventListener('click', async () => {
                    try {
                        await UserDash.openModal(t.id);
                    } catch (err) {
                        console.error(err);
                        UI.toast('Ticket konnte nicht geöffnet werden.');
                    }
                });
                list.appendChild(el);
            });
            if (window.lucide) lucide.createIcons();
        }

        // Handle Load More
        const loadContainer = q('#dash-load-more-container');
        if (loadContainer) {
            loadContainer.style.display = 'none';
        }
    }
};
