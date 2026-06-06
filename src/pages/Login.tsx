import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setOk(''); setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        setOk('Account created. If email confirmation is on, check your inbox — otherwise you are signed in.');
      }
    } catch (e: any) {
      setErr(e.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--emerald-deep)', color: 'var(--champagne)', display: 'grid', placeItems: 'center', fontFamily: "'Cormorant Garamond',serif", fontWeight: 700 }}>DG</div>
          <div>
            <h1 style={{ fontSize: 24 }}>Divini Procure</h1>
            <div className="note">Procurement marketplace</div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok">{ok}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div className="field"><label>Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} /></div>
          <button className="btn primary block lg" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <a className="note" style={{ cursor: 'pointer' }}
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setOk(''); }}>
            {mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}
          </a>
        </div>
      </div>
    </div>
  );
}
