import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { EmptyState, FullScreenLoader, IconButton, PageHeader } from '@/components/ui';
import { api, errorMessage, type Analytics, type Series, type Tally } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import { PRESETS, isPresetId } from '@shared/presets';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl bg-cream p-4 shadow-soft">
      <p className="font-mono text-2xl">{value}</p>
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      {sub && <p className="text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}

function Bars({ title, data, color = '#D9714E' }: { title: string; data: Series[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const total = data.reduce((a, d) => a + d.n, 0);
  return (
    <section className="rounded-3xl bg-cream p-4 shadow-soft">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="font-mono text-sm text-ink-soft">{total} in 30 days</span>
      </div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`${title}: ${data.map((d) => `${d.day} ${d.n}`).join(', ')}`}>
        {data.map((d) => (
          <div key={d.day} className="flex-1 rounded-t-[3px]" title={`${d.day}: ${d.n}`} style={{ height: `${Math.max(d.n ? 6 : 2, (d.n / max) * 100)}%`, background: d.n ? color : 'rgb(43 38 34 / 0.08)' }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{data[0]?.day.slice(5)}</span>
        <span>today</span>
      </div>
    </section>
  );
}

function Breakdown({ title, data, label = (k: string) => k }: { title: string; data: Tally[]; label?: (k: string) => string }) {
  const total = Math.max(1, data.reduce((a, d) => a + d.n, 0));
  return (
    <section className="rounded-3xl bg-cream p-4 shadow-soft">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-ink-faint">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.key}>
              <div className="flex justify-between text-sm"><span>{label(d.key)}</span><span className="font-mono text-ink-soft">{d.n} · {Math.round((d.n / total) * 100)}%</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-amber" style={{ width: `${(d.n / total) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => (Math.round(x * 10) / 10).toString();
const MODE: Record<string, string> = { full: 'When full', date: 'On a date', either: 'Whichever first' };

/** Owner-only dashboard. The server refuses anyone else, so this page shows nothing to them. */
export default function AdminPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api.getAnalytics({}).then((d) => { setData(d); setError(null); }, (e) => setError(errorMessage(e))).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !data) return <FullScreenLoader label="Crunching numbers…" />;
  if (error && !data) return <div><PageHeader back="/profile" title="Analytics" /><EmptyState title="Not available">{error}</EmptyState></div>;
  if (!data) return null;
  const t = data.totals;
  const a = data.activity;
  return (
    <div>
      <PageHeader back="/profile" title="Analytics" sub={`Updated ${relativeTime(data.generatedAt)}`} right={<IconButton label="Refresh" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-5 animate-spin' : 'size-5'} /></IconButton>} />
      <div className="space-y-5 px-4 pb-6 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Users" value={t.users} sub={`+${a.signups30} in 30d`} />
          <Stat label="Groups" value={t.groups} sub={`${data.groups.withActiveOrPastRoll} with rolls`} />
          <Stat label="Photos" value={t.photos} sub={`+${a.shots30} in 30d`} />
          <Stat label="Rolls" value={t.rolls} />
          <Stat label="Comments" value={t.comments} sub={`+${a.comments30} in 30d`} />
          <Stat label="Reactions" value={t.reactions} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Active photographers (7d)" value={a.photographers7} />
          <Stat label="Active photographers (30d)" value={a.photographers30} />
        </div>

        <Bars title="Shots per day" data={data.daily.shots} />
        <Bars title="Sign-ups per day" data={data.daily.signups} color="#8F9F80" />
        <Bars title="Comments per day" data={data.daily.comments} color="#E2A548" />

        <section className="space-y-2">
          <h2 className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">Rolls</h2>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Active" value={data.rollsByStatus.active} />
            <Stat label="Developing" value={data.rollsByStatus.developing} />
            <Stat label="Developed" value={data.rollsByStatus.developed} />
            <Stat label="Cancelled" value={data.rollsByStatus.cancelled} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Avg fill (developed)" value={pct(data.rolls.avgFill)} sub={`${data.rolls.emptyDeveloped} developed empty`} />
            <Stat label="Avg photos / roll" value={one(data.rolls.avgPhotos)} />
            <Stat label="Avg photographers / roll" value={one(data.rolls.avgPhotographers)} />
            <Stat label="Avg days to develop" value={one(data.rolls.avgDaysToDevelop)} />
          </div>
        </section>

        <Breakdown title="Film looks" data={data.rolls.presets} label={(k) => (isPresetId(k) ? PRESETS[k].name : k)} />
        <Breakdown title="Roll size" data={data.rolls.capacities} label={(k) => `${k} exposures`} />
        <Breakdown title="Develops" data={data.rolls.developModes} label={(k) => MODE[k] ?? k} />
        <Breakdown title={`Group size (avg ${one(data.groups.avgMembers)})`} data={data.groups.sizes} label={(k) => `${k} ${k === '1' ? 'member' : 'members'}`} />

        <section className="rounded-3xl bg-cream p-4 shadow-soft">
          <h3 className="mb-2 font-semibold">Recent sign-ups</h3>
          <ul className="divide-y divide-line text-sm">
            {data.recentSignups.map((u, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="truncate">{u.name}{!u.onboarded && <span className="ml-1 text-xs text-ink-faint">(not onboarded)</span>}</span>
                <span className="shrink-0 font-mono text-xs text-ink-soft">{u.groups} groups · {formatDate(u.createdAt, { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
