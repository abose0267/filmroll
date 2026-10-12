import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useDevelopedRolls, useMyGroups } from '@/hooks/useData';
import { EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui';
import { FilmCanister } from '@/components/film';
import { dateRange, formatDate } from '@/lib/format';
import { resurface } from '@shared/memories';
import type { RollDoc } from '@shared/types';

type Sort = 'newest' | 'oldest' | 'group';

function RollTile({ roll, groupName }: { roll: RollDoc; groupName: string }) {
  const people = Object.values(roll.contributors).filter((n) => n > 0).length;
  return (
    <Link to={`/g/${roll.groupId}/r/${roll.id}`} className="group block rounded-3xl bg-cream p-3 text-center shadow-soft transition active:scale-[0.98]">
      <FilmCanister preset={roll.preset} title={roll.name} sub={`${roll.exposuresUsed} EXP`} className="mx-auto h-32 transition group-hover:-rotate-3" />
      <p className="mt-2 truncate font-semibold">{roll.name}</p>
      <p className="truncate text-xs text-ink-soft">{groupName}</p>
      <p className="truncate text-xs text-ink-faint">{dateRange(roll.firstShotAt, roll.lastShotAt) || (roll.developedAt ? formatDate(roll.developedAt) : '')}</p>
      <p className="truncate text-xs text-ink-faint">{roll.exposuresUsed} photos · {people} {people === 1 ? 'photographer' : 'photographers'}</p>
    </Link>
  );
}

export default function AlbumsPage() {
  const { profile } = useAuth();
  const { groups } = useMyGroups();
  const { rolls, loading } = useDevelopedRolls(groups.map((g) => g.id));
  const [sort, setSort] = useState<Sort>('newest');
  const names = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const memories = useMemo(() => (profile?.showMemories === false ? [] : resurface(rolls, Date.now())), [rolls, profile?.showMemories]);

  const sorted = useMemo(() => {
    const r = [...rolls];
    if (sort === 'oldest') r.sort((a, b) => (a.developedAt ?? 0) - (b.developedAt ?? 0));
    else r.sort((a, b) => (b.developedAt ?? 0) - (a.developedAt ?? 0));
    return r;
  }, [rolls, sort]);

  return (
    <div>
      <PageHeader title="Albums" sub="Every roll your groups have developed" />
      <div className="space-y-6 px-4 pt-2">
        {memories.map((m) => {
          const r = rolls.find((x) => x.id === m.rollId)!;
          return (
            <Link key={m.rollId + m.kind} to={`/g/${m.groupId}/r/${m.rollId}`} className="flex items-center gap-4 rounded-[24px] bg-amber/30 p-4 ring-1 ring-amber/40">
              <FilmCanister preset={r.preset} title={r.name} className="h-20 w-16 shrink-0" />
              <div className="min-w-0">
                <p className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-coral-deep"><Sparkles className="size-3.5" /> Memory</p>
                <p className="font-display text-lg font-semibold leading-tight">{m.title}</p>
                <p className="truncate text-sm text-ink-soft">{r.name} · {names[r.groupId]}</p>
              </div>
            </Link>
          );
        })}

        {loading ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : rolls.length === 0 ? (
          <EmptyState art={<FilmCanister preset="softPastel" title="Your first roll" className="h-40" />} title="No developed rolls yet">
            When a roll develops, it lands here as a keepsake you can revisit anytime.
          </EmptyState>
        ) : (
          <>
            <Segmented label="Sort albums" value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'group', label: 'By group' }]} />
            {sort === 'group' ? (
              groups.map((g) => {
                const list = sorted.filter((r) => r.groupId === g.id);
                if (!list.length) return null;
                return (
                  <section key={g.id} className="space-y-3">
                    <h2 className="font-display text-xl font-semibold">{g.name}</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.map((r) => <RollTile key={r.id} roll={r} groupName={g.name} />)}</div>
                  </section>
                );
              })
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{sorted.map((r) => <RollTile key={r.id} roll={r} groupName={names[r.groupId] ?? ''} />)}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
