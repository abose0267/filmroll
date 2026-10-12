import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Copy, RefreshCw, Settings, Share2, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useGroup, useMembers, useMyMembership, useRoll, useRolls } from '@/hooks/useData';
import { Avatar, Button, EmptyState, FullScreenLoader, IconButton, PageHeader, Sheet, Spinner, useToast } from '@/components/ui';
import { DisposableCamera, ExposureMeter, FilmCanister } from '@/components/film';
import { api, errorMessage } from '@/lib/api';
import { dateRange } from '@/lib/format';
import { shareInvite } from '@/lib/share';
import { developLabel, shotsRemaining } from '@shared/rolls';
import { PRESETS } from '@shared/presets';
import { formatInviteCode } from '@shared/validation';
import type { GroupDoc, MemberDoc, RollDoc } from '@shared/types';
import { themeOf } from './HomePage';

export function InviteSheet({ group, isAdmin, open, onClose }: { group: GroupDoc; isAdmin: boolean; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || code) return;
    api.getInvite({ groupId: group.id }).then((r) => setCode(r.code), (e) => toast(errorMessage(e), 'error'));
  }, [open, code, group.id, toast]);
  const link = code ? `${location.origin}${import.meta.env.BASE_URL}join/${code}` : '';
  return (
    <Sheet open={open} onClose={onClose} title={`Invite to ${group.name}`}>
      <div className="space-y-5 pb-4">
        <p className="text-ink-soft">Anyone with this link can join. Share it only with friends you want in the group.</p>
        <div className="rounded-3xl bg-paper p-5 text-center">
          {code ? (
            <>
              <p className="font-mono text-3xl font-medium tracking-[0.15em]">{formatInviteCode(code)}</p>
              <p className="mt-1 truncate text-xs text-ink-soft">{link}</p>
            </>
          ) : (
            <Spinner />
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!code} icon={<Share2 className="size-5" />} onClick={async () => (await shareInvite(link, group.name)) === 'copied' && toast('Invite link copied')}>Share link</Button>
          <Button
            variant="secondary"
            disabled={!code}
            icon={<Copy className="size-5" />}
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              toast('Copied!');
            }}
          >
            Copy
          </Button>
        </div>
        {isAdmin && (
          <button
            className="mx-auto flex items-center gap-2 text-sm font-semibold text-ink-soft disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setCode((await api.rotateInvite({ groupId: group.id })).code);
                toast('New link created. The old one no longer works.');
              } catch (e) {
                toast(errorMessage(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw className="size-4" /> Reset link (old link stops working)
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ActiveRoll({ roll, members, myUid }: { roll: RollDoc; members: MemberDoc[]; myUid: string }) {
  const nav = useNavigate();
  const remaining = shotsRemaining(roll);
  const mine = roll.contributors[myUid] ?? 0;
  const shooters = members.filter((m) => (roll.contributors[m.uid] ?? 0) > 0);
  const developing = roll.status === 'developing';
  return (
    <section className="rounded-[28px] bg-cream p-5 shadow-soft" aria-labelledby="active-roll">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">In the camera · {PRESETS[roll.preset].name}</p>
          <h2 id="active-roll" className="font-display text-2xl font-semibold">{roll.name}</h2>
          <p className="text-sm text-ink-soft">{developing ? 'Developing now — almost ready…' : developLabel(roll)}</p>
        </div>
        <ExposureMeter used={roll.exposuresUsed} capacity={roll.capacity} size={84} />
      </div>
      <div className="my-5 flex justify-center">
        <DisposableCamera preset={roll.preset} remaining={remaining} label={roll.name} width={260} />
      </div>
      <p className="text-center font-mono text-sm">
        {roll.exposuresUsed} / {roll.capacity} memories captured · {remaining === 0 ? 'no shots left' : `${remaining} ${remaining === 1 ? 'shot' : 'shots'} remaining`}
      </p>
      <p className="mt-1 text-center text-sm text-ink-soft">
        {mine ? `You’ve tucked away ${mine} ${mine === 1 ? 'memory' : 'memories'}. ` : 'You haven’t added a shot yet. '}
        {shooters.length > 0 && `${shooters.length} of ${members.length} friends have shot so far.`}
      </p>
      <div className="mt-3 flex justify-center gap-1" aria-label="Who has contributed">
        {members.map((m) => (
          <span key={m.uid} className="relative" title={m.displayName}>
            <Avatar name={m.displayName} url={m.photoURL} size={30} className={(roll.contributors[m.uid] ?? 0) > 0 ? '' : 'opacity-40 grayscale'} />
          </span>
        ))}
      </div>
      {roll.status === 'active' && remaining > 0 && (
        <Button size="lg" className="mt-5 w-full" onClick={() => nav(`/camera?g=${roll.groupId}`)}>
          Capture a memory
        </Button>
      )}
    </section>
  );
}

export default function GroupPage() {
  const { gid } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { data: group, loading, error } = useGroup(gid);
  const { data: me } = useMyMembership(gid);
  const { data: members } = useMembers(gid);
  const { data: active } = useRoll(gid, group?.activeRollId);
  const { data: rolls, loading: rollsLoading } = useRolls(gid);
  const [inviting, setInviting] = useState(params.get('invite') === '1');
  const nav = useNavigate();

  if (loading) return <FullScreenLoader />;
  if (!group || error) {
    return <EmptyState title="Group not found" action={<Link to="/"><Button variant="secondary">Go home</Button></Link>}>You may have left this group, or the link is wrong.</EmptyState>;
  }
  const t = themeOf(group);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const canStart = group.settings.rollCreators === 'everyone' || isAdmin;
  const developed = rolls.filter((r) => r.status === 'developed');

  return (
    <div>
      <PageHeader
          back="/"
          background={t.bg}
          color={t.fg}
          title={group.name}
          right={
            <>
              <IconButton label="Invite friends" onClick={() => setInviting(true)} style={{ color: t.fg }}><UserPlus className="size-6" /></IconButton>
              <IconButton label="Group settings" onClick={() => nav(`/g/${group.id}/settings`)} style={{ color: t.fg }}><Settings className="size-6" /></IconButton>
            </>
          }
        />
      <div style={{ background: t.bg, color: t.fg }} className="-mt-px rounded-b-[32px]">
        <div className="px-5 pb-6">
          <button onClick={() => nav(`/g/${group.id}/settings`)} className="flex items-center gap-3 text-left" aria-label="See members">
            <div className="flex">
              {members.slice(0, 6).map((m, i) => <span key={m.uid} style={{ marginLeft: i ? -8 : 0 }}><Avatar name={m.displayName} url={m.photoURL} size={32} /></span>)}
            </div>
            <span className="text-sm opacity-80">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-8 px-4 pt-5">
        {active && (active.status === 'active' || active.status === 'developing') ? (
          <ActiveRoll roll={active} members={members} myUid={user!.uid} />
        ) : (
          <section className="rounded-[28px] bg-cream p-6 text-center shadow-soft">
            <div className="flex justify-center"><DisposableCamera preset="classic35" width={200} /></div>
            <h2 className="mt-4 font-display text-2xl font-semibold">No roll in the camera</h2>
            <p className="mt-1 text-sm text-ink-soft">{canStart ? 'Load a fresh roll and start collecting memories together.' : 'An admin can start the next roll.'}</p>
            {canStart && <Button size="lg" className="mt-5 w-full" onClick={() => nav(`/g/${group.id}/new-roll`)}>Start a new roll</Button>}
            {group.memberCount === 1 && <Button variant="secondary" className="mt-2 w-full" icon={<UserPlus className="size-5" />} onClick={() => setInviting(true)}>Invite friends first</Button>}
          </section>
        )}

        <section aria-labelledby="archive">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="archive" className="font-display text-xl font-semibold">Developed rolls</h2>
            {developed.length > 0 && <Link to="/albums" className="text-sm font-semibold text-coral-deep">All albums</Link>}
          </div>
          {rollsLoading ? (
            <Spinner />
          ) : developed.length === 0 ? (
            <p className="rounded-2xl bg-cream/60 px-4 py-6 text-center text-sm text-ink-soft">Your developed rolls will live here.</p>
          ) : (
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 no-scrollbar">
              {developed.map((r) => (
                <Link key={r.id} to={`/g/${group.id}/r/${r.id}`} className="w-32 shrink-0 snap-start text-center">
                  <FilmCanister preset={r.preset} title={r.name} sub={`${r.exposuresUsed} EXP`} className="mx-auto h-36" />
                  <p className="mt-1 truncate text-sm font-semibold">{r.name}</p>
                  <p className="truncate text-xs text-ink-soft">{dateRange(r.firstShotAt, r.lastShotAt) || (r.developedAt ? new Date(r.developedAt).toLocaleDateString() : '')}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <InviteSheet
        group={group}
        isAdmin={isAdmin}
        open={inviting}
        onClose={() => {
          setInviting(false);
          if (params.has('invite')) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}
