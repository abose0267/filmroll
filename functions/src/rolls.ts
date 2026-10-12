import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Transaction } from 'firebase-admin/firestore';
import { endOfMonthEvening, isValidTimeZone, monthKey, monthName, zonedParts } from '@shared/time';
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
    if (await hasRollInCamera(tx, gid, group)) throw new HttpsError('failed-precondition', 'This group already has a roll in the camera. Finish it first!');
    loadRoll(tx, gid, rid, { name, capacity: capacity as RollDoc['capacity'], preset, dateStamp, developMode, developAt }, uid, now);
    return group;
  });
  const others = (await memberIds(gid)).filter((m) => m !== uid);
  await notify(others, { kind: 'rollStarted', title: `A new roll has started in ${g.name}`, body: `“${name}” — ${capacity} exposures. Capture something from your day.`, groupId: gid, rollId: rid, link: `/g/${gid}` });
  return { rollId: rid };
});

/** MVP: one active roll per group. The data model allows more (rolls are a collection). */
async function hasRollInCamera(tx: Transaction, gid: string, group: GroupDoc): Promise<boolean> {
  if (!group.activeRollId) return false;
  const cur = await tx.get(rollRef(gid, group.activeRollId));
  const status = (cur.data() as RollDoc | undefined)?.status;
  return status === 'active' || status === 'developing';
}

type RollConfig = Pick<RollDoc, 'name' | 'capacity' | 'preset' | 'dateStamp' | 'developMode' | 'developAt'>;

/** Writes a fresh roll and makes it the group's active one (inside a transaction, after all reads). */
function loadRoll(tx: Transaction, gid: string, rid: string, c: RollConfig, createdBy: string, now: number, extra: Record<string, unknown> = {}) {
  const roll: RollDoc = {
    id: rid, groupId: gid, ...c, status: 'active', createdBy, createdAt: now, exposuresUsed: 0, exposuresReserved: 0, contributors: {},
    developingSince: null, developedAt: null, coverPhotoIds: [], firstShotAt: null, lastShotAt: null, milestones: [],
  };
  tx.set(rollRef(gid, rid), roll);
  tx.update(groupRef(gid), { activeRollId: rid, rollCount: FieldValue.increment(1), ...extra });
}

/**
 * Monthly roll: loads "November 2026" on the 1st (from 9am, group time) that
 * develops on the month's last evening. When turned on mid-month with at least
 * 3 days left, it starts right away. Skips a month if a roll is already loaded.
 */
export async function maybeLoadMonthlyRoll(gid: string, now = Date.now(), { midMonth = false } = {}): Promise<string | null> {
  const result = await db.runTransaction(async (tx) => {
    const gSnap = await tx.get(groupRef(gid));
    const group = gSnap.data() as GroupDoc | undefined;
    const auto = group?.settings.autoRoll;
    if (!group || !auto?.enabled || !isValidTimeZone(auto.timeZone)) return null;
    const key = monthKey(now, auto.timeZone);
    if (group.autoRollMonth === key) return null;
    const local = zonedParts(now, auto.timeZone);
    const developAt = endOfMonthEvening(now, auto.timeZone);
    const due = midMonth ? developAt - now >= 3 * DAY : local.d <= 3 && (local.d > 1 || local.h >= 9);
    if (!due) return null;
    if (await hasRollInCamera(tx, gid, group)) {
      tx.update(groupRef(gid), { autoRollMonth: key }); // a roll is already loaded: skip this month
      return null;
    }
    const rid = newId();
    loadRoll(tx, gid, rid, { name: monthName(now, auto.timeZone), capacity: auto.capacity, preset: auto.preset, dateStamp: true, developMode: 'either', developAt }, group.ownerId, now, { autoRollMonth: key });
    return { rid, group, name: monthName(now, auto.timeZone), capacity: auto.capacity };
  });
  if (!result) return null;
  await notify(await memberIds(gid), { kind: 'rollStarted', title: `${result.name} is loaded in ${result.group.name}`, body: `Your monthly roll — ${result.capacity} exposures, developing on the last evening of the month.`, groupId: gid, rollId: result.rid, link: `/g/${gid}` });
  return result.rid;
}

export async function runMonthlyRolls(now = Date.now()): Promise<number> {
  const groups = await db.collection('groups').where('settings.autoRoll.enabled', '==', true).select().get();
  let loaded = 0;
  for (const g of groups.docs) if (await maybeLoadMonthlyRoll(g.id, now).catch((e) => console.warn('monthly roll', g.id, e))) loaded++;
  return loaded;
}

/** Hourly so every group's 9am on the 1st is covered, whatever its time zone. */
export const monthlyRolls = onSchedule({ region: REGION, schedule: 'every 1 hours', timeZone: 'UTC' }, async () => {
  const n = await runMonthlyRolls();
  if (n) console.log('monthly rolls loaded', n);
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

