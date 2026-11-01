import { UI } from './ui.js';
import { Lang } from './lang.js';
import { Store } from './store.js';
const text = (de, en) => Lang.current === 'en' ? en : de;
const ERRORS = {
    too_many_attempts: ['Zu viele Fehlversuche. Bitte warte einen Moment und versuche es dann erneut.', 'Too many failed attempts. Please wait a moment and try again.'],
    invalid_code: ['Der Code ist falsch oder abgelaufen.', 'The code is wrong or has expired.'],
    invalid_recovery_code: ['Der Wiederherstellungscode ist ungültig.', 'The recovery code is invalid.'],
    invalid_enroll_code: ['Der Bestätigungs- bzw. Einrichtungscode ist falsch oder abgelaufen.', 'The confirmation or enrollment code is wrong or has expired.'],
    enroll_mail_unavailable: ['Es ist kein E-Mail-Versand eingerichtet. Bitte lass dir von deiner Admin-Person einen Einrichtungscode geben.', 'Email delivery is not configured. Please ask your administrator for an enrollment code.'],
    enroll_code_recently_sent: ['Ein Code wurde gerade erst verschickt. Bitte prüfe dein Postfach.', 'A code was sent just now. Please check your inbox.'],
    enrollment_verification_required: ['Bitte bestätige die Einrichtung zuerst mit einem Code.', 'Please confirm the setup with a code first.']
};
async function api(path, body) {
    const response = await fetch('/api/v2/mfa/' + path, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const known = ERRORS[result.error];
        const error = new Error(known ? text(...known) : (result.detail || result.message || result.error || text('MFA-Anfrage fehlgeschlagen', 'MFA request failed')));
        error.code = result.error;
        throw error;
    }
    return result;
}
async function browserLibrary() {
    if (!window.SimpleWebAuthnBrowser) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = '/vendor/webauthn.js'; script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('Passkey-Bibliothek konnte nicht geladen werden.')); }; document.head.appendChild(script);
    });
    return window.SimpleWebAuthnBrowser;
}
export const MFA = {
    // Security-Audit R-25: vor der Ersteinrichtung ein Bestaetigungscode per E-Mail oder ein
    // Einrichtungscode der Admin-Person -- das Passwort allein reicht nicht.
    async verifyEnrollment(token, status) {
        let label = text('Zur Sicherheit brauchst du einen Einrichtungscode. Du erhältst ihn von deiner Admin-Person.', 'For security you need an enrollment code. Your administrator can give you one.');
        if (status.enrollMailAvailable) {
            try {
                await api('login/enroll-code', { token });
                label = text('Wir haben dir einen Bestätigungscode per E-Mail geschickt. Alternativ funktioniert auch ein Einrichtungscode deiner Admin-Person.', 'We have emailed you a confirmation code. An enrollment code from your administrator works as well.');
            } catch (error) {
                if (error.code !== 'enroll_code_recently_sent') throw error;
                label = text('Ein Bestätigungscode wurde bereits per E-Mail verschickt. Alternativ funktioniert auch ein Einrichtungscode deiner Admin-Person.', 'A confirmation code has already been emailed. An enrollment code from your administrator works as well.');
            }
        }
        const code = await UI.promptText({ title: text('Einrichtung bestätigen', 'Confirm setup'), label, placeholder: '12345678' });
        if (!code) throw new Error(text('Abgebrochen.', 'Cancelled.'));
        await api('login/enroll-verify', { token, code: code.trim() });
    },
    async passkey(token, register = false) {
        const library = await browserLibrary();
        const { options } = await api('passkeys/options', { token, register });
        const credential = register ? await library.startRegistration({ optionsJSON: options }) : await library.startAuthentication({ optionsJSON: options });
        const label = register ? await UI.promptText({ title: text('Passkey benennen', 'Name passkey'), label: text('Name des Geräts / Schlüssels', 'Device / key name'), placeholder: 'Passkey' }) : undefined;
        return api('passkeys/verify', { token, credential, ...(register ? { label: label?.trim() || 'Passkey' } : {}) });
    },
    async login(token) {
        return new Promise((resolve, reject) => {
            const overlay = document.createElement('div'); overlay.className = 'modal-overlay open';
            overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mfa-login-title"><div class="modal-header"><h3 id="mfa-login-title">${text('Mehrstufige Anmeldung', 'Multi-factor authentication')}</h3></div><div class="modal-body"><p data-status></p><div data-methods class="mfa-methods"></div><p role="alert"></p><button class="btn-secondary" data-cancel>${text('Abbrechen', 'Cancel')}</button></div></div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('[data-cancel]').onclick = () => { overlay.remove(); resolve(null); };
            const render = async () => {
                const status = await api('login/status', { token });
                if (status.satisfied) {
                    const result = await api('login/finish', { token }); Store._meCache = null; Store._usersCache = null;
                    overlay.remove(); resolve(result.user); return;
                }
                overlay.querySelector('[data-status]').textContent = text('Bestätige die benötigten Methoden. Deine Systemeinstellungen bestimmen die Kombination.', 'Verify the required methods. Your system policy determines the combination.');
                const methods = overlay.querySelector('[data-methods]'); methods.replaceChildren();
                const add = (label, callback) => {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-primary'; button.textContent = label;
                    button.onclick = async () => { button.disabled = true; try { await callback(); await render(); } catch (error) { overlay.querySelector('[role="alert"]').textContent = error.message; } finally { button.disabled = false; } };
                    methods.appendChild(button);
                };
                add(text('Mit Wiederherstellungscode neu einrichten', 'Recover with a recovery code'), async () => {
                    const code = await UI.promptText({ title: text('MFA wiederherstellen', 'Recover MFA'), label: text('Einmaliger Code. Bisherige MFA-Methoden und Sitzungen werden zurückgesetzt.', 'One-time code. Existing MFA methods and sessions will be reset.') });
                    if (!code) throw new Error(text('Abgebrochen.', 'Cancelled.'));
                    const recovery = await api('login/recovery', { token, code }); token = recovery.token;
                });
                if (!status.proof.totp && (status.mode !== 'passkey' || status.forceTotp || !status.hasPasskey)) add(
                    status.hasTotp ? text('Authenticator-Code eingeben', 'Enter authenticator code') : text('Authenticator einrichten', 'Set up authenticator'), async () => {
                        let setup;
                        if (!status.hasTotp) {
                            if (status.enrollmentRequired) await MFA.verifyEnrollment(token, status);
                            setup = await api('login/totp-setup', { token });
                        }
                        const input = UI.promptText({ title: 'TOTP', label: text('Sechsstelliger Authenticator-Code', 'Six-digit authenticator code'), placeholder: '123456' });
                        if (setup) {
                            const image = document.createElement('img'); image.src = setup.qrDataUrl; image.alt = 'Authenticator QR code'; image.width = 200;
                            const secret = document.createElement('p'); secret.textContent = setup.secret; document.querySelector('#prompt-modal .modal-body').prepend(image, secret);
                        }
                        const code = await input;
                        if (!code) throw new Error(text('Code erforderlich.', 'Code required.'));
                        await api('login/totp', { token, code: code.trim() });
                    });
                if (!status.proof.passkey && status.mode !== 'totp') {
                    if (!status.passkeysAvailable) {
                        const info = document.createElement('p'); info.textContent = text('Passkeys benötigen einen vertrauenswürdigen HTTPS-Domainnamen. IP-Adressen werden nicht unterstützt.', 'Passkeys require a trusted HTTPS domain name. IP addresses are not supported.'); methods.append(info);
                    } else add(status.hasPasskey ? text('Mit Passkey bestätigen', 'Verify with passkey') : text('Passkey einrichten', 'Set up passkey'), () => MFA.passkey(token, !status.hasPasskey));
                }
            };
            render().catch(error => { overlay.remove(); reject(error); });
        });
    },
    async manage() {
        // Ohne eingerichteten Authenticator gibt es keinen Code -- die Einrichtung laeuft ueber die 2FA-Einstellungen.
        if (!(await Store.currentUser())?.twoFactorEnabled) throw new Error(Lang.t('mfaSetupFirstHint'));
        const password = await UI.promptText({ title: 'MFA / Passkeys', label: text('Aktuelles Passwort', 'Current password'), type: 'password' });
        if (!password) return;
        const code = await UI.promptText({ title: 'TOTP', label: text('Aktueller Authenticator-Code', 'Current authenticator code'), placeholder: '123456' });
        if (!code) return;
        const { token } = await api('manage', { password, code: code.trim() });
        const response = await fetch('/api/v2/mfa/passkeys', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(text('Passkeys konnten nicht geladen werden.', 'Could not load passkeys.'));
        const { keys } = await response.json();
        const overlay = document.createElement('div'); overlay.className = 'modal-overlay open';
        overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><h3>MFA / Passkeys</h3></div><div class="modal-body"><p>${text('Handy, Computer oder Sicherheitsschlüssel. Weitere Geräte lassen sich über den Browserdialog auswählen.', 'Phone, computer or security key. Additional devices can be selected in the browser dialog.')}</p><div data-list></div><div class="mfa-methods"><button class="btn-primary" data-add>${text('Passkey hinzufügen', 'Add passkey')}</button><button class="btn-secondary" data-close>${text('Schließen', 'Close')}</button></div><p role="alert"></p></div></div>`;
        document.body.appendChild(overlay); overlay.querySelector('[data-close]').onclick = () => overlay.remove();
        const recoveryButton = document.createElement('button'); recoveryButton.type = 'button'; recoveryButton.className = 'btn-secondary';
        recoveryButton.textContent = text('10 Wiederherstellungscodes erzeugen', 'Generate 10 recovery codes');
        recoveryButton.onclick = async () => {
            try {
                const result = await api('recovery/generate', { token });
                overlay.querySelector('.mfa-methods').replaceChildren(overlay.querySelector('[data-close]'));
                const info = document.createElement('p'); info.textContent = text('Jetzt sicher offline aufbewahren. Nur einmal sichtbar. Vorherige Codes sind ungültig.', 'Store securely offline now. Shown once only. Previous codes are invalid.');
                const codes = document.createElement('pre'); codes.className = 'mfa-recovery-codes'; codes.textContent = result.codes.join('\n'); overlay.querySelector('[data-list]').replaceChildren(info, codes);
            } catch (error) { overlay.querySelector('[role="alert"]').textContent = error.message; }
        };
        overlay.querySelector('.mfa-methods').appendChild(recoveryButton);
        overlay.querySelector('[data-add]').onclick = async event => {
            event.currentTarget.disabled = true;
            try { await MFA.passkey(token, true); overlay.remove(); UI.toast(text('Passkey gespeichert.', 'Passkey saved.')); }
            catch (error) { overlay.querySelector('[role="alert"]').textContent = error.message; event.target.disabled = false; }
        };
        for (const key of keys) {
            const row = document.createElement('p'); const label = document.createElement('span'); label.textContent = key.label + ' ';
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-secondary'; remove.textContent = text('Entfernen', 'Remove');
            remove.onclick = () => UI.confirm(text('Passkey entfernen? Danach erneut anmelden.', 'Remove passkey? Sign in again afterwards.'), async () => {
                try { await api('passkeys/remove', { token, id: key.id }); location.href = '/index.html'; }
                catch (error) { overlay.querySelector('[role="alert"]').textContent = error.message; }
            });
            row.append(label, remove); overlay.querySelector('[data-list]').appendChild(row);
        }
    }
};
