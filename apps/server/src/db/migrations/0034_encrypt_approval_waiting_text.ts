/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Security-Audit N10: approval_text/waiting_message standen bisher im Klartext in der
// Datenbank (Genehmigungsbegründungen bzw. "worauf wird gewartet"-Texte können personenbezogene
// Inhalte enthalten) -- jetzt AES-256-GCM-verschlüsselt wie title/description/incident_notice
// (siehe tickets.ts loadTicketDeks/encryptTicketField/decryptTicketField). mediumblob statt einer
// festen varbinary-Länge, exakt wie bei description, um bei Mehrbyte-UTF-8-Zeichen keine
// Byte-Längen-Berechnung riskieren zu müssen. ALTER TABLE ... MODIFY COLUMN auf einer
// Installation mit vorhandenen Klartext-Werten würde diese als rohe Bytes übernehmen und beim
// nächsten Lesen mit decryptTicketField fehlschlagen -- betrifft nur Installationen, die
// zwischen Erstinstallation und diesem Update tatsächlich schon Genehmigungen/Wartehinweise
// gespeichert hatten; für eine neue Installation (leere tickets-Tabelle) ist das folgenlos.
export const migration_0034_encrypt_approval_waiting_text: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('tickets')
      .modifyColumn('approval_text', sql`mediumblob`)
      .execute();
    await db.schema.alterTable('tickets')
      .modifyColumn('waiting_message', sql`mediumblob`)
      .execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('tickets')
      .modifyColumn('approval_text', sql`text`)
      .execute();
    await db.schema.alterTable('tickets')
      .modifyColumn('waiting_message', sql`varchar(2000)`)
      .execute();
  }
};
