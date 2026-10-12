import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { DEFAULT_NOTIFICATION_PREFS } from '../../shared/constants';

let env: RulesTestEnvironment;
const G = 'g1';
const OTHER = 'g2';
const T0 = Date.UTC(2026, 0, 1);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-filmroll-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
afterAll(async () => env.cleanup());

function rollDoc(id: string, status: string, createdAt = T0) {
  return { id, groupId: G, name: id, capacity: 24, status, createdAt, exposuresUsed: 1, exposuresReserved: 0, contributors: { alice: 1 } };
}

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', G), { id: G, name: 'The Crew', settings: { shareHistory: true, rollCreators: 'everyone' }, activeRollId: 'active' });
    await setDoc(doc(db, 'groups', OTHER), { id: OTHER, name: 'Other', settings: { shareHistory: true, rollCreators: 'everyone' } });
    await setDoc(doc(db, 'groups', G, 'members', 'alice'), { uid: 'alice', role: 'owner', joinedAt: T0 - 1000, displayName: 'Alice' });
    await setDoc(doc(db, 'groups', G, 'members', 'bob'), { uid: 'bob', role: 'member', joinedAt: T0 - 1000, displayName: 'Bob' });
    await setDoc(doc(db, 'groups', OTHER, 'members', 'eve'), { uid: 'eve', role: 'owner', joinedAt: T0, displayName: 'Eve' });
    await setDoc(doc(db, 'groups', G, 'private', 'invite'), { code: 'ABCDEFGH' });
    await setDoc(doc(db, 'invites', 'ABCDEFGH'), { groupId: G });
    for (const [id, status] of [['active', 'active'], ['dev', 'developed']] as const) {
      await setDoc(doc(db, 'groups', G, 'rolls', id), rollDoc(id, status));
      await setDoc(doc(db, 'groups', G, 'rolls', id, 'photos', 'p1'), { id: 'p1', uid: 'alice', caption: 'secret coffee', location: 'Austin' });
      await setDoc(doc(db, 'groups', G, 'rolls', id, 'reservations', 'r1'), { uid: 'alice', status: 'pending' });
    }
    await setDoc(doc(db, 'users', 'alice'), { uid: 'alice', displayName: 'Alice', groupIds: [G] });
    await setDoc(doc(db, 'users', 'alice', 'notifications', 'n1'), { id: 'n1', title: 'hi', read: false });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const store = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();

describe('hidden photos before development', () => {
  it('nobody — including the uploader — can read undeveloped photo records', async () => {
    await assertFails(getDoc(doc(as('alice'), 'groups', G, 'rolls', 'active', 'photos', 'p1')));
    await assertFails(getDoc(doc(as('bob'), 'groups', G, 'rolls', 'active', 'photos', 'p1')));
    await assertFails(getDocs(collection(as('bob'), 'groups', G, 'rolls', 'active', 'photos')));
  });

  it('members can read photos once developed', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'photos', 'p1')));
    await assertSucceeds(getDocs(collection(as('bob'), 'groups', G, 'rolls', 'dev', 'photos')));
  });

  it('members can read roll metadata (counts) but not reservations', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'groups', G, 'rolls', 'active')));
    await assertFails(getDoc(doc(as('alice'), 'groups', G, 'rolls', 'active', 'reservations', 'r1')));
  });

  it('new members cannot see older rolls when history sharing is off', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'groups', G), { 'settings.shareHistory': false });
      await setDoc(doc(ctx.firestore(), 'groups', G, 'members', 'carol'), { uid: 'carol', role: 'member', joinedAt: T0 + 5000, displayName: 'Carol' });
    });
    await assertFails(getDoc(doc(as('carol'), 'groups', G, 'rolls', 'dev', 'photos', 'p1')));
    await assertSucceeds(getDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'photos', 'p1')));
  });
});

describe('cross-group and outsider access', () => {
  it('outsiders and other groups cannot read anything', async () => {
    for (const who of [null, 'eve']) {
      await assertFails(getDoc(doc(as(who), 'groups', G)));
      await assertFails(getDoc(doc(as(who), 'groups', G, 'members', 'alice')));
      await assertFails(getDoc(doc(as(who), 'groups', G, 'rolls', 'dev')));
      await assertFails(getDoc(doc(as(who), 'groups', G, 'rolls', 'dev', 'photos', 'p1')));
    }
  });

  it('invite codes and private group data are server-only', async () => {
    await assertFails(getDoc(doc(as('alice'), 'invites', 'ABCDEFGH')));
    await assertFails(getDoc(doc(as('alice'), 'groups', G, 'private', 'invite')));
  });

  it('users can only read their own profile and notifications', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users', 'alice')));
    await assertFails(getDoc(doc(as('bob'), 'users', 'alice')));
    await assertFails(getDoc(doc(as('bob'), 'users', 'alice', 'notifications', 'n1')));
    await assertSucceeds(updateDoc(doc(as('alice'), 'users', 'alice', 'notifications', 'n1'), { read: true }));
    await assertFails(updateDoc(doc(as('alice'), 'users', 'alice', 'notifications', 'n1'), { title: 'forged' }));
  });
});

