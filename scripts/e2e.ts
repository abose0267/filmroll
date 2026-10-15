/**
 * End-to-end backend test against the Firebase Emulator Suite.
 * Run with: npm run test:e2e   (needs Java 21 for the emulators)
 *
 * Exercises real callables, Storage uploads, rules and the photo endpoint as
 * several signed-in users, plus the scheduled sweeper (invoked directly).
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { runSweep } from '../functions/src/sweep';
import { groupRef, rollRef } from '../functions/src/admin';
import { runMonthlyRolls } from '../functions/src/rolls';
import { endOfMonthEvening, monthName, zonedParts, zonedTimeToUtc, daysInMonth } from '../shared/time';
import { DEFAULT_NOTIFICATION_PREFS, RESERVATION_TTL_MS } from '../shared/constants';
import type { RollDoc } from '../shared/types';
import { sealedHeader, toBase64 } from '../shared/sealed';

const PROJECT = 'demo-filmroll';
const PHOTO_URL = `http://127.0.0.1:5001/${PROJECT}/us-central1/photo`;
// 1×1 JPEG
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));

let failures = 0;
let passes = 0;
function check(cond: unknown, msg: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}
async function rejects(p: Promise<unknown>, pattern: RegExp, msg: string) {
  try {
    await p;
    check(false, `${msg} (unexpectedly succeeded)`);
  } catch (e) {
    const m = `${(e as { code?: string }).code ?? ''} ${(e as Error).message}`;
    check(pattern.test(m), `${msg} → ${m.trim().slice(0, 90)}`);
  }
}

interface Client { name: string; uid: string; app: FirebaseApp; auth: Auth; db: Firestore; fn: Functions; st: FirebaseStorage }

async function client(name: string, fixedEmail?: string): Promise<Client> {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com`, appId: 'demo' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  const st = getStorage(app);
  connectStorageEmulator(st, '127.0.0.1', 9199);
  const cred = await createUserWithEmailAndPassword(auth, fixedEmail ?? `${name}-${Date.now()}@example.com`, 'password123');
  const uid = cred.user.uid;
  await setDoc(doc(db, 'users', uid), {
    uid, displayName: name[0].toUpperCase() + name.slice(1), photoURL: null, city: '', bio: '', createdAt: Date.now(),
    onboarded: true, groupIds: [], notificationPrefs: DEFAULT_NOTIFICATION_PREFS, showMemories: true,
  });
  return { name, uid, app, auth, db, fn, st };
}

const call = <T = Record<string, unknown>>(c: Client, name: string, data: unknown) => httpsCallable(c.fn, name)(data).then((r) => r.data as T);

let reqN = 0;
/** Reserve → upload three variants → finalize, like the app does. */
async function shoot(c: Client, gid: string, rid: string, opts: { caption?: string; skipUpload?: boolean; bytes?: Uint8Array } = {}) {
  const res = await call<{ reservationId: string; uploadPrefix: string }>(c, 'reserveExposure', { groupId: gid, rollId: rid, requestId: `req${++reqN}${Date.now()}` });
  if (!opts.skipUpload) await upload(c, res.uploadPrefix, opts.bytes);
  return { res, fin: () => finalize(c, gid, rid, res.reservationId, opts.caption ?? `${c.name} shot ${reqN}`) };
}
async function upload(c: Client, prefix: string, bytes: Uint8Array = JPEG) {
  for (const v of ['original', 'display', 'thumb']) await uploadBytes(ref(c.st, prefix + v), bytes, { contentType: 'image/jpeg' });
}
function finalize(c: Client, gid: string, rid: string, reservationId: string, caption: string, capturedAt = Date.now()) {
  const s = { width: 1, height: 1 };
  return call<{ photoId: string; duplicate: boolean; remaining: number; status: string }>(c, 'finalizeExposure', {
    groupId: gid, rollId: rid, reservationId, caption, location: 'Somewhere', capturedAt, clientNow: Date.now(), preset: 'warmVintage', sizes: { original: s, display: s, thumb: s },
  });
}
async function fetchPhoto(c: Client | null, gid: string, rid: string, pid: string, v = 'thumb') {
  const headers: Record<string, string> = {};
  if (c) headers.authorization = `Bearer ${await c.auth.currentUser!.getIdToken()}`;
  return fetch(`${PHOTO_URL}?g=${gid}&r=${rid}&p=${pid}&v=${v}`, { headers });
}
const rollOf = async (c: Client, gid: string, rid: string) => (await getDoc(doc(c.db, 'groups', gid, 'rolls', rid))).data() as RollDoc;

