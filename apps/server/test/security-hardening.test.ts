import { describe, expect, it } from 'vitest';
import { secondFactorBackoffSeconds, shouldWarnAboutSecondFactor } from '../src/domain/secondFactorThrottle.js';
import { enrollCodeHash, enrollCodeMatches, generateAdminEnrollCode, generateMailEnrollCode } from '../src/domain/mfaEnrollment.js';
import { anonymousWithinBudget, shouldRecord } from '../src/domain/activityLog.js';
import { dailyUploadQuota, installationDailyUploadQuota, uploadLimitBytesFromConfig, MB } from '../src/domain/uploadLimits.js';
import { RETENTION_DAYS } from '../src/jobs/maintenance.js';

describe('second factor throttle (Security-Audit R-23)', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000);
  it('waits longer with every failure, for every source, capped at 15 minutes', () => {
    expect(secondFactorBackoffSeconds(4, ago(0), now)).toBe(0);
    expect(secondFactorBackoffSeconds(5, ago(0), now)).toBe(2);
    expect(secondFactorBackoffSeconds(8, ago(0), now)).toBe(16);
    expect(secondFactorBackoffSeconds(30, ago(0), now)).toBe(900);
    expect(secondFactorBackoffSeconds(30, ago(901), now)).toBe(0);
  });
  it('makes guessing a 6-digit code impractical: at most 4 attempts per hour once the cap is reached', () => {
    const attemptsPerHour = 3600 / secondFactorBackoffSeconds(100, ago(0), now);
    const attemptsForHalfChance = Math.log(0.5) / Math.log(1 - 3 / 1_000_000);
    expect(attemptsPerHour).toBe(4);
    expect(attemptsForHalfChance / attemptsPerHour / 24 / 365).toBeGreaterThan(6);
  });
  it('warns the person on every tenth failure', () => {
    expect([9, 10, 11, 20].map(shouldWarnAboutSecondFactor)).toEqual([false, true, false, true]);
  });
});

describe('MFA enrollment codes (Security-Audit R-25)', () => {
  it('creates unpredictable codes and compares them independent of formatting', () => {
    const code = generateAdminEnrollCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(generateMailEnrollCode()).toMatch(/^\d{8}$/);
    const stored = enrollCodeHash('secret', 'user-1', code, 'admin');
    expect(enrollCodeMatches(stored, enrollCodeHash('secret', 'user-1', code.toLowerCase().replaceAll('-', ' '), 'admin'))).toBe(true);
    expect(enrollCodeMatches(stored, enrollCodeHash('secret', 'user-2', code, 'admin'))).toBe(false);
    expect(enrollCodeMatches(stored, enrollCodeHash('secret', 'user-1', code, 'mail'))).toBe(false);
    expect(enrollCodeMatches(null, stored)).toBe(false);
  });
});

describe('system log limits (Security-Audit R-27)', () => {
  it('does not log arbitrary anonymous requests, only security-relevant ones', () => {
    expect(shouldRecord('POST', '/api/v2/tickets', 401, false)).toBe(false);
    expect(shouldRecord('GET', '/api/v2/audit-log', 401, false)).toBe(false);
    expect(shouldRecord('POST', '/api/v2/mfa/login/totp', 401, false)).toBe(true);
    expect(shouldRecord('POST', '/api/v2/tickets', 401, true)).toBe(true);
  });
  it('bundles anonymous entries per source network, route and result per minute', () => {
    const minute = Date.parse('2026-11-01T12:00:10Z');
    expect(anonymousWithinBudget('203.0.113.7', 'POST /api/v2/mfa/login/totp', 401, minute)).toBe(true);
    expect(anonymousWithinBudget('203.0.113.7', 'POST /api/v2/mfa/login/totp', 401, minute + 20_000)).toBe(false);
    expect(anonymousWithinBudget('2001:db8:1:2::5', 'POST /api/v2/mfa/login/totp', 401, minute)).toBe(true);
    expect(anonymousWithinBudget('2001:db8:1:2::9', 'POST /api/v2/mfa/login/totp', 401, minute)).toBe(false);
    expect(anonymousWithinBudget('203.0.113.7', 'POST /api/v2/mfa/login/totp', 401, minute + 60_000)).toBe(true);
  });
  it('keeps data only as long as necessary', () => {
    expect(RETENTION_DAYS).toEqual({ requests: 90, audit: 365, ticketActivity: 365, ipAddresses: 30, sessions: 30 });
  });
});

describe('upload quotas (Security-Audit R-26)', () => {
  it('gives ordinary accounts a smaller daily quota and caps the whole installation', () => {
    const limit = uploadLimitBytesFromConfig({});
    expect(limit).toBe(1024 * MB);
    expect(dailyUploadQuota('user', limit)).toBe(limit);
    expect(dailyUploadQuota('admin', limit)).toBeGreaterThan(dailyUploadQuota('user', limit));
    expect(installationDailyUploadQuota(limit)).toBeGreaterThan(dailyUploadQuota('admin', limit));
  });
});
