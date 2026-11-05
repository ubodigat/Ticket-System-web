import { createHash } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { fieldCipher } from '../src/crypto/fieldCrypto.js';
import { buildPersonalDataExport, exportSections, NEVER_EXPORTED } from '../src/domain/personalDataExport.js';
import { registerPrivacyRoutes } from '../src/http/routes/privacy.js';
import { testDek } from './helpers/testDek.js';
import { TABLES } from '../src/db/schema.js';

vi.mock('argon2', () => ({ verify: async (_hash: string, password: string) => password === 'correct-password' }));
vi.mock('../src/crypto/dekService.js', () => ({ ensureDek: async () => ({ purpose: 'test', keyVersion: 1, rawDek: Buffer.alloc(32, 7), keys: new Map([[1, Buffer.alloc(32, 7)]]) }) }));
import { canAccessTicket, recipientsWithAccess, scopeAllowsTicket, ticketRouteGuard, TICKET_ROUTE } from '../src/domain/ticketAccess.js';
import { validateUploadedFile, validateUploadedStream } from '../src/domain/fileValidation.js';
import { scanBuffer } from '../src/domain/antivirus.js';

// Regressionstests zum Security-Audit vom 04.11.2026 (Stand d174169): R-29, R-30, R-31 und die
// offenen Punkte der Checkliste. R-14 (signierte Releases) prueft ops/tests/release-signature.sh.
const repo = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), 'utf8');

// Kleine Fake-Datenbank mit Filterung nach '=' und 'in' (je Tabelle feste Zeilen).
function fakeDb(tables: Record<string, any[]>) {
  return {
    selectFrom: (table: string) => {
      const conditions: Array<[string, string, unknown]> = [];
      const rows = () => (tables[table] || []).filter(row => conditions.every(([key, op, value]) =>
        op === 'in' ? (value as unknown[]).includes(row[key]) : row[key] === value));
      const chain: any = { select: () => chain, where: (key: string, op: string, value: unknown) => { conditions.push([key, op, value]); return chain; },
        executeTakeFirst: async () => rows()[0], execute: async () => rows() };
      return chain;
    }
  } as any;
}

describe('R-30: groups are sealed off, also for unassigned tickets', () => {
  const groups = [{ id: 'it', parent_id: null }, { id: 'hr', parent_id: null }];
  const tables = {
    tickets: [{ id: 'hr-open', created_by_user_id: 'owner', assigned_to_user_id: null, assigned_group_id: 'hr', category: 'Personal' },
      { id: 'no-group', created_by_user_id: 'owner', assigned_to_user_id: null, assigned_group_id: null, category: 'Hardware' }],
    users: [{ id: 'it-admin', role: 'admin', account_archived: false }, { id: 'hr-admin', role: 'admin', account_archived: false },
      { id: 'owner', role: 'user', account_archived: false }, { id: 'stranger', role: 'user', account_archived: false },
      { id: 'boss', role: 'superadmin', account_archived: false }],
    user_groups: [{ user_id: 'it-admin', group_id: 'it' }, { user_id: 'hr-admin', group_id: 'hr' }],
    groups, ticket_participants: []
  };

  it('hides an unassigned ticket of another group, but not tickets without a group', async () => {
    const db = fakeDb(tables);
    expect(await canAccessTicket(db, { uid: 'it-admin', role: 'admin' }, 'hr-open')).toBe(false);
    expect(await canAccessTicket(db, { uid: 'hr-admin', role: 'admin' }, 'hr-open')).toBe(true);
    expect(await canAccessTicket(db, { uid: 'it-admin', role: 'admin' }, 'no-group')).toBe(true);
    const scope = { all: false, uid: 'it-admin', role: 'admin', visibleGroupIds: new Set(['it']), participantTicketIds: new Set<string>() };
    expect(scopeAllowsTicket(scope, tables.tickets[0]!)).toBe(false);
    expect(scopeAllowsTicket(scope, { ...tables.tickets[0]!, category: 'Allgemein' })).toBe(false);
    expect(scopeAllowsTicket(scope, { ...tables.tickets[0]!, assigned_to_user_id: 'it-admin' })).toBe(true);
  });

  it('only notifies accounts that may open the ticket', async () => {
    const db = fakeDb(tables);
    expect(await recipientsWithAccess(db, 'hr-open', ['it-admin', 'hr-admin', 'owner', 'stranger', 'boss', null, 'hr-admin', 'unknown']))
      .toEqual(['hr-admin', 'owner', 'boss']);
    expect(await recipientsWithAccess(fakeDb({ ...tables, users: tables.users.map(user => ({ ...user, account_archived: true })) }), 'hr-open', ['hr-admin'])).toEqual([]);
  });

  it('guards every route below /api/v2/tickets/:id with 404 and leaves others alone', async () => {
    expect(TICKET_ROUTE.test('/api/v2/tickets/:id')).toBe(true);
    expect(TICKET_ROUTE.test('/api/v2/tickets/:id/notes/:noteId')).toBe(true);
    expect(TICKET_ROUTE.test('/api/v2/tickets/:idx')).toBe(false);
    expect(TICKET_ROUTE.test('/api/v2/tickets/archived')).toBe(false);
    const guard = ticketRouteGuard(fakeDb(tables));
    const reply = () => { const state: any = { code: 0, body: null }; return Object.assign(state, { code: (c: number) => { state.status = c; return state; }, send: (b: unknown) => { state.body = b; return state; } }); };
    const call = async (uid: string, role: string, url: string) => {
      const r = reply();
      await guard({ routeOptions: { url }, params: { id: 'hr-open' }, ticketSession: { uid, username: uid, role }, method: 'GET' } as any, r);
      return r;
    };
    expect((await call('it-admin', 'admin', '/api/v2/tickets/:id/messages')).status).toBe(404);
    expect((await call('stranger', 'user', '/api/v2/tickets/:id')).body).toEqual({ error: 'not_found' });
    expect((await call('hr-admin', 'admin', '/api/v2/tickets/:id/messages')).status).toBeUndefined();
    expect((await call('it-admin', 'admin', '/api/v2/tickets/:id/approval-decision')).status).toBeUndefined();
  });
});

