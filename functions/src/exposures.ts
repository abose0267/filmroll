/**
 * Exposure accounting.
 *
 * 1. reserveExposure  — transaction: checks capacity (used + live reservations)
 *    and takes one slot. Idempotent per client request id.
 * 2. client uploads original/display/thumb to uploads/{uid}/{reservationId}/
 *    (Storage rules: owner-only create, nobody can read).
 * 3. finalizeExposure — verifies the files (size, type, file signature), moves
 *    them to photos/{gid}/{rid}/{photoId}/ (no client access), then a
 *    transaction converts the reservation into a used exposure. Idempotent.
 *
 * A failed upload never consumes an exposure: reservations expire after
 * RESERVATION_TTL_MS and the sweeper gives the slot back.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, bucket, db, photosCol, reservationsCol, rollRef } from './admin';
import { REGION } from './config';
import { HOUR, docId, newId, rateLimit, requireAuth, requireMember } from './util';
import { advanceRoll } from './develop';
import { notify, memberIds } from './notify';
import { CAPTURE_MAX_AGE_MS, QUEUED_MAX_AGE_MS, LIMITS, MAX_PENDING_PER_USER, RESERVATION_TTL_MS } from '@shared/constants';
import { acceptsFinalization, newMilestones, reserveDenial, shotsRemaining } from '@shared/rolls';
import { isPresetId } from '@shared/presets';
import { cleanText, sniffImage } from '@shared/validation';
import type { PhotoDoc, PhotoVariantInfo, ReservationDoc, RollDoc } from '@shared/types';

const opts = { region: REGION };
/** The hot path of every shot: a full vCPU (default is a fraction) keeps it snappy. */
const shotOpts = { region: REGION, memory: '512MiB' as const, cpu: 1 };
const VARIANTS = ['original', 'display', 'thumb'] as const;
type Variant = (typeof VARIANTS)[number];
const MAX_BYTES: Record<Variant, number> = { original: LIMITS.originalBytes, display: LIMITS.displayBytes, thumb: LIMITS.thumbBytes };

export const uploadPath = (uid: string, resId: string, v: Variant) => `uploads/${uid}/${resId}/${v}`;
export const photoPath = (gid: string, rid: string, pid: string, v: Variant) => `photos/${gid}/${rid}/${pid}/${v}`;

export const reserveExposure = onCall(shotOpts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  const clientRequestId = docId(req.data?.requestId, 'request');
  await rateLimit(`reserve_${uid}`, 120, HOUR, 'Slow down a little — try again in a bit.');
  const resId = `${uid.slice(0, 28)}_${clientRequestId}`.slice(0, 64);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const resRef = reservationsCol(gid, rid).doc(resId);
    const [rollSnap, resSnap, mine] = await Promise.all([
      tx.get(rollRef(gid, rid)),
      tx.get(resRef),
      tx.get(reservationsCol(gid, rid).where('uid', '==', uid).where('status', '==', 'pending')),
    ]);
    const roll = rollSnap.data() as RollDoc | undefined;
    if (!roll) throw new HttpsError('not-found', 'Roll not found.');
    const existing = resSnap.data() as ReservationDoc | undefined;
    // Same request retried: hand back the same reservation (duplicate prevention).
    if (existing?.status === 'pending' && existing.expiresAt > now) return { reservationId: resId, expiresAt: existing.expiresAt, uploadPrefix: `uploads/${uid}/${resId}/` };
    if (existing?.status === 'finalized') throw new HttpsError('already-exists', 'That photo was already added to the roll.');
    const live = mine.docs.filter((d) => (d.data() as ReservationDoc).expiresAt > now).length;
    const denial = reserveDenial(roll, live, MAX_PENDING_PER_USER);
    if (denial === 'not_active') throw new HttpsError('failed-precondition', roll.status === 'developed' ? 'This roll has already been developed.' : 'This roll isn’t taking photos right now.');
    if (denial === 'full') throw new HttpsError('resource-exhausted', 'No exposures left on this roll.');
    if (denial === 'too_many_pending') throw new HttpsError('resource-exhausted', 'Finish your other upload first.');
    const expiresAt = now + RESERVATION_TTL_MS;
    tx.set(resRef, { id: resId, groupId: gid, rollId: rid, uid, status: 'pending', createdAt: now, expiresAt, photoId: null } satisfies ReservationDoc);
    tx.update(rollRef(gid, rid), { exposuresReserved: FieldValue.increment(1) });
    return { reservationId: resId, expiresAt, uploadPrefix: `uploads/${uid}/${resId}/` };
  });
});

/** Gives a reservation back (user cancelled before finishing). */
export const releaseExposure = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  const resId = docId(req.data?.reservationId, 'reservation');
  const released = await expireReservation(gid, rid, resId, uid);
  return { released };
});

