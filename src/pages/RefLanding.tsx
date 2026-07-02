/**
 * /ref/:code - peer referral landing. Persists the referrer's code so the
 * post-signup hook (in the investor dashboard) attributes the new user and
 * rewards the referrer with intro credits, then routes to registration.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export default function RefLanding() {
  const nav = useNavigate();
  const { code } = useParams<{ code: string }>();
  useEffect(() => {
    try { if (code) localStorage.setItem('procure_peer_ref', code); } catch { /* ignore */ }
    nav('/register', { replace: true });
  }, [code, nav]);
  return <div className="center"><div className="note">Taking you to sign up…</div></div>;
}
