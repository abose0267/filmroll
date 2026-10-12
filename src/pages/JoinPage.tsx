import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, FullScreenLoader, useToast } from '@/components/ui';
import { DisposableCamera } from '@/components/film';
import { api, errorMessage } from '@/lib/api';
import { GROUP_THEMES } from '@shared/constants';
import { formatInviteCode, normalizeInviteCode } from '@shared/validation';

type Preview = Awaited<ReturnType<typeof api.previewInvite>>;

export default function JoinPage() {
  const { code: raw = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const code = normalizeInviteCode(raw);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(code ? null : 'That invite code doesn’t look right.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.previewInvite({ code }).then(setPreview, (e) => setError(errorMessage(e)));
  }, [code]);

  if (!preview && !error) return <FullScreenLoader label="Checking your invite…" />;
  const t = GROUP_THEMES.find((x) => x.id === preview?.theme) ?? GROUP_THEMES[0];

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col px-6 pb-safe pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <DisposableCamera preset="classic35" width={220} />
        {error ? (
          <>
            <h1 className="font-display text-3xl font-semibold">Hmm, that invite didn’t work</h1>
            <p className="text-ink-soft">{error}</p>
            <Link to="/"><Button variant="secondary">Go home</Button></Link>
          </>
        ) : preview && (
          <>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink-faint">You’re invited to</p>
            <div className="w-full rounded-[26px] p-6 shadow-soft" style={{ background: t.bg, color: t.fg }}>
              <h1 className="font-display text-3xl font-semibold">{preview.name}</h1>
              <p className="opacity-80">{preview.memberNames.join(', ')}{preview.memberCount > preview.memberNames.length ? ` and ${preview.memberCount - preview.memberNames.length} more` : ''}</p>
            </div>
            <p className="font-mono text-sm text-ink-soft">{formatInviteCode(code!)}</p>
          </>
        )}
      </div>
      {preview && (
        <div className="pb-4">
          {preview.alreadyMember ? (
            <Button size="lg" className="w-full" onClick={() => nav(`/g/${preview.groupId}`, { replace: true })}>You’re already in — open group</Button>
          ) : (
            <Button
              size="lg"
              className="w-full"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.joinGroup({ code: code! });
                  toast(`Welcome to ${r.name}!`);
                  nav(`/g/${r.groupId}`, { replace: true });
                } catch (e) {
                  toast(errorMessage(e), 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Join {preview.name}
            </Button>
          )}
        </div>
      )}
    </main>
  );
}
