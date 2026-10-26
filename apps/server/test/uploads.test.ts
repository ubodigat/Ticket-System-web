import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerUploadRoutes, uploadRequestSchema, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '../src/http/routes/uploads.js';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { createHash } from 'node:crypto';

vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ rawDek: Buffer.alloc(32, 7), keyVersion: 1 }) }));
vi.mock('../src/domain/antivirus.js', () => ({ scanIfConfigured: vi.fn(async () => {}) }));
const uid = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const tables: Record<string, any[]> = { users: [{ id: uid }], tickets: [{ id: ticketId, created_by_user_id: uid }], file_uploads: [], file_upload_chunks: [], attachments: [], kb_article_attachments: [] };
  const query = (table: string, operation: string) => {
    const conditions: any[] = []; let values: any; let aggregate = false;
    const filtered = () => (tables[table] || []).filter(row => conditions.every(([key, op, value]) => op === '=' ? row[key] === value : op === '<' ? row[key] < value : op === '>=' ? row[key] >= value : false));
    const first = () => aggregate ? { total: filtered().reduce((sum, row) => sum + row.size_bytes, 0) } : filtered()[0];
    const q: any = { select: (value: any) => { aggregate = typeof value === 'function'; return q; }, selectAll: () => q,
      where: (...value: any[]) => { conditions.push(value); return q; }, forUpdate: () => q,
      set: (value: any) => { values = value; return q; }, values: (value: any) => { values = value; return q; },
      executeTakeFirst: async () => first(), executeTakeFirstOrThrow: async () => { const row = first(); if (!row) throw new Error('missing'); return row; },
      execute: async () => {
        if (operation === 'insert') tables[table]!.push({ received_bytes: 0, completed: false, created_at: new Date(), ...values });
        if (operation === 'update') filtered().forEach(row => Object.assign(row, values));
        if (operation === 'delete') { const removed = new Set(filtered()); tables[table] = (tables[table] || []).filter(row => !removed.has(row)); }
        return filtered();
      } };
    return q;
  };
  const db: any = { selectFrom: (table: string) => query(table, 'select'), insertInto: (table: string) => query(table, 'insert'),
    updateTable: (table: string) => query(table, 'update'), deleteFrom: (table: string) => query(table, 'delete'), transaction: () => ({ execute: (fn: any) => fn(db) }) };
  const app = Fastify(); app.decorate('db', db);
  const session = { uid, username: 'owner', role: 'user' as 'user' | 'admin' | 'superadmin' };
  let authenticated = true;
  app.addHook('onRequest', async req => { req.ticketSession = authenticated ? session : null; });
  registerUploadRoutes(app, { env: { INSTALLATION_ID: 'test', SCHEMA_VERSION: 1 } as any, keyProvider: {} as any });
  const start = async (size: number, filename = 'document.txt') => app.inject({ method: 'POST', url: '/api/v2/uploads', payload: { ticket_id: ticketId, filename, mime_type: 'text/plain', size_bytes: size } });
  const chunk = (id: string, part: number, data: Buffer) => app.inject({ method: 'PUT', url: `/api/v2/uploads/${id}/chunks/${part}`, headers: { 'content-type': 'application/octet-stream' }, payload: data });
  return { app, start, chunk, tables, session, setAuthenticated: (value: boolean) => { authenticated = value; } };
}
describe('bounded encrypted attachment uploads', () => {
  it.runIf(process.env.RUN_LARGE_UPLOAD_TEST === '1')('handles a 500 MiB end-to-end upload and streamed download with database test doubles', async () => {
    const f = fixture();
    try {
      const id = (await f.start(MAX_UPLOAD_BYTES)).json().id;
      const source = createHash('sha256');
      const block = Buffer.alloc(UPLOAD_CHUNK_BYTES, 65);
      for (let offset = 0, part = 0; offset < MAX_UPLOAD_BYTES; offset += UPLOAD_CHUNK_BYTES, part++) {
        block.write(String(part).padStart(8, '0'), 0, 'ascii');
        const bytes = block.subarray(0, Math.min(UPLOAD_CHUNK_BYTES, MAX_UPLOAD_BYTES - offset));
        source.update(bytes);
        expect((await f.chunk(id, part, bytes)).statusCode).toBe(200);
      }
      const complete = await f.app.inject({ method: 'POST', url: `/api/v2/uploads/${id}/complete` });
      expect(complete.statusCode).toBe(201);
      expect(complete.json().size_bytes).toBe(MAX_UPLOAD_BYTES);
      const url = await f.app.listen({ host: '127.0.0.1', port: 0 });
      const download = await fetch(`${url}/api/v2/uploads/${id}/content`);
      expect(download.status).toBe(200);
      const hash = createHash('sha256'); let size = 0;
      for await (const part of download.body as any) { hash.update(part); size += part.length; }
      expect(size).toBe(MAX_UPLOAD_BYTES);
      expect(hash.digest('hex')).toBe(source.digest('hex'));
    } finally { await f.app.close(); }
  }, 180000);
  it('accepts exactly 500 MiB but rejects larger declarations and ambiguous parents', () => {
    const data = { ticket_id: ticketId, filename: 'x.txt', mime_type: 'text/plain', size_bytes: MAX_UPLOAD_BYTES };
    expect(uploadRequestSchema.safeParse(data).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...data, size_bytes: MAX_UPLOAD_BYTES + 1 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ ...data, article_id: ticketId }).success).toBe(false);
  });
  it('rejects anonymous upload bodies before the binary parser allocates them', async () => {
    const f = fixture(); f.setAuthenticated(false);
    try { expect((await f.chunk('missing', 0, Buffer.alloc(UPLOAD_CHUNK_BYTES + 1))).statusCode).toBe(401); }
    finally { await f.app.close(); }
  });
  it('publishes only after complete validation, encrypts each block and streams the original bytes', async () => {
    const f = fixture();
    try {
      const first = Buffer.alloc(UPLOAD_CHUNK_BYTES, 65); const tail = Buffer.from('END');
      const response = await f.start(first.length + tail.length); expect(response.statusCode).toBe(201);
      const id = response.json().id;
      expect(f.tables.attachments).toHaveLength(0);
      expect((await f.chunk(id, 0, first)).statusCode).toBe(200);
      expect((await f.chunk(id, 1, tail)).statusCode).toBe(200);
      const stored = f.tables.file_upload_chunks[0]!;
      const plaintext = fieldCipher.decryptField(stored.data_enc, Buffer.alloc(32, 7), { installationId: 'test', schemaVersion: 1, tableName: 'file_uploads', recordId: `${id}:0`, fieldName: 'data', keyVersion: 1 });
      expect(Buffer.from(plaintext, 'base64').equals(first)).toBe(true);
      expect((await f.app.inject({ method: 'POST', url: `/api/v2/uploads/${id}/complete` })).statusCode).toBe(201);
      expect(f.tables.attachments).toHaveLength(1);
      const download = await f.app.inject({ method: 'GET', url: `/api/v2/uploads/${id}/content` });
      expect(download.statusCode).toBe(200); expect(download.rawPayload.equals(Buffer.concat([first, tail]))).toBe(true);
      expect(download.headers['content-disposition']).toContain('attachment;');
      f.tables.file_uploads[0]!.size_bytes--;
      expect((await f.app.inject({ method: 'GET', url: `/api/v2/uploads/${id}/content` })).statusCode).toBe(500);
      f.tables.file_uploads[0]!.size_bytes++;
      f.session.uid = 'foreign';
      expect((await f.app.inject({ method: 'GET', url: `/api/v2/uploads/${id}/content` })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });
  it('rejects missing, repeated, foreign and incorrectly sized blocks', async () => {
    const f = fixture();
    try {
      const id = (await f.start(3)).json().id;
      expect((await f.chunk(id, 1, Buffer.from('abc'))).statusCode).toBe(400);
      expect((await f.chunk(id, 0, Buffer.from('ab'))).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: `/api/v2/uploads/${id}/complete` })).statusCode).toBe(400);
      f.session.uid = 'foreign'; expect((await f.chunk(id, 0, Buffer.from('abc'))).statusCode).toBe(404);
      f.session.uid = uid; expect((await f.chunk(id, 0, Buffer.from('abc'))).statusCode).toBe(200);
      expect((await f.chunk(id, 0, Buffer.from('abc'))).statusCode).toBe(400);
      expect(f.tables.attachments).toHaveLength(0);
    } finally { await f.app.close(); }
  });
  it('never publishes an executable or script disguised as a document', async () => {
    const f = fixture();
    try {
      const bytes = Buffer.from('<script>alert(1)</script>'); const id = (await f.start(bytes.length)).json().id;
      await f.chunk(id, 0, bytes);
      expect((await f.app.inject({ method: 'POST', url: `/api/v2/uploads/${id}/complete` })).statusCode).toBe(400);
      expect(f.tables.attachments).toHaveLength(0);
      expect((await f.app.inject({ method: 'GET', url: `/api/v2/uploads/${id}/content` })).statusCode).toBe(404);
    } finally { await f.app.close(); }
  });
  it('does not reserve space on someone else\'s ticket', async () => {
    const f = fixture(); f.session.uid = 'foreign';
    try { expect((await f.start(100)).statusCode).toBe(403); expect(f.tables.file_uploads).toHaveLength(0); }
    finally { await f.app.close(); }
  });
});
