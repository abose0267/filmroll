import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { doc, writeBatch } from 'firebase/firestore';
import { Bell } from 'lucide-react';
import { useNotifications } from '@/hooks/useData';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState, PageHeader, Spinner, cx } from '@/components/ui';
import { ProfileButton } from '@/components/AppShell';
import { db } from '@/lib/firebase';
import { relativeTime } from '@/lib/format';

const ICON: Record<string, string> = { joined: '👋', rollStarted: '🎞️', halfway: '🌗', fewLeft: '⏳', developed: '📸', comment: '💬' };

export default function NotificationsPage() {
  const { user } = useAuth();
  const { data, loading } = useNotifications();

  // Mark everything read shortly after viewing.
  useEffect(() => {
    const unread = data.filter((n) => !n.read);
    if (!user || !unread.length) return;
    const t = setTimeout(() => {
      const b = writeBatch(db);
      unread.forEach((n) => b.update(doc(db, 'users', user.uid, 'notifications', n.id), { read: true }));
      b.commit().catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
  }, [data, user]);

  return (
    <div>
      <PageHeader title="Activity" right={<ProfileButton />} />
      <div className="px-4">
        {loading ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : data.length === 0 ? (
          <EmptyState art={<Bell className="size-10 text-ink-faint" />} title="All quiet">We’ll let you know when a roll starts, fills up, or develops. No streaks, no nagging.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {data.map((n) => (
              <li key={n.id}>
                <Link to={n.link} className={cx('flex gap-3 rounded-2xl px-4 py-3 transition active:bg-paper-2', n.read ? 'bg-transparent' : 'bg-cream shadow-soft')}>
                  <span className="text-2xl" aria-hidden>{ICON[n.kind] ?? '🎞️'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{n.title}</span>
                    <span className="block text-sm text-ink-soft">{n.body}</span>
                    <span className="block text-xs text-ink-faint">{relativeTime(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-coral" aria-label="Unread" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
