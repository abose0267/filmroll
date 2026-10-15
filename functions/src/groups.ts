import { randomBytes } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { FieldValue, db, groupRef, inviteRef, memberRef, membersCol, userRef, bucket } from './admin';
import { REGION } from './config';
import { HOUR, DAY, docId, newId, rateLimit, requireAdmin, requireAuth, requireMember } from './util';
import { notify } from './notify';
import { CAPACITIES, GROUP_THEMES, LIMITS, MAX_GROUPS_PER_USER, MAX_GROUP_MEMBERS, MEMBER_PREVIEW_SIZE } from '@shared/constants';
import { isPresetId } from '@shared/presets';
import { isValidTimeZone } from '@shared/time';
import { maybeLoadMonthlyRoll } from './rolls';
import { cleanText, groupNameError, inviteCodeFromBytes, normalizeInviteCode } from '@shared/validation';
import type { AutoRollSettings, GroupDoc, GroupInviteDoc, GroupSettings, GroupTheme, MemberDoc, MemberRole, UserDoc } from '@shared/types';
import type { Transaction } from 'firebase-admin/firestore';

const opts = { region: REGION };

function theme(v: unknown): GroupTheme {
  return GROUP_THEMES.some((t) => t.id === v) ? (v as GroupTheme) : 'cream';
}

async function loadUser(uid: string): Promise<UserDoc> {
  const snap = await userRef(uid).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Finish setting up your profile first.');
  return snap.data() as UserDoc;
}

/** Reserves a fresh invite code (retries on the astronomically rare collision). */
async function createInvite(tx: Transaction, gid: string, uid: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = inviteCodeFromBytes(randomBytes(8));
    const ref = inviteRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { code, groupId: gid, createdBy: uid, createdAt: Date.now(), revoked: false } satisfies GroupInviteDoc);
      return code;
    }
  }
  throw new HttpsError('internal', 'Could not create an invite code. Try again.');
}

function preview(members: { uid: string; displayName: string; photoURL: string | null }[]) {
  return members.slice(0, MEMBER_PREVIEW_SIZE).map((m) => ({ uid: m.uid, name: m.displayName, photoURL: m.photoURL }));
}

export const createGroup = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const name = cleanText(req.data?.name, LIMITS.groupName);
  const err = groupNameError(name);
  if (err) throw new HttpsError('invalid-argument', err);
  await rateLimit(`createGroup_${uid}`, 10, DAY, 'You have created a lot of groups today. Try again tomorrow.');
  const user = await loadUser(uid);
  if ((user.groupIds ?? []).length >= MAX_GROUPS_PER_USER) throw new HttpsError('failed-precondition', `You can be in up to ${MAX_GROUPS_PER_USER} groups.`);

  const gid = newId();
  const now = Date.now();
  const code = await db.runTransaction(async (tx) => {
    const c = await createInvite(tx, gid, uid);
    const member: MemberDoc = { uid, role: 'owner', joinedAt: now, displayName: user.displayName, photoURL: user.photoURL, muted: false };
    const group: GroupDoc = {
      id: gid, name, theme: theme(req.data?.theme), ownerId: uid, createdAt: now, memberCount: 1,
      memberPreview: preview([member]), activeRollId: null, rollCount: 0, developedCount: 0,
      settings: { rollCreators: 'everyone', shareHistory: true },
    };
    tx.set(groupRef(gid), group);
    tx.set(groupRef(gid).collection('private').doc('invite'), { code: c, updatedAt: now });
    tx.set(memberRef(gid, uid), member);
    tx.update(userRef(uid), { groupIds: FieldValue.arrayUnion(gid) });
    return c;
  });
  return { groupId: gid, inviteCode: code };
});

/** Lets someone with a code see which group they're joining (name + member count only). */
export const previewInvite = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  await rateLimit(`invitePreview_${uid}`, 40, HOUR, 'Too many invite lookups. Try again later.');
  const code = normalizeInviteCode(String(req.data?.code ?? ''));
  if (!code) throw new HttpsError('invalid-argument', 'That invite code doesn’t look right.');
  const inv = await inviteRef(code).get();
  const data = inv.data() as GroupInviteDoc | undefined;
  if (!data || data.revoked) throw new HttpsError('not-found', 'This invite has expired or doesn’t exist.');
  const g = (await groupRef(data.groupId).get()).data() as GroupDoc | undefined;
  if (!g) throw new HttpsError('not-found', 'This group no longer exists.');
  const already = (await memberRef(g.id, uid).get()).exists;
  return { groupId: g.id, name: g.name, theme: g.theme, memberCount: g.memberCount, alreadyMember: already, memberNames: g.memberPreview.slice(0, 4).map((m) => m.name) };
});

