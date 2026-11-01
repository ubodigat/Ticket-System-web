/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Reine Ticketnummer-Formatierung -- war vorher in tickets.ts hart auf
// String(n).padStart(5,'0') fest codiert; Präfix/Format/Kategorie-Format aus den
// Systemeinstellungen wurden komplett ignoriert. Jetzt hier als eigenes, testbares Modul.
export interface TicketNumberFormatConfig {
  prefix?: string;
  padding?: number;
  format?: string;
}

export interface TicketNumberConfig {
  ticketNumberFormat?: TicketNumberFormatConfig;
  ticketNumberCategoryFormats?: Record<string, string>;
  // Eigene Kuerzel je Kategorie fuer {category} (sonst aus dem Namen abgeleitet).
  ticketNumberCategoryCodes?: Record<string, string>;
  companyBrandingConfig?: { timezone?: string };
}

// Bausteine, aus denen sich eine Vorlage zusammensetzen laesst (Systemeinstellungen zeigt sie
// zum Anklicken an). Die Spalte tickets.ticket_number fasst hoechstens 32 Zeichen.
export const TICKET_NUMBER_TOKENS = ['{prefix}', '{category}', '{year}', '{yy}', '{month}', '{day}', '{number}'] as const;
export const TICKET_NUMBER_MAX_LENGTH = 32;
export const TICKET_CATEGORY_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

// Kategorie -> kurzer Code für {category} in der Vorlage (ohne Umlaute/Sonderzeichen, Großbuchstaben).
export function ticketNumberCategoryCode(category: string | null | undefined, codes: Record<string, string> = {}): string {
  const custom = category ? String(codes[category] || '').trim() : '';
  if (custom && TICKET_CATEGORY_CODE_PATTERN.test(custom)) return custom.toUpperCase();
  return String(category || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'GENERAL';
}

// Prueft eine Vorlage. Die laufende Nummer wird spaeter wieder aus der letzten Zifferngruppe der
// Ticketnummer gelesen (tickets.ts/maintenance.ts) -- deshalb darf nach {number} nichts mehr mit
// Ziffern folgen und direkt davor keine Ziffer oder kein Baustein stehen ("2026" + "00012" waere
// sonst eine einzige Zahl). Liefert einen Fehlercode oder null.
export function ticketNumberFormatProblem(format: string): string | null {
  if (!format.includes('{number}')) return 'missing_number';
  if (format.split('{number}').length > 2) return 'number_twice';
  const literal = format.replace(/\{(prefix|category|year|yy|month|day|number)\}/g, '');
  if (/[{}]/.test(literal)) return 'unknown_token';
  if (!/^[A-Za-z0-9 _./#-]*$/.test(literal)) return 'invalid_character';
  if (!/(^|[^0-9}])\{number\}[^0-9{}]*$/.test(format)) return 'number_position';
  return null;
}

function dateParts(now: Date, timeZone: string | undefined) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  }
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function buildTicketNumber(sequence: number, category: string | null | undefined, cfg: TicketNumberConfig, now: Date = new Date()): string {
  const numberFormat = cfg.ticketNumberFormat ?? {};
  const prefix = String(numberFormat.prefix ?? '').trim();
  const padding = Math.max(1, Math.min(12, Number(numberFormat.padding) || 5));
  const categoryFormats = cfg.ticketNumberCategoryFormats ?? {};
  const template = String((category && categoryFormats[category]) || numberFormat.format || (prefix ? '{prefix}-{number}' : '{number}')).trim();
  const number = String(sequence).padStart(padding, '0');
  // Eine ungueltige Vorlage (z.B. ohne {number}) wuerde Kollisionen oder eine falsch
  // weiterzaehlende Nummer erzeugen -- dann lieber auf die reine Zahl zurueckfallen.
  const safeTemplate = ticketNumberFormatProblem(template) ? '{number}' : template;
  const date = dateParts(now, cfg.companyBrandingConfig?.timezone);
  return safeTemplate
    .replaceAll('{prefix}', prefix)
    .replaceAll('{category}', ticketNumberCategoryCode(category, cfg.ticketNumberCategoryCodes))
    .replaceAll('{year}', date.year)
    .replaceAll('{yy}', date.year.slice(-2))
    .replaceAll('{month}', date.month)
    .replaceAll('{day}', date.day)
    .replaceAll('{number}', number);
}
