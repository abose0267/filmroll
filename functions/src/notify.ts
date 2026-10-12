import { db, memberRef, messaging, notificationsCol, pushTokensCol, userRef } from './admin';
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
  const recipients: string[] = [];
  unique.forEach((uid, i) => {
    const user = users[i].data() as UserDoc | undefined;
    const member = members[i].data() as { muted?: boolean } | undefined;
    if (!user || !member || member.muted) return;
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(user.notificationPrefs ?? {}) };
    if (!prefs[PREF[n.kind]]) return;
    const ref = notificationsCol(uid).doc();
    batch.set(ref, { ...n, id: ref.id, createdAt: now, read: false } satisfies NotificationDoc);
    recipients.push(uid);
  });
  await batch.commit();
  await push(recipients, n).catch((e) => console.warn('push failed', e));
}

/**
 * Web push to every device the recipients registered. Data-only messages: the
 * app's notification service worker shows them (and opens `link` on tap).
 * Dead tokens are removed.
 */
async function push(uids: string[], n: Omit<NotificationDoc, 'id' | 'createdAt' | 'read'>) {
  if (!uids.length || process.env.FUNCTIONS_EMULATOR === 'true') return;
  const tokenDocs = (await Promise.all(uids.map((u) => pushTokensCol(u).limit(10).get()))).flatMap((s) => s.docs);
  if (!tokenDocs.length) return;
  const tokens = tokenDocs.map((d) => d.id);
  for (let i = 0; i < tokens.length; i += 500) {
    const slice = tokens.slice(i, i + 500);
    const res = await messaging().sendEachForMulticast({
      tokens: slice,
      data: { title: n.title, body: n.body, link: n.link, tag: `${n.kind}:${n.rollId ?? n.groupId}` },
      webpush: { headers: { Urgency: n.kind === 'developed' ? 'high' : 'normal', TTL: String(3 * 24 * 3600) } },
    });
    const dead = res.responses
      .map((r, k) => (!r.success && /registration-token-not-registered|invalid-argument|invalid-registration-token/.test(r.error?.code ?? '') ? tokenDocs[i + k].ref : null))
      .filter((r): r is NonNullable<typeof r> => !!r);
    await Promise.all(dead.map((r) => r.delete()));
  }
}

export async function memberIds(gid: string): Promise<string[]> {
  const snap = await db.collection(`groups/${gid}/members`).select().get();
  return snap.docs.map((d) => d.id);
}
