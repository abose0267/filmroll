/**
 * Time-zone helpers without a date library (Intl only), shared by the app and
 * Cloud Functions. All stored times are UTC epoch ms.
 */

/** Calendar parts of `ms` in `timeZone`. */
export function zonedParts(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour'), min: n('minute') };
}

/** UTC ms for a wall-clock time in `timeZone` (handles DST by correcting the offset twice). */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += wanted - shown;
  }
  return guess;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "YYYY-MM" of `ms` in `timeZone`. */
export function monthKey(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

/** e.g. "November 2026". */
export function monthName(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone });
}

/** 8pm on the last day of the month containing `ms`, in `timeZone`, as UTC ms. */
export function endOfMonthEvening(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return zonedTimeToUtc(p.y, p.m, daysInMonth(p.y, p.m), 20, 0, timeZone);
}