export const joinGroup = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  await rateLimit(`join_${uid}`, 20, HOUR, 'Too many attempts. Try again later.');
  const code = normalizeInviteCode(String(req.data?.code ?? ''));
  if (!code) throw new HttpsError('invalid-argument', 'That invite code doesn’t look right.');
  const user = await loadUser(uid);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const inv = (await tx.get(inviteRef(code))).data() as GroupInviteDoc | undefined;
    if (!inv || inv.revoked) throw new HttpsError('not-found', 'This invite has expired or doesn’t exist.');
    const gRef = groupRef(inv.groupId);
    const [gSnap, mSnap, uSnap] = await Promise.all([tx.get(gRef), tx.get(memberRef(inv.groupId, uid)), tx.get(userRef(uid))]);
    const g = gSnap.data() as GroupDoc | undefined;
    if (!g) throw new HttpsError('not-found', 'This group no longer exists.');
    if (mSnap.exists) return { groupId: g.id, joined: false, name: g.name };
    if (g.memberCount >= MAX_GROUP_MEMBERS) throw new HttpsError('failed-precondition', `Groups can have up to ${MAX_GROUP_MEMBERS} members.`);
    const ids = (uSnap.data() as UserDoc).groupIds ?? [];
    if (ids.length >= MAX_GROUPS_PER_USER) throw new HttpsError('failed-precondition', `You can be in up to ${MAX_GROUPS_PER_USER} groups.`);
    const member: MemberDoc = { uid, role: 'member', joinedAt: now, displayName: user.displayName, photoURL: user.photoURL, muted: false };
    tx.set(memberRef(g.id, uid), member);
    const prev = g.memberPreview.length < MEMBER_PREVIEW_SIZE ? [...g.memberPreview, { uid, name: user.displayName, photoURL: user.photoURL }] : g.memberPreview;
    tx.update(gRef, { memberCount: FieldValue.increment(1), memberPreview: prev });
    tx.update(userRef(uid), { groupIds: FieldValue.arrayUnion(g.id) });
    return { groupId: g.id, joined: true, name: g.name };
  });
  if (result.joined) {
    const others = (await membersCol(result.groupId).select().get()).docs.map((d) => d.id).filter((m) => m !== uid);
    await notify(others, { kind: 'joined', title: `${user.displayName} joined ${result.name}`, body: 'Say hi with your next shot.', groupId: result.groupId, rollId: null, link: `/g/${result.groupId}` });
  }
  return result;
});

/** Removes a member and keeps group bookkeeping consistent. Deletes the group when it empties. */
export async function removeMembership(gid: string, uid: string): Promise<'removed' | 'deleted' | 'absent'> {
  const outcome = await db.runTransaction(async (tx) => {
    const gSnap = await tx.get(groupRef(gid));
    const mSnap = await tx.get(memberRef(gid, uid));
    if (!gSnap.exists || !mSnap.exists) return 'absent' as const;
    const g = gSnap.data() as GroupDoc;
    const others = (await tx.get(membersCol(gid).orderBy('joinedAt').limit(MAX_GROUP_MEMBERS + 1))).docs
      .map((d) => d.data() as MemberDoc)
      .filter((m) => m.uid !== uid);
    tx.delete(memberRef(gid, uid));
    tx.update(userRef(uid), { groupIds: FieldValue.arrayRemove(gid) });
    if (!others.length) return 'deleted' as const;
    const update: Record<string, unknown> = { memberCount: FieldValue.increment(-1), memberPreview: preview(others) };
    if (g.ownerId === uid) {
      // hand ownership to the longest-standing admin, else the longest-standing member
      const heir = others.find((m) => m.role === 'admin') ?? others[0];
      update.ownerId = heir.uid;
      tx.update(memberRef(gid, heir.uid), { role: 'owner' });
    }
    tx.update(groupRef(gid), update);
    return 'removed' as const;
  });
  if (outcome === 'deleted') await deleteGroupData(gid);
  return outcome;
}

/** Permanently deletes a group, its rolls, photos and invite codes. */
export async function deleteGroupData(gid: string): Promise<void> {
  const invite = await groupRef(gid).collection('private').doc('invite').get();
  const code = invite.data()?.code as string | undefined;
  if (code) await inviteRef(code).delete();
  await db.recursiveDelete(groupRef(gid));
  await bucket().deleteFiles({ prefix: `photos/${gid}/` }).catch(() => undefined);
}

export const leaveGroup = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const outcome = await removeMembership(gid, uid);
  return { outcome };
});

export const removeMember = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  requireAdmin(member);
  const target = docId(req.data?.uid, 'member');
  if (target === uid) throw new HttpsError('invalid-argument', 'Use “Leave group” instead.');
  const t = (await memberRef(gid, target).get()).data() as MemberDoc | undefined;
  if (!t) throw new HttpsError('not-found', 'That person isn’t in this group.');
  if (t.role === 'owner') throw new HttpsError('permission-denied', 'The group owner can’t be removed.');
  if (t.role === 'admin' && member.role !== 'owner') throw new HttpsError('permission-denied', 'Only the owner can remove an admin.');
  await removeMembership(gid, target);
  return { ok: true };
});

