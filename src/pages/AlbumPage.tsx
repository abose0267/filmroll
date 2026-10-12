import { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bookmark, Clapperboard, Play } from 'lucide-react';
import { useComments, useFavorites, useGroup, useMembers, useMyMembership, usePhotos, useReactions, useRoll } from '@/hooks/useData';
import { Button, EmptyState, FullScreenLoader, PageHeader, Segmented, Sheet, useToast } from '@/components/ui';
import { canMakeRevealClip, makeRevealClip, shareOrDownload } from '@/lib/revealClip';
import { errorMessage } from '@/lib/api';
import { AlbumCover, ContactSheet, DisposableCamera } from '@/components/film';
import DevelopReveal from '@/components/DevelopReveal';
import PhotoViewer from '@/components/PhotoViewer';
import { dateRange, markSeen, seen } from '@/lib/format';
import { developLabel, shotsRemaining } from '@shared/rolls';
import { PRESETS } from '@shared/presets';

export default function AlbumPage() {
  const { gid, rid } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: group, loading: gLoading } = useGroup(gid);
  const { data: roll, loading: rLoading } = useRoll(gid, rid);
  const { data: me } = useMyMembership(gid);
  const { data: members } = useMembers(gid);
  const developed = roll?.status === 'developed';
  const { data: photos, loading: pLoading, error: pError } = usePhotos(gid, rid, developed);
  const { data: comments } = useComments(gid, rid, developed && !pError);
  const { data: reactions } = useReactions(gid, rid, developed && !pError);
  const { data: favs } = useFavorites();
  const [revealing, setRevealing] = useState(() => !!rid && !seen(`opened:${rid}`));
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  // Frames fade up like a print in the tray the first time the sheet is shown.
  const [sheetReveal] = useState(() => !!rid && !seen(`sheet:${rid}`));

  const people = useMemo(() => Object.fromEntries(members.map((m) => [m.uid, { name: m.displayName, photoURL: m.photoURL }])), [members]);
  const names = useMemo(() => Object.fromEntries(members.map((m) => [m.uid, m.displayName])), [members]);
  const favorites = useMemo(() => new Set(favs.filter((f) => f.rollId === rid).map((f) => f.photoId)), [favs, rid]);
  const shown = filter === 'favorites' ? photos.filter((p) => favorites.has(p.id)) : photos;
  const openId = params.get('photo');
  const index = openId ? shown.findIndex((p) => p.id === openId) : -1;

  const open = useCallback((i: number) => {
    const p = shown[i];
    if (p) setParams((s) => { s.set('photo', p.id); return s; }, { replace: index >= 0 });
  }, [shown, setParams, index]);
  const close = useCallback(() => setParams((s) => { s.delete('photo'); return s; }, { replace: true }), [setParams]);
  const finishReveal = useCallback(() => {
    if (rid) {
      markSeen(`opened:${rid}`);
      markSeen(`sheet:${rid}`);
    }
    setRevealing(false);
  }, [rid]);

  if (gLoading || rLoading) return <FullScreenLoader />;
  if (!group || !roll) return <EmptyState title="Album not found" action={<Link to="/albums"><Button variant="secondary">All albums</Button></Link>}>You may not be in this group anymore.</EmptyState>;

  if (!developed) {
    return (
      <div className="mx-auto min-h-full max-w-lg">
        <PageHeader back={`/g/${group.id}`} title={roll.name} sub={group.name} />
        <EmptyState art={<DisposableCamera preset={roll.preset} remaining={shotsRemaining(roll)} width={240} />} title={roll.status === 'cancelled' ? 'This roll was cancelled' : roll.status === 'developing' ? 'Developing now…' : 'Still in the camera'} action={<Link to={`/g/${group.id}`}><Button variant="secondary">Back to {group.name}</Button></Link>}>
          {roll.status === 'cancelled' ? 'No photos were taken on it.' : `${roll.exposuresUsed} of ${roll.capacity} memories captured. ${roll.status === 'active' ? developLabel(roll) + '.' : ''} The photos stay hidden until then.`}
        </EmptyState>
      </div>
    );
  }

  if (pError) {
    return (
      <div className="mx-auto min-h-full max-w-lg">
        <PageHeader back={`/g/${group.id}`} title={roll.name} sub={group.name} />
        <EmptyState title="This album is private to earlier members">{group.name} only shares rolls with people who were in the group when the roll started.</EmptyState>
      </div>
    );
  }

  if (revealing && !pLoading) return <DevelopReveal roll={roll} groupName={group.name} photos={photos} onDone={finishReveal} />;

  return (
    <div className="mx-auto min-h-full max-w-lg pb-safe">
      <PageHeader back={`/g/${group.id}`} title={roll.name} sub={group.name} right={<Button size="sm" variant="ghost" icon={<Play className="size-4" />} onClick={() => setRevealing(true)} aria-label="Replay the reveal">Replay</Button>} />
      <div className="space-y-6 px-4 pt-2">
        <AlbumCover roll={roll} groupName={group.name} photos={photos} />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [String(photos.length), photos.length === 1 ? 'memory' : 'memories'],
            [String(Object.keys(roll.contributors).filter((u) => roll.contributors[u] > 0).length), 'photographers'],
            [PRESETS[roll.preset].code, PRESETS[roll.preset].name],
          ].map(([a, b]) => (
            <div key={b} className="rounded-2xl bg-cream px-2 py-3 shadow-soft">
              <p className="font-mono text-lg">{a}</p>
              <p className="truncate text-xs text-ink-soft">{b}</p>
            </div>
          ))}
        </div>
        {roll.firstShotAt && <p className="text-center text-sm text-ink-soft">Shot {dateRange(roll.firstShotAt, roll.lastShotAt)}</p>}
        {photos.length > 0 && canMakeRevealClip() && <ShareReveal roll={roll} groupName={group.name} photos={photos} />}

        {photos.length === 0 && !pLoading ? (
          <EmptyState title="An empty roll" action={<Link to={`/g/${group.id}/new-roll`}><Button>Start a new roll</Button></Link>}>Nobody took a shot this time. That’s okay — load another roll and try again.</EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Contact sheet</h2>
              <div className="w-48">
                <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'favorites', label: <span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" /> Mine</span> }]} />
              </div>
            </div>
            {filter === 'favorites' && shown.length === 0 ? (
              <p className="rounded-2xl bg-cream/60 px-4 py-6 text-center text-sm text-ink-soft">Tap the bookmark on a photo to keep it in your private favorites.</p>
            ) : (
              <ContactSheet photos={shown} roll={roll} names={names} onOpen={open} reveal={sheetReveal} />
            )}
          </>
        )}
      </div>
      {index >= 0 && (
        <PhotoViewer photos={shown} index={index} onIndex={open} onClose={close} people={people} comments={comments} reactions={reactions} favorites={favorites} me={me} />
      )}
    </div>
  );
}

