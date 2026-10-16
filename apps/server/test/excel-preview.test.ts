import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { renderWorkbook } from '../../../js/excel-preview.js';

const require = createRequire(import.meta.url);
const XLSX = require('../../../vendor/xlsx.full.min.js');

// Minimal DOM surface for checking actual worksheet coordinates and text-only output.
class Element {
  children: Element[] = [];
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name) };
  textContent = '';
  className = '';
  rowSpan = 1;
  colSpan = 1;
  onclick?: () => void;
  constructor(public tagName: string) {}
  appendChild(child: Element) { this.children.push(child); return child; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  querySelectorAll(tag: string): Element[] { return this.children.flatMap(c => [...(c.tagName === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
  insertRow() { return this.appendChild(new Element('tr')); }
  insertCell() { return this.appendChild(new Element('td')); }
}
afterEach(() => vi.unstubAllGlobals());

function preview(workbook: any) {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const host = new Element('div');
  renderWorkbook(workbook, host, XLSX);
  return host;
}

describe('Excel attachment preview', () => {
  it('preserves blank cells, merged headers, column widths and formatted values after XLSX roundtrip', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Meeting', null, 'Date'], ['First', null, 123.5], ['<img src=x onerror=alert(1)>']]);
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    sheet['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 20 }];
    sheet.C2.z = '0.00';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Overview');
    const loaded = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellStyles: true });
    const host = preview(loaded);
    const rows = host.querySelectorAll('tr');
    expect(rows[0].children.map(c => c.textContent)).toEqual(['Meeting', 'Date']);
    expect(rows[0].children[0].colSpan).toBe(2);
    expect(rows[1].children.map(c => c.textContent)).toEqual(['First', '', '123.50']);
    expect(parseInt(host.querySelectorAll('col')[0].style.width)).toBeGreaterThan(parseInt(host.querySelectorAll('col')[1].style.width));
    expect(rows[2].children[0].textContent).toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelectorAll('img')).toHaveLength(0);
  });

  it('switches worksheets without combining their tables', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['First sheet']]), 'First');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second sheet']]), 'Second');
    const host = preview(workbook);
    expect(host.querySelectorAll('td')[0].textContent).toBe('First sheet');
    host.querySelectorAll('button')[1].onclick!();
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelectorAll('td')[0].textContent).toBe('Second sheet');
  });
});
