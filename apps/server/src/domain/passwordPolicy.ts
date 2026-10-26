import { randomInt } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export const defaultPasswordPolicy = { minLength: 14, minLowercase: 0, minUppercase: 0, minDigits: 0, minSpecial: 0 };
export type PasswordPolicy = typeof defaultPasswordPolicy;
export function passwordFailures(password: string, policy: PasswordPolicy): string[] {
  return Object.entries({ minLength: password.length,
    minLowercase: (password.match(/\p{Ll}/gu) || []).length,
    minUppercase: (password.match(/\p{Lu}/gu) || []).length,
    minDigits: (password.match(/\p{N}/gu) || []).length,
    minSpecial: (password.match(/[^\p{L}\p{N}\s]/gu) || []).length
  }).filter(([key, count]) => count < policy[key as keyof PasswordPolicy]).map(([key]) => key);
}
export async function loadPasswordPolicy(db: Kysely<Database>): Promise<PasswordPolicy> {
  const row = await db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst();
  let saved: Partial<PasswordPolicy> = {};
  try { saved = JSON.parse(row?.config_json || '{}').securityConfig?.passwordPolicy || {}; } catch { /* Safe defaults for legacy settings. */ }
  const policy = { ...defaultPasswordPolicy };
  for (const key of Object.keys(policy) as (keyof PasswordPolicy)[]) {
    const value = saved[key];
    if (Number.isInteger(value) && value! >= (key === 'minLength' ? 14 : 0) && value! <= (key === 'minLength' ? 128 : 16)) policy[key] = value!;
  }
  return policy;
}
export function generatePolicyPassword(policy: PasswordPolicy): string {
  const groups = { minLowercase: 'abcdefghijkmnopqrstuvwxyz', minUppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ', minDigits: '23456789', minSpecial: '!@#$%&*+-=?' };
  const chars: string[] = [];
  for (const [key, alphabet] of Object.entries(groups)) {
    for (let n = 0; n < policy[key as keyof PasswordPolicy]; n++) chars.push(alphabet[randomInt(alphabet.length)]!);
  }
  const alphabet = Object.values(groups).join('');
  while (chars.length < Math.max(24, policy.minLength)) chars.push(alphabet[randomInt(alphabet.length)]!);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join('');
}
