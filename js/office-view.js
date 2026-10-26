(async () => {
    const id = location.pathname.split('/').at(-2);
    let editor;
    try {
        const response = await fetch(`/api/v2/attachments/${encodeURIComponent(id)}/office-config`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Die Office-Datei konnte nicht geladen werden.');
        const result = await response.json();
        if (!result.enabled) throw new Error('Office-Dienst ist noch nicht bereit. Bitte erneut öffnen oder die PDF-Vorschau verwenden.');
        await new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = '/office/web-apps/apps/api/documents/api.js'; script.onload = resolve;
            script.onerror = () => reject(new Error('Office-Dienst ist nicht erreichbar.')); document.head.appendChild(script);
        });
        editor = new window.DocsAPI.DocEditor('office-editor', { ...result.config, events: { onError: event => {
            const message = document.querySelector('#office-error'); message.hidden = false; message.textContent = 'Office-Vorschau: ' + (event.data?.errorDescription || 'Datei konnte nicht dargestellt werden.');
        } } });
    } catch (error) { const message = document.querySelector('#office-error'); message.hidden = false; message.textContent = error.message; }
    window.addEventListener('pagehide', () => editor?.destroyEditor());
})();
