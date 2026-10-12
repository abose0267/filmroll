/**
 * Owner-only analytics. Access is checked on the server for every call:
 * the caller's verified sign-in email must be listed in ADMIN_EMAILS
 * (functions/.env.<project>, kept out of git).
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from './admin';
import { REGION } from './config';
import { DAY, requireAuth } from './util';
import type { Query } from 'firebase-admin/firestore';

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(req: CallableRequest): boolean {
  const token = req.auth?.token;
  const email = (token?.email ?? '').toLowerCase();
  // Email/password accounts in the emulator are never "verified"; in production require it.
  const verified = token?.email_verified === true || process.env.FUNCTIONS_EMULATOR === 'true';
  return !!email && verified && adminEmails().includes(email);
}

export const amIAdmin = onCall({ region: REGION }, async (req) => {
  requireAuth(req);
  return { admin: isAdmin(req) };
});

const count = async (q: Query) => (await q.count().get()).data().count;

/** YYYY-MM-DD in US Central time (the owner's time zone) for daily charts. */
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

function series(times: number[], days: number, now: number) {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(now - i * DAY), 0);
  for (const t of times) {
    const k = dayKey(t);
    if (buckets.has(k)) buckets.set(k, buckets.get(k)! + 1);
  }
  return [...buckets].map(([day, n]) => ({ day, n }));
}

function tally<T extends string | number>(values: T[]) {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key: String(key), n })).sort((a, b) => b.n - a.n);
}

export const getAnalytics = onCall({ region: REGION, memory: '512MiB' }, async (req) => {
  requireAuth(req);
  if (!isAdmin(req)) throw new HttpsError('permission-denied', 'Not available.');
  const now = Date.now();
  const since30 = now - 30 * DAY;
  const since7 = now - 7 * DAY;
  const rolls = db.collectionGroup('rolls');

  const [users, groups, rollCount, photos, comments, reactions, active, developing, developed, cancelled] = await Promise.all([
    count(db.collection('users')),
    count(db.collection('groups')),
    count(rolls),
    count(db.collectionGroup('photos')),
    count(db.collectionGroup('comments')),
    count(db.collectionGroup('reactions')),
    ...(['active', 'developing', 'developed', 'cancelled'] as const).map((s) => count(rolls.where('status', '==', s))),
  ]);

  const [signups, shots, recentComments, rollDocs, groupDocs, recentUsers] = await Promise.all([
    db.collection('users').where('createdAt', '>=', since30).select('createdAt').get(),
    db.collectionGroup('photos').where('createdAt', '>=', since30).select('createdAt', 'uid').get(),
    db.collectionGroup('comments').where('createdAt', '>=', since30).select('createdAt').get(),
    rolls.select('status', 'preset', 'capacity', 'developMode', 'exposuresUsed', 'contributors', 'createdAt', 'developedAt').limit(3000).get(),
    db.collection('groups').select('memberCount', 'rollCount', 'developedCount').limit(3000).get(),
    db.collection('users').orderBy('createdAt', 'desc').limit(10).select('displayName', 'createdAt', 'groupIds', 'onboarded').get(),
  ]);

  const shotData = shots.docs.map((d) => d.data() as { createdAt: number; uid: string });
  const rd = rollDocs.docs.map((d) => d.data() as { status: string; preset: string; capacity: number; developMode: string; exposuresUsed: number; contributors?: Record<string, number>; createdAt: number; developedAt: number | null });
  const dev = rd.filter((r) => r.status === 'developed');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const gd = groupDocs.docs.map((d) => d.data() as { memberCount: number; rollCount: number; developedCount: number });

  return {
    generatedAt: now,
    totals: { users, groups, rolls: rollCount, photos, comments, reactions },
    rollsByStatus: { active, developing, developed, cancelled },
    activity: {
      signups30: signups.size,
      shots30: shots.size,
      comments30: recentComments.size,
      photographers7: new Set(shotData.filter((s) => s.createdAt >= since7).map((s) => s.uid)).size,
      photographers30: new Set(shotData.map((s) => s.uid)).size,
    },
    daily: {
      signups: series(signups.docs.map((d) => d.data().createdAt as number), 30, now),
      shots: series(shotData.map((s) => s.createdAt), 30, now),
      comments: series(recentComments.docs.map((d) => d.data().createdAt as number), 30, now),
    },
    rolls: {
      avgFill: avg(dev.map((r) => r.exposuresUsed / r.capacity)),
      avgPhotos: avg(dev.map((r) => r.exposuresUsed)),
      avgPhotographers: avg(dev.map((r) => Object.values(r.contributors ?? {}).filter((n) => n > 0).length)),
      avgDaysToDevelop: avg(dev.filter((r) => r.developedAt).map((r) => (r.developedAt! - r.createdAt) / DAY)),
      emptyDeveloped: dev.filter((r) => r.exposuresUsed === 0).length,
      presets: tally(rd.map((r) => r.preset)),
      capacities: tally(rd.map((r) => r.capacity)),
      developModes: tally(rd.map((r) => r.developMode)),
    },
    groups: {
      avgMembers: avg(gd.map((g) => g.memberCount)),
      withActiveOrPastRoll: gd.filter((g) => g.rollCount > 0).length,
      sizes: tally(gd.map((g) => (g.memberCount >= 6 ? '6+' : String(g.memberCount)))),
    },
    recentSignups: recentUsers.docs.map((d) => {
      const u = d.data() as { displayName: string; createdAt: number; groupIds?: string[]; onboarded?: boolean };
      return { name: u.displayName, createdAt: u.createdAt, groups: (u.groupIds ?? []).length, onboarded: !!u.onboarded };
    }),
  };
});
