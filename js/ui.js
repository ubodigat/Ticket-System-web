/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { q, qa, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { Store } from './store.js';

// --- UI Components ---
export const UI = {
    toast: (msg) => {
        let el = q('#toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },
    // Druckt HTML über ein unsichtbares iFrame statt einem neuen Tab/Fenster --
    // kein Pop-up-Blocker-Risiko, und die Ticket-System-Seite bleibt immer im Hintergrund erhalten.
    printHTML: (html) => {
        let frame = q('#print-frame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'print-frame';
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
            document.body.appendChild(frame);
        }
        const doc = frame.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
        UI.toast('Druckvorschau wird geöffnet...');
        frame.onload = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
        };
    },
    // Ersetzt native title-Tooltips (vom Browser gezeichnet, nicht stylebar) durch eine
    // ans Design angepasste, abgerundete Tooltip-Box. Funktioniert per Delegation auch für
    // Elemente, die erst später (z.B. in Modals) ins DOM kommen.
    _tooltipEl: null,
    showTooltip: (target, text) => {
        if (!UI._tooltipEl) {
            UI._tooltipEl = document.createElement('div');
            UI._tooltipEl.className = 'custom-tooltip';
            document.body.appendChild(UI._tooltipEl);
        }
        const el = UI._tooltipEl;
        el.textContent = text;
        el.classList.add('visible');
        const rect = target.getBoundingClientRect();
        const tipRect = el.getBoundingClientRect();
        let top = rect.top - tipRect.height - 8;
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        if (top < 4) top = rect.bottom + 8;
        left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
    },
    hideTooltip: () => {
        if (UI._tooltipEl) UI._tooltipEl.classList.remove('visible');
    },
    initTooltips: () => {
        if (UI._tooltipsInitialized) return;
        UI._tooltipsInitialized = true;
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest?.('[title],[data-tooltip-text]');
            if (!target) return;
            let text = target.getAttribute('title');
            if (text) {
                target.dataset.tooltipText = text;
                target.removeAttribute('title');
            } else {
                text = target.dataset.tooltipText;
            }
            if (text) UI.showTooltip(target, text);
        });
        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest?.('[data-tooltip-text]');
            if (target && !target.contains(e.relatedTarget)) UI.hideTooltip();
        });
        document.addEventListener('focusin', (e) => {
            const target = e.target.closest?.('[title],[data-tooltip-text]');
            if (!target) return;
            let text = target.getAttribute('title');
            if (text) {
                target.dataset.tooltipText = text;
                target.removeAttribute('title');
            } else {
                text = target.dataset.tooltipText;
            }
            if (text) UI.showTooltip(target, text);
        });
        document.addEventListener('focusout', (e) => {
            const target = e.target.closest?.('[data-tooltip-text]');
            if (target) UI.hideTooltip();
        });
        window.addEventListener('scroll', () => UI.hideTooltip(), true);
        document.addEventListener('mousedown', () => UI.hideTooltip());
    },
    // Kontextmenü (Rechtsklick): items = [{ label, icon, shortcut, danger, disabled, title, submenu, separator, run }]
    contextMenu: (items, x, y) => {
        document.querySelectorAll('.context-menu-root').forEach(m => m.remove());
        const cleanups = [];
        const close = () => {
            document.querySelectorAll('.context-menu-root').forEach(m => m.remove());
            cleanups.forEach(fn => fn());
            cleanups.length = 0;
        };
        const buildList = (list, isSub) => {
            const box = document.createElement('div');
            box.className = 'context-menu' + (isSub ? ' is-sub' : '');
            box.setAttribute('role', 'menu');
            list.forEach(item => {
                if (item.separator) {
                    const sep = document.createElement('div');
                    sep.className = 'context-menu-sep';
                    box.appendChild(sep);
                    return;
                }
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'context-menu-item' + (item.danger ? ' is-danger' : '') + (item.disabled ? ' is-disabled' : '');
                row.setAttribute('role', 'menuitem');
                if (item.disabled) row.disabled = true;
                if (item.title) row.title = item.title;
                row.innerHTML = `${item.icon ? Icon(item.icon, 15) : '<span class="context-menu-icon-slot"></span>'}<span class="context-menu-label">${Utils.esc(item.label)}</span>${item.shortcut ? `<span class="context-menu-shortcut">${Utils.esc(item.shortcut)}</span>` : ''}${item.submenu ? Icon('chevron-right', 13) : ''}`;
                if (item.submenu && !item.disabled) {
                    row.onmouseenter = () => {
                        box.querySelectorAll(':scope > .context-menu.is-sub').forEach(s => s.remove());
                        const sub = buildList(item.submenu, true);
                        box.appendChild(sub);
                        const rowRect = row.getBoundingClientRect();
                        sub.style.top = `${rowRect.top}px`;
                        const openLeft = rowRect.right + 220 > window.innerWidth;
                        if (openLeft) { sub.style.right = `${window.innerWidth - rowRect.left}px`; } else { sub.style.left = `${rowRect.right}px`; }
                        if (window.lucide) lucide.createIcons();
                    };
                } else {
                    // Ein Wechsel auf eine Zeile ohne eigenes Untermenü muss das zuvor geöffnete schließen,
                    // sonst bleibt es nach dem Weghovern stehen.
                    row.onmouseenter = () => { box.querySelectorAll(':scope > .context-menu.is-sub').forEach(s => s.remove()); };
                    if (!item.disabled) row.onclick = () => { close(); item.run?.(); };
                }
                box.appendChild(row);
            });
            // Verlässt die Maus den ganzen Bereich (inkl. eines offenen Untermenüs), wird das Untermenü geschlossen
            box.addEventListener('mouseleave', () => { box.querySelectorAll(':scope > .context-menu.is-sub').forEach(s => s.remove()); });
            return box;
        };
        const root = buildList(items, false);
        root.classList.add('context-menu-root');
        document.body.appendChild(root);
        if (window.lucide) lucide.createIcons();
        const rect = root.getBoundingClientRect();
        let left = x, top = y;
        if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
        if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        const onOutside = e => { if (!e.target.closest('.context-menu')) close(); };
        const onKey = e => { if (e.key === 'Escape') close(); };
        setTimeout(() => {
            window.addEventListener('click', onOutside);
            window.addEventListener('contextmenu', onOutside);
            window.addEventListener('keydown', onKey);
            window.addEventListener('scroll', close, true);
            window.addEventListener('resize', close);
            cleanups.push(() => {
                window.removeEventListener('click', onOutside);
                window.removeEventListener('contextmenu', onOutside);
                window.removeEventListener('keydown', onKey);
                window.removeEventListener('scroll', close, true);
                window.removeEventListener('resize', close);
            });
        }, 0);
    },
    confirm: (msg, onYes) => {
        let modal = q('#confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirm-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('circle-help', 18)} ${Lang.t('confirm')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="cm-no-head" title="${Lang.t('cancel')}" aria-label="${Lang.t('cancel')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <p id="cm-msg"></p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary footer-cancel" id="cm-no">${Lang.t('cancel')}</button>
                        <button class="btn-primary" id="cm-yes">${Lang.t('yes')}</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        q('#cm-msg').textContent = msg;

        const close = () => modal.classList.remove('open');
        const yesBtn = q('#cm-yes');
        const noBtn = q('#cm-no');
        const headNoBtn = q('#cm-no-head');

        // Clone to clear listeners
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        const newHeadNo = headNoBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);
        headNoBtn.parentNode.replaceChild(newHeadNo, headNoBtn);

        newYes.onclick = () => {
            close();
            onYes();
        };
        newNo.onclick = () => close(); // Fix: close on No
        newHeadNo.onclick = () => close();

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },
    bindFileDrop: (el, onFiles) => {
        if (!el || el.dataset.dropBound) return;
        el.dataset.dropBound = '1';
        ['dragenter', 'dragover'].forEach(evt => el.addEventListener(evt, e => {
            if (!e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            el.classList.add('drag-over');
        }));
        el.addEventListener('dragleave', e => {
            if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
        });
        el.addEventListener('drop', e => {
            el.classList.remove('drag-over');
            if (e.defaultPrevented || !e.dataTransfer?.files?.length) return;
            e.preventDefault();
            onFiles(Array.from(e.dataTransfer.files));
        });
    },
    // Enter setzt eine Liste automatisch fort ("- " bzw. "1. "); Enter auf einem leeren Punkt beendet sie.
    bindListContinuation: (area) => {
        if (!area || area.dataset.listContinueBound) return;
        area.dataset.listContinueBound = '1';
        area.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            const pos = area.selectionStart;
            if (pos !== area.selectionEnd) return;
            const lineStart = area.value.lastIndexOf('\n', pos - 1) + 1;
            const line = area.value.slice(lineStart, pos);
            const bullet = line.match(/^(\s*)-\s(.*)$/);
            const numbered = line.match(/^(\s*)(\d+)([.)])\s(.*)$/);
            if (!bullet && !numbered) return;
            e.preventDefault();
            const indent = (bullet || numbered)[1];
            const content = bullet ? bullet[2] : numbered[4];
            if (!content.trim()) {
                // Leerer Punkt + Enter -> Liste beenden
                area.setRangeText('\n', lineStart, pos, 'end');
            } else {
                const marker = bullet ? `${indent}- ` : `${indent}${Number(numbered[2]) + 1}${numbered[3]} `;
                area.setRangeText(`\n${marker}`, pos, pos, 'end');
            }
            area.dispatchEvent(new Event('input', { bubbles: true }));
        });
    },
    bindPasteFiles: (el, onFiles) => {
        if (!el || el.dataset.pasteBound) return;
        el.dataset.pasteBound = '1';
        el.addEventListener('paste', e => {
            const files = Array.from(e.clipboardData?.files || []);
            if (!files.length) return;
            e.preventDefault();
            onFiles(files);
        });
    },

    askIncidentLink: (incidents, opts = {}) => new Promise(resolve => {
        let modal = q('#incident-link-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'incident-link-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3>${Icon('siren', 18)}Gehört dein Ticket zu einer Störung?</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="ilk-close" title="Schließen" aria-label="Schließen">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div class="incident-link-options" id="ilk-options"></div>
                    </div>
                    <div class="modal-footer modal-footer-visible">
                        <button class="btn-secondary" id="ilk-cancel">Abbrechen</button>
                        <button class="btn-primary" id="ilk-confirm">Ticket absenden</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        modal.querySelector('.modal-header h3').innerHTML = `${Icon('siren', 18)}${Utils.esc(opts.title || 'Gehört dein Ticket zu einer Störung?')}`;
        modal.querySelector('#ilk-confirm').textContent = opts.confirmLabel || 'Ticket absenden';
        const options = modal.querySelector('#ilk-options');
        options.innerHTML = [
            ...incidents.map((incident, i) => `
                <label class="check-row incident-link-option">
                    <input type="radio" name="ilk-incident" value="${Utils.esc(incident.id)}"${i === 0 ? ' checked' : ''}>
                    <span class="check-text"><strong>${Utils.esc(incident.ticketNumber || incident.id)} · ${Utils.esc(incident.title)}</strong><span>${Utils.esc(incident.incidentNotice || '')}</span></span>
                </label>`),
            `<label class="check-row incident-link-option">
                <input type="radio" name="ilk-incident" value="">
                <span class="check-text"><strong>Nein, keine dieser Störungen</strong></span>
            </label>`
        ].join('');
        const finish = (result) => {
            modal.classList.remove('open');
            resolve(result);
        };
        modal.querySelector('#ilk-close').onclick = () => finish(undefined);
        modal.querySelector('#ilk-cancel').onclick = () => finish(undefined);
        modal.querySelector('#ilk-confirm').onclick = () => {
            const checked = modal.querySelector('input[name="ilk-incident"]:checked');
            finish(checked && checked.value ? checked.value : null);
        };
        modal.onclick = e => { if (e.target === modal) finish(undefined); };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    }),

    promptText: ({ title, label, value = '', placeholder = '', multiline = false, saveLabel = null } = {}) => new Promise(resolve => {
        let modal = q('#prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'prompt-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-sm">
                    <div class="modal-header">
                        <h3></h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="pm-save" title="${Lang.t('save')}" aria-label="${Lang.t('save')}">${Icon('save', 16)}</button>
                            <button class="btn-ghost btn-icon" id="pm-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body"></div>
                </div>`;
            document.body.appendChild(modal);
        }
        const inputId = 'pm-value';
        modal.querySelector('.modal-header h3').textContent = title || '';
        modal.querySelector('#pm-save').title = saveLabel || Lang.t('save');
        modal.querySelector('#pm-save').setAttribute('aria-label', saveLabel || Lang.t('save'));
        modal.querySelector('.modal-body').innerHTML = `
            <div class="field">
                <label for="${inputId}">${Utils.esc(label || '')}</label>
                ${multiline
                ? `<textarea id="${inputId}" rows="4" placeholder="${Utils.esc(placeholder)}">${Utils.esc(value)}</textarea>`
                : `<input id="${inputId}" type="text" value="${Utils.esc(value)}" placeholder="${Utils.esc(placeholder)}">`}
            </div>`;
        const close = (result) => {
            modal.classList.remove('open');
            resolve(result);
        };
        modal.querySelector('#pm-close').onclick = () => close(null);
        modal.onclick = e => {
            if (e.target === modal) close(null);
        };
        modal.querySelector('#pm-save').onclick = () => close(q(`#${inputId}`)?.value || '');
        modal.classList.add('open');
        setTimeout(() => q(`#${inputId}`)?.focus(), 0);
        if (window.lucide) lucide.createIcons();
    }),
    starfield: () => {
        const c = q('#stars');
        if (!c) return;
        const ctx = c.getContext('2d');
        const stars = [];
        const resize = () => {
            c.width = window.innerWidth;
            c.height = window.innerHeight;
        };
        const loop = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.fillStyle = document.documentElement.classList.contains('light') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.9)';
            stars.forEach(s => {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
                s.y += s.v;
                if (s.y > c.height) s.y = -2;
            });
            requestAnimationFrame(loop);
        };
        resize();
        window.addEventListener('resize', resize);
        for (let i = 0; i < 150; i++) stars.push({
            x: Math.random() * c.width,
            y: Math.random() * c.height,
            r: Math.random() * 1.5,
            v: Math.random() * 0.4 + 0.1
        });
        loop();
    },

    showLogs: async (id) => {
        let modal = q('#logs-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'logs-modal';
            modal.className = 'modal-overlay modal-top';
            modal.innerHTML = `
                <div class="modal modal-md">
                    <div class="modal-header">
                        <h3>${Icon('scroll-text', 18)} Ticket-Protokoll</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="logs-modal-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body flush" id="logs-body"></div>
                </div>`;
            document.body.appendChild(modal);
            q('#logs-modal-close').onclick = () => modal.classList.remove('open');
        }

        const iconForLog = (msg = '') => {
            const text = msg.toLowerCase();
            if (text.includes('status')) return 'refresh-cw';
            if (text.includes('priorit') || text.includes('prio')) return 'flag';
            if (text.includes('kategorie')) return 'tags';
            if (text.includes('zuweisung') || text.includes('verantwortlich') || text.includes('beteilig')) return 'users';
            if (text.includes('todo') || text.includes('teilaufgabe')) return 'check-square';
            if (text.includes('kommentar') || text.includes('notiz')) return 'message-square';
            if (text.includes('archiv')) return 'archive';
            return 'activity';
        };

        const body = q('#logs-body');
        body.innerHTML = '';
        const logs = await Store.getTicketAuditLog(id);
        if (!logs.length) {
            body.innerHTML = '<div class="empty-state">Keine Einträge vorhanden.</div>';
        } else {
            body.innerHTML = logs.slice().reverse().map(l => UI.logRow({
                icon: iconForLog(l.action),
                user: l.user,
                date: l.date,
                action: l.action,
                details: l.details
            })).join('');
        }
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },

    // Farbwähler: runder Farbfeld-Button, Popover mit Farbfläche, Farbton, Pipette, HEX und RGB
    colorPickerMarkup: (id, label) => `
        <div class="color-field">
            <button type="button" class="color-swatch-btn" id="${id}" popovertarget="${id}-pop" title="${label}" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="color-popover" id="${id}-pop" popover role="dialog" aria-label="${label}">
                <div class="cp-area" tabindex="0" aria-label="Sättigung und Helligkeit"><span class="cp-thumb"></span></div>
                <div class="cp-row">
                    <button type="button" class="btn-ghost btn-icon btn-sm cp-eyedrop" title="Farbe vom Bildschirm aufnehmen" aria-label="Farbe vom Bildschirm aufnehmen">${Icon('pipette', 15)}</button>
                    <span class="cp-preview"></span>
                    <input type="range" class="cp-hue" min="0" max="359" step="1" aria-label="Farbton">
                </div>
                <div class="cp-inputs">
                    <label class="cp-input cp-hex"><input type="text" maxlength="7" spellcheck="false"><span>HEX</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="0"><span>R</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="1"><span>G</span></label>
                    <label class="cp-input"><input type="number" min="0" max="255" data-ch="2"><span>B</span></label>
                </div>
            </div>
        </div>`,

    createColorPicker: (root, {
        value,
        onInput,
        onCommit
    }) => {
        const btn = root.querySelector('.color-swatch-btn');
        const pop = root.querySelector('.color-popover');
        const area = pop.querySelector('.cp-area');
        const thumb = pop.querySelector('.cp-thumb');
        const hue = pop.querySelector('.cp-hue');
        const hexIn = pop.querySelector('.cp-hex input');
        const rgbIn = [...pop.querySelectorAll('[data-ch]')];
        const drop = pop.querySelector('.cp-eyedrop');
        const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
        let hsv = Utils.hexToHsv(value);
        let committed = Utils.hsvToHex(hsv);

        const render = (skip) => {
            const hex = Utils.hsvToHex(hsv);
            root.style.setProperty('--cp-hue', hsv.h);
            root.style.setProperty('--cp-color', hex);
            thumb.style.left = `${hsv.s * 100}%`;
            thumb.style.top = `${(1 - hsv.v) * 100}%`;
            if (skip !== 'hue') hue.value = hsv.h;
            if (skip !== 'hex') hexIn.value = hex.toUpperCase();
            if (skip !== 'rgb') {
                const n = parseInt(hex.slice(1), 16);
                [(n >> 16) & 255, (n >> 8) & 255, n & 255].forEach((c, i) => {
                    rgbIn[i].value = c;
                });
            }
            return hex;
        };
        const change = (skip) => {
            const hex = render(skip);
            if (onInput) onInput(hex);
        };
        const commit = () => {
            const hex = Utils.hsvToHex(hsv);
            if (hex !== committed && onCommit) onCommit(hex);
            committed = hex;
        };

        // Farbfläche: ziehen und Pfeiltasten
        const fromPointer = (e) => {
            const r = area.getBoundingClientRect();
            hsv.s = clamp((e.clientX - r.left) / r.width);
            hsv.v = 1 - clamp((e.clientY - r.top) / r.height);
            change();
        };
        area.onpointerdown = (e) => {
            area.setPointerCapture(e.pointerId);
            fromPointer(e);
            area.onpointermove = fromPointer;
        };
        area.onpointerup = area.onpointercancel = () => {
            area.onpointermove = null;
            commit();
        };
        area.onkeydown = (e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const moves = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, step],
                ArrowDown: [0, -step]
            };
            if (!moves[e.key]) return;
            e.preventDefault();
            hsv.s = clamp(hsv.s + moves[e.key][0]);
            hsv.v = clamp(hsv.v + moves[e.key][1]);
            change();
            commit();
        };

        hue.oninput = () => {
            hsv.h = Number(hue.value);
            change('hue');
        };
        hue.onchange = commit;
        hexIn.onchange = () => {
            const hex = Utils.normalizeHex(hexIn.value);
            if (hex) hsv = Utils.hexToHsv(hex);
            change();
            commit();
        };
        rgbIn.forEach(inp => {
            inp.onchange = () => {
                const hex = '#' + rgbIn.map(x => clamp(Math.round(Number(x.value) || 0), 0, 255).toString(16).padStart(2, '0')).join('');
                hsv = Utils.hexToHsv(hex);
                change();
                commit();
            };
        });
        [hexIn, ...rgbIn].forEach(inp => inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inp.blur();
        }));

        if (window.EyeDropper) {
            drop.onclick = async () => {
                try {
                    const res = await new window.EyeDropper().open();
                    hsv = Utils.hexToHsv(res.sRGBHex);
                    change();
                    commit();
                } catch {}
            };
        } else {
            drop.hidden = true;
        }

        // Popover unter dem Farbfeld – gleiche Regel wie bei Auswahllisten: immer nach unten
        const place = () => {
            const r = btn.getBoundingClientRect();
            const w = pop.offsetWidth;
            pop.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
            pop.style.top = `${r.bottom + 10}px`;
        };
        pop.addEventListener('beforetoggle', (e) => {
            if (e.newState === 'open') UI.ensureSpaceBelow(btn, 330);
        });
        pop.addEventListener('toggle', (e) => {
            const open = e.newState === 'open';
            btn.setAttribute('aria-expanded', open);
            if (open) {
                place();
                window.addEventListener('scroll', place, true);
                window.addEventListener('resize', place);
            } else {
                window.removeEventListener('scroll', place, true);
                window.removeEventListener('resize', place);
                commit();
            }
        });

        render();
        if (window.lucide) lucide.createIcons();
        return {
            setValue: (hex) => {
                const norm = Utils.normalizeHex(hex);
                if (!norm) return;
                hsv = Utils.hexToHsv(norm);
                committed = norm;
                render();
            }
        };
    },

    // Eine Protokollzeile – gleich für Ticket- und System-Protokoll
    logRow: ({
        icon,
        user,
        date,
        action,
        details
    }) => `
        <div class="log-row">
            <div class="log-icon">${Icon(icon, 16)}</div>
            <div class="log-main">
                <div class="log-meta"><span>${Utils.esc(user)}</span><span>${Utils.fmtDate(date)}</span></div>
                <div class="log-action">${Utils.esc(action)}</div>
                ${details ? `<div class="log-details">${Utils.esc(details)}</div>` : ''}
            </div>
        </div>`,

    // Aufklappende Listen öffnen immer nach unten; die Höhe richtet sich nach dem Platz im Fenster
    dropdownMaxHeight: (anchor) => {
        const below = window.innerHeight - anchor.getBoundingClientRect().bottom - 18;
        return Math.max(120, Math.min(260, Math.floor(below)));
    },

    // Reicht der Platz unter dem Feld nicht, wird der nächste scrollbare Bereich (oder die Seite) nachgezogen
    ensureSpaceBelow: (anchor, needed) => {
        const missing = needed - (window.innerHeight - anchor.getBoundingClientRect().bottom);
        if (missing <= 0) return;
        let el = anchor.parentElement;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                const room = el.scrollHeight - el.clientHeight - el.scrollTop;
                const step = Math.min(missing, room);
                if (step > 0) el.scrollTop += step;
                if (step >= missing) return;
                break;
            }
            el = el.parentElement;
        }
        window.scrollBy(0, missing);
    },

    // Zeigt die je Kategorie definierten eigenen Felder in einem Ticket-Formular an.
    // Eigener Datum/Uhrzeit-Picker im App-Design -- ersetzt den nativen datetime-local-Kalender,
    // der sich (Browser-UI) nicht ins dunkle Theme einfügt.
    dateTimePickerMarkup: (id) => `
        <div class="dtp-field" id="${id}">
            <button type="button" class="dtp-trigger">
                <span class="dtp-value is-placeholder">Datum &amp; Uhrzeit wählen...</span>
                ${Icon('calendar', 15)}
            </button>
            <div class="dtp-popover">
                <div class="dtp-header">
                    <button type="button" class="dtp-nav dtp-prev" aria-label="Vorheriger Monat">${Icon('chevron-left', 16)}</button>
                    <span class="dtp-month-label"></span>
                    <button type="button" class="dtp-nav dtp-next" aria-label="Nächster Monat">${Icon('chevron-right', 16)}</button>
                </div>
                <div class="dtp-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
                <div class="dtp-grid"></div>
                <div class="dtp-time-row">
                    <div class="dtp-time-col dtp-hour" role="listbox" aria-label="Stunde"></div>
                    <span class="dtp-time-sep">:</span>
                    <div class="dtp-time-col dtp-minute" role="listbox" aria-label="Minute"></div>
                </div>
                <div class="dtp-actions">
                    <button type="button" class="dtp-clear">Löschen</button>
                    <button type="button" class="dtp-today">Heute</button>
                </div>
            </div>
        </div>`,

    formatDateText: value => {
        const digits = String(value).replace(/\D/g, '').slice(0, 8);
        let out = digits.slice(0, 2);
        if (digits.length > 2) out += '.' + digits.slice(2, 4);
        if (digits.length > 4) out += '.' + digits.slice(4, 8);
        return out;
    },
    formatTimeText: value => {
        const digits = String(value).replace(/\D/g, '').slice(0, 4);
        return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    },
    bindDateInput: input => input.addEventListener('input', () => { input.value = UI.formatDateText(input.value); }),
    bindTimeInput: input => input.addEventListener('input', () => { input.value = UI.formatTimeText(input.value); }),
    dateFieldMarkup: (id, value = '', dtpId = `${id}-dtp`) => `
        <div class="date-input-row">
            <input id="${id}" type="text" inputmode="numeric" placeholder="dd.mm.jjjj" value="${Utils.esc(value)}">
            <button type="button" class="btn-ghost btn-icon" id="${id}-cal" title="Kalender öffnen" aria-label="Kalender öffnen">${Icon('calendar', 16)}</button>
        </div>
        <div id="${id}-host" hidden>${UI.dateTimePickerMarkup(dtpId)}</div>`,
    bindDateField: (id, { initialMs = null, onChange = null } = {}) => {
        const input = q(`#${id}`);
        const btn = q(`#${id}-cal`);
        UI.bindDateInput(input);
        const picker = UI.createDateTimePicker(q(`#${id}-host .dtp-field`), {
            value: initialMs,
            anchor: btn,
            dateOnly: true,
            onChange: ms => {
                input.value = ms ? Utils.fmtDateOnly(new Date(ms)) : '';
                if (onChange) onChange(ms);
            }
        });
        input.addEventListener('change', () => {
            const ms = Utils.parseGermanDateTime(input.value.trim(), '00:00');
            picker.setValue(ms);
        });
        btn.onclick = () => picker.open();
        return picker;
    },

    createDateTimePicker: (root, { value = null, onChange = null, anchor = null, dateOnly = false } = {}) => {
        const trigger = root.querySelector('.dtp-trigger');
        const valueLabel = root.querySelector('.dtp-value');
        const monthLabel = root.querySelector('.dtp-month-label');
        const grid = root.querySelector('.dtp-grid');
        const hourSel = root.querySelector('.dtp-hour');
        const minuteSel = root.querySelector('.dtp-minute');
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

        let hourVal = 0;
        let minuteVal = 0;
        const renderTimeCol = (col, count, current, onPick) => {
            col.innerHTML = Array.from({ length: count }, (_, n) => `<button type="button" class="dtp-time-opt${n === current ? ' is-selected' : ''}" data-value="${n}">${String(n).padStart(2, '0')}</button>`).join('');
            col.querySelectorAll('.dtp-time-opt').forEach(btn => {
                btn.onclick = () => onPick(Number(btn.dataset.value));
            });
            const active = col.querySelector('.is-selected');
            if (active) col.scrollTop = active.offsetTop - col.clientHeight / 2 + active.offsetHeight / 2;
        };
        const renderTimeCols = () => {
            renderTimeCol(hourSel, 24, hourVal, h => { hourVal = h; renderTimeCols(); applyTime(); });
            renderTimeCol(minuteSel, 60, minuteVal, m => { minuteVal = m; renderTimeCols(); applyTime(); });
        };

        let selected = value ? new Date(value) : null;
        let viewDate = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        const renderLabel = () => {
            if (selected) {
                valueLabel.textContent = fmt(selected);
                valueLabel.classList.remove('is-placeholder');
            } else {
                valueLabel.textContent = 'Datum & Uhrzeit wählen...';
                valueLabel.classList.add('is-placeholder');
            }
        };

        const renderGrid = () => {
            monthLabel.textContent = `${monthNames[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
            const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
            const startOffset = (firstOfMonth.getDay() + 6) % 7; // Woche beginnt Montag
            const gridStart = new Date(firstOfMonth);
            gridStart.setDate(gridStart.getDate() - startOffset);
            const today = new Date();
            const cells = [];
            for (let i = 0; i < 42; i++) {
                const d = new Date(gridStart);
                d.setDate(gridStart.getDate() + i);
                const classes = ['dtp-day'];
                if (d.getMonth() !== viewDate.getMonth()) classes.push('is-outside');
                if (sameDay(d, today)) classes.push('is-today');
                if (sameDay(d, selected)) classes.push('is-selected');
                cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${d.toISOString()}">${d.getDate()}</button>`);
            }
            grid.innerHTML = cells.join('');
            grid.querySelectorAll('.dtp-day').forEach(btn => {
                btn.onclick = () => {
                    const picked = new Date(btn.dataset.date);
                    const h = dateOnly ? 0 : (selected ? selected.getHours() : new Date().getHours());
                    const m = dateOnly ? 0 : (selected ? selected.getMinutes() : new Date().getMinutes());
                    selected = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), h, m);
                    viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
                    hourVal = h;
                    minuteVal = m;
                    renderTimeCols();
                    renderGrid();
                    renderLabel();
                    if (onChange) onChange(selected.getTime());
                };
            });
        };

        const applyTime = () => {
            if (!selected) selected = new Date();
            selected.setHours(hourVal, minuteVal, 0, 0);
            renderLabel();
            if (onChange) onChange(selected.getTime());
        };
        if (selected) {
            hourVal = selected.getHours();
            minuteVal = selected.getMinutes();
        }
        renderTimeCols();

        root.querySelector('.dtp-clear').onclick = () => {
            selected = null;
            renderLabel();
            renderGrid();
            if (onChange) onChange(null);
        };
        if (dateOnly) root.querySelector('.dtp-time-row').hidden = true;
        root.querySelector('.dtp-today').onclick = () => {
            const now = new Date();
            if (dateOnly) selected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            else selected = selected ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), selected.getHours(), selected.getMinutes()) : now;
            viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
            hourVal = selected.getHours();
            minuteVal = selected.getMinutes();
            renderTimeCols();
            renderGrid();
            renderLabel();
            if (onChange) onChange(selected.getTime());
        };
        root.querySelector('.dtp-prev').onclick = () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
            renderGrid();
        };
        root.querySelector('.dtp-next').onclick = () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
            renderGrid();
        };

        // Das Popover wird beim Öffnen aus dem Modal gelöst und direkt an <body> gehängt --
        // sonst schneidet das scrollbare .modal-body den Kalender ab, sobald er größer als
        // der sichtbare Rest des Dialogs ist.
        const popover = root.querySelector('.dtp-popover');
        popover.classList.add('dtp-popover-detached');
        if (root.id) popover.id = `${root.id}-popover`;
        const positionPopover = () => {
            const rect = (anchor || trigger).getBoundingClientRect();
            const popH = popover.offsetHeight || 420;
            const popW = popover.offsetWidth || 280;
            let top = rect.bottom + 6;
            if (top + popH > window.innerHeight - 8) top = Math.max(8, rect.top - popH - 6);
            let left = rect.left;
            if (left + popW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popW - 8);
            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
            popover.style.width = `${rect.width < 240 ? 280 : rect.width}px`;
        };
        const close = () => {
            root.classList.remove('open');
            popover.classList.remove('open');
        };
        const open = () => {
            qa('.dtp-popover-detached.open').forEach(p => p.classList.remove('open'));
            qa('.dtp-field.open').forEach(f => f.classList.remove('open'));
            if (popover.parentElement !== document.body) document.body.appendChild(popover);
            root.classList.add('open');
            positionPopover();
            popover.classList.add('open');
        };
        trigger.onclick = (e) => {
            e.stopPropagation();
            root.classList.contains('open') ? close() : open();
        };
        if (root._dtpOutside) window.removeEventListener('click', root._dtpOutside);
        root._dtpOutside = (e) => { if (!root.contains(e.target) && !popover.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); };
        window.addEventListener('click', root._dtpOutside);
        if (root._dtpReposition) window.removeEventListener('resize', root._dtpReposition);
        root._dtpReposition = () => { if (root.classList.contains('open')) positionPopover(); };
        window.addEventListener('resize', root._dtpReposition);

        renderGrid();
        renderLabel();

        return {
            getValue: () => selected ? selected.getTime() : null,
            setValue: (ms) => {
                selected = ms ? new Date(ms) : null;
                viewDate = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date();
                if (selected) {
                    hourVal = selected.getHours();
                    minuteVal = selected.getMinutes();
                }
                renderTimeCols();
                renderGrid();
                renderLabel();
            },
            open,
            close
        };
    },

    renderCustomFieldsForm: (container, fields, values = {}) => {
        if (!container) return;
        if (!fields.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = fields.map(f => `
            <div class="field">
                <label for="cf-${f.id}">${Utils.esc(f.label)}${f.required ? ' *' : ''}</label>
                ${f.type === 'select'
                ? `<select id="cf-${f.id}" data-field-id="${f.id}" data-field-label="${Utils.esc(f.label)}" data-field-required="${f.required ? '1' : ''}"><option value="">Bitte wählen...</option>${(f.options || []).map(o => `<option value="${Utils.esc(o)}" ${values[f.id] === o ? 'selected' : ''}>${Utils.esc(o)}</option>`).join('')}</select>`
                : `<input id="cf-${f.id}" data-field-id="${f.id}" data-field-label="${Utils.esc(f.label)}" data-field-required="${f.required ? '1' : ''}" type="${f.type === 'number' ? 'number' : 'text'}" value="${Utils.esc(values[f.id] || '')}">`}
            </div>`).join('');
    },
    // Zeigt die ausgefüllten eigenen Felder eines Tickets schreibgeschützt an (Ticket-Detailansicht).
    renderCustomFieldsDisplay: (container, fields, values = {}) => {
        if (!container) return;
        const filled = fields.filter(f => String(values[f.id] ?? '').trim());
        if (!filled.length) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.innerHTML = filled.map(f => `<div class="cf-display-item"><strong>${Utils.esc(f.label)}</strong><span>${Utils.esc(values[f.id])}</span></div>`).join('');
    },
    // Liest die Werte aus renderCustomFieldsForm; missing enthält die Labels fehlender Pflichtfelder.
    readCustomFieldsForm: (container) => {
        const values = {};
        const missing = [];
        if (!container) return { values, missing };
        container.querySelectorAll('[data-field-id]').forEach(el => {
            const val = el.value.trim();
            if (el.dataset.fieldRequired && !val) missing.push(el.dataset.fieldLabel);
            if (val) values[el.dataset.fieldId] = val;
        });
        return { values, missing };
    },

    createMultiSelect: (container, options, initialValues = [], onChange = null, config = {}) => {
        // Mehrfachauswahl im selben Look wie <select> (Stile in style.css, Abschnitt "Auswahllisten")
        // config.single: Einfachauswahl mit Suche statt eines nativen <select> (z.B. Vorgesetzte Person, Kategorien)
        const single = !!config.single;
        const emptyLabel = config.emptyLabel || (single ? 'Keine' : 'Bitte wählen...');
        container.innerHTML = '';
        container.classList.add('multi-select-container');
        if (single) container.classList.add('single-select-container');
        container.classList.remove('open');

        const header = document.createElement('div');
        header.className = 'multi-select-header';
        header.tabIndex = 0;
        header.setAttribute('role', 'button');
        header.setAttribute('aria-haspopup', 'listbox');
        header.setAttribute('aria-expanded', 'false');

        const dropdown = document.createElement('div');
        dropdown.className = 'multi-select-dropdown';
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('aria-multiselectable', 'true');

        const inputs = [];
        const radioName = single ? `ss-${Utils.uid()}` : null;

        const updateHeader = () => {
            const selected = inputs.filter(i => i.checked);
            let text = emptyLabel;
            if (single) {
                if (selected.length) text = selected[0].dataset.label || selected[0].value;
            } else if (selected.length > 2) text = `${selected.length} ausgewählt`;
            else if (selected.length) text = selected.map(i => i.dataset.label || i.value).join(', ');
            header.innerHTML = `<span class="ms-text${selected.length ? '' : ' is-placeholder'}">${Utils.esc(text)}</span><span class="ms-arrow" aria-hidden="true"></span>`;
        };

        const singleValue = () => single ? (inputs.find(i => i.checked)?.value || '') : null;
        const emit = () => onChange && onChange(single ? singleValue() : inputs.filter(i => i.checked).map(i => i.value));

        const effectiveOptions = single && !options.some(o => (typeof o === 'object' ? o.value : o) === '')
            ? [{ value: '', label: emptyLabel }, ...options] : options;
        effectiveOptions.forEach(opt => {
            const isObj = typeof opt === 'object';
            const val = isObj ? opt.value : opt;
            const label = isObj ? opt.label : opt;

            const row = document.createElement('label');
            row.className = 'ms-row';

            const box = document.createElement('input');
            box.type = single ? 'radio' : 'checkbox';
            if (single) box.name = radioName;
            box.value = val;
            box.dataset.label = label;
            box.checked = single ? initialValues === val : initialValues.includes(val);
            box.onchange = () => {
                updateHeader();
                emit();
                if (single) close();
            };
            inputs.push(box);

            const textSpan = document.createElement('span');
            textSpan.textContent = label;

            row.appendChild(box);
            row.appendChild(textSpan);
            dropdown.appendChild(row);
        });

        {
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'ms-search';
            search.placeholder = 'Suchen...';
            search.setAttribute('aria-label', 'Auswahl durchsuchen');
            search.oninput = () => {
                const term = search.value.trim().toLowerCase();
                dropdown.querySelectorAll('.ms-row').forEach(row => {
                    row.hidden = !!term && !row.textContent.toLowerCase().includes(term);
                });
            };
            dropdown.prepend(search);
        }

        container.appendChild(header);
        container.appendChild(dropdown);
        updateHeader();

        const close = () => {
            container.classList.remove('open');
            dropdown.classList.remove('open');
            header.setAttribute('aria-expanded', 'false');
            // Zurück in den Container legen, statt es dauerhaft an <body> hängen zu lassen
            // (verhindert verwaiste Elemente, falls der umgebende Dialog währenddessen geschlossen wird)
            container.appendChild(dropdown);
        };

        // Das Dropdown wird beim Öffnen an <body> angehängt (fixed positioniert über dem Feld) --
        // sonst schneidet ein scrollbarer/überlaufverborgener Vorfahre (z. B. .modal-body in kleinen
        // Dialogen) die Liste ab, obwohl eigentlich genug Platz auf dem Bildschirm wäre.
        const open = () => {
            document.querySelectorAll('.multi-select-dropdown.open').forEach(d => {
                if (d !== dropdown) { d.classList.remove('open'); d.closest('.multi-select-container')?.classList.remove('open'); }
            });
            document.body.appendChild(dropdown);
            const rect = header.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.width = `${rect.width}px`;
            dropdown.style.top = `${rect.bottom + 6}px`;
            dropdown.style.maxHeight = `${Math.max(120, Math.min(260, window.innerHeight - rect.bottom - 18))}px`;
            container.classList.add('open');
            dropdown.classList.add('open');
            header.setAttribute('aria-expanded', 'true');
        };

        const toggle = () => container.classList.contains('open') ? close() : open();

        header.onclick = (e) => {
            e.stopPropagation();
            toggle();
        };
        header.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            } else if (e.key === 'Escape') {
                close();
            }
        };

        // Klick außerhalb schließt – Listener nur einmal pro Container
        if (container._msOutside) window.removeEventListener('click', container._msOutside);
        container._msOutside = (e) => {
            if (!container.contains(e.target) && !dropdown.contains(e.target)) close();
        };
        window.addEventListener('click', container._msOutside);

        return {
            getValue: () => single ? singleValue() : inputs.filter(i => i.checked).map(i => i.value),
            setDisabled: (off) => container.classList.toggle('is-disabled', !!off),
            setValue: (vals) => {
                if (single) inputs.forEach(i => i.checked = i.value === (vals || ''));
                else inputs.forEach(i => i.checked = vals.includes(i.value));
                updateHeader();
                emit();
            }
        };
    }
};
