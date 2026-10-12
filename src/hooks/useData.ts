import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './useAuth';
import { useCollection, useDoc } from './useFirestore';
import type { CommentDoc, FavoriteDoc, GroupDoc, MemberDoc, NotificationDoc, PhotoDoc, ReactionDoc, RollDoc } from '@shared/types';

/** All of the user's groups, live, in their profile order. */
export function useMyGroups(): { groups: GroupDoc[]; loading: boolean } {
  const { profile } = useAuth();
  const ids = profile?.groupIds ?? [];
  const key = ids.join(',');
  const [map, setMap] = useState<Record<string, GroupDoc | null>>({});
  useEffect(() => {
    setMap((m) => Object.fromEntries(Object.entries(m).filter(([k]) => ids.includes(k))));
    const unsubs = ids.map((gid) =>
      onSnapshot(
        doc(db, 'groups', gid),
        (s) => setMap((m) => ({ ...m, [gid]: s.exists() ? (s.data() as GroupDoc) : null })),
        () => setMap((m) => ({ ...m, [gid]: null })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const groups = ids.map((id) => map[id]).filter((g): g is GroupDoc => !!g);
  return { groups, loading: ids.some((id) => !(id in map)) };
}

export function useGroup(gid: string | undefined) {
  return useDoc<GroupDoc>(gid ? doc(db, 'groups', gid) : null, `g/${gid}`);
}

export function useMembers(gid: string | undefined) {
  return useCollection<MemberDoc>(gid ? query(collection(db, 'groups', gid, 'members'), orderBy('joinedAt')) : null, `m/${gid}`);
}

export function useMyMembership(gid: string | undefined) {
  const { user } = useAuth();
  return useDoc<MemberDoc>(gid && user ? doc(db, 'groups', gid, 'members', user.uid) : null, `mm/${gid}/${user?.uid}`);
}

export function useRoll(gid: string | undefined, rid: string | null | undefined) {
  return useDoc<RollDoc>(gid && rid ? doc(db, 'groups', gid, 'rolls', rid) : null, `r/${gid}/${rid}`);
}

export function useRolls(gid: string | undefined) {
  return useCollection<RollDoc>(gid ? query(collection(db, 'groups', gid, 'rolls'), orderBy('createdAt', 'desc'), limit(100)) : null, `rs/${gid}`);
}

/** Active rolls (one per group in the MVP) across the user's groups. */
export function useActiveRolls(groups: GroupDoc[]): { rolls: RollDoc[]; loading: boolean } {
  const pairs = groups.filter((g) => g.activeRollId).map((g) => [g.id, g.activeRollId!] as const);
  const key = pairs.map((p) => p.join('/')).join(',');
  const [map, setMap] = useState<Record<string, RollDoc | null>>({});
  useEffect(() => {
    const unsubs = pairs.map(([gid, rid]) => onSnapshot(doc(db, 'groups', gid, 'rolls', rid), (s) => setMap((m) => ({ ...m, [`${gid}/${rid}`]: s.exists() ? (s.data() as RollDoc) : null }))));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const rolls = pairs.map(([g, r]) => map[`${g}/${r}`]).filter((r): r is RollDoc => !!r);
  return { rolls, loading: pairs.some(([g, r]) => !(`${g}/${r}` in map)) };
}

/** Developed rolls across groups (for Home highlights and the Albums library). */
export function useDevelopedRolls(groupIds: string[]): { rolls: RollDoc[]; loading: boolean } {
  const key = groupIds.join(',');
  const [map, setMap] = useState<Record<string, RollDoc[]>>({});
  useEffect(() => {
    const unsubs = groupIds.map((gid) =>
      onSnapshot(
        query(collection(db, 'groups', gid, 'rolls'), where('status', '==', 'developed'), orderBy('developedAt', 'desc'), limit(60)),
        (s) => setMap((m) => ({ ...m, [gid]: s.docs.map((d) => d.data() as RollDoc) })),
        () => setMap((m) => ({ ...m, [gid]: [] })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const rolls = useMemo(() => groupIds.flatMap((g) => map[g] ?? []).sort((a, b) => (b.developedAt ?? 0) - (a.developedAt ?? 0)), [map, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rolls, loading: groupIds.some((g) => !(g in map)) };
}

export function usePhotos(gid: string | undefined, rid: string | undefined, enabled: boolean) {
  return useCollection<PhotoDoc>(gid && rid && enabled ? query(collection(db, 'groups', gid, 'rolls', rid, 'photos'), orderBy('frame')) : null, `p/${gid}/${rid}/${enabled}`);
}

export function useComments(gid: string | undefined, rid: string | undefined, enabled: boolean) {
  return useCollection<CommentDoc>(gid && rid && enabled ? query(collection(db, 'groups', gid, 'rolls', rid, 'comments'), orderBy('createdAt')) : null, `c/${gid}/${rid}/${enabled}`);
}

export function useReactions(gid: string | undefined, rid: string | undefined, enabled: boolean) {
  return useCollection<ReactionDoc>(gid && rid && enabled ? collection(db, 'groups', gid, 'rolls', rid, 'reactions') : null, `re/${gid}/${rid}/${enabled}`);
}

export function useFavorites() {
  const { user } = useAuth();
  return useCollection<FavoriteDoc>(user ? collection(db, 'users', user.uid, 'favorites') : null, `fav/${user?.uid}`);
}

export function useNotifications() {
  const { user } = useAuth();
  return useCollection<NotificationDoc>(user ? query(collection(db, 'users', user.uid, 'notifications'), orderBy('createdAt', 'desc'), limit(50)) : null, `n/${user?.uid}`);
}

export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);
  return on;
}
