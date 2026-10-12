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
import { rollRef } from '../functions/src/admin';
import { DEFAULT_NOTIFICATION_PREFS, RESERVATION_TTL_MS } from '../shared/constants';
import type { RollDoc } from '../shared/types';

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

async function client(name: string): Promise<Client> {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com`, appId: 'demo' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fn = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(fn, '127.0.0.1', 5001);
  const st = getStorage(app);
  connectStorageEmulator(st, '127.0.0.1', 9199);
  const cred = await createUserWithEmailAndPassword(auth, `${name}-${Date.now()}@example.com`, 'password123');
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
function finalize(c: Client, gid: string, rid: string, reservationId: string, caption: string) {
  const s = { width: 1, height: 1 };
  return call<{ photoId: string; duplicate: boolean; remaining: number; status: string }>(c, 'finalizeExposure', {
    groupId: gid, rollId: rid, reservationId, caption, location: 'Somewhere', capturedAt: Date.now(), preset: 'warmVintage', sizes: { original: s, display: s, thumb: s },
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
  const [alice, bob, carol, dave] = await Promise.all(['alice', 'bob', 'carol', 'dave'].map(client));
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
  const f1 = await finalize(alice, gid, r1, a.reservationId, 'my secret coffee');
  const f1b = await finalize(alice, gid, r1, a.reservationId, 'my secret coffee');
  check(f1b.duplicate && f1b.photoId === f1.photoId, 'finalizing twice is idempotent');
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
  check(own.caption === 'my secret coffee', 'captions revealed after development');
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

  await Promise.all([alice, bob, carol, dave, eve].map((c) => deleteApp(c.app)));
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
