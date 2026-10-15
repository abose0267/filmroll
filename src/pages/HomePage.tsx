import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button, FullScreenLoader } from '@/components/ui';
import { DisposableCamera } from '@/components/film';
import { ProfileButton } from '@/components/AppShell';
import { PENDING_INVITE_KEY } from '@/components/InstallGate';
import { Camera, useCameraSelection } from './CameraPage';
import { JoinSheet, NoGroups, greeting, themeOf } from './GroupsPage';

/**
 * Home is the camera: open the app and you're looking through the viewfinder,
 * with the tab bar's center button as the shutter. Brand-new accounts (no
 * group yet) get a welcome screen instead.
 */
export default function HomePage() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const sel = useCameraSelection(params.get('g'));
  const [joining, setJoining] = useState(false);

  // An invite opened before installing (Android shares storage with the installed app).
  useEffect(() => {
    try {
      const code = localStorage.getItem(PENDING_INVITE_KEY);
      if (code) {
        localStorage.removeItem(PENDING_INVITE_KEY);
        nav(`/join/${code}`);
      }
    } catch {
      /* ignore */
    }
  }, [nav]);

  if (sel.loading) return <FullScreenLoader />;
  if (sel.current) {
    return <Camera key={sel.current.roll.id} embedded roll={sel.current.roll} group={sel.current.group} choices={sel.choices} onPick={sel.pick} />;
  }

  const firstName = profile?.displayName.split(' ')[0] ?? '';
  return (
    <div className="px-4">
      <header className="mb-1 flex items-center justify-between pb-3 pt-safe">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint">FilmRoll</p>
          <h1 className="font-display text-[28px] font-semibold leading-tight">{greeting()}, {firstName}</h1>
        </div>
        <ProfileButton />
      </header>
      {sel.groups.length === 0 ? (
        <NoGroups onJoin={() => setJoining(true)} />
      ) : (
        <section className="space-y-4 pt-2">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <DisposableCamera preset="classic35" remaining={0} width={180} />
            <h2 className="font-display text-2xl font-semibold">No roll in the camera</h2>
            <p className="max-w-xs text-ink-soft">Load a new roll in one of your groups and the camera’s ready to shoot.</p>
          </div>
          <ul className="space-y-3">
            {sel.groups.map((g) => {
              const t = themeOf(g);
              return (
                <li key={g.id} className="flex items-center gap-3 rounded-[22px] px-4 py-3 shadow-soft" style={{ background: t.bg, color: t.fg }}>
                  <Link to={`/g/${g.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-semibold">{g.name}</p>
                    <p className="text-sm opacity-75">{g.activeRollId ? 'Roll is developing…' : 'No roll loaded'}</p>
                  </Link>
                  {!g.activeRollId && <Button size="sm" variant="dark" onClick={() => nav(`/g/${g.id}/new-roll`)}>Start a roll</Button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <JoinSheet open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}
