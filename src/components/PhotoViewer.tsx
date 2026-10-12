import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { Bookmark, ChevronLeft, ChevronRight, Download, MapPin, MessageCircle, Share2, Trash2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { loadPhoto } from '@/lib/photos';
import { downloadPhoto, shareMemory } from '@/lib/share';
import { errorMessage } from '@/lib/api';
import { formatDateTime, randomRequestId, relativeTime } from '@/lib/format';
import { LIMITS, REACTIONS } from '@shared/constants';
import { PRESETS } from '@shared/presets';
import type { CommentDoc, MemberDoc, PhotoDoc, ReactionDoc, ReactionEmoji } from '@shared/types';
import { Avatar, Button, IconButton, Sheet, TextInput, cx, useToast } from './ui';
import { PhotoImage } from './film';

interface Props {
  photos: PhotoDoc[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  people: Record<string, { name: string; photoURL: string | null }>;
  comments: CommentDoc[];
  reactions: ReactionDoc[];
  favorites: Set<string>;
  me: MemberDoc | null;
}

export default function PhotoViewer({ photos, index, onIndex, onClose, people, comments, reactions, favorites, me }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [dir, setDir] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const photo = photos[index];
  const gid = photo.groupId;
  const rid = photo.rollId;

  const go = useCallback((d: number) => {
    const n = index + d;
    if (n < 0 || n >= photos.length) return;
    setDir(d);
    onIndex(n);
  }, [index, photos.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showComments || confirmShare) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [go, onClose, showComments, confirmShare]);

  // Prefetch neighbours at display size.
  useEffect(() => {
    for (const d of [1, -1]) {
      const p = photos[index + d];
      if (p) loadPhoto(p.groupId, p.rollId, p.id, 'display').catch(() => undefined);
    }
  }, [index, photos]);

  const mine = reactions.find((r) => r.photoId === photo.id && r.uid === user?.uid);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of reactions) if (r.photoId === photo.id) c[r.emoji] = (c[r.emoji] ?? 0) + 1;
    return c;
  }, [reactions, photo.id]);
  const thread = comments.filter((c) => c.photoId === photo.id);
  const author = people[photo.uid] ?? { name: 'A former member', photoURL: null };
  const fav = favorites.has(photo.id);

  async function react(emoji: ReactionEmoji) {
    if (!user) return;
    const ref = doc(db, 'groups', gid, 'rolls', rid, 'reactions', `${photo.id}_${user.uid}`);
    try {
      if (mine?.emoji === emoji) await deleteDoc(ref);
      else await setDoc(ref, { photoId: photo.id, uid: user.uid, emoji, createdAt: Date.now() });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function toggleFav() {
    if (!user) return;
    const ref = doc(db, 'users', user.uid, 'favorites', `${rid}_${photo.id}`);
    try {
      if (fav) await deleteDoc(ref);
      else await setDoc(ref, { groupId: gid, rollId: rid, photoId: photo.id, createdAt: Date.now() });
      toast(fav ? 'Removed from your favorites' : 'Saved to your favorites (only you can see this)');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-cream" role="dialog" aria-modal="true" aria-label={`Frame ${photo.frame} of ${photos.length}`}>
      <AnimatePresence>
        {chrome && (
          <motion.div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pb-6 pt-safe" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <IconButton label="Close" onClick={onClose} className="text-cream active:bg-white/10"><X className="size-6" /></IconButton>
            <p className="flex-1 text-center font-mono text-sm">{index + 1} / {photos.length}</p>
            <IconButton label={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={toggleFav} className="text-cream active:bg-white/10" aria-pressed={fav}>
              <Bookmark className={cx('size-6', fav && 'fill-amber text-amber')} />
            </IconButton>
            <IconButton label="Download original" className="text-cream active:bg-white/10" disabled={busy === 'dl'} onClick={async () => {
              setBusy('dl');
              try {
                await downloadPhoto(gid, rid, photo.id, photo.frame);
              } catch (e) {
                toast(errorMessage(e), 'error');
              } finally {
                setBusy(null);
              }
            }}>
              <Download className="size-6" />
            </IconButton>
            {'share' in navigator && <IconButton label="Share outside the group" onClick={() => setConfirmShare(true)} className="text-cream active:bg-white/10"><Share2 className="size-6" /></IconButton>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1" onClick={() => setChrome((c) => !c)}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={photo.id}
            custom={dir}
            className="absolute inset-0 flex items-center justify-center"
            initial={reduce ? { opacity: 0 } : { x: dir >= 0 ? '100%' : '-100%' }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: dir >= 0 ? '-100%' : '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag={reduce ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            onDragEnd={(_, i) => {
              if (i.offset.x < -70 || i.velocity.x < -500) go(1);
              else if (i.offset.x > 70 || i.velocity.x > 500) go(-1);
            }}
          >
            <div className="relative max-h-full w-full">
              <PhotoImage photo={photo} variant="display" eager className="mx-auto max-h-[calc(100dvh-220px)] bg-transparent [&_img]:object-contain" />
            </div>
          </motion.div>
        </AnimatePresence>
        <button className="absolute inset-y-0 left-0 hidden w-16 items-center justify-center md:flex" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous photo" disabled={index === 0}><ChevronLeft className="size-8 opacity-70" /></button>
        <button className="absolute inset-y-0 right-0 hidden w-16 items-center justify-center md:flex" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next photo" disabled={index === photos.length - 1}><ChevronRight className="size-8 opacity-70" /></button>
      </div>

      <div className="space-y-3 bg-gradient-to-t from-black via-black/90 to-transparent px-4 pb-safe pt-3">
        <div className="flex items-start gap-3">
          <Avatar name={author.name} url={author.photoURL} size={38} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{author.name}</p>
            <p className="text-xs text-cream/60">
              {formatDateTime(photo.capturedAt)}
              {photo.location && <> · <MapPin className="inline size-3" /> {photo.location}</>}
              {' · '}{PRESETS[photo.preset].name}
            </p>
            {photo.caption && <p className="mt-1.5 whitespace-pre-line text-[15px] leading-snug">{photo.caption}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {REACTIONS.map((e) => (
            <button key={e} onClick={() => react(e)} aria-pressed={mine?.emoji === e} aria-label={`React ${e}`} className={cx('flex h-10 items-center gap-1 rounded-full px-3 text-lg transition active:scale-90', mine?.emoji === e ? 'bg-cream/25 ring-1 ring-cream/50' : 'bg-white/10')}>
              {e}{counts[e] ? <span className="font-mono text-xs">{counts[e]}</span> : null}
            </button>
          ))}
          <button onClick={() => setShowComments(true)} className="ml-auto flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-semibold">
            <MessageCircle className="size-5" /> {thread.length || ''}
          </button>
        </div>
      </div>

      <CommentsSheet open={showComments} onClose={() => setShowComments(false)} photo={photo} thread={thread} people={people} me={me} />

      <Sheet open={confirmShare} onClose={() => setConfirmShare(false)} title="Share outside the group?">
        <div className="space-y-3 pb-4">
          <p className="text-ink-soft">This sends a copy of this one photo to another app. Your album stays private — nothing else is shared.</p>
          <Button className="w-full" loading={busy === 'share'} onClick={async () => {
            setBusy('share');
            try {
              const ok = await shareMemory(gid, rid, photo.id, photo.frame, photo.caption);
              if (!ok) toast('Sharing isn’t available on this device. Use Download instead.');
              setConfirmShare(false);
            } catch (e) {
              toast(errorMessage(e), 'error');
            } finally {
              setBusy(null);
            }
          }}>Share this photo</Button>
        </div>
      </Sheet>
    </div>
  );
}

function CommentsSheet({ open, onClose, photo, thread, people, me }: { open: boolean; onClose: () => void; photo: PhotoDoc; thread: CommentDoc[]; people: Props['people']; me: MemberDoc | null }) {
  const { user } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !me || !text.trim()) return;
    setSending(true);
    const id = randomRequestId();
    try {
      await setDoc(doc(db, 'groups', photo.groupId, 'rolls', photo.rollId, 'comments', id), {
        id, photoId: photo.id, uid: user.uid, displayName: me.displayName, photoURL: me.photoURL ?? null, text: text.trim().slice(0, LIMITS.comment), createdAt: Date.now(),
      } satisfies CommentDoc);
      setText('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Frame ${photo.frame}`} tall>
      <div className="flex h-full flex-col">
        <ul className="flex-1 space-y-4 pb-4">
          {thread.length === 0 && <li className="py-8 text-center text-sm text-ink-soft">No comments yet. Say something nice.</li>}
          {thread.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.displayName} url={people[c.uid]?.photoURL ?? c.photoURL} size={34} />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-semibold">{c.displayName}</span> <span className="text-ink-faint">{relativeTime(c.createdAt)}</span></p>
                <p className="whitespace-pre-line text-[15px]">{c.text}</p>
              </div>
              {(c.uid === user?.uid || isAdmin) && (
                <IconButton label="Delete comment" className="size-9 text-ink-faint" onClick={() => deleteDoc(doc(db, 'groups', photo.groupId, 'rolls', photo.rollId, 'comments', c.id)).catch((e) => toast(errorMessage(e), 'error'))}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={send} className="sticky bottom-0 flex gap-2 bg-cream py-3">
          <TextInput value={text} onChange={(e) => setText(e.target.value.slice(0, LIMITS.comment))} placeholder="Add a comment…" aria-label="Comment" />
          <Button type="submit" loading={sending} disabled={!text.trim()}>Send</Button>
        </form>
      </div>
    </Sheet>
  );
}
