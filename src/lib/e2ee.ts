/**
 * End-to-end encryption for photos and notes.
 *
 * - Every device has its own ECDH P-256 key pair. The private key is created
 *   non-extractable and never leaves this browser (IndexedDB); the public key is
 *   published at users/{uid}/devices/{deviceId}.
 * - Each device makes one random AES-256-GCM "roll key" per roll it shoots on.
 *   Before its first upload, it locks ("wraps") that key for every device of
 *   every member: an ephemeral ECDH exchange + HKDF gives a one-off key that
 *   encrypts the roll key. Wraps live at groups/{g}/rolls/{r}/keys/{keyId}_{deviceId}.
 * - Photos (all three sizes) and notes are encrypted on the phone before upload.
 *   Firebase only stores ciphertext; nobody without a member's device can open it.
 * - A device that joined later asks for keys (groups/{g}/keyRequests); any other
 *   member's app that holds them wraps them for it (see KeySteward).
 * - An optional recovery code (PBKDF2 → AES-GCM) backs up this account's keys,
 *   encrypted, at users/{uid}/private/keyBackup.
 */
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { fromBase64, parseSealed, sealedAad, sealedHeader, toBase64, SEALED_CONTENT_TYPE } from '@shared/sealed';

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => crypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const KEYS_EVENT = 'filmroll:keys';

export class KeyMissingError extends Error {
  constructor() {
    super('Locked — waiting for a friend’s phone to share the key. Keep FilmRoll open, or restore with your recovery code (Profile).');
    this.name = 'KeyMissingError';
  }
}

export function randomId(bytes = 15): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------- storage

interface Device {
  id: string;
  privateKey: CryptoKey;
  publicKey: { x: string; y: string };
}
interface StoredKey {
  keyId: string;
  groupId: string;
  rollId: string;
  raw: ArrayBuffer;
}

const dbs = new Map<string, Promise<IDBDatabase>>();
function idb(uid: string): Promise<IDBDatabase> {
  let p = dbs.get(uid);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(`filmroll-keys-${uid}`, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('keys', { keyPath: 'keyId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    p.catch(() => dbs.delete(uid));
    dbs.set(uid, p);
  }
  return p;
}

async function op<T>(uid: string, store: 'kv' | 'keys', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await idb(uid);
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const kvGet = <T>(uid: string, k: string) => op<T | undefined>(uid, 'kv', 'readonly', (s) => s.get(k));
const kvSet = (uid: string, k: string, v: unknown) => op<void>(uid, 'kv', 'readwrite', (s) => s.put(v, k));
const keyGet = (uid: string, keyId: string) => op<StoredKey | undefined>(uid, 'keys', 'readonly', (s) => s.get(keyId));
const keyAll = (uid: string) => op<StoredKey[]>(uid, 'keys', 'readonly', (s) => s.getAll());

async function keyPut(uid: string, k: StoredKey) {
  await op(uid, 'keys', 'readwrite', (s) => s.put(k));
  dispatchEvent(new Event(KEYS_EVENT));
  scheduleBackup(uid);
}

// ---------------------------------------------------------------- device

const devices = new Map<string, Promise<Device>>();

/** This browser's device key pair (made on first use) and its public key in Firestore. */
export function myDevice(uid: string): Promise<Device> {
  let p = devices.get(uid);
  if (!p) {
    p = (async () => {
      let d = await kvGet<Device>(uid, 'device');
      if (!d) {
        const pair = await subtle().generateKey(EC, false, ['deriveBits']);
        const jwk = await subtle().exportKey('jwk', pair.publicKey);
        d = { id: randomId(12), privateKey: pair.privateKey, publicKey: { x: jwk.x!, y: jwk.y! } };
        await kvSet(uid, 'device', d);
      }
      const ref = doc(db, 'users', uid, 'devices', d.id);
      if (!(await getDoc(ref)).exists()) await setDoc(ref, { id: d.id, publicKey: d.publicKey, createdAt: Date.now() });
      return d;
    })();
    p.catch(() => devices.delete(uid));
    devices.set(uid, p);
  }
  return p;
}

const importPublic = (k: { x: string; y: string }) => subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y, ext: true }, EC, true, []);

async function wrappingKey(shared: ArrayBuffer): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('filmroll-wrap-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

interface WrapDoc {
  keyId: string;
  deviceId: string;
  uid: string;
  from: string;
  eph: { x: string; y: string };
  iv: string;
  wrapped: string;
  createdAt: number;
}

/** Locks a roll key so only `recipient`'s device can open it. */
async function wrapFor(raw: ArrayBuffer, keyId: string, recipient: { id: string; publicKey: { x: string; y: string } }) {
  const eph = await subtle().generateKey(EC, true, ['deriveBits']);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: await importPublic(recipient.publicKey) }, eph.privateKey, 256);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`${keyId}|${recipient.id}`) }, await wrappingKey(shared), raw);
  const e = await subtle().exportKey('jwk', eph.publicKey);
  return { eph: { x: e.x!, y: e.y! }, iv: toBase64(iv), wrapped: toBase64(new Uint8Array(ct)) };
}

