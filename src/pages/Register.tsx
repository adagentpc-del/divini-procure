import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import LanguageSwitcher from '../components/LanguageSwitcher';

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
  // Anti-bot: record when the form was rendered so we can reject submissions
  // that arrive suspiciously quickly (bots submit in milliseconds).
  const renderTimeRef = useRef<number>(Date.now());
  // Anti-bot: honeypot field value -- must remain empty for real users.
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    renderTimeRef.current = Date.now();
    const e = readInviteEmail();
    if (e) setEmail(e);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    // Anti-bot: reject if honeypot field is filled (bots fill every visible field).
    if (honeypot) return;
    // Anti-bot: reject if form was submitted in under 1500ms (bot speed).
    if (Date.now() - renderTimeRef.current < 1500) return;
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (!agreed) { setErr('Please agree to the Terms, Privacy, Payment, and Non-Circumvention policies to continue.'); return; }
    setBusy(true);
    try {
      await createAccount(email.trim(), password, confirm, agreed, honeypot);
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

        {err && <div className="err" role="alert" aria-live="assertive">{err}</div>}

        <form onSubmit={submit}>
          {/* Anti-bot honeypot: hidden from real users via CSS; bots fill it and are silently rejected. */}
          <div style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
            <label htmlFor="reg-website">Website</label>
            <input id="reg-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="reg-email">Email</label>
            <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="reg-password">Password</label>
            <input id="reg-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="At least 8 characters" autoComplete="new-password" maxLength={128} />
          </div>
          <div className="field">
            <label htmlFor="reg-confirm">Confirm password</label>
            <input id="reg-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Re-enter your password" autoComplete="new-password" maxLength={128} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4, marginBottom: 12 }}>
            <input
              id="reg-agreed"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: 'auto', marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
              aria-describedby="reg-agreed-desc"
            />
            <label htmlFor="reg-agreed" id="reg-agreed-desc" style={{ fontSize: 13, lineHeight: 1.5, cursor: 'pointer' }}>
              I agree to the{' '}
              <Link to="/terms" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Terms of Service</Link>,{' '}
              <Link to="/privacy" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Privacy Policy</Link>,{' '}
              <Link to="/payment-policy" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Payment Policy</Link>, and{' '}
              <Link to="/non-circumvention" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Non-Circumvention Policy</Link>. Divini Procure
              is a lead-generation and networking platform, is not a party to transactions between users, and payments are
              handled by independent third-party processors.
            </label>
          </div>
          <button className="btn primary block lg" disabled={busy || !agreed}>{busy ? 'Creating...' : 'Create account'}</button>
        </form>

        <div className="note" style={{ marginTop: 16 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Sign in</Link>
        </div>
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <LanguageSwitcher full />
        </div>
      </div>
    </div>
  );
}
