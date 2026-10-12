import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Plus, Ticket } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useActiveRolls, useDevelopedRolls, useMyGroups, useNotifications } from '@/hooks/useData';
import { AvatarStack, Button, EmptyState, Field, Sheet, Spinner, TextInput } from '@/components/ui';
import { DisposableCamera, FilmCanister } from '@/components/film';
import { seen } from '@/lib/format';
import { GROUP_THEMES } from '@shared/constants';
import { developLabel, shotsRemaining } from '@shared/rolls';
import { normalizeInviteCode } from '@shared/validation';
import type { GroupDoc, RollDoc } from '@shared/types';

function greeting() {
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
          <Button size="sm" variant="dark" onClick={() => nav(`/camera?g=${group.id}`)}>Take a shot</Button>
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
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoCapitalize="characters" autoComplete="off" className="font-mono uppercase tracking-widest" />
        </Field>
        <Button type="submit" className="w-full" disabled={!normalized}>Continue</Button>
      </form>
    </Sheet>
  );
}

export default function HomePage() {
  const { profile } = useAuth();
  const { groups, loading } = useMyGroups();
  const { rolls } = useActiveRolls(groups);
  const { rolls: developed } = useDevelopedRolls(groups.map((g) => g.id));
  const { data: notes } = useNotifications();
  const unread = notes.filter((n) => !n.read).length;
  const [joining, setJoining] = useState(false);
  const fresh = developed.filter((r) => r.developedAt && Date.now() - r.developedAt < 21 * 864e5 && !seen(`opened:${r.id}`)).slice(0, 3);
  const firstName = profile?.displayName.split(' ')[0] ?? '';

  return (
    <div className="px-4">
      <header className="sticky top-0 z-30 -mx-4 mb-1 flex items-center justify-between bg-paper/95 px-4 pb-3 pt-safe backdrop-blur-md">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint">FilmRoll</p>
          <h1 className="font-display text-[28px] font-semibold leading-tight">{greeting()}, {firstName}</h1>
        </div>
        <Link to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative grid size-11 place-items-center rounded-full active:bg-ink/5">
          <Bell className="size-6" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-coral px-1 text-[11px] font-bold text-cream">{unread > 9 ? '9+' : unread}</span>}
        </Link>
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

      {loading ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          art={<DisposableCamera preset="softPastel" width={220} />}
          title="Your first roll is waiting"
          action={
            <div className="flex flex-col gap-2">
              <Link to="/g/new"><Button className="w-full" icon={<Plus className="size-5" />}>Start a group</Button></Link>
              <Button variant="secondary" icon={<Ticket className="size-5" />} onClick={() => setJoining(true)}>Join with a code</Button>
            </div>
          }
        >
          Make a private group for your friends, or join one with an invite.
        </EmptyState>
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

