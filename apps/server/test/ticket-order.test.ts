import { describe, expect, it, vi } from 'vitest';
import { compareTicketUrgency } from '../../../js/ticket-helpers.js';

vi.mock('../../../js/utils.js', () => ({ Icon: vi.fn(), Utils: {} }));
vi.mock('../../../js/ui.js', () => ({ UI: {} }));
vi.mock('../../../js/admin-board.js', () => ({ AdminBoard: {} }));

const order = (tickets: any[]) => tickets.sort((a, b) => compareTicketUrgency(a, b, t => t.due)).map(t => t.id);

describe('ticket urgency ordering shared by board and list', () => {
  it('puts critical first regardless of the deadline of lower priorities', () => {
    expect(order([
      { id: 'low', prio: 'Niedrig', due: '2026-10-01' },
      { id: 'normal', prio: 'Normal', due: '2026-10-01' },
      { id: 'critical', prio: 'Kritisch', due: '2026-10-20' },
      { id: 'high', prio: 'Hoch', due: '2026-10-10' }
    ])).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('compares the exact due time before creation date within the same priority', () => {
    expect(order([
      { id: 'windows', prio: 'Niedrig', due: '2026-10-17T23:53:00Z', createdAt: '2026-10-13' },
      { id: 'email', prio: 'Niedrig', due: '2026-10-17T23:50:00Z', createdAt: '2026-10-14' }
    ])).toEqual(['email', 'windows']);
  });

  it('puts older tickets first when priority and deadline match', () => {
    expect(order([
      { id: 'new', prio: 'Normal', due: 1000, createdAt: '2026-10-14T10:01:00Z' },
      { id: 'old', prio: 'Normal', due: 1000, createdAt: '2026-10-14T10:00:00Z' }
    ])).toEqual(['old', 'new']);
  });

  it('puts missing or invalid deadlines last without losing the creation tie-break', () => {
    expect(order([
      { id: 'missing', prio: 'Normal', due: null, createdAt: '2026-10-14' },
      { id: 'invalid', prio: 'Normal', due: 'invalid', createdAt: '2026-10-13' },
      { id: 'valid', prio: 'Normal', due: 1000, createdAt: '2026-10-15' }
    ])).toEqual(['valid', 'invalid', 'missing']);
    expect(compareTicketUrgency({}, {}, () => null)).toBe(0);
  });
});
