/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Persönlicher Outlook-Kalender (delegierte OAuth-Berechtigung, siehe
// apps/server/src/http/routes/outlookPersonal.ts) -- getrennt von der Ticket-Terminfunktion in
// AdminBoard.openCalendarEventModal (App-only, gemeinsames Postfach). Für alle Rollen sichtbar,
// da personenbezogen.
import { q, Icon, Utils } from './utils.js';
import { Lang } from './lang.js';
import { UI } from './ui.js';

export const OutlookCalendar = {
    status: { connected: false, accountEmail: null },
    viewMonth: null,
    events: [],
    selectedDay: null,

    init: async () => {
        if (!q('.topbar-right') || q('#btn-outlook-calendar')) return;
        const button = document.createElement('button');
        button.id = 'btn-outlook-calendar';
        button.className = 'btn-ghost btn-icon notification-button';
        button.title = Lang.t('myCalendar');
        button.setAttribute('aria-label', Lang.t('myCalendar'));
        button.innerHTML = Icon('calendar-days', 18);
        button.onclick = () => OutlookCalendar.open();
        q('.topbar-right').insertBefore(button, q('#btn-notifications') || q('.topbar-right').firstChild);
        if (window.lucide) lucide.createIcons();
        OutlookCalendar.handleRedirectResult();
    },

    // Nach dem Zurück-Redirect von Microsoft hängt /api/v2/outlook/callback ?outlook=connected
    // oder ?outlook=failed an die ursprüngliche Seite an -- hier auswerten, Meldung zeigen und
    // die URL wieder bereinigen, damit ein Reload die Meldung nicht wiederholt.
    handleRedirectResult: () => {
        const params = new URLSearchParams(window.location.search);
        const result = params.get('outlook');
        if (!result) return;
        params.delete('outlook');
        const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
        window.history.replaceState({}, '', clean);
        if (result === 'connected') {
            UI.toast(Lang.t('outlookPersonalConnectedToast'));
            OutlookCalendar.open();
        } else {
            UI.toast(Lang.t('outlookPersonalConnectFailedToast'));
        }
    },

    refreshStatus: async () => {
        const res = await fetch('/api/v2/outlook/status', { credentials: 'same-origin' }).catch(() => null);
        if (res && res.ok) OutlookCalendar.status = await res.json();
        return OutlookCalendar.status;
    },

    connect: async () => {
        await OutlookCalendar.refreshStatus();
        if (!OutlookCalendar.status.configured) { UI.toast(Lang.t('outlookConfigurationRequired')); return; }
        const returnTo = encodeURIComponent(window.location.pathname);
        window.location.href = `/api/v2/outlook/connect?returnTo=${returnTo}`;
    },

    disconnect: async () => {
        UI.confirm(Lang.t('confirmDisconnectOutlook'), async () => {
            await fetch('/api/v2/outlook/disconnect', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
            UI.toast(Lang.t('outlookDisconnectedToast'));
            await OutlookCalendar.render();
        });
    },

    open: async () => {
        let modal = q('#outlook-calendar-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'outlook-calendar-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal modal-lg">
                    <div class="modal-header">
                        <h3>${Icon('calendar-days', 18)} ${Lang.t('myCalendar')}</h3>
                        <div class="modal-actions">
                            <button class="btn-ghost btn-icon" id="oc-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                        </div>
                    </div>
                    <div class="modal-body" id="oc-body"></div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#oc-close').onclick = () => modal.classList.remove('open');
            modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
        }
        modal.classList.add('open');
        await OutlookCalendar.render();
        if (window.lucide) lucide.createIcons();
    },

    render: async () => {
        const body = q('#oc-body');
        if (!body) return;
        await OutlookCalendar.refreshStatus();
        if (!OutlookCalendar.status.connected) {
            body.innerHTML = `
                <div class="outlook-connect-prompt">
                    <p>${Lang.t(OutlookCalendar.status.configured ? 'outlookPersonalConnectIntro' : 'outlookConfigurationRequired')}</p>
                    <button class="btn-primary" id="oc-connect" ${OutlookCalendar.status.configured ? '' : 'disabled'}>${Icon('plug', 16)}${Lang.t('connectOutlookButton')}</button>
                </div>`;
            body.querySelector('#oc-connect').onclick = () => OutlookCalendar.connect();
            return;
        }
        if (!OutlookCalendar.viewMonth) {
            const now = new Date();
            OutlookCalendar.viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        body.innerHTML = `
            <div class="outlook-connected-bar">
                <span>${Lang.format('connectedAsOutlook', { email: Utils.esc(OutlookCalendar.status.accountEmail || '') })}</span>
                <button class="btn-ghost btn-sm" id="oc-disconnect">${Lang.t('disconnectButton')}</button>
            </div>
            <div class="oc-toolbar">
                <button type="button" class="btn-ghost btn-icon" id="oc-prev" aria-label="${Lang.t('previousMonth')}">${Icon('chevron-left', 16)}</button>
                <span id="oc-month-label" class="oc-month-label"></span>
                <button type="button" class="btn-ghost btn-icon" id="oc-next" aria-label="${Lang.t('nextMonth')}">${Icon('chevron-right', 16)}</button>
                <button type="button" class="btn-primary btn-sm" id="oc-new-event">${Icon('plus', 15)}${Lang.t('newAppointmentButton')}</button>
            </div>
            <div id="oc-grid" class="oc-grid"></div>
            <div id="oc-day-events" class="oc-day-events"></div>
        `;
        body.querySelector('#oc-disconnect').onclick = () => OutlookCalendar.disconnect();
        body.querySelector('#oc-prev').onclick = () => { OutlookCalendar.viewMonth = new Date(OutlookCalendar.viewMonth.getFullYear(), OutlookCalendar.viewMonth.getMonth() - 1, 1); OutlookCalendar.renderMonth(); };
        body.querySelector('#oc-next').onclick = () => { OutlookCalendar.viewMonth = new Date(OutlookCalendar.viewMonth.getFullYear(), OutlookCalendar.viewMonth.getMonth() + 1, 1); OutlookCalendar.renderMonth(); };
        body.querySelector('#oc-new-event').onclick = () => OutlookCalendar.openEventForm();
        await OutlookCalendar.renderMonth();
    },

    renderMonth: async () => {
        const grid = q('#oc-grid');
        const label = q('#oc-month-label');
        if (!grid || !label) return;
        const view = OutlookCalendar.viewMonth;
        const monthNames = ['monthJanuary', 'monthFebruary', 'monthMarch', 'monthApril', 'monthMay', 'monthJune', 'monthJuly', 'monthAugust', 'monthSeptember', 'monthOctober', 'monthNovember', 'monthDecember'].map(k => Lang.t(k));
        label.textContent = `${monthNames[view.getMonth()]} ${view.getFullYear()}`;

        const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
        const startOffset = (firstOfMonth.getDay() + 6) % 7; // Woche beginnt Montag
        const gridStart = new Date(firstOfMonth);
        gridStart.setDate(gridStart.getDate() - startOffset);
        const gridEnd = new Date(gridStart);
        gridEnd.setDate(gridStart.getDate() + 42);

        const params = new URLSearchParams({ from: gridStart.toISOString(), to: gridEnd.toISOString() });
        const res = await fetch(`/api/v2/outlook/calendar?${params.toString()}`, { credentials: 'same-origin' }).catch(() => null);
        OutlookCalendar.events = (res && res.ok) ? (await res.json()).events : [];
        if (!res || !res.ok) UI.toast(Lang.t('outlookCalendarLoadFailed'));

        const weekdayKeys = ['weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat', 'weekdaySun'];
        const today = new Date();
        const cells = weekdayKeys.map(k => `<span class="oc-weekday">${Lang.t(k)}</span>`).join('');
        const dayCells = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(gridStart);
            d.setDate(gridStart.getDate() + i);
            const dayEvents = OutlookCalendar.events.filter(e => new Date(e.startAt).toDateString() === d.toDateString());
            const classes = ['oc-day'];
            if (d.getMonth() !== view.getMonth()) classes.push('is-outside');
            if (d.toDateString() === today.toDateString()) classes.push('is-today');
            dayCells.push(`<button type="button" class="${classes.join(' ')}" data-date="${d.toISOString()}">
                <span class="oc-day-num">${d.getDate()}</span>
                ${dayEvents.length ? `<span class="oc-day-dot">${dayEvents.length}</span>` : ''}
            </button>`);
        }
        grid.innerHTML = `<div class="oc-weekdays">${cells}</div><div class="oc-days">${dayCells.join('')}</div>`;
        grid.querySelectorAll('.oc-day').forEach(btn => {
            btn.onclick = () => OutlookCalendar.showDay(new Date(btn.dataset.date));
        });
        if (OutlookCalendar.selectedDay) OutlookCalendar.showDay(OutlookCalendar.selectedDay);
        if (window.lucide) lucide.createIcons();
    },

    showDay: (date) => {
        OutlookCalendar.selectedDay = date;
        const box = q('#oc-day-events');
        if (!box) return;
        const dayEvents = OutlookCalendar.events
            .filter(e => new Date(e.startAt).toDateString() === date.toDateString())
            .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
        box.innerHTML = `<h4 class="section-title">${Utils.esc(Utils.fmtDateOnly(date))}</h4>` + (dayEvents.length
            ? dayEvents.map(e => `
                <div class="oc-event-row">
                    ${Icon('calendar-clock', 13)}
                    <span>${Utils.esc(Utils.fmtTimeOnly(new Date(e.startAt)))} - ${Utils.esc(Utils.fmtTimeOnly(new Date(e.endAt)))}</span>
                    <strong>${Utils.esc(e.subject)}</strong>
                    ${/^https:\/\//i.test(e.webLink || '') ? `<a href="${Utils.esc(e.webLink)}" target="_blank" rel="noopener noreferrer">${Icon('external-link', 12)}</a>` : ''}
                </div>`).join('')
            : `<p class="hint">${Lang.t('noAppointmentsOnThisDay')}</p>`);
        if (window.lucide) lucide.createIcons();
    },

    openEventForm: () => {
        let modal = q('#oc-event-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'oc-event-modal';
            modal.className = 'modal-overlay modal-top';
            document.body.appendChild(modal);
        }
        const base = OutlookCalendar.selectedDay || new Date();
        const startInitial = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0);
        const endInitial = new Date(startInitial.getTime() + 30 * 60 * 1000);
        modal.innerHTML = `
            <div class="modal modal-sm">
                <div class="modal-header">
                    <h3>${Icon('plus', 18)} ${Lang.t('newAppointmentButton')}</h3>
                    <div class="modal-actions">
                        <button class="btn-ghost btn-icon" id="oce-close" title="${Lang.t('close')}" aria-label="${Lang.t('close')}">${Icon('x', 16)}</button>
                    </div>
                </div>
                <div class="modal-body">
                    <div class="field"><label>${Lang.t('subjectLabel')}</label><input id="oce-subject" type="text" maxlength="512"></div>
                    <div class="form-grid">
                        <div class="field">
                            <label>${Lang.t('startLabel')}</label>
                            <input id="oce-start-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${Utils.fmtDateOnly(startInitial)}">
                            <input id="oce-start-time" type="text" inputmode="numeric" placeholder="09:00" value="${Utils.fmtTimeOnly(startInitial)}">
                        </div>
                        <div class="field">
                            <label>${Lang.t('endLabel')}</label>
                            <input id="oce-end-date" type="text" inputmode="numeric" placeholder="31.12.2026" value="${Utils.fmtDateOnly(endInitial)}">
                            <input id="oce-end-time" type="text" inputmode="numeric" placeholder="09:30" value="${Utils.fmtTimeOnly(endInitial)}">
                        </div>
                    </div>
                    <div class="field"><label>${Lang.t('calendarNoteLabel')}</label><textarea id="oce-notes" rows="3" maxlength="5000"></textarea></div>
                    <div class="field"><label for="oce-attendees">${Lang.t('externalAttendees')}</label><textarea id="oce-attendees" rows="2" placeholder="person@example.org; partner@example.com"></textarea></div>
                </div>
                <div class="modal-footer modal-footer-visible">
                    <button class="btn-secondary" id="oce-cancel">${Lang.t('cancel')}</button>
                    <button class="btn-primary" id="oce-save">${Icon('plus', 16)}${Lang.t('createEventButton')}</button>
                </div>
            </div>`;
        UI.bindDateInput(q('#oce-start-date'));
        UI.bindTimeInput(q('#oce-start-time'));
        UI.bindDateInput(q('#oce-end-date'));
        UI.bindTimeInput(q('#oce-end-time'));
        modal.querySelector('#oce-close').onclick = () => modal.classList.remove('open');
        modal.querySelector('#oce-cancel').onclick = () => modal.classList.remove('open');
        modal.querySelector('#oce-save').onclick = async () => {
            const subject = q('#oce-subject').value.trim();
            if (!subject) { UI.toast(Lang.t('enterASubject')); return; }
            const startMs = Utils.parseGermanDateTime(q('#oce-start-date').value, q('#oce-start-time').value);
            const endMs = Utils.parseGermanDateTime(q('#oce-end-date').value, q('#oce-end-time').value);
            if (!startMs || !endMs || endMs <= startMs) { UI.toast(Lang.t('selectValidStartEnd')); return; }
            const attendees = [...new Set(q('#oce-attendees').value.split(/[;,\s]+/).filter(Boolean).map(email => email.toLowerCase()))];
            if (attendees.length > 20 || attendees.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { UI.toast(Lang.t('invalidAttendees')); return; }
            const res = await fetch('/api/v2/outlook/events', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    subject,
                    notes: q('#oce-notes').value.trim() || undefined,
                    attendee_emails: attendees,
                    start_at: new Date(startMs).toISOString(),
                    end_at: new Date(endMs).toISOString()
                })
            }).catch(() => null);
            if (!res || !res.ok) { UI.toast(Lang.t('eventCreateFailedGeneric')); return; }
            modal.classList.remove('open');
            UI.toast(Lang.t('eventCreatedToast'));
            await OutlookCalendar.renderMonth();
        };
        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
    }
};