/** Explicit, user-initiated export of the reveal as a short Stories video. */
function ShareReveal({ roll, groupName, photos }: { roll: Parameters<typeof makeRevealClip>[0]; groupName: string; photos: Parameters<typeof makeRevealClip>[2] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  async function make() {
    setProgress(0);
    try {
      const file = await makeRevealClip(roll, groupName, photos, setProgress);
      const how = await shareOrDownload(file);
      if (how === 'downloaded') toast('Reveal video saved.');
      setOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setProgress(null);
    }
  }
  return (
    <>
      <Button variant="secondary" className="w-full" icon={<Clapperboard className="size-5" />} onClick={() => setOpen(true)}>Share the reveal</Button>
      <Sheet open={open} onClose={() => progress == null && setOpen(false)} title="Share the reveal">
        <div className="space-y-4 pb-4">
          <p className="text-ink-soft">This makes an 8-second video of the developing animation and this roll’s contact sheet ({Math.min(12, photos.length)} frames) — sized for Stories. It’s a copy to share outside {groupName}; the album itself stays private.</p>
          {progress != null && (
            <div className="space-y-1" role="status">
              <div className="h-2 overflow-hidden rounded-full bg-paper-2"><div className="h-full bg-coral transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <p className="text-center text-sm text-ink-soft">Developing your video… {Math.round(progress * 100)}%</p>
            </div>
          )}
          <Button className="w-full" loading={progress != null} onClick={make}>Make video</Button>
        </div>
      </Sheet>
    </>
  );
}
