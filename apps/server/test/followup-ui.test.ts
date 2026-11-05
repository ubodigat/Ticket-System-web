import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
// The helper is shipped unchanged to the browser and served via the static allowlist.
// @ts-ignore Browser module intentionally stays plain JavaScript.
import { reportPeriod } from '../../../js/report-period.js';
import { safeRequestLog, safeErrorLog } from '../src/http/logPrivacy.js';

describe('report date boundaries', () => {
  it('includes the complete last local calendar day and rejects impossible ranges', () => {
    const period = reportPeriod('custom', '29.03.2026', '29.03.2026');
    expect(new Date(period.since).getHours()).toBe(0);
    expect(new Date(period.until).getDate()).toBe(30);
    expect(new Date(period.until).getHours()).toBe(0);
    expect(reportPeriod('custom', '31.02.2026', '01.03.2026')).toBeNull();
    expect(reportPeriod('custom', '02.01.2026', '01.01.2026')).toBeNull();
    expect(reportPeriod('custom', '', '')).toBeNull();
    expect(reportPeriod('custom', '01.01.2026', '01.01.2026').until - reportPeriod('custom', '01.01.2026', '01.01.2026').since).toBe(86400000);
  });
  it('handles month/year boundaries and configured presets', () => {
    const now = new Date(2026, 0, 15, 12);
    expect(reportPeriod('previous-month', '', '', now)).toEqual({ since: new Date(2025, 11, 1).getTime(), until: new Date(2026, 0, 1).getTime() });
    expect(reportPeriod('year', '', '', now).since).toBe(new Date(2026, 0, 1).getTime());
    expect(reportPeriod('all', '', '', now).since).toBe(0);
    expect(reportPeriod('7', '', '', now).since).toBe(now.getTime() - 7 * 86400000);
    expect(reportPeriod('invalid')).toBeNull();
  });
});

describe('diagnostic data minimization', () => {
  it('omits OAuth codes, search terms, headers and addresses from request diagnostics', () => {
    const output = safeRequestLog({ method: 'GET', url: '/callback?code=PRIVATE-CODE&state=SECRET#fragment' });
    expect(output).toEqual({ method: 'GET', url: '/callback' });
    expect(safeRequestLog({ method: 'GET', url: '/users/private-id', routeOptions: { url: '/users/:id' } }).url).toBe('/users/:id');
  });
  it('retains an error code/location without SQL, payload, message or nested causes', () => {
    const error = Object.assign(new Error('private@example.invalid SQL PASSWORD'), { code: 'ER_BAD_FIELD_ERROR', sql: 'PRIVATE SQL', cause: 'PRIVATE CAUSE' });
    const text = JSON.stringify(safeErrorLog(error));
    expect(text).toContain('ER_BAD_FIELD_ERROR');
    for (const secret of ['private@example.invalid', 'PASSWORD', 'PRIVATE SQL', 'PRIVATE CAUSE']) expect(text).not.toContain(secret);
    expect(safeErrorLog({ name: 'bad\nprivate', code: 'secret@example.invalid' })).toMatchObject({ type: 'Error' });
  });
});

// Small DOM doubles exercise the actual event handlers without installing a browser or DOM package.
// They do not prove visual layout, focus trapping or native file-dialog behavior.
class Element {
  hidden = false; value = ''; textContent = ''; innerHTML = ''; focused = false; removed = false;
  parentElement: Element | null = null; children: any[] = []; nodes = new Map<string, Element>();
  classList = { contains: () => true, add: () => {}, remove: () => {} };
  querySelector(selector: string): any { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  querySelectorAll() { return []; }
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  insertBefore(child: Element) { return this.appendChild(child); }
  replaceChildren(...children: any[]) { this.children = children; }
  addEventListener() {} focus() { this.focused = true; } click() {} remove() { this.removed = true; }
}
const source = (file: string, name: string) => readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(`export const ${name} =`, `globalThis.${name} =`);
const language = { current: 'de', t: (key: string) => key, format: (key: string) => key };

describe('form event regressions', () => {
  it('opens Todo options in a foreground editor and restores the form on close', async () => {
    const nodes = new Map<string, Element>();
    const q = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
    const editor = new Element();
    const context: any = { q, Icon: () => '', Utils: {}, Lang: language, UI: { createMultiSelect: () => ({ getValue: () => [] }) },
      Store: { getUserDirectory: async () => [] }, AdminBoard: { openDialog: () => editor } };
    runInNewContext(source('todos.js', 'TodoList'), context);
    context.TodoList.user = { id: 'me' }; context.TodoList.picker = { close: () => {}, setValue: () => {} };
    await context.TodoList.openForm(null, 'personal', 'Prepare meeting');
    expect(q('#todo-form').hidden).toBe(false);
    expect(q('#todo-form').parentElement).toBe(editor.querySelector('.modal-body'));
    expect(q('#todo-content').value).toBe('Prepare meeting');
    context.TodoList.closeForm();
    expect(q('#todo-form').hidden).toBe(true);
    expect(q('#todo-form').parentElement).toBe(q('#todo-modal .modal-body'));
  });
  it('shows newly selected article files before saving and permits removing them', async () => {
    const modal = new Element();
    const context: any = { Icon: () => '', Utils: { esc: String }, Lang: language, window: {},
      Store: { getKbCategories: async () => [], uploadAccept: () => '.pdf', assertUploadAllowed: () => {} },
      UI: { bindFileDrop: () => {}, bindPasteFiles: () => {} },
      AdminBoard: { openDialog: () => modal, stagedFileChip: (file: any, onRemove: () => void) => ({ name: file.name, onRemove }) } };
    runInNewContext(source('kb-search.js', 'KbSearch'), context);
    await context.KbSearch.openEditor();
    const input = modal.querySelector('#kbe-file'); input.files = [{ name: 'Selected.pdf', size: 12 }];
    input.onchange({ target: input });
    expect(modal.querySelector('#kbe-files').children[0].name).toBe('Selected.pdf');
    expect(modal.querySelector('#kbe-file-count').textContent).toBe('1');
    modal.querySelector('#kbe-files').children[0].onRemove();
    expect(modal.querySelector('#kbe-files').children).toHaveLength(0);
  });
});
