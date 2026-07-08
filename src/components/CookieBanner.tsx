import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const KEY = 'procure_consent_v1';

export function consentGranted(): boolean {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null')?.v === 'all'; } catch { return false; }
}

export default function CookieBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (!JSON.parse(localStorage.getItem(KEY) || 'null')) setShow(true); } catch { setShow(true); }
  }, []);
  function choose(v: 'all' | 'essential') {
    try { localStorage.setItem(KEY, JSON.stringify({ v, t: Date.now() })); } catch { /* ignore */ }
    setShow(false);
  }
  if (!show) return null;
  return (
    <div role="dialog" aria-label="Cookie consent" style={{
      position: 'fixed', left: 16, right: 16, bottom: 16, maxWidth: 560, margin: '0 auto', zIndex: 9999,
      background: '#123c2e', color: '#f3efe6', borderRadius: 16, padding: '18px 20px',
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, lineHeight: 1.5,
      boxShadow: '0 30px 60px -30px rgba(0,0,0,.5)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>We value your privacy</div>
      <div style={{ opacity: .9 }}>
        We use essential cookies to run the Platform and, with your consent, limited device and usage
        signals to improve it. We do not sell your data or use it for advertising. See our{' '}
        <Link to="/cookies" style={{ color: '#d8c8a0', textDecoration: 'underline' }}>Cookie Policy</Link> and{' '}
        <Link to="/privacy" style={{ color: '#d8c8a0', textDecoration: 'underline' }}>Privacy Policy</Link>.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <button onClick={() => choose('essential')} style={{ flex: 1, minWidth: 150, background: 'transparent', color: '#f3efe6', border: '1px solid rgba(243,239,230,.5)', borderRadius: 10, padding: '11px 14px', cursor: 'pointer', font: 'inherit' }}>Reject non-essential</button>
        <button onClick={() => choose('all')} style={{ flex: 1, minWidth: 150, background: '#d8c8a0', color: '#123c2e', border: 'none', borderRadius: 10, padding: '11px 14px', fontWeight: 700, cursor: 'pointer', font: 'inherit' }}>Accept all</button>
      </div>
    </div>
  );
}
