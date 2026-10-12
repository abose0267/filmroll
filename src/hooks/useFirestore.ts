import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';

export interface Live<T> { data: T; loading: boolean; error: string | null }

/** Live document. Pass null to skip. `key` must change when the ref changes. */
export function useDoc<T>(ref: DocumentReference | null, key: string): Live<T | null> {
  const [s, set] = useState<Live<T | null>>({ data: null, loading: !!ref, error: null });
  useEffect(() => {
    if (!ref) {
      set({ data: null, loading: false, error: null });
      return;
    }
    set((p) => ({ ...p, loading: true }));
    return onSnapshot(
      ref,
      (snap) => set({ data: snap.exists() ? (snap.data() as T) : null, loading: false, error: null }),
      (e) => set({ data: null, loading: false, error: e.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s;
}

export function useCollection<T>(q: Query | null, key: string): Live<T[]> {
  const [s, set] = useState<Live<T[]>>({ data: [], loading: !!q, error: null });
  useEffect(() => {
    if (!q) {
      set({ data: [], loading: false, error: null });
      return;
    }
    set((p) => ({ ...p, loading: true }));
    return onSnapshot(
      q,
      (snap) => set({ data: snap.docs.map((d) => d.data() as T), loading: false, error: null }),
      (e) => set({ data: [], loading: false, error: e.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s;
}
