/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import type { FastifyInstance, FastifyReply } from 'fastify';

// Zentrale Fehlerbehandlung für alle V2-Routen. Vorher gab jede Route bei JEDEM Fehler
// `e.message` roh an den Client zurück -- bei einem echten, unerwarteten Fehler (z.B. einer
// MariaDB-Fehlermeldung mit Spalten-/Tabellennamen) wäre das "Sensitive Data Exposure"/
// "Debug Mode aktiviert" aus der Anforderungsliste gewesen. Jetzt gilt: Nur die eigenen,
// bewusst geschriebenen Kontrollfluss-Fehler (401/403/404/409/...) mit ihren festen,
// ungefährlichen Texten gehen an den Client; alles andere wird nur serverseitig geloggt und
// als generischer 500er beantwortet.
export function routeError(app: FastifyInstance, reply: FastifyReply, err: unknown): FastifyReply {
  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    const message = (err as { message?: unknown })?.message;
    return reply.code(statusCode).send({ error: typeof message === 'string' ? message : 'bad_request' });
  }
  app.log.error({ err }, 'Unbehandelter Fehler in einer V2-Route');
  return reply.code(500).send({ error: 'internal_error' });
}
