/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { hkdfSync } from 'node:crypto';

// Ein eigener Schluessel je Zweck, per HKDF-SHA256 aus COOKIE_SECRET abgeleitet (Review 11/2026,
// Punkt 15). Ein Token des einen Zwecks laesst sich so nie als Token eines anderen ausgeben, und
// COOKIE_SECRET selbst signiert nur noch die Sitzungs-Cookies.
export type KeyPurpose = 'office-source-token' | 'mfa-pending-token' | 'login-pseudo-account';

const cache = new Map<string, Buffer>();

export function derivedKey(secret: string, purpose: KeyPurpose): Buffer {
  const id = `${purpose}\0${secret}`;
  let key = cache.get(id);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('ticket-system', 'utf8'), Buffer.from(`${purpose}/v1`, 'utf8'), 32));
    cache.set(id, key);
  }
  return key;
}
