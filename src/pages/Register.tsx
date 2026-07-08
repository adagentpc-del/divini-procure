import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Prefill the email from the invite/referral landing pages if one was captured.
function readInviteEmail(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('email');
    if (fromQuery) return fromQuery;
    return localStorage.getItem('procure_invite_email') ?? '';
  } catch {
    return '';
  }
}

export default function Register() {
  const { createAccount, resendVerification } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const e = readInviteEmail();
    if (e) setEmail(e);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (!agreed) { setErr('Please agree to the Terms, Privacy, Payment, and Non-Circumvention policies to continue.'); return; }
    setBusy(true);
    try {
      await createAccount(email.trim(), password, confirm);
      setSent(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try { await resendVerification(email.trim()); setResent(true); } catch { /* ignore */ }
  }

  if (sent) {
    return (
      <div className="center">
        <div className="auth-card">
          <h1 style={{ fontSize: 24, marginBottom: 10 }}>Check your email</h1>
          <p className="note" style={{ lineHeight: 1.7, marginBottom: 16 }}>
            We sent a verification link to <strong>{email}</strong>. Click it to activate your
            account and finish setting up. The link expires in 24 hours.
          </p>
          <button type="button" className="btn block" onClick={resend} disabled={resent}>
            {resent ? 'Verification email re-sent' : 'Resend verification email'}
          </button>
          <div className="note" style={{ marginTop: 16 }}>
            <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Back to sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 46, height: 46, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 24 }}>Create your account</h1>
            <div className="note">Divini Procure marketplace</div>
          </div>
        </div>

        {err && <div className="err">{err}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="At least 8 characters" autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Re-enter your password" autoComplete="new-password" />
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4, marginBottom: 12, fontSize: 13, lineHeight: 1.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: 'auto', marginTop: 3, flexShrink: 0 }}
              aria-label="Agree to the Terms of Service, Privacy Policy, Payment Policy, and Non-Circumvention Policy"
            />
            <span className="note" style={{ fontSize: 13, lineHeight: 1.5 }}>
              I agree to the{' '}
              <Link to="/terms" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Terms of Service</Link>,{' '}
              <Link to="/privacy" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Privacy Policy</Link>,{' '}
              <Link to="/payment-policy" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Payment Policy</Link>, and{' '}
              <Link to="/non-circumvention" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Non-Circumvention Policy</Link>. Divini Procure
              is a lead-generation and networking platform, is not a party to transactions between users, and payments are
              handled by independent third-party processors.
            </span>
          </label>
          <button className="btn primary block lg" disabled={busy || !agreed}>{busy ? 'Creating...' : 'Create account'}</button>
        </form>

        <div className="note" style={{ marginTop: 16 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
