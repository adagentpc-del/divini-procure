import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Login() {
  const { signIn, resendVerification } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // Restore the page the user was trying to reach before being redirected to login.
  const intendedDest = (location.state as { from?: string } | null)?.from || '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setNeedsVerify(false);
    setResent(false);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      nav(intendedDest, { replace: true });
    } catch (e: any) {
      const msg = e?.message ?? 'Could not sign in.';
      if (/verify your email/i.test(msg)) setNeedsVerify(true);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try { await resendVerification(email.trim()); setResent(true); } catch { /* ignore */ }
  }

  return (
    <div className="center">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 46, height: 46, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 24 }}>Divini Procure</h1>
            <div className="note">Procurement marketplace</div>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        {needsVerify && (
          <div className="note" style={{ marginBottom: 12 }}>
            {resent ? (
              'Verification email sent. Check your inbox.'
            ) : (
              <>
                Need a new verification link?{' '}
                <button type="button" className="linklike" onClick={resend} style={{ background: 'none', border: 0, color: 'var(--emerald)', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                  Resend it
                </button>
              </>
            )}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" autoComplete="current-password" />
          </div>
          <button className="btn primary block lg" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>

        <div className="note" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Link to="/register" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Create an account</Link>
          <Link to="/forgot" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Forgot password?</Link>
        </div>
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <LanguageSwitcher full />
        </div>
      </div>
    </div>
  );
}
