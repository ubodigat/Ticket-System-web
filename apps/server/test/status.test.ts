import { describe, it, expect } from 'vitest';
import { isValidTicketStatus, isWaitingStatus, isValidStatusTransition, TICKET_STATUSES } from '../src/domain/status.js';

describe('isValidTicketStatus', () => {
  it('akzeptiert jeden Status aus der bekannten Liste', () => {
    for (const status of TICKET_STATUSES) {
      expect(isValidTicketStatus(status)).toBe(true);
    }
  });

  it('lehnt beliebige, nicht definierte Status-Strings ab (Business-Logic-Schutz)', () => {
    expect(isValidTicketStatus('Erledigt')).toBe(false);
    expect(isValidTicketStatus('')).toBe(false);
    expect(isValidTicketStatus('neu')).toBe(false); // Gross-/Kleinschreibung ist relevant
    expect(isValidTicketStatus('<script>alert(1)</script>')).toBe(false);
  });
});

describe('isWaitingStatus', () => {
  it('erkennt alle "Warten auf ..."-Varianten', () => {
    expect(isWaitingStatus('Warten auf Benutzer')).toBe(true);
    expect(isWaitingStatus('Warten auf externen Dienstleister')).toBe(true);
  });

  it('erkennt Nicht-Warte-Status korrekt nicht als wartend', () => {
    expect(isWaitingStatus('Neu')).toBe(false);
    expect(isWaitingStatus('Geschlossen')).toBe(false);
  });
});

describe('isValidStatusTransition', () => {
  it('erlaubt den Wechsel in jeden bekannten Status, auch von Geschlossen zurück (Wiedereröffnen)', () => {
    expect(isValidStatusTransition('Geschlossen', 'In Bearbeitung')).toBe(true);
    expect(isValidStatusTransition('Neu', 'Geschlossen')).toBe(true);
  });

  it('lehnt den Wechsel in einen unbekannten Status ab', () => {
    expect(isValidStatusTransition('Neu', 'Irgendwas')).toBe(false);
  });
});
