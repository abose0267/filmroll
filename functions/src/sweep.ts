/**
 * Scheduled sweeper: develops rolls whose date has arrived (no client needs to
 * be online), finishes `developing` rolls, releases expired reservations and
 * removes abandoned uploads.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { bucket, db } from './admin';
import { REGION } from './config';
import { advanceRoll } from './develop';
import { expireReservation } from './exposures';
import { RESERVATION_TTL_MS } from '@shared/constants';
import type { ReservationDoc, RollDoc } from '@shared/types';

export interface SweepResult {
  expired: number;
  advanced: { rollId: string; to: string }[];
  orphanUploads: number;
}

export async function runSweep(now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { expired: 0, advanced: [], orphanUploads: 0 };

  const stale = await db.collectionGroup('reservations').where('status', '==', 'pending').where('expiresAt', '<=', now).limit(500).get();
  for (const d of stale.docs) {
    const r = d.data() as ReservationDoc;
    if (await expireReservation(r.groupId, r.rollId, r.id)) out.expired++;
  }

  const [due, developing] = await Promise.all([
    db.collectionGroup('rolls').where('status', '==', 'active').where('developAt', '<=', now).limit(500).get(),
    db.collectionGroup('rolls').where('status', '==', 'developing').limit(500).get(),
  ]);
  for (const d of [...due.docs, ...developing.docs]) {
    const r = d.data() as RollDoc;
    const to = await advanceRoll(r.groupId, r.id, now);
    if (to) out.advanced.push({ rollId: r.id, to });
  }

  // Anything still in uploads/ long after every reservation would have expired is abandoned.
  const [files] = await bucket().getFiles({ prefix: 'uploads/', maxResults: 1000 });
  const cutoff = now - RESERVATION_TTL_MS * 2;
  for (const f of files) {
    const created = Date.parse(String(f.metadata.timeCreated ?? ''));
    if (Number.isFinite(created) && created < cutoff) {
      await f.delete().catch(() => undefined);
      out.orphanUploads++;
    }
  }
  return out;
}

export const sweepRolls = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'UTC' }, async () => {
  const r = await runSweep();
  if (r.expired || r.advanced.length || r.orphanUploads) console.log('sweep', JSON.stringify(r));
});
