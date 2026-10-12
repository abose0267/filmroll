import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Crown, LogOut, MoreHorizontal, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useGroup, useMembers, useMyMembership, useRoll } from '@/hooks/useData';
import { Avatar, Button, Field, FullScreenLoader, IconButton, PageHeader, Segmented, Sheet, TextInput, Toggle, cx, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, fromLocalInput, toLocalInput } from '@/lib/format';
import { CAPACITIES, LIMITS } from '@shared/constants';
import { PRESETS, PRESET_IDS } from '@shared/presets';
import { endOfMonthEvening } from '@shared/time';
import { developsOnDate } from '@shared/rolls';
import type { AutoRollSettings, GroupTheme, MemberDoc, PresetId } from '@shared/types';
import { ThemePicker } from './NewGroupPage';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">{title}</h2>
      <div className="rounded-3xl bg-cream px-4 py-2 shadow-soft">{children}</div>
    </section>
  );
}

export default function GroupSettingsPage() {
  const { gid } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: group, loading } = useGroup(gid);
  const { data: me } = useMyMembership(gid);
  const { data: members } = useMembers(gid);
  const { data: active } = useRoll(gid, group?.activeRollId);
  const [name, setName] = useState<string | null>(null);
  const [target, setTarget] = useState<MemberDoc | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [rollName, setRollName] = useState<string | null>(null);
  const [rollDate, setRollDate] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading || !group || !me) return <FullScreenLoader />;
  const isAdmin = me.role === 'owner' || me.role === 'admin';
  const isOwner = me.role === 'owner';
  const canEditRoll = active && active.status === 'active' && (isAdmin || active.createdBy === user?.uid);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader back={`/g/${group.id}`} title="Group settings" sub={group.name} />
      <div className="space-y-6 px-4 pt-2">
        {isAdmin && (
          <Section title="Group">
            <div className="space-y-4 py-3">
              <Field label="Name">
                <div className="flex gap-2">
                  <TextInput value={name ?? group.name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.groupName} />
                  <Button disabled={name == null || name.trim() === group.name} loading={busy === 'name'} onClick={() => run('name', () => api.updateGroup({ groupId: group.id, name: name!.trim() }).then(() => setName(null)), 'Saved')}>Save</Button>
                </div>
              </Field>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Theme</p>
                <ThemePicker value={group.theme} onChange={(t: GroupTheme) => run('theme', () => api.updateGroup({ groupId: group.id, theme: t }))} />
              </div>
            </div>
            <div className="divide-y divide-line border-t border-line">
              <Toggle
                label="Only admins can start rolls"
                description="Also limits who can change roll settings."
                checked={group.settings.rollCreators === 'admins'}
                onChange={(v) => run('creators', () => api.updateGroup({ groupId: group.id, settings: { rollCreators: v ? 'admins' : 'everyone' } }))}
              />
              <Toggle
                label="New members see past rolls"
                description="When off, people who join later only see rolls started after they joined."
                checked={group.settings.shareHistory}
                onChange={(v) => run('history', () => api.updateGroup({ groupId: group.id, settings: { shareHistory: v } }))}
              />
            </div>
          </Section>
        )}

        {isAdmin && (
          <Section title="Monthly roll">
            <MonthlyRoll groupId={group.id} auto={group.settings.autoRoll} hasActive={!!active && (active.status === 'active' || active.status === 'developing')} />
          </Section>
        )}

        {canEditRoll && active && (
          <Section title="Current roll">
            <div className="space-y-4 py-3">
              <Field label="Roll name">
                <div className="flex gap-2">
                  <TextInput value={rollName ?? active.name} onChange={(e) => setRollName(e.target.value)} maxLength={LIMITS.rollName} />
                  <Button disabled={rollName == null || rollName.trim() === active.name} loading={busy === 'rname'} onClick={() => run('rname', () => api.updateRoll({ groupId: group.id, rollId: active.id, name: rollName!.trim() }).then(() => setRollName(null)), 'Saved')}>Save</Button>
                </div>
              </Field>
              {developsOnDate(active.developMode) && active.developAt && (
                <Field label="Development date" hint={`Currently ${formatDate(active.developAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Shown in your time zone.`}>
                  <div className="flex gap-2">
                    <TextInput type="datetime-local" value={rollDate ?? toLocalInput(active.developAt)} onChange={(e) => setRollDate(e.target.value)} />
                    <Button disabled={!rollDate} loading={busy === 'rdate'} onClick={() => run('rdate', () => api.updateRoll({ groupId: group.id, rollId: active.id, developAt: fromLocalInput(rollDate!)! }).then(() => setRollDate(null)), 'Date updated')}>Save</Button>
                  </div>
                </Field>
              )}
              {active.exposuresUsed === 0 && active.exposuresReserved === 0 && (
                <Button variant="secondary" className="w-full" loading={busy === 'cancel'} onClick={() => run('cancel', () => api.cancelRoll({ groupId: group.id, rollId: active.id }), 'Roll removed from the camera')}>
                  Cancel this roll (no shots yet)
                </Button>
              )}
              <p className="text-xs text-ink-soft">Exposure count and film type can’t change once a roll has started.</p>
            </div>
          </Section>
        )}

        <Section title={`Members · ${members.length}`}>
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.uid} className="flex items-center gap-3 py-3">
                <Avatar name={m.displayName} url={m.photoURL} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.displayName}{m.uid === user?.uid && ' (you)'}</p>
                  <p className="flex items-center gap-1 text-xs text-ink-soft">
                    {m.role === 'owner' && <><Crown className="size-3" /> Owner</>}
                    {m.role === 'admin' && <><Shield className="size-3" /> Admin</>}
                    {m.role === 'member' && `Joined ${formatDate(m.joinedAt)}`}
                  </p>
                </div>
                {isAdmin && m.uid !== user?.uid && m.role !== 'owner' && (isOwner || m.role === 'member') && (
                  <IconButton label={`Manage ${m.displayName}`} onClick={() => setTarget(m)}><MoreHorizontal className="size-5" /></IconButton>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="You">
          <Toggle label="Mute this group" description="Stop in-app notifications from this group." checked={me.muted} onChange={(v) => run('mute', () => api.setGroupMute({ groupId: group.id, muted: v }))} />
        </Section>

        <Button variant="ghost" className="w-full !text-[#B5443A]" icon={<LogOut className="size-5" />} onClick={() => setConfirmLeave(true)}>Leave group</Button>
      </div>

      <Sheet open={!!target} onClose={() => setTarget(null)} title={target?.displayName}>
        {target && (
          <div className="space-y-2 pb-4">
            {isOwner && (
              <Button variant="secondary" className="w-full" loading={busy === 'role'} onClick={() => run('role', () => api.setMemberRole({ groupId: group.id, uid: target.uid, role: target.role === 'admin' ? 'member' : 'admin' }).then(() => setTarget(null)), 'Role updated')}>
                {target.role === 'admin' ? 'Remove admin role' : 'Make admin'}
              </Button>
            )}
            <Button variant="danger" className="w-full" loading={busy === 'remove'} onClick={() => run('remove', () => api.removeMember({ groupId: group.id, uid: target.uid }).then(() => setTarget(null)), `${target.displayName} was removed`)}>
              Remove from group
            </Button>
            <p className="pt-1 text-center text-xs text-ink-soft">Their photos stay in the group’s rolls.</p>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave this group?">
        <div className="space-y-3 pb-4">
          <p className="text-ink-soft">
            You’ll lose access to {group.name}’s albums. Photos you already added stay in the roll and will still be revealed to the group.
            {members.length === 1 && ' You’re the last member, so the group and its albums will be deleted.'}
          </p>
          <Button variant="danger" className="w-full" loading={busy === 'leave'} onClick={() => run('leave', async () => { await api.leaveGroup({ groupId: group.id }); nav('/', { replace: true }); })}>
            Leave group
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Admin setting: load a roll automatically every month, developing on the month's last evening. */
function MonthlyRoll({ groupId, auto, hasActive }: { groupId: string; auto?: AutoRollSettings; hasActive: boolean }) {
  const toast = useToast();
  const [capacity, setCapacity] = useState<number>(auto?.capacity ?? 24);
  const [preset, setPreset] = useState<PresetId>(auto?.preset ?? 'classic35');
  const [busy, setBusy] = useState(false);
  const on = !!auto?.enabled;
  const tz = auto?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lastEvening = new Date(endOfMonthEvening(Date.now(), tz)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  async function save(enabled: boolean, c = capacity, p = preset) {
    setBusy(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await api.updateGroup({ groupId, settings: { autoRoll: enabled ? { enabled, capacity: c as AutoRollSettings['capacity'], preset: p, timeZone } : { enabled: false, capacity: c as AutoRollSettings['capacity'], preset: p, timeZone } } });
      toast(enabled ? (r.rollId ? 'Monthly roll on — this month’s roll is loaded!' : 'Monthly roll on — the next one loads on the 1st.') : 'Monthly roll off');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 py-1">
      <Toggle
        label="Load a new roll every month"
        description={`A fresh roll on the 1st, developing on the last evening of the month (this month: ${lastEvening}).${hasActive && !on ? ' Starts next month, since a roll is already loaded.' : ''}`}
        checked={on}
        onChange={(v) => void save(v)}
      />
      {on && (
        <div className={cx('space-y-3 pb-3', busy && 'pointer-events-none opacity-60')}>
          <Segmented label="Monthly roll size" value={capacity} onChange={(v) => { setCapacity(v); void save(true, v, preset); }} options={CAPACITIES.map((c) => ({ value: c, label: `${c}` }))} />
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Monthly roll film">
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={preset === id}
                onClick={() => { setPreset(id); void save(true, capacity, id); }}
                className={cx('rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition', preset === id ? 'bg-ink text-cream ring-ink' : 'bg-paper ring-line')}
              >
                {PRESETS[id].name}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-soft">Times follow {tz.replace(/_/g, ' ')}. Changes apply from the next monthly roll.</p>
        </div>
      )}
    </div>
  );
}
