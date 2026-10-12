/**
 * Web push via Firebase Cloud Messaging. Permission is only ever requested
 * from a button the user taps (never during onboarding). On iPhone, web push
 * works only for the installed Home Screen app (iOS 16.4+).
 */
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { app, db, usingEmulators } from './firebase';

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const TOKEN_KEY = 'filmroll:pushToken';

export type PushStatus = 'on' | 'off' | 'blocked' | 'needs-install' | 'unsupported';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function pushStatus(): Promise<PushStatus> {
  if (usingEmulators || !VAPID) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported().catch(() => false))) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && savedToken() ? 'on' : 'off';
}

async function registration() {
  const base = import.meta.env.BASE_URL;
  return navigator.serviceWorker.register(`${base}firebase-messaging-sw.js`, { scope: `${base}fcm/` });
}

/** Must be called from a tap. Returns the resulting status. */
export async function enablePush(uid: string): Promise<PushStatus> {
  const status = await pushStatus();
  if (status === 'unsupported' || status === 'needs-install' || status === 'blocked') return status;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: await registration() });
  await setDoc(doc(db, 'users', uid, 'pushTokens', token), { token, createdAt: Date.now(), userAgent: navigator.userAgent.slice(0, 300) });
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  return 'on';
}

export async function disablePush(uid: string): Promise<void> {
  const token = savedToken();
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (token) await deleteDoc(doc(db, 'users', uid, 'pushTokens', token)).catch(() => undefined);
  await deleteToken(getMessaging(app)).catch(() => undefined);
}

/** While the app is open, show pushes as in-app toasts instead. */
export async function listenForeground(show: (title: string, body: string) => void): Promise<() => void> {
  if ((await pushStatus()) !== 'on') return () => undefined;
  return onMessage(getMessaging(app), (m) => show(m.data?.title ?? 'FilmRoll', m.data?.body ?? ''));
}

export function promptDismissed(): boolean {
  try {
    return localStorage.getItem('filmroll:pushPromptDismissed') === '1';
  } catch {
    return true;
  }
}
export function dismissPrompt() {
  try {
    localStorage.setItem('filmroll:pushPromptDismissed', '1');
  } catch {
    /* ignore */
  }
}
