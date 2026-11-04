/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is Ticket-System-web.
The Original Developer is the Initial Developer: U:Bodigat.
The Initial Developer of the Original Code is U:Bodigat. All portions of the code written by U:Bodigat are Copyright (c) 2026 U:Bodigat. All Rights Reserved.
Contributors: see CONTRIBUTORS.md and CHANGES.md.
*/
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/connection.js';
import { appendKekVersion, createFileKeyProvider, retireKekVersions } from '../crypto/keyProvider.js';
import { cryptoStatus, pruneRetiredDeks, reencryptAll, rewrapAllDeks, rotateAllDeks, rotateDek } from '../crypto/rotation.js';

// Schluesselverwaltung (Review 11/2026, Punkt 3). Ablauf nach einem Schluessel-Leak:
//   keys rotate-kek      neue KEK anhaengen und alle DEKs neu umhuellen (App vorher anhalten,
//                        ops/docker/rotate-keys.sh erledigt das)
//   keys rotate-dek --all  neue DEK-Version je Zweck
//   keys reencrypt       alle Werte auf die neuen Versionen bringen (fortsetzbar)
//   keys prune-deks      alte DEK-Versionen entfernen
//   keys retire-kek      alte KEK-Versionen aus der Datei entfernen
const USAGE = 'Verwendung: node dist/cli/keys.js status | rotate-kek | rotate-dek <zweck>|--all | reencrypt | prune-deks | retire-kek';

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (!command) { console.error(USAGE); process.exitCode = 2; return; }
  const env = loadEnv();
  const db = createDb(env, env.DB_USER && env.DB_PASSWORD ? 'schema' : 'runtime');
  try {
    switch (command) {
      case 'status': {
        const status = await cryptoStatus(db, createFileKeyProvider(env.KEK_FILE_PATH));
        console.log(`KEK-Versionen in der Datei: ${status.kekVersions.join(', ')} (aktuell ${status.currentKek})`);
        console.log(`KEK-Versionen in Benutzung: ${status.dekKekVersions.join(', ') || '-'}; DEKs ohne AAD-Bindung: ${status.unboundWraps}`);
        for (const p of status.purposes) console.log(`  ${p.purpose}: aktiv v${p.active ?? '-'} (${p.versions} Version(en))`);
        console.log(status.reencryptPending ? 'Neuverschluesselung: ausstehend' : 'Neuverschluesselung: abgeschlossen');
        break;
      }
      case 'rotate-kek': {
        const version = await appendKekVersion(env.KEK_FILE_PATH);
        const count = await rewrapAllDeks(db, createFileKeyProvider(env.KEK_FILE_PATH));
        console.log(`Neue KEK-Version ${version}; ${count} DEK(s) neu umhuellt. Alte KEK erst nach "keys retire-kek" entfernen.`);
        break;
      }
      case 'rotate-dek': {
        const provider = createFileKeyProvider(env.KEK_FILE_PATH);
        if (argument === '--all') {
          const purposes = await rotateAllDeks(db, provider, 'manual rotation (all)');
          console.log(`${purposes.length} Zweck(e) rotiert. Jetzt "keys reencrypt" ausfuehren.`);
        } else if (argument) {
          console.log(`${argument}: neue Version ${await rotateDek(db, provider, argument, 'manual rotation')}. Jetzt "keys reencrypt" ausfuehren.`);
        } else {
          console.error(USAGE); process.exitCode = 2;
        }
        break;
      }
      case 'reencrypt': {
        const result = await reencryptAll({ db, keyProvider: createFileKeyProvider(env.KEK_FILE_PATH), installationId: env.INSTALLATION_ID });
        console.log(`Geprueft: ${result.processed}, neu verschluesselt: ${result.updated}, nicht lesbar: ${result.failed}`);
        for (const failure of result.failures) console.log(`  nicht lesbar: ${failure}`);
        if (result.failed) process.exitCode = 1;
        break;
      }
      case 'prune-deks':
        console.log(`${await pruneRetiredDeks(db)} alte DEK-Version(en) entfernt.`);
        break;
      case 'retire-kek': {
        const status = await cryptoStatus(db, createFileKeyProvider(env.KEK_FILE_PATH));
        if (status.dekKekVersions.some(version => version !== status.currentKek) || status.unboundWraps > 0) {
          throw new Error('Noch nicht alle DEKs sind mit der aktuellen KEK umhuellt -- zuerst "keys rotate-kek" abschliessen.');
        }
        const removed = await retireKekVersions(env.KEK_FILE_PATH, new Set([status.currentKek]));
        console.log(removed.length ? `KEK-Version(en) ${removed.join(', ')} entfernt.` : 'Keine alte KEK-Version vorhanden.');
        break;
      }
      default:
        console.error(USAGE); process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

await main();
