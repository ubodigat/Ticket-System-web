// Stdout/Docker logs must not become a second, unbounded store for personal data.
export function safeRequestLog(req: { method?: string | undefined; url?: string | undefined; routeOptions?: { url?: string | undefined } | undefined }) {
  const url = String(req.routeOptions?.url || req.url || '').split(/[?#]/, 1)[0] || '/';
  return { method: req.method || '', url };
}

export function safeErrorLog(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; statusCode?: unknown; stack?: unknown } | null;
  // Driver messages and SQL may include actual profile values, filenames or credentials.
  // Keep the error class/code and call sites, never the message, SQL or nested cause.
  return {
    type: typeof value?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.name) ? value.name : 'Error',
    message: 'Details omitted from diagnostic log',
    code: typeof value?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code) ? value.code : undefined,
    statusCode: typeof value?.statusCode === 'number' ? value.statusCode : undefined,
    stack: typeof value?.stack === 'string' ? value.stack.split('\n').filter(line => /^\s+at /.test(line)).join('\n') : ''
  };
}
