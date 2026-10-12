import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarDays, Camera as CameraIcon, Check, MapPin, RotateCcw, SwitchCamera, Volume2, VolumeX, X, Zap, ZapOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useActiveRolls, useMyGroups, useOnline } from '@/hooks/useData';
import { Button, FullScreenLoader, IconButton, TextArea, TextInput, cx, useStatusBarColor, useToast } from '@/components/ui';
import { DisposableCamera, FilmStrip } from '@/components/film';
import { errorMessage } from '@/lib/api';
import { decode } from '@/lib/image';
import { Shot, type ShotSnapshot } from '@/lib/shot';
import { WindWheel } from '@/components/WindWheel';
import { cropToAspect, rotatedSize, rotationFor, useDeviceTilt, useViewportLandscape } from '@/lib/orientation';
import { playShutter, vibrate } from '@/lib/sound';
import { randomRequestId } from '@/lib/format';
import { FALLBACK_FILE_MAX_AGE_MS, LIMITS } from '@shared/constants';
import { PRESETS, dateStampText, seedFrom } from '@shared/presets';
import { shotsRemaining } from '@shared/rolls';
import type { GroupDoc, RollDoc } from '@shared/types';

type Facing = 'environment' | 'user';
type Stage = 'camera' | 'note' | 'last';

