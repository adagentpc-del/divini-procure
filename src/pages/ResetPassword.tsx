import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * /reset?token=... - native password reset. Submits a new password against the
 * reset token; on success the backend issues a session and we land in the app.
 */
export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      await resetPassword(token, password, confirm);
      nav('/app');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="center">
        <div className="auth-card">
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>Reset link required</h1>
          <p className="note" style={{ lineHeight: 1.7 }}>
            This page needs a valid reset link. Request a new one from the sign-in screen.
          </p>
          <button className="btn primary block lg" style={{ marginTop: 16 }} onClick={() => nav('/forgot')}>
            Request a reset link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center">
      <div className="auth-card">
        <h1 style={{ fontSize: 24, marginBottom: 10 }}>Set a new password</h1>
        {err && <div className="err">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="At least 8 characters" autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Re-enter your password" autoComplete="new-password" />
          </div>
          <button className="btn primary block lg" disabled={busy}>{busy ? 'Saving...' : 'Set password and sign in'}</button>
        </form>
        <div className="note" style={{ marginTop: 16 }}>
          <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
