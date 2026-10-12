/**
 * Lightweight memory resurfacing for the archive: anniversaries of developed
 * rolls and the group's first roll. Pure, computed from rolls the viewer can
 * already read — it never widens access.
 */
import type { RollDoc } from './types';

export interface Resurfaced {
  rollId: string;
  groupId: string;
  kind: 'anniversary' | 'first' | 'season';
  title: string;
  years?: number;
}

const DAY = 86_400_000;

function dayOfYear(ms: number, timeZone?: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n('year'), m: n('month'), d: n('day') };
}

/**
 * Picks at most `limit` memories to show today.
 * - Anniversary: developed within ±`windowDays` of today's month/day in an earlier year.
 * - First: the group's first developed roll, if it's at least 30 days old.
 * - Season: "Remember last summer?" for a roll whose shots were mostly in June–August of last year (shown in summer).
 */
export function resurface(rolls: Pick<RollDoc, 'id' | 'groupId' | 'name' | 'status' | 'developedAt' | 'firstShotAt' | 'lastShotAt'>[], now: number, opts: { windowDays?: number; limit?: number; timeZone?: string } = {}): Resurfaced[] {
  const windowDays = opts.windowDays ?? 3;
  const limit = opts.limit ?? 3;
  const developed = rolls.filter((r) => r.status === 'developed' && r.developedAt != null).sort((a, b) => a.developedAt! - b.developedAt!);
  const today = dayOfYear(now, opts.timeZone);
  const out: Resurfaced[] = [];
  const seen = new Set<string>();

  for (const r of developed) {
    const d = dayOfYear(r.developedAt!, opts.timeZone);
    const years = today.y - d.y;
    if (years < 1) continue;
    // compare month/day on the same (current) year to measure distance in days
    const thisYear = Date.UTC(today.y, d.m - 1, d.d);
    const todayUtc = Date.UTC(today.y, today.m - 1, today.d);
    if (Math.abs(thisYear - todayUtc) <= windowDays * DAY) {
      out.push({ rollId: r.id, groupId: r.groupId, kind: 'anniversary', years, title: years === 1 ? 'One year ago, your group developed this roll.' : `${years} years ago, your group developed this roll.` });
      seen.add(r.id);
    }
  }

  const byGroup = new Map<string, typeof developed>();
  for (const r of developed) byGroup.set(r.groupId, [...(byGroup.get(r.groupId) ?? []), r]);
  for (const [, list] of byGroup) {
    const first = list[0];
    if (list.length >= 2 && !seen.has(first.id) && now - first.developedAt! >= 30 * DAY) {
      out.push({ rollId: first.id, groupId: first.groupId, kind: 'first', title: 'Your first FilmRoll together.' });
      seen.add(first.id);
    }
  }

  if (today.m >= 6 && today.m <= 8) {
    for (const r of developed) {
      if (seen.has(r.id) || r.firstShotAt == null || r.lastShotAt == null) continue;
      const mid = dayOfYear((r.firstShotAt + r.lastShotAt) / 2, opts.timeZone);
      if (mid.y === today.y - 1 && mid.m >= 6 && mid.m <= 8) {
        out.push({ rollId: r.id, groupId: r.groupId, kind: 'season', title: 'Remember last summer?' });
        seen.add(r.id);
      }
    }
  }
  return out.slice(0, limit);
}
