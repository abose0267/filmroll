import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Lock, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useData';
import { Button, Field, Sheet, TextInput, cx, useToast } from './ui';
import { KEYS_EVENT, createRecoveryCode, encryptionStatus, myDevice, restoreFromCode, watchKeyRequests } from '@/lib/e2ee';
import { errorMessage } from '@/lib/api';

/**
 * Runs in the background for people in encrypted groups: registers this
 * device's public key and answers friends' devices that are missing keys.
 */
export function KeySteward() {
  const { user } = useAuth();
  const { groups } = useMyGroups();
  const ids = groups.filter((g) => g.settings.e2ee).map((g) => g.id);
  const key = ids.join(',');
  useEffect(() => {
    if (!user || !ids.length) return;
    void myDevice(user.uid).catch(() => undefined);
    return watchKeyRequests(user.uid, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, key]);
  return null;
}

const PROS = [
  'Truly private. Photos and notes are locked on your phone before they upload. Only phones of people in this group can unlock them — not FilmRoll, not its developer, not Google.',
  'If FilmRoll’s servers were ever hacked, your photos would just be scrambled data.',
  'Nothing changes day to day: shooting, developing and the reveal all work the same.',
];
const CONS = [
  'The keys live on your phones. On a new phone (or after clearing Safari), a friend’s FilmRoll needs to be open to unlock old photos for you — or you use your recovery code.',
  'If everyone in the group loses their keys and nobody saved a recovery code, the photos are gone for good. Nobody can get them back — not even FilmRoll.',
  'It only covers photos taken after you turn it on. Comments, reactions and roll names aren’t encrypted.',
  'Everyone needs the latest version of the app to shoot on this group’s rolls.',
  'As with any website, you’re trusting that the app itself hasn’t been tampered with.',
];

/** Plain-language pros and cons, shown before turning encryption on. */
export function EncryptionExplainer() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      <p className="text-ink-soft">
        Think of it like a lockbox: each photo is locked on the phone that took it, and only the phones of people in this group have the key.
      </p>
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-semibold"><ThumbsUp className="size-4 text-coral-deep" /> The good</p>
        <ul className="space-y-2">{PROS.map((t) => <li key={t} className="rounded-2xl bg-paper-2 px-3 py-2">{t}</li>)}</ul>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-semibold"><ThumbsDown className="size-4 text-ink-soft" /> The trade-offs</p>
        <ul className="space-y-2">{CONS.map((t) => <li key={t} className="rounded-2xl bg-paper-2 px-3 py-2">{t}</li>)}</ul>
      </div>
    </div>
  );
}

