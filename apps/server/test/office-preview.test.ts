import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertOfficePreview, discardOfficePreview } from '../src/documents/officePreview.js';

afterEach(() => vi.unstubAllGlobals());
describe('local office conversion', () => {
  it('uploads only document bytes, preserves whole sheets and coalesces duplicate conversions', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('%PDF-1.7\nlocal preview', { headers: { 'content-type': 'application/pdf' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await Promise.all([
      convertOfficePreview('cache-test', 'Protocol.xlsx', Buffer.from('document'), 'http://office:3000'),
      convertOfficePreview('cache-test', 'Protocol.xlsx', Buffer.from('document'), 'http://office:3000')
    ]);
    expect(result[0].toString()).toContain('%PDF-'); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://office:3000/forms/libreoffice/convert');
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('singlePageSheets')).toBe('true');
    expect((form.get('files') as File).name).toBe('document.xlsx');
    expect(form.get('downloadFrom')).toBeNull();
    discardOfficePreview('cache-test');
    await convertOfficePreview('cache-test', 'Protocol.xlsx', Buffer.from('document'), 'http://office:3000');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    discardOfficePreview('cache-test');
  });
  it('rejects invalid output and reports conversion failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>')));
    await expect(convertOfficePreview('bad-pdf', 'Doc.docx', Buffer.from('doc'), 'http://office:3000')).rejects.toMatchObject({ statusCode: 422 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(convertOfficePreview('bad-conversion', 'Doc.docx', Buffer.from('doc'), 'http://office:3000')).rejects.toMatchObject({ statusCode: 422 });
  });
});
