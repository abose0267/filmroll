import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, db, groupRef, rollRef } from './admin';
import { REGION } from './config';
import { DAY, docId, isAdmin, newId, rateLimit, requireAuth, requireMember } from './util';
import { notify, memberIds } from './notify';
import { LIMITS } from '@shared/constants';
import { isPresetId } from '@shared/presets';
import { developsOnDate, rollConfigError } from '@shared/rolls';
import { cleanText } from '@shared/validation';
import type { DevelopMode, GroupDoc, RollDoc } from '@shared/types';

const opts = { region: REGION };

export const startRoll = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  await rateLimit(`startRoll_${uid}`, 20, DAY, 'That’s a lot of new rolls today. Try again tomorrow.');
  const now = Date.now();
  const name = cleanText(req.data?.name, LIMITS.rollName);
  const capacity = Number(req.data?.capacity);
  const developMode = req.data?.developMode as DevelopMode;
  const developAt = developsOnDate(developMode) ? Number(req.data?.developAt) : null;
  const err = rollConfigError({ name, capacity, developMode, developAt }, now, LIMITS.rollName);
  if (err) throw new HttpsError('invalid-argument', err);
  const preset = isPresetId(req.data?.preset) ? req.data.preset : 'classic35';
  const dateStamp = req.data?.dateStamp !== false;

  const rid = newId();
  const g = await db.runTransaction(async (tx) => {
    const gSnap = await tx.get(groupRef(gid));
    const group = gSnap.data() as GroupDoc;
    if (group.settings.rollCreators === 'admins' && !isAdmin(member)) throw new HttpsError('permission-denied', 'Only admins can start rolls in this group.');
    // MVP: one active roll per group. The data model allows more (rolls are a collection).
    if (group.activeRollId) {
      const cur = await tx.get(rollRef(gid, group.activeRollId));
      const status = (cur.data() as RollDoc | undefined)?.status;
      if (status === 'active' || status === 'developing') throw new HttpsError('failed-precondition', 'This group already has a roll in the camera. Finish it first!');
    }
    const roll: RollDoc = {
      id: rid, groupId: gid, name, capacity: capacity as RollDoc['capacity'], preset, dateStamp, developMode, developAt,
      status: 'active', createdBy: uid, createdAt: now, exposuresUsed: 0, exposuresReserved: 0, contributors: {},
      developingSince: null, developedAt: null, coverPhotoIds: [], firstShotAt: null, lastShotAt: null, milestones: [],
    };
    tx.set(rollRef(gid, rid), roll);
    tx.update(groupRef(gid), { activeRollId: rid, rollCount: FieldValue.increment(1) });
    return group;
  });
  const others = (await memberIds(gid)).filter((m) => m !== uid);
  await notify(others, { kind: 'rollStarted', title: `A new roll has started in ${g.name}`, body: `“${name}” — ${capacity} exposures. Capture something from your day.`, groupId: gid, rollId: rid, link: `/g/${gid}` });
  return { rollId: rid };
});

/** Admins may rename a roll or move its development date while it's active. Capacity and film never change. */
export const updateRoll = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rollRef(gid, rid));
    const roll = snap.data() as RollDoc | undefined;
    if (!roll) throw new HttpsError('not-found', 'Roll not found.');
    if (!isAdmin(member) && roll.createdBy !== uid) throw new HttpsError('permission-denied', 'Only admins or the roll’s creator can change it.');
    if (roll.status !== 'active') throw new HttpsError('failed-precondition', 'This roll can no longer be changed.');
    const name = req.data?.name !== undefined ? cleanText(req.data.name, LIMITS.rollName) : roll.name;
    const developAt = req.data?.developAt !== undefined && developsOnDate(roll.developMode) ? Number(req.data.developAt) : roll.developAt;
    const err = rollConfigError({ name, capacity: roll.capacity, developMode: roll.developMode, developAt }, Date.now(), LIMITS.rollName);
    if (err) throw new HttpsError('invalid-argument', err);
    tx.update(rollRef(gid, rid), { name, developAt });
  });
  return { ok: true };
});

/** Only empty rolls can be cancelled, so nobody's hidden photos are ever thrown away. */
export const cancelRoll = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rollRef(gid, rid));
    const roll = snap.data() as RollDoc | undefined;
    if (!roll) throw new HttpsError('not-found', 'Roll not found.');
    if (!isAdmin(member) && roll.createdBy !== uid) throw new HttpsError('permission-denied', 'Only admins or the roll’s creator can cancel it.');
    if (roll.status !== 'active') throw new HttpsError('failed-precondition', 'This roll can no longer be cancelled.');
    if (roll.exposuresUsed > 0 || roll.exposuresReserved > 0) throw new HttpsError('failed-precondition', 'Friends have already shot on this roll, so it can’t be cancelled.');
    const g = (await tx.get(groupRef(gid))).data() as GroupDoc;
    tx.update(rollRef(gid, rid), { status: 'cancelled' });
    if (g.activeRollId === rid) tx.update(groupRef(gid), { activeRollId: null });
  });
  return { ok: true };
});

