/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

// Rechte fuer Admin-Konten (users.permissions_json), gruppiert nach Oberbegriffen. Superadmins
// haben immer alle Rechte; normale Konten nie. Rechte vergeben nur Superadmins (users.ts).
export const PERMISSION_GROUPS = {
  administration: ['canManageRequests', 'canManageUsers', 'canManage2FA', 'canViewLogs'],
  features: ['textBlocks', 'reports', 'recurring', 'categoryFaq'],
  modules: ['approvals', 'settingsSla', 'settingsApprovals'],
  settings: ['settingsGeneral', 'settingsTicketForm', 'settingsCategories', 'settingsCompany', 'settingsTicketNumbers', 'settingsNotifications']
} as const;

export type BooleanPermission = typeof PERMISSION_GROUPS[keyof typeof PERMISSION_GROUPS][number];
export const BOOLEAN_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat() as BooleanPermission[];

export const userPermissionsSchema = z.object({
  ...Object.fromEntries(BOOLEAN_PERMISSIONS.map(key => [key, z.boolean().optional()])) as Record<BooleanPermission, z.ZodOptional<z.ZodBoolean>>,
  kb: z.enum(['none', 'read', 'edit']).optional()
});

// Welche Schluessel von PATCH /api/v2/settings ein Einstellungsbereich abdeckt. Alles, was hier
// nicht steht (Sicherheit, E-Mail, Outlook, LDAP, Module, Selbstverwaltung, Sichtbarkeit von
// Kontaktdaten), bleibt Superadmins vorbehalten.
export const SETTINGS_SECTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  settingsGeneral: ['portalName', 'autoArchiveClosedAfterDays', 'uploadConfig', 'avatarConfig', 'timeTrackingConfig', 'defaultPrio',
    'waitingReminderDays', 'waitingAutoCloseDays', 'waitingAfterAction', 'waitingReminderEnabled'],
  settingsTicketForm: ['ticketFormConfig'],
  settingsSla: ['slaHoursByPriority', 'showSlaToUsers', 'businessHours'],
  settingsApprovals: ['approvalWorkflow'],
  settingsCompany: ['companyName', 'companyBrandingConfig'],
  settingsTicketNumbers: ['ticketNumberFormat', 'ticketNumberCategoryFormats', 'ticketNumberCategoryCodes'],
  settingsNotifications: ['notifPolicy', 'notifConfig']
};

