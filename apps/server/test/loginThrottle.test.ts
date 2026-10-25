import { describe, it, expect } from 'vitest';
import { sourcePrefix, accountBackoffSecondsRemaining } from '../src/domain/loginThrottle.js';

// Security-Audit R-11: reine Hilfsfunktionen der Pro-Quellnetz-Sperre und des kontoweiten
// Backoffs -- siehe auth.ts fuer die Integration mit der Datenbank.
describe('sourcePrefix (Security-Audit R-11)', () => {
  it('fasst IPv6-Adressen auf das /64-Netz zusammen (wie das Rate-Limit in R-10)', () => {
    expect(sourcePrefix('2001:db8:1:2::1')).toBe(sourcePrefix('2001:db8:1:2::2'));
    expect(sourcePrefix('2001:db8:1:2:0:0:0:1')).toBe(sourcePrefix('2001:db8:1:2::1'));
  });

  it('behandelt unterschiedliche Schreibweisen derselben Adresse gleich', () => {
    const a = sourcePrefix('2001:0db8:0001:0002:0000:0000:0000:0001');
    const b = sourcePrefix('2001:DB8:1:2::1');
    expect(a).toBe(b);
  });

  it('unterscheidet verschiedene /64-Netze', () => {
    expect(sourcePrefix('2001:db8:1:2::1')).not.toBe(sourcePrefix('2001:db8:1:3::1'));
  });

  it('lässt IPv4-Adressen unverändert (volle Adresse, kein pauschales Netz)', () => {
    expect(sourcePrefix('203.0.113.9')).toBe('203.0.113.9');
    expect(sourcePrefix('203.0.113.9')).not.toBe(sourcePrefix('203.0.113.10'));
  });
});

describe('accountBackoffSecondsRemaining (Security-Audit R-11)', () => {
  it('liefert 0 unterhalb der Schwelle', () => {
    expect(accountBackoffSecondsRemaining(9, new Date())).toBe(0);
  });

  it('liefert 0 ohne letzten Fehlversuch', () => {
    expect(accountBackoffSecondsRemaining(20, null)).toBe(0);
  });

  it('wächst mit der Anzahl der Fehlversuche und ist nach Ablauf wieder 0', () => {
    const justNow = new Date();
    const atThreshold = accountBackoffSecondsRemaining(10, justNow);
    const oneMore = accountBackoffSecondsRemaining(11, justNow);
    expect(atThreshold).toBeGreaterThan(0);
    expect(oneMore).toBeGreaterThan(atThreshold);

    const longAgo = new Date(Date.now() - 10 * 60 * 1000);
    expect(accountBackoffSecondsRemaining(10, longAgo)).toBe(0);
  });

  it('ist auf 5 Minuten gedeckelt', () => {
    const justNow = new Date();
    expect(accountBackoffSecondsRemaining(30, justNow)).toBeLessThanOrEqual(300);
  });
});
