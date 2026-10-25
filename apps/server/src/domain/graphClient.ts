/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { Env } from '../config/env.js';
import type { KeyProvider } from '../crypto/keyProvider.js';
import { ensureDek } from '../crypto/dekService.js';
import { fieldCipher } from '../crypto/fieldCrypto.js';

// Microsoft Graph App-only (Client-Credentials) Integration für Outlook-Kalendertermine.
// Bewusst ohne @azure/msal-node oder @microsoft/microsoft-graph-client: beide ziehen einen
// großen Abhängigkeitsbaum nach sich, obwohl hier nur zwei einfache REST-Aufrufe benötigt werden
// (Token holen, Event anlegen) -- gleiche Abwägung wie schon bei S/MIME (siehe smime.ts).

export class GraphApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GraphApiError';
  }
}

interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
}

export async function getGraphAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) {
    // Fehlertext von Microsoft NICHT 1:1 durchreichen (kann interne Details enthalten) --
    // nur Statuscode und generische Meldung.
    throw new GraphApiError('graph_token_request_failed', res.status);
  }
  const data = await res.json() as GraphTokenResponse;
  return data.access_token;
}

export interface CalendarEventInput {
  subject: string;
  bodyText: string;
  startAt: Date;
  endAt: Date;
  attendeeEmails?: string[] | undefined;
}

export interface CalendarEventResult {
  graphEventId: string;
  webLink: string | null;
}

export async function createCalendarEvent(
  accessToken: string,
  mailbox: string,
  event: CalendarEventInput
): Promise<CalendarEventResult> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: event.subject,
      body: { contentType: 'Text', content: event.bodyText },
      start: { dateTime: event.startAt.toISOString(), timeZone: 'UTC' },
      end: { dateTime: event.endAt.toISOString(), timeZone: 'UTC' },
      attendees: (event.attendeeEmails ?? []).map(email => ({
        emailAddress: { address: email }, type: 'required'
      }))
    })
  });
  if (!res.ok) {
    throw new GraphApiError('graph_event_create_failed', res.status);
  }
  const data = await res.json() as { id: string; webLink?: string };
  return { graphEventId: data.id, webLink: data.webLink ?? null };
}

export interface OutlookSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  mailbox: string;
  clientSecret: string;
}

// Persönlicher Kalender (delegierte Berechtigung, Authorization Code Flow): nutzt dieselbe
// Azure-App-Registrierung (tenantId/clientId/clientSecret) wie die App-only-Integration oben --
// Azure erlaubt beide Berechtigungsarten an derselben App, solange die Admin-Person die
// delegierten Scopes zusätzlich per Consent freigegeben hat. "mailbox"/"enabled" (App-only-
// Schalter) sind hierfür irrelevant, deshalb ein eigener, schlankerer Loader.
export interface OutlookAppCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export async function loadOutlookAppCredentials(db: Kysely<Database>, env: Env, keyProvider: KeyProvider): Promise<OutlookAppCredentials | null> {
  const row = await db.selectFrom('app_settings').select(['config_json', 'outlook_client_secret_enc']).where('id', '=', 1).executeTakeFirst();
  if (!row) return null;
  const config = row.config_json ? JSON.parse(row.config_json) : {};
  const outlook = config.outlookConfig || {};
  if (!outlook.tenantId || !outlook.clientId || !row.outlook_client_secret_enc) return null;

  const dek = await ensureDek(db, keyProvider, 'app_settings.outlook_client_secret');
  const clientSecret = fieldCipher.decryptField(row.outlook_client_secret_enc, dek.rawDek, {
    installationId: env.INSTALLATION_ID, schemaVersion: env.SCHEMA_VERSION,
    tableName: 'app_settings', recordId: '1', fieldName: 'outlook_client_secret', keyVersion: dek.keyVersion
  });
  return { tenantId: outlook.tenantId, clientId: outlook.clientId, clientSecret };
}

// Scopes bewusst minimal: offline_access (für den Refresh-Token), Calendars.ReadWrite (eigener
// Kalender lesen/schreiben), User.Read (Anzeigename/E-Mail fürs "Verbunden als ..."). Kein
// Mail.* oder Zugriff auf andere Postfächer.
const DELEGATED_SCOPES = 'offline_access Calendars.ReadWrite User.Read';

export function getAuthorizationUrl(tenantId: string, clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: DELEGATED_SCOPES,
    state
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface GraphDelegatedTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface DelegatedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}

