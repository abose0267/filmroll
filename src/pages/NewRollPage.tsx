import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { useGroup } from '@/hooks/useData';
import { Button, Field, FullScreenLoader, PageHeader, Segmented, TextInput, Toggle, cx, useToast } from '@/components/ui';
import { DisposableCamera } from '@/components/film';
import { api, errorMessage } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { CAPACITIES, DEFAULT_CAPACITY, LIMITS, ROLL_NAME_SUGGESTIONS } from '@shared/constants';
import { PRESETS, PRESET_IDS } from '@shared/presets';
import { developsOnDate, rollConfigError } from '@shared/rolls';
import type { DevelopMode, PresetId } from '@shared/types';

/** Small swatch that previews a preset's colour grade on a gradient "scene". */
function PresetSwatch({ id }: { id: PresetId }) {
  const p = PRESETS[id].params;
  const filter = [
    p.mono ? 'grayscale(1)' : `saturate(${1 + p.saturation})`,
    `contrast(${1 + p.contrast * 0.8})`,
    `brightness(${1 + p.exposure * 0.5})`,
    p.warmth > 0.15 ? `sepia(${p.warmth * 0.9})` : '',
  ].join(' ');
  return (
    <div className="relative h-16 w-full overflow-hidden rounded-xl" style={{ filter }}>
      <div className="absolute inset-0 bg-gradient-to-b from-[#7fb2e0] via-[#f3c58c] to-[#4f7a4a]" />
      <div className="absolute bottom-2 left-3 size-6 rounded-full bg-[#e5654b]" />
      <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 ${18 * p.vignette + 4}px rgba(0,0,0,${0.3 + p.vignette * 0.5})` }} />
      {p.leak > 0 && <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-[#ff7a2a]/60 to-transparent" />}
      {p.fade > 0.05 && <div className="absolute inset-0 bg-white/15" />}
    </div>
  );
}

export default function NewRollPage() {
  const { gid } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const reduce = useReducedMotion();
  const { data: group, loading } = useGroup(gid);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState<number>(DEFAULT_CAPACITY);
  const [mode, setMode] = useState<DevelopMode>('either');
  const defaultDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(19, 0, 0, 0);
    return toLocalInput(d.getTime());
  }, []);
  const [date, setDate] = useState(defaultDate);
  const [preset, setPreset] = useState<PresetId>('classic35');
  const [dateStamp, setDateStamp] = useState(true);
  const [busy, setBusy] = useState(false);

  if (loading || !group) return <FullScreenLoader />;
  const developAt = developsOnDate(mode) ? fromLocalInput(date) : null;
  const error = rollConfigError({ name: name || 'x', capacity, developMode: mode, developAt }, Date.now(), LIMITS.rollName);

  async function start() {
    const err = rollConfigError({ name, capacity, developMode: mode, developAt }, Date.now(), LIMITS.rollName);
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      await api.startRoll({ groupId: group!.id, name: name.trim(), capacity, developMode: mode, developAt, preset, dateStamp });
      toast('New roll loaded. Happy shooting!');
      nav(`/g/${group!.id}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader back={`/g/${group.id}`} title="Load a new roll" sub={group.name} />
      <div className="space-y-7 px-5 pt-2">
        <motion.div key={preset} className="flex justify-center py-2" initial={reduce ? false : { rotate: -4, y: 8, opacity: 0.6 }} animate={{ rotate: -2, y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 12 }}>
          <DisposableCamera preset={preset} remaining={capacity} label={name || 'New roll'} width={270} />
        </motion.div>

        <Field label="Roll name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="October Memories" maxLength={LIMITS.rollName} />
        </Field>
        <div className="-mt-4 flex flex-wrap gap-2">
          {ROLL_NAME_SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setName(s)} className="rounded-full bg-cream px-3 py-1.5 text-sm ring-1 ring-line active:bg-paper-2">{s}</button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Exposures</p>
          <Segmented label="Exposures" value={capacity} onChange={setCapacity} options={CAPACITIES.map((c) => ({ value: c, label: `${c} photos` }))} />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Develop</p>
          <div role="radiogroup" aria-label="When the roll develops" className="space-y-2">
            {([
              ['either', 'Whichever comes first', 'On a date, or sooner if the roll fills up'],
              ['date', 'On a date', 'Reveal everything on a set day'],
              ['full', 'When the roll is full', 'Reveal as soon as the last shot is taken'],
            ] as [DevelopMode, string, string][]).map(([v, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={cx('flex w-full items-center gap-3 rounded-2xl bg-cream px-4 py-3 text-left ring-1 transition', mode === v ? 'ring-2 ring-coral' : 'ring-line')}>
                <span className={cx('grid size-5 place-items-center rounded-full ring-2', mode === v ? 'bg-coral ring-coral' : 'ring-ink/20')}>{mode === v && <Check className="size-3 text-cream" />}</span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-ink-soft">{d}</span>
                </span>
              </button>
            ))}
          </div>
          {developsOnDate(mode) && (
            <Field label="Development date" hint="Shown to everyone in their own time zone." error={error && /date/i.test(error) ? error : null}>
              <TextInput type="datetime-local" value={date} min={toLocalInput(Date.now() + 3_600_000)} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Film</p>
          <div role="radiogroup" aria-label="Film aesthetic" className="grid grid-cols-2 gap-3">
            {PRESET_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={preset === id} onClick={() => setPreset(id)} className={cx('space-y-2 rounded-2xl bg-cream p-2 pb-3 text-left ring-1 transition', preset === id ? 'ring-2 ring-coral' : 'ring-line')}>
                <PresetSwatch id={id} />
                <span className="block px-1 font-semibold leading-tight">{PRESETS[id].name}</span>
                <span className="block px-1 text-xs text-ink-soft">{PRESETS[id].description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-cream px-4 shadow-soft">
          <Toggle label="Date stamp" description="Print the date in the corner of each photo, like a real point-and-shoot." checked={dateStamp} onChange={setDateStamp} />
        </div>

        <Button size="lg" className="w-full" loading={busy} disabled={!name.trim() || (!!error && !/name/i.test(error))} onClick={start}>
          Load {capacity} exposures
        </Button>
        <p className="pb-4 text-center text-xs text-ink-soft">Exposures and film can’t be changed after the roll starts.</p>
      </div>
    </div>
  );
}