/** Marks a pending reservation expired and returns its slot. Safe to call repeatedly. */
export async function expireReservation(gid: string, rid: string, resId: string, onlyUid?: string): Promise<boolean> {
  const done = await db.runTransaction(async (tx) => {
    const ref = reservationsCol(gid, rid).doc(resId);
    const [snap, rollSnap] = await Promise.all([tx.get(ref), tx.get(rollRef(gid, rid))]);
    const r = snap.data() as ReservationDoc | undefined;
    if (!r || r.status !== 'pending' || (onlyUid && r.uid !== onlyUid)) return null;
    tx.update(ref, { status: 'expired' });
    const roll = rollSnap.data() as RollDoc | undefined;
    if (roll && roll.exposuresReserved > 0) tx.update(rollRef(gid, rid), { exposuresReserved: FieldValue.increment(-1) });
    return r;
  });
  if (!done) return false;
  await bucket().deleteFiles({ prefix: `uploads/${done.uid}/${resId}/` }).catch(() => undefined);
  return true;
}

async function inspect(path: string, v: Variant): Promise<{ bytes: number; contentType: string }> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('failed-precondition', `The ${v} image didn’t finish uploading. Try again.`);
  const [meta] = await file.getMetadata();
  const bytes = Number(meta.size ?? 0);
  if (!bytes || bytes > MAX_BYTES[v]) throw new HttpsError('invalid-argument', 'That photo is too large.');
  const [head] = await file.download({ start: 0, end: 15 });
  const kind = sniffImage(new Uint8Array(head));
  if (!kind) throw new HttpsError('invalid-argument', 'That file isn’t a supported image.');
  if (v !== 'original' && kind !== 'image/jpeg') throw new HttpsError('invalid-argument', 'Processed images must be JPEG.');
  return { bytes, contentType: kind };
}

function dims(v: unknown): { width: number; height: number } {
  const o = v as { width?: unknown; height?: unknown } | undefined;
  const w = Math.round(Number(o?.width));
  const h = Math.round(Number(o?.height));
  if (!(w > 0 && w <= 12000 && h > 0 && h <= 12000)) throw new HttpsError('invalid-argument', 'Invalid image dimensions.');
  return { width: w, height: h };
}

