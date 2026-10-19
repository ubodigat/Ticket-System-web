/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Gemeinsame Session-Hilfsfunktionen für alle V2-Routen
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export interface SessionContext {
  uid: string;
  username: string;
  role: 'user' | 'admin' | 'superadmin';
}

declare module 'fastify' {
  interface FastifyRequest {
    ticketSession: SessionContext | null;
  }
}

// Cookie-Parsing und die Gegenprobe gegen den aktuellen Rollen-/Sperr-/Archiv-Status in der
// Datenbank laufen zentral im onRequest-Hook in app.ts (einmal pro Anfrage); hier wird nur noch
// das bereits geprüfte Ergebnis gelesen. So greift eine Rollenänderung, Sperrung oder
// Archivierung sofort und nicht erst nach Ablauf des bis zu 8h gültigen Cookies.
export function getSession(req: FastifyRequest): SessionContext | null {
  return req.ticketSession ?? null;
}

export function requireSession(req: FastifyRequest): SessionContext {
  const session = getSession(req);
  if (!session) throw { statusCode: 401, message: 'unauthorized' };
  return session;
}

// Unzureichendes Security Logging -- jeder 403 wegen fehlender Rolle wird sicher
// im strukturierten Sicherheits-Log festgehalten (Pino), ohne die Anfrage durch DB-Fehler zu stören.
function logForbidden(req: FastifyRequest, session: SessionContext, requiredRole: string): void {
  try {
    req.log?.warn({
      event: 'access.forbidden',
      uid: session.uid,
      username: session.username,
      requiredRole,
      actualRole: session.role,
      url: req.url,
      method: req.method
    }, 'Unberechtigter Zugriffsversuch abgewiesen');
  } catch {
    // Logging darf niemals einen Folgefehler werfen
  }
}

export function requireAdmin(req: FastifyRequest): SessionContext {
  const session = requireSession(req);
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    logForbidden(req, session, 'admin');
    throw { statusCode: 403, message: 'forbidden' };
  }
  return session;
}

export function requireSuperadmin(req: FastifyRequest): SessionContext {
  const session = requireSession(req);
  if (session.role !== 'superadmin') {
    logForbidden(req, session, 'superadmin');
    throw { statusCode: 403, message: 'forbidden' };
  }
  return session;
}
