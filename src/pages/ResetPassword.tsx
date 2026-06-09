import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // Supabase establishes a short-lived recovery session from the link in the
  // URL (detectSessionInUrl is on by default). Wait for it before allowing a save.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    if (pw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (pw !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setOk('Password updated. Taking you to sign in…');
      await supabase.auth.signOut();
      setTimeout(() => nav('/login'), 1600);
    } catch (e: any) {
      setErr(e.message ?? 'Could not update password. The link may have expired — request a new one.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/brand/mark-emerald.png" alt="Divini Procure" style={{ width: 46, height: 46, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 24 }}>Set a new password</h1>
            <div className="note">Divini Procure</div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok">{ok}</div>}
        {!ready && !ok && (
          <div className="note" style={{ marginBottom: 12 }}>
            Validating your reset link… If this doesn't clear, open the most recent reset
            email link again, or request a new one from the sign-in page.
          </div>
        )}
        <form onSubmit={submit}>
          <div className="field"><label>New password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} autoFocus /></div>
          <div className="field"><label>Confirm new password</label>
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={6} /></div>
          <button className="btn primary block lg" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/login')}>Back to sign in</a>
        </div>
      </div>
    </div>
  );
}
