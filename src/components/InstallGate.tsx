import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Copy, Download, PlusSquare, Share } from 'lucide-react';
import { Button } from './ui';
import { platform, skipInstall, useInstallPrompt } from '@/lib/install';
import { normalizeInviteCode } from '@shared/validation';

export const PENDING_INVITE_KEY = 'filmroll:pending-invite';

/** Invite code from a /join/CODE link, so it survives the trip to the home screen. */
function inviteFromPath(): string | null {
  const m = location.pathname.match(/\/join\/([^/?#]+)/);
  return m ? normalizeInviteCode(decodeURIComponent(m[1])) : null;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-cream px-4 py-3 text-left shadow-soft">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-mono text-sm text-cream">{n}</span>
      <span className="min-w-0 leading-snug">{children}</span>
    </li>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="mx-0.5 inline-flex items-center gap-1 rounded-lg bg-paper-2 px-1.5 py-0.5 align-middle text-sm font-semibold">{children}</span>;
}

/**
 * Shown on phones, in the browser, before signing up: FilmRoll asks to be
 * added to the home screen first so the account lives in the installed app.
 */
export default function InstallGate({ onSkip }: { onSkip: () => void }) {
  const reduce = useReducedMotion();
  const os = platform();
  const { canPrompt, installed, prompt } = useInstallPrompt();
  const [invite] = useState(inviteFromPath);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Android shares storage with the installed app, so the invite is picked up there automatically.
    if (invite) {
      try {
        localStorage.setItem(PENDING_INVITE_KEY, invite);
      } catch {
        /* ignore */
      }
    }
  }, [invite]);

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      /* the code is on screen anyway */
    }
  };

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col px-6 pb-safe pt-safe" aria-labelledby="install-title">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
        <motion.img
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt=""
          className="size-24 rounded-[26px] shadow-soft"
          initial={reduce ? false : { scale: 0.8, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 14 }}
        />
        <div className="space-y-2">
          <h1 id="install-title" className="font-display text-4xl font-semibold">Put FilmRoll on your home screen</h1>
          <p className="text-ink-soft">It’s a camera — keep it one tap away. Installed, it opens full-screen and can tell you when your film develops.</p>
        </div>

        {invite && (
          <div className="w-full rounded-3xl bg-amber/25 p-4 ring-1 ring-amber/40">
            <p className="text-sm text-ink-soft">You’ve been invited! After installing, join with this code:</p>
            <button onClick={copy} className="mt-2 inline-flex items-center gap-2 rounded-xl bg-cream px-4 py-2 font-mono text-xl tracking-widest shadow-soft active:scale-95" aria-label={`Copy invite code ${invite}`}>
              {invite} {copied ? <Check className="size-5 text-coral" /> : <Copy className="size-5 text-ink-faint" />}
            </button>
          </div>
        )}

        {installed ? (
          <p className="rounded-2xl bg-cream px-4 py-3 font-semibold shadow-soft">Installed! Open FilmRoll from your home screen. 🎞️</p>
        ) : canPrompt ? (
          <Button size="lg" className="w-full" icon={<Download className="size-5" />} onClick={() => void prompt()}>Install FilmRoll</Button>
        ) : os === 'in-app' ? (
          <ol className="w-full space-y-2">
            <Step n={1}>Tap <Key>•••</Key> in this app’s corner</Step>
            <Step n={2}>Choose <Key>Open in browser</Key> (Safari on iPhone)</Step>
            <Step n={3}>Then add FilmRoll to your home screen from there</Step>
          </ol>
        ) : os === 'android' ? (
          <ol className="w-full space-y-2">
            <Step n={1}>Tap <Key>⋮</Key> in your browser’s menu</Step>
            <Step n={2}>Choose <Key>Install app</Key> or <Key>Add to Home screen</Key></Step>
            <Step n={3}>Open FilmRoll from your home screen</Step>
          </ol>
        ) : (
          <ol className="w-full space-y-2">
            <Step n={1}>Tap <Key><Share className="size-4" /> Share</Key> — on newer iPhones it’s inside <Key>•••</Key> next to the address bar</Step>
            <Step n={2}>Scroll and tap <Key><PlusSquare className="size-4" /> Add to Home Screen</Key></Step>
            <Step n={3}>Open FilmRoll from your home screen</Step>
          </ol>
        )}
      </div>

      <div className="space-y-2 pb-4 text-center">
        <button
          className="h-11 px-4 text-sm font-semibold text-ink-soft underline-offset-4 active:underline"
          onClick={() => {
            skipInstall();
            onSkip();
          }}
        >
          Use it in the browser instead
        </button>
      </div>
    </main>
  );
}
