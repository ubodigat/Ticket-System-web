const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

export function isValidAccountDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1000-01-01';
}

export function isAccountExpired(value: Date | string | null | undefined, now = new Date()): boolean {
  if (value == null) return false;
  const date = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '') : value;
  if (!isValidAccountDate(date)) return true;
  const parts = calendar.formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return date < `${part('year')}-${part('month')}-${part('day')}`;
}
