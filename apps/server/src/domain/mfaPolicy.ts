export type MfaMode = 'disabled' | 'totp' | 'passkey' | 'either' | 'both';
export function mfaSatisfied(mode: MfaMode, proof: { totp: boolean; passkey: boolean }, freshDevice = false) {
  if (mode === 'disabled') return true;
  if (mode === 'totp') return proof.totp;
  if (mode === 'passkey') return proof.passkey;
  if (mode === 'either') return proof.totp || proof.passkey;
  return proof.totp && (proof.passkey || freshDevice);
}
