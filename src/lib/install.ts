/**
 * "Add to Home Screen" support. FilmRoll works best installed (push on iPhone
 * only works from the home screen, and Safari's storage is separate from the
 * installed app's), so phones are asked to install before signing up.
 *
 * Android/Chrome: `beforeinstallprompt` lets us open the system install dialog
 * from our own button. iOS has no such API, so we show where to tap instead.
 */
import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const EVENT = 'filmroll:install';

// Registered at import time (from main.tsx) because Chrome fires it early.
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    dispatchEvent(new Event(EVENT));
  });
  addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    dispatchEvent(new Event(EVENT));
  });
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type Platform = 'ios' | 'ios-other' | 'android' | 'in-app' | 'desktop';

export function platform(ua = navigator.userAgent, touchMac = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)): Platform {
  if (/FBAN|FBAV|Instagram|Snapchat|Line\/|LinkedInApp|TikTok|musical_ly|Twitter|GSA\//i.test(ua)) return 'in-app';
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

const SKIP_KEY = 'filmroll:install-skip';

/** Phones that aren't running the installed app (and haven't chosen the browser) see the install screen. */
export function shouldAskToInstall(): boolean {
  if (isStandalone() || platform() === 'desktop') return false;
  try {
    if (sessionStorage.getItem(SKIP_KEY) || localStorage.getItem(SKIP_KEY)) return false;
  } catch {
    /* storage blocked: still ask */
  }
  return true;
}

export function skipInstall() {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** The one-tap install dialog, when the browser offers one. */
export function useInstallPrompt(): { canPrompt: boolean; installed: boolean; prompt: () => Promise<boolean> } {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  return {
    canPrompt: !!deferred,
    installed,
    prompt: async () => {
      const e = deferred;
      if (!e) return false;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferred = null;
      force((n) => n + 1);
      return outcome === 'accepted';
    },
  };
}
