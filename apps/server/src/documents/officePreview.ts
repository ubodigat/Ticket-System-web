const cache = new Map<string, { data: Buffer; expires: number }>();
const pending = new Map<string, Promise<Buffer>>();
const MAX_PDF_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

export function discardOfficePreview(id: string) {
  const entry = cache.get(id);
  if (entry) { cacheBytes -= entry.data.length; cache.delete(id); }
}

export async function convertOfficePreview(id: string, filename: string, input: Buffer, serviceUrl: string): Promise<Buffer> {
  const previous = cache.get(id);
  if (previous && previous.expires > Date.now()) return previous.data;
  discardOfficePreview(id);
  if (pending.has(id)) return pending.get(id)!;
  if (pending.size >= 2) throw { statusCode: 429, message: 'preview_busy' };
  const conversion = (async () => {
    const form = new FormData();
    const extension = filename.toLowerCase().split('.').pop();
    form.append('files', new Blob([new Uint8Array(input)]), `document.${extension}`);
    // Keep worksheets intact rather than splitting them into narrow printed strips.
    if (['xlsx', 'xls', 'ods'].includes(extension || '')) form.append('singlePageSheets', 'true');
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/forms/libreoffice/convert`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(45000)
    });
    if (!response.ok || !response.body) throw { statusCode: 422, message: 'document_preview_failed' };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PDF_BYTES) { await reader.cancel(); throw { statusCode: 413, message: 'preview_too_large' }; }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, 5).toString() !== '%PDF-') throw { statusCode: 422, message: 'invalid_preview' };
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) discardOfficePreview(key);
    while (cacheBytes + data.length > MAX_PDF_BYTES && cache.size) discardOfficePreview(cache.keys().next().value!);
    cache.set(id, { data, expires: Date.now() + 60000 }); cacheBytes += data.length;
    return data;
  })();
  pending.set(id, conversion);
  try { return await conversion; } finally { pending.delete(id); }
}