describe('R-29: uploads are checked as a stream', () => {
  const JSZip = createRequire(import.meta.url)('../../../vendor/jszip.min.js');
  async function* split(data: Buffer, size: number) { for (let offset = 0; offset < data.length; offset += size) yield data.subarray(offset, offset + size); }
  const viaStream = (filename: string, data: Buffer, size = 97) => validateUploadedStream({ filename, totalSize: data.length, head: data.subarray(0, 8192),
    open: () => split(data, size), maxSizeBytes: 50 * 1024 * 1024 });

  it('detects Office packages from a chunked stream exactly like from a buffer', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    zip.file('content.xml', '<?xml version="1.0"?><document/>');
    zip.file('padding.bin', Buffer.alloc(200_000, 1));
    const odt = await zip.generateAsync({ type: 'nodebuffer' });
    const streamed = await viaStream('Brief.odt', odt);
    const buffered = await validateUploadedFile({ filename: 'Brief.odt', declaredMimeType: '', data: odt, maxSizeBytes: 50 * 1024 * 1024 });
    expect(streamed).toEqual({ safeFilename: 'Brief.odt', mimeType: buffered.mimeType, sizeBytes: odt.length });
  });

  it('still rejects disguised executables, scripts and spoofed extensions', async () => {
    await expect(viaStream('report.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(5000)]))).rejects.toMatchObject({ message: 'blocked_executable_content' });
    await expect(viaStream('notes.txt', Buffer.from('<script>alert(1)</script>'))).rejects.toMatchObject({ message: 'blocked_script_content' });
    await expect(viaStream('slides.pptx', Buffer.from('not an office file at all'))).rejects.toMatchObject({ message: 'content_mismatch' });
    await expect(validateUploadedStream({ filename: 'big.txt', totalSize: 51 * 1024 * 1024, head: Buffer.from('x'), open: () => split(Buffer.from('x'), 1), maxSizeBytes: 50 * 1024 * 1024 }))
      .rejects.toMatchObject({ message: 'file_too_large' });
  });

  it('streams every chunk to clamd (INSTREAM) and reads the verdict', async () => {
    for (const verdict of ['stream: OK', 'stream: Eicar-Test-Signature FOUND']) {
      const received: Buffer[] = [];
      const server = createServer(socket => {
        let buffer = Buffer.alloc(0);
        socket.on('data', chunk => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!buffer.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
          // Erst auswerten, wenn der Null-Laenge-Block (Ende) vollstaendig angekommen ist.
          const parts: Buffer[] = [];
          let offset = 10;
          while (buffer.length >= offset + 4) {
            const length = buffer.readUInt32BE(offset);
            if (length === 0) { received.push(...parts); socket.end(verdict); return; }
            if (buffer.length < offset + 4 + length) return;
            parts.push(buffer.subarray(offset + 4, offset + 4 + length));
            offset += 4 + length;
          }
        });
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const data = Buffer.alloc(300_000, 7); data.write('marker-at-the-end', data.length - 20);
        const result = await scanBuffer('127.0.0.1', (server.address() as AddressInfo).port, split(data, 50_000));
        expect(result.clean).toBe(verdict.endsWith('OK'));
        const joined = Buffer.concat(received);
        expect(createHash('sha256').update(joined).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'));
        expect(Math.max(...received.map(part => part.length))).toBeLessThanOrEqual(64 * 1024);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  });
});

describe('R-31: build context and runtime image', () => {
  it('sends only an allowlist to the Docker daemon -- never keys, backups or .env files', () => {
    const lines = read('.dockerignore').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    expect(lines[0]).toBe('*');
    const allowed = lines.filter(line => line.startsWith('!'));
    expect(allowed.some(line => /^!(ops|\.git|\.env)/.test(line))).toBe(false);
    for (const rule of ['**/.env', '**/.env.*', '**/*.kek', '**/node_modules']) expect(lines).toContain(rule);
  });

  it('copies production dependencies from an --omit=dev stage', () => {
    const dockerfile = read('ops/docker/Dockerfile.server');
    expect(dockerfile).toMatch(/AS deps[\s\S]*npm ci --omit=dev/);
    expect(dockerfile).toContain('COPY --from=deps /build/node_modules ./node_modules');
    expect(dockerfile).not.toContain('COPY --from=build /build/node_modules');
    expect(dockerfile).not.toMatch(/^COPY apps\/server \.\/apps\/server$/m);
  });
});

describe('personal data export (GDPR Art. 15/20)', () => {
  const enc = (value: string, tableName: string, recordId: string, fieldName: string) =>
    fieldCipher.encryptField(value, testDek(), { installationId: 'inst', tableName, recordId, fieldName });
  // Fake mit Filterung nach '=' / 'in' und Ketten fuer orderBy/limit; liefert absichtlich ALLE Spalten.
  function exportDb(tables: Record<string, any[]>) {
    return {
      selectFrom: (table: string) => {
        const where: Array<[string, string, unknown]> = [];
        const chain: any = { select: () => chain, orderBy: () => chain, limit: () => chain,
          where: (key: string, op: string, value: unknown) => { where.push([key, op, value]); return chain; },
          execute: async () => (tables[table] || []).filter(row => where.every(([key, op, value]) => op === 'in' ? (value as unknown[]).includes(row[key]) : row[key] === value)) };
        return chain;
      }
    } as any;
  }
  const tables = {
    users: [{ id: 'u1', username: 'alice', role: 'user', name_enc: enc('Alice Example', 'users', 'u1', 'name'), email_enc: enc('alice@example.org', 'users', 'u1', 'email'),
      password_hash: 'ARGON-SECRET-HASH', totp_secret_enc: enc('TOTP-SECRET', 'users', 'u1', 'totp_secret'), email_blind_idx: 'BLIND-INDEX', created_at: new Date('2026-01-01T00:00:00Z') },
    { id: 'u2', username: 'bob', role: 'user', name_enc: enc('Bob Other', 'users', 'u2', 'name'), email_enc: enc('bob@example.org', 'users', 'u2', 'email') }],
    tickets: [{ id: 't1', created_by_user_id: 'u1', ticket_number: 'T-1', title: enc('Drucker defekt', 'tickets', 't1', 'title'), description: enc('Papierstau', 'tickets', 't1', 'description') },
      { id: 't2', created_by_user_id: 'u2', ticket_number: 'T-2', title: enc('Fremdes Ticket', 'tickets', 't2', 'title') }],
    ticket_messages: [{ id: 'm1', ticket_id: 't1', sender_user_id: 's1', sender_username: 'support', sender_role: 'admin', content: enc('Wir kuemmern uns', 'ticket_messages', 'm1', 'content') },
      { id: 'm2', ticket_id: 't2', sender_user_id: 'u2', sender_username: 'bob', sender_role: 'user', content: enc('Privat von Bob', 'ticket_messages', 'm2', 'content') }],
    ticket_notes: [{ id: 'n1', ticket_id: 't1', content: enc('Interne Notiz', 'ticket_notes', 'n1', 'content') }],
    sessions: [{ user_id: 'u1', ip_address: '192.0.2.1', user_agent: 'Firefox', created_at: new Date() }],
    mfa_devices: [{ user_id: 'u1', token_hash: 'DEVICE-TOKEN-HASH', verified_at: new Date() }],
    admin_todo_time_entries: [
      { id: 'own-time', todo_id: 'todo', user_id: 'u1', minutes: 12, note_enc: enc('Own todo activity', 'admin_todo_time_entries', 'own-time', 'note') },
      { id: 'foreign-time', todo_id: 'todo', user_id: 'u2', minutes: 99, note_enc: enc('Foreign todo activity', 'admin_todo_time_entries', 'foreign-time', 'note') }
    ]
  };

  it('exports everything of the person, decrypted -- and nothing secret or foreign', async () => {
    const data = await buildPersonalDataExport({ db: exportDb(tables), keyProvider: {} as any, installationId: 'inst' }, 'u1') as any;
    expect(data.account).toMatchObject({ username: 'alice', name: 'Alice Example', email: 'alice@example.org' });
    expect(data.tickets.map((ticket: any) => ticket.title)).toEqual(['Drucker defekt']);
    expect(data.ticketConversations.map((message: any) => message.content)).toEqual(['Wir kuemmern uns']);
    expect(data.sessions[0]).toMatchObject({ ip_address: '192.0.2.1' });
    expect(data.personalTodoTimeEntries).toEqual([expect.objectContaining({ id: 'own-time', minutes: 12, note: 'Own todo activity' })]);
    const text = JSON.stringify(data);
    for (const secret of ['ARGON-SECRET-HASH', 'TOTP-SECRET', 'BLIND-INDEX', 'DEVICE-TOKEN-HASH', 'Interne Notiz', 'Fremdes Ticket', 'Privat von Bob', 'Bob Other', 'Foreign todo activity']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('only names tables and columns that exist in the schema', () => {
    for (const section of exportSections()) {
      const table = TABLES.find(entry => entry.name === section.table);
      expect(table, section.table).toBeDefined();
      const columns = new Set(table!.columns.map(([name]) => name));
      for (const column of [section.owner, ...section.columns, ...(section.orderBy ? [section.orderBy] : [])]) expect(columns.has(column), section.table + '.' + column).toBe(true);
    }
  });

  it('never lists secret columns in any section', () => {
    for (const section of exportSections()) for (const column of section.columns) expect(NEVER_EXPORTED.has(column), `${section.table}.${column}`).toBe(false);
  });

  it('requires the password, and for someone else a superadmin with TOTP', async () => {
    const run = async (role: 'user' | 'admin' | 'superadmin', url: string, payload: Record<string, unknown>) => {
      const audit: any[] = [];
      // Jede Kette ist erlaubt (Fehlversuchs-Bremse, Sicherheitsrichtlinie); nur das Protokoll wird mitgeschrieben.
      const chain = (table: string, op: string): any => {
        let values: any;
        const proxy: any = new Proxy({}, { get: (_t, prop) => {
          if (prop === 'then') return undefined;
          if (prop === 'values') return (value: any) => { values = value; return proxy; };
          if (prop === 'execute') return async () => { if (op === 'insert' && table === 'global_audit_log') audit.push(values); return []; };
          if (prop === 'executeTakeFirst') return async () => (table === 'users' ? { id: 'u2' } : undefined);
          if (prop === 'executeTakeFirstOrThrow') return async () => ({ password_hash: 'x', totp_enabled: false, totp_secret_enc: null });
          return () => proxy;
        } });
        return proxy;
      };
      const db: any = { selectFrom: (t: string) => chain(t, 'select'), insertInto: (t: string) => chain(t, 'insert'), updateTable: (t: string) => chain(t, 'update'),
        deleteFrom: (t: string) => chain(t, 'delete'), transaction: () => ({ execute: (fn: any) => fn(db) }) };
      const app = Fastify(); app.decorate('db', db);
      app.addHook('onRequest', async req => { req.ticketSession = { uid: 'u1', username: 'alice', role }; });
      registerPrivacyRoutes(app, { env: { INSTALLATION_ID: 'inst' } as any, keyProvider: {} as any });
      try { const response = await app.inject({ method: 'POST', url, payload }); return { response, audit }; } finally { await app.close(); }
    };
    expect((await run('user', '/api/v2/users/me/export', {})).response.statusCode).toBe(401);
    expect((await run('user', '/api/v2/users/me/export', { password: 'wrong' })).response.json().error).toBe('wrong_password');
    const own = await run('user', '/api/v2/users/me/export', { password: 'correct-password' });
    expect(own.response.statusCode).toBe(200);
    expect(own.response.headers['content-disposition']).toMatch(/^attachment; filename="personenbezogene-daten-/);
    expect(own.response.headers['cache-control']).toBe('no-store');
    expect(own.audit).toMatchObject([{ action: 'privacy.export_self', target_id: 'u1' }]);
    expect((await run('admin', '/api/v2/users/u2/export', { password: 'correct-password' })).response.statusCode).toBe(403);
    const withoutMfa = await run('superadmin', '/api/v2/users/u2/export', { password: 'correct-password' });
    expect(withoutMfa.response.json().error).toBe('mfa_required');
    expect(withoutMfa.audit).toEqual([]);
  });
});

describe('vendor libraries match their published checksums', () => {
  it('has a VERSIONS.md entry with the actual SHA-256 for every vendored script', () => {
    const table = read('vendor/VERSIONS.md');
    for (const file of ['lucide.min.js', 'mammoth.browser.min.js', 'xlsx.full.min.js', 'jszip.min.js', 'dompurify.min.js']) {
      const hash = createHash('sha256').update(readFileSync(new URL(`vendor/${file}`, repo))).digest('hex');
      expect(table, file).toMatch(new RegExp(`\\| \`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` \\|[^\\n]*\`${hash}\``));
    }
  });
});
