import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button, Field, PageHeader, TextInput, cx, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { GROUP_THEMES, LIMITS } from '@shared/constants';
import { groupNameError } from '@shared/validation';
import type { GroupTheme } from '@shared/types';

export function ThemePicker({ value, onChange }: { value: GroupTheme; onChange: (t: GroupTheme) => void }) {
  return (
    <div role="radiogroup" aria-label="Group theme" className="grid grid-cols-6 gap-2">
      {GROUP_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
          className={cx('grid aspect-square place-items-center rounded-2xl shadow-soft transition active:scale-95', value === t.id && 'ring-2 ring-ink ring-offset-2 ring-offset-paper')}
          style={{ background: t.bg, color: t.fg }}
        >
          {value === t.id && <Check className="size-5" />}
        </button>
      ))}
    </div>
  );
}

export default function NewGroupPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<GroupTheme>('coral');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = GROUP_THEMES.find((x) => x.id === theme)!;

  async function create() {
    const err = groupNameError(name);
    if (err) return setError(err);
    setBusy(true);
    try {
      const { groupId } = await api.createGroup({ name: name.trim(), theme });
      nav(`/g/${groupId}?invite=1`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader back title="New group" />
      <div className="space-y-6 px-5 pt-2">
        <div className="rounded-[26px] p-6 shadow-soft transition-colors" style={{ background: t.bg, color: t.fg }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] opacity-70">Private group</p>
          <p className="font-display text-3xl font-semibold">{name.trim() || 'The Crew'}</p>
        </div>
        <Field label="Group name" error={error}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="The Crew" maxLength={LIMITS.groupName} autoFocus />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Theme</p>
          <ThemePicker value={theme} onChange={setTheme} />
        </div>
        <Button size="lg" className="w-full" loading={busy} onClick={create}>Create group</Button>
        <p className="text-center text-xs text-ink-soft">Groups are invite-only. Nobody can find yours unless you share the link.</p>
      </div>
    </div>
  );
}
