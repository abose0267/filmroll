import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { markSeen, seen } from '@/lib/format';
import { Bell, UsersRound, WifiOff } from 'lucide-react';
import { useNotifications, useOnline } from '@/hooks/useData';
import { Avatar, cx } from './ui';

/**
 * The camera on the home tab hands its shutter to the big center button, so the
 * tab bar's camera button *is* the shutter while you're looking through it.
 */
export interface NavShutter {
  ready: boolean;
  label: string;
  fire: () => void;
}
const ShutterCtx = createContext<(s: NavShutter | null) => void>(() => undefined);

export function useNavShutter(s: NavShutter | null) {
  const set = useContext(ShutterCtx);
  const { ready, label, fire } = s ?? {};
  useEffect(() => {
    set(fire ? { ready: !!ready, label: label ?? 'Take photo', fire } : null);
  }, [set, ready, label, fire]);
  useEffect(() => () => set(null), [set]);
}

function Tab({ to, label, icon, badge, dark }: { to: string; label: string; icon: React.ReactNode; badge?: number; dark?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx('relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors', dark ? (isActive ? 'text-cream' : 'text-cream/55') : isActive ? 'text-ink' : 'text-ink-faint')
      }
    >
      <span className="relative">
        {icon}
        {!!badge && <span className="absolute -right-2.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10px] font-bold leading-[18px] text-cream">{badge > 9 ? '9+' : badge}</span>}
      </span>
      {label}
    </NavLink>
  );
}

/** Center tab: goes to the camera, and is the shutter once you're there. */
function CameraTab({ shutter, onHome }: { shutter: NavShutter | null; onHome: boolean }) {
  const isShutter = onHome && !!shutter;
  const face = (ready: boolean) => (
    <span className={cx('grid size-[70px] place-items-center rounded-full bg-body shadow-soft ring-4 transition active:scale-90', isShutter ? 'ring-body' : 'ring-paper')}>
      <span className={cx('grid size-[54px] place-items-center rounded-full ring-2 transition-colors', ready ? 'bg-coral ring-cream/80' : 'bg-coral/40 ring-cream/30')}>
        {!isShutter && <span className="size-5 rounded-full bg-cream/90" />}
      </span>
    </span>
  );
  if (isShutter) {
    return (
      <div className="-mt-7 flex flex-1 justify-center">
        <button type="button" onClick={shutter.fire} aria-label={shutter.label}>{face(shutter.ready)}</button>
      </div>
    );
  }
  return (
    <NavLink to="/" end aria-label="Camera" className="-mt-7 flex flex-1 justify-center">
      {face(true)}
    </NavLink>
  );
}

export function BottomNav({ shutter }: { shutter: NavShutter | null }) {
  const loc = useLocation();
  const onHome = loc.pathname === '/';
  const dark = onHome && !!shutter;
  const { data: notes } = useNotifications();
  const unread = notes.filter((n) => !n.read).length;
  return (
    <nav
      aria-label="Main"
      className={cx('fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md transition-colors', dark ? 'border-white/5 bg-body' : 'border-line/70 bg-cream/95')}
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mx-auto flex h-[var(--nav-h)] max-w-lg items-center">
        <Tab to="/groups" label="Groups" icon={<UsersRound className="size-[22px]" />} dark={dark} />
        <CameraTab shutter={shutter} onHome={onHome} />
        <Tab to="/notifications" label="Activity" icon={<Bell className="size-[22px]" />} badge={unread} dark={dark} />
      </div>
    </nav>
  );
}

/** Your avatar in the top-right corner; opens Profile & settings. */
export function ProfileButton({ className }: { className?: string }) {
  const { profile } = useAuth();
  return (
    <Link to="/profile" aria-label="Profile and settings" className={cx('grid size-11 shrink-0 place-items-center rounded-full active:scale-95', className)}>
      <Avatar name={profile?.displayName || 'You'} url={profile?.photoURL} size={36} />
    </Link>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-2 bg-ink px-4 pb-2 pt-safe text-sm font-medium text-cream" role="status">
      <WifiOff className="size-4" /> You’re offline — FilmRoll needs a connection to save photos.
    </div>
  );
}

const Tutorial = lazy(() => import('./Tutorial'));

/** The tutorial shows once per account, right after onboarding. */
function FirstRunTutorial() {
  const { user, profile } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  // Also remembered on this device, so it can't pop back up while the server write is in flight.
  if (!user || !profile?.onboarded || profile.tutorialDone || dismissed || seen(`tutorial:${user.uid}`)) return null;
  return (
    <Suspense fallback={null}>
      <Tutorial
        onDone={() => {
          setDismissed(true);
          markSeen(`tutorial:${user.uid}`);
          void updateDoc(doc(db, 'users', user.uid), { tutorialDone: true }).catch(() => undefined);
        }}
      />
    </Suspense>
  );
}

export default function AppShell() {
  const loc = useLocation();
  const [shutter, setShutter] = useState<NavShutter | null>(null);
  return (
    <ShutterCtx.Provider value={setShutter}>
      <div className="mx-auto min-h-full max-w-lg pb-nav">
        <div key={loc.pathname.split('/').slice(0, 3).join('/')}>
          <Outlet />
        </div>
        <BottomNav shutter={shutter} />
        <FirstRunTutorial />
      </div>
    </ShutterCtx.Provider>
  );
}
