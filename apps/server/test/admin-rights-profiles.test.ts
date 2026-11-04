/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { memoryDb } from './helpers/memoryDb.js';
import { registerSettingsRoutes } from '../src/http/routes/settings.js';
import { registerUsersV2Routes } from '../src/http/routes/users.js';
import { registerTicketsV2Routes } from '../src/http/routes/tickets.js';
import { CONTACT_FIELDS, DEFAULT_CONTACT_FIELDS, forbiddenSettingsKey, userPermissionsSchema, visibleContactFields } from '../src/domain/adminPermissions.js';
import { categoryFaqSchema, priorityFromImpact } from '../src/domain/categoryFaq.js';

const SUPER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const keyProvider = { currentKekVersion: async () => 1, wrapDek: async (value: Buffer) => value, unwrapDek: async (value: Buffer) => value } as any;

function fixture(config: Record<string, unknown> = {}, adminPermissions: Record<string, unknown> = {}) {
  const tables: Record<string, any[]> = {
    users: [
      { id: SUPER, username: 'root', role: 'superadmin', permissions_json: null, account_archived: false },
      { id: ADMIN, username: 'helpdesk', role: 'admin', permissions_json: JSON.stringify(adminPermissions), account_archived: false },
      { id: TARGET, username: 'max', role: 'user', department: 'IT', permissions_json: null, account_archived: false }
    ],
    app_settings: [{ id: 1, company_name: '', portal_name: '', config_json: JSON.stringify(config) }],
    categories: [], user_groups: [], groups: []
  };
  const db = memoryDb(tables);
  const app = Fastify(); app.decorate('db', db);
  const actor: { uid: string; username: string; role: 'user' | 'admin' | 'superadmin' } = { uid: SUPER, username: 'root', role: 'superadmin' };
  app.addHook('onRequest', async req => { req.ticketSession = actor; });
  const deps = { db, env: { INSTALLATION_ID: 'test', WEBAUTHN_ORIGIN: '' } as any, keyProvider };
  registerSettingsRoutes(app, deps); registerUsersV2Routes(app, deps); registerTicketsV2Routes(app, deps);
  const as = (uid: string, role: 'user' | 'admin' | 'superadmin', username = 'x') => Object.assign(actor, { uid, role, username });
  const setConfig = (next: Record<string, unknown>) => { tables.app_settings![0].config_json = JSON.stringify(next); };
  return { app, tables, as, setConfig };
}

describe('permission catalog', () => {
  it('maps settings keys to sections and keeps security-relevant keys superadmin-only', () => {
    expect(forbiddenSettingsKey(['slaHoursByPriority', 'businessHours'], { settingsSla: true })).toBeNull();
    expect(forbiddenSettingsKey(['companyName', 'companyBrandingConfig'], { settingsCompany: true })).toBeNull();
    for (const key of ['securityConfig', 'emailAdvancedConfig', 'outlookConfig', 'modules', 'accountSelfServiceFields', 'contactVisibility', 'unknownKey']) {
      expect(forbiddenSettingsKey([key], Object.fromEntries(['settingsGeneral', 'settingsTicketForm', 'settingsSla', 'settingsApprovals', 'settingsCompany', 'settingsTicketNumbers', 'settingsNotifications'].map(k => [k, true]))), key).toBe(key);
    }
  });
  it('drops unknown permission keys and rejects invalid values', () => {
    expect(userPermissionsSchema.parse({ settingsSla: true, isRoot: true })).toEqual({ settingsSla: true });
    expect(userPermissionsSchema.safeParse({ kb: 'admin' }).success).toBe(false);
    expect(userPermissionsSchema.safeParse({ settingsCategories: 'yes' }).success).toBe(false);
  });
  it('resolves contact visibility: person before group before default; full view for superadmins and user management', () => {
    const config = { contactVisibility: { defaults: ['email'], groups: { g1: ['phone'], g2: ['mobile'] }, users: { a2: ['department'] } } };
    const viewer = (id: string, groupIds: string[] = [], extra = {}) => ({ id, role: 'admin', groupIds, canManageUsers: false, ...extra });
    expect([...visibleContactFields(viewer('a1'), config)]).toEqual(['email']);
    expect([...visibleContactFields(viewer('a1', ['g1', 'g2']), config)].sort()).toEqual(['mobile', 'phone']);
    expect([...visibleContactFields(viewer('a2', ['g1']), config)]).toEqual(['department']);
    expect(visibleContactFields(viewer('a1', [], { canManageUsers: true }), config).size).toBe(CONTACT_FIELDS.length);
    expect(visibleContactFields(viewer('a1', [], { role: 'superadmin' }), config).size).toBe(CONTACT_FIELDS.length);
    expect(visibleContactFields(viewer('a1', [], { role: 'user' }), config).size).toBe(0);
    expect([...visibleContactFields(viewer('a1'), { contactVisibility: { defaults: ['notAField'] } })].sort()).toEqual([...DEFAULT_CONTACT_FIELDS].sort());
  });
  it('derives the priority from impact and urgency and validates FAQ entries', () => {
    expect([[1, 1], [1, 2], [2, 2], [1, 3], [3, 2], [3, 3]].map(([i, u]) => priorityFromImpact(i!, u!))).toEqual(['Niedrig', 'Niedrig', 'Normal', 'Normal', 'Hoch', 'Hoch']);
    expect(categoryFaqSchema.safeParse({ items: [{ question: 'Drucker?', answer: '' }] }).success).toBe(false);
    expect(categoryFaqSchema.safeParse({ items: Array.from({ length: 31 }, () => ({ question: 'q', answer: 'a' })) }).success).toBe(false);
    expect(categoryFaqSchema.safeParse({ items: [{ question: 'q', answer: 'a', html: '<b>' }] }).success).toBe(false);
  });
});