async function unwrap(w: WrapDoc, me: Device): Promise<ArrayBuffer> {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: await importPublic(w.eph) }, me.privateKey, 256);
  return subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(w.iv), additionalData: te.encode(`${w.keyId}|${me.id}`) }, await wrappingKey(shared), fromBase64(w.wrapped));
}

// ---------------------------------------------------------------- roll keys

interface MemberDevice {
  uid: string;
  id: string;
  publicKey: { x: string; y: string };
}

async function memberDevices(gid: string): Promise<MemberDevice[]> {
  const members = await getDocs(collection(db, 'groups', gid, 'members'));
  const lists = await Promise.all(members.docs.map(async (m) => (await getDocs(collection(db, 'users', m.id, 'devices'))).docs.map((d) => ({ uid: m.id, ...(d.data() as { id: string; publicKey: { x: string; y: string } }) }))));
  return lists.flat().filter((d) => d.id && d.publicKey?.x && d.publicKey?.y);
}

const wrapsCol = (gid: string, rid: string) => collection(db, 'groups', gid, 'rolls', rid, 'keys');
const lastShared = new Map<string, number>();

/** Makes sure every current member device can open `key` (wraps it for the ones that can't yet). */
export async function shareKey(uid: string, key: StoredKey, force = false): Promise<number> {
  if (!force && Date.now() - (lastShared.get(key.keyId) ?? 0) < 5 * 60_000) return 0;
  const [targets, existing] = await Promise.all([memberDevices(key.groupId), getDocs(query(wrapsCol(key.groupId, key.rollId), where('keyId', '==', key.keyId)))]);
  const have = new Set(existing.docs.map((d) => (d.data() as WrapDoc).deviceId));
  const missing = targets.filter((t) => !have.has(t.id));
  await Promise.all(missing.map(async (t) => {
    const w = await wrapFor(key.raw, key.keyId, t);
    await setDoc(doc(wrapsCol(key.groupId, key.rollId), `${key.keyId}_${t.id}`), { keyId: key.keyId, deviceId: t.id, uid: t.uid, from: uid, ...w, createdAt: Date.now() } satisfies WrapDoc).catch(() => undefined);
  }));
  lastShared.set(key.keyId, Date.now());
  return missing.length;
}

/** This device's key for shooting on a roll (made, and shared with the group, on first use). */
export async function senderKey(uid: string, gid: string, rid: string): Promise<StoredKey> {
  await myDevice(uid);
  const keyId = await kvGet<string>(uid, `sender:${rid}`);
  let key = keyId ? await keyGet(uid, keyId) : undefined;
  if (!key) {
    const raw = crypto.getRandomValues(new Uint8Array(32)).buffer;
    key = { keyId: randomId(), groupId: gid, rollId: rid, raw };
    await keyPut(uid, key);
    await kvSet(uid, `sender:${rid}`, key.keyId);
    await shareKey(uid, key, true);
  } else {
    await shareKey(uid, key); // friends who joined (or new phones) since the last shot
  }
  return key;
}

