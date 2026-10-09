import { describe, it, expect } from 'vitest';
import { csvSafeCell, parseCsvLine } from '../src/http/routes/users.js';

// Deckt genau die Anforderung "CSV-Formel-Injektions-Neutralisierung" ab (docs/SPEC.md §10).
describe('csvSafeCell', () => {
  it('lässt normalen Text unverändert (nur CSV-Quoting)', () => {
    expect(csvSafeCell('Max Mustermann')).toBe('"Max Mustermann"');
  });

  it('neutralisiert eine Formel, die mit = beginnt', () => {
    const cell = csvSafeCell('=HYPERLINK("http://evil.example")');
    expect(cell.startsWith('"\'=')).toBe(true);
  });

  it('neutralisiert +, -, @ als erstes Zeichen', () => {
    expect(csvSafeCell('+1234').startsWith('"\'+')).toBe(true);
    expect(csvSafeCell('-1234').startsWith('"\'-')).toBe(true);
    expect(csvSafeCell('@SUM(1,2)').startsWith('"\'@')).toBe(true);
  });

  it('escaped doppelte Anführungszeichen korrekt', () => {
    expect(csvSafeCell('Sagt "Hallo"')).toBe('"Sagt ""Hallo"""');
  });
});

describe('parseCsvLine', () => {
  it('parst einfache, durch Komma getrennte Werte', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('parst in Anführungszeichen eingeschlossene Werte mit Kommas', () => {
    expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });

  it('entfernt das Neutralisierungs-Apostroph beim Einlesen wieder', () => {
    expect(parseCsvLine("'=foo,bar")).toEqual(['=foo', 'bar']);
  });
});