async function main() {
  console.log('Users & groups');
  const [alice, bob, carol, dave] = await Promise.all(['alice', 'bob', 'carol', 'dave'].map((n) => client(n)));
  const { groupId: gid } = await call<{ groupId: string; inviteCode: string }>(alice, 'createGroup', { name: 'The Crew', theme: 'coral' });
  const { code } = await call<{ code: string }>(bob, 'getInvite', { groupId: gid }).catch(() => ({ code: '' }));
  check(!code, 'non-members cannot fetch the invite code');
  const invite = await call<{ code: string }>(alice, 'getInvite', { groupId: gid });
  const preview = await call<{ name: string; memberCount: number }>(bob, 'previewInvite', { code: `${invite.code.slice(0, 4)}-${invite.code.slice(4)}`.toLowerCase() });
  check(preview.name === 'The Crew' && preview.memberCount === 1, 'invite preview shows group name and size');
  await call(bob, 'joinGroup', { code: invite.code });
  await call(carol, 'joinGroup', { code: `https://filmroll.app/join/${invite.code}` });
  const again = await call<{ joined: boolean }>(carol, 'joinGroup', { code: invite.code });
  check(again.joined === false, 'joining twice is a no-op');
  const g = (await getDoc(doc(bob.db, 'groups', gid))).data()!;
  check(g.memberCount === 3, `group has 3 members (${g.memberCount})`);
  await rejects(getDoc(doc(dave.db, 'groups', gid)), /permission/i, 'outsider cannot read the group');
  await rejects(call(dave, 'joinGroup', { code: 'ZZZZ-ZZZZ' }), /not-found|expired/i, 'bad invite code is rejected');

  console.log('\nRoll 1: develop when full (12 exposures)');
  const { rollId: r1 } = await call<{ rollId: string }>(alice, 'startRoll', { groupId: gid, name: 'October', capacity: 12, developMode: 'full', preset: 'classic35' });
  await rejects(call(bob, 'startRoll', { groupId: gid, name: 'Second', capacity: 12, developMode: 'full' }), /already has a roll/i, 'only one active roll per group');
  await rejects(call(alice, 'startRoll', { groupId: gid, name: 'X', capacity: 30, developMode: 'full' }), /12, 24 or 36/i, 'invalid capacity rejected');

  // idempotent reservation + duplicate finalize
  const reqId = `dup${Date.now()}`;
  const a = await call<{ reservationId: string; uploadPrefix: string }>(alice, 'reserveExposure', { groupId: gid, rollId: r1, requestId: reqId });
  const b = await call<{ reservationId: string }>(alice, 'reserveExposure', { groupId: gid, rollId: r1, requestId: reqId });
  check(a.reservationId === b.reservationId, 'retrying a reservation returns the same slot');
  check((await rollOf(alice, gid, r1)).exposuresReserved === 1, 'retry did not take a second slot');
  await rejects(finalize(alice, gid, r1, a.reservationId, 'early'), /didn.t finish uploading/i, 'finalize before upload fails without consuming the exposure');
  await upload(alice, a.uploadPrefix);
  await rejects(finalize(alice, gid, r1, a.reservationId, 'old photo', Date.now() - 2 * 3_600_000), /taken just now/i, 'photos taken hours ago are rejected');
  const f1 = await finalize(alice, gid, r1, a.reservationId, 'my secret coffee');
  const f1b = await finalize(alice, gid, r1, a.reservationId, 'my secret coffee');
  check(f1b.duplicate && f1b.photoId === f1.photoId, 'finalizing twice is idempotent');
  // notes can be added after the shot is saved (shutter is final; the note comes later)
  await call(alice, 'setPhotoNote', { groupId: gid, rollId: r1, photoId: f1.photoId, caption: 'my secret coffee (edited)', location: 'Austin' });
  check(true, 'photographer can add/edit the note on their own shot before development');
  await rejects(call(bob, 'setPhotoNote', { groupId: gid, rollId: r1, photoId: f1.photoId, caption: 'hijack', location: '' }), /not-found|wasn.t found/i, 'others cannot edit your shot’s note');
  let roll = await rollOf(bob, gid, r1);
  check(roll.exposuresUsed === 1 && roll.exposuresReserved === 0, `counts after first shot: used ${roll.exposuresUsed}, reserved ${roll.exposuresReserved}`);

  // invalid file contents
  const bad = await shoot(bob, gid, r1, { bytes: new TextEncoder().encode('<html>not an image</html>') });
  await rejects(bad.fin(), /supported image/i, 'non-image bytes rejected by signature check');
  await call(bob, 'releaseExposure', { groupId: gid, rollId: r1, reservationId: bad.res.reservationId });
  check((await rollOf(bob, gid, r1)).exposuresReserved === 0, 'released reservation returns the slot');

  // privacy before development
  await rejects(getDoc(doc(alice.db, 'groups', gid, 'rolls', r1, 'photos', f1.photoId)), /permission/i, 'uploader cannot read own photo record before development');
  await rejects(getDocs(collection(bob.db, 'groups', gid, 'rolls', r1, 'photos')), /permission/i, 'members cannot list hidden photos');
  check((await fetchPhoto(alice, gid, r1, f1.photoId)).status === 403, 'photo endpoint refuses the uploader before development');
  check((await fetchPhoto(bob, gid, r1, f1.photoId, 'original')).status === 403, 'photo endpoint refuses members before development');
  check((await fetchPhoto(null, gid, r1, f1.photoId)).status === 401, 'photo endpoint requires sign-in');

  // fill to 9 used
  for (const c of [bob, carol, alice, bob, carol, alice, bob, carol]) await (await shoot(c, gid, r1)).fin();
  roll = await rollOf(bob, gid, r1);
  check(roll.exposuresUsed === 9 && roll.status === 'active', `9 of 12 used, still active (${roll.status})`);
  check(roll.milestones.includes('half') && roll.milestones.includes('three'), 'halfway and 3-left milestones recorded once');

  // stuck upload: reserve, never upload; sweeper releases it after TTL
  const stuck = await shoot(carol, gid, r1, { skipUpload: true });
  check((await rollOf(carol, gid, r1)).exposuresReserved === 1, 'pending reservation holds a slot');
  const sw = await runSweep(Date.now() + RESERVATION_TTL_MS + 1000);
  check(sw.expired >= 1 && (await rollOf(carol, gid, r1)).exposuresReserved === 0, 'sweeper releases an abandoned reservation');
  await rejects(stuck.fin(), /took too long|released/i, 'finalizing an expired reservation fails cleanly');

  // concurrency: 6 simultaneous reservations for the last 3 slots
  console.log('\nRace for the last 3 exposures');
  const attempts = await Promise.allSettled([alice, alice, bob, bob, carol, carol].map((c, i) => call<{ reservationId: string; uploadPrefix: string }>(c, 'reserveExposure', { groupId: gid, rollId: r1, requestId: `race${i}${Date.now()}` }).then((r) => ({ c, r }))));
  const won = attempts.filter((x): x is PromiseFulfilledResult<{ c: Client; r: { reservationId: string; uploadPrefix: string } }> => x.status === 'fulfilled').map((x) => x.value);
  check(won.length === 3, `exactly 3 of 6 concurrent reservations succeed (${won.length})`);
  const fins = await Promise.allSettled(won.map(async ({ c, r }) => {
    await upload(c, r.uploadPrefix);
    return finalize(c, gid, r1, r.reservationId, `${c.name} last shot`);
  }));
  check(fins.every((f) => f.status === 'fulfilled'), 'all winners finalize');
  roll = await rollOf(alice, gid, r1);
  check(roll.exposuresUsed === 12 && roll.status === 'developed', `roll is full (${roll.exposuresUsed}/12) and developed automatically (${roll.status})`);
  check(Object.values(roll.contributors).reduce((a, b) => a + b, 0) === 12, 'contributor counts add up to 12');
  check(roll.coverPhotoIds.length === 4, 'album cover has 4 frames');
  await rejects(call(alice, 'reserveExposure', { groupId: gid, rollId: r1, requestId: `after${Date.now()}` }), /already been developed|isn.t taking/i, 'no reservations after development');

  console.log('\nDeveloped album');
  const photos = await getDocs(collection(carol.db, 'groups', gid, 'rolls', r1, 'photos'));
  check(photos.size === 12, `members see all 12 photos (${photos.size})`);
  const frames = photos.docs.map((d) => d.data().frame as number).sort((x, y) => x - y);
  check(frames.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12', 'frames are numbered 1–12 without gaps');
  const own = photos.docs.find((d) => d.id === f1.photoId)!.data();
  check(own.caption === 'my secret coffee (edited)' && own.location === 'Austin', 'the edited note is what gets revealed');
  await rejects(call(alice, 'setPhotoNote', { groupId: gid, rollId: r1, photoId: f1.photoId, caption: 'too late', location: '' }), /already been developed/i, 'notes are locked once the roll develops');
  const img = await fetchPhoto(bob, gid, r1, f1.photoId, 'display');
  const bytes = new Uint8Array(await img.arrayBuffer());
  check(img.status === 200 && bytes.length === JPEG.length && img.headers.get('cache-control')?.includes('private'), 'photo endpoint serves the image privately after development');
  check((await fetchPhoto(dave, gid, r1, f1.photoId)).status === 403, 'outsiders still cannot fetch developed photos');
  await setDoc(doc(bob.db, 'groups', gid, 'rolls', r1, 'comments', 'c1'), { id: 'c1', photoId: f1.photoId, uid: bob.uid, displayName: 'Bob', photoURL: null, text: 'Is that the place on 5th?', createdAt: Date.now() });
  await setDoc(doc(carol.db, 'groups', gid, 'rolls', r1, 'reactions', `${f1.photoId}_${carol.uid}`), { photoId: f1.photoId, uid: carol.uid, emoji: '🥹', createdAt: Date.now() });
  check((await getDocs(collection(alice.db, 'groups', gid, 'rolls', r1, 'comments'))).size === 1, 'comments work after development');
  await new Promise((r) => setTimeout(r, 2500));
  const notes = (await getDocs(collection(alice.db, 'users', alice.uid, 'notifications'))).docs.map((d) => d.data().kind as string);
  check(notes.includes('developed') && notes.includes('comment') && notes.includes('joined'), `alice got developed/comment/joined notifications (${[...new Set(notes)].join(', ')})`);

  console.log('\nRoll 2: scheduled development with an upload in flight');
  const now = Date.now();
  const { rollId: r2 } = await call<{ rollId: string }>(bob, 'startRoll', { groupId: gid, name: 'November', capacity: 24, developMode: 'date', developAt: now + 2 * 3_600_000, preset: 'blackWhite' });
  await (await shoot(alice, gid, r2)).fin();
  const inflight = await shoot(carol, gid, r2);
  // simulate the development date arriving (admin-only field)
  await rollRef(gid, r2).update({ developAt: Date.now() - 1000 });
  await runSweep();
  roll = await rollOf(alice, gid, r2);
  check(roll.status === 'developing', `date passed with an upload pending → developing (${roll.status})`);
  await rejects(call(bob, 'reserveExposure', { groupId: gid, rollId: r2, requestId: `late${Date.now()}` }), /isn.t taking/i, 'no new reservations while developing');
  await inflight.fin();
  roll = await rollOf(alice, gid, r2);
  check(roll.status === 'developed' && roll.exposuresUsed === 2, `in-flight photo was included and the roll developed (${roll.status}, ${roll.exposuresUsed})`);

  console.log('\nRoll 3: nobody contributes; roll 4: cancel');
  const { rollId: r3 } = await call<{ rollId: string }>(carol, 'startRoll', { groupId: gid, name: 'Quiet month', capacity: 12, developMode: 'date', developAt: now + 2 * 3_600_000 });
  await rollRef(gid, r3).update({ developAt: Date.now() - 1000 });
  await runSweep();
  roll = await rollOf(alice, gid, r3);
  check(roll.status === 'developed' && roll.exposuresUsed === 0, 'empty roll develops on its date with no photos');
  const { rollId: r4 } = await call<{ rollId: string }>(alice, 'startRoll', { groupId: gid, name: 'Oops', capacity: 12, developMode: 'full' });
  await rejects(call(bob, 'cancelRoll', { groupId: gid, rollId: r4 }), /admins|creator/i, 'regular members cannot cancel others’ rolls');
  await call(alice, 'cancelRoll', { groupId: gid, rollId: r4 });
  check((await rollOf(alice, gid, r4)).status === 'cancelled', 'empty roll can be cancelled');
  const { rollId: r5 } = await call<{ rollId: string }>(alice, 'startRoll', { groupId: gid, name: 'December', capacity: 12, developMode: 'full' });
  await (await shoot(bob, gid, r5)).fin();
  await rejects(call(alice, 'cancelRoll', { groupId: gid, rollId: r5 }), /already shot/i, 'rolls with photos cannot be cancelled');

  console.log('\nMembership changes');
  await call(carol, 'leaveGroup', { groupId: gid });
  await rejects(getDocs(collection(carol.db, 'groups', gid, 'rolls', r1, 'photos')), /permission/i, 'after leaving, developed photos are inaccessible');
  check((await fetchPhoto(carol, gid, r1, f1.photoId)).status === 403, 'photo endpoint re-checks membership');
  check((await getDocs(collection(alice.db, 'groups', gid, 'rolls', r1, 'photos'))).size === 12, 'photos from a departed member stay in the album');
  await call(carol, 'joinGroup', { code: invite.code });
  check((await getDocs(collection(carol.db, 'groups', gid, 'rolls', r1, 'photos'))).size === 12, 'rejoining member sees developed history (shareHistory on)');
  await call(alice, 'updateGroup', { groupId: gid, settings: { shareHistory: false } });
  await call(dave, 'joinGroup', { code: invite.code });
  check((await fetchPhoto(dave, gid, r1, f1.photoId)).status === 403, 'with history off, new members cannot see older rolls');
  await call(alice, 'rotateInvite', { groupId: gid });
  const eve = await client('eve');
  await rejects(call(eve, 'joinGroup', { code: invite.code }), /expired|not-found/i, 'rotated invite codes stop working');

  console.log('\nAccount deletion');
  const before = (await rollOf(alice, gid, r5)).exposuresUsed;
  await call(bob, 'deleteAccount', { confirm: 'DELETE' });
  const after = await rollOf(alice, gid, r5);
  check(before === 1 && after.exposuresUsed === 0, 'deleting an account gives back exposures on active rolls');
  const r1Photos = await getDocs(collection(alice.db, 'groups', gid, 'rolls', r1, 'photos'));
  check(r1Photos.docs.every((d) => d.data().uid !== bob.uid), 'deleted user’s photos are removed from albums');
  check((await getDocs(collection(alice.db, 'groups', gid, 'rolls', r1, 'comments'))).size === 0, 'deleted user’s comments are removed');

  console.log('\nMonthly roll');
  {
    const tz = 'America/Chicago';
    const { groupId: mg } = await call<{ groupId: string }>(alice, 'createGroup', { name: 'Monthly Club', theme: 'sage' });
    const t0 = Date.now();
    const p0 = zonedParts(t0, tz);
    const daysLeft = daysInMonth(p0.y, p0.m) - p0.d;
    const on = await call<{ rollId: string | null }>(alice, 'updateGroup', { groupId: mg, settings: { autoRoll: { enabled: true, capacity: 12, preset: 'softPastel', timeZone: tz } } });
    if (daysLeft >= 3) {
      const r0 = (await getDoc(doc(alice.db, 'groups', mg, 'rolls', on.rollId!))).data() as RollDoc;
      check(r0.name === monthName(t0, tz) && r0.developAt === endOfMonthEvening(t0, tz) && r0.capacity === 12 && r0.preset === 'softPastel' && r0.developMode === 'either', `switching it on mid-month loads “${r0.name}”, developing on the month’s last evening`);
    } else check(on.rollId == null, 'switching it on in the last days of the month waits for the 1st');
    await rejects(call(bob, 'updateGroup', { groupId: mg, settings: { autoRoll: { enabled: true, capacity: 12, preset: 'classic35', timeZone: tz } } }), /permission|admins|not a member/i, 'only admins can change the monthly roll');
    // develop this month's roll, then jump to 10am on the 1st of next month
    if (on.rollId) {
      await rollRef(mg, on.rollId).update({ status: 'developed', developedAt: Date.now() });
      await groupRef(mg).update({ activeRollId: null });
    }
    const nextMonth = p0.m === 12 ? { y: p0.y + 1, m: 1 } : { y: p0.y, m: p0.m + 1 };
    const first = zonedTimeToUtc(nextMonth.y, nextMonth.m, 1, 10, 0, tz);
    const loaded = await runMonthlyRolls(first);
    const g1 = (await getDoc(doc(alice.db, 'groups', mg))).data()!;
    const r1 = (await getDoc(doc(alice.db, 'groups', mg, 'rolls', g1.activeRollId))).data() as RollDoc;
    check(loaded >= 1 && r1.name === monthName(first, tz) && r1.createdBy === alice.uid, `on the 1st the next roll loads by itself (“${r1.name}”)`);
    await runMonthlyRolls(first + 3_600_000);
    check((await getDocs(collection(alice.db, 'groups', mg, 'rolls'))).size === (on.rollId ? 2 : 1), 'running the job again doesn’t load a second roll');
    // a month where a roll is already in the camera is skipped
    const second = zonedTimeToUtc(nextMonth.m === 12 ? nextMonth.y + 1 : nextMonth.y, nextMonth.m === 12 ? 1 : nextMonth.m + 1, 1, 10, 0, tz);
    await runMonthlyRolls(second);
    const g2 = (await getDoc(doc(alice.db, 'groups', mg))).data()!;
    check(g2.activeRollId === g1.activeRollId, 'a month is skipped while a roll is still in the camera');
  }

  console.log('\nEnd-to-end encryption (opt-in per group)');
  {
    const frank = await client('frank');
    const { groupId: eg } = await call<{ groupId: string }>(alice, 'createGroup', { name: 'Locked Club', theme: 'dusk' });
    const inv = await call<{ code: string }>(alice, 'getInvite', { groupId: eg });
    await call(frank, 'joinGroup', { code: inv.code });
    const { rollId: er } = await call<{ rollId: string }>(alice, 'startRoll', { groupId: eg, name: 'Secret roll', capacity: 12, developMode: 'full', preset: 'classic35' });
    await rejects(call(frank, 'updateGroup', { groupId: eg, settings: { e2ee: true } }), /permission|admins/i, 'only admins can turn encryption on');
    await call(alice, 'updateGroup', { groupId: eg, settings: { e2ee: true } });
    check((await getDoc(doc(frank.db, 'groups', eg))).data()!.settings.e2ee === true, 'owner turned on end-to-end encryption');

    // A plain (unencrypted) photo is refused once the group is encrypted.
    const plain = await shoot(alice, eg, er);
    await rejects(plain.fin(), /end-to-end encryption/i, 'plain photos are refused in an encrypted group');

    // A sealed photo: the server only sees the header + ciphertext.
    const keyId = 'kAlice_0123456789';
    const iv = Uint8Array.from({ length: 12 }, (_, i) => i);
    const sealedBytes = new Uint8Array([...sealedHeader(keyId, iv), ...crypto.getRandomValues(new Uint8Array(200))]);
    const sealedFin = async (c: Client, kid: string, bytes = sealedBytes) => {
      const res = await call<{ reservationId: string; uploadPrefix: string }>(c, 'reserveExposure', { groupId: eg, rollId: er, requestId: `seal${++reqN}${Date.now()}` });
      for (const v of ['original', 'display', 'thumb']) await uploadBytes(ref(c.st, res.uploadPrefix + v), bytes, { contentType: 'application/octet-stream' });
      const s1 = { width: 1, height: 1 };
      return call<{ photoId: string }>(c, 'finalizeExposure', {
        groupId: eg, rollId: er, reservationId: res.reservationId, e2ee: { keyId: kid }, noteEnc: toBase64(crypto.getRandomValues(new Uint8Array(60))),
        capturedAt: Date.now(), clientNow: Date.now(), preset: 'classic35', sizes: { original: s1, display: s1, thumb: s1 },
      });
    };
    await rejects(sealedFin(alice, 'kSomeoneElse_000'), /sealed correctly/i, 'the sealed header must name the key the client claims');
    await rejects(sealedFin(alice, keyId, JPEG), /sealed correctly/i, 'a plain JPEG can’t pretend to be sealed');
    const sf = await sealedFin(alice, keyId);
    check(!!sf.photoId, 'a sealed photo is accepted');
    await rejects(call(alice, 'setPhotoNote', { groupId: eg, rollId: er, photoId: sf.photoId, caption: 'plain', location: '' }), /invalid note/i, 'an encrypted shot only takes a sealed note');
    await call(alice, 'setPhotoNote', { groupId: eg, rollId: er, photoId: sf.photoId, noteEnc: toBase64(crypto.getRandomValues(new Uint8Array(40))) });
    check(true, 'the sealed note can be updated before development');

    await rollRef(eg, er).update({ status: 'developed', developedAt: Date.now() });
    const pd = (await getDoc(doc(frank.db, 'groups', eg, 'rolls', er, 'photos', sf.photoId))).data()!;
    check(pd.caption === '' && pd.location === '' && typeof pd.noteEnc === 'string' && pd.e2ee?.keyId === keyId, 'the server stores no readable caption or location — only the sealed note');
    const got = new Uint8Array(await (await fetchPhoto(frank, eg, er, sf.photoId, 'original')).arrayBuffer());
    check(got.length === sealedBytes.length && got.every((b, i) => b === sealedBytes[i]), 'after development members get the sealed bytes, untouched, to open on their phones');
    check(!(got[0] === 0xff && got[1] === 0xd8), 'what the server stores and serves is not an image');
    await call(alice, 'updateGroup', { groupId: eg, settings: { e2ee: false } });
    check((await getDoc(doc(frank.db, 'groups', eg))).data()!.settings.e2ee === false, 'encryption can be turned off again (for new photos)');
    await deleteApp(frank.app);
  }

  console.log('\nAnalytics (owner-only)');
  await rejects(call(alice, 'getAnalytics', {}), /permission|not available/i, 'non-admins cannot read analytics');
  check((await call<{ admin: boolean }>(alice, 'amIAdmin', {})).admin === false, 'amIAdmin is false for regular users');
  const admin = await client('admin', 'admin-e2e@example.com');
  check((await call<{ admin: boolean }>(admin, 'amIAdmin', {})).admin === true, 'amIAdmin is true for the configured admin');
  const stats = await call<{ totals: { users: number; photos: number }; daily: { shots: { n: number }[] }; rolls: { presets: { key: string }[] } }>(admin, 'getAnalytics', {});
  check(stats.totals.users >= 5 && stats.totals.photos >= 10 && stats.daily.shots.length === 30 && stats.rolls.presets.length > 0, `admin gets analytics (${stats.totals.users} users, ${stats.totals.photos} photos)`);

  await Promise.all([alice, bob, carol, dave, eve, admin].map((c) => deleteApp(c.app)));
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
