import { describe, it, expect } from 'vitest';
import { calculateSlaDueAt } from '../src/domain/sla.js';

describe('calculateSlaDueAt', () => {
  it('liefert null, wenn für die Priorität keine Frist konfiguriert ist', () => {
    expect(calculateSlaDueAt(new Date('2026-03-02T10:00:00Z'), 'Hoch', {})).toBeNull();
  });

  it('rechnet ohne Geschäftszeiten einfach die Stunden auf den Erstellzeitpunkt auf', () => {
    const due = calculateSlaDueAt(new Date('2026-03-02T10:00:00Z'), 'Kritisch', {
      slaHoursByPriority: { Kritisch: 4 }
    });
    expect(due?.toISOString()).toBe('2026-03-02T14:00:00.000Z');
  });

  it('bleibt innerhalb desselben Geschäftstags, wenn die Frist davor endet', () => {
    // Montag (2026-03-02), Geschäftszeit 08:00-17:00, Erstellung 10:00, 4h Frist -> 14:00 selber Tag.
    const due = calculateSlaDueAt(new Date('2026-03-02T10:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 4 },
      businessHours: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }
    });
    expect(due?.toISOString()).toBe('2026-03-02T14:00:00.000Z');
  });

  it('springt über die Nacht/arbeitsfreie Zeit auf den nächsten Geschäftstag', () => {
    // Montag 16:00, Geschäftszeit bis 17:00 (1h übrig), 4h Frist -> 3h bleiben für Dienstag ab 08:00 -> 11:00.
    const due = calculateSlaDueAt(new Date('2026-03-02T16:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 4 },
      businessHours: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }
    });
    expect(due?.toISOString()).toBe('2026-03-03T11:00:00.000Z');
  });

  it('überspringt das Wochenende, wenn nur Mo-Fr als Geschäftstage konfiguriert sind', () => {
    // Freitag 16:00, 1h übrig an diesem Tag, 2h Frist -> 1h bleibt für Montag ab 08:00 -> 09:00.
    const due = calculateSlaDueAt(new Date('2026-03-06T16:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 2 },
      businessHours: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }
    });
    expect(due?.toISOString()).toBe('2026-03-09T09:00:00.000Z');
  });

  it('behandelt eine Erstellung ausserhalb der Geschäftszeit korrekt (vor Öffnung)', () => {
    // Montag 05:00 (vor 08:00 Öffnung), 2h Frist -> beginnt erst um 08:00 -> 10:00.
    const due = calculateSlaDueAt(new Date('2026-03-02T05:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 2 },
      businessHours: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }
    });
    expect(due?.toISOString()).toBe('2026-03-02T10:00:00.000Z');
  });

  it('ignoriert Prioritäten mit 0 oder negativer Stundenzahl (kein gültiger Wert)', () => {
    expect(calculateSlaDueAt(new Date('2026-03-02T10:00:00Z'), 'Niedrig', {
      slaHoursByPriority: { Niedrig: 0 }
    })).toBeNull();
  });

  it('nutzt individuelle Geschäftszeiten je Wochentag aus "perDay", wenn vorhanden', () => {
    // Montag (Wochentag 1) hat per "perDay" nur 09:00-12:00 (statt des globalen 08:00-17:00).
    // Erstellung 10:00, 1h Frist -> endet 11:00, noch am selben Vormittag.
    const due = calculateSlaDueAt(new Date('2026-03-02T10:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 1 },
      businessHours: {
        start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5],
        perDay: { '1': { enabled: true, start: '09:00', end: '12:00' } }
      }
    });
    expect(due?.toISOString()).toBe('2026-03-02T11:00:00.000Z');
  });

  it('überspringt als Feiertag markierte Tage, auch wenn der Wochentag sonst ein Geschäftstag ist', () => {
    // Montag 2026-03-02 ist als Feiertag markiert -> Frist beginnt erst am Dienstag um 08:00.
    const due = calculateSlaDueAt(new Date('2026-03-01T20:00:00Z'), 'Hoch', {
      slaHoursByPriority: { Hoch: 2 },
      businessHours: {
        start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5],
        holidays: ['2026-03-02']
      }
    });
    expect(due?.toISOString()).toBe('2026-03-03T10:00:00.000Z');
  });
});
