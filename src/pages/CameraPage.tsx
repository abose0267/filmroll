import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarDays, Camera as CameraIcon, MapPin, RefreshCcw, SwitchCamera, Volume2, VolumeX, X, Zap, ZapOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useActiveRolls, useMyGroups, useOnline } from '@/hooks/useData';
import { Button, FullScreenLoader, IconButton, TextArea, TextInput, cx, useToast } from '@/components/ui';
import { DisposableCamera, FilmStrip } from '@/components/film';
import { errorCode, errorMessage } from '@/lib/api';
import { decode, previewUrl, processPhoto } from '@/lib/image';
import { submitExposure, type SubmitStage } from '@/lib/upload';
import { playAdvance, playShutter, vibrate } from '@/lib/sound';
import { randomRequestId } from '@/lib/format';
import { FALLBACK_FILE_MAX_AGE_MS, LIMITS } from '@shared/constants';
import { PRESETS, dateStampText, seedFrom } from '@shared/presets';
import { shotsRemaining } from '@shared/rolls';
import type { GroupDoc, RollDoc } from '@shared/types';

type Facing = 'environment' | 'user';
type Stage = 'camera' | 'confirm' | 'submitting' | 'done';

/** CSS approximation of the film so the viewfinder hints at the look. */
function viewfinderFilter(roll: RollDoc): string {
  const p = PRESETS[roll.preset].params;
  return [p.mono ? 'grayscale(1)' : `saturate(${1 + p.saturation * 0.8})`, `contrast(${1 + p.contrast * 0.6})`, `brightness(${1 + p.exposure * 0.4})`, p.warmth > 0.15 ? `sepia(${p.warmth * 0.6})` : ''].join(' ');
}

const SAVED = ['One more memory captured.', 'Your photo is safely tucked away.', 'Click. That one’s on the roll.', 'Saved for later. No peeking!'];