describe('delegated system settings', () => {
  it('lets admins change only the sections they were granted', async () => {
    const f = fixture({}, { settingsSla: true });
    try {
      f.as(ADMIN, 'admin', 'helpdesk');
      const sla = await f.app.inject({ method: 'PATCH', url: '/api/v2/settings', payload: { config: { slaHoursByPriority: { Normal: 10 } } } });
      expect(sla.statusCode).toBe(200);
      expect(JSON.parse(f.tables.app_settings![0].config_json).slaHoursByPriority).toEqual({ Normal: 10 });
      expect(JSON.parse(f.tables.global_audit_log!.at(-1).detail_json)).toEqual({ keys: ['slaHoursByPriority'] });
      for (const payload of [{ config: { slaHoursByPriority: { Normal: 5 }, securityConfig: { maxLoginAttempts: 50 } } }, { config: { contactVisibility: { defaults: [] } } },
        { config: { modules: { sla: false } } }, { companyName: 'Fremd' }, {}, { config: {} }]) {
        const response = await f.app.inject({ method: 'PATCH', url: '/api/v2/settings', payload });
        expect(response.statusCode, JSON.stringify(payload)).toBe(403);
      }
      expect(JSON.parse(f.tables.app_settings![0].config_json).slaHoursByPriority).toEqual({ Normal: 10 });
      f.as(TARGET, 'user');
      expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/settings', payload: { config: { slaHoursByPriority: { Normal: 1 } } } })).statusCode).toBe(403);
      f.as(SUPER, 'superadmin', 'root');
      expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/settings', payload: { config: { contactVisibility: { defaults: ['email'] }, ticketFormConfig: { priorityMode: 'priority', showServiceBar: false } } } })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'PATCH', url: '/api/v2/settings', payload: { config: { contactVisibility: { defaults: ['password'] } } } })).statusCode).toBe(400);
    } finally { await f.app.close(); }
  });

  it('shows the ticket form variant to users but never the contact visibility rules', async () => {
    const f = fixture({ ticketFormConfig: { priorityMode: 'priority' }, contactVisibility: { defaults: ['email'], users: { [ADMIN]: ['phone'] } } });
    try {
      f.as(TARGET, 'user');
      const config = (await f.app.inject('/api/v2/settings')).json().config;
      expect(config.ticketFormConfig).toEqual({ priorityMode: 'priority' });
      expect(config.contactVisibility).toBeUndefined();
    } finally { await f.app.close(); }
  });

  it('requires the categories right to edit categories and the FAQ right for tips', async () => {
    const f = fixture({}, { categoryFaq: true });
    try {
      f.as(ADMIN, 'admin', 'helpdesk');
      expect((await f.app.inject({ method: 'POST', url: '/api/v2/categories', payload: { name: 'Drucker' } })).statusCode).toBe(403);
      f.as(SUPER, 'superadmin', 'root');
      const created = await f.app.inject({ method: 'POST', url: '/api/v2/categories', payload: { name: 'Drucker', show_in_portal: false } });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      f.as(ADMIN, 'admin', 'helpdesk');
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/categories/${id}`, payload: { show_in_portal: true } })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'PUT', url: `/api/v2/categories/${id}/faq`, payload: { items: [{ question: 'Papierstau?', answer: '' }] } })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'PUT', url: `/api/v2/categories/${id}/faq`, payload: { intro: 'Bitte zuerst:', items: [{ question: 'Papierstau?', answer: 'Klappe öffnen.' }] } })).statusCode).toBe(200);
      f.as(TARGET, 'user');
      expect((await f.app.inject({ method: 'PUT', url: `/api/v2/categories/${id}/faq`, payload: { items: [] } })).statusCode).toBe(403);
      const [category] = (await f.app.inject('/api/v2/categories')).json().categories;
      expect(category).toMatchObject({ name: 'Drucker', show_in_portal: false, faq: { intro: 'Bitte zuerst:', items: [{ question: 'Papierstau?', answer: 'Klappe öffnen.' }] } });
      expect(category.faq_json).toBeUndefined();
    } finally { await f.app.close(); }
  });
});

describe('contact details for admins', () => {
  async function prepared(config: Record<string, unknown>) {
    const f = fixture(config);
    f.as(SUPER, 'superadmin', 'root');
    const set = await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { phone: '0123 45', profile: { building: 'B1', employee_number: 'E7' } } });
    expect(set.statusCode).toBe(200);
    f.as(ADMIN, 'admin', 'helpdesk');
    return f;
  }
  it('shows only released fields in the contact card and the directory', async () => {
    const f = await prepared({});
    try {
      const card = (await f.app.inject(`/api/v2/users/${TARGET}/contact-card`)).json().user;
      expect(card.fields).toMatchObject({ phone: '0123 45', department: 'IT', building: 'B1' });
      expect(card.fields.employeeNumber).toBeUndefined();
      f.setConfig({ contactVisibility: { defaults: ['phone'], users: { [ADMIN]: ['department'] } } });
      expect((await f.app.inject(`/api/v2/users/${TARGET}/contact-card`)).json().user.fields).toEqual({ department: 'IT' });
      const person = (await f.app.inject('/api/v2/users/directory')).json().users.find((u: any) => u.id === TARGET);
      expect(person).toMatchObject({ department: 'IT', phone: null, email: null });
      f.setConfig({ contactVisibility: { defaults: [], groups: { g1: ['employeeNumber'] } } });
      f.tables.user_groups!.push({ user_id: ADMIN, group_id: 'g1' });
      expect((await f.app.inject(`/api/v2/users/${TARGET}/contact-card`)).json().user.fields).toEqual({ employeeNumber: 'E7' });
      f.as(TARGET, 'user');
      expect((await f.app.inject(`/api/v2/users/${TARGET}/contact-card`)).statusCode).toBe(403);
      f.as(ADMIN, 'admin');
      expect((await f.app.inject('/api/v2/users/44444444-4444-4444-8444-444444444444/contact-card')).statusCode).toBe(404);
    } finally { await f.app.close(); }
  });
});

describe('account self-service', () => {
  it('changes only released profile parts and never drops stored ones', async () => {
    const f = fixture({ accountSelfServiceFields: ['building'] });
    try {
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { profile: { room: 'A1' } } })).statusCode).toBe(200);
      f.as(TARGET, 'user', 'max');
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { profile: { room: 'A1', building: 'B2' } } })).statusCode).toBe(200);
      expect((await f.app.inject('/api/v2/users/me')).json().user.profile).toEqual({ room: 'A1', building: 'B2' });
      const changeRoom = await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { profile: { room: 'Z9', building: 'B2' } } });
      expect(changeRoom.statusCode).toBe(403);
      expect(changeRoom.json()).toMatchObject({ error: 'field_not_editable', field: 'room' });
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { profile: { building: 'B3' } } })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { department: 'Vertrieb' } })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'PATCH', url: `/api/v2/users/${TARGET}`, payload: { supervisor_user_id: SUPER } })).statusCode).toBe(403);
      expect((await f.app.inject('/api/v2/users/me')).json().user.profile).toEqual({ room: 'A1', building: 'B2' });
    } finally { await f.app.close(); }
  });
});

describe('ticket form', () => {
  it('requires an active category for users and derives the priority from impact and urgency', async () => {
    const f = fixture();
    try {
      f.tables.categories!.push({ id: 'c1', name: 'Drucker', archived: false, auto_assign_group_id: null }, { id: 'c2', name: 'Alt', archived: true, auto_assign_group_id: null });
      f.as(TARGET, 'user', 'max');
      const body = { title: 'Drucker geht nicht', description: 'Papierstau', priority: 'Kritisch', impact: 3, urgency: 3 };
      expect((await f.app.inject({ method: 'POST', url: '/api/v2/tickets', payload: body })).json().error).toBe('category_required');
      expect((await f.app.inject({ method: 'POST', url: '/api/v2/tickets', payload: { ...body, category: 'Alt' } })).json().error).toBe('category_required');
      const created = await f.app.inject({ method: 'POST', url: '/api/v2/tickets', payload: { ...body, category: 'Drucker', impact: 1, urgency: 2 } });
      expect(created.statusCode).toBe(201);
      expect(created.json().ticket).toMatchObject({ priority: 'Niedrig', impact: 1, urgency: 2, category: 'Drucker' });
      expect((await f.app.inject({ method: 'POST', url: '/api/v2/tickets', payload: { ...body, category: 'Drucker', impact: 4 } })).statusCode).toBe(400);
    } finally { await f.app.close(); }
  });
});
