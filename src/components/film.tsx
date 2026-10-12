import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { PRESETS } from '@shared/presets';
import type { PhotoDoc, PresetId, RollDoc } from '@shared/types';
import { usePhoto, type PhotoVariant } from '@/lib/photos';
import { cx } from './ui';

/** Illustrated disposable camera, tinted by the roll's film. */
export function DisposableCamera({ preset, remaining, label, width = 260, className }: { preset: PresetId; remaining?: number; label?: string; width?: number; className?: string }) {
  const c = PRESETS[preset].canister;
  const h = width * 0.62;
  return (
    <svg viewBox="0 0 260 162" width={width} height={h} className={className} role="img" aria-label={`Disposable camera loaded with ${PRESETS[preset].name}`}>
      <defs>
        <linearGradient id={`body-${preset}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c.body} />
          <stop offset="1" stopColor={c.body} stopOpacity="0.86" />
        </linearGradient>
        <radialGradient id="lens" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#6c7a86" />
          <stop offset="0.35" stopColor="#24282c" />
          <stop offset="1" stopColor="#0d0f11" />
        </radialGradient>
        <filter id="soft" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#2B2622" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#soft)">
        {/* shutter button */}
        <rect x="196" y="6" width="34" height="14" rx="6" fill="#1d1b1a" />
        {/* body */}
        <rect x="6" y="16" width="248" height="138" rx="22" fill="#2E2B29" />
        <rect x="6" y="58" width="248" height="70" fill={`url(#body-${preset})`} />
        <rect x="6" y="122" width="248" height="10" fill={c.band} opacity="0.9" />
        {/* flash */}
        <rect x="20" y="28" width="62" height="24" rx="5" fill="#F5F0E6" opacity="0.9" />
        <g stroke="#cfc6b8" strokeWidth="1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <line key={i} x1={26 + i * 8} y1="30" x2={26 + i * 8} y2="50" />)}
        </g>
        {/* viewfinder */}
        <rect x="186" y="30" width="44" height="22" rx="5" fill="#0f1113" />
        <rect x="190" y="33" width="20" height="8" rx="2" fill="#5d6b78" opacity="0.6" />
        {/* lens */}
        <circle cx="130" cy="86" r="40" fill="#1d1b1a" />
        <circle cx="130" cy="86" r="31" fill="url(#lens)" />
        <circle cx="120" cy="76" r="7" fill="#fff" opacity="0.22" />
        <circle cx="140" cy="96" r="3" fill="#fff" opacity="0.12" />
        {/* label */}
        <text x="24" y="80" fill={c.text} fontFamily="Fraunces, serif" fontWeight="700" fontSize="15">FilmRoll</text>
        <text x="24" y="98" fill={c.text} fontFamily="DM Mono, monospace" fontSize="10" opacity="0.85">{PRESETS[preset].code}</text>
        {label && <text x="178" y="80" fill={c.text} fontFamily="DM Sans, sans-serif" fontWeight="600" fontSize="9" opacity="0.9">{label.length > 13 ? `${label.slice(0, 12).trim()}…` : label}</text>}
        {/* counter window */}
        <rect x="200" y="94" width="38" height="22" rx="6" fill="#141210" />
        <text x="219" y="110" textAnchor="middle" fill="#F2C14E" fontFamily="DM Mono, monospace" fontWeight="500" fontSize="14">
          {remaining == null ? '--' : String(remaining).padStart(2, '0')}
        </text>
        {/* wind wheel */}
        <g>
          {Array.from({ length: 9 }, (_, i) => <rect key={i} x={236 + (i % 2) * 2} y={22 + i * 4} width="14" height="2" rx="1" fill="#1d1b1a" />)}
        </g>
      </g>
    </svg>
  );
}

/** 35mm film canister for the archive. */
export function FilmCanister({ preset, title, sub, className }: { preset: PresetId; title: string; sub?: string; className?: string }) {
  const c = PRESETS[preset].canister;
  return (
    <svg viewBox="0 0 120 150" className={className} role="img" aria-label={`${title} film canister`}>
      <defs>
        <linearGradient id={`can-${preset}`} x1="0" x2="1">
          <stop offset="0" stopColor={c.body} stopOpacity="0.75" />
          <stop offset="0.35" stopColor={c.body} />
          <stop offset="0.7" stopColor={c.body} />
          <stop offset="1" stopColor={c.body} stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="cap" x1="0" x2="1">
          <stop offset="0" stopColor="#5b5650" />
          <stop offset="0.4" stopColor="#c8c2b8" />
          <stop offset="1" stopColor="#5b5650" />
        </linearGradient>
      </defs>
      <rect x="44" y="2" width="22" height="10" rx="2" fill="url(#cap)" />
      <rect x="18" y="10" width="74" height="12" rx="4" fill="url(#cap)" />
      <rect x="20" y="20" width="70" height="112" fill={`url(#can-${preset})`} />
      <rect x="20" y="96" width="70" height="14" fill={c.band} opacity="0.9" />
      <rect x="18" y="130" width="74" height="12" rx="4" fill="url(#cap)" />
      {/* film leader */}
      <path d="M90 40 h22 v42 h-22 z" fill="#3a2a1d" />
      {[44, 52, 60, 68, 76].map((y) => <rect key={y} x="105" y={y} width="4" height="4" rx="1" fill="#F4EBDD" opacity="0.8" />)}
      <text x="55" y="50" textAnchor="middle" fill={c.text} fontFamily="Fraunces, serif" fontWeight="700" fontSize="12">FilmRoll</text>
      <text x="55" y="66" textAnchor="middle" fill={c.text} fontFamily="DM Mono, monospace" fontSize="8.5" opacity="0.9">{PRESETS[preset].code}</text>
      <foreignObject x="22" y="70" width="66" height="26">
        <div style={{ color: c.text, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 8, lineHeight: '10px', textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{title}</div>
      </foreignObject>
      {sub && <text x="55" y="106" textAnchor="middle" fill={c.body} fontFamily="DM Mono, monospace" fontSize="7.5">{sub}</text>}
    </svg>
  );
}

/** Circular exposure meter: "18 / 24". */
export function ExposureMeter({ used, capacity, size = 120, dark }: { used: number; capacity: number; size?: number; dark?: boolean }) {
  const reduce = useReducedMotion();
  const r = 44;
  const C = 2 * Math.PI * r;
  const pct = Math.min(1, used / capacity);
  return (
    <div className="relative" style={{ width: size, height: size }} role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used} aria-label={`${used} of ${capacity} exposures used`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke={dark ? 'rgb(244 235 221 / 0.15)' : 'rgb(43 38 34 / 0.08)'} strokeWidth="7" />
        {/* tick marks for every exposure */}
        {Array.from({ length: capacity }, (_, i) => {
          const a = (i / capacity) * Math.PI * 2;
          return <line key={i} x1={50 + Math.cos(a) * 36} y1={50 + Math.sin(a) * 36} x2={50 + Math.cos(a) * 33.5} y2={50 + Math.sin(a) * 33.5} stroke={i < used ? '#D9714E' : dark ? 'rgb(244 235 221 / 0.25)' : 'rgb(43 38 34 / 0.15)'} strokeWidth="1.4" strokeLinecap="round" />;
        })}
        <motion.circle
          cx="50" cy="50" r={r} fill="none" stroke="#D9714E" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={reduce ? { duration: 0 } : { type: 'spring', damping: 20, stiffness: 80 }}
        />
      </svg>
      <div className={cx('absolute inset-0 grid place-items-center text-center', dark ? 'text-cream' : 'text-ink')}>
        <div>
          <div className="font-mono text-[26px] font-medium leading-none" style={{ fontSize: size * 0.22 }}>{used}</div>
          <div className="font-mono text-xs opacity-60">/ {capacity}</div>
        </div>
      </div>
    </div>
  );
}

/** A strip of 35mm film with sprocket holes around children. */
export function FilmStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-md bg-[#1c1916] px-1.5', className)}>
      <div className="sprockets-rect h-3" />
      {children}
      <div className="sprockets-rect h-3" />
    </div>
  );
}

/** Lazy thumbnail loaded through the authorized photo endpoint. */
export function PhotoImage({ photo, variant = 'thumb', className, style, fit = 'cover', alt, eager, onLoad }: { photo: Pick<PhotoDoc, 'groupId' | 'rollId' | 'id' | 'caption' | 'frame'>; variant?: PhotoVariant; className?: string; style?: React.CSSProperties; fit?: 'cover' | 'contain'; alt?: string; eager?: boolean; onLoad?: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!!eager);
  useEffect(() => {
    if (visible || !holder.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' });
    io.observe(holder.current);
    return () => io.disconnect();
  }, [visible]);
  const { url, error } = usePhoto(photo.groupId, photo.rollId, photo.id, variant, visible);
  const [loaded, setLoaded] = useState(false);
  return (
    <div ref={holder} className={cx('relative overflow-hidden bg-[#2a2622]', className)} style={style}>
      {url && (
        <img
          src={url}
          alt={alt ?? (photo.caption ? `Frame ${photo.frame}: ${photo.caption}` : `Frame ${photo.frame}`)}
          className={cx('size-full transition-opacity duration-500', fit === 'cover' ? 'object-cover' : 'object-contain', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={() => {
            setLoaded(true);
            onLoad?.();
          }}
          draggable={false}
        />
      )}
      {!loaded && !error && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#3a332c] to-[#26221e]" />}
      {error && <div className="absolute inset-0 grid place-items-center p-2 text-center text-[10px] text-cream/60">{error}</div>}
    </div>
  );
}

/** Contact sheet: rows of film frames with edge markings. */
export function ContactSheet({ photos, roll, names, onOpen, reveal }: { photos: PhotoDoc[]; roll: RollDoc; names: Record<string, string>; onOpen: (i: number) => void; reveal?: boolean }) {
  const reduce = useReducedMotion();
  const code = PRESETS[roll.preset].code;
  return (
    <div className="space-y-3">
      {chunk(photos, 3).map((row, ri) => (
        <FilmStrip key={ri}>
          <div className="grid grid-cols-3 gap-1.5 py-1">
            {row.map((p, i) => {
              const idx = ri * 3 + i;
              return (
                <motion.button
                  key={p.id}
                  type="button"
                  onClick={() => onOpen(idx)}
                  className="group relative text-left"
                  initial={reveal && !reduce ? { opacity: 0, filter: 'brightness(3) sepia(1)' } : false}
                  animate={{ opacity: 1, filter: 'brightness(1) sepia(0)' }}
                  transition={{ delay: reveal ? 0.15 + idx * 0.08 : 0, duration: 0.9 }}
                  aria-label={`Open frame ${p.frame}${p.caption ? `: ${p.caption}` : ''} by ${names[p.uid] ?? 'a friend'}`}
                >
                  <PhotoImage photo={p} fit="contain" className="aspect-square rounded-[3px] !bg-[#141210]" />
                  <span className="mt-0.5 flex justify-between font-mono text-[9px] text-amber/80">
                    <span>{p.frame}{idx % 2 ? 'A' : ''} ▸</span>
                    <span className="truncate pl-1 text-cream/50">{(names[p.uid] ?? '').split(' ')[0]}</span>
                  </span>
                </motion.button>
              );
            })}
          </div>
          <div className="flex justify-between px-1 font-mono text-[8px] tracking-widest text-amber/50">
            <span>{code}</span>
            <span>FILMROLL</span>
            <span>{code}</span>
          </div>
        </FilmStrip>
      ))}
    </div>
  );
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Width / height of a photo (thumb dimensions match the stored shape). */
export function aspectOf(p: Pick<PhotoDoc, 'thumb'>): number {
  return p.thumb?.width && p.thumb?.height ? p.thumb.width / p.thumb.height : 3 / 4;
}
export const isLandscape = (p: Pick<PhotoDoc, 'thumb'>) => aspectOf(p) > 1;

/** Album cover: printed collage + title block. */
export function AlbumCover({ roll, groupName, photos, className }: { roll: RollDoc; groupName: string; photos: PhotoDoc[]; className?: string }) {
  const cover = roll.coverPhotoIds.map((id) => photos.find((p) => p.id === id)).filter((p): p is PhotoDoc => !!p).slice(0, 4);
  const c = PRESETS[roll.preset].canister;
  const tilts = [-4, 3, -2, 5];
  return (
    <div className={cx('relative overflow-hidden rounded-[22px] p-5 shadow-print', className)} style={{ background: c.body }}>
      <div className="relative mx-auto mb-5 h-72 max-w-xs">
        {cover.length ? (
          cover.map((p, i) => (
            <div
              key={p.id}
              className={cx('absolute bg-cream p-1.5 pb-4 shadow-print', isLandscape(p) ? 'w-[46%]' : 'w-[31%]')}
              style={{ left: `${[2, 50, 10, 46][i] + (isLandscape(p) ? 0 : 6)}%`, top: `${[0, 4, 40, 44][i]}%`, transform: `rotate(${tilts[i]}deg)`, zIndex: i }}
            >
              <PhotoImage photo={p} style={{ aspectRatio: aspectOf(p) }} eager />
            </div>
          ))
        ) : (
          <div className="grid h-full place-items-center">
            <FilmCanister preset={roll.preset} title={roll.name} className="h-40" />
          </div>
        )}
      </div>
      <div style={{ color: c.text }}>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] opacity-80">{groupName}</p>
        <h2 className="font-display text-3xl font-semibold leading-tight">{roll.name}</h2>
        <p className="mt-1 text-sm opacity-90">
          {roll.exposuresUsed} {roll.exposuresUsed === 1 ? 'memory' : 'memories'} · developed {roll.developedAt ? new Date(roll.developedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
        </p>
      </div>
    </div>
  );
}
