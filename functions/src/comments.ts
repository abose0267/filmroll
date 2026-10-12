import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { groupRef, photosCol, rollRef } from './admin';
import { REGION } from './config';
import { notify } from './notify';
import type { CommentDoc, GroupDoc, PhotoDoc, RollDoc } from '@shared/types';

export const onCommentCreated = onDocumentCreated({ region: REGION, document: 'groups/{gid}/rolls/{rid}/comments/{cid}' }, async (event) => {
  const c = event.data?.data() as CommentDoc | undefined;
  if (!c) return;
  const { gid, rid } = event.params;
  const [photo, roll, group] = await Promise.all([photosCol(gid, rid).doc(c.photoId).get(), rollRef(gid, rid).get(), groupRef(gid).get()]);
  const p = photo.data() as PhotoDoc | undefined;
  if (!p || p.uid === c.uid) return;
  const rollName = (roll.data() as RollDoc | undefined)?.name ?? 'your roll';
  await notify([p.uid], {
    kind: 'comment',
    title: `${c.displayName} commented on your photo`,
    body: `“${c.text.slice(0, 80)}” — ${rollName}, ${(group.data() as GroupDoc | undefined)?.name ?? ''}`.trim(),
    groupId: gid,
    rollId: rid,
    link: `/g/${gid}/r/${rid}?photo=${c.photoId}`,
  });
});
