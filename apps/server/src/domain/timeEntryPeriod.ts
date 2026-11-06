// Zeitraum eines manuell erfassten Zeiteintrags. Ohne Beginn endet der Eintrag jetzt. Ein angegebener
// Beginn darf hoechstens ein Jahr zurueckliegen, und der Zeitraum darf nicht in der Zukunft enden
// (eine Minute Toleranz fuer abweichende Uhren). null = ungueltiger Zeitraum.
const MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export function manualTimeEntryPeriod(minutes: number, startedAt: string | undefined, now: Date) {
  const duration = minutes * 60 * 1000;
  if (!startedAt) return { started_at: new Date(now.getTime() - duration), ended_at: now };
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime()) || start.getTime() < now.getTime() - MAX_AGE_MS) return null;
  const end = new Date(start.getTime() + duration);
  return end.getTime() > now.getTime() + CLOCK_SKEW_MS ? null : { started_at: start, ended_at: end };
}