/** Group settings → Privacy: the opt-in switch (admins), with the explainer first. */
export function GroupEncryption({ on, canEdit, onChange }: { on: boolean; canEdit: boolean; onChange: (v: boolean) => Promise<void> }) {
  const [sheet, setSheet] = useState<'on' | 'off' | 'info' | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const apply = async (v: boolean) => {
    setBusy(true);
    try {
      await onChange(v);
      setSheet(null);
      toast(v ? 'End-to-end encryption is on for new photos. 🔒' : 'Encryption is off for new photos.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className={cx('grid size-10 shrink-0 place-items-center rounded-2xl', on ? 'bg-coral text-cream' : 'bg-paper-2 text-ink-soft')}>{on ? <Lock className="size-5" /> : <ShieldCheck className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">End-to-end encryption {on ? 'is on' : 'is off'}</p>
          <p className="text-sm text-ink-soft">{on ? 'New photos and notes are locked on members’ phones. Only this group can see them.' : 'Optional. Lock photos so only this group’s phones can open them — not even FilmRoll.'}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {canEdit && (
          <Button size="sm" variant={on ? 'secondary' : 'primary'} onClick={() => setSheet(on ? 'off' : 'on')}>{on ? 'Turn off' : 'Turn on…'}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setSheet('info')}>What does this mean?</Button>
      </div>
      {!canEdit && !on && <p className="text-xs text-ink-faint">Only the group’s owner or admins can turn it on.</p>}

      <Sheet open={sheet === 'on' || sheet === 'info'} onClose={() => setSheet(null)} title="End-to-end encryption" tall>
        <div className="space-y-5 pb-4">
          <EncryptionExplainer />
          {sheet === 'on' && (
            <div className="space-y-2">
              <p className="text-sm text-ink-soft">After turning it on, everyone should make a recovery code in Profile — it’s the backup key.</p>
              <Button className="w-full" icon={<Lock className="size-5" />} loading={busy} onClick={() => apply(true)}>Turn on encryption</Button>
            </div>
          )}
        </div>
      </Sheet>
      <Sheet open={sheet === 'off'} onClose={() => setSheet(null)} title="Turn off encryption?">
        <div className="space-y-4 pb-4">
          <p className="text-ink-soft">New photos will upload without end-to-end encryption (they’re still private to the group and hidden until the roll develops). Photos already taken stay locked and keep needing your phones’ keys.</p>
          <Button variant="danger" className="w-full" loading={busy} onClick={() => apply(false)}>Turn off for new photos</Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Profile → Encryption: recovery code (create / restore) for people in encrypted groups. */
export function RecoveryCodeSection() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof encryptionStatus>> | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = () => encryptionStatus(user.uid).then(setStatus, () => undefined);
    void load();
    addEventListener(KEYS_EVENT, load);
    return () => removeEventListener(KEYS_EVENT, load);
  }, [user, code]);

  if (!user) return null;
  const make = async () => {
    setBusy(true);
    try {
      setCode(await createRecoveryCode(user.uid));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setBusy(true);
    try {
      const n = await restoreFromCode(user.uid, input);
      setRestoring(false);
      setInput('');
      toast(n ? `Restored ${n} ${n === 1 ? 'key' : 'keys'} — locked photos will open now.` : 'This phone already had every key in your backup.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Your encrypted groups’ keys live on this phone{status ? ` (${status.keys} ${status.keys === 1 ? 'key' : 'keys'})` : ''}. A recovery code backs them up — locked with the code, so only you can use it.
      </p>
      {status?.backup && status.linked ? (
        <p className="flex items-center gap-2 text-sm font-semibold"><Check className="size-4 text-coral" /> Backed up with your recovery code ({status.backup.count} {status.backup.count === 1 ? 'key' : 'keys'})</p>
      ) : status?.backup ? (
        <p className="text-sm font-semibold">You have a recovery code. Enter it to unlock your photos on this phone.</p>
      ) : (
        <p className="text-sm font-semibold text-coral-deep">No recovery code yet — make one so you can never get locked out.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {status?.backup && !status.linked && <Button size="sm" icon={<KeyRound className="size-4" />} onClick={() => setRestoring(true)}>Enter recovery code</Button>}
        <Button size="sm" variant={status?.backup ? 'secondary' : 'primary'} loading={busy && !restoring} onClick={make}>{status?.backup ? 'Make a new code' : 'Make a recovery code'}</Button>
      </div>

      <Sheet open={!!code} onClose={() => setCode(null)} title="Your recovery code">
        <div className="space-y-4 pb-4">
          <p className="text-ink-soft">Write it down or save it in your password manager. FilmRoll can’t show it again or reset it{status?.backup ? ', and any older code stops working' : ''}.</p>
          <button
            onClick={() => code && navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-paper-2 px-4 py-4 font-mono text-lg tracking-wider active:scale-[0.99]"
            aria-label="Copy recovery code"
          >
            <span data-testid="recovery-code">{code}</span> {copied ? <Check className="size-5 text-coral" /> : <Copy className="size-5 text-ink-faint" />}
          </button>
          <Button className="w-full" onClick={() => setCode(null)}>I’ve saved it</Button>
        </div>
      </Sheet>
      <Sheet open={restoring} onClose={() => setRestoring(false)} title="Enter recovery code">
        <form className="space-y-4 pb-4" onSubmit={(e) => { e.preventDefault(); void restore(); }}>
          <Field label="Recovery code">
            <TextInput value={input} onChange={(e) => setInput(e.target.value)} placeholder="ABCD-EFGH-…" autoCapitalize="characters" autoComplete="off" className="font-mono uppercase tracking-wider" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={input.replace(/[^a-z0-9]/gi, '').length < 24}>Unlock my photos</Button>
        </form>
      </Sheet>
    </div>
  );
}
