import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { getDownloadURL } from 'firebase/storage';
import { Camera } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, Button, Field, TextInput, cx, useToast } from '@/components/ui';
import { DisposableCamera, FilmStrip } from '@/components/film';
import { db, storage } from '@/lib/firebase';
import { errorMessage } from '@/lib/api';
import { decode, drawScaled } from '@/lib/image';
import { randomRequestId } from '@/lib/format';
import { LIMITS } from '@shared/constants';
import { cleanText, displayNameError } from '@shared/validation';

const SLIDES = [
  { title: 'Make a roll.', body: 'Start a shared disposable camera with your friends — 12, 24 or 36 exposures.', art: <DisposableCamera preset="classic35" remaining={24} width={240} /> },
  { title: 'Capture life.', body: 'Everyone adds little moments from their day. The photos stay hidden — even from you.', art: <HiddenFrames /> },
  { title: 'Develop together.', body: 'When the roll is full or its date arrives, everyone’s memories are revealed at once.', art: <DisposableCamera preset="warmVintage" remaining={0} width={240} /> },
];

function HiddenFrames() {
  return (
    <FilmStrip className="w-64 -rotate-2">
      <div className="grid grid-cols-3 gap-1.5 py-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid aspect-[4/5] place-items-center rounded-[3px] bg-gradient-to-br from-[#4a2a1a] to-[#1d120c] font-mono text-[10px] text-amber/70">{i + 7}</div>
        ))}
      </div>
    </FilmStrip>
  );
}

/** Uploads a square-ish avatar (≤512px JPEG) and returns its download URL. */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const bmp = await decode(file);
  const c = drawScaled(bmp, 512);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
  const r = ref(storage, `avatars/${uid}/${randomRequestId()}.jpg`);
  await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(r);
}

export default function OnboardingPage() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(profile?.photoURL ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const next = params.get('next');
  const onProfile = step === SLIDES.length;

  async function finish() {
    if (!user) return;
    const err = displayNameError(name);
    if (err) return setError(err);
    setBusy(true);
    try {
      const photoURL = photo ? await uploadAvatar(user.uid, photo) : (profile?.photoURL ?? null);
      await updateDoc(doc(db, 'users', user.uid), { displayName: cleanText(name, LIMITS.displayName), city: cleanText(city, LIMITS.city), photoURL, onboarded: true });
      nav(next && next.startsWith('/') && !next.startsWith('/welcome') ? next : '/', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col px-6 pb-safe pt-safe">
      <div className="flex justify-between py-2">
        <div className="flex gap-1.5" aria-hidden>
          {[...SLIDES, null].map((_, i) => <span key={i} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-coral' : 'w-1.5 bg-ink/15')} />)}
        </div>
        {!onProfile && <button className="text-sm font-semibold text-ink-soft" onClick={() => setStep(SLIDES.length)}>Skip</button>}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="flex flex-1 flex-col"
          initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: -40, opacity: 0 }}
          transition={{ duration: 0.25 }}
          drag={onProfile || reduce ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={(_, i) => {
            if (i.offset.x < -60) setStep((s) => Math.min(SLIDES.length, s + 1));
            if (i.offset.x > 60) setStep((s) => Math.max(0, s - 1));
          }}
        >
          {!onProfile ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-10 text-center">
              <div className="grid h-56 place-items-center">{SLIDES[step].art}</div>
              <div className="space-y-3">
                <h1 className="font-display text-4xl font-semibold">{SLIDES[step].title}</h1>
                <p className="mx-auto max-w-xs text-lg text-ink-soft">{SLIDES[step].body}</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 space-y-6 pt-6">
              <div className="space-y-2 text-center">
                <h1 className="font-display text-3xl font-semibold">Load your camera</h1>
                <p className="text-ink-soft">This is how friends will see you.</p>
              </div>
              <div className="flex justify-center">
                <button type="button" onClick={() => file.current?.click()} className="relative" aria-label="Choose a profile photo">
                  <Avatar name={name || 'You'} url={preview} size={96} />
                  <span className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full bg-ink text-cream ring-4 ring-paper"><Camera className="size-4" /></span>
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > LIMITS.inputBytes) return toast('That photo is too large.', 'error');
                    setPhoto(f);
                    setPreview(URL.createObjectURL(f));
                  }}
                />
              </div>
              <Field label="Your name" error={error}>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.displayName} autoComplete="name" />
              </Field>
              <Field label="City" hint="Optional. Shown to your groups.">
                <TextInput value={city} onChange={(e) => setCity(e.target.value)} maxLength={LIMITS.city} placeholder="e.g. Chicago" autoComplete="address-level2" />
              </Field>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="pb-4 pt-6">
        {onProfile ? (
          <Button size="lg" className="w-full" loading={busy} onClick={finish}>Start using FilmRoll</Button>
        ) : (
          <Button size="lg" className="w-full" onClick={() => setStep((s) => s + 1)}>{step === SLIDES.length - 1 ? 'Set up my profile' : 'Next'}</Button>
        )}
      </div>
    </main>
  );
}
