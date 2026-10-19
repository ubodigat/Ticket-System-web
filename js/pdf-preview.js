import { Icon } from './utils.js';

export async function renderPdfPreview(bytes, host) {
    const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true });
    const documentPdf = await loading.promise.catch(error => { void loading.destroy(); throw error; });
    const visiblePages = Math.min(documentPdf.numPages, 500);
    host.replaceChildren();
    const root = document.createElement('div'); root.className = 'pdf-preview';
    root.innerHTML = `<div class="pdf-toolbar">
        <button type="button" class="btn-ghost btn-icon" data-prev title="Vorherige Seite" aria-label="Vorherige Seite">${Icon('chevron-left', 16)}</button>
        <input type="number" data-page min="1" max="${visiblePages}" value="1" aria-label="Seite"><span>/ ${documentPdf.numPages}</span>
        <button type="button" class="btn-ghost btn-icon" data-next title="Nächste Seite" aria-label="Nächste Seite">${Icon('chevron-right', 16)}</button>
        <button type="button" class="btn-ghost btn-icon" data-out title="Verkleinern" aria-label="Verkleinern">${Icon('zoom-out', 16)}</button>
        <span data-zoom></span><button type="button" class="btn-ghost btn-icon" data-in title="Vergrößern" aria-label="Vergrößern">${Icon('zoom-in', 16)}</button>
        <button type="button" class="btn-ghost btn-icon" data-fit title="An Breite anpassen" aria-label="An Breite anpassen">${Icon('scan-line', 16)}</button></div>
        <div class="pdf-pages" tabindex="0" aria-label="Dokumentseiten"></div>`;
    host.appendChild(root);
    if (visiblePages < documentPdf.numPages) {
        const notice = document.createElement('p'); notice.className = 'hint';
        notice.textContent = 'Vorschau auf die ersten 500 Seiten begrenzt. Die vollständige Datei steht zum Download bereit.';
        root.appendChild(notice);
    }
    const pages = root.querySelector('.pdf-pages');
    const first = await documentPdf.getPage(1).catch(error => { void loading.destroy(); throw error; }); const original = first.getViewport({ scale: 1 });
    let scale = Math.max(0.02, Math.min(2, (pages.clientWidth - 24) / original.width));
    let destroyed = false; let generation = 0; let currentPage = 1;
    const rendered = new Map(); const sections = [];
    const renderPage = async section => {
        if (rendered.has(section) || destroyed) return;
        const record = { task: null }; rendered.set(section, record); const version = generation;
        try {
            const page = await documentPdf.getPage(Number(section.dataset.page));
            if (destroyed || version !== generation || rendered.get(section) !== record) return;
            const viewport = page.getViewport({ scale });
            const ratio = Math.min(window.devicePixelRatio || 1, 2, 32000 / viewport.width, 32000 / viewport.height, Math.sqrt(16000000 / (viewport.width * viewport.height)));
            const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', `Seite ${section.dataset.page}`);
            canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
            canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
            section.style.width = `${viewport.width}px`; section.style.height = `${viewport.height}px`;
            section.replaceChildren(canvas);
            record.task = page.render({ canvas, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
            await record.task.promise;
        } catch (error) {
            if (!destroyed && version === generation && error.name !== 'RenderingCancelledException') section.textContent = 'Seite konnte nicht dargestellt werden.';
        }
    };
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                void renderPage(entry.target);
                const page = Number(entry.target.dataset.page);
                if (entry.boundingClientRect.top <= pages.getBoundingClientRect().top + pages.clientHeight / 2) { currentPage = page; root.querySelector('[data-page]').value = String(page); }
            } else if (rendered.has(entry.target)) {
                rendered.get(entry.target).task?.cancel(); rendered.delete(entry.target); entry.target.replaceChildren();
            }
        }
    }, { root: pages, rootMargin: '400px 0px' });
    for (let n = 1; n <= visiblePages; n++) {
        const section = document.createElement('div'); section.className = 'pdf-sheet'; section.dataset.page = String(n);
        section.style.width = `${original.width * scale}px`; section.style.height = `${original.height * scale}px`;
        pages.appendChild(section); sections.push(section); observer.observe(section);
    }
    const updateZoom = value => {
        scale = Math.max(0.02, Math.min(5, value)); generation++;
        for (const record of rendered.values()) record.task?.cancel(); rendered.clear(); observer.disconnect();
        for (const section of sections) { section.replaceChildren(); section.style.width = `${original.width * scale}px`; section.style.height = `${original.height * scale}px`; observer.observe(section); }
        root.querySelector('[data-zoom]').textContent = `${Math.round(scale * 100)}%`;
    };
    const go = n => {
        currentPage = Math.max(1, Math.min(visiblePages, Number(n) || 1));
        pages.scrollTop = sections[currentPage - 1].offsetTop; root.querySelector('[data-page]').value = String(currentPage);
    };
    root.querySelector('[data-zoom]').textContent = `${Math.round(scale * 100)}%`;
    root.querySelector('[data-page]').onchange = e => go(e.target.value);
    root.querySelector('[data-prev]').onclick = () => go(currentPage - 1); root.querySelector('[data-next]').onclick = () => go(currentPage + 1);
    root.querySelector('[data-in]').onclick = () => updateZoom(scale * 1.25); root.querySelector('[data-out]').onclick = () => updateZoom(scale / 1.25);
    root.querySelector('[data-fit]').onclick = () => updateZoom((pages.clientWidth - 24) / original.width);
    await renderPage(sections[0]);
    if (window.lucide) lucide.createIcons();
    return { destroy() { destroyed = true; observer.disconnect(); for (const record of rendered.values()) record.task?.cancel(); rendered.clear();
        root.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; }); root.remove(); void loading.destroy(); } };
}
