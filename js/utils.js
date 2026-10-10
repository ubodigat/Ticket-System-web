/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { Lang } from './lang.js';

export const q = (s) => document.querySelector(s);
export const qa = (s) => Array.from(document.querySelectorAll(s));

// Icons: Größe per Parameter; Abstände kommen immer vom Container (gap), nie vom Icon
export const Icon = (name, size = 16) =>
    `<i data-lucide="${name}" width="${size}" height="${size}"></i>`;

// --- Utils ---
export const Utils = {
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    // Kryptographisch sicherer Zufallswert (crypto.getRandomValues) -- NUR fuer
    // sicherheitsrelevante Werte wie das temporaere Fallback-Passwort beim Anlegen neuer
    // Benutzer, nie fuer DOM-IDs o.ae. (dort reicht Utils.uid). Mit Math.random() (Utils.uid)
    // waere ein solches Passwort fuer Angreifer vorhersagbar (CWE-338).
    secureToken: (byteLength = 24) => {
        const bytes = new Uint8Array(byteLength);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('');
    },
    nowISO: () => new Date().toISOString(),
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } [c])),
    fmtDate: (iso) => {
        if (!iso) return '-';
        const d = new Date(iso);
        const locale = (typeof Lang !== 'undefined' && Lang.current === 'en') ? 'en-GB' : 'de-DE';
        return d.toLocaleDateString(locale, {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit'
            }) +
            ' ' + d.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit'
            });
    },
    searchText: (...values) => {
        const seen = new Set();
        const parts = [];
        const walk = (value) => {
            if (value == null) return;
            if (value instanceof Date) {
                parts.push(value.toISOString(), Utils.fmtDate(value.toISOString()));
                return;
            }
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                const text = String(value);
                parts.push(text);
                if (/^\d{4}-\d{2}-\d{2}T/.test(text)) parts.push(Utils.fmtDate(text), text.slice(0, 10));
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) value.forEach(walk);
            else Object.entries(value).forEach(([key, val]) => {
                if (key === 'data') return;
                parts.push(key);
                walk(val);
            });
        };
        values.forEach(walk);
        return parts.join(' ').toLowerCase();
    },
    matchesSearch: (query, ...values) => {
        const qv = String(query || '').toLowerCase().trim();
        return !qv || Utils.searchText(...values).includes(qv);
    },
    formatRichText: (value = '') => {
        let html = Utils.esc(value);
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, (match, label, href) =>
            `<a href="${Utils.esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        );
        return html
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    },
    // Säubert HTML aus einem contenteditable-Editor, bevor es gespeichert/erneut angezeigt wird:
    // entfernt script/style/iframe & Co. sowie Event-Handler- und javascript:-Attribute.
    // Erkennt "@Vollständiger Name" (neu, direkt beim Tippen eingesetzt) genauso wie das ältere
    // "@benutzername" in gespeicherten Notizen - eine einzige Stelle für Erkennung und Hervorhebung.
    buildMentionRegex: (users) => {
        const names = [];
        users.forEach(u => {
            if (u.name) names.push(u.name);
            if (u.username) names.push(u.username);
        });
        const unique = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
        if (!unique.length) return null;
        const escaped = unique.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`@(${escaped.join('|')})(?!\\w)`, 'g');
    },
    sanitizeRichHtml: (html = '') => {
        if (window.DOMPurify?.sanitize) {
            return window.DOMPurify.sanitize(html, {
                ALLOWED_TAGS: ['a', 'b', 'br', 'code', 'div', 'em', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'],
                ALLOWED_ATTR: ['class', 'href', 'rel', 'target'],
                ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
            }).trim();
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(el => el.remove());
        doc.body.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value))) {
                    el.removeAttribute(attr.name);
                }
            });
            if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        });
        return doc.body.innerHTML.trim();
    },
    // Rendert den in den Notiz-/Textfeldern verwendeten Markdown-Dialekt (fett, kursiv, Code, Links,
    // Listen, Tabellen) als HTML. Wird von internen Notizen und der Wissensdatenbank gemeinsam genutzt.
    renderMarkdown: (value = '') => {
        const lines = Utils.esc(value).replace(/\r/g, '').split('\n');
        const inline = text => text
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, (match, label, href) =>
                `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
        const cellsFrom = line => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|')) return null;
            return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
        };
        const isTableSeparator = cells => cells?.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
        const output = [];
        let listType = '';
        const closeList = () => {
            if (listType) output.push(`</${listType}>`);
            listType = '';
        };
        for (let index = 0; index < lines.length;) {
            const header = cellsFrom(lines[index]);
            const separator = cellsFrom(lines[index + 1] || '');
            if (header?.length > 1 && isTableSeparator(separator)) {
                closeList();
                const rows = [];
                let rowIndex = index + 2;
                while (rowIndex < lines.length) {
                    const cells = cellsFrom(lines[rowIndex]);
                    if (!cells) break;
                    rows.push(cells);
                    rowIndex++;
                }
                output.push(`<div class="note-table-wrap"><table class="note-markdown-table"><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
                index = rowIndex;
                continue;
            }
            const bullet = lines[index].match(/^\s*-\s+(.*)$/);
            const numbered = lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
            const listItem = bullet || numbered;
            if (listItem) {
                const nextType = bullet ? 'ul' : 'ol';
                if (listType !== nextType) {
                    closeList();
                    listType = nextType;
                    output.push(`<${listType}>`);
                }
                output.push(`<li>${inline(listItem[1])}</li>`);
                index++;
                continue;
            }
            closeList();
            output.push(lines[index] ? `${inline(lines[index])}<br>` : '<br>');
            index++;
        }
        closeList();
        return output.join('');
    },
    read: (_key, fallback) => fallback,
    write: () => true,
    adjustColor: (color, amount) => {
        return '#' + color.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
    },
    normalizeHex: (value) => {
        let v = String(value || '').trim().replace(/^#/, '').toLowerCase();
        if (/^[0-9a-f]{3}$/.test(v)) v = v.split('').map(c => c + c).join('');
        return /^[0-9a-f]{6}$/.test(v) ? '#' + v : null;
    },
    hexToHsv: (hex) => {
        const n = parseInt((Utils.normalizeHex(hex) || '#6366f1').slice(1), 16);
        const r = ((n >> 16) & 255) / 255,
            g = ((n >> 8) & 255) / 255,
            b = (n & 255) / 255;
        const max = Math.max(r, g, b),
            min = Math.min(r, g, b),
            d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return {
            h,
            s: max ? d / max : 0,
            v: max
        };
    },
    hsvToHex: ({
        h,
        s,
        v
    }) => {
        const f = (k) => {
            const x = (k + h / 60) % 6;
            return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
        };
        return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    },
    hexToRgb: (hex) => {
        const clean = String(hex || '').replace('#', '');
        if (clean.length !== 6) return '99, 102, 241';
        const n = parseInt(clean, 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    },
    fmtDateOnly: (value) => {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    },
    fmtTimeOnly: (value) => {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    parseGermanDateTime: (dateValue, timeValue = '00:00') => {
        const match = String(dateValue || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        const time = String(timeValue || '').trim().match(/^(\d{2}):(\d{2})$/);
        if (!match || !time) return null;
        const [, dd, mm, yyyy] = match.map(Number);
        const [, hh, min] = time.map(Number);
        const d = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
        if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd || d.getHours() !== hh || d.getMinutes() !== min) return null;
        return d.getTime();
    }
};
