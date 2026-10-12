import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PRESETS } from '@shared/presets';
import type { PhotoDoc, RollDoc } from '@shared/types';
import { Button } from './ui';
import { FilmCanister, FilmStrip, PhotoImage } from './film';

type Phase = 'canister' | 'developing' | 'contact' | 'reveal';
const TIMINGS: Record<Exclude<Phase, 'reveal'>, number> = { canister: 1400, developing: 2200, contact: 2000 };

/**
 * The signature moment: canister → film in the developing tray → contact
 * sheet fading up → album. Skippable; collapses to a simple card with
 * reduced motion.
 */
export default function DevelopReveal({ roll, groupName, photos, onDone }: { roll: RollDoc; groupName: string; photos: PhotoDoc[]; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('canister');
  const frames = photos.slice(0, 9);

  useEffect(() => {
    if (reduce) return;
    if (phase === 'reveal') {
      onDone();
      return;
    }
    const next: Record<Exclude<Phase, 'reveal'>, Phase> = { canister: 'developing', developing: 'contact', contact: 'reveal' };
    const t = setTimeout(() => setPhase(next[phase as Exclude<Phase, 'reveal'>]), TIMINGS[phase as Exclude<Phase, 'reveal'>]);
    return () => clearTimeout(t);
  }, [phase, reduce, onDone]);

  if (reduce) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-body px-6 text-center text-cream" role="dialog" aria-label="Your film is developed">
        <FilmCanister preset={roll.preset} title={roll.name} className="h-40" />
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber">Your film is developed</p>
          <h1 className="font-display text-3xl">{roll.name}</h1>
          <p className="text-cream/70">{photos.length} memories from {groupName}</p>
        </div>
        <Button size="lg" onClick={onDone}>Open the album</Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-body text-cream" role="dialog" aria-label="Developing your film">
      <button onClick={onDone} className="absolute right-4 top-0 z-10 mt-safe rounded-full bg-white/10 px-4 py-2 text-sm font-semibold active:bg-white/20" style={{ marginTop: 'max(var(--safe-top), 12px)' }}>
        Skip
      </button>
      {/* red safelight glow while developing */}
      <motion.div className="absolute inset-0" animate={{ background: phase === 'developing' ? 'radial-gradient(circle at 50% 40%, rgba(170,30,20,0.55), rgba(20,8,6,0.95) 70%)' : 'radial-gradient(circle at 50% 40%, rgba(60,50,40,0.6), rgba(30,27,25,1) 70%)' }} transition={{ duration: 0.8 }} />
      <div className="relative flex h-full flex-col items-center justify-center gap-8 px-6">
        <AnimatePresence mode="wait">
          {phase === 'canister' && (
            <motion.div key="can" className="flex flex-col items-center gap-6 text-center" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -80, rotate: -20 }} transition={{ type: 'spring', damping: 14 }}>
              <motion.div animate={{ rotate: [0, -6, 6, 0] }} transition={{ duration: 1.2 }}>
                <FilmCanister preset={roll.preset} title={roll.name} className="h-48" />
              </motion.div>
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber">{groupName}</p>
            </motion.div>
          )}
          {phase === 'developing' && (
            <motion.div key="dev" className="flex w-full max-w-sm flex-col items-center gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="w-full" initial={{ x: '-110%' }} animate={{ x: '0%' }} transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}>
                <FilmStrip>
                  <div className="grid grid-cols-4 gap-1.5 py-1">
                    {Array.from({ length: 4 }, (_, i) => (
                      <motion.div key={i} className="aspect-[4/5] rounded-[3px] bg-[#c76a2c]" animate={{ backgroundColor: ['#c76a2c', '#5a2a14', '#1d120c'] }} transition={{ duration: 1.8, delay: i * 0.12 }} />
                    ))}
                  </div>
                </FilmStrip>
              </motion.div>
              <p className="font-display text-2xl">Developing…</p>
              <p className="font-mono text-xs text-cream/60">{PRESETS[roll.preset].code} · {roll.exposuresUsed} exposures</p>
            </motion.div>
          )}
          {phase === 'contact' && (
            <motion.div key="contact" className="w-full max-w-sm" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 1.05 }}>
              <div className="rounded-sm bg-[#f2ece2] p-3 shadow-print">
                <div className="grid grid-cols-3 gap-1.5 bg-[#1c1916] p-1.5">
                  {frames.map((p, i) => (
                    <motion.div key={p.id} initial={{ opacity: 0, filter: 'brightness(3) sepia(1) blur(2px)' }} animate={{ opacity: 1, filter: 'brightness(1) sepia(0) blur(0px)' }} transition={{ delay: 0.15 * i, duration: 1 }}>
                      <PhotoImage photo={p} className="aspect-[4/5]" eager />
                    </motion.div>
                  ))}
                  {frames.length === 0 && <div className="col-span-3 py-10 text-center text-sm text-cream/60">An empty roll — nobody took a shot this time.</div>}
                </div>
                <p className="mt-2 text-center font-mono text-[10px] text-ink-soft">{roll.name.toUpperCase()} · CONTACT SHEET</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
