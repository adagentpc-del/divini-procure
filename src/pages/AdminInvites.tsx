import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type InvitePrefill = {
  description?: string; city?: string; state?: string;
  assetTypes?: string[]; contact?: string; focusAreas?: string[];
};
type Invite = {
  id: string; code: string; email?: string; company_kind?: string;
  status: string; created_at: string; claimed_at?: string;
  company_name?: string | null; company_website?: string | null; prefill?: InvitePrefill | null;
};

const date = (s?: string) => (s ? new Date(s).toLocaleDateString() : '-');

// The three invite roles. companyKind is stored free-text on invite_codes.
const ROLES: { value: string; label: string }[] = [
  { value: 'vendor', label: 'Vendor' },
  { value: 'developer', label: 'Real Estate Developer' },
  { value: 'investor', label: 'Investor' },
];
const roleLabel = (k?: string) => ROLES.find(r => r.value === k)?.label ?? (k || 'Any role');

export default function AdminInvites() {
  const { isAdmin } = useFeatures();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState('vendor');
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [assetTypesText, setAssetTypesText] = useState('');
  const [contact, setContact] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await apiGet<{ invites: Invite[] }>('/admin/invites');
      setInvites(d.invites ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load invites.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    setBusy(true); setErr(''); setLink('');
    try {
      // Asset types accept a comma-separated list; map to a focus chip set.
      const assetTypes = assetTypesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // For investors the same chips read as focusAreas; for developers/vendors
      // they read as assetTypes. Send both keys so onboarding picks the right one.
      const prefill: Record<string, unknown> = {};
      if (description.trim()) prefill.description = description.trim();
      if (city.trim()) prefill.city = city.trim();
      if (stateField.trim()) prefill.state = stateField.trim();
      if (contact.trim()) prefill.contact = contact.trim();
      if (assetTypes.length) {
        if (kind === 'investor') prefill.focusAreas = assetTypes;
        else prefill.assetTypes = assetTypes;
      }
      const d = await apiSend<{ link: string }>('POST', '/admin/invites', {
        email: email || undefined,
        companyKind: kind || undefined,
        companyName: companyName.trim() || undefined,
        companyWebsite: companyWebsite.trim() || undefined,
        prefill: Object.keys(prefill).length ? prefill : undefined,
      });
      setLink(d.link);
      setEmail('');
      setCompanyName(''); setCompanyWebsite(''); setDescription('');
      setCity(''); setStateField(''); setAssetTypesText(''); setContact('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create invite.'); }
    finally { setBusy(false); }
  }

  async function resend(code: string) {
    try {
      const d = await apiSend<{ link: string }>('POST', `/admin/invites/${code}/resend`, {});
      setLink(d.link);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not resend.'); }
  }

  const linkFor = (code: string) =>
    `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/join/${code}`;

  // Group invites by role so admins can see, per role, who has been invited.
  const groups = ROLES.map(r => ({ ...r, items: invites.filter(i => i.company_kind === r.value) }));
  const ungrouped = invites.filter(i => !ROLES.some(r => r.value === i.company_kind));

  function renderRows(items: Invite[]) {
    return items.map(i => {
      const url = linkFor(i.code);
      return (
        <tr key={i.id}>
          <td>{i.company_name || <span className="note">-</span>}</td>
          <td><code>{i.code}</code></td>
          <td>{i.email ?? '-'}</td>
          <td>{roleLabel(i.company_kind)}</td>
          <td>{i.status}</td>
          <td>{date(i.created_at)}</td>
          <td style={{ whiteSpace: 'nowrap' }}>
            <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>{' '}
            <button className="btn" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button>{' '}
            <button className="btn" onClick={() => resend(i.code)}>Resend</button>
          </td>
        </tr>
      );
    });
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Invites</h1>
        <div className="sub">Generate onboarding invite links for vendors, real estate developers, and investors. Add a company name and details to build a pre-filled public claim page; each link routes to the right onboarding.</div>
      </div></div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="note">Role</label>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="note">Email (optional)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="person@example.com" />
          </div>
        </div>

        <div className="note" style={{ margin: '14px 0 8px', fontWeight: 600 }}>
          Pre-filled claim profile (optional)
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="note">Company name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Development Group" />
          </div>
          <div>
            <label className="note">Website</label>
            <input value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} placeholder="https://acmedev.com" />
          </div>
          <div>
            <label className="note">City</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Miami" />
          </div>
          <div>
            <label className="note">State</label>
            <input value={stateField} onChange={e => setStateField(e.target.value)} placeholder="FL" />
          </div>
          <div>
            <label className="note">Primary contact</label>
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Jane Doe" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: '1 1 320px' }}>
            <label className="note">{kind === 'investor' ? 'Focus areas (comma-separated)' : 'Asset types (comma-separated)'}</label>
            <input
              value={assetTypesText}
              onChange={e => setAssetTypesText(e.target.value)}
              placeholder="Multifamily, Hospitality, Mixed-Use"
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label className="note">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="What this company builds, where, and what makes it distinct."
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy} onClick={create}>Generate invite</button>
        </div>

        {link && (
          <div className="note" style={{ marginTop: 12 }}>
            Claim page link: <code>{link}</code>{' '}
            <a className="btn" href={link} target="_blank" rel="noreferrer">Open</a>{' '}
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
          </div>
        )}
      </div>

      {groups.map(g => (
        <div key={g.value} style={{ marginBottom: 16 }}>
          <div className="sectitle">{g.label} <span className="note">({g.items.length})</span></div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Company</th><th>Code</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {renderRows(g.items)}
                {!g.items.length && <tr><td colSpan={7} className="note">No {g.label.toLowerCase()} invites yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="sectitle">Other / unspecified <span className="note">({ungrouped.length})</span></div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Company</th><th>Code</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>{renderRows(ungrouped)}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