const aesKeys = new Map<string, Promise<CryptoKey>>();
const aes = (k: StoredKey) => {
  let p = aesKeys.get(k.keyId);
  if (!p) {
    p = subtle().importKey('raw', k.raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    aesKeys.set(k.keyId, p);
  }
  return p;
};

/** A key from this device, or from a wrap addressed to it. Null if neither exists yet. */
async function findKey(uid: string, gid: string, rid: string, keyId: string): Promise<StoredKey | null> {
  const local = await keyGet(uid, keyId);
  if (local) return local;
  const me = await myDevice(uid);
  const snap = await getDoc(doc(wrapsCol(gid, rid), `${keyId}_${me.id}`)).catch(() => null);
  if (!snap?.exists()) return null;
  const raw = await unwrap(snap.data() as WrapDoc, me);
  const k = { keyId, groupId: gid, rollId: rid, raw };
  await keyPut(uid, k);
  return k;
}

const pendingKeys = new Map<string, Promise<StoredKey>>();

/** The key `keyId` for opening a photo; asks the group for it (and waits a little) if this device doesn't have it. */
export function getKey(uid: string, gid: string, rid: string, keyId: string, waitMs = 20_000): Promise<StoredKey> {
  let p = pendingKeys.get(keyId);
  if (!p) {
    p = (async () => {
      const found = await findKey(uid, gid, rid, keyId);
      if (found) return found;
      const me = await myDevice(uid);
      await setDoc(
        doc(db, 'groups', gid, 'keyRequests', `${me.id}_${rid}`),
        { groupId: gid, rollId: rid, uid, deviceId: me.id, keyIds: arrayUnion(keyId), createdAt: Date.now() },
        { merge: true },
      ).catch(() => undefined);
      // Wait for a friend's app to wrap it for us.
      const got = await new Promise<StoredKey | null>((resolve) => {
        const timer = setTimeout(() => {
          unsub();
          resolve(null);
        }, waitMs);
        const unsub = onSnapshot(doc(wrapsCol(gid, rid), `${keyId}_${me.id}`), (s) => {
          if (!s.exists()) return;
          clearTimeout(timer);
          unsub();
          findKey(uid, gid, rid, keyId).then(resolve, () => resolve(null));
        }, () => undefined);
      });
      if (!got) throw new KeyMissingError();
      return got;
    })();
    p.finally(() => pendingKeys.delete(keyId)).catch(() => undefined);
    pendingKeys.set(keyId, p);
  }
  return p;
}

// ---------------------------------------------------------------- sealing

export async function seal(key: StoredKey, data: BufferSource, aad: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, await aes(key), data));
  const head = sealedHeader(key.keyId, iv);
  const out = new Uint8Array(head.length + ct.length);
  out.set(head);
  out.set(ct, head.length);
  return out;
}

export async function sealBlob(key: StoredKey, blob: Blob, gid: string, rid: string, purpose: 'original' | 'display' | 'thumb'): Promise<Blob> {
  const bytes = await seal(key, await blob.arrayBuffer(), sealedAad(gid, rid, purpose));
  return new Blob([bytes as BlobPart], { type: SEALED_CONTENT_TYPE });
}

export async function sealNote(key: StoredKey, gid: string, rid: string, note: { caption: string; location: string }): Promise<string> {
  return toBase64(await seal(key, te.encode(JSON.stringify({ c: note.caption, l: note.location })), sealedAad(gid, rid, 'note')));
}

