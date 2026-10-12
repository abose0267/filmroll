import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button, Field, PageHeader, TextInput, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { displayNameError } from '@shared/validation';
import { GoogleButton } from './LandingPage';

type Mode = 'signin' | 'signup' | 'reset';

export default function SignInPage() {
  const { user, loading, signInEmail, signUpEmail, resetPassword } = useAuth();
  const [params] = useSearchParams();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get('next') || sessionStorage.getItem('filmroll:next') || '/';

  if (!loading && user) {
    sessionStorage.removeItem('filmroll:next');
    return <Navigate to={next.startsWith('/') ? next : '/'} replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'signup') {
      const err = displayNameError(name);
      if (err) return setError(err);
    }
    setBusy(true);
    try {
      if (mode === 'signin') await signInEmail(email, password);
      else if (mode === 'signup') await signUpEmail(name, email, password);
      else {
        await resetPassword(email);
        toast('Check your inbox for a reset link.');
        setMode('signin');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-lg pb-safe">
      <PageHeader back="/" title={mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset password' : 'Welcome back'} />
      <div className="space-y-6 px-5 pt-2">
        {mode !== 'reset' && (
          <>
            <GoogleButton next={next} />
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === 'signup' && (
            <Field label="Your name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="What friends call you" maxLength={40} />
            </Field>
          )}
          <Field label="Email">
            <TextInput type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </Field>
          {mode !== 'reset' && (
            <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} />
            </Field>
          )}
          {error && <p className="text-sm text-[#B5443A]" role="alert">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        <div className="space-y-2 text-center text-sm">
          {mode === 'signin' && (
            <>
              <button className="font-semibold text-coral-deep" onClick={() => setMode('signup')}>New here? Create an account</button>
              <br />
              <button className="text-ink-soft" onClick={() => setMode('reset')}>Forgot your password?</button>
            </>
          )}
          {mode !== 'signin' && <button className="font-semibold text-coral-deep" onClick={() => setMode('signin')}>I already have an account</button>}
        </div>
        <p className="text-center text-xs text-ink-faint"><Link to="/">What’s FilmRoll?</Link></p>
      </div>
    </div>
  );
}
