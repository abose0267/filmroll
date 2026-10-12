import { db, memberRef, notificationsCol, userRef } from './admin';
import { DEFAULT_NOTIFICATION_PREFS } from '@shared/constants';
import type { NotificationDoc, NotificationKind, NotificationPrefs, UserDoc } from '@shared/types';

const PREF: Record<NotificationKind, keyof NotificationPrefs> = {
  joined: 'rollStarted',
  rollStarted: 'rollStarted',
  halfway: 'milestones',
  fewLeft: 'milestones',
  developed: 'developed',
  comment: 'comments',
};

/** Writes in-app notifications, honouring each user's preferences and group mute. */
export async function notify(uids: string[], n: Omit<NotificationDoc, 'id' | 'createdAt' | 'read'>): Promise<void> {
  const unique = [...new Set(uids)];
  if (!unique.length) return;
  const [users, members] = await Promise.all([
    db.getAll(...unique.map((u) => userRef(u))),
    db.getAll(...unique.map((u) => memberRef(n.groupId, u))),
  ]);
  const batch = db.batch();
  const now = Date.now();
  unique.forEach((uid, i) => {
    const user = users[i].data() as UserDoc | undefined;
    const member = members[i].data() as { muted?: boolean } | undefined;
    if (!user || !member || member.muted) return;
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(user.notificationPrefs ?? {}) };
    if (!prefs[PREF[n.kind]]) return;
    const ref = notificationsCol(uid).doc();
    batch.set(ref, { ...n, id: ref.id, createdAt: now, read: false } satisfies NotificationDoc);
  });
  await batch.commit();
}

export async function memberIds(gid: string): Promise<string[]> {
  const snap = await db.collection(`groups/${gid}/members`).select().get();
  return snap.docs.map((d) => d.id);
}
