import { describe, it, expect } from 'vitest';
import { buildTicketNumber, ticketNumberCategoryCode } from '../src/domain/ticketNumber.js';

describe('buildTicketNumber', () => {
  it('nutzt {prefix}-{number} als Standard, wenn ein Präfix gesetzt ist', () => {
    expect(buildTicketNumber(7, null, { ticketNumberFormat: { prefix: 'TS', padding: 5 } })).toBe('TS-00007');
  });

  it('nutzt nur {number} ohne Präfix und ohne eigenes Format', () => {
    expect(buildTicketNumber(3, null, { ticketNumberFormat: { padding: 4 } })).toBe('0003');
  });

  it('respektiert eine eigene Formatvorlage mit {category}', () => {
    expect(buildTicketNumber(12, 'Technik', {
      ticketNumberFormat: { prefix: 'TS', padding: 3, format: '{prefix}/{category}/{number}' }
    })).toBe('TS/TECHNIK/012');
  });

  it('überschreibt das Standardformat durch ein Kategorie-spezifisches Format', () => {
    expect(buildTicketNumber(1, 'Abrechnung', {
      ticketNumberFormat: { prefix: 'TS', padding: 3 },
      ticketNumberCategoryFormats: { Abrechnung: 'RECHNUNG-{number}' }
    })).toBe('RECHNUNG-001');
  });

  it('fällt bei einer Vorlage ohne {number} auf die reine Zahl zurück (keine Kollisionen)', () => {
    expect(buildTicketNumber(5, null, { ticketNumberFormat: { format: 'TS-FEST' } })).toBe('00005');
  });

  it('erzeugt einen sicheren Kategorie-Code ohne Umlaute/Sonderzeichen', () => {
    expect(ticketNumberCategoryCode('Äußere Dienste & Support')).toBe('AU-ERE-DIENSTE-SUPPORT');
    expect(ticketNumberCategoryCode(null)).toBe('GENERAL');
  });
});