import { Store } from './store.js';
import { AdminBoard } from './admin-board.js';
import { UI } from './ui.js';
import { Icon } from './utils.js';
import { Lang } from './lang.js';
const t = (de, en) => Lang.current === 'en' ? en : de;
async function request(path = '', body) {
    const response = await fetch('/api/v2/work-timer' + path, { credentials: 'same-origin',
        ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || t('Zeiterfassung fehlgeschlagen.', 'Time tracking failed.'));
    return value;
}
export const WorkTimer = {
    timer: null,
    activityTimerId: null,
    activityCleanup: null,
    closeActivity() {
        WorkTimer.activityCleanup?.(); WorkTimer.activityCleanup = null; WorkTimer.activityTimerId = null;
    },
    async init() {
        const user = await Store.currentUser();
        if (!['admin', 'superadmin'].includes(user?.role)) return;
        await WorkTimer.refresh();
        // Refresh across tabs without trusting client timestamps for billing.
        window.addEventListener('focus', () => WorkTimer.refresh().catch(error => UI.toast(error.message)));
    },
    async refresh() {
        WorkTimer.timer = (await request()).timer;
        if (WorkTimer.activityTimerId && WorkTimer.timer?.id !== WorkTimer.activityTimerId) WorkTimer.closeActivity();
        WorkTimer.renderButton();
        if (WorkTimer.timer?.stopped_at) WorkTimer.requireActivity();
    },
    renderButton(ticketId = AdminBoard.currentTicketId) {
        const print = document.querySelector('#m-print');
        if (!print) return;
        let button = document.querySelector('#m-work-timer');
        if (!button) {
            button = document.createElement('button'); button.id = 'm-work-timer'; button.type = 'button'; button.className = 'btn-ghost btn-icon';
            print.before(button);
        }
        const timer = WorkTimer.timer;
        button.innerHTML = Icon(timer ? 'square' : 'play', 18);
        const label = timer ? t('Zeiterfassung beenden und Tätigkeit dokumentieren', 'Stop timer and document activity') : t('Zeiterfassung starten', 'Start timer');
        button.title = label; button.setAttribute('aria-label', label);
        button.onclick = async () => {
            button.disabled = true;
            try {
                if (WorkTimer.timer?.stopped_at) return WorkTimer.requireActivity();
                WorkTimer.timer = WorkTimer.timer
                    ? (await request(`/${WorkTimer.timer.id}/stop`, {})).timer
                    : (await request('', { ticketId })).timer;
                WorkTimer.renderButton(ticketId);
                if (WorkTimer.timer?.stopped_at) WorkTimer.requireActivity();
                else UI.toast(t('Zeiterfassung läuft.', 'Timer started.'));
            } catch (error) { UI.toast(error.message); await WorkTimer.refresh(); }
            finally { button.disabled = false; }
        };
        if (window.lucide) window.lucide.createIcons();
    },
    requireActivity() {
        if (document.querySelector('#work-timer-required')) return;
        const timer = WorkTimer.timer;
        const overlay = document.createElement('div'); overlay.id = 'work-timer-required'; overlay.className = 'modal-overlay open work-timer-dialog';
        const minutes = Math.max(1, Math.ceil((new Date(timer.stopped_at) - new Date(timer.started_at)) / 60000));
        overlay.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="work-timer-title">
            <div class="modal-header"><h3 id="work-timer-title">${t('Tätigkeit dokumentieren', 'Document activity')}</h3></div>
            <div class="modal-body"><p>${minutes} ${t('Minuten erfasst. Bitte beschreibe deine Tätigkeit, um die Zeiterfassung abzuschließen.', 'minutes recorded. Describe your activity to finish tracking.')}</p>
            <label for="work-activity">${t('Tätigkeit (Pflichtfeld)', 'Activity (required)')}</label><textarea id="work-activity" required maxlength="4000"></textarea>
            <label for="work-solution">${t('Lösungsschritte (optional)', 'Solution steps (optional)')}</label><textarea id="work-solution" maxlength="10000"></textarea><p role="alert"></p>
            <div class="modal-footer"><button class="btn-primary" type="submit">${t('Zeit und Dokumentation speichern', 'Save time and documentation')}</button></div></div></form>`;
        const guard = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
            if (event.key === 'Tab') {
                const controls = [...overlay.querySelectorAll('textarea,button')].filter(control => !control.disabled);
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', guard, true);
        const background = [...document.body.children].filter(node => node instanceof HTMLElement && !node.inert && node.tagName !== 'SCRIPT');
        background.forEach(node => { node.inert = true; });
        document.body.appendChild(overlay);
        WorkTimer.activityTimerId = timer.id;
        WorkTimer.activityCleanup = () => { overlay.remove(); document.removeEventListener('keydown', guard, true); background.forEach(node => { node.inert = false; }); };
        overlay.querySelector('form').onsubmit = async event => {
            event.preventDefault(); const activity = overlay.querySelector('#work-activity').value.trim();
            if (!activity) { overlay.querySelector('#work-activity').focus(); return; }
            const button = overlay.querySelector('button'); button.disabled = true;
            try {
                const result = await request(`/${timer.id}/complete`, { activity, solution: overlay.querySelector('#work-solution').value.trim() });
                WorkTimer.closeActivity();
                WorkTimer.timer = null; WorkTimer.renderButton();
                await AdminBoard.openModal(result.ticketId);
                UI.toast(t('Zeit und Dokumentation gespeichert.', 'Time and documentation saved.'));
            } catch (error) {
                if (error.message === 'timer_not_stopped') await WorkTimer.refresh().catch(() => {});
                if (overlay.isConnected) overlay.querySelector('[role="alert"]').textContent = error.message;
            }
            finally { button.disabled = false; }
        };
        overlay.querySelector('#work-activity').focus();
    }
};
