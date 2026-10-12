import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Button, FullScreenLoader, StatusBarBackdrop, ToastProvider } from '@/components/ui';
import AppShell, { OfflineBanner } from '@/components/AppShell';
import { firebaseConfigured } from '@/lib/firebase';
import LandingPage from '@/pages/LandingPage';
import HomePage from '@/pages/HomePage';

const SignInPage = lazy(() => import('@/pages/SignInPage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const JoinPage = lazy(() => import('@/pages/JoinPage'));
const NewGroupPage = lazy(() => import('@/pages/NewGroupPage'));
const GroupPage = lazy(() => import('@/pages/GroupPage'));
const GroupSettingsPage = lazy(() => import('@/pages/GroupSettingsPage'));
const NewRollPage = lazy(() => import('@/pages/NewRollPage'));
const CameraPage = lazy(() => import('@/pages/CameraPage'));
const AlbumPage = lazy(() => import('@/pages/AlbumPage'));
const AlbumsPage = lazy(() => import('@/pages/AlbumsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, profile, loading, profileError, signOut } = useAuth();
  const loc = useLocation();
  const next = encodeURIComponent(loc.pathname + loc.search);
  if (user && profileError && !profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl font-semibold">Signed in, but FilmRoll can’t load</h1>
        <p className="max-w-sm text-sm text-ink-soft">{profileError}</p>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>Try again</Button>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to={`/signin?next=${next}`} replace />;
  if (!profile?.onboarded && !loc.pathname.startsWith('/welcome')) return <Navigate to={`/welcome?next=${next}`} replace />;
  return <>{children}</>;
}

/** "/" shows the landing page when signed out and Home when signed in. */
function Root() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return loc.pathname === '/' ? <LandingPage /> : <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

const auth = (el: ReactNode) => <RequireAuth><Lazy>{el}</Lazy></RequireAuth>;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'albums', element: <Lazy><AlbumsPage /></Lazy> },
      { path: 'profile', element: <Lazy><ProfilePage /></Lazy> },
      { path: 'notifications', element: <Lazy><NotificationsPage /></Lazy> },
      { path: 'about', element: <Lazy><AboutPage /></Lazy> },
      { path: 'admin', element: <Lazy><AdminPage /></Lazy> },
      { path: 'g/new', element: <Lazy><NewGroupPage /></Lazy> },
      { path: 'g/:gid', element: <Lazy><GroupPage /></Lazy> },
      { path: 'g/:gid/settings', element: <Lazy><GroupSettingsPage /></Lazy> },
      { path: 'g/:gid/new-roll', element: <Lazy><NewRollPage /></Lazy> },
    ],
  },
  { path: '/signin', element: <Lazy><SignInPage /></Lazy> },
  { path: '/welcome', element: auth(<OnboardingPage />) },
  { path: '/join/:code', element: auth(<JoinPage />) },
  { path: '/camera', element: auth(<CameraPage />) },
  { path: '/g/:gid/r/:rid', element: auth(<AlbumPage />) },
  { path: '*', element: <Navigate to="/" replace /> },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

function NotConfigured() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold">FilmRoll needs Firebase</h1>
      <p className="max-w-sm text-ink-soft">Copy <code>.env.example</code> to <code>.env</code> and add your Firebase web config, or set <code>VITE_USE_EMULATORS=true</code> and run <code>npm run emulators</code>. See the README.</p>
    </div>
  );
}

export default function App() {
  if (!firebaseConfigured) return <NotConfigured />;
  return (
    <ToastProvider>
      <AuthProvider>
        <OfflineBanner />
        <StatusBarBackdrop />
        <div className="grain h-full">
          <RouterProvider router={router} />
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
