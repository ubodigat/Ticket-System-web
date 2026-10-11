/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
// Liefert die (weiterhin als Design-Basis verwendeten) Oberflächen-Dateien aus. Bewusst KEIN
// generischer Verzeichnis-Server: eine feste Allowlist exakter Pfade, kein Pfad-Parameter aus
// der Anfrage -- Path Traversal ist dadurch strukturell ausgeschlossen (siehe Anforderungsliste
// "Path Traversal"/"Directory Listing"). Diese Dateien enthalten selbst keine Geheimnisse; der
// eigentliche Schutz liegt in der v2-API, die sie aufrufen (Session-Cookie + Rechteprüfung).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const ASSETS: Record<string, { file: string; contentType: string; root: 'app' | 'vendor' }> = {
  '/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8', root: 'app' },
  '/dashboard.html': { file: 'dashboard.html', contentType: 'text/html; charset=utf-8', root: 'app' },
  '/admin.html': { file: 'admin.html', contentType: 'text/html; charset=utf-8', root: 'app' },
  '/script.js': { file: 'script.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  // Native ES-Module (type="module" in den HTML-Dateien, kein Bundler) -- script.js ist nur noch
  // der schlanke Einstiegspunkt (DOMContentLoaded/Bootstrap), die eigentliche Logik liegt in
  // diesen Modulen. Jede Datei einzeln in der Allowlist, aus demselben Grund wie oben.
  '/js/utils.js': { file: 'js/utils.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/lang.js': { file: 'js/lang.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/store.js': { file: 'js/store.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/log-diff.js': { file: 'js/log-diff.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/auth.js': { file: 'js/auth.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/ui.js': { file: 'js/ui.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/settings.js': { file: 'js/settings.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/user-dash.js': { file: 'js/user-dash.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/ticket-helpers.js': { file: 'js/ticket-helpers.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/admin-board.js': { file: 'js/admin-board.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/js/context-menu.js': { file: 'js/context-menu.js', contentType: 'application/javascript; charset=utf-8', root: 'app' },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8', root: 'app' },
  '/favicon.ico': { file: 'picture/favicon.png', contentType: 'image/png', root: 'app' },
  '/picture/favicon.png': { file: 'picture/favicon.png', contentType: 'image/png', root: 'app' },
  // Self-hosted statt CDN (Anforderung "Bibliotheken lokal statt per CDN") -- feste Versionen,
  // heruntergeladen und einmalig ins Repository gelegt, kein Build-Schritt zur Laufzeit nötig.
  '/vendor/lucide.min.js': { file: 'lucide.min.js', contentType: 'application/javascript; charset=utf-8', root: 'vendor' },
  '/vendor/dompurify.min.js': { file: 'dompurify.min.js', contentType: 'application/javascript; charset=utf-8', root: 'vendor' },
  '/vendor/mammoth.browser.min.js': { file: 'mammoth.browser.min.js', contentType: 'application/javascript; charset=utf-8', root: 'vendor' },
  '/vendor/xlsx.full.min.js': { file: 'xlsx.full.min.js', contentType: 'application/javascript; charset=utf-8', root: 'vendor' },
  '/vendor/jszip.min.js': { file: 'jszip.min.js', contentType: 'application/javascript; charset=utf-8', root: 'vendor' }
};

// Im Docker-Image liegen die Oberflächen-Dateien unter ./public (siehe Dockerfile.server), in
// der lokalen Entwicklung ohne Docker liegen sie im Projekt-Wurzelverzeichnis. vendor/ liegt in
// beiden Fällen eine Ebene über apps/server bzw. im Image direkt neben public/.
function appRoot(): string {
  const candidates = [join(process.cwd(), 'public'), join(process.cwd(), '..', '..'), process.cwd()];
  return candidates.find(dir => existsSync(join(dir, 'dashboard.html'))) ?? candidates[0]!;
}

function vendorRoot(): string {
  const candidates = [join(process.cwd(), 'vendor'), join(process.cwd(), '..', '..', 'vendor')];
  return candidates.find(dir => existsSync(join(dir, 'lucide.min.js'))) ?? candidates[0]!;
}

async function sendAsset(app: FastifyInstance, reply: FastifyReply, asset: { file: string; contentType: string; root: 'app' | 'vendor' }) {
  const root = normalize(asset.root === 'vendor' ? vendorRoot() : appRoot());
  const full = normalize(join(root, asset.file));
  try {
    const data = await readFile(full);
    return reply.type(asset.contentType).send(data);
  } catch (err) {
    app.log.error({ err, file: asset.file }, 'Statische Oberflächen-Datei nicht gefunden');
    return reply.code(404).send('Nicht gefunden');
  }
}

export function registerStaticAssetRoutes(app: FastifyInstance): void {
  for (const [path, asset] of Object.entries(ASSETS)) {
    app.get(path, async (_req, reply) => sendAsset(app, reply, asset));
  }
}
