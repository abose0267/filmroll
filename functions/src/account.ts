/**
 * Account deletion: leaves every group (transferring ownership), removes the
 * user's photos (files + records, adjusting live roll counts), comments,
 * reactions, favorites, notifications, avatar, profile and auth account.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, adminAuth, bucket, db, rollRef, userRef } from './admin';
import { REGION } from './config';
import { requireAuth } from './util';
import { removeMembership } from './groups';
import type { PhotoDoc, RollDoc, UserDoc } from '@shared/types';

export async function deleteUserData(uid: string): Promise<{ photos: number; groups: number }> {
  const user = (await userRef(uid).get()).data() as UserDoc | undefined;
  let photos = 0;

  const mine = await db.collectionGroup('photos').where('uid', '==', uid).get();
  for (const d of mine.docs) {
    const p = d.data() as PhotoDoc;
    await db.runTransaction(async (tx) => {
      const r = (await tx.get(rollRef(p.groupId, p.rollId))).data() as RollDoc | undefined;
      tx.delete(d.ref);
      if (r && (r.status === 'active' || r.status === 'developing')) {
        // give the exposure back to friends still shooting
        tx.update(rollRef(p.groupId, p.rollId), { exposuresUsed: FieldValue.increment(-1), [`contributors.${uid}`]: FieldValue.increment(-1) });
      } else if (r) {
        tx.update(rollRef(p.groupId, p.rollId), { coverPhotoIds: r.coverPhotoIds.filter((id) => id !== p.id) });
      }
    });
    await bucket().deleteFiles({ prefix: `photos/${p.groupId}/${p.rollId}/${p.id}/` }).catch(() => undefined);
    photos++;
  }

  for (const col of ['comments', 'reactions'] as const) {
    const snap = await db.collectionGroup(col).where('uid', '==', uid).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }

  const groups = user?.groupIds ?? [];
  for (const gid of groups) await removeMembership(gid, uid);

  await db.recursiveDelete(userRef(uid));
  await bucket().deleteFiles({ prefix: `avatars/${uid}/` }).catch(() => undefined);
  await bucket().deleteFiles({ prefix: `uploads/${uid}/` }).catch(() => undefined);
  return { photos, groups: groups.length };
}

export const deleteAccount = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);
  if (req.data?.confirm !== 'DELETE') throw new HttpsError('invalid-argument', 'Type DELETE to confirm.');
  const result = await deleteUserData(uid);
  await adminAuth().deleteUser(uid).catch(() => undefined);
  return result;
});
