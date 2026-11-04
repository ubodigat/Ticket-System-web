import type { ResolvedDek } from '../../src/crypto/fieldCrypto.js';

// Feste Test-DEK in der Form, die ensureDek liefert (aktive Version + alle bekannten Versionen).
export function testDek(fill = 7, keyVersion = 1, purpose = 'test'): ResolvedDek {
  const rawDek = Buffer.alloc(32, fill);
  return { purpose, keyVersion, rawDek, keys: new Map([[keyVersion, rawDek]]) };
}