async function open(uid: string, gid: string, rid: string, bytes: Uint8Array<ArrayBuffer>, purpose: 'original' | 'display' | 'thumb' | 'note'): Promise<ArrayBuffer> {
  const parts = parseSealed(bytes);
  if (!parts) throw new Error('This photo is damaged.');
  const key = await getKey(uid, gid, rid, parts.keyId);
  try {
    return await subtle().decrypt({ name: 'AES-GCM', iv: parts.iv, additionalData: te.encode(sealedAad(gid, rid, purpose)) }, await aes(key), bytes.subarray(parts.bodyStart));
  } catch {
    throw new Error('This photo couldn’t be unlocked.');
  }
}

export async function openBlob(uid: string, gid: string, rid: string, bytes: Uint8Array<ArrayBuffer>, purpose: 'original' | 'display' | 'thumb'): Promise<Blob> {
  return new Blob([await open(uid, gid, rid, bytes, purpose)], { type: 'image/jpeg' });
}

export async function openNote(uid: string, gid: string, rid: string, b64: string): Promise<{ caption: string; location: string }> {
  const o = JSON.parse(td.decode(await open(uid, gid, rid, fromBase64(b64), 'note'))) as { c?: unknown; l?: unknown };
  return { caption: typeof o.c === 'string' ? o.c : '', location: typeof o.l === 'string' ? o.l : '' };
}

// ---------------------------------------------------------------- key requests (other devices)

interface KeyRequest {
  groupId: string;
  rollId: string;
  uid: string;
  deviceId: string;
  keyIds: string[];
}

/** Wraps any requested keys this device holds for the asking device (a current member's). */
export async function fulfill(uid: string, reqId: string, r: KeyRequest): Promise<number> {
  const me = await myDevice(uid);
  if (r.deviceId === me.id || !r.keyIds?.length) return 0;
  const [member, device] = await Promise.all([getDoc(doc(db, 'groups', r.groupId, 'members', r.uid)), getDoc(doc(db, 'users', r.uid, 'devices', r.deviceId))]);
  if (!member.exists() || !device.exists()) return 0;
  const target = { id: r.deviceId, publicKey: (device.data() as { publicKey: { x: string; y: string } }).publicKey };
  const done: string[] = [];
  for (const keyId of r.keyIds.slice(0, 50)) {
    const k = await findKey(uid, r.groupId, r.rollId, keyId).catch(() => null);
    // only keys of the roll that was asked about
    if (!k || k.groupId !== r.groupId || k.rollId !== r.rollId) continue;
    const w = await wrapFor(k.raw, keyId, target);
    await setDoc(doc(wrapsCol(r.groupId, r.rollId), `${keyId}_${r.deviceId}`), { keyId, deviceId: r.deviceId, uid: r.uid, from: uid, ...w, createdAt: Date.now() } satisfies WrapDoc).catch(() => undefined);
    done.push(keyId);
  }
  if (done.length) {
    const ref = doc(db, 'groups', r.groupId, 'keyRequests', reqId);
    if (done.length === r.keyIds.length) await deleteDoc(ref).catch(() => undefined);
    else await updateDoc(ref, { keyIds: arrayRemove(...done) }).catch(() => undefined);
  }
  return done.length;
}

/** Listens for key requests in the user's groups and answers them. Returns an unsubscribe. */
export function watchKeyRequests(uid: string, groupIds: string[]): () => void {
  const unsubs = groupIds.map((gid) =>
    onSnapshot(collection(db, 'groups', gid, 'keyRequests'), (s) => {
      for (const ch of s.docChanges()) {
        if (ch.type === 'removed') continue;
        void fulfill(uid, ch.doc.id, ch.doc.data() as KeyRequest).catch(() => undefined);
      }
    }, () => undefined),
  );
  return () => unsubs.forEach((u) => u());
}

// ---------------------------------------------------------------- recovery code

