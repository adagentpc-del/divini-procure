import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getVendorProfile, updateCompany, deleteMyAccount, exportMyData, transferOwnership, signOutAllDevices } from '../lib/db';
import { useToast } from '../lib/toast';
import { apiGet } from '../lib/api';
import { type Entitlement, type LimitCheck, money } from '../lib/tiers';

export default function Profile() {
  const { toast } = useToast();
  const { company, refreshCompany, signOut } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [vprofile, setVprofile] = useState<any>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [seatLimit, setSeatLimit] = useState<LimitCheck | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [dbusy, setDbusy] = useState(false);
  const [derr, setDerr] = useState('');
  const [xbusy, setXbusy] = useState(false);
  const [xerr, setXerr] = useState('');
  const [sbusy, setSbusy] = useState(false);
  const [serr, setSerr] = useState('');
  // Owner-email transfer.
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [tbusy, setTbusy] = useState(false);
  const [tmsg, setTmsg] = useState('');
  const [terr, setTerr] = useState('');

  useEffect(() => {
    if (!company) return;
    setName(company.name ?? ''); setContact(company.contact_name ?? '');
    setPhone(company.phone ?? ''); setCity(company.city ?? '');
    if (company.kind === 'vendor') getVendorProfile(company.id).then(setVprofile);
    apiGet<{ entitlement: Entitlement; limits: Record<string, LimitCheck> }>(`/subscriptions/mine?companyId=${company.id}`)
      .then((d) => { setEntitlement(d.entitlement); setSeatLimit(d.limits.seat_limit ?? null); })
      .catch(() => {});
  }, [company]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true); setMsg('');
    try {
      await updateCompany(company.id, { name, contact_name: contact, phone, city });
      await refreshCompany();
      setMsg('Saved.');
      toast('Company profile saved.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'Could not save.';
      setMsg(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setTerr(''); setTmsg('');
    const email = newOwnerEmail.trim();
    if (!email) { setTerr('Enter the new owner email.'); return; }
    const sure = window.confirm(
      `Transfer ownership of ${company.name} to ${email}? They will receive an email to ` +
      `set a password and take over the account. You will be moved to an admin role.`,
    );
    if (!sure) return;
    setTbusy(true);
    try {
      await transferOwnership(company.id, email);
      setTmsg(`Ownership transfer started. ${email} has been emailed a claim link.`);
      setNewOwnerEmail('');
      await refreshCompany();
    } catch (e: any) {
      setTerr(e?.message ?? 'Could not transfer ownership.');
    } finally {
      setTbusy(false);
    }
  }

  async function downloadData() {
    setXerr('');
    setXbusy(true);
    try {
      await exportMyData();
    } catch (e: any) {
      setXerr(e?.message ?? 'Could not export your data. Please try again.');
    } finally {
      setXbusy(false);
    }
  }

  async function signOutEverywhere() {
    setSerr('');
    const sure = window.confirm(
      "Sign out of every device and browser where you're currently logged in, including this one? " +
      "You'll need to log in again here too."
    );
    if (!sure) return;
    setSbusy(true);
    try {
      await signOutAllDevices();
      await signOut();
    } catch (e: any) {
      setSerr(e?.message ?? 'Could not sign out other sessions. Please try again.');
      setSbusy(false);
    }
  }

  async function removeAccount() {
    setDerr('');
    const sure = window.confirm(
      'Permanently delete your account? If your company has no other members, its data ' +
      '(projects, packages, bids, files) is deleted too. This cannot be undone.'
    );
    if (!sure) return;
    setDbusy(true);
    try {
      await deleteMyAccount();
      await signOut();
    } catch (e: any) {
      setDerr(e.message ?? 'Could not delete account. Please contact support.');
      setDbusy(false);
    }
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
          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Plan &amp; billing</h3>
            <div className="note" style={{ lineHeight: 1.8 }}>
              Plan: <strong>{entitlement ? entitlement.name : 'Loading…'}</strong><br />
              {entitlement && (
                <>Price: <strong>{money(entitlement.price_cents)}</strong><br /></>
              )}
              Billing is processed securely by Stripe.
            </div>
            <button className="btn" style={{ marginTop: 10 }} onClick={() => nav('/subscription')}>Manage plan</button>
          </div>
          {isVendor && vprofile && (
            <div className="card">
              <h3 style={{ fontSize: 18, marginBottom: 10 }}>Trust &amp; services</h3>
              <div className="note">Trust score: <strong>{vprofile.trust}</strong> · Status: <span className="badge b-amber">{vprofile.verify_status}</span></div>
              <div style={{ marginTop: 10 }}>{(vprofile.services ?? []).map((s: string) => <span key={s} className="chip on">{s}</span>)}</div>
            </div>
          )}
          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Team &amp; seats</h3>
            <div className="note">
              {seatLimit
                ? `${seatLimit.used} of ${seatLimit.limit === null ? 'unlimited' : seatLimit.limit} seats used`
                : 'Loading…'}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Owner email &amp; transfer</h3>
            <div className="note" style={{ marginBottom: 10 }}>
              Current owner email: <strong>{company.email || '(not set)'}</strong>
            </div>
            <div className="note" style={{ lineHeight: 1.7, marginBottom: 10 }}>
              Transfer ownership to a different email. The new owner receives a link to verify
              their email and set a password, then controls this company. You stay on the team as
              an admin.
            </div>
            {tmsg && <div className="ok" style={{ marginBottom: 8 }}>{tmsg}</div>}
            {terr && <div className="err" style={{ marginBottom: 8 }}>{terr}</div>}
            <form onSubmit={transfer}>
              <div className="field">
                <label>New owner email</label>
                <input
                  type="email"
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  placeholder="newowner@company.com"
                />
              </div>
              <button className="btn" type="submit" disabled={tbusy}>
                {tbusy ? 'Transferring…' : 'Transfer ownership'}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Your data</h3>
            <div className="note" style={{ lineHeight: 1.7 }}>
              Download a copy of your account data — your profile, companies, and the records tied
              to your account — as a JSON file.
            </div>
            {xerr && <div className="err" style={{ marginTop: 10 }}>{xerr}</div>}
            <button type="button" className="btn" style={{ marginTop: 12 }}
              onClick={downloadData} disabled={xbusy}>
              {xbusy ? 'Preparing…' : 'Download my data'}
            </button>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Security</h3>
            <div className="note" style={{ lineHeight: 1.7 }}>
              If you think your account may have been accessed by someone else, sign out everywhere
              at once. This also signs you out of this device — you'll need to log back in.
            </div>
            {serr && <div className="err" style={{ marginTop: 10 }}>{serr}</div>}
            <button type="button" className="btn" style={{ marginTop: 12 }}
              onClick={signOutEverywhere} disabled={sbusy}>
              {sbusy ? 'Signing out…' : 'Sign out of all devices'}
            </button>
          </div>

          <div className="card" style={{ borderColor: '#e1b4b4' }}>
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Delete account</h3>
            <div className="note" style={{ lineHeight: 1.7 }}>
              Permanently delete your account. If your company has no other members, its data
              (projects, packages, bids, files) is removed too. This cannot be undone.
            </div>
            {derr && <div className="err" style={{ marginTop: 10 }}>{derr}</div>}
            <button type="button" className="btn" style={{ marginTop: 12, background: '#a33', borderColor: '#a33', color: '#fff' }}
              onClick={removeAccount} disabled={dbusy}>
              {dbusy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
