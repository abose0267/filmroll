/**
 * Authorization-aware photo delivery. Storage rules deny all client reads of
 * photos/, so the only way to see a photo is through this endpoint, which
 * verifies the caller's ID token, group membership, history visibility and
 * that the roll is developed — on every request. No download tokens exist.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { adminAuth, bucket, groupRef, memberRef, photosCol, rollRef } from './admin';
import { REGION } from './config';
import type { GroupDoc, MemberDoc, PhotoDoc, RollDoc } from '@shared/types';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIANTS = new Set(['thumb', 'display', 'original']);

export interface PhotoAccess {
  ok: boolean;
  status: number;
  photo?: PhotoDoc;
}

/** Shared by the endpoint and tests: can `uid` see this photo right now? */
export async function checkPhotoAccess(uid: string, gid: string, rid: string, pid: string): Promise<PhotoAccess> {
  const [m, g, r, p] = await Promise.all([memberRef(gid, uid).get(), groupRef(gid).get(), rollRef(gid, rid).get(), photosCol(gid, rid).doc(pid).get()]);
  if (!m.exists || !g.exists) return { ok: false, status: 403 };
  const roll = r.data() as RollDoc | undefined;
  if (!roll || !p.exists) return { ok: false, status: 404 };
  if (roll.status !== 'developed') return { ok: false, status: 403 };
  const member = m.data() as MemberDoc;
  const group = g.data() as GroupDoc;
  if (!group.settings.shareHistory && roll.createdAt < member.joinedAt) return { ok: false, status: 403 };
  return { ok: true, status: 200, photo: p.data() as PhotoDoc };
}

export const photo = onRequest({ region: REGION, cors: true, memory: '256MiB', concurrency: 80 }, async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }
  const { g, r, p, v = 'thumb', download } = req.query as Record<string, string | undefined>;
  if (!g || !r || !p || !ID.test(g) || !ID.test(r) || !ID.test(p) || !VARIANTS.has(v)) {
    res.status(400).send('Bad request');
    return;
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(token)).uid;
  } catch {
    res.status(401).send('Sign in required');
    return;
  }
  const access = await checkPhotoAccess(uid, g, r, p);
  if (!access.ok || !access.photo) {
    res.status(access.status).send(access.status === 404 ? 'Not found' : 'Not available yet');
    return;
  }
  const info = access.photo[v as 'thumb' | 'display' | 'original'];
  res.setHeader('Content-Type', info.contentType);
  // Browser-private cache only; developed photos never change. Never cached by shared caches.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (download) {
    const ext = info.contentType === 'image/png' ? 'png' : info.contentType === 'image/webp' ? 'webp' : 'jpg';
    res.setHeader('Content-Disposition', `attachment; filename="filmroll-frame-${access.photo.frame}.${ext}"`);
  }
  bucket()
    .file(info.path)
    .createReadStream()
    .on('error', () => {
      if (!res.headersSent) res.status(404);
      res.end();
    })
    .pipe(res);
});
