/** Uploads shots that waited in the offline queue: on start, when the connection returns, and every minute while any are waiting. */
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui';
import { Shot } from './shot';
import { listQueued, removeQueued, updateQueued } from './queue';

let running = false;

export async function syncQueue(uid: string): Promise<{ saved: number; lost: number }> {
  const out = { saved: 0, lost: 0 };
  if (running || !navigator.onLine) return out;
  running = true;
  try {
    for (const q of await listQueued(uid)) {
      const s = new Shot({
        uid, groupId: q.groupId, rollId: q.rollId, preset: q.preset, dateStamp: false, capturedAt: q.capturedAt,
        processed: q.photo, requestId: q.requestId, queued: true, onChange: () => undefined,
      });
      s.setNote(q.caption, q.location);
      await s.start();
      await s.commit();
      const snap = s.snapshot;
      if (snap.state === 'saved' || /already added/i.test(snap.error ?? '')) {
        await removeQueued(q.id);
        out.saved++;
      } else if (s.networkFailure) {
        await updateQueued({ ...q, attempts: q.attempts + 1 });
        break; // still offline-ish: try again later
      } else {
        // the roll filled up or developed meanwhile, or the shot is too old: it can't go anywhere
        await removeQueued(q.id);
        out.lost++;
      }
    }
  } finally {
    running = false;
  }
  return out;
}

export function QueueSync() {
  const { user } = useAuth();
  const toast = useToast();
  useEffect(() => {
    if (!user) return;
    const run = () =>
      syncQueue(user.uid).then(({ saved, lost }) => {
        if (saved) toast(saved === 1 ? 'Your offline shot is on the roll now.' : `${saved} offline shots are on the roll now.`);
        if (lost) toast(lost === 1 ? 'A shot taken offline couldn’t be added — the roll had already filled up or developed.' : `${lost} offline shots couldn’t be added — their roll had filled up or developed.`, 'error');
      });
    run();
    const onVis = () => !document.hidden && run();
    addEventListener('online', run);
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(run, 60_000);
    return () => {
      removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [user, toast]);
  return null;
}
