/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Reine, serverseitig verbindliche Fristberechnung (SLA) -- vorher gab es nur eine clientseitige
// Anzeige-Rechnung in script.js, der Server selbst hat sla_due_at nie gesetzt. Jetzt berechnet
// und setzt tickets.ts diesen Wert bei der Ticket-Erstellung, damit die Frist eine echte,
// serverseitige Tatsache ist statt einer reinen Browser-Anzeige.
export interface BusinessHoursDayConfig {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface BusinessHoursConfig {
  start: string; // "HH:MM" -- Fallback, wenn kein individueller Tag in "perDay" konfiguriert ist
  end: string; // "HH:MM"
  days: number[]; // 0 = Sonntag ... 6 = Samstag -- Fallback, wenn "perDay" fehlt
  // Individuelle Zeiten je Wochentag (Schlüssel "0".."6") -- überschreibt start/end/days für
  // genau diesen Tag. Fehlt ein Tag hier, gelten start/end/days wie bisher.
  perDay?: Record<string, BusinessHoursDayConfig>;
  // Feiertage als "YYYY-MM-DD" (UTC-Kalendertag) -- an diesen Tagen läuft keine Frist, auch
  // wenn der Wochentag sonst als Geschäftstag konfiguriert ist.
  holidays?: string[];
}

export interface SlaConfig {
  slaHoursByPriority?: Record<string, number>;
  businessHours?: BusinessHoursConfig;
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } {
  const [h, m] = value.split(':').map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

// Addiert "hours" Stunden auf "start", wobei nur Zeit innerhalb der konfigurierten Geschäftstage
// und -zeiten zählt (ausserhalb "pausiert" die Frist, wie bei "Warten auf ..."-Status).
// Rechnet bewusst durchgehend in UTC (*nicht* der lokalen Zeitzone des Node-Prozesses) --
// deterministisch unabhängig vom Serverstandort; es gibt keine Installations-Zeitzone zum
// Konfigurieren, UTC ist die einzige eindeutige Wahl.
function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addBusinessHours(start: Date, hours: number, cfg: BusinessHoursConfig): Date {
  let remainingMs = hours * 60 * 60 * 1000;
  let cursor = new Date(start);
  const holidays = new Set(cfg.holidays ?? []);
  const fallbackEndMinutes = parseTimeOfDay(cfg.end).hours * 60 + parseTimeOfDay(cfg.end).minutes;
  const fallbackStartMinutes = parseTimeOfDay(cfg.start).hours * 60 + parseTimeOfDay(cfg.start).minutes;

  // Schutz gegen eine Konfiguration ohne gültige Geschäftstage/-fenster (würde sonst endlos laufen).
  const hasAnyWindow = cfg.perDay
    ? Object.values(cfg.perDay).some(d => d.enabled)
    : cfg.days.length > 0 && fallbackEndMinutes > fallbackStartMinutes;
  if (!hasAnyWindow) {
    return new Date(start.getTime() + remainingMs);
  }

  // Obergrenze an Schleifendurchläufen (ein Tag je Durchlauf) als zusätzliche Sicherheit.
  for (let guard = 0; guard < 3650 && remainingMs > 0; guard++) {
    const dayOfWeek = cursor.getUTCDay();
    const dayCfg: BusinessHoursDayConfig = cfg.perDay?.[String(dayOfWeek)] ?? {
      enabled: cfg.days.includes(dayOfWeek),
      start: cfg.start,
      end: cfg.end
    };
    const isHoliday = holidays.has(utcDateKey(cursor));
    const { hours: startH, minutes: startM } = parseTimeOfDay(dayCfg.start);
    const { hours: endH, minutes: endM } = parseTimeOfDay(dayCfg.end);
    const dayStart = new Date(cursor);
    dayStart.setUTCHours(startH, startM, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setUTCHours(endH, endM, 0, 0);

    if (dayCfg.enabled && !isHoliday && dayEnd > dayStart && cursor < dayEnd) {
      const windowStart = cursor < dayStart ? dayStart : cursor;
      const availableMs = dayEnd.getTime() - windowStart.getTime();
      if (availableMs > 0) {
        if (remainingMs <= availableMs) {
          return new Date(windowStart.getTime() + remainingMs);
        }
        remainingMs -= availableMs;
      }
    }

    // Zum Beginn des nächsten Kalendertags (UTC) springen.
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return cursor;
}

// null = keine Frist (Priorität nicht konfiguriert) -- status quo, kein hartes Pflichtfeld.
export function calculateSlaDueAt(createdAt: Date, priority: string, config: SlaConfig): Date | null {
  const hours = config.slaHoursByPriority?.[priority];
  if (!hours || hours <= 0) return null;
  if (!config.businessHours) {
    return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  }
  return addBusinessHours(createdAt, hours, config.businessHours);
}
