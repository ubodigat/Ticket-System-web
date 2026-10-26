import { describe, expect, it } from 'vitest';
import { defaultPasswordPolicy, passwordFailures, generatePolicyPassword, loadPasswordPolicy } from '../src/domain/passwordPolicy.js';
import { renderMailTemplate } from '../src/mail/mailer.js';
import { advanceTodoDate } from '../src/domain/adminTodos.js';
import { recurringAdminTodoSchema } from '../src/http/routes/todos.js';
import Fastify from 'fastify';
import { registerUsersV2Routes } from '../src/http/routes/users.js';
import { mergeSettingsConfig } from '../src/http/routes/settings.js';

describe('configurable password requirements', () => {
  const policy = { minLength: 24, minLowercase: 3, minUppercase: 2, minDigits: 2, minSpecial: 2 };
  it('preserves password rules when updating another security setting', () => {
    expect(mergeSettingsConfig({ securityConfig: { passwordPolicy: policy, force2FA: 'admin' } }, { securityConfig: { sessionTimeout: 120 } }).securityConfig)
      .toEqual({ passwordPolicy: policy, force2FA: 'admin', sessionTimeout: 120 });
  });
  it('keeps legacy long passwords valid by default', () => expect(passwordFailures('long plain password', defaultPasswordPolicy)).toEqual([]));
  it('reports every missing character category', () => expect(passwordFailures('a', policy)).toEqual(['minLength', 'minLowercase', 'minUppercase', 'minDigits', 'minSpecial']));
  it('counts Unicode letters and rejects whitespace as a special character', () => {
    expect(passwordFailures('äöüÄÖ1234     ', { ...defaultPasswordPolicy, minLength: 14, minLowercase: 3, minUppercase: 2, minDigits: 2, minSpecial: 1 })).toEqual(['minSpecial']);
  });
  it('generates compliant credentials even for strict policies', () => {
    for (const p of [policy, { minLength: 128, minLowercase: 16, minUppercase: 16, minDigits: 16, minSpecial: 16 }]) {
      for (let i = 0; i < 10; i++) expect(passwordFailures(generatePolicyPassword(p), p)).toEqual([]);
    }
  });
  it('does not accept unsafe legacy length settings', async () => {
    const q: any = { select: () => q, where: () => q, executeTakeFirst: async () => ({ config_json: JSON.stringify({ securityConfig: { passwordPolicy: { minLength: 0, minDigits: 2 } } }) }) };
    expect(await loadPasswordPolicy({ selectFrom: () => q } as any)).toEqual({ ...defaultPasswordPolicy, minDigits: 2 });
  });
  it.each(['create', 'reset'])('enforces configured requirements in the %s API before hashing or writing', async action => {
    const app = Fastify();
    const db: any = { selectFrom: (table: string) => {
      const q: any = { select: () => q, where: () => q, executeTakeFirst: async () => table === 'app_settings'
        ? { config_json: JSON.stringify({ securityConfig: { passwordPolicy: policy } }) } : { role: 'user' } };
      return q;
    } };
    app.decorate('db', db);
    app.addHook('onRequest', async req => { req.ticketSession = { uid: 'root', username: 'root', role: 'superadmin' }; });
    registerUsersV2Routes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
    try {
      const response = await app.inject({ method: 'POST', url: action === 'create' ? '/api/v2/users' : '/api/v2/users/target/change-password',
        payload: action === 'create' ? { username: 'new', name: 'New User', email: 'new@example.org', role: 'user', password: 'long lower password' }
          : { new_password: 'long lower password' } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('password_policy_failed');
      expect(response.json().requirements).toContain('minUppercase');
    } finally { await app.close(); }
  });
});
describe('mail template variables', () => {
  it('replaces all known variables without recursive substitution', () => {
    expect(renderMailTemplate('{{subject}} / {{message}} / {{recipient}} / {{subject}}', { subject: '{{message}}', message: 'Ticket 12: waiting', recipient: 'user@example.org' }))
      .toBe('{{message}} / Ticket 12: waiting / user@example.org / {{message}}');
  });
});
describe('annual task recurrence', () => {
  it('accepts annual rules in the API', () => expect(recurringAdminTodoSchema.safeParse({ content: 'Annual inspection', interval_unit: 'year', interval_count: 1, next_run_at: '2026-10-26T10:00:00Z' }).success).toBe(true));
  it('clamps leap day and preserves time', () => expect(advanceTodoDate(new Date('2024-02-29T09:45:00Z'), 'year', 1).toISOString()).toBe('2025-02-28T09:45:00.000Z'));
  it('supports multi-year intervals', () => expect(advanceTodoDate(new Date('2024-02-29T09:45:00Z'), 'year', 4).toISOString()).toBe('2028-02-29T09:45:00.000Z'));
});
