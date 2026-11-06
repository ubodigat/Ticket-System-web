import { describe, it, expect } from 'vitest';
import { manualTimeEntryPeriod } from '../src/domain/timeEntryPeriod.js';

describe('manual time entry period', () => {
  const now = new Date('2026-11-06T17:50:00.000Z');
  it('ends now and reaches back by the duration when no start is given', () => {
    expect(manualTimeEntryPeriod(30, undefined, now)).toEqual({ started_at: new Date('2026-11-06T17:20:00.000Z'), ended_at: now });
  });
  it('uses the given start and adds the duration', () => {
    expect(manualTimeEntryPeriod(45, '2026-11-05T08:00:00.000Z', now)).toEqual({
      started_at: new Date('2026-11-05T08:00:00.000Z'), ended_at: new Date('2026-11-05T08:45:00.000Z') });
  });
  it('rejects periods ending in the future, older than a year or with an invalid start', () => {
    expect(manualTimeEntryPeriod(30, '2026-11-06T17:40:00.000Z', now)).toBeNull();
    expect(manualTimeEntryPeriod(1, '2026-11-06T17:50:00.000Z', now)).not.toBeNull();
    expect(manualTimeEntryPeriod(10, '2025-11-01T08:00:00.000Z', now)).toBeNull();
    expect(manualTimeEntryPeriod(10, 'not-a-date', now)).toBeNull();
  });
});