const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const backupRef = (uid: string) => doc(db, 'users', uid, 'private', 'keyBackup');

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function backupKeyFrom(uid: string, code: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', te.encode(normalizeRecoveryCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(`filmroll-backup-v1:${uid}`), iterations: 600_000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

interface BackupDoc {
  iv: string;
  data: string;
  count: number;
  updatedAt: number;
}
type Bundle = Record<string, { g: string; r: string; k: string }>;

async function readBackup(uid: string, bk: CryptoKey): Promise<Bundle | null> {
  const s = await getDoc(backupRef(uid));
  if (!s.exists()) return null;
  const b = s.data() as BackupDoc;
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(b.iv), additionalData: te.encode(`backup|${uid}`) }, bk, fromBase64(b.data));
  return JSON.parse(td.decode(plain)) as Bundle;
}

/** Re-encrypts all known keys into the backup (merging what's there already). */
export async function writeBackup(uid: string): Promise<number> {
  const bk = await kvGet<CryptoKey>(uid, 'backupKey');
  if (!bk) return 0;
  const bundle: Bundle = (await readBackup(uid, bk).catch(() => null)) ?? {};
  for (const k of await keyAll(uid)) bundle[k.keyId] = { g: k.groupId, r: k.rollId, k: toBase64(new Uint8Array(k.raw)) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`backup|${uid}`) }, bk, te.encode(JSON.stringify(bundle)));
  const count = Object.keys(bundle).length;
  await setDoc(backupRef(uid), { iv: toBase64(iv), data: toBase64(new Uint8Array(ct)), count, updatedAt: Date.now() } satisfies BackupDoc);
  return count;
}

const backupTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleBackup(uid: string) {
  clearTimeout(backupTimers.get(uid));
  backupTimers.set(uid, setTimeout(() => void writeBackup(uid).catch(() => undefined), 3000));
}

/** Makes a new recovery code and backs up every key this device holds with it. Shown to the user once. */
export async function createRecoveryCode(uid: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const code = Array.from(bytes, (b) => BACKUP_ALPHABET[b % 32]).join(''); // 24 × 5 bits = 120 bits
  const bk = await backupKeyFrom(uid, code);
  // A new code replaces the old backup: start from what this device knows, plus the old backup if we can still read it.
  const old = await kvGet<CryptoKey>(uid, 'backupKey');
  const previous = old ? await readBackup(uid, old).catch(() => null) : null;
  if (previous) await importBundle(uid, previous);
  await kvSet(uid, 'backupKey', bk);
  await writeBackup(uid);
  return code.match(/.{4}/g)!.join('-');
}

async function importBundle(uid: string, b: Bundle): Promise<number> {
  let n = 0;
  for (const [keyId, v] of Object.entries(b)) {
    if (await keyGet(uid, keyId)) continue;
    await op(uid, 'keys', 'readwrite', (s) => s.put({ keyId, groupId: v.g, rollId: v.r, raw: fromBase64(v.k).buffer } satisfies StoredKey));
    n++;
  }
  dispatchEvent(new Event(KEYS_EVENT));
  return n;
}

/** Restores keys on this device from the recovery code. Returns how many keys were restored. */
export async function restoreFromCode(uid: string, code: string): Promise<number> {
  const bk = await backupKeyFrom(uid, code);
  let bundle: Bundle | null;
  try {
    bundle = await readBackup(uid, bk);
  } catch {
    throw new Error('That recovery code doesn’t match.');
  }
  if (!bundle) throw new Error('There’s no backup for this account yet.');
  await kvSet(uid, 'backupKey', bk);
  const n = await importBundle(uid, bundle);
  scheduleBackup(uid); // add anything only this device knew
  return n;
}

export async function encryptionStatus(uid: string): Promise<{ deviceId: string; keys: number; backup: { count: number; updatedAt: number } | null; linked: boolean }> {
  const [d, keys, s, bk] = await Promise.all([myDevice(uid), keyAll(uid), getDoc(backupRef(uid)).catch(() => null), kvGet<CryptoKey>(uid, 'backupKey')]);
  const b = s?.exists() ? (s.data() as BackupDoc) : null;
  return { deviceId: d.id, keys: keys.length, backup: b ? { count: b.count, updatedAt: b.updatedAt } : null, linked: !!bk };
}
