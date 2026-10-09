/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Gemeinsame Session-Hilfsfunktionen für alle V2-Routen
import type { FastifyRequest } from 'fastify';

export interface SessionContext {
  uid: string;
  username: string;
  role: 'user' | 'admin' | 'superadmin';
}

export function getSession(req: FastifyRequest): SessionContext | null {
  const raw = req.cookies['__Host-ticket_session'] || req.cookies.ticket_session;
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as {
      uid?: unknown;
      username?: unknown;
      role?: unknown;
      iat?: unknown;
    };
    if (
      typeof parsed.uid !== 'string' ||
      typeof parsed.iat !== 'number' ||
      Date.now() - parsed.iat > 8 * 60 * 60 * 1000
    ) return null;
    return {
      uid: parsed.uid,
      username: typeof parsed.username === 'string' ? parsed.username : '',
      role: (parsed.role === 'superadmin' ? 'superadmin' : parsed.role === 'admin' ? 'admin' : 'user') as SessionContext['role']
    };
  } catch {
    return null;
  }
}

export function requireSession(req: FastifyRequest): SessionContext {
  const session = getSession(req);
  if (!session) throw { statusCode: 401, message: 'unauthorized' };
  return session;
}

export function requireAdmin(req: FastifyRequest): SessionContext {
  const session = requireSession(req);
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    throw { statusCode: 403, message: 'forbidden' };
  }
  return session;
}

export function requireSuperadmin(req: FastifyRequest): SessionContext {
  const session = requireSession(req);
  if (session.role !== 'superadmin') {
    throw { statusCode: 403, message: 'forbidden' };
  }
  return session;
}
