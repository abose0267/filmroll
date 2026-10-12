/**
 * Trusted roll state transitions. Every status change goes through
 * `advanceRoll`, which re-checks the condition inside a transaction so
 * concurrent callers (sweeper + last finalization) can't double-develop.
 */
import { FieldValue, db, groupRef, photosCol, rollRef } from './admin';
import { notify, memberIds } from './notify';
import { assertTransition, nextStatus } from '@shared/rolls';
import type { GroupDoc, PhotoDoc, RollDoc, RollStatus } from '@shared/types';

/** Picks up to 4 cover frames, preferring different photographers, spread across the roll. */
export function pickCover(photos: Pick<PhotoDoc, 'id' | 'uid' | 'frame'>[]): string[] {
  const sorted = [...photos].sort((a, b) => a.frame - b.frame);
  const out: string[] = [];
  const used = new Set<string>();
  for (const p of sorted) {
    if (out.length >= 4) break;
    if (!used.has(p.uid)) {
      out.push(p.id);
      used.add(p.uid);
    }
  }
  for (const p of sorted) {
    if (out.length >= 4) break;
    if (!out.includes(p.id)) out.push(p.id);
  }
  return out;
}

export async function advanceRoll(gid: string, rid: string, now = Date.now()): Promise<RollStatus | null> {
  const result = await db.runTransaction(async (tx) => {
    const ref = rollRef(gid, rid);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const roll = snap.data() as RollDoc;
    const to = nextStatus(roll, now);
    if (!to) return null;
    assertTransition(roll.status, to);
    if (to === 'developing') {
      tx.update(ref, { status: 'developing', developingSince: now });
      return { to, roll };
    }
    const photos = (await tx.get(photosCol(gid, rid).select('uid', 'frame', 'capturedAt'))).docs.map((d) => ({ id: d.id, ...(d.data() as Pick<PhotoDoc, 'uid' | 'frame' | 'capturedAt'>) }));
    const g = await tx.get(groupRef(gid));
    const shots = photos.map((p) => p.capturedAt);
    tx.update(ref, {
      status: 'developed',
      developedAt: now,
      developingSince: roll.developingSince ?? null,
      // late reservations can no longer finalize; they are cleaned up by the sweeper
      exposuresReserved: 0,
      coverPhotoIds: pickCover(photos),
      firstShotAt: shots.length ? Math.min(...shots) : null,
      lastShotAt: shots.length ? Math.max(...shots) : null,
    });
    if (g.exists) {
      const upd: Record<string, unknown> = { developedCount: FieldValue.increment(1) };
      if ((g.data() as GroupDoc).activeRollId === rid) upd.activeRollId = null;
      tx.update(groupRef(gid), upd);
    }
    return { to, roll, groupName: (g.data() as GroupDoc | undefined)?.name ?? 'your group', count: photos.length };
  });
  if (!result) return null;
  if (result.to === 'developed') {
    const r = result as { roll: RollDoc; groupName: string; count: number };
    await notify(await memberIds(gid), {
      kind: 'developed',
      title: `Your ${r.roll.name} roll is developed!`,
      body: r.count ? `${r.count} ${r.count === 1 ? 'memory' : 'memories'} from ${r.groupName} are ready to see.` : 'Nobody took a shot this time — start a new roll?',
      groupId: gid,
      rollId: rid,
      link: `/g/${gid}/r/${rid}`,
    });
  }
  return result.to;
}