/** Seconds to change your mind after the shutter. */
const UNDO_SECONDS = 3;

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
  useStatusBarColor('#2E2B29');
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

  // Film advance: the shutter only fires once the film is wound (after every shot).
  const [wound, setWound] = useState(false);
  const [nudge, setNudge] = useState(0);

  // The shot in flight (shutter → undo window → saved) and its optional note.
  const shot = useRef<Shot | null>(null);
  const [snap, setSnap] = useState<ShotSnapshot | null>(null);
  const [frameShape, setFrameShape] = useState<'portrait' | 'landscape'>('portrait');
  const [frameNo, setFrameNo] = useState(0);
  const [undoLeft, setUndoLeft] = useState(0);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  // Shots that are saving in the background after Done (the user doesn't wait for them).
  const [pendingSaves, setPendingSaves] = useState(0);

  // Closing/reloading the page mid-save would lose that shot: ask the browser to warn.
  useEffect(() => {
    if (!pendingSaves) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [pendingSaves]);

  // Count shots still saving as used, so the counter is right immediately.
  const remaining = Math.max(0, shotsRemaining(roll) - pendingSaves);

  // Orientation: if the browser rotates the UI we switch to a side-by-side layout;
  // if the UI stays portrait (installed app, rotation lock) the tilt sensor tells us
  // the phone is sideways, the controls turn to face the user and the shot is
  // rotated upright into a landscape photo.
  const viewportLandscape = useViewportLandscape();
  const { tilt, enable: enableTilt } = useDeviceTilt(stage === 'camera' && !viewportLandscape);
  const sideways = viewportLandscape ? 'portrait' : tilt;
  const iconTurn = sideways === 'left' ? 90 : sideways === 'right' ? -90 : 0;
  const turn = { transform: `rotate(${iconTurn}deg)`, transition: reduce ? undefined : 'transform 250ms ease' };

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

  /** Save whatever is in flight (used when leaving or backgrounding the app). */
  const flush = useCallback(() => {
    const s = shot.current;
    if (!s || s.snapshot.state === 'cancelled' || s.snapshot.state === 'saved') return;
    s.commit().then(() => s.saveNote()).catch(() => undefined);
  }, []);

  // Pause the camera when the app is backgrounded; never lose a shot in flight.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        stopStream();
        flush();
      } else if (stage === 'camera') void startStream(facing);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [stage, facing, startStream, stopStream, flush]);
  useEffect(() => flush, [flush]);

  // Keep the shot's note in sync while typing.
  useEffect(() => {
    shot.current?.setNote(caption.trim(), location.trim());
  }, [caption, location]);

  // Undo window: when it runs out, the shot is committed to the roll.
  useEffect(() => {
    if (stage !== 'note' || undoLeft <= 0) return;
    const t = setTimeout(() => {
      const left = Math.max(0, undoLeft - 0.1);
      setUndoLeft(left);
      if (left === 0) void shot.current?.commit();
    }, 100);
    return () => clearTimeout(t);
  }, [stage, undoLeft]);

  /** The shutter is final: everything after this runs in the background. */
  function begin(b: ImageBitmap, at: number) {
    setWound(false);
    setFrameShape(b.width > b.height ? 'landscape' : 'portrait');
    setFrameNo(roll.exposuresUsed + pendingSaves + 1);
    setCaption('');
    setLocation('');
    const s = new Shot({ groupId: roll.groupId, rollId: roll.id, preset: roll.preset, dateStamp: roll.dateStamp, seed: seedFrom(randomRequestId()), capturedAt: at, source: b, onChange: setSnap });
    shot.current = s;
    setSnap(s.snapshot);
    void s.start();
    setUndoLeft(UNDO_SECONDS);
    setStage('note');
  }

  function shutterPressed() {
    if (stage !== 'camera') return;
    if (remaining <= 0 || roll.status !== 'active') return toast('No exposures left on this roll.');
    if (!online) return toast('You’re offline — connect to save a shot.', 'error');
    if (!wound) {
      setNudge((n) => n + 1);
      vibrate([8, 40, 8]);
      return toast('Wind the film first ⟲');
    }
    if (camState === 'live') void shoot();
    else nativeInput.current?.click();
  }

  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const track = stream.current?.getVideoTracks()[0];
    if (sound) playShutter();
    vibrate(15);
    if (flash && facing === 'user') {
      setScreenFlash(true);
      await new Promise((r) => setTimeout(r, 180));
    }
    if (flash && torchSupported && track) await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => undefined);
    // Capture exactly what the viewfinder shows (3:4, or 4:3 in a landscape UI),
    // then turn sideways shots upright.
    const crop = cropToAspect(v.videoWidth, v.videoHeight, viewportLandscape ? 4 / 3 : 3 / 4);
    const deg = rotationFor(sideways);
    const size = rotatedSize(crop.sw, crop.sh, deg);
    const c = document.createElement('canvas');
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    if (facing === 'user') ctx.scale(-1, 1); // match the mirrored selfie preview
    ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, -crop.sw / 2, -crop.sh / 2, crop.sw, crop.sh);
    if (flash && torchSupported && track) await track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    setScreenFlash(false);
    setBlink(true);
    setTimeout(() => setBlink(false), reduce ? 0 : 220);
    begin(await createImageBitmap(c), Date.now());
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
      begin(await decode(f), Date.now());
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function undo() {
    const s = shot.current;
    if (!s || !(await s.cancel())) return;
    shot.current = null;
    setSnap(null);
    setWound(true); // the frame wasn't used, so the film is still wound
    setStage('camera');
    toast('Shot discarded — the exposure is back.');
  }

  /** Finish saving a shot in the background, retrying a couple of times before telling the user. */
  function saveInBackground(s: Shot) {
    setPendingSaves((n) => n + 1);
    let counted = true;
    const uncount = () => {
      if (counted) setPendingSaves((n) => n - 1);
      counted = false;
    };
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          s.retry();
        }
        await s.commit();
        const snap = s.snapshot;
        if (snap.state === 'saved') {
          uncount(); // the roll itself now counts this shot
          await s.saveNote().catch((e) => toast(`Your shot is saved, but its note wasn’t: ${errorMessage(e)}`, 'error'));
          return;
        }
        if (snap.state !== 'failed' || snap.lost) break;
      }
      const snap = s.snapshot;
      if (snap.state === 'failed') toast(snap.lost ? 'Someone took the last exposure first, so your latest shot didn’t make it onto the roll.' : `A shot couldn’t be saved: ${snap.error ?? 'check your connection.'}`, 'error');
    })().finally(uncount);
  }

  /** Done never waits: the shot keeps saving in the background while you carry on. */
  function done() {
    const s = shot.current;
    if (!s) return;
    s.setNote(caption.trim(), location.trim());
    setUndoLeft(0);
    shot.current = null;
    setSnap(null);
    saveInBackground(s);
    const left = remaining - 1;
    if (left <= 0) setStage('last');
    else {
      setStage('camera');
      toast(left <= 8 ? `${SAVED[frameNo % SAVED.length]} Only ${left} left.` : SAVED[frameNo % SAVED.length]);
    }
  }

  const leave = () => {
    stopStream();
    flush();
    nav(`/g/${roll.groupId}`);
  };

  const status = snap?.state;
  const committed = status === 'committing' || status === 'saved';
  const shutterReady = wound && stage === 'camera' && remaining > 0;

  return (
    <main className="fixed inset-0 flex flex-col bg-body text-cream" aria-label="Camera">
      {/* top bar */}
      <div className="flex items-center gap-2 px-3 pt-safe">
        <IconButton label="Close camera" onClick={leave} className="text-cream active:bg-white/10"><X className="size-6" /></IconButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="truncate text-xs text-cream/60">{roll.name} · <span className="font-mono">{PRESETS[roll.preset].code}</span></p>
        </div>
        <div className="relative grid h-9 min-w-14 place-items-center rounded-lg bg-black px-2 font-mono text-lg text-amber shadow-inner" style={turn} aria-label={`${remaining} exposures left${pendingSaves ? `, saving ${pendingSaves}` : ''}`}>
          {String(remaining).padStart(2, '0')}
          {pendingSaves > 0 && <span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-coral ring-2 ring-body" title="Saving in the background" />}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {stage === 'camera' && (
          <motion.section key="cam" className={cx('flex min-h-0 flex-1', viewportLandscape ? 'flex-row' : 'flex-col')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className={cx('flex min-h-0 flex-1 items-center justify-center', viewportLandscape ? 'py-2 pl-4' : 'px-5 py-4')}>
              <div className={cx('relative max-h-full overflow-hidden rounded-[22px] bg-black shadow-[inset_0_0_0_6px_#1a1816]', viewportLandscape ? 'aspect-[4/3] h-full' : 'aspect-[3/4] w-full max-w-md')}>
                <video
                  ref={(el) => {
                    // The section re-mounts after the note screen; re-attach the live stream.
                    video.current = el;
                    if (el && stream.current && el.srcObject !== stream.current) {
                      el.srcObject = stream.current;
                      void el.play().catch(() => undefined);
                    }
                  }}
                  playsInline
                  muted
                  autoPlay
                  className={cx('size-full object-cover transition-[filter] duration-500', facing === 'user' && '-scale-x-100', camState !== 'live' && 'opacity-0')}
                  style={{ filter: `${viewfinderFilter(roll)}${wound ? '' : ' brightness(0.55) blur(1px)'}` }}
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
                          {camState === 'denied' && 'Camera access is off. Allow it in your browser settings, or wind the film and press the shutter to use your phone’s camera.'}
                          {camState === 'unsupported' && 'This browser can’t open the camera here. Wind the film and press the shutter to use your phone’s camera.'}
                          {camState === 'error' && 'The camera couldn’t start. Try again, or press the shutter to use your phone’s camera.'}
                        </p>
                        {camState !== 'unsupported' && <Button size="sm" variant="secondary" onClick={() => startStream(facing)}>Try again</Button>}
                      </>
                    )}
                  </div>
                )}
                {/* frame guides */}
                <div className="pointer-events-none absolute inset-3 rounded-[14px] border border-white/15" />
                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
                {roll.dateStamp && sideways === 'portrait' && <span className="pointer-events-none absolute bottom-4 right-5 font-mono text-sm text-stamp/80">{dateStampText(Date.now())}</span>}
                {!wound && camState === 'live' && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
                    <span className="rounded-full bg-black/60 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-amber" style={turn}>Wind the film to shoot</span>
                  </div>
                )}
                <AnimatePresence>{blink && <motion.div className="absolute inset-0 bg-black" initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />}</AnimatePresence>
              </div>
            </div>

            <div className={cx('flex', viewportLandscape ? 'w-48 flex-col-reverse justify-center pr-safe' : 'flex-col')}>
              <div className={cx('flex items-center justify-center text-cream/80', viewportLandscape ? 'gap-1 pt-3' : 'gap-6 pb-3')}>
                <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold active:bg-white/10" onClick={() => { setFlash(!flash); writePref('flash', !flash); }} aria-pressed={flash}>
                  {flash ? <Zap className="size-4 text-amber" style={turn} /> : <ZapOff className="size-4" style={turn} />} <span className={cx(viewportLandscape && 'sr-only')}>Flash {flash ? 'on' : 'off'}</span>
                </button>
                <span className="flex items-center gap-1.5 text-xs"><CalendarDays className="size-4" style={turn} /> <span className={cx(viewportLandscape && 'sr-only')}>{roll.dateStamp ? 'Date stamp' : 'No stamp'}</span></span>
                <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold active:bg-white/10" onClick={() => { setSound(!sound); writePref('sound', !sound); }} aria-pressed={sound}>
                  {sound ? <Volume2 className="size-4" style={turn} /> : <VolumeX className="size-4" style={turn} />} <span className={cx(viewportLandscape && 'sr-only')}>Sound</span>
                </button>
              </div>

              <div className={cx('flex items-center', viewportLandscape ? 'flex-col justify-center gap-4' : 'justify-around px-6 pb-safe pt-4')}>
                <IconButton label="Switch camera" disabled={!canFlip || camState !== 'live'} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} className="size-14 bg-white/10 text-cream active:bg-white/20 disabled:opacity-30"><SwitchCamera className="size-6" style={turn} /></IconButton>
                <button
                  onClick={shutterPressed}
                  aria-label={wound ? 'Take photo' : 'Take photo (wind the film first)'}
                  className={cx('grid size-[84px] place-items-center rounded-full bg-cream/15 ring-4 transition active:scale-90', shutterReady ? 'ring-cream/80' : 'ring-cream/25')}
                >
                  <span className={cx('size-[64px] rounded-full shadow-[inset_0_-4px_0_rgba(0,0,0,0.2)] transition-colors', shutterReady ? 'bg-coral' : 'bg-coral/35')} />
                </button>
                {/* iOS asks for motion access on a tap; asking on the first wind keeps it from swallowing other buttons (like ✕) */}
                <WindWheel wound={wound} onWound={() => setWound(true)} onEngage={enableTilt} sound={sound} nudge={nudge} vertical={viewportLandscape} />
              </div>
            </div>
          </motion.section>
        )}

        {stage === 'note' && (
          <motion.section key="note" className="flex min-h-0 flex-1 flex-col overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* the undeveloped frame: no preview, just like film */}
            <div className="flex justify-center px-6 pt-6">
              <motion.div
                className={cx('relative flex flex-col items-center justify-center gap-2 rounded-md bg-gradient-to-br from-[#4a2a1a] to-[#1a100b] text-center shadow-print', frameShape === 'landscape' ? 'aspect-[4/3] w-full max-w-sm' : 'aspect-[3/4] w-3/5 max-w-[240px]')}
                initial={reduce ? false : { x: 60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18 }}
              >
                <div className="absolute inset-x-2 top-1.5 h-2.5 sprockets-rect opacity-60" />
                <div className="absolute inset-x-2 bottom-1.5 h-2.5 sprockets-rect opacity-60" />
                <span className="font-mono text-3xl text-amber/80">{String(frameNo).padStart(2, '0')}</span>
                <span className="px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-amber/60">undeveloped</span>
              </motion.div>
            </div>
            <div className="mx-auto w-full max-w-md space-y-3 px-5 pb-safe pt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-cream/70" role="status">
                  {status === 'failed' ? <span className="text-[#F2A08F]">{snap?.error}</span>
                    : status === 'saved' ? <span className="inline-flex items-center gap-1 text-cream"><Check className="size-4 text-amber" /> On the roll</span>
                    : status === 'committing' ? 'Saving to the roll…'
                    : `Tucking it away… ${Math.round((snap?.progress ?? 0) * 100)}%`}
                </p>
                {!committed && status !== 'failed' && undoLeft > 0 && (
                  <button onClick={undo} className="relative flex items-center gap-1.5 overflow-hidden rounded-full bg-white/10 px-4 py-2 text-sm font-semibold active:bg-white/20">
                    <span className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${(undoLeft / UNDO_SECONDS) * 100}%` }} />
                    <RotateCcw className="relative size-4" /> <span className="relative">Undo {Math.ceil(undoLeft)}</span>
                  </button>
                )}
              </div>
              <TextArea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, LIMITS.caption))} rows={2} placeholder="Add a note to this shot (optional)" aria-label="Caption" className="!border-white/10 !bg-white/10 !text-cream placeholder:!text-cream/40" />
              <div className="flex items-center gap-2">
                <MapPin className="size-5 shrink-0 text-cream/50" />
                <TextInput value={location} onChange={(e) => setLocation(e.target.value.slice(0, LIMITS.location))} placeholder="Location (optional)" aria-label="Location" className="!border-white/10 !bg-white/10 !py-2.5 !text-cream placeholder:!text-cream/40" />
                {profile?.city && !location && <button className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold" onClick={() => setLocation(profile.city)}>{profile.city}</button>}
              </div>
              {status === 'failed' && snap?.lost ? (
                <Button size="lg" className="w-full" onClick={() => { shot.current = null; setStage(remaining > 0 ? 'camera' : 'last'); }}>Back to the camera</Button>
              ) : status === 'failed' ? (
                <Button size="lg" className="w-full" onClick={() => { shot.current?.retry(); void shot.current?.commit(); }}>Try again</Button>
              ) : (
                <Button size="lg" className="w-full" onClick={done}>Done</Button>
              )}
              <p className="pb-4 text-center text-xs text-cream/50">No peeking — this shot stays undeveloped until the whole roll does.</p>
            </div>
          </motion.section>
        )}

        {stage === 'last' && (
          <motion.section key="last" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-safe text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="w-full max-w-sm overflow-hidden">
              <motion.div initial={reduce ? false : { x: '40%' }} animate={{ x: '-20%' }} transition={{ duration: 1.2, ease: [0.3, 0.7, 0.2, 1] }}>
                <FilmStrip className="w-[160%]">
                  <div className="grid grid-cols-6 gap-1.5 py-1">
                    {Array.from({ length: 6 }, (_, i) => {
                      const n = roll.capacity - 4 + i;
                      return <div key={i} className="grid aspect-[4/5] place-items-center rounded-[3px] bg-gradient-to-br from-[#4a2a1a] to-[#1d120c] font-mono text-[10px] text-amber/70">{n > 0 && n <= roll.capacity ? n : ''}</div>;
                    })}
                  </div>
                </FilmStrip>
              </motion.div>
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-3xl">That’s the whole roll!</h2>
              <p className="text-cream/70">That was the last shot — your film is off to be developed.</p>
            </div>
            <Button size="lg" onClick={leave}>Back to {group.name}</Button>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>{screenFlash && <motion.div className="fixed inset-0 z-50 bg-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.08 }} />}</AnimatePresence>
      <input ref={nativeInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void fromPhoneCamera(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}
