/**
 * Loads developed photos from the authorization-checked photo endpoint using
 * the user's ID token. Results live only in memory (object URLs); nothing is
 * written to a service-worker or shared cache.
 */
import { useEffect, useState } from 'react';
import { auth, photoEndpoint } from './firebase';
import { KEYS_EVENT, openBlob } from './e2ee';
import { isSealed } from '@shared/sealed';

export type PhotoVariant = 'thumb' | 'display' | 'original';

const cache = new Map<string, Promise<string>>();
const MAX_PARALLEL = 4;
let active = 0;
const queue: (() => void)[] = [];

function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    const go = () => {
      active++;
      resolve(() => {
        active--;
        queue.shift()?.();
      });
    };
    if (active < MAX_PARALLEL) go();
    else queue.push(go);
  });
}

export function photoUrl(gid: string, rid: string, pid: string, v: PhotoVariant, download = false): string {
  const q = new URLSearchParams({ g: gid, r: rid, p: pid, v });
  if (download) q.set('download', '1');
  return `${photoEndpoint}?${q}`;
}

export async function fetchPhotoBlob(gid: string, rid: string, pid: string, v: PhotoVariant, download = false): Promise<Blob> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to see photos.');
  const release = await slot();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await user.getIdToken(attempt > 0);
      const res = await fetch(photoUrl(gid, rid, pid, v, download), { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) {
        const blob = await res.blob();
        // End-to-end encrypted photos are opened here, on the device.
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return isSealed(bytes) ? await openBlob(user.uid, gid, rid, bytes, v) : blob;
      }
      if (res.status === 401 && attempt === 0) continue;
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw new Error(res.status === 403 ? 'This photo isn’t available to you.' : 'Couldn’t load this photo.');
    }
    throw new Error('Couldn’t load this photo.');
  } finally {
    release();
  }
}

export function loadPhoto(gid: string, rid: string, pid: string, v: PhotoVariant): Promise<string> {
  const key = `${gid}/${rid}/${pid}/${v}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchPhotoBlob(gid, rid, pid, v).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Drops cached photo URLs (e.g. on sign-out). */
export function clearPhotoCache() {
  for (const p of cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  cache.clear();
}

export function usePhoto(gid: string | undefined, rid: string | undefined, pid: string | undefined, v: PhotoVariant, enabled = true) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!gid || !rid || !pid || !enabled) return;
    let alive = true;
    setState({ url: null, error: null });
    let failed = false;
    const load = () =>
      loadPhoto(gid, rid, pid, v).then(
        (url) => {
          failed = false;
          if (alive) setState({ url, error: null });
        },
        (e: Error) => {
          failed = true;
          if (alive) setState({ url: null, error: e.message });
        },
      );
    void load();
    // A locked photo opens as soon as its key arrives (from a friend's phone or the recovery code).
    const retry = () => {
      if (failed) void load();
    };
    addEventListener(KEYS_EVENT, retry);
    return () => {
      alive = false;
      removeEventListener(KEYS_EVENT, retry);
    };
  }, [gid, rid, pid, v, enabled]);
  return state;
}
