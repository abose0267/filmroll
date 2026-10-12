import { lazy, Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { markSeen, seen } from '@/lib/format';
import { Home, Images, UserRound, WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/useData';
import { cx } from './ui';

function Tab({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => cx('flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors', isActive ? 'text-ink' : 'text-ink-faint')}>
      {icon}
      {label}
    </NavLink>
  );
}

/** Prominent shutter-style camera tab. */
function CameraTab() {
  return (
    <NavLink to="/camera" aria-label="Camera" className="-mt-6 flex flex-1 justify-center">
      <span className="grid size-[66px] place-items-center rounded-full bg-body shadow-soft ring-4 ring-paper transition active:scale-95">
        <span className="grid size-12 place-items-center rounded-full bg-coral ring-2 ring-cream/70">
          <span className="size-5 rounded-full bg-cream/90" />
        </span>
      </span>
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-cream/95 backdrop-blur-md" style={{ paddingBottom: 'var(--safe-bottom)' }}>
      <div className="mx-auto flex h-[var(--nav-h)] max-w-lg items-center">
        <Tab to="/" label="Home" icon={<Home className="size-[22px]" />} />
        <CameraTab />
        <Tab to="/albums" label="Albums" icon={<Images className="size-[22px]" />} />
        <Tab to="/profile" label="Profile" icon={<UserRound className="size-[22px]" />} />
      </div>
    </nav>
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
  return (
    <div className="mx-auto min-h-full max-w-lg pb-nav">
      <div key={loc.pathname.split('/').slice(0, 3).join('/')}>
        <Outlet />
      </div>
      <BottomNav />
      <FirstRunTutorial />
    </div>
  );
}
