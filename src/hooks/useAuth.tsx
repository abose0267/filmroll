import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, signOut as fbSignOut, updateProfile, type User,
} from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase';
import { clearPhotoCache } from '@/lib/photos';
import { DEFAULT_NOTIFICATION_PREFS, LIMITS } from '@shared/constants';
import type { UserDoc } from '@shared/types';

interface AuthState {
  user: User | null;
  profile: UserDoc | null;
  /** True until auth state and the profile doc have both resolved. */
  loading: boolean;
  profileError: string | null;
  signInGoogle(): Promise<void>;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** Creates the profile doc on first sign-in (rules validate every field). */
async function ensureProfile(u: User, name?: string) {
  const displayName = (name ?? u.displayName ?? u.email?.split('@')[0] ?? 'Friend').slice(0, LIMITS.displayName).trim() || 'Friend';
  const profile: UserDoc = {
    uid: u.uid, displayName, photoURL: u.photoURL?.startsWith('https://') ? u.photoURL : null, city: '', bio: '',
    createdAt: Date.now(), onboarded: false, groupIds: [], notificationPrefs: DEFAULT_NOTIFICATION_PREFS, showMemories: true,
    windToShoot: true, tutorialDone: false,
  };
  await setDoc(doc(db, 'users', u.uid), profile);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    getRedirectResult(auth).catch(() => undefined);
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setProfile(null);
        setProfileReady(true);
        clearPhotoCache();
      } else setProfileReady(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileError(null);
    let creating = false;
    const slow = setTimeout(() => setProfileError((e) => e ?? 'Couldn’t reach FilmRoll. Check your connection.'), 15000);
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      { includeMetadataChanges: true },
      (snap) => {
        // A missing doc reported from the offline cache isn't authoritative; wait for the server.
        if (!snap.exists() && snap.metadata.fromCache && navigator.onLine) return;
        clearTimeout(slow);
        if (!snap.exists()) {
          if (!creating) {
            creating = true;
            ensureProfile(user, pendingName ?? undefined).catch((e) => setProfileError(String(e?.message ?? e)));
            pendingName = null;
          }
          return;
        }
        setProfile(snap.data() as UserDoc);
        setProfileError(null);
        setProfileReady(true);
      },
      (e) => {
        clearTimeout(slow);
        setProfileError(e.message);
        setProfileReady(true);
      },
    );
    return () => {
      clearTimeout(slow);
      unsub();
    };
  }, [user]);

  const value = useMemo<AuthState>(() => ({
    user,
    profile,
    loading: !authReady || (!!user && !profileReady),
    profileError,
    async signInGoogle() {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        // Popups are blocked in some in-app browsers and installed iOS PWAs.
        if (code.includes('popup-blocked') || code.includes('operation-not-supported')) await signInWithRedirect(auth, googleProvider);
        else if (!code.includes('popup-closed') && !code.includes('cancelled-popup')) throw e;
      }
    },
    async signInEmail(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    async signUpEmail(name, email, password) {
      pendingName = name.trim();
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() }).catch(() => undefined);
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(auth, email.trim());
    },
    async signOut() {
      clearPhotoCache();
      await fbSignOut(auth);
    },
  }), [user, profile, authReady, profileReady, profileError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

let pendingName: string | null = null;

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