export async function exchangeAuthCodeForTokens(tenantId: string, clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<DelegatedTokens> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: DELEGATED_SCOPES
  });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new GraphApiError('graph_token_exchange_failed', res.status);
  const data = await res.json() as GraphDelegatedTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresInSeconds: data.expires_in };
}

// Microsoft rotiert den Refresh-Token bei jeder Nutzung oft neu -- der Aufrufer MUSS den
// zurückgegebenen refreshToken (falls vorhanden) anstelle des alten speichern, sonst schlägt der
// nächste Refresh fehl.
export async function refreshDelegatedAccessToken(tenantId: string, clientId: string, clientSecret: string, refreshToken: string): Promise<DelegatedTokens> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: DELEGATED_SCOPES
  });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new GraphApiError('graph_token_refresh_failed', res.status);
  const data = await res.json() as GraphDelegatedTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresInSeconds: data.expires_in };
}

export async function getMyProfile(accessToken: string): Promise<{ email: string | null }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new GraphApiError('graph_profile_failed', res.status);
  const data = await res.json() as { mail?: string | null; userPrincipalName?: string | null };
  return { email: data.mail ?? data.userPrincipalName ?? null };
}

export interface MyCalendarEvent {
  id: string;
  subject: string;
  startAt: string;
  endAt: string;
  webLink: string | null;
}

export async function getMyCalendarView(accessToken: string, startIso: string, endIso: string): Promise<MyCalendarEvent[]> {
  const params = new URLSearchParams({ startDateTime: startIso, endDateTime: endIso, $select: 'id,subject,start,end,webLink', $top: '250' });
  const url = `https://graph.microsoft.com/v1.0/me/calendarview?${params.toString()}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC"' }
  });
  if (!res.ok) throw new GraphApiError('graph_calendar_view_failed', res.status);
  const data = await res.json() as { value: Array<{ id: string; subject: string; start: { dateTime: string }; end: { dateTime: string }; webLink?: string }> };
  return data.value.map(e => ({ id: e.id, subject: e.subject, startAt: e.start.dateTime, endAt: e.end.dateTime, webLink: e.webLink ?? null }));
}

export async function createMyCalendarEvent(accessToken: string, event: CalendarEventInput): Promise<CalendarEventResult> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: event.subject,
      body: { contentType: 'Text', content: event.bodyText },
      start: { dateTime: event.startAt.toISOString(), timeZone: 'UTC' },
      end: { dateTime: event.endAt.toISOString(), timeZone: 'UTC' },
      attendees: (event.attendeeEmails ?? []).map(email => ({
        emailAddress: { address: email }, type: 'required'
      }))
    })
  });
  if (!res.ok) throw new GraphApiError('graph_event_create_failed', res.status);
  const data = await res.json() as { id: string; webLink?: string };
  return { graphEventId: data.id, webLink: data.webLink ?? null };
}

// Lädt Outlook/Graph-Konfiguration + entschlüsseltes Client-Secret aus app_settings. Gibt null
// zurück, wenn die Integration nicht vollständig konfiguriert ist (dann soll der aufrufende Code
// mit einer klaren "nicht konfiguriert"-Fehlermeldung abbrechen statt einen Graph-Aufruf mit
// leeren Feldern zu versuchen).
export async function loadOutlookSettings(db: Kysely<Database>, env: Env, keyProvider: KeyProvider): Promise<OutlookSettings | null> {
  const row = await db.selectFrom('app_settings').select(['config_json', 'outlook_client_secret_enc']).where('id', '=', 1).executeTakeFirst();
  if (!row) return null;
  const config = row.config_json ? JSON.parse(row.config_json) : {};
  const outlook = config.outlookConfig || {};
  if (!outlook.enabled || !outlook.tenantId || !outlook.clientId || !outlook.mailbox || !row.outlook_client_secret_enc) return null;

  const dek = await ensureDek(db, keyProvider, 'app_settings.outlook_client_secret');
  const clientSecret = fieldCipher.decryptField(row.outlook_client_secret_enc, dek.rawDek, {
    installationId: env.INSTALLATION_ID, schemaVersion: env.SCHEMA_VERSION,
    tableName: 'app_settings', recordId: '1', fieldName: 'outlook_client_secret', keyVersion: dek.keyVersion
  });
  return { enabled: true, tenantId: outlook.tenantId, clientId: outlook.clientId, mailbox: outlook.mailbox, clientSecret };
}