function readPref(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(`filmroll:${key}`);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(`filmroll:${key}`, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function RollPicker({ groups, rolls }: { groups: GroupDoc[]; rolls: RollDoc[] }) {
  const nav = useNavigate();
  const shootable = rolls.filter((r) => r.status === 'active' && shotsRemaining(r) > 0);
  return (
    <main className="mx-auto min-h-full max-w-lg bg-body px-5 pb-safe pt-safe text-cream">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-2xl font-semibold">Which roll?</h1>
        <IconButton label="Close camera" onClick={() => nav(-1)} className="text-cream active:bg-white/10"><X className="size-6" /></IconButton>
      </div>
      {shootable.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <DisposableCamera preset="classic35" width={220} />
          <h2 className="font-display text-2xl">No roll in the camera</h2>
          <p className="max-w-xs text-cream/70">{groups.length ? 'Start a roll in one of your groups to begin shooting.' : 'Create or join a group first.'}</p>
          <Link to={groups.length ? `/g/${groups[0].id}` : '/'}><Button>{groups.length ? 'Go to my group' : 'Get started'}</Button></Link>
        </div>
      ) : (
        <ul className="space-y-3 pt-4">
          {shootable.map((r) => {
            const g = groups.find((x) => x.id === r.groupId);
            return (
              <li key={r.id}>
                <button onClick={() => nav(`/camera?g=${r.groupId}`, { replace: true })} className="flex w-full items-center gap-4 rounded-3xl bg-white/5 p-4 text-left ring-1 ring-white/10 active:bg-white/10">
                  <DisposableCamera preset={r.preset} remaining={shotsRemaining(r)} width={110} />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-xl">{g?.name}</span>
                    <span className="block truncate text-cream/70">{r.name}</span>
                    <span className="block font-mono text-sm text-amber">{shotsRemaining(r)} shots left</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function CameraPage() {
  const [params] = useSearchParams();
  const gid = params.get('g');
  const { groups, loading: gLoading } = useMyGroups();
  const { rolls, loading: rLoading } = useActiveRolls(groups);
  const roll = useMemo(() => {
    if (gid) return rolls.find((r) => r.groupId === gid) ?? null;
    const shootable = rolls.filter((r) => r.status === 'active' && shotsRemaining(r) > 0);
    return shootable.length === 1 ? shootable[0] : null;
  }, [gid, rolls]);
  // Keep the camera mounted after the last shot develops the roll, so the
  // "captured" screen can finish instead of jumping to the picker.
  const pinned = useRef<RollDoc | null>(null);
  if (roll && roll.status === 'active') pinned.current = roll;
  if (gLoading || rLoading) return <div className="h-full bg-body"><FullScreenLoader /></div>;
  if (pinned.current && (!roll || roll.id === pinned.current.id) && (!gid || gid === pinned.current.groupId)) {
    const r = roll ?? { ...pinned.current, status: 'developed' as const };
    const g = groups.find((x) => x.id === r.groupId);
    if (g) return <Camera key={r.id} roll={r} group={g} />;
  }
  if (!roll || roll.status !== 'active') {
    if (gid && roll) {
      return (
        <main className="flex h-full flex-col items-center justify-center gap-4 bg-body px-6 text-center text-cream">
          <h1 className="font-display text-2xl">This roll is developing</h1>
          <p className="text-cream/70">No more shots — the reveal is almost here.</p>
          <Link to={`/g/${gid}`}><Button>Back to group</Button></Link>
        </main>
      );
    }
    return <RollPicker groups={groups} rolls={rolls} />;
  }
  return null;
}

function Camera({ roll, group }: { roll: RollDoc; group: GroupDoc }) {
  const nav = useNavigate();
  const toast = useToast();
  const reduce = useReducedMotion();
  const online = useOnline();
  const { profile } = useAuth();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const nativeInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [facing, setFacing] = useState<Facing>('environment');
  const [camState, setCamState] = useState<'starting' | 'live' | 'denied' | 'unsupported' | 'error'>('starting');
  const [canFlip, setCanFlip] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [flash, setFlash] = useState(() => readPref('flash', false));
  const [sound, setSound] = useState(() => readPref('sound', false));
  const [blink, setBlink] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [capturedAt, setCapturedAt] = useState(Date.now());
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [progress, setProgress] = useState<{ stage: SubmitStage; progress: number }>({ stage: 'reserving', progress: 0 });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingAfter, setRemainingAfter] = useState<number | null>(null);
  const [savedLine] = useState(() => SAVED[Math.floor(Math.random() * SAVED.length)]);
  const attempt = useRef<{ requestId: string; reservation?: { reservationId: string; uploadPrefix: string } } | null>(null);
  const seed = useRef(seedFrom(randomRequestId()));

  const remaining = shotsRemaining(roll);

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const startStream = useCallback(async (face: Facing) => {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamState('unsupported');
      return;
    }
    setCamState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: face }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(!!caps.torch);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
      setCamState('live');
    } catch (e) {
      const name = (e as Error).name;
      setCamState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unsupported' : 'error');
    }
  }, [stopStream]);

  useEffect(() => {
    if (stage === 'camera') void startStream(facing);
    else stopStream();
  }, [stage, facing, startStream, stopStream]);
  useEffect(() => stopStream, [stopStream]);

  // Pause the camera when the app is backgrounded.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) stopStream();
      else if (stage === 'camera') void startStream(facing);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [stage, facing, startStream, stopStream]);

  // Build the film preview whenever a new image is chosen.
  useEffect(() => {
    if (!bitmap) return;
    let alive = true;
    let url: string | null = null;
    previewUrl(bitmap, { preset: roll.preset, seed: seed.current, dateStamp: roll.dateStamp, capturedAt }).then((u) => {
      url = u;
      if (alive) setPreview(u);
      else URL.revokeObjectURL(u);
    }, (e) => toast(errorMessage(e), 'error'));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bitmap, roll.preset, roll.dateStamp, capturedAt, toast]);

  function acceptImage(b: ImageBitmap, at: number) {
    bitmap?.close();
    seed.current = seedFrom(randomRequestId());
    attempt.current = null;
    setSubmitError(null);
    setPreview(null);
    setBitmap(b);
    setCapturedAt(at);
    setStage('confirm');
  }

  async function shoot() {
    const v = video.current;
    if (!v || camState !== 'live' || !v.videoWidth) return;
    const track = stream.current?.getVideoTracks()[0];
    if (sound) playShutter();
    vibrate(15);
    if (flash && facing === 'user') {
      setScreenFlash(true);
      await new Promise((r) => setTimeout(r, 180));
    }
    if (flash && torchSupported && track) await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => undefined);
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    if (facing === 'user') {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    if (flash && torchSupported && track) await track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    setScreenFlash(false);
    setBlink(true);
    setTimeout(() => setBlink(false), reduce ? 0 : 160);
    acceptImage(await createImageBitmap(c), Date.now());
  }

  /** Phone-camera fallback (when the in-app camera can't open). Only brand-new shots are accepted. */
  async function fromPhoneCamera(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/') && f.type !== '') return toast('That isn’t a photo.', 'error');
    const age = Date.now() - f.lastModified;
    if (!f.lastModified || age > FALLBACK_FILE_MAX_AGE_MS || age < -60_000) {
      return toast('FilmRoll only takes photos shot just now — no old ones from your library.', 'error');
    }
    try {
      const b = await decode(f);
      acceptImage(b, Date.now());
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function submit() {
    if (!bitmap) return;
    if (!online) return setSubmitError('You’re offline. Connect to the internet to save this photo.');
    setStage('submitting');
    setSubmitError(null);
    attempt.current ??= { requestId: randomRequestId() };
    try {
      setProgress({ stage: 'reserving', progress: 0 });
      const processed = await processPhoto(bitmap, { preset: roll.preset, seed: seed.current, dateStamp: roll.dateStamp, capturedAt });
      const out = await submitExposure(
        { groupId: roll.groupId, rollId: roll.id, requestId: attempt.current.requestId, photo: processed, caption: caption.trim(), location: location.trim(), capturedAt, preset: roll.preset },
        setProgress,
        attempt.current.reservation,
      );
      setRemainingAfter(out.remaining);
      if (sound) playAdvance();
      vibrate([10, 40, 10]);
      // The photo is now hidden — even from you. Drop every local copy.
      bitmap.close();
      setBitmap(null);
      setPreview(null);
      setCaption('');
      attempt.current = null;
      setStage('done');
    } catch (e) {
      const code = errorCode(e);
      const res = (e as { reservation?: { reservationId: string; uploadPrefix: string } }).reservation;
      if (res && attempt.current) attempt.current.reservation = res;
      if (code === 'functions/deadline-exceeded') attempt.current = null; // expired: next try takes a fresh exposure
      if (code === 'functions/resource-exhausted' && /No exposures left/.test(errorMessage(e))) {
        setSubmitError('Someone just took the last shot on this roll! Your photo wasn’t added.');
      } else if (code === 'functions/failed-precondition' && /developed/i.test(errorMessage(e))) {
        setSubmitError('The roll developed before your photo finished uploading, so it wasn’t added.');
      } else setSubmitError(errorMessage(e));
      setStage('confirm');
    }
  }

  const leave = () => {
    stopStream();
    nav(`/g/${roll.groupId}`);
  };

  return (
    <main className="fixed inset-0 flex flex-col bg-body text-cream" aria-label="Camera">
      {/* top bar */}
      <div className="flex items-center gap-2 px-3 pt-safe">
        <IconButton label="Close camera" onClick={leave} className="text-cream active:bg-white/10"><X className="size-6" /></IconButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="truncate text-xs text-cream/60">{roll.name} · <span className="font-mono">{PRESETS[roll.preset].code}</span></p>
        </div>
        <div className="grid h-9 min-w-14 place-items-center rounded-lg bg-black px-2 font-mono text-lg text-amber shadow-inner" aria-label={`${remaining} exposures left`}>
          {String(stage === 'done' && remainingAfter != null ? remainingAfter : remaining).padStart(2, '0')}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {stage === 'camera' && (
          <motion.section key="cam" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-4">
              <div className="relative aspect-[3/4] max-h-full w-full max-w-md overflow-hidden rounded-[22px] bg-black shadow-[inset_0_0_0_6px_#1a1816]">
                <video
                  ref={video}
                  playsInline
                  muted
                  autoPlay
                  className={cx('size-full object-cover', facing === 'user' && '-scale-x-100', camState !== 'live' && 'opacity-0')}
                  style={{ filter: viewfinderFilter(roll) }}
                  aria-label="Viewfinder"
                />
                {camState !== 'live' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    {camState === 'starting' ? (
                      <p className="text-sm text-cream/70">Warming up the camera…</p>
                    ) : (
                      <>
                        <CameraIcon className="size-10 text-cream/40" />
                        <p className="text-sm text-cream/80">
                          {camState === 'denied' && 'Camera access is off. You can allow it in your browser settings, or use your phone’s camera instead.'}
                          {camState === 'unsupported' && 'This browser can’t open the camera here. Use your phone’s camera or pick a photo.'}
                          {camState === 'error' && 'The camera couldn’t start. Try again, or use your phone’s camera.'}
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button size="sm" onClick={() => nativeInput.current?.click()}>Use phone camera</Button>
                          {camState !== 'unsupported' && <Button size="sm" variant="secondary" onClick={() => startStream(facing)}>Try again</Button>}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* frame guides */}
                <div className="pointer-events-none absolute inset-3 rounded-[14px] border border-white/15" />
                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
                {roll.dateStamp && <span className="pointer-events-none absolute bottom-4 right-5 font-mono text-sm text-stamp/80">{dateStampText(Date.now())}</span>}
                <AnimatePresence>{blink && <motion.div className="absolute inset-0 bg-black" initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />}</AnimatePresence>
              </div>
            </div>

            <div className="flex items-center justify-center gap-6 pb-2 text-cream/80">
              <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold active:bg-white/10" onClick={() => { setFlash(!flash); writePref('flash', !flash); }} aria-pressed={flash}>
                {flash ? <Zap className="size-4 text-amber" /> : <ZapOff className="size-4" />} Flash {flash ? 'on' : 'off'}
              </button>
              <span className="flex items-center gap-1.5 text-xs"><CalendarDays className="size-4" /> {roll.dateStamp ? 'Date stamp' : 'No stamp'}</span>
              <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold active:bg-white/10" onClick={() => { setSound(!sound); writePref('sound', !sound); }} aria-pressed={sound}>
                {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Sound
              </button>
            </div>

            <div className="flex items-center justify-around px-8 pb-safe pt-2">
              {/* no gallery: only fresh shots go on the roll */}
              <span className="size-14" aria-hidden />
              <button
                onClick={camState === 'live' ? shoot : () => nativeInput.current?.click()}
                aria-label="Take photo"
                className="grid size-[84px] place-items-center rounded-full bg-cream/15 ring-4 ring-cream/80 transition active:scale-90"
              >
                <span className="size-[64px] rounded-full bg-coral shadow-[inset_0_-4px_0_rgba(0,0,0,0.2)]" />
              </button>
              <IconButton label="Switch camera" disabled={!canFlip || camState !== 'live'} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} className="size-14 bg-white/10 text-cream active:bg-white/20 disabled:opacity-30"><SwitchCamera className="size-6" /></IconButton>
            </div>
          </motion.section>
        )}

        {(stage === 'confirm' || stage === 'submitting') && (
          <motion.section key="confirm" className="flex min-h-0 flex-1 flex-col overflow-y-auto" initial={{ opacity: 0, y: reduce ? 0 : 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="flex justify-center px-6 pt-4">
              <div className="w-full max-w-sm -rotate-1 bg-cream p-3 pb-10 shadow-print">
                {preview ? <img src={preview} alt="Your photo with the film effect" className="aspect-[3/4] w-full object-cover" /> : <div className="grid aspect-[3/4] place-items-center bg-[#2a2622] text-sm text-cream/60">Developing preview…</div>}
                <p className="mt-2 text-center font-mono text-[11px] text-ink-soft">{PRESETS[roll.preset].name}</p>
              </div>
            </div>
            <div className="mx-auto w-full max-w-md space-y-3 px-5 pb-safe pt-5">
              {stage === 'confirm' && (
                <div className="flex justify-center gap-2">
                  <Button size="sm" variant="ghost" className="!text-cream" icon={<RefreshCcw className="size-4" />} onClick={() => { bitmap?.close(); setBitmap(null); setStage('camera'); }}>Retake</Button>
                </div>
              )}
              <TextArea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, LIMITS.caption))} rows={2} placeholder="Add a caption (optional)" aria-label="Caption" disabled={stage === 'submitting'} className="!border-white/10 !bg-white/10 !text-cream placeholder:!text-cream/40" />
              <div className="flex items-center gap-2">
                <MapPin className="size-5 shrink-0 text-cream/50" />
                <TextInput value={location} onChange={(e) => setLocation(e.target.value.slice(0, LIMITS.location))} placeholder="Location (optional)" aria-label="Location" disabled={stage === 'submitting'} className="!border-white/10 !bg-white/10 !py-2.5 !text-cream placeholder:!text-cream/40" />
                {profile?.city && !location && stage === 'confirm' && <button className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold" onClick={() => setLocation(profile.city)}>{profile.city}</button>}
              </div>
              {submitError && <p className="rounded-2xl bg-[#B5443A]/90 px-4 py-3 text-sm" role="alert">{submitError}</p>}
              {stage === 'submitting' ? (
                <div className="space-y-2 py-2" role="status">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full bg-coral" animate={{ width: `${Math.max(6, (progress.stage === 'finalizing' || progress.stage === 'done' ? 1 : progress.stage === 'uploading' ? 0.1 + progress.progress * 0.8 : 0.05) * 100)}%` }} />
                  </div>
                  <p className="text-center text-sm text-cream/70">
                    {progress.stage === 'reserving' && 'Advancing the film…'}
                    {progress.stage === 'uploading' && `Tucking it away… ${Math.round(progress.progress * 100)}%`}
                    {(progress.stage === 'finalizing' || progress.stage === 'done') && 'Almost there…'}
                  </p>
                </div>
              ) : (
                <Button size="lg" className="w-full" disabled={!preview} onClick={submit}>{submitError ? 'Try again' : 'Use one exposure'}</Button>
              )}
              <p className="pb-4 text-center text-xs text-cream/50">Once it’s on the roll, nobody — not even you — sees it until the roll develops.</p>
            </div>
          </motion.section>
        )}

        {stage === 'done' && (
          <motion.section key="done" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-safe text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="w-full max-w-sm overflow-hidden">
              <motion.div initial={reduce ? false : { x: '40%' }} animate={{ x: '-20%' }} transition={{ duration: 1.2, ease: [0.3, 0.7, 0.2, 1] }}>
                <FilmStrip className="w-[160%]">
                  <div className="grid grid-cols-6 gap-1.5 py-1">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="grid aspect-[4/5] place-items-center rounded-[3px] bg-gradient-to-br from-[#4a2a1a] to-[#1d120c] font-mono text-[10px] text-amber/70">{roll.exposuresUsed + i - 1 > 0 && roll.exposuresUsed + i - 1 <= roll.capacity ? roll.exposuresUsed + i - 1 : ''}</div>
                    ))}
                  </div>
                </FilmStrip>
              </motion.div>
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-3xl">{savedLine}</h2>
              <p className="text-cream/70">
                {remainingAfter === 0 || roll.status !== 'active'
                  ? 'That was the last shot — your roll is off to be developed!'
                  : remainingAfter != null && remainingAfter <= 8
                    ? `Only ${remainingAfter} ${remainingAfter === 1 ? 'exposure' : 'exposures'} left.`
                    : `${remainingAfter ?? remaining} exposures left on ${roll.name}.`}
              </p>
            </div>
            <div className="flex w-full max-w-xs flex-col gap-2">
              {remainingAfter !== 0 && roll.status === 'active' && <Button size="lg" onClick={() => setStage('camera')}>Take another</Button>}
              <Button size="lg" variant="ghost" className="!text-cream" onClick={leave}>Back to {group.name}</Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>{screenFlash && <motion.div className="fixed inset-0 z-50 bg-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.08 }} />}</AnimatePresence>
      <input ref={nativeInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void fromPhoneCamera(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}
