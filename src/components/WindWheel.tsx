import { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, useReducedMotion } from 'motion/react';
import { playAdvance, playTick, vibrate } from '@/lib/sound';
import { cx } from './ui';

/** Drag distance (px) for one full wind. */
const WIND_DISTANCE = 200;
const NOTCHES = 10;

/**
 * The film-advance thumbwheel. Like a real disposable, you wind it after every
 * shot before the shutter will fire. Drag it (either direction), scroll over
 * it, tap it notch by notch, or use the arrow keys.
 */
export function WindWheel({ wound, onWound, onEngage, sound, nudge, vertical }: { wound: boolean; onWound: () => void; onEngage?: () => void; sound: boolean; nudge: number; vertical?: boolean }) {
  const reduce = useReducedMotion();
  const [travel, setTravel] = useState(wound ? WIND_DISTANCE : 0);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastNotch = useRef(0);
  const done = useRef(wound);
  const [scope, animate] = useAnimate();

  // Shake when someone presses the shutter without winding.
  useEffect(() => {
    if (nudge && scope.current) animate(scope.current, { x: [0, -7, 7, -5, 5, 0] }, { duration: reduce ? 0 : 0.4 });
  }, [nudge, animate, scope, reduce]);

  // Re-arm when the camera needs winding again.
  useEffect(() => {
    if (!wound) {
      done.current = false;
      lastNotch.current = 0;
      setTravel(0);
    }
  }, [wound]);

  function advance(px: number) {
    if (done.current) return;
    setTravel((t) => {
      const next = Math.min(WIND_DISTANCE, t + Math.abs(px));
      const notch = Math.floor((next / WIND_DISTANCE) * NOTCHES);
      if (notch > lastNotch.current) {
        lastNotch.current = notch;
        vibrate(6);
        if (sound) playTick();
      }
      if (next >= WIND_DISTANCE && !done.current) {
        done.current = true;
        vibrate([12, 30, 18]);
        if (sound) playAdvance();
        queueMicrotask(onWound);
      }
      return next;
    });
  }

  const progress = travel / WIND_DISTANCE;
  // ridges slide as the wheel turns
  const offset = travel * 1.6;

  return (
    <div ref={scope}>
    <motion.div
      role="slider"
      tabIndex={0}
      aria-label="Wind the film"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={wound ? 'Wound — ready to shoot' : `${Math.round(progress * 100)}% wound`}
      className={cx('relative touch-none select-none outline-none', vertical ? 'h-24 w-14' : 'h-14 w-24')}
      animate={!wound && !reduce ? { x: vertical ? 0 : [0, -3, 3, 0], y: vertical ? [0, -3, 3, 0] : 0 } : { x: 0, y: 0 }}
      transition={!wound && !reduce ? { duration: 0.5, repeat: Infinity, repeatDelay: 1.6 } : undefined}
      onPointerDown={(e) => {
        onEngage?.();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = vertical ? e.clientY - d.y : e.clientX - d.x;
        if (Math.abs(delta) > 1) {
          d.moved = true;
          advance(delta);
          d.x = e.clientX;
          d.y = e.clientY;
        }
      }}
      onPointerUp={() => {
        // a plain tap turns it one notch (for anyone who can't drag)
        if (drag.current && !drag.current.moved) advance(WIND_DISTANCE / NOTCHES);
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => advance(Math.abs(e.deltaY) + Math.abs(e.deltaX))}
      onKeyDown={(e) => {
        onEngage?.();
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(e.key)) {
          e.preventDefault();
          advance(WIND_DISTANCE / NOTCHES);
        }
      }}
    >
      {/* knurled wheel */}
      <div
        className={cx('absolute inset-0 overflow-hidden rounded-xl ring-1 ring-black/60', wound ? 'opacity-70' : '')}
        style={{
          backgroundColor: '#1d1b1a',
          backgroundImage: vertical
            ? 'repeating-linear-gradient(180deg, #3b3734 0 3px, #121110 3px 7px)'
            : 'repeating-linear-gradient(90deg, #3b3734 0 3px, #121110 3px 7px)',
          backgroundPosition: vertical ? `0 ${offset}px` : `${offset}px 0`,
          boxShadow: 'inset 0 6px 10px rgba(255,255,255,0.08), inset 0 -8px 12px rgba(0,0,0,0.6)',
        }}
      />
      {/* cylindrical shading */}
      <div className={cx('pointer-events-none absolute inset-0 rounded-xl', vertical ? 'bg-gradient-to-b' : 'bg-gradient-to-r', 'from-black/60 via-transparent to-black/60')} />
      {/* progress lip */}
      <div className={cx('pointer-events-none absolute overflow-hidden rounded-full bg-white/10', vertical ? '-right-2 top-1 bottom-1 w-1' : '-bottom-2 left-1 right-1 h-1')}>
        <div className={cx('bg-amber', vertical ? 'w-full' : 'h-full')} style={vertical ? { height: `${progress * 100}%` } : { width: `${progress * 100}%` }} />
      </div>
      <span className={cx('pointer-events-none absolute whitespace-nowrap font-mono text-[10px] uppercase tracking-widest', vertical ? '-left-1 top-1/2 -translate-x-full -translate-y-1/2 pr-1' : '-top-5 left-1/2 -translate-x-1/2', wound ? 'text-cream/40' : 'text-amber')}>
        {wound ? 'ready' : 'wind ⟲'}
      </span>
    </motion.div>
    </div>
  );
}
