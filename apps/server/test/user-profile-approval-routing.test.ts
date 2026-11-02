import { describe, expect, it } from 'vitest';
import { approverCandidates } from '../src/domain/approvalRouting.js';
import { decryptUserProfile, encryptUserProfile, userProfileSchema } from '../src/domain/userProfile.js';

describe('approval routing with substitutes per group or category', () => {
  const groups = [{ id: 'it', parent_id: null }, { id: 'net', parent_id: 'it' }, { id: 'hr', parent_id: null }];
  const rules = [
    { type: 'group' as const, target: 'it', userId: 'it-lead' },
    { type: 'group' as const, target: 'net', userId: 'net-lead' },
    { type: 'category' as const, target: 'Hardware', userId: 'hw-lead' }
  ];

  it('keeps the supervisor first, then category, own group, parent group and the general substitute', () => {
    expect(approverCandidates({ supervisorId: 'boss', rules, category: 'Hardware', creatorGroupIds: ['net'], groups, globalFallbackId: 'fallback' }))
      .toEqual(['boss', 'hw-lead', 'net-lead', 'it-lead', 'fallback']);
  });

  it('falls back to the general substitute when no rule matches', () => {
    expect(approverCandidates({ supervisorId: null, rules, category: 'Software', creatorGroupIds: ['hr'], groups, globalFallbackId: 'fallback' }))
      .toEqual(['fallback']);
  });

  it('works without rules and does not list anyone twice', () => {
    expect(approverCandidates({ supervisorId: 'fallback', rules: undefined, category: null, creatorGroupIds: [], groups, globalFallbackId: 'fallback' }))
      .toEqual(['fallback']);
  });
});

describe('user profile with working hours', () => {
  const cipher = { installationId: 'test', schemaVersion: 1, recordId: 'user-1', dek: { rawDek: Buffer.alloc(32, 3), keyVersion: 1 } };

  it('accepts part-time schedules and round-trips them encrypted', () => {
    const profile = userProfileSchema.parse({ employee_number: 'P-17', work_days: { '1': { start: '08:00', end: '12:30' }, '3': { start: '13:00', end: '17:00' } } });
    const stored = encryptUserProfile(profile, cipher);
    expect(stored).toBeInstanceOf(Buffer);
    expect(stored!.toString('utf8')).not.toContain('P-17');
    expect(decryptUserProfile(stored, cipher)).toEqual(profile);
  });

  it('rejects invalid times, unknown days and unknown fields', () => {
    expect(userProfileSchema.safeParse({ work_days: { '1': { start: '17:00', end: '08:00' } } }).success).toBe(false);
    expect(userProfileSchema.safeParse({ work_days: { '7': { start: '08:00', end: '12:00' } } }).success).toBe(false);
    expect(userProfileSchema.safeParse({ work_days: { '2': { start: '25:00', end: '26:00' } } }).success).toBe(false);
    expect(userProfileSchema.safeParse({ salary: '1' }).success).toBe(false);
  });

  it('stores nothing for an empty profile and tolerates unreadable data', () => {
    expect(encryptUserProfile({ building: '', work_days: {} }, cipher)).toBeNull();
    expect(decryptUserProfile(Buffer.from('broken'), cipher)).toEqual({});
  });
});
