import { useEffect, useState } from 'react';
import { BellRing, Share } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { dismissPrompt, enablePush, promptDismissed, pushStatus, type PushStatus } from '@/lib/push';
import { errorMessage } from '@/lib/api';
import { Button, useToast } from './ui';

/** Asks for push only after a meaningful moment (you've shot on this roll), never during onboarding. */
export default function PushPrompt() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [hidden, setHidden] = useState(promptDismissed());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushStatus().then(setStatus, () => setStatus('unsupported'));
  }, []);
  if (!user || hidden || !status || (status !== 'off' && status !== 'needs-install')) return null;
  const close = () => {
    dismissPrompt();
    setHidden(true);
  };
  return (
    <section className="flex gap-3 rounded-3xl bg-ink p-4 text-cream shadow-soft" aria-label="Notifications">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10">{status === 'needs-install' ? <Share className="size-5" /> : <BellRing className="size-5" />}</span>
      <div className="min-w-0 flex-1 space-y-2">
        {status === 'needs-install' ? (
          <>
            <p className="font-semibold">Want a ping when your film develops?</p>
            <p className="text-sm text-cream/75">On iPhone, add FilmRoll to your Home Screen first: tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from there.</p>
            <Button size="sm" variant="secondary" onClick={close}>Got it</Button>
          </>
        ) : (
          <>
            <p className="font-semibold">Get a ping when your film develops?</p>
            <p className="text-sm text-cream/75">Just the moments that matter — no streaks, no nagging. You can change it anytime in Profile.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const s = await enablePush(user.uid);
                    if (s === 'on') toast('Notifications on for this device.');
                    else if (s === 'blocked') toast('Notifications are blocked in your browser settings.', 'error');
                    close();
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Turn on
              </Button>
              <Button size="sm" variant="ghost" className="!text-cream" onClick={close}>Not now</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
