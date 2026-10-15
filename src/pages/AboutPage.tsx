import { useState, type ReactNode } from 'react';
import { ChevronDown, PlayCircle } from 'lucide-react';
import { Button, PageHeader, cx } from '@/components/ui';
import { DisposableCamera } from '@/components/film';
import Tutorial from '@/components/Tutorial';
import { TAGLINE } from '@shared/constants';
import { PRESETS, PRESET_IDS } from '@shared/presets';

function Feature({ emoji, title, children }: { emoji: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-3xl bg-cream p-4 shadow-soft">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-paper text-xl" aria-hidden>{emoji}</span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm leading-relaxed text-ink-soft">{children}</p>
      </div>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-0">
      <button className="flex w-full items-center justify-between gap-3 py-4 text-left font-semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        {q}
        <ChevronDown className={cx('size-5 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-4 text-sm leading-relaxed text-ink-soft">{children}</div>}
    </div>
  );
}

/** What FilmRoll is and everything it can do (Profile → About FilmRoll). */
export default function AboutPage() {
  const [tutorial, setTutorial] = useState(false);
  return (
    <div>
      <PageHeader back="/profile" title="About FilmRoll" />
      <div className="space-y-8 px-4 pb-6 pt-2">
        <section className="flex flex-col items-center gap-4 rounded-[28px] bg-cream px-6 py-8 text-center shadow-soft">
          <DisposableCamera preset="softPastel" remaining={24} width={220} />
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold">{TAGLINE}</h2>
            <p className="text-ink-soft">
              FilmRoll is a shared disposable camera for friends who live apart. Everyone adds moments from their own day to the same roll — but nobody sees
              anything until it develops. Then the whole group discovers how those moments fit together.
            </p>
          </div>
          <Button variant="secondary" icon={<PlayCircle className="size-5" />} onClick={() => setTutorial(true)}>Replay the tutorial</Button>
        </section>

        <section className="space-y-3">
          <h2 className="px-1 font-display text-2xl font-semibold">How it works</h2>
          <ol className="space-y-3">
            <Feature emoji="👥" title="1 · Make a private group">Invite-only. Share a link or an 8-letter code; nothing is public or searchable. You can be in several groups.</Feature>
            <Feature emoji="🎞️" title="2 · Load a roll">Pick 12, 24 or 36 shared exposures, a film look, and when it develops: when it’s full, on a date, or whichever comes first.</Feature>
            <Feature emoji="📷" title="3 · Wind and shoot">FilmRoll opens straight to the camera. Tap the roll name to switch rolls, wind the film wheel, press the shutter — no preview, no retakes. You get 3 seconds to undo and can add a short note.</Feature>
            <Feature emoji="🙈" title="4 · No peeking">Every photo stays hidden from everyone, including you, until the roll develops. You only see how full the roll is and who’s shot.</Feature>
            <Feature emoji="✨" title="5 · Develop together">Everyone gets the reveal at the same moment: a developing animation, then a contact sheet of the whole roll.</Feature>
            <Feature emoji="📚" title="6 · Keep it forever">React and comment, save private favorites, download originals. Every roll is kept under Groups → Past rolls, and old ones resurface on their anniversaries.</Feature>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="px-1 font-display text-2xl font-semibold">Film looks</h2>
          <ul className="grid grid-cols-2 gap-3">
            {PRESET_IDS.map((id) => (
              <li key={id} className="rounded-2xl bg-cream p-3 shadow-soft">
                <span className="mb-2 block h-2 w-10 rounded-full" style={{ background: PRESETS[id].canister.body }} />
                <p className="font-semibold leading-tight">{PRESETS[id].name}</p>
                <p className="text-xs text-ink-soft">{PRESETS[id].description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="px-1 font-display text-2xl font-semibold">Questions</h2>
          <div className="rounded-3xl bg-cream px-4 shadow-soft">
            <Faq q="Can anyone see my photos before the roll develops?">No — not your friends, not you. Hidden photos can’t be read from the database or storage by anyone until the server marks the roll developed.</Faq>
            <Faq q="Can FilmRoll itself see our photos?">
              Normally photos are private to your group and hidden from everyone until the roll develops, but they’re stored like most apps store photos. For more,
              a group can turn on <b>end-to-end encryption</b> (Group settings → Privacy): each photo and note is locked on the phone that took it, and only phones of
              people in the group hold the key — not FilmRoll, not its developer, not Google. The trade-off: if everyone loses their keys and nobody saved a recovery code
              (Profile → Encryption), those photos can’t be recovered by anyone.
            </Faq>
            <Faq q="Why can’t I upload photos from my camera roll?">FilmRoll is about what’s happening now. Only shots taken in the app (or just now with your phone’s camera, if the in-app camera can’t open) go on the roll.</Faq>
            <Faq q="What if two of us take the last shot at once?">The roll never goes over its limit — one of you gets the last exposure and the other is told it’s full.</Faq>
            <Faq q="I don’t like winding before every shot.">Turn it off in Profile → Camera → “Wind the film before each shot”.</Faq>
            <Faq q="What happens if nobody shoots?">The roll still develops on its date — as an empty roll — and you can load a new one.</Faq>
            <Faq q="Can I install it like an app?">Yes — and it works best that way (it opens full-screen and can notify you). On iPhone, tap Share → Add to Home Screen in Safari (on newer iPhones Share is inside the ••• menu). On Android, use “Install app” in Chrome’s menu.</Faq>
            <Faq q="How do I delete my data?">Profile → Delete account removes your profile, every photo you added, your comments, reactions and favorites, and removes you from your groups.</Faq>
          </div>
        </section>

        <p className="text-center text-xs text-ink-faint">No followers, no streaks, no feeds — just your friends.</p>
      </div>
      {tutorial && <Tutorial onDone={() => setTutorial(false)} />}
    </div>
  );
}
