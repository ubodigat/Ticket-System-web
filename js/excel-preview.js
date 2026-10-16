// Preserve worksheet coordinates, including blank and merged cells.
export function renderWorkbook(workbook, host, XLSX) {
    const tabs = document.createElement('div'); tabs.className = 'excel-sheet-tabs';
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Arbeitsblätter');
    const viewport = document.createElement('div'); viewport.className = 'excel-viewport';
    host.append(tabs, viewport);
    const renderSheet = index => {
        const sheet = workbook.Sheets[workbook.SheetNames[index]];
        tabs.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('active', i === index); b.setAttribute('aria-selected', String(i === index)); });
        viewport.replaceChildren();
        if (!sheet['!ref']) { viewport.textContent = 'Leeres Arbeitsblatt'; return; }
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const endRow = Math.min(range.e.r, range.s.r + 999);
        const endCol = Math.min(range.e.c, range.s.c + 99);
        const merges = (sheet['!merges'] || []).filter(m => m.s.r <= endRow && m.s.c <= endCol);
        const table = document.createElement('table'); table.className = 'attachment-spreadsheet-preview';
        table.setAttribute('aria-label', workbook.SheetNames[index]);
        const colgroup = document.createElement('colgroup');
        let totalWidth = 0;
        for (let c = range.s.c; c <= endCol; c++) {
            const col = document.createElement('col'); const width = sheet['!cols']?.[c];
            const pixels = Math.max(35, Math.min(800, width?.wpx || (width?.wch ? width.wch * 7 + 5 : 120)));
            col.style.width = `${pixels}px`;
            if (!width?.hidden) totalWidth += pixels;
            if (width?.hidden) col.style.visibility = 'collapse';
            colgroup.appendChild(col);
        }
        table.style.width = `${totalWidth}px`;
        table.appendChild(colgroup);
        const tbody = document.createElement('tbody'); table.appendChild(tbody);
        for (let r = range.s.r; r <= endRow; r++) {
            if (sheet['!rows']?.[r]?.hidden) continue;
            const tr = tbody.insertRow();
            if (sheet['!rows']?.[r]?.hpt) tr.style.height = `${Math.min(500, sheet['!rows'][r].hpt)}pt`;
            for (let c = range.s.c; c <= endCol; c++) {
                const merge = merges.find(m => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
                if (merge && (r !== merge.s.r || c !== merge.s.c)) continue;
                const td = tr.insertCell();
                if (merge) { td.rowSpan = Math.min(merge.e.r, endRow) - r + 1; td.colSpan = Math.min(merge.e.c, endCol) - c + 1; }
                const cell = sheet[XLSX.utils.encode_cell({ r, c })];
                td.textContent = cell ? (cell.w ?? XLSX.utils.format_cell(cell)) : '';
                if (cell?.t === 'n') td.classList.add('excel-number');
            }
        }
        viewport.appendChild(table);
        if (range.e.r > endRow || range.e.c > endCol) {
            const notice = document.createElement('p'); notice.className = 'hint';
            notice.textContent = 'Vorschau auf 1.000 Zeilen und 100 Spalten begrenzt. Die vollständige Datei steht zum Download bereit.';
            viewport.appendChild(notice);
        }
    };
    workbook.SheetNames.forEach((name, i) => {
        const button = document.createElement('button'); button.className = 'tab-btn'; button.type = 'button'; button.setAttribute('role', 'tab');
        button.textContent = name; button.onclick = () => renderSheet(i); tabs.appendChild(button);
    });
    if (workbook.SheetNames.length) renderSheet(0);
}
