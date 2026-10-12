import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initials } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-coral text-cream shadow-soft active:bg-coral-deep',
  secondary: 'bg-cream text-ink ring-1 ring-line active:bg-paper-2',
  ghost: 'text-ink-soft active:bg-ink/5',
  danger: 'bg-[#B5443A] text-cream active:bg-[#963229]',
  dark: 'bg-ink text-cream active:bg-black',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background-color,opacity] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' && 'h-9 px-4 text-sm',
        size === 'md' && 'h-12 px-5 text-[15px]',
        size === 'lg' && 'h-14 px-6 text-base',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx('grid size-11 place-items-center rounded-full transition active:scale-95 active:bg-ink/5', className)} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-coral', className ?? 'size-6')} aria-label="Loading" />;
}

export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-soft" role="status">
      <FilmSpinner />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

/** A tiny rotating film reel. */
export function FilmSpinner({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className="animate-[spin_2.4s_linear_infinite]" aria-hidden>
      <circle cx="22" cy="22" r="20" fill="#2E2B29" />
      <circle cx="22" cy="22" r="5" fill="#F4EBDD" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return <circle key={i} cx={22 + Math.cos(a) * 12} cy={22 + Math.sin(a) * 12} r="4.2" fill="#F4EBDD" />;
      })}
    </svg>
  );
}

export function Avatar({ name, url, size = 36, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hue = Array.from(name).reduce((h, c) => h + c.charCodeAt(0), 0) % 5;
  const bg = ['#E9826A', '#E2A548', '#A9B79A', '#8C7FA8', '#C79A7A'][hue];
  return (
    // The white edge is a real border inside the avatar's own box (not an outer ring),
    // so neighbouring elements can never paint over it on iOS.
    <span className={cx('box-border grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-cream font-semibold text-cream', className)} style={{ width: size, height: size, background: bg, fontSize: size * 0.36 }} aria-label={name} role="img">
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

export function AvatarStack({ people, size = 30, max = 5 }: { people: { name: string; photoURL: string | null; uid?: string }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={p.uid ?? i} className="shrink-0" style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: shown.length - i }}>
          <Avatar name={p.name} url={p.photoURL} size={size} />
        </div>
      ))}
      {more > 0 && (
        <span className="box-border grid shrink-0 place-items-center rounded-full border-2 border-cream bg-paper-2 text-xs font-semibold text-ink-soft" style={{ width: size, height: size, marginLeft: -size * 0.3 }}>
          +{more}
        </span>
      )}
    </div>
  );
}

/** Bottom sheet with drag-to-dismiss, focus handling and Escape to close. */
export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; tall?: boolean }) {
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Only on open/close: focus the panel, restore focus afterwards, Escape closes.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    addEventListener('keydown', onKey);
    requestAnimationFrame(() => panel.current?.focus());
    return () => {
      removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cx('absolute inset-x-0 bottom-0 mx-auto flex max-w-lg flex-col rounded-t-[28px] bg-cream text-ink shadow-soft outline-none', tall ? 'h-[88dvh]' : 'max-h-[88dvh]')}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            drag={reduce ? false : 'y'}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 120 || i.velocity.y > 600) && onClose()}
          >
            <div className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2.5" onPointerDown={(e) => controls.start(e)}>
              <span className="h-1.5 w-10 rounded-full bg-ink/15" />
              <div className="flex w-full items-center justify-between px-5 pb-1 pt-2">
                {title ? <h2 id={titleId} className="font-display text-xl font-semibold">{title}</h2> : <span />}
                <IconButton label="Close" onClick={onClose} className="-mr-2">
                  <X className="size-5" />
                </IconButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-safe">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {error ? <span className="block text-sm text-[#B5443A]">{error}</span> : hint ? <span className="block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

export const inputClass = 'w-full rounded-2xl border border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-ink-faint outline-none transition focus:border-coral focus:ring-2 focus:ring-coral/20';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputClass, className)} {...rest} />;
});

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputClass, 'resize-none', className)} {...rest} />;
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-3 text-left">
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-ink-soft">{description}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-coral' : 'bg-ink/15')}>
        <span className={cx('absolute top-0.5 size-6 rounded-full bg-cream shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-paper-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-10 flex-1 rounded-full text-sm font-semibold transition', value === o.value ? 'bg-cream text-ink shadow-soft' : 'text-ink-soft')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ art, title, children, action }: { art?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {art}
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {children && <p className="max-w-xs text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, back, right, sub, background, color }: { title: ReactNode; back?: boolean | string; right?: ReactNode; sub?: ReactNode; background?: string; color?: string }) {
  const nav = useNavigate();
  return (
    <header className="px-4 pb-2 pt-safe" style={background ? { background, color } : undefined}>
      <div className="flex min-h-11 items-center gap-1">
        {back && (
          <IconButton label="Back" onClick={() => (typeof back === 'string' ? nav(back) : history.length > 1 ? nav(-1) : nav('/'))} className="-ml-2" style={color ? { color } : undefined}>
            <ChevronLeft className="size-6" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[26px] font-semibold leading-tight">{title}</h1>
          {sub && <p className="truncate text-sm text-ink-soft">{sub}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

// ---------- toasts ----------
interface Toast { id: number; text: string; tone: 'info' | 'error' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pt-safe" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className={cx('max-w-sm rounded-2xl px-4 py-3 text-sm font-medium shadow-soft', t.tone === 'error' ? 'bg-[#B5443A] text-cream' : 'bg-ink text-cream')}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/**
 * The strip behind the phone's status bar (clock/battery). Headers scroll
 * away, so this keeps content from showing through the status bar in the
 * installed app. Pages can tint it to match their own top colour.
 */
export function useStatusBarColor(color: string | undefined) {
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue('--statusbar');
    root.style.setProperty('--statusbar', color);
    return () => {
      if (prev) root.style.setProperty('--statusbar', prev);
      else root.style.removeProperty('--statusbar');
    };
  }, [color]);
}

export function StatusBarBackdrop() {
  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[45]" style={{ height: 'env(safe-area-inset-top, 0px)', background: 'var(--statusbar, var(--color-paper))' }} />;
}
