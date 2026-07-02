import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await forgotPassword(email.trim()); } catch { /* always succeed to caller */ }
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="center">
      <div className="auth-card">
        <h1 style={{ fontSize: 24, marginBottom: 10 }}>Reset your password</h1>
        {sent ? (
          <>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 16 }}>
              If an account exists for <strong>{email}</strong>, we've sent a password reset link.
              It expires in 1 hour.
            </p>
            <div className="note">
              <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <p className="note" style={{ lineHeight: 1.7, marginBottom: 16 }}>
              Enter your email and we'll send you a link to set a new password.
            </p>
            <form onSubmit={submit}>
              <div className="field">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
              </div>
              <button className="btn primary block lg" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
            </form>
            <div className="note" style={{ marginTop: 16 }}>
              <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