export const setMemberRole = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  if (member.role !== 'owner') throw new HttpsError('permission-denied', 'Only the owner can change roles.');
  const target = docId(req.data?.uid, 'member');
  const role = req.data?.role as MemberRole;
  if (role !== 'admin' && role !== 'member') throw new HttpsError('invalid-argument', 'Invalid role.');
  if (target === uid) throw new HttpsError('invalid-argument', 'You are the owner.');
  const ref = memberRef(gid, target);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'That person isn’t in this group.');
  await ref.update({ role });
  return { ok: true };
});

export const updateGroup = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  requireAdmin(member);
  const update: Record<string, unknown> = {};
  if (req.data?.name !== undefined) {
    const name = cleanText(req.data.name, LIMITS.groupName);
    const err = groupNameError(name);
    if (err) throw new HttpsError('invalid-argument', err);
    update.name = name;
  }
  if (req.data?.theme !== undefined) update.theme = theme(req.data.theme);
  const s = req.data?.settings as Partial<GroupSettings> | undefined;
  if (s?.rollCreators !== undefined) {
    if (s.rollCreators !== 'everyone' && s.rollCreators !== 'admins') throw new HttpsError('invalid-argument', 'Invalid setting.');
    update['settings.rollCreators'] = s.rollCreators;
  }
  if (s?.shareHistory !== undefined) update['settings.shareHistory'] = Boolean(s.shareHistory);
  if (s?.e2ee !== undefined) {
    if (typeof s.e2ee !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid setting.');
    update['settings.e2ee'] = s.e2ee;
  }
  let autoOn = false;
  if (s?.autoRoll !== undefined) {
    const a = s.autoRoll as Partial<AutoRollSettings>;
    if (!a || typeof a.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid monthly roll setting.');
    if (a.enabled) {
      if (!(CAPACITIES as readonly number[]).includes(Number(a.capacity))) throw new HttpsError('invalid-argument', 'Choose 12, 24 or 36 exposures.');
      if (!isPresetId(a.preset)) throw new HttpsError('invalid-argument', 'Choose a film.');
      if (!isValidTimeZone(a.timeZone)) throw new HttpsError('invalid-argument', 'Unknown time zone.');
      update['settings.autoRoll'] = { enabled: true, capacity: Number(a.capacity) as AutoRollSettings['capacity'], preset: a.preset, timeZone: a.timeZone } satisfies AutoRollSettings;
      autoOn = true;
    } else update['settings.autoRoll.enabled'] = false;
  }
  if (!Object.keys(update).length) return { ok: true };
  await groupRef(gid).update(update);
  // Switched on mid-month with no roll loaded: start this month's roll now.
  const rollId = autoOn ? await maybeLoadMonthlyRoll(gid, Date.now(), { midMonth: true }) : null;
  return { ok: true, rollId };
});

/** Any member can share the current invite; only admins can rotate it. */
export const getInvite = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const inv = await groupRef(gid).collection('private').doc('invite').get();
  return { code: inv.data()?.code as string };
});

export const rotateInvite = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid, member } = await requireMember(req.data?.groupId, uid);
  requireAdmin(member);
  await rateLimit(`rotateInvite_${gid}`, 20, DAY, 'That’s a lot of new links today. Try again tomorrow.');
  const code = await db.runTransaction(async (tx) => {
    const privRef = groupRef(gid).collection('private').doc('invite');
    const old = (await tx.get(privRef)).data()?.code as string | undefined;
    const c = await createInvite(tx, gid, uid);
    if (old) tx.update(inviteRef(old), { revoked: true });
    tx.set(privRef, { code: c, updatedAt: Date.now() });
    return c;
  });
  return { code };
});

export const setGroupMute = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  await memberRef(gid, uid).update({ muted: Boolean(req.data?.muted) });
  return { ok: true };
});

/** Keeps member docs and group avatars in sync with profile edits. */
export const onUserUpdated = onDocumentUpdated({ ...opts, document: 'users/{uid}' }, async (event) => {
  const before = event.data?.before.data() as UserDoc | undefined;
  const after = event.data?.after.data() as UserDoc | undefined;
  if (!before || !after) return;
  if (before.displayName === after.displayName && before.photoURL === after.photoURL) return;
  for (const gid of after.groupIds ?? []) {
    await db.runTransaction(async (tx) => {
      const g = await tx.get(groupRef(gid));
      const m = await tx.get(memberRef(gid, after.uid));
      if (!g.exists || !m.exists) return;
      const prev = (g.data() as GroupDoc).memberPreview.map((p) => (p.uid === after.uid ? { ...p, name: after.displayName, photoURL: after.photoURL } : p));
      tx.update(groupRef(gid), { memberPreview: prev });
      tx.update(memberRef(gid, after.uid), { displayName: after.displayName, photoURL: after.photoURL });
    });
  }
});

