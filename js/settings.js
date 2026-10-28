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
import { MFA } from './mfa.js';
import { Store } from './store.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { AdminBoard } from './admin-board.js';
import { UserDash } from './user-dash.js';
import { BrowserNotifications } from './browser-notifications.js';

export const Settings = {
    defaults: {
        theme: 'dark',
        accentColor: '#6366f1',
        lang: 'de',
        bgType: 'default',
        bgValue: ''
    },
    init: async () => {
        const s = await Store.getSettings();
        Settings.apply(s);
        const toggle = q('#theme-toggle');
        if (toggle) {
            toggle.innerHTML = Icon('settings', 16);
            toggle.title = Lang.t('settings');
            toggle.id = 'btn-settings';
            toggle.classList.add('btn-icon');
            toggle.onclick = Settings.openModal;
            if (window.lucide) lucide.createIcons();
        }
    },

    // Jeder Hintergrund hat eine helle und eine dunkle Variante (siehe --bgp-* in style.css)
    bgPresets: [{
            type: 'default',
            val: '',
            preset: 'bg-default',
            get label() { return Lang.t('bgPresetDefault'); },
            icon: 'moon-star'
        },
        {
            type: 'class',
            val: 'bg-aurora',
            preset: 'bg-aurora',
            label: 'Aurora',
            icon: 'sparkles'
        },
        {
            type: 'class',
            val: 'bg-nebula',
            preset: 'bg-nebula',
            get label() { return Lang.t('bgPresetNebula'); },
            icon: 'orbit'
        },
        {
            type: 'class',
            val: 'bg-ocean',
            preset: 'bg-ocean',
            get label() { return Lang.t('bgPresetOcean'); },
            icon: 'waves'
        },
        {
            type: 'class',
            val: 'bg-forest',
            preset: 'bg-forest',
            get label() { return Lang.t('bgPresetForest'); },
            icon: 'trees'
        },
        {
            type: 'class',
            val: 'bg-ember',
            preset: 'bg-ember',
            get label() { return Lang.t('bgPresetEmber'); },
            icon: 'flame'
        },
        {
            type: 'class',
            val: 'bg-sand',
            preset: 'bg-sand',
            get label() { return Lang.t('bgPresetSand'); },
            icon: 'mountain'
        },
        {
            type: 'class',
            val: 'bg-graphite',
            preset: 'bg-graphite',
            get label() { return Lang.t('bgPresetGraphite'); },
            icon: 'grid-3x3'
        }
    ],

    // Alte Hintergrund-Werte auf die neuen Vorlagen abbilden
    normalizeBg: (s) => {
        const legacy = {
            'bg-anim-space': 'bg-aurora',
            'bg-anim-nebula': 'bg-nebula',
            'bg-anim-clouds': 'bg-aurora',
            'bg-anim-waves': 'bg-ocean',
            'linear-gradient(180deg, #0f172a, #1e293b)': 'bg-ocean',
            'linear-gradient(180deg, #064e3b, #065f46)': 'bg-forest',
            'linear-gradient(180deg, #f5f3ff, #ede9fe)': 'bg-nebula',
            'linear-gradient(180deg, #f0fdf4, #dcfce7)': 'bg-forest'
        };
        if ((s.bgType === 'class' || s.bgType === 'color') && legacy[s.bgValue]) {
            s.bgType = 'class';
            s.bgValue = legacy[s.bgValue];
        }
        return s;
    },
    applyAccent: (hex) => {
        const root = document.documentElement.style;
        root.setProperty('--primary-solid', hex);
        root.setProperty('--primary-rgb', Utils.hexToRgb(hex));
        root.setProperty('--primary-grad', `linear-gradient(135deg, ${hex}, ${Utils.adjustColor(hex, -20)})`);
    },
    applyBranding: (s) => {
        const name = (s.generalConfig?.portalName || s.companyConfig?.name || 'Support Portal').trim();
        qa('.brand-mini').forEach(el => {
            el.textContent = name;
        });
        const suffix = document.body.dataset.guard === 'admin' ? 'Admin' : document.body.dataset.guard === 'user' ? 'Dashboard' : 'Login';
        document.title = `${name} | ${suffix}`;
    },
    apply: (s) => {
        const isLight = s.theme === 'light';
        if (isLight) document.documentElement.className = 'light';
        else document.documentElement.className = '';

        Settings.applyAccent(s.accentColor);
        Settings.applyBranding(s);

        // Applied Background
        Settings.normalizeBg(s);
        const stars = q('#stars');
        const overlay = 'rgba(0,0,0,0.4)';

        // Clear body classes for animations
        document.body.className = '';

        if (s.bgType === 'default') {
            document.body.style.background = '';
            if (stars) stars.style.display = isLight ? 'none' : 'block';
        } else if (s.bgType === 'color') {
            document.body.style.background = isLight ? s.bgValue : `linear-gradient(${overlay}, ${overlay}), ${s.bgValue}`;
            if (stars) stars.style.display = 'none';
        } else if (s.bgType === 'image') {
            // Eigene Bilder sind oft dunkel fotografiert -- im hellen Theme braucht es einen
            // hellen statt dunklen Schleier, sonst wirkt alles (z. B. die Navbar) weiterhin dunkel.
            const imageOverlay = isLight ? 'rgba(255,255,255,0.55)' : overlay;
            document.body.style.background = `linear-gradient(${imageOverlay}, ${imageOverlay}), url(${s.bgValue}) no-repeat center center fixed`;
            document.body.style.backgroundSize = 'cover';
            if (stars) stars.style.display = 'none';
        } else if (s.bgType === 'class') {
            document.body.className = s.bgValue;
            document.body.style.background = '';
            if (stars) stars.style.display = 'none';
        }
    },
    // Default-Parameter greift nur bei "undefined", nicht bei explizitem "null" -- u.absence ist
    // bei fehlender Abwesenheit immer null (siehe mapApiUserToLegacy), deshalb zusätzlich "|| {}".
    absencePeriodMarkup: (absence, prefix = 'abs') => { absence = absence || {}; return `
        <div class="form-grid">
            <div class="field">
                <label for="${prefix}-from">${Lang.t('dateFromEmptyImmediate')}</label>
                ${UI.dateFieldMarkup(`${prefix}-from`, absence.fromMs ? Utils.fmtDateOnly(new Date(absence.fromMs)) : '', `${prefix}-from-dtp`)}
            </div>
            <div class="field">
                <label for="${prefix}-until">${Lang.t('dateUntilEmptyOpen')}</label>
                ${UI.dateFieldMarkup(`${prefix}-until`, absence.untilMs ? Utils.fmtDateOnly(new Date(absence.untilMs)) : '', `${prefix}-until-dtp`)}
            </div>
        </div>`; },

    bindAbsencePeriod: (prefix = 'abs', absence = {}) => {
        UI.bindDateField(`${prefix}-from`, { initialMs: absence.fromMs || null });
        UI.bindDateField(`${prefix}-until`, { initialMs: absence.untilMs || null });
    },

    readAbsencePeriod: (prefix = 'abs') => {
        const fromRaw = q(`#${prefix}-from`)?.value.trim() || '';
        const untilRaw = q(`#${prefix}-until`)?.value.trim() || '';
        const fromMs = fromRaw ? Utils.parseGermanDateTime(fromRaw, '00:00') : null;
        const untilMs = untilRaw ? Utils.parseGermanDateTime(untilRaw, '23:59') : null;
        if (fromRaw && !fromMs) throw new Error(Lang.t('enterStartDateFormat'));
        if (untilRaw && !untilMs) throw new Error(Lang.t('enterEndDateFormat'));
        if (fromMs && untilMs && untilMs < fromMs) throw new Error(Lang.t('endDateBeforeStartDate'));
        return { fromMs, untilMs };
    },

    renderAbsenceArea: async (user) => {
        const field = q('#s-absence-field'), area = q('#s-absence-area');
        if (!field || !area) return;
        field.hidden = !['admin', 'superadmin'].includes(user?.role);
        if (field.hidden) return;
        const tr = (de, en) => Lang.current === 'en' ? en : de;
        try {
            const users = await Store.getUserDirectory();
            const response = await fetch('/api/v2/users/me/absences', { credentials: 'same-origin' });
            if (!response.ok) throw new Error(tr('Abwesenheiten konnten nicht geladen werden.', 'Could not load absences.'));
            const periods = (await response.json()).absences || [];
            area.innerHTML = `
                <p class="hint">${tr('Mehrere Zeiträume im Voraus planen. Überschneidungen sind nicht erlaubt. Die Vertretung übernimmt offene Tickets erst ab Beginn des jeweiligen Zeitraums.', 'Plan several periods ahead. Periods may not overlap. The substitute receives open tickets when each period starts.')}</p>
                ${Settings.absencePeriodMarkup({}, 's-abs')}
                <div class="field"><label for="s-abs-sub">${Lang.t('substitute')}</label><select id="s-abs-sub"><option value="">${Lang.t('noneTicketsBackToTeam')}</option>${users.filter(u => u.id !== user.id && ['admin', 'superadmin'].includes(u.role) && !u.accountArchived).map(u => `<option value="${Utils.esc(u.id)}">${Utils.esc(u.name || u.username)}</option>`).join('')}</select></div>
                <label class="check-row"><input type="checkbox" id="s-abs-visible" checked><span>${Lang.t('showOtherAdminsAbsent')}</span></label>
                <button type="button" class="btn-primary btn-sm" id="btn-save-absence">${Icon('plus', 15)}${tr('Zeitraum hinzufügen', 'Add period')}</button>
                <div id="s-absence-periods" class="managed-list"></div>`;
            Settings.bindAbsencePeriod('s-abs', {});
            const list = q('#s-absence-periods');
            for (const period of periods) {
                const row = document.createElement('div'); row.className = 'absence-overview-row';
                const substitute = users.find(candidate => candidate.id === period.substitute_user_id);
                const label = document.createElement('span');
                label.textContent = `${period.from_at ? Utils.fmtDateOnly(new Date(period.from_at)) : tr('Ab sofort', 'From now')} – ${period.until_at ? Utils.fmtDateOnly(new Date(period.until_at)) : tr('Offen', 'Open ended')} · ${substitute?.name || substitute?.username || Lang.t('none')}`;
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-secondary btn-sm'; remove.textContent = Lang.t('delete');
                remove.onclick = () => UI.confirm(tr('Diesen Abwesenheitszeitraum entfernen?', 'Remove this absence period?'), async () => {
                    const result = await fetch('/api/v2/users/me/absences/' + encodeURIComponent(period.id), { method: 'DELETE', credentials: 'same-origin' });
                    if (!result.ok) return UI.toast(Lang.t('saveFailed'));
                    Store._meCache = null; Store._usersCache = null;
                    await Settings.renderAbsenceArea(user);
                    if ((!period.from_at || new Date(period.from_at) <= new Date()) && (!period.until_at || new Date(period.until_at) >= new Date())) await AdminBoard.openAbsenceReturnPopup(user);
                });
                row.append(label, remove); list.appendChild(row);
            }
            if (!periods.length) list.textContent = tr('Keine Abwesenheiten geplant.', 'No absences planned.');
            q('#btn-save-absence').onclick = async event => {
                const button = event.currentTarget; button.disabled = true;
                try {
                    const period = Settings.readAbsencePeriod('s-abs');
                    const result = await fetch('/api/v2/users/me/absence', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ active: true, append: true, from_at: period.fromMs ? new Date(period.fromMs).toISOString() : null,
                            until_at: period.untilMs ? new Date(period.untilMs).toISOString() : null, substitute_user_id: q('#s-abs-sub').value || null, visible: q('#s-abs-visible').checked }) });
                    if (!result.ok) { const problem = await result.json(); throw new Error(problem.error === 'absence_periods_overlap' ? tr('Der Zeitraum überschneidet sich mit einer vorhandenen Abwesenheit.', 'This period overlaps an existing absence.') : tr('Zeitraum konnte nicht gespeichert werden.', 'Could not save the period.')); }
                    Store._meCache = null; Store._usersCache = null;
                    UI.toast(Lang.t('absenceSavedToast')); await Settings.renderAbsenceArea(user);
                } catch (error) { UI.toast(error.message); } finally { button.disabled = false; }
            };
        } catch (error) { area.textContent = error.message; }
    },

    renderAccountArea: (user, settings) => {
        const field = q('#s-account-field');
        const area = q('#s-account-area');
        if (!field || !area) return;
        if (!user) { field.hidden = true; return; }
        const editable = { name: true, email: true, department: false, phone: false, mobile: false, jobTitle: false, officeLocation: false, ...(settings.accountConfig?.editable || {}) };
        const rows = [
            { key: 'name', label: Lang.t('name'), value: user.name || '' },
            { key: 'email', label: Lang.t('email'), value: user.email || '' },
            { key: 'department', label: Lang.t('department'), value: user.department || '' },
            { key: 'phone', label: Lang.t('phone'), value: user.phone || '' },
            { key: 'mobile', label: Lang.t('mobile'), value: user.mobile || '' },
            { key: 'jobTitle', label: Lang.t('jobTitle'), value: user.jobTitle || '' },
            { key: 'officeLocation', label: Lang.t('location'), value: user.officeLocation || '' },
        ];
        const anyEditable = rows.some(row => editable[row.key]);
        field.hidden = false;
        area.innerHTML = `
            <div class="form-grid">
                ${rows.map(row => `<div class="field"><label for="acc-${row.key}">${row.label}${editable[row.key] ? '' : ` <span class="hint">${Lang.t('lockedByAdmin')}</span>`}</label><input id="acc-${row.key}" type="text" value="${Utils.esc(row.value)}"${editable[row.key] ? '' : ' disabled'}></div>`).join('')}
            </div>
            ${anyEditable ? `<div class="setting-row"><span class="hint">${Lang.t('onlyEditableFieldsHint')}</span>
                <button class="btn-primary btn-sm" id="btn-save-account">${Icon('save', 15)}${Lang.t('saveAccountButton')}</button>
            </div>` : ''}`;
        q('#btn-save-account')?.addEventListener('click', async () => {
            const users = await Store.getUsers();
            const target = users.find(u => u.id === user.id);
            if (!target) return;
            const emailValue = q('#acc-email')?.value.trim();
            if (editable.email && emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return UI.toast(Lang.t('enterValidEmailAddress'));
            rows.forEach(row => {
                const el = q(`#acc-${row.key}`);
                if (el && editable[row.key]) target[row.key] = el.value.trim();
            });
            await Store.saveUsers(users);
            await Store.addGlobalLog('Konto geändert', `Benutzer: ${target.username}`);
            UI.toast(Lang.t('accountSavedToast'));
        });
    },

    openModal: async () => {
        let modal = q('#settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'settings-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-lg">
                    <div class="modal-header">
                        <h3>${Icon('settings', 18)} ${Lang.t('portalSettings')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon close-m" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body form-grid">
                        <div class="field field-wide" id="s-absence-field" hidden>
                            <label>${Lang.t('absenceAndSubstitute')}</label>
                            <div id="s-absence-area"></div>
                        </div>
                        <div class="field">
                            <label>${Lang.t('themeMode')}</label>
                            <div class="tabs segmented">
                                <button type="button" class="tab-btn s-theme-btn" data-val="dark">${Icon('moon', 16)}${Lang.t('dark')}</button>
                                <button type="button" class="tab-btn s-theme-btn" data-val="light">${Icon('sun', 16)}${Lang.t('light')}</button>
                            </div>
                        </div>
                        <div class="field">
                            <label>${Lang.t('language')}</label>
                            <select id="s-lang"><option value="de">Deutsch</option><option value="en">English</option></select>
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('accentColor')}</label>
                            <div class="accent-picker">
                                <div class="accent-presets" role="group" aria-label="${Lang.t('accentColor')}">
                                    <button type="button" class="accent-preset accent-preset-indigo" data-color="#6366f1" title="Indigo" aria-label="Indigo"></button>
                                    <button type="button" class="accent-preset accent-preset-sky" data-color="#63bce8" title="${Lang.t('colorSky')}" aria-label="${Lang.t('colorSky')}"></button>
                                    <button type="button" class="accent-preset accent-preset-green" data-color="#10b981" title="${Lang.t('colorGreen')}" aria-label="${Lang.t('colorGreen')}"></button>
                                    <button type="button" class="accent-preset accent-preset-orange" data-color="#f59e0b" title="${Lang.t('colorOrange')}" aria-label="${Lang.t('colorOrange')}"></button>
                                    <button type="button" class="accent-preset accent-preset-red" data-color="#ef4444" title="${Lang.t('colorRed')}" aria-label="${Lang.t('colorRed')}"></button>
                                </div>
                                <span class="accent-picker-divider"></span>
                                ${UI.colorPickerMarkup('s-color', Lang.t('customColor'))}
                                <span class="accent-picker-label" id="s-color-label"></span>
                            </div>
                        </div>
                        <div class="field field-wide">
                            <label>${Lang.t('background')}</label>
                            <div id="s-bg-grid" class="bg-grid">
                                <!-- Rendered by renderBgGrid -->
                            </div>
                            <input type="file" id="s-bg-file" accept="image/*">
                        </div>
                        <div class="field field-wide" id="s-sec-field">
                            <label>${Lang.t('security')}</label>
                            <div id="s-sec-area">
                                <!-- Rendered dynamically -->
                            </div>
                        </div>
                        <div class="field field-wide" id="s-account-field" hidden>
                            <label>${Lang.t('accountLabel')}</label>
                            <div id="s-account-area"></div>
                        </div>
                        <div class="field field-wide" id="s-notif-field">
                            <label>${Lang.t('notificationsLabel')}</label>
                            <p class="hint">${Lang.t('notificationsHint')}</p>
                            <div id="s-notif-area" class="notif-personal-list"></div>
                            <label class="check-row"><input id="s-browser-notifications" type="checkbox"><span id="s-browser-notifications-label"></span></label>
                            <p class="hint" id="s-browser-notifications-status" role="status"></p>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('.close-m').forEach(x => x.onclick = () => modal.classList.remove('open'));

            // Listeners
            modal.querySelectorAll('.s-theme-btn').forEach(b => {
                b.onclick = async () => {
                    const s = await Store.getSettings();
                    s.theme = b.dataset.val;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                };
            });
            Settings.colorPicker = UI.createColorPicker(modal.querySelector('.color-field'), {
                value: (await Store.getSettings()).accentColor,
                onInput: (hex) => {
                    Settings.applyAccent(hex);
                    q('#s-color-label').textContent = hex;
                },
                onCommit: async (hex) => {
                    const s = await Store.getSettings();
                    s.accentColor = hex;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                }
            });
            modal.querySelectorAll('.accent-preset').forEach(b => {
                b.onclick = async () => {
                    const s = await Store.getSettings();
                    s.accentColor = b.dataset.color;
                    await Store.saveSettings(s);
                    Settings.apply(s);
                    Settings.renderState(modal, s);
                };
            });
            q('#s-lang').onchange = async (e) => {
                const s = await Store.getSettings();
                s.lang = e.target.value;
                await Store.saveSettings(s);
                Settings.apply(s);
                Lang.current = e.target.value;
                Lang.applyToDOM();
                if (q('.kanban-board')) {
                    await AdminBoard.render();
                    await AdminBoard.renderArchive();
                }
                if (q('#user-tickets')) await UserDash.renderList();
                Lang.applyToDOM();
                q('#sys-settings-modal')?.remove();
                modal.remove();
                Settings.openModal();
            };
        }

        const s = await Store.getSettings();
        Settings.renderState(modal, s);

        // Render Security Section
        const user = await Store.currentUser();
        q('#s-sec-field').hidden = !user;
        q('#s-notif-field').hidden = !user;
        Settings.renderAccountArea(user, s);
        Settings.renderAbsenceArea(user);
        const secArea = q('#s-sec-area');
        if (user && secArea) {
            const isEnabled = user.twoFactorEnabled;
            secArea.innerHTML = `
                <div class="setting-row">
                    <div class="check-text">
                        <strong>${Lang.t('twoFactorAuth')}</strong>
                        <span>${isEnabled ? Lang.t('enabled') : Lang.t('disabled2')}</span>
                    </div>
                    <button class="${isEnabled ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-toggle-2fa">
                        ${Icon(isEnabled ? 'shield-off' : 'shield-check', 15)}${isEnabled ? Lang.t('disableButton') : Lang.t('setUpButton')}
                    </button>
                </div>
            `;
            const passkeyButton = document.createElement('button'); passkeyButton.type = 'button'; passkeyButton.className = 'btn-secondary mt-3';
            passkeyButton.textContent = Lang.current === 'en' ? 'Manage MFA / passkeys' : 'MFA / Passkeys verwalten';
            passkeyButton.onclick = () => MFA.manage().catch(error => UI.toast(error.message)); secArea.appendChild(passkeyButton);
            q('#btn-toggle-2fa').onclick = async () => {
                if (isEnabled) {
                    // Deaktivieren erfordert das aktuelle Passwort UND einen gültigen TOTP-Code
                    // (Step-up, docs/SPEC.md §8, Security-Audit R-12) -- keine reine
                    // Client-Entscheidung und kein reiner Passwort-Check mehr.
                    const password = await UI.promptText({
                        title: Lang.t('disable2FATitle'),
                        label: Lang.t('confirmCurrentPassword'),
                        placeholder: Lang.t('passwordPlaceholder')
                    });
                    if (!password) return;
                    const code = await UI.promptText({
                        title: Lang.t('disable2FATitle'),
                        label: Lang.t('confirmCurrentMfaCode'),
                        placeholder: '000000'
                    });
                    if (!code) return;
                    const res = await fetch('/api/v2/mfa/disable', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ password, code })
                    }).catch(() => null);
                    if (res && res.ok) {
                        UI.toast(Lang.t('mfaDisabledToast'));
                        Settings.openModal(); // Re-render
                    } else {
                        const body = await res?.json().catch(() => null);
                        UI.toast(body?.error === 'too_many_attempts' ? Lang.t('tooManyAttemptsRetryLater')
                            : body?.error === 'invalid_code' ? Lang.t('codeWrongOrExpired') : Lang.t('wrongPasswordShort'));
                    }
                } else {
                    modal.classList.remove('open');
                    setTimeout(() => Auth.open2FAModal(user), 200); // Wait for transition
                }
            };
            if (window.lucide) lucide.createIcons();
        }

        await Settings.renderNotifArea(user);

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    },
    renderNotifArea: async (user) => {
        const area = q('#s-notif-area');
        if (!area || !user) return;
        const browserToggle = q('#s-browser-notifications');
        const browserStatus = q('#s-browser-notifications-status');
        const english = (await Store.getSettings()).lang === 'en';
        q('#s-browser-notifications-label').textContent = english ? 'Browser notifications on this device' : 'Browser-Benachrichtigungen auf diesem Ger\u00e4t';
        const updateBrowserState = () => {
            browserToggle.checked = BrowserNotifications.enabled();
            browserToggle.disabled = !BrowserNotifications.supported();
            browserStatus.textContent = !BrowserNotifications.supported()
                ? (english ? 'Unavailable. A supported browser and trusted HTTPS connection are required.' : 'Nicht verf\u00fcgbar. Ein unterst\u00fctzter Browser und vertrauensw\u00fcrdiges HTTPS sind erforderlich.')
                : Notification.permission === 'denied'
                    ? (english ? 'Blocked in browser site permissions.' : 'In den Website-Berechtigungen des Browsers blockiert.')
                    : BrowserNotifications.enabled()
                        ? (english ? 'Enabled on this device.' : 'Auf diesem Ger\u00e4t aktiviert.')
                        : (english ? 'Disabled on this device.' : 'Auf diesem Ger\u00e4t deaktiviert.');
        };
        updateBrowserState();
        browserToggle.onchange = async () => {
            const pending = BrowserNotifications.configure(browserToggle.checked);
            browserToggle.disabled = true;
            await pending;
            updateBrowserState();
        };
        const policy = await Store.getNotifPolicy();
        const role = Store.roleGroup(user);
        const rows = [];
        Object.entries(Store.notifTypeMeta).forEach(([type, meta]) => {
            if (!meta.roles.includes(role)) return;
            const rule = policy[type]?.[role];
            if (!rule) return;
            const personal = user.notifPrefs?.[type] || {};
            const appValue = rule.appLocked ? rule.defaultApp : (typeof personal.app === 'boolean' ? personal.app : rule.defaultApp);
            const emailValue = rule.emailLocked ? rule.defaultEmail : (typeof personal.email === 'boolean' ? personal.email : rule.defaultEmail);
            rows.push(`
                <div class="notif-personal-row${rule.appLocked && rule.emailLocked ? ' locked' : ''}" data-notif-type="${type}">
                    <div class="notif-matrix-label"><strong>${Utils.esc(meta.label)}</strong>${rule.appLocked && rule.emailLocked ? `<span>${Lang.t('setByAdmin')}</span>` : ''}</div>
                    <label class="check-row compact"><input type="checkbox" class="sn-app" ${appValue ? 'checked' : ''} ${rule.appLocked ? 'disabled' : ''}>In-App</label>
                    <label class="check-row compact"><input type="checkbox" class="sn-email" ${emailValue ? 'checked' : ''} ${rule.emailLocked ? 'disabled' : ''}>${Lang.t('email')}</label>
                </div>`);
        });
        area.innerHTML = rows.join('') || `<div class="empty-state compact">${Lang.t('noPersonalizableNotifications')}</div>`;
        area.querySelectorAll('.notif-personal-row').forEach(row => {
            const type = row.dataset.notifType;
            const appBox = row.querySelector('.sn-app');
            const emailBox = row.querySelector('.sn-email');
            const persist = async () => {
                const users = await Store.getUsers();
                const target = users.find(u => u.id === user.id);
                if (!target) return;
                target.notifPrefs = target.notifPrefs || {};
                target.notifPrefs[type] = { app: appBox.checked, email: emailBox.checked };
                await Store.saveUsers(users);
                user.notifPrefs = target.notifPrefs;
            };
            if (!appBox.disabled) appBox.onchange = persist;
            if (!emailBox.disabled) emailBox.onchange = persist;
        });
    },
    renderState: (modal, s) => {
        modal.querySelectorAll('.s-theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === (s.theme || 'dark'));
        });

        // Dynamic Background Grid
        const currentTheme = modal.dataset.renderedTheme;
        if (currentTheme !== s.theme) {
            modal.dataset.renderedTheme = s.theme;
            Settings.renderBgGrid(modal, s);
        }

        Settings.colorPicker?.setValue(s.accentColor);
        const accent = (s.accentColor || '').toLowerCase();
        let isPreset = false;
        modal.querySelectorAll('.accent-preset').forEach(b => {
            const active = b.dataset.color.toLowerCase() === accent;
            if (active) isPreset = true;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active);
        });
        q('#s-color').classList.toggle('active', !isPreset);
        q('#s-color-label').textContent = s.accentColor;
        q('#s-lang').value = s.lang || 'de';

        Settings.normalizeBg(s);
        modal.querySelectorAll('.s-bg-btn').forEach(b => {
            let active = false;
            if (b.dataset.type === 'image') {
                active = (s.bgType === 'image'); // Pure type check for custom upload
            } else {
                active = (b.dataset.type === s.bgType && (b.dataset.val || '') === s.bgValue);
            }
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active);
            if (b.dataset.type === 'image') {
                b.style.backgroundImage = (s.bgType === 'image' && s.bgValue) ? `url(${s.bgValue})` : '';
            }
        });
    },

    renderBgGrid: (modal, s) => {
        const grid = modal.querySelector('#s-bg-grid');
        if (!grid) return;

        const presets = Settings.bgPresets;
        grid.innerHTML = '';

        presets.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-secondary s-bg-btn';
            btn.dataset.type = p.type;
            btn.dataset.val = p.val;
            btn.dataset.preset = p.preset;
            btn.title = p.label;
            btn.innerHTML = `${Icon(p.icon, 16)}<span>${p.label}</span>`;
            btn.onclick = async () => {
                s.bgType = p.type;
                s.bgValue = p.val;
                await Store.saveSettings(s);
                Settings.apply(s);
                Settings.renderState(modal, s);
            };
            grid.appendChild(btn);
        });

        // Add upload button
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn-secondary s-bg-btn';
        upBtn.id = 's-bg-upload';
        upBtn.dataset.type = 'image';
        upBtn.dataset.preset = 'upload';
        upBtn.title = Lang.t('customImage');
        upBtn.innerHTML = `${Icon('image-plus', 16)}<span>${Lang.t('customImage')}</span>`;
        upBtn.onclick = () => q('#s-bg-file').click();
        grid.appendChild(upBtn);
        if (window.lucide) lucide.createIcons();

        q('#s-bg-file').onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
                UI.toast(Lang.current === 'en' ? 'Please choose PNG, JPEG, WebP or GIF.' : 'Bitte PNG, JPEG, WebP oder GIF auswählen.');
                return;
            }
            if (file.size > 4 * 1024 * 1024) {
                UI.toast(Lang.t('imageTooLarge4MB'));
                return;
            }
            try {
                const data = await Store.readFile(file);
                s.bgType = 'image';
                s.bgValue = data;
                await Store.saveSettings(s);
                Settings.apply(s);
                Settings.renderState(modal, s);
                UI.toast(Lang.t('backgroundUpdatedToast'));
            } catch (err) {
                UI.toast(Lang.t('uploadErrorToast'));
            }
        };
    },
    save: async (s) => {
        await Store.saveSettings(s);
        Settings.apply(s);
    }
};
