/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { z } from 'zod';
import { fieldCipher } from '../crypto/fieldCrypto.js';
import type { ResolvedDek } from '../crypto/fieldCrypto.js';

// Weitere Angaben zu einem Konto (Benutzerverwaltung): Personalnummer, Kostenstelle, Gebaeude/Raum,
// Eintrittsdatum, Arbeitstage mit Arbeitszeit und ein Hinweis zur Erreichbarkeit. Alles zusammen
// als ein verschluesseltes JSON-Feld (users.profile_enc, Migration 0064) -- personenbezogen wie
// Telefon oder Position, aber ohne eigene Such-/Sortierfunktion auf dem Server.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const workDaySchema = z.object({ start: z.string().regex(TIME), end: z.string().regex(TIME) }).strict()
  .refine(day => day.start < day.end, 'end_before_start');

// Schluessel wie Date.getDay(): 0 = Sonntag ... 6 = Samstag. Ein fehlender Tag ist arbeitsfrei.
export const workDaysSchema = z.object({
  '0': workDaySchema.optional(), '1': workDaySchema.optional(), '2': workDaySchema.optional(), '3': workDaySchema.optional(),
  '4': workDaySchema.optional(), '5': workDaySchema.optional(), '6': workDaySchema.optional()
}).strict();

export const userProfileSchema = z.object({
  employee_number: z.string().trim().max(64).optional(),
  cost_center: z.string().trim().max(64).optional(),
  building: z.string().trim().max(128).optional(),
  room: z.string().trim().max(64).optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  work_days: workDaysSchema.optional(),
  availability_note: z.string().trim().max(500).optional()
}).strict();

export type UserProfile = z.infer<typeof userProfileSchema>;

export interface ProfileCipherContext {
  installationId: string;
  recordId: string;
  dek: ResolvedDek;
}

const ctx = (c: ProfileCipherContext) => ({
  installationId: c.installationId,
  tableName: 'users', recordId: c.recordId, fieldName: 'profile'
});

// Leere Werte fallen weg; ein komplett leeres Profil wird als NULL gespeichert.
export function compactUserProfile(profile: UserProfile): UserProfile {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined || value === '') continue;
    if (key === 'work_days' && !Object.keys(value as object).length) continue;
    out[key] = value;
  }
  return out as UserProfile;
}

export function encryptUserProfile(profile: UserProfile | null | undefined, c: ProfileCipherContext): Buffer | null {
  const compact = profile ? compactUserProfile(profile) : {};
  if (!Object.keys(compact).length) return null;
  return fieldCipher.encryptField(JSON.stringify(compact), c.dek, ctx(c));
}

// Nicht lesbare oder ungueltige Daten ergeben ein leeres Profil statt eines Fehlers.
export function decryptUserProfile(stored: Buffer | null | undefined, c: ProfileCipherContext): UserProfile {
  if (!stored) return {};
  try {
    const parsed = userProfileSchema.safeParse(JSON.parse(fieldCipher.decryptField(stored, c.dek, ctx(c))));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