describe('no client manipulation of trusted state', () => {
  it('members cannot change exposure counts, status or ownership', async () => {
    const r = doc(as('alice'), 'groups', G, 'rolls', 'active');
    await assertFails(updateDoc(r, { exposuresUsed: 0 }));
    await assertFails(updateDoc(r, { status: 'developed' }));
    await assertFails(updateDoc(doc(as('alice'), 'groups', G, 'rolls', 'active', 'photos', 'p1'), { uid: 'bob' }));
    await assertFails(setDoc(doc(as('alice'), 'groups', G, 'rolls', 'active', 'photos', 'p2'), { uid: 'alice' }));
    await assertFails(setDoc(doc(as('alice'), 'groups', G, 'rolls', 'new'), rollDoc('new', 'active')));
    await assertFails(updateDoc(doc(as('bob'), 'groups', G, 'members', 'bob'), { role: 'owner' }));
    await assertFails(setDoc(doc(as('eve'), 'groups', G, 'members', 'eve'), { uid: 'eve', role: 'member' }));
  });

  it('users cannot change their group list', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { groupIds: [G, OTHER] }));
  });

  it('profile creation is validated', async () => {
    const good = { uid: 'dan', displayName: 'Dan', photoURL: null, city: '', bio: '', createdAt: Date.now(), onboarded: false, groupIds: [], notificationPrefs: DEFAULT_NOTIFICATION_PREFS, showMemories: true };
    await assertSucceeds(setDoc(doc(as('dan'), 'users', 'dan'), good));
    await assertFails(setDoc(doc(as('fay'), 'users', 'fay'), { ...good, uid: 'fay', groupIds: [G] }));
    await assertFails(setDoc(doc(as('gus'), 'users', 'gus'), { ...good, uid: 'gus', displayName: '' }));
  });
});

describe('comments and reactions', () => {
  const comment = (uid: string, name: string, photoId = 'p1') => ({ id: 'c1', photoId, uid, displayName: name, photoURL: null, text: 'love this', createdAt: Date.now() });

  it('only on developed rolls, as yourself, on existing photos', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('bob', 'Bob')));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'active', 'comments', 'c1'), comment('bob', 'Bob')));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('alice', 'Alice')));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('bob', 'Not Bob')));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('bob', 'Bob', 'missing')));
    await assertFails(setDoc(doc(as('eve'), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('eve', 'Eve')));
  });

  it('comment authors and admins can delete; others cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', G, 'rolls', 'dev', 'comments', 'c1'), comment('alice', 'Alice'));
      await setDoc(doc(ctx.firestore(), 'groups', G, 'rolls', 'dev', 'comments', 'c2'), { ...comment('bob', 'Bob'), id: 'c2' });
    });
    await assertFails(deleteDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c1')));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'comments', 'c2')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'groups', G, 'rolls', 'dev', 'comments', 'c1')));
  });

  it('one valid emoji reaction per person per photo', async () => {
    const r = { photoId: 'p1', uid: 'bob', emoji: '🥹', createdAt: Date.now() };
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'reactions', 'p1_bob'), r));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'reactions', 'p1_alice'), r));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'dev', 'reactions', 'p1_bob'), { ...r, emoji: '💩' }));
    await assertFails(setDoc(doc(as('bob'), 'groups', G, 'rolls', 'active', 'reactions', 'p1_bob'), r));
  });

  it('favorites only for visible photos', async () => {
    const f = (rollId: string) => ({ groupId: G, rollId, photoId: 'p1', createdAt: Date.now() });
    await assertSucceeds(setDoc(doc(as('bob'), 'users', 'bob', 'favorites', 'dev_p1'), f('dev')));
    await assertFails(setDoc(doc(as('bob'), 'users', 'bob', 'favorites', 'active_p1'), f('active')));
    await assertFails(setDoc(doc(as('eve'), 'users', 'eve', 'favorites', 'dev_p1'), f('dev')));
  });
});

describe('storage', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  it('owners can upload their own exposure files but nobody can read them', async () => {
    await assertSucceeds(uploadBytes(ref(store('alice'), 'uploads/alice/res1/thumb'), jpeg, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(store('bob'), 'uploads/alice/res1/thumb'), jpeg, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(store('alice'), 'uploads/alice/res1/other'), jpeg, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(store('alice'), 'uploads/alice/res1/thumb'), jpeg, { contentType: 'text/html' }));
    await assertFails(getBytes(ref(store('alice'), 'uploads/alice/res1/thumb')));
  });

  it('photos are never directly readable or writable by clients', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `photos/${G}/dev/p1/thumb`), jpeg, { contentType: 'image/jpeg' });
    });
    await assertFails(getBytes(ref(store('alice'), `photos/${G}/dev/p1/thumb`)));
    await assertFails(getBytes(ref(store('bob'), `photos/${G}/dev/p1/thumb`)));
    await assertFails(uploadBytes(ref(store('alice'), `photos/${G}/dev/p9/thumb`), jpeg, { contentType: 'image/jpeg' }));
  });

  it('avatars: owner write, signed-in read', async () => {
    await assertSucceeds(uploadBytes(ref(store('alice'), 'avatars/alice/a.jpg'), jpeg, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(store('bob'), 'avatars/alice/b.jpg'), jpeg, { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(store('bob'), 'avatars/alice/a.jpg')));
    await assertFails(getBytes(ref(store(null), 'avatars/alice/a.jpg')));
  });
});
