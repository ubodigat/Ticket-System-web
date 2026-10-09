import { describe, it, expect } from 'vitest';
import { Secret, TOTP } from 'otpauth';

// Testet genau die otpauth-Nutzung, auf die sich auth.ts/mfa.ts verlassen (verifyTotpCode,
// Setup/Confirm-Flow) -- kein Netzwerk/DB nötig, da hier nur die kryptographische Grundlage
// geprüft wird, nicht die HTTP-Routen selbst (dafür fehlt in dieser Umgebung eine MariaDB).
describe('TOTP (otpauth)', () => {
  it('akzeptiert einen gerade erzeugten Code', () => {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: 'Ticket-System', label: 'user1', secret, digits: 6, period: 30 });
    const code = totp.generate();
    expect(totp.validate({ token: code, window: 1 })).not.toBeNull();
  });

  it('lehnt einen falschen Code ab', () => {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: 'Ticket-System', label: 'user1', secret, digits: 6, period: 30 });
    totp.generate();
    expect(totp.validate({ token: '000000', window: 1 })).toBeNull();
  });

  it('ein Code für ein anderes Secret wird abgelehnt (keine geräteübergreifende Wiederverwendung)', () => {
    const secretA = new Secret({ size: 20 });
    const secretB = new Secret({ size: 20 });
    const totpA = new TOTP({ secret: secretA, digits: 6, period: 30 });
    const totpB = new TOTP({ secret: secretB, digits: 6, period: 30 });
    const codeA = totpA.generate();
    expect(totpB.validate({ token: codeA, window: 1 })).toBeNull();
  });
});
