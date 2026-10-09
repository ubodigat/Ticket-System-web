/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { Icon, Utils } from './utils.js';
import { UI } from './ui.js';
import { AdminBoard } from './admin-board.js';

export function getStatusColor(s) {
    if (s === 'Neu') return 'var(--info)';
    if (s === 'In Bearbeitung') return 'var(--warning)';
    if (String(s).startsWith('Warten auf')) return 'var(--wait)';
    if (s === 'Geschlossen') return 'var(--success)';
    return 'var(--text-sec)';
}

export function getPrioValue(p) {
    if (p === 'Kritisch') return 3;
    if (p === 'Hoch') return 2;
    if (p === 'Normal') return 1;
    return 0;
}

// approval.approver ist die User-ID des eingetragenen Prüfers (approval_reviewer_id im Backend).
export function isPendingApprover(approval, userId) {
    return approval.status === 'pending' && approval.approver === userId;
}

export function insertMarkdownText(area, marker) {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.substring(start, end);
    const wrapped = `${marker}${selected}${marker}`;
    area.value = area.value.substring(0, start) + wrapped + area.value.substring(end);
    area.focus();
    area.selectionStart = start + marker.length;
    area.selectionEnd = end + marker.length;
}

export async function insertMarkdownLink(area) {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.substring(start, end).replace(/[\[\]]/g, '');
    const href = await UI.promptText({
        title: 'Link einfügen',
        label: 'Link-Adresse',
        value: selected && /^(https?:\/\/|mailto:)/i.test(selected) ? selected : '',
        placeholder: 'https://example.com oder mailto:name@example.com',
        saveLabel: 'Link einfügen'
    });
    if (!href) return;
    if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) {
        UI.toast('Nur http-, https- und mailto-Links sind erlaubt.');
        return;
    }
    const label = selected || href.trim();
    const markdown = `[${label}](${href.trim()})`;
    area.value = area.value.substring(0, start) + markdown + area.value.substring(end);
    area.focus();
    area.selectionStart = start + markdown.length;
    area.selectionEnd = area.selectionStart;
}

// Öffnet einen Tabellen-Editor (echte Zellen statt roher |-Syntax) und fügt das Ergebnis als
// Markdown-Tabelle an der Cursorposition im übergebenen Textfeld ein.
export function insertMarkdownTable(area, existingTable = null) {
    const isRichEditor = !!area.isContentEditable;
    // Bei einem contenteditable-Feld geht die Selektion beim Öffnen des Dialogs verloren -> vorher merken
    const sel = isRichEditor ? window.getSelection() : null;
    const savedRange = (isRichEditor && sel && sel.rangeCount && area.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : null;
    const rowsFromExisting = existingTable ? [...existingTable.rows].map(tr => [...tr.cells].map(cell => cell.textContent)) : null;
    const rows = rowsFromExisting && rowsFromExisting.length ? rowsFromExisting : [['Überschrift 1', 'Überschrift 2'], ['Eintrag', 'Eintrag']];
    const insert = () => {
        const header = rows[0];
        const lines = [header, header.map(() => '---'), ...rows.slice(1)].map(r => `| ${r.join(' | ')} |`);
        const markdown = lines.join('\n');
        const start = area.selectionStart ?? area.value.length;
        const end = area.selectionEnd ?? area.value.length;
        const before = area.value.slice(0, start);
        const after = area.value.slice(end);
        const prefix = before && !before.endsWith('\n') ? '\n' : '';
        const suffix = after && !after.startsWith('\n') ? '\n' : '';
        area.setRangeText(`${prefix}${markdown}${suffix}`, start, end, 'end');
        area.focus();
        area.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const buildTableHtml = () => {
        const [header, ...body] = rows;
        return `<table><thead><tr>${header.map(h => `<th>${Utils.esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${Utils.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    };
    const insertRich = () => {
        if (existingTable) {
            existingTable.outerHTML = buildTableHtml();
            area.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        const html = `${buildTableHtml()}<p><br></p>`;
        area.focus();
        const sel2 = window.getSelection();
        sel2.removeAllRanges();
        if (savedRange) sel2.addRange(savedRange);
        else { const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); sel2.addRange(r); }
        document.execCommand('insertHTML', false, html);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const modal = AdminBoard.openDialog({
        id: 'table-builder-modal',
        title: existingTable ? 'Tabelle bearbeiten' : 'Tabelle einfügen',
        icon: 'table',
        size: 'md',
        body: `<div class="table-builder-toolbar">
                   <button type="button" class="btn-secondary btn-sm" id="tbld-add-row">${Icon('plus', 14)}Zeile</button>
                   <button type="button" class="btn-secondary btn-sm" id="tbld-add-col">${Icon('plus', 14)}Spalte</button>
               </div>
               <div class="table-builder-wrap"><table class="table-builder" id="tbld-table"></table></div>`,
        onSave: (m) => { isRichEditor ? insertRich() : insert(); m.remove(); }
    });
    const render = () => {
        const table = modal.querySelector('#tbld-table');
        table.innerHTML = '';
        rows.forEach((row, rIdx) => {
            const tr = document.createElement('tr');
            row.forEach((val, cIdx) => {
                const cell = document.createElement(rIdx === 0 ? 'th' : 'td');
                const input = document.createElement('input');
                input.type = 'text';
                input.value = val;
                input.placeholder = rIdx === 0 ? `Überschrift ${cIdx + 1}` : '';
                input.oninput = () => { rows[rIdx][cIdx] = input.value; };
                cell.appendChild(input);
                if (rIdx === 0 && row.length > 1) {
                    const removeCol = document.createElement('button');
                    removeCol.type = 'button';
                    removeCol.className = 'btn-ghost btn-icon btn-xs btn-danger tbld-col-remove';
                    removeCol.title = 'Spalte entfernen';
                    removeCol.setAttribute('aria-label', 'Spalte entfernen');
                    removeCol.innerHTML = Icon('x', 12);
                    removeCol.onclick = () => { rows.forEach(r => r.splice(cIdx, 1)); render(); };
                    cell.appendChild(removeCol);
                }
                tr.appendChild(cell);
            });
            const actionCell = document.createElement(rIdx === 0 ? 'th' : 'td');
            actionCell.className = 'tbld-row-actions';
            if (rIdx > 0 && rows.length > 2) {
                const removeRow = document.createElement('button');
                removeRow.type = 'button';
                removeRow.className = 'btn-ghost btn-icon btn-xs btn-danger';
                removeRow.title = 'Zeile entfernen';
                removeRow.setAttribute('aria-label', 'Zeile entfernen');
                removeRow.innerHTML = Icon('x', 13);
                removeRow.onclick = () => { rows.splice(rIdx, 1); render(); };
                actionCell.appendChild(removeRow);
            }
            tr.appendChild(actionCell);
            table.appendChild(tr);
        });
        if (window.lucide) lucide.createIcons();
    };
    modal.querySelector('#tbld-add-row').onclick = () => { rows.push(new Array(rows[0].length).fill('')); render(); };
    modal.querySelector('#tbld-add-col').onclick = () => { rows.forEach(r => r.push('')); render(); };
    render();
}