export const finalizeExposure = onCall(shotOpts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  const resId = docId(req.data?.reservationId, 'reservation');
  const caption = cleanText(req.data?.caption, LIMITS.caption, { multiline: true });
  const location = cleanText(req.data?.location, LIMITS.location);
  const now = Date.now();
  // Only fresh shots: measure the photo's age on the client's own clock (immune
  // to device clock drift), then re-base the timestamp onto server time.
  const capturedAtRaw = Number(req.data?.capturedAt);
  const clientNowRaw = Number(req.data?.clientNow);
  const clientNow = Number.isFinite(clientNowRaw) ? clientNowRaw : now;
  const age = clientNow - capturedAtRaw;
  // Shots that waited in the phone's offline queue may be older (up to QUEUED_MAX_AGE_MS).
  const maxAge = req.data?.queued === true ? QUEUED_MAX_AGE_MS : CAPTURE_MAX_AGE_MS;
  if (!Number.isFinite(capturedAtRaw) || age > maxAge || age < -60_000) {
    throw new HttpsError('failed-precondition', 'Only photos taken just now can go on the roll. Take a new one!');
  }
  const capturedAt = now - Math.max(0, age);
  const sizes = { original: dims(req.data?.sizes?.original), display: dims(req.data?.sizes?.display), thumb: dims(req.data?.sizes?.thumb) };

  const resRef = reservationsCol(gid, rid).doc(resId);
  const res = (await resRef.get()).data() as ReservationDoc | undefined;
  if (!res || res.uid !== uid) throw new HttpsError('not-found', 'That exposure wasn’t found. Try again.');
  if (res.status === 'finalized') return { photoId: res.photoId, duplicate: true, ...(await afterInfo(gid, rid)) };
  if (res.status === 'expired') throw new HttpsError('deadline-exceeded', 'That upload took too long and the exposure was released. Try again.');

  // Check all three uploads at once (size, type, file signature).
  const [roll0Snap, ...metas] = await Promise.all([rollRef(gid, rid).get(), ...VARIANTS.map((v) => inspect(uploadPath(uid, resId, v), v))]);
  const roll0 = roll0Snap.data() as RollDoc;
  const info = {} as Record<Variant, PhotoVariantInfo>;
  VARIANTS.forEach((v, i) => (info[v] = { path: '', ...sizes[v], ...metas[i] }));

  // Move into the private photo area before committing (in parallel; on failure we clean up).
  const pid = newId();
  await Promise.all(VARIANTS.map(async (v) => {
    const dest = photoPath(gid, rid, pid, v);
    await bucket().file(uploadPath(uid, resId, v)).copy(bucket().file(dest));
    await bucket().file(dest).setMetadata({ contentType: info[v].contentType, cacheControl: 'private, max-age=0, no-store', metadata: { groupId: gid, rollId: rid, uid } });
    info[v].path = dest;
  }));

  const preset = isPresetId(req.data?.preset) ? req.data.preset : roll0.preset;
  let outcome: { roll: RollDoc } | { error: HttpsError };
  try {
    outcome = await db.runTransaction(async (tx) => {
      const [rs, rollSnap] = await Promise.all([tx.get(resRef), tx.get(rollRef(gid, rid))]);
      const r = rs.data() as ReservationDoc;
      const roll = rollSnap.data() as RollDoc;
      if (r.status !== 'pending') return { error: new HttpsError('deadline-exceeded', 'That upload took too long and the exposure was released. Try again.') };
      if (!acceptsFinalization(roll)) return { error: new HttpsError('failed-precondition', roll.status === 'developed' ? 'The roll was developed before your photo finished uploading.' : 'No exposures left on this roll.') };
      const frame = roll.exposuresUsed + 1;
      const photo: PhotoDoc = { id: pid, groupId: gid, rollId: rid, uid, frame, caption, location, capturedAt, createdAt: now, preset, original: info.original, display: info.display, thumb: info.thumb };
      tx.set(photosCol(gid, rid).doc(pid), photo);
      tx.update(resRef, { status: 'finalized', photoId: pid });
      tx.update(rollRef(gid, rid), {
        exposuresUsed: FieldValue.increment(1),
        exposuresReserved: roll.exposuresReserved > 0 ? FieldValue.increment(-1) : 0,
        [`contributors.${uid}`]: FieldValue.increment(1),
      });
      return { roll: { ...roll, exposuresUsed: frame } };
    });
  } catch (e) {
    await bucket().deleteFiles({ prefix: `photos/${gid}/${rid}/${pid}/` }).catch(() => undefined);
    throw e;
  }
  if ('error' in outcome) {
    await bucket().deleteFiles({ prefix: `photos/${gid}/${rid}/${pid}/` }).catch(() => undefined);
    await expireReservation(gid, rid, resId);
    throw outcome.error;
  }
  const roll = outcome.roll;
  const milestones = newMilestones(roll);
  const sendMilestones = async () => {
    if (!milestones.length) return;
    await rollRef(gid, rid).update({ milestones: FieldValue.arrayUnion(...milestones) });
    const ids = await memberIds(gid);
    const left = roll.capacity - roll.exposuresUsed;
    await Promise.all(milestones.map((m) => notify(ids, m === 'half'
      ? { kind: 'halfway', title: `${roll.name} is halfway full`, body: `${roll.exposuresUsed} of ${roll.capacity} memories captured.`, groupId: gid, rollId: rid, link: `/g/${gid}` }
      : { kind: 'fewLeft', title: `Only ${left} exposures remain`, body: `on ${roll.name}. Make them count.`, groupId: gid, rollId: rid, link: `/g/${gid}` })));
  };
  // Clean-up, milestone notifications and the develop check are independent: run them together.
  await Promise.all([
    bucket().deleteFiles({ prefix: `uploads/${uid}/${resId}/` }).catch(() => undefined),
    sendMilestones().catch((e) => console.warn('milestones', e)),
    advanceRoll(gid, rid),
  ]);
  return { photoId: pid, duplicate: false, ...(await afterInfo(gid, rid)) };
});

async function afterInfo(gid: string, rid: string) {
  const r = (await rollRef(gid, rid).get()).data() as RollDoc;
  return { remaining: shotsRemaining(r), status: r.status };
}

/**
 * Lets the photographer add or change the note (caption + location) on their
 * own shot until the roll develops. Shots are saved the moment the undo window
 * closes, so the note can arrive a little later.
 */
export const setPhotoNote = onCall(opts, async (req) => {
  const uid = requireAuth(req);
  const { gid } = await requireMember(req.data?.groupId, uid);
  const rid = docId(req.data?.rollId, 'roll');
  const pid = docId(req.data?.photoId, 'photo');
  await rateLimit(`note_${uid}`, 120, HOUR, 'Slow down a little — try again in a bit.');
  const caption = cleanText(req.data?.caption, LIMITS.caption, { multiline: true });
  const location = cleanText(req.data?.location, LIMITS.location);
  await db.runTransaction(async (tx) => {
    const [rollSnap, photoSnap] = await Promise.all([tx.get(rollRef(gid, rid)), tx.get(photosCol(gid, rid).doc(pid))]);
    const roll = rollSnap.data() as RollDoc | undefined;
    const photo = photoSnap.data() as PhotoDoc | undefined;
    if (!roll || !photo || photo.uid !== uid) throw new HttpsError('not-found', 'That shot wasn’t found.');
    if (roll.status === 'developed' || roll.status === 'cancelled') throw new HttpsError('failed-precondition', 'This roll has already been developed.');
    tx.update(photoSnap.ref, { caption, location });
  });
  return { ok: true };
});
