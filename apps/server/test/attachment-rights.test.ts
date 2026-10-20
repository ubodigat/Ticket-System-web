import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerExtrasV2Routes } from '../src/http/routes/extras.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
const uid = 'owner';
async function requestAttachment({ method = 'DELETE', role = 'admin', uploader = uid, owner = uid, preview = false }:
  { method?: 'GET' | 'DELETE'; role?: 'user' | 'admin' | 'superadmin'; uploader?: string; owner?: string; preview?: boolean } = {}) {
  const context = (fieldName: string) => ({ installationId: 'test', schemaVersion: 1, tableName: 'attachments', recordId: 'file', fieldName, keyVersion: 1 });
  const file = { id: 'file', uploaded_by_user_id: uploader, ticket_id: 'ticket',
    filename: fieldCipher.encryptField('document.xlsx', Buffer.alloc(32, 7), context('filename')) };
  const deleted: unknown[][] = [];
  const db: any = {
    selectFrom: (table: string) => {
      const chain: any = { select: () => chain, selectAll: () => chain, where: () => chain,
        executeTakeFirst: async () => table === 'attachments' ? file : { created_by_user_id: owner } };
      return chain;
    },
    deleteFrom: () => {
      const chain: any = { where: (...args: unknown[]) => { deleted.push(args); return chain; }, execute: async () => [] };
      return chain;
    }
  };
  const app = Fastify(); app.decorate('db', db);
  app.addHook('onRequest', async req => { (req as any).ticketSession = { uid, username: 'owner', role }; });
  registerExtrasV2Routes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  try {
    return { response: await app.inject({ method, url: `/api/v2/attachments/file${preview ? '/preview' : ''}` }), deleted };
  } finally { await app.close(); }
}

describe('attachment ownership enforcement', () => {
  it('allows an admin to delete only their own upload', async () => {
    const result = await requestAttachment(); expect(result.response.statusCode).toBe(200);
    expect(result.deleted).toContainEqual(['uploaded_by_user_id', '=', uid]);
  });
  it('denies even a superadmin deletion of another person\'s attachment', async () => {
    for (const role of ['admin', 'superadmin'] as const) {
      const result = await requestAttachment({ role, uploader: 'other' });
      expect(result.response.statusCode).toBe(403); expect(result.deleted).toHaveLength(0);
    }
  });
  it('denies users deletion of their own attachments', async () => {
    const result = await requestAttachment({ role: 'user' });
    expect(result.response.statusCode).toBe(403); expect(result.deleted).toHaveLength(0);
  });
  it('authorizes previews before decoding documents or contacting the converter', async () => {
    const result = await requestAttachment({ method: 'GET', role: 'user', owner: 'other', preview: true });
    expect(result.response.statusCode).toBe(403);
  });
  it('reports missing conversion configuration instead of pretending to render Office documents', async () => {
    const result = await requestAttachment({ method: 'GET', preview: true });
    expect(result.response.statusCode).toBe(503); expect(result.response.json().error).toBe('preview_not_configured');
  });

  it('rejects uploads with blocked extensions or malicious binary content', async () => {
    const app = Fastify();
    const db: any = {
      // selectFrom('tickets') -- Ownership-Check; selectFrom('attachments') -- Tagesquote (B7,
      // zwei verkettete .where()-Aufrufe plus eb.fn.sum). Tabellen-bewusster Chain-Mock statt
      // des alten, nicht verketteten Minimal-Mocks.
      selectFrom: (table: string) => {
        const chain: any = { select: () => chain, where: () => chain, executeTakeFirst: async () => table === 'tickets' ? { id: 'ticket', created_by_user_id: uid } : { total: 0 } };
        return chain;
      },
      insertInto: () => ({ values: () => ({ execute: async () => [] }) })
    };
    app.decorate('db', db);
    app.addHook('onRequest', async req => { (req as any).ticketSession = { uid, username: 'owner', role: 'admin' }; });
    registerExtrasV2Routes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });

    try {
      // 1. Blocked extension
      const resExt = await app.inject({
        method: 'POST',
        url: '/api/v2/attachments',
        payload: { ticket_id: 'ticket', filename: 'script.exe', mime_type: 'application/octet-stream', size_bytes: 10, data_b64: Buffer.from('test').toString('base64') }
      });
      expect(resExt.statusCode).toBe(400);

      // 2. Disguised Windows PE binary (MZ header)
      const mzHeader = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const resMz = await app.inject({
        method: 'POST',
        url: '/api/v2/attachments',
        payload: { ticket_id: 'ticket', filename: 'invoice.pdf', mime_type: 'application/pdf', size_bytes: mzHeader.length, data_b64: mzHeader.toString('base64') }
      });
      expect(resMz.statusCode).toBe(400);

      // 3. Disguised Linux ELF binary
      const elfHeader = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
      const resElf = await app.inject({
        method: 'POST',
        url: '/api/v2/attachments',
        payload: { ticket_id: 'ticket', filename: 'document.pdf', mime_type: 'application/pdf', size_bytes: elfHeader.length, data_b64: elfHeader.toString('base64') }
      });
      expect(resElf.statusCode).toBe(400);

      // 4. Valid PDF upload succeeds
      const validPdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const resValid = await app.inject({
        method: 'POST',
        url: '/api/v2/attachments',
        payload: { ticket_id: 'ticket', filename: 'report.pdf', mime_type: 'application/pdf', size_bytes: validPdf.length, data_b64: validPdf.toString('base64') }
      });
      expect(resValid.statusCode).toBe(201);
      expect(resValid.json().filename).toBe('report.pdf');
    } finally {
      await app.close();
    }
  });
});
