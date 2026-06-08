import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { createCompanyForUser } from '../lib/db';

const SERVICES = ['Millwork', 'Cabinetry', 'Doors', 'Furniture', 'Lighting', 'Concrete', 'Steel', 'Electrical', 'Drapery', 'Security', 'Signage', 'Windows', 'Flooring', 'Metalwork'];

export default function Onboarding() {
  const { session, refreshCompany } = useAuth();
  const nav = useNavigate();
  const [kind, setKind] = useState<'buyer' | 'vendor'>('buyer');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(s: string) {
    setServices(v => v.includes(s) ? v.filter(x => x !== s) : [...v, s]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await createCompanyForUser(session!.user.id, {
        kind, name, contact_name: contact, email: session!.user.email ?? undefined,
        phone, city, region: 'US', services: kind === 'vendor' ? services : undefined,
      });
      await refreshCompany();
      nav('/app');
    } catch (e: any) {
      setErr(e.message ?? 'Could not create your company.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>Set up your company</h1>
        <div className="note" style={{ marginBottom: 18 }}>This creates your organization on Divini Procure.</div>
        {err && <div className="err">{err}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>I am a…</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['buyer', 'vendor'] as const).map(k => (
                <button type="button" key={k} className={'chip' + (kind === k ? ' on' : '')}
                  onClick={() => setKind(k)} style={{ flex: 1, textAlign: 'center', padding: '10px' }}>
                  {k === 'buyer' ? 'Developer / Buyer' : 'Vendor / Supplier'}
                </button>
              ))}
            </div>
          </div>
          <div className="field"><label>Company name</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Divini Group" /></div>
          <div className="two">
            <div className="field"><label>Contact person</label>
              <input value={contact} onChange={e => setContact(e.target.value)} /></div>
            <div className="field"><label>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} /></div>
          </div>
          <div className="field"><label>City</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Miami, FL" /></div>
          {kind === 'vendor' && (
            <div className="field"><label>Your services</label>
              <div>{SERVICES.map(s => (
                <span key={s} className={'chip' + (services.includes(s) ? ' on' : '')} onClick={() => toggle(s)}>{s}</span>
              ))}</div>
            </div>
          )}
          <button className="btn primary block lg" disabled={busy || !name}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </form>
      </div>
    </div>
  );
}
