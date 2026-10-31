import { describe, expect, it } from 'vitest';
import { groupWithDescendants, validateGroupParent } from '../src/domain/groups.js';
import { maskTicketModules, modulesFromConfig } from '../src/domain/modules.js';

const groups = [
  { id: 'it', parent_id: null }, { id: 'net', parent_id: 'it' }, { id: 'wifi', parent_id: 'net' }, { id: 'hr', parent_id: null }
];

describe('user subgroups', () => {
  it('includes direct and indirect subgroups', () => {
    expect(groupWithDescendants('it', groups).sort()).toEqual(['it', 'net', 'wifi']);
    expect(groupWithDescendants('hr', groups)).toEqual(['hr']);
  });
  it('rejects unknown parents, cycles and too deep nesting', () => {
    expect(validateGroupParent(null, 'missing', groups)).toBe('invalid_parent');
    expect(validateGroupParent('it', 'wifi', groups)).toBe('group_cycle');
    expect(validateGroupParent('it', 'it', groups)).toBe('group_cycle');
    expect(validateGroupParent('hr', 'wifi', groups)).toBeNull();
    const chain = ['a', 'b', 'c', 'd', 'e'].map((id, index, all) => ({ id, parent_id: index ? all[index - 1]! : null }));
    expect(validateGroupParent(null, 'd', chain)).toBeNull();
    expect(validateGroupParent(null, 'e', chain)).toBe('group_too_deep');
  });
});

describe('modules', () => {
  it('treats missing module settings as enabled', () => {
    expect(modulesFromConfig({})).toEqual({ sla: true, approvals: true });
    expect(modulesFromConfig({ modules: { sla: false } })).toEqual({ sla: false, approvals: true });
  });
  it('removes fields of disabled modules from ticket responses', () => {
    const ticket = { id: 't', sla_due_at: 'x', custom_due_at: 'y', approval_status: 'pending', approval_reviewer_id: 'u', approval_text: 'z', approval_requested_by: 'a' };
    expect(maskTicketModules(ticket, { sla: true, approvals: true })).toEqual(ticket);
    expect(maskTicketModules(ticket, { sla: false, approvals: false })).toMatchObject({
      sla_due_at: null, custom_due_at: null, approval_status: null, approval_reviewer_id: null, approval_text: null, approval_requested_by: null });
  });
});
