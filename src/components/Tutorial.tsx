import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { Button, cx } from './ui';
import { DisposableCamera, ExposureMeter, FilmCanister, FilmStrip } from './film';

interface Step {
  title: string;
  body: ReactNode;
  art: ReactNode;
}

function UndevelopedFrame({ n }: { n: number }) {
  return (
    <div className="relative grid aspect-[3/4] w-28 place-items-center rounded-md bg-gradient-to-br from-[#4a2a1a] to-[#1a100b] shadow-print">
      <div className="sprockets-rect absolute inset-x-1.5 top-1 h-2 opacity-60" />
      <div className="sprockets-rect absolute inset-x-1.5 bottom-1 h-2 opacity-60" />
      <div className="text-center">
        <div className="font-mono text-2xl text-amber/80">{String(n).padStart(2, '0')}</div>
        <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-amber/60">undeveloped</div>
      </div>
    </div>
  );
}

function WheelArt() {
  return (
    <div className="flex items-center gap-6">
      <span className="grid size-[76px] place-items-center rounded-full bg-cream/15 ring-4 ring-cream/80">
        <span className="size-[58px] rounded-full bg-coral" />
      </span>
      <div className="relative">
        <div className="h-14 w-24 rounded-xl ring-1 ring-black/60" style={{ backgroundColor: '#1d1b1a', backgroundImage: 'repeating-linear-gradient(90deg, #3b3734 0 3px, #121110 3px 7px)' }} />
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-widest text-amber">wind ⟲</span>
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    title: 'Welcome to FilmRoll',
    body: 'A shared disposable camera for friends who live apart. Everyone adds little moments from their own life — and you see them all together, later.',
    art: <DisposableCamera preset="warmVintage" remaining={24} width={240} />,
  },
  {
    title: 'Start a group',
    body: 'Groups are private and invite-only. Create one, then share the invite link or code with your friends. You can be in several groups.',
    art: (
      <div className="w-64 rounded-[24px] bg-[#5E5873] p-5 text-left text-[#F7EFE6] shadow-soft">
        <p className="font-display text-2xl font-semibold">The Crew</p>
        <p className="text-sm opacity-75">5 friends · 3 developed</p>
        <p className="mt-3 rounded-xl bg-black/15 px-3 py-2 font-mono text-sm tracking-widest">ABCD-EFGH</p>
      </div>
    ),
  },
  {
    title: 'Load a roll',
    body: 'A roll has 12, 24 or 36 exposures shared by the whole group. It develops when it’s full, on a date you pick, or whichever comes first.',
    art: (
      <div className="flex items-center gap-5">
        <ExposureMeter used={17} capacity={24} size={110} />
        <div className="text-left">
          <p className="font-mono text-sm">17 / 24</p>
          <p className="text-sm text-ink-soft">memories captured</p>
          <p className="text-sm text-ink-soft">Developing Oct 31</p>
        </div>
      </div>
    ),
  },
  {
    title: 'Wind, then shoot',
    body: (
      <>
        FilmRoll opens straight to the camera — the big button in the middle is the shutter. Like a real disposable, wind the film wheel before each shot (you can turn this off in Profile). The shutter is final — there’s <b>no preview</b>. You get 3 seconds to undo, and can add a short note.
      </>
    ),
    art: (
      <div className="rounded-[28px] bg-body px-8 py-7">
        <WheelArt />
      </div>
    ),
  },
  {
    title: 'No peeking',
    body: 'Every shot stays undeveloped — hidden from everyone, even you — until the roll develops. You’ll only see how full the roll is and who’s been shooting.',
    art: (
      <div className="flex gap-3">
        {[7, 8, 9].map((n, i) => (
          <div key={n} style={{ transform: `rotate(${(i - 1) * 5}deg)` }}>
            <UndevelopedFrame n={n} />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Develop together',
    body: 'When the roll is ready, everyone gets the reveal at once: a contact sheet of the whole group’s lives, side by side.',
    art: (
      <div className="flex items-end gap-4">
        <FilmCanister preset="classic35" title="October" className="h-32" />
        <FilmStrip className="w-44 -rotate-3">
          <div className="grid grid-cols-3 gap-1 py-1">
            {['#E9826A', '#E2A548', '#8FB3D9'].map((c) => <div key={c} className="aspect-square rounded-[2px]" style={{ background: c }} />)}
          </div>
        </FilmStrip>
      </div>
    ),
  },
  {
    title: 'Keep the memories',
    body: 'React, comment, save private favorites and download the originals. Developed rolls live under Groups → Past rolls forever, and old ones resurface on their anniversaries.',
    art: (
      <div className="flex gap-2 text-3xl">
        {['❤️', '😂', '🥹', '📸'].map((e) => <span key={e} className="grid size-14 place-items-center rounded-full bg-cream shadow-soft">{e}</span>)}
      </div>
    ),
  },
];

/** Full-screen walkthrough of how FilmRoll works. Shown once after the first login; replayable from Profile. */
export default function Tutorial({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const last = i === STEPS.length - 1;
  const go = (d: number) => {
    setDir(d);
    setI((x) => Math.min(STEPS.length - 1, Math.max(0, x + d)));
  };
  const step = STEPS[i];

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-paper pb-safe pt-safe" role="dialog" aria-modal="true" aria-label="How FilmRoll works">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-2">
        <button onClick={() => go(-1)} disabled={i === 0} className="grid size-11 place-items-center rounded-full disabled:opacity-0" aria-label="Previous">
          <ChevronLeft className="size-6" />
        </button>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, k) => <span key={k} className={cx('h-1.5 rounded-full transition-all', k === i ? 'w-6 bg-coral' : 'w-1.5 bg-ink/15')} />)}
        </div>
        <button onClick={onDone} className="h-11 px-3 text-sm font-semibold text-ink-soft">Skip</button>
      </div>

      <div className="relative mx-auto flex w-full max-w-lg flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={i}
            className="absolute inset-0 flex flex-col items-center justify-center gap-10 px-8 text-center"
            initial={reduce ? { opacity: 0 } : { x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: -dir * 60, opacity: 0 }}
            transition={{ duration: 0.25 }}
            drag={reduce ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60 && !last) go(1);
              if (info.offset.x > 60) go(-1);
            }}
          >
            <div className="grid min-h-48 place-items-center">{step.art}</div>
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-faint">{i + 1} of {STEPS.length}</p>
              <h2 className="font-display text-3xl font-semibold">{step.title}</h2>
              <p className="mx-auto max-w-sm text-[17px] leading-relaxed text-ink-soft">{step.body}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mx-auto w-full max-w-lg px-6 pb-4 pt-2">
        <Button size="lg" className="w-full" onClick={() => (last ? onDone() : go(1))}>{last ? 'Start shooting' : 'Next'}</Button>
      </div>
    </div>
  );
}
