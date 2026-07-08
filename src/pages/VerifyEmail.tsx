import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * /verify-email?token=... - confirms the email-verification token. On success
 * the backend issues a session and returns the user; we then bounce into the
 * app (the Gate routes new users to /onboarding).
 */
export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying');
  const [err, setErr] = useState('');
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const token = params.get('token') ?? '';
    if (!token) { setState('error'); setErr('Missing verification token.'); return; }
    verifyEmail(token)
      .then(() => {
        setState('ok');
        setTimeout(() => nav('/app'), 600);
      })
      .catch((e: any) => {
        setState('error');
        setErr(e?.message ?? 'This verification link is invalid or has expired.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="center">
      <div className="auth-card">
        {state === 'verifying' && <div className="note">Verifying your email…</div>}
        {state === 'ok' && (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Email verified</h1>
            <p className="note">Signing you in…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Verification failed</h1>
            <p className="err">{err}</p>
            <div className="note" style={{ marginTop: 14 }}>
              <Link to="/login" style={{ color: 'var(--emerald)', fontWeight: 600 }}>Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
