import { describe, it, expect } from 'vitest';
import { force2faAppliesToRole, type SecurityPolicy } from '../src/domain/securityPolicy.js';

function policy(force2FA: SecurityPolicy['force2FA']): SecurityPolicy {
  return { force2FA, sessionTimeoutMinutes: 480, maxLoginAttempts: 5, lockoutAction: 'lock', lockoutMinutes: 15 };
}

describe('force2faAppliesToRole', () => {
  it('"none" betrifft niemanden', () => {
    expect(force2faAppliesToRole(policy('none'), 'user')).toBe(false);
    expect(force2faAppliesToRole(policy('none'), 'admin')).toBe(false);
    expect(force2faAppliesToRole(policy('none'), 'superadmin')).toBe(false);
  });

  it('"all" betrifft jede Rolle', () => {
    expect(force2faAppliesToRole(policy('all'), 'user')).toBe(true);
    expect(force2faAppliesToRole(policy('all'), 'admin')).toBe(true);
    expect(force2faAppliesToRole(policy('all'), 'superadmin')).toBe(true);
  });

  it('"admin" betrifft admin und superadmin, nicht user', () => {
    expect(force2faAppliesToRole(policy('admin'), 'admin')).toBe(true);
    expect(force2faAppliesToRole(policy('admin'), 'superadmin')).toBe(true);
    expect(force2faAppliesToRole(policy('admin'), 'user')).toBe(false);
  });

  it('"user" betrifft nur user', () => {
    expect(force2faAppliesToRole(policy('user'), 'user')).toBe(true);
    expect(force2faAppliesToRole(policy('user'), 'admin')).toBe(false);
    expect(force2faAppliesToRole(policy('user'), 'superadmin')).toBe(false);
  });
});
