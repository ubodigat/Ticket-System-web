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
}

// Kategorie -> kurzer Code für {category} in der Vorlage (ohne Umlaute/Sonderzeichen, Großbuchstaben).
export function ticketNumberCategoryCode(category: string | null | undefined): string {
  return String(category || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'GENERAL';
}

export function buildTicketNumber(sequence: number, category: string | null | undefined, cfg: TicketNumberConfig): string {
  const numberFormat = cfg.ticketNumberFormat ?? {};
  const prefix = String(numberFormat.prefix ?? '').trim();
  const padding = Math.max(1, Math.min(12, Number(numberFormat.padding) || 5));
  const categoryFormats = cfg.ticketNumberCategoryFormats ?? {};
  const template = String((category && categoryFormats[category]) || numberFormat.format || (prefix ? '{prefix}-{number}' : '{number}')).trim();
  const number = String(sequence).padStart(padding, '0');
  // Eine Vorlage ohne {number} würde Kollisionen erzeugen (jede Nummer sähe gleich aus) --
  // dann lieber auf die reine Zahl zurückfallen, statt eine kaputte Nummer zu vergeben.
  const safeTemplate = template.includes('{number}') ? template : '{number}';
  return safeTemplate
    .replaceAll('{prefix}', prefix)
    .replaceAll('{category}', ticketNumberCategoryCode(category))
    .replaceAll('{number}', number);
}
