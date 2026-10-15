import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardPaste, Plus, Ticket } from 'lucide-react';
import { useActiveRolls, useDevelopedRolls, useMyGroups } from '@/hooks/useData';
import { ProfileButton } from '@/components/AppShell';
import { AvatarStack, Button, EmptyState, Field, Segmented, Sheet, Spinner, TextInput } from '@/components/ui';
import { DisposableCamera, FilmCanister } from '@/components/film';
import { seen } from '@/lib/format';
import { GROUP_THEMES } from '@shared/constants';
import { developLabel, shotsRemaining } from '@shared/rolls';
import { normalizeInviteCode } from '@shared/validation';
import type { GroupDoc, RollDoc } from '@shared/types';

const AlbumsContent = lazy(() => import('./AlbumsPage'));

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function themeOf(g: Pick<GroupDoc, 'theme'>) {
  return GROUP_THEMES.find((t) => t.id === g.theme) ?? GROUP_THEMES[0];
}

function GroupCard({ group, roll }: { group: GroupDoc; roll?: RollDoc }) {
  const t = themeOf(group);
  const nav = useNavigate();
  const active = roll && (roll.status === 'active' || roll.status === 'developing');
  return (
    <article className="overflow-hidden rounded-[26px] shadow-soft" style={{ background: t.bg, color: t.fg }}>
      <Link to={`/g/${group.id}`} className="block px-5 pb-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-semibold">{group.name}</h2>
            <p className="text-sm opacity-75">{group.memberCount} {group.memberCount === 1 ? 'friend' : 'friends'} · {group.developedCount} developed</p>
          </div>
          <AvatarStack people={group.memberPreview.map((m) => ({ uid: m.uid, name: m.name, photoURL: m.photoURL }))} size={28} max={4} />
        </div>
        {active && roll ? (
          <div className="mt-4 flex items-center gap-4">
            <DisposableCamera preset={roll.preset} remaining={shotsRemaining(roll)} width={112} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-semibold leading-snug">{roll.name}</p>
              <p className="font-mono text-sm">{roll.exposuresUsed} / {roll.capacity} memories captured</p>
              <p className="text-sm opacity-75">{roll.status === 'developing' ? 'Developing now…' : developLabel(roll)}</p>
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-black/5 px-4 py-3 text-sm">No roll in the camera. Start one for the group.</p>
        )}
      </Link>
      <div className="flex gap-2 px-5 pb-5">
        {active && roll?.status === 'active' ? (
          <Button size="sm" variant="dark" onClick={() => nav(`/?g=${group.id}`)}>Take a shot</Button>
        ) : (
          <Button size="sm" variant="dark" onClick={() => nav(`/g/${group.id}/new-roll`)}>Start a roll</Button>
        )}
        <Button size="sm" variant="ghost" className="!text-current" onClick={() => nav(`/g/${group.id}`)}>Open</Button>
      </div>
    </article>
  );
}

export function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const nav = useNavigate();
  const normalized = normalizeInviteCode(code);
  return (
    <Sheet open={open} onClose={onClose} title="Join a group">
      <form
        className="space-y-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (normalized) {
            onClose();
            nav(`/join/${normalized}`);
          }
        }}
      >
        <Field label="Invite code or link" hint="Ask a friend in the group to share their invite.">
          <div className="flex gap-2">
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoCapitalize="characters" autoComplete="off" className="font-mono uppercase tracking-widest" />
            {'readText' in (navigator.clipboard ?? {}) && (
              <Button
                type="button"
                variant="secondary"
                aria-label="Paste"
                className="shrink-0"
                icon={<ClipboardPaste className="size-5" />}
                onClick={() => navigator.clipboard.readText().then((t) => setCode(t.trim()), () => undefined)}
              />
            )}
          </div>
        </Field>
        <Button type="submit" className="w-full" disabled={!normalized}>Continue</Button>
      </form>
    </Sheet>
  );
}

export default function GroupsPage() {
  const { groups, loading } = useMyGroups();
  const { rolls } = useActiveRolls(groups);
  const { rolls: developed } = useDevelopedRolls(groups.map((g) => g.id));
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'rolls' ? 'rolls' : 'groups';
  const [joining, setJoining] = useState(false);
  const fresh = developed.filter((r) => r.developedAt && Date.now() - r.developedAt < 21 * 864e5 && !seen(`opened:${r.id}`)).slice(0, 3);

  return (
    <div className="px-4">
      <header className="flex items-center justify-between pb-3 pt-safe">
        <h1 className="font-display text-[28px] font-semibold leading-tight">Groups</h1>
        <ProfileButton />
      </header>

      {fresh.map((r) => {
        const g = groups.find((x) => x.id === r.groupId);
        return (
          <Link key={r.id} to={`/g/${r.groupId}/r/${r.id}`} className="mb-4 flex items-center gap-4 rounded-[24px] bg-ink p-4 text-cream shadow-soft">
            <FilmCanister preset={r.preset} title={r.name} className="h-20 w-16 shrink-0" />
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber">Your film is developed!</p>
              <p className="truncate font-display text-xl font-semibold">{r.name}</p>
              <p className="text-sm text-cream/70">{r.exposuresUsed} memories from {g?.name ?? 'your group'} — tap to reveal</p>
            </div>
          </Link>
        );
      })}

      {groups.length > 0 && (
        <div className="mb-4">
          <Segmented
            label="Show"
            value={view}
            onChange={(v) => setParams(v === 'rolls' ? { view: 'rolls' } : {}, { replace: true })}
            options={[{ value: 'groups', label: 'My groups' }, { value: 'rolls', label: 'Past rolls' }]}
          />
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : groups.length === 0 ? (
        <NoGroups onJoin={() => setJoining(true)} />
      ) : view === 'rolls' ? (
        <Suspense fallback={<div className="grid place-items-center py-16"><Spinner /></div>}>
          <AlbumsContent />
        </Suspense>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => <GroupCard key={g.id} group={g} roll={rolls.find((r) => r.groupId === g.id)} />)}
          <div className="flex gap-2 pt-2">
            <Link to="/g/new" className="flex-1"><Button variant="secondary" className="w-full" icon={<Plus className="size-5" />}>New group</Button></Link>
            <Button variant="secondary" className="flex-1" icon={<Ticket className="size-5" />} onClick={() => setJoining(true)}>Join</Button>
          </div>
        </div>
      )}
      <JoinSheet open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}

/** First thing a new account sees: start a group or join one. */
export function NoGroups({ onJoin }: { onJoin: () => void }) {
  return (
    <EmptyState
      art={<DisposableCamera preset="softPastel" width={220} />}
      title="Your first roll is waiting"
      action={
        <div className="flex flex-col gap-2">
          <Link to="/g/new"><Button className="w-full" icon={<Plus className="size-5" />}>Start a group</Button></Link>
          <Button variant="secondary" icon={<Ticket className="size-5" />} onClick={onJoin}>Join with a code</Button>
        </div>
      }
    >
      Make a private group for your friends, or join one with an invite. Then everyone shoots onto the same roll.
    </EmptyState>
  );
}