export function parsePermissions(json: unknown): Record<string, unknown> {
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadPermissions(db: Kysely<Database>, session: { uid: string; role: string }): Promise<Record<string, unknown>> {
  if (session.role !== 'admin') return {};
  const row = await db.selectFrom('users').select('permissions_json').where('id', '=', session.uid).executeTakeFirst();
  return parsePermissions(row?.permissions_json);
}

export async function hasPermission(db: Kysely<Database>, session: { uid: string; role: string }, key: BooleanPermission): Promise<boolean> {
  if (session.role === 'superadmin') return true;
  if (session.role !== 'admin') return false;
  return (await loadPermissions(db, session))[key] === true;
}

// Prueft, ob alle uebergebenen Einstellungs-Schluessel in Bereichen liegen, fuer die die Person
// ein Recht hat. Liefert den ersten nicht erlaubten Schluessel oder null.
export function forbiddenSettingsKey(keys: string[], permissions: Record<string, unknown>): string | null {
  const allowed = new Set(Object.entries(SETTINGS_SECTION_KEYS).filter(([perm]) => permissions[perm] === true).flatMap(([, list]) => list));
  return keys.find(key => !allowed.has(key)) ?? null;
}

export function hasAnySettingsPermission(permissions: Record<string, unknown>): boolean {
  return Object.keys(SETTINGS_SECTION_KEYS).some(key => permissions[key] === true);
}

// --- Kontaktdaten: welche Angaben einer Person Admins sehen (Systemeinstellungen > Kontaktdaten) ---

export const CONTACT_FIELDS = ['email', 'phone', 'mobile', 'department', 'jobTitle', 'officeLocation', 'building', 'room',
  'supervisor', 'groups', 'workTimes', 'availability', 'employeeNumber', 'costCenter', 'entryDate'] as const;
export type ContactField = typeof CONTACT_FIELDS[number];
export const DEFAULT_CONTACT_FIELDS: readonly ContactField[] = ['email', 'phone', 'mobile', 'department', 'jobTitle', 'officeLocation',
  'building', 'room', 'supervisor', 'groups', 'workTimes', 'availability'];

const contactFieldList = z.array(z.enum(CONTACT_FIELDS)).max(CONTACT_FIELDS.length);
export const contactVisibilitySchema = z.object({
  defaults: contactFieldList,
  // Je Gruppe bzw. Admin-Konto eine eigene Auswahl; die genaueste Angabe gilt (Person vor Gruppe vor Standard).
  groups: z.record(z.string().trim().min(1).max(36), contactFieldList).optional(),
  users: z.record(z.string().trim().min(1).max(36), contactFieldList).optional()
}).strict();
export type ContactVisibility = z.infer<typeof contactVisibilitySchema>;

// Sichtbare Felder fuer eine Person mit Admin-Rechten. Superadmins und die Benutzerverwaltung
// sehen alles (sie bearbeiten die Konten ohnehin vollstaendig).
export function visibleContactFields(
  viewer: { id: string; role: string; groupIds: string[]; canManageUsers: boolean },
  config: Record<string, any> | null | undefined
): Set<ContactField> {
  if (viewer.role === 'superadmin' || viewer.canManageUsers) return new Set(CONTACT_FIELDS);
  if (viewer.role !== 'admin') return new Set();
  const parsed = contactVisibilitySchema.safeParse(config?.contactVisibility);
  if (!parsed.success) return new Set(DEFAULT_CONTACT_FIELDS);
  const personal = parsed.data.users?.[viewer.id];
  if (personal) return new Set(personal);
  const byGroup = viewer.groupIds.map(id => parsed.data.groups?.[id]).filter((list): list is ContactField[] => Array.isArray(list));
  if (byGroup.length) return new Set(byGroup.flat());
  return new Set(parsed.data.defaults);
}

export async function loadContactVisibility(db: Kysely<Database>, session: { uid: string; role: string }): Promise<Set<ContactField>> {
  if (session.role === 'superadmin') return new Set(CONTACT_FIELDS);
  if (session.role !== 'admin') return new Set();
  const [settings, permissions, memberships] = await Promise.all([
    db.selectFrom('app_settings').select('config_json').where('id', '=', 1).executeTakeFirst(),
    loadPermissions(db, session),
    db.selectFrom('user_groups').select('group_id').where('user_id', '=', session.uid).execute()
  ]);
  let config: Record<string, any> = {};
  try { config = settings?.config_json ? JSON.parse(settings.config_json) : {}; } catch { config = {}; }
  return visibleContactFields({ id: session.uid, role: session.role, groupIds: memberships.map(row => row.group_id), canManageUsers: permissions.canManageUsers === true }, config);
}

// --- Konto-Selbstverwaltung: Felder, die eine Person selbst aendern darf ---

export const SELF_SERVICE_FIELDS = ['name', 'email', 'department', 'phone', 'mobile', 'jobTitle', 'officeLocation',
  'building', 'room', 'employeeNumber', 'costCenter', 'entryDate', 'workDays', 'availability'] as const;
export type SelfServiceField = typeof SELF_SERVICE_FIELDS[number];
// Profilschluessel (users.profile_enc) zum jeweiligen Selbstverwaltungsfeld.
export const SELF_SERVICE_PROFILE_KEYS: Readonly<Record<string, SelfServiceField>> = {
  building: 'building', room: 'room', employee_number: 'employeeNumber', cost_center: 'costCenter',
  entry_date: 'entryDate', work_days: 'workDays', availability_note: 'availability'
};
