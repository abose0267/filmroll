/**
 * Offline shots. When there's no connection (or a save keeps failing because
 * of the network) the processed shot is kept on this device in IndexedDB and
 * uploaded automatically when the connection returns.
 */
import { useEffect, useState } from 'react';
import type { ProcessedPhoto } from './image';
import type { PresetId } from '@shared/types';

export interface QueuedShot {
  id: string;
  uid: string;
  groupId: string;
  rollId: string;
  preset: PresetId;
  capturedAt: number;
  caption: string;
  location: string;
  /** Stable request id so retries reuse the same exposure reservation. */
  requestId: string;
  photo: ProcessedPhoto;
  queuedAt: number;
  attempts: number;
}

const DB = 'filmroll';
const STORE = 'queue';
const EVENT = 'filmroll:queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => dispatchEvent(new Event(EVENT));

export async function enqueue(item: QueuedShot): Promise<void> {
  await tx('readwrite', (s) => s.put(item));
  changed();
}

export async function listQueued(uid: string): Promise<QueuedShot[]> {
  try {
    const all = (await tx('readonly', (s) => s.getAll())) as QueuedShot[];
    return all.filter((q) => q.uid === uid).sort((a, b) => a.capturedAt - b.capturedAt);
  } catch {
    return [];
  }
}

export async function updateQueued(item: QueuedShot): Promise<void> {
  await tx('readwrite', (s) => s.put(item));
}

export async function removeQueued(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  changed();
}

/** Live list of this user's waiting shots. */
export function useQueue(uid: string | undefined): QueuedShot[] {
  const [items, setItems] = useState<QueuedShot[]>([]);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const load = () => listQueued(uid).then((q) => alive && setItems(q));
    load();
    addEventListener(EVENT, load);
    return () => {
      alive = false;
      removeEventListener(EVENT, load);
    };
  }, [uid]);
  return items;
}

export function notifyQueueChanged() {
  changed();
}

/** Errors that mean "no connection" rather than "the server said no". */
export function isNetworkError(code: string, message: string): boolean {
  return !navigator.onLine || ['functions/unavailable', 'functions/deadline-exceeded-network', 'storage/retry-limit-exceeded', 'storage/unknown', 'unavailable'].includes(code) || /network|offline|Failed to fetch/i.test(message);
}
