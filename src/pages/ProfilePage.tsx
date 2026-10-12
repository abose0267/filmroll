import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { BarChart3, Camera, ChevronRight, Info, LogOut, PlayCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useData';
import { Avatar, Button, Field, PageHeader, Sheet, TextArea, TextInput, Toggle, useToast } from '@/components/ui';
import { db } from '@/lib/firebase';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DEFAULT_NOTIFICATION_PREFS, LIMITS } from '@shared/constants';
import { cleanText, displayNameError } from '@shared/validation';
import type { NotificationPrefs } from '@shared/types';
import { uploadAvatar } from './OnboardingPage';
import { themeOf } from './HomePage';

const Tutorial = lazy(() => import('@/components/Tutorial'));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">{title}</h2>
      <div className="rounded-3xl bg-cream px-4 shadow-soft">{children}</div>
    </section>
  );
}

const PREF_LABELS: [keyof NotificationPrefs, string, string][] = [
  ['rollStarted', 'Group activity', 'New rolls and new members'],
  ['milestones', 'Roll progress', 'Halfway full, last few exposures'],
  ['developed', 'Developed film', 'When a roll is ready to see'],
  ['comments', 'Comments', 'When someone comments on your photo'],
];

export default function ProfilePage() {
  const { user, profile, signOut } = useAuth();
  const { groups } = useMyGroups();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [tutorial, setTutorial] = useState(false);
  const [admin, setAdmin] = useState(false);
  // The server decides who's an admin; the link only appears if it says yes.
  useEffect(() => {
    api.amIAdmin({}).then((r) => setAdmin(r.admin), () => setAdmin(false));
  }, []);
  if (!user || !profile) return null;
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...profile.notificationPrefs };

  const save = (data: Record<string, unknown>) => updateDoc(doc(db, 'users', user.uid), data).catch((e) => toast(errorMessage(e), 'error'));

  return (
    <div>
      <PageHeader title="Profile" />
      <div className="space-y-6 px-4 pt-2">
        <div className="flex items-center gap-4">
          <button onClick={() => file.current?.click()} className="relative" aria-label="Change profile photo">
            <Avatar name={profile.displayName} url={profile.photoURL} size={76} />
            <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full bg-ink text-cream ring-4 ring-paper"><Camera className="size-4" /></span>
          </button>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              toast('Updating your photo…');
              await save({ photoURL: await uploadAvatar(user.uid, f) });
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-2xl font-semibold">{profile.displayName}</p>
            {profile.city && <p className="text-sm text-ink-soft">{profile.city}</p>}
            <p className="text-xs text-ink-faint">Joined {formatDate(profile.createdAt, { month: 'long', year: 'numeric' })}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { setName(profile.displayName); setCity(profile.city); setBio(profile.bio); setEditing(true); }}>Edit</Button>
        </div>
        {profile.bio && <p className="rounded-2xl bg-cream/60 px-4 py-3 text-[15px]">{profile.bio}</p>}

        {/* owner-only: shown when the server confirms this account is an admin */}
        {admin && (
          <Link to="/admin" className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink font-semibold text-cream shadow-soft transition active:scale-[0.98]">
            <BarChart3 className="size-5" /> Analytics
          </Link>
        )}

        <Section title="Your groups">
          {groups.length === 0 ? (
            <p className="py-4 text-sm text-ink-soft">You’re not in any groups yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link to={`/g/${g.id}/settings`} className="flex items-center gap-3 py-3">
                    <span className="size-8 rounded-xl" style={{ background: themeOf(g).bg }} />
                    <span className="flex-1 font-semibold">{g.name}</span>
                    <span className="text-sm text-ink-soft">{g.memberCount}</span>
                    <ChevronRight className="size-5 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Notifications">
          <div className="divide-y divide-line">
            {PREF_LABELS.map(([k, l, d]) => (
              <Toggle key={k} label={l} description={d} checked={prefs[k]} onChange={(v) => save({ notificationPrefs: { ...prefs, [k]: v } })} />
            ))}
          </div>
        </Section>

        <Section title="Camera">
          <Toggle
            label="Wind the film before each shot"
            description="Like a real disposable: turn the wheel to unlock the shutter. Off = the shutter is always ready."
            checked={profile.windToShoot !== false}
            onChange={(v) => save({ windToShoot: v })}
          />
        </Section>

        <Section title="Memories">
          <Toggle label="Resurface old rolls" description="Show “one year ago” moments in Albums." checked={profile.showMemories} onChange={(v) => save({ showMemories: v, notificationPrefs: { ...prefs, memories: v } })} />
        </Section>

        <Section title="FilmRoll">
          <div className="divide-y divide-line">
            <Link to="/about" className="flex items-center gap-3 py-3 font-semibold"><Info className="size-5" /> <span className="flex-1">About FilmRoll</span><ChevronRight className="size-5 text-ink-faint" /></Link>
            <button className="flex w-full items-center gap-3 py-3 text-left font-semibold" onClick={() => setTutorial(true)}><PlayCircle className="size-5" /> <span className="flex-1">How FilmRoll works</span><ChevronRight className="size-5 text-ink-faint" /></button>
          </div>
        </Section>

        <Section title="Account">
          <div className="divide-y divide-line">
            <p className="py-3 text-sm text-ink-soft">Signed in as {user.email ?? 'Google account'}</p>
            <button className="flex w-full items-center gap-2 py-3 font-semibold" onClick={() => signOut()}><LogOut className="size-5" /> Sign out</button>
            <button className="w-full py-3 text-left font-semibold text-[#B5443A]" onClick={() => setDeleting(true)}>Delete account…</button>
          </div>
        </Section>
        <p className="pb-4 text-center text-xs text-ink-faint">FilmRoll · Different lives. One roll of film.</p>
      </div>

      {tutorial && (
        <Suspense fallback={null}>
          <Tutorial onDone={() => setTutorial(false)} />
        </Suspense>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div className="space-y-4 pb-4">
          <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.displayName} /></Field>
          <Field label="City" hint="Optional"><TextInput value={city} onChange={(e) => setCity(e.target.value)} maxLength={LIMITS.city} /></Field>
          <Field label="Short bio" hint={`${bio.length}/${LIMITS.bio}`}><TextArea value={bio} onChange={(e) => setBio(e.target.value.slice(0, LIMITS.bio))} rows={3} /></Field>
          <Button className="w-full" loading={busy} onClick={async () => {
            const err = displayNameError(name);
            if (err) return toast(err, 'error');
            setBusy(true);
            await save({ displayName: cleanText(name, LIMITS.displayName), city: cleanText(city, LIMITS.city), bio: cleanText(bio, LIMITS.bio, { multiline: true }) });
            setBusy(false);
            setEditing(false);
          }}>Save</Button>
        </div>
      </Sheet>

      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Delete your account?">
        <div className="space-y-4 pb-4">
          <p className="text-ink-soft">This permanently deletes your profile, every photo you’ve added (including in developed albums), your comments, reactions and favorites, and removes you from all groups. This can’t be undone.</p>
          <Field label="Type DELETE to confirm"><TextInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="characters" /></Field>
          <Button variant="danger" className="w-full" disabled={confirm !== 'DELETE'} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.deleteAccount({ confirm: 'DELETE' });
              await signOut();
            } catch (e) {
              toast(errorMessage(e), 'error');
              setBusy(false);
            }
          }}>Delete everything</Button>
        </div>
      </Sheet>
    </div>
  );
}
