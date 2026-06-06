import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { getVendorProfile } from '../lib/db';

export default function Profile() {
  const { company, refreshCompany } = useAuth();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [vprofile, setVprofile] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!company) return;
    setName(company.name ?? ''); setContact(company.contact_name ?? '');
    setPhone(company.phone ?? ''); setCity(company.city ?? '');
    if (company.kind === 'vendor') getVendorProfile(company.id).then(setVprofile);
  }, [company]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true); setMsg('');
    await supabase.from('companies').update({
      name, contact_name: contact, phone, city,
    }).eq('id', company.id);
    await refreshCompany();
    setMsg('Saved.'); setBusy(false);
  }

  if (!company) return null;
  const isVendor = company.kind === 'vendor';

  return (
    <>
      <div className="page-head"><div><h1>{isVendor ? 'Profile & Documents' : 'Company Information'}</h1>
        <div className="sub">{company.kind === 'vendor' ? 'Vendor' : 'Developer'} · {company.name}</div></div></div>

      <div className="grid cards2">
        <div className="card">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Organization</h3>
          {msg && <div className="ok">{msg}</div>}
          <form onSubmit={save}>
            <div className="field"><label>Company name</label>
              <input value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="two">
              <div className="field"><label>Contact person</label>
                <input value={contact} onChange={e => setContact(e.target.value)} /></div>
              <div className="field"><label>Phone</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} /></div>
            </div>
            <div className="field"><label>City</label>
              <input value={city} onChange={e => setCity(e.target.value)} /></div>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isVendor && (
            <div className="card">
              <h3 style={{ fontSize: 18, marginBottom: 10 }}>Plan &amp; billing</h3>
              <div className="note" style={{ lineHeight: 1.8 }}>
                Plan: <strong>Vendor — Beta</strong><br />
                Price: <strong>$100 / mo</strong> · first 2 months 50% off<br />
                Bids: <strong>Unlimited</strong><br />
                Billing via PayPal
              </div>
            </div>
          )}
          {isVendor && vprofile && (
            <div className="card">
              <h3 style={{ fontSize: 18, marginBottom: 10 }}>Trust &amp; services</h3>
              <div className="note">Trust score: <strong>{vprofile.trust}</strong> · Status: <span className="badge b-amber">{vprofile.verify_status}</span></div>
              <div style={{ marginTop: 10 }}>{(vprofile.services ?? []).map((s: string) => <span key={s} className="chip on">{s}</span>)}</div>
            </div>
          )}
          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Team &amp; seats</h3>
            <div className="note">1 of 1 seat used · beta is limited to 1 user. Up to 5 included at launch.</div>
          </div>
        </div>
      </div>
    </>
  );
}
