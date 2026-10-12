export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  return new Date(ms).toLocaleDateString(undefined, opts);
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  for (const [u, size] of units) if (abs >= size) return rtf.format(Math.round(diff / size), u);
  return diff < 0 ? 'just now' : 'in a moment';
}

/** Value for <input type="datetime-local"> in the viewer's zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Parses a datetime-local value as local time → UTC epoch ms. */
export function fromLocalInput(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export function dateRange(a: number | null, b: number | null): string {
  if (a == null || b == null) return '';
  const da = new Date(a);
  const db = new Date(b);
  const sameYear = da.getFullYear() === db.getFullYear();
  const sameMonth = sameYear && da.getMonth() === db.getMonth();
  if (sameMonth && da.getDate() === db.getDate()) return formatDate(a);
  if (sameMonth) return `${da.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${db.getDate()}, ${db.getFullYear()}`;
  if (sameYear) return `${da.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${db.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return `${formatDate(a)} – ${formatDate(b)}`;
}

/** First letter of up to two words, ignoring punctuation and emoji ("Arka (admin)" → "AA"). */
export function initials(name: string): string {
  const letters = name.split(/\s+/).map((w) => w.match(/\p{L}|\p{N}/u)?.[0]).filter((c): c is string => !!c);
  return letters.slice(0, 2).join('').toUpperCase() || '?';
}

export function randomRequestId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function seen(key: string): boolean {
  try {
    return localStorage.getItem(`filmroll:${key}`) === '1';
  } catch {
    return false;
  }
}
export function markSeen(key: string) {
  try {
    localStorage.setItem(`filmroll:${key}`, '1');
  } catch {
    /* private mode */
  }
}
