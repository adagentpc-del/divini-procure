/**
 * COITracker -- insurance certificate and trade/business license tracking
 * page for Divini Procure. Talks to /api/coi (server/src/routes/coi.ts) and
 * /api/licenses (server/src/routes/licenses.ts, the vendor prequalification
 * gap closure - docs/competitive-analysis-2026-08.md gap #3). Styling
 * matches the rest of Procure (card / table / btn / badge / field / two) -
 * see theme.css. Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';

const CERT_TYPES = [
  { value: 'general_liability', label: 'General Liability' },
  { value: 'workers_comp', label: 'Workers Comp' },
  { value: 'umbrella', label: 'Umbrella' },
  { value: 'auto', label: 'Auto' },
  { value: 'professional', label: 'Professional' },
  { value: 'other', label: 'Other' },
];

function formatType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

function formatDate(d: string | null | undefined): string {
  return d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

function badgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'badge b-green';
    case 'expiring_soon':
      return 'badge b-amber';
    case 'expired':
      return 'badge b-red';
    default:
      return 'badge b-neutral';
  }
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === 'active' ? 'Active' :
    status === 'expiring_soon' ? 'Expiring Soon' :
    status === 'expired' ? 'Expired' :
    'Suspended';
  return <span className={badgeClass(status)}>{label}</span>;
}

const emptyCertForm = {
  certificateType: 'general_liability',
  carrierName: '',
  policyNumber: '',
  coverageAmountCents: '',
  aggregateAmountCents: '',
  effectiveDate: '',
  expiryDate: '',
  notes: '',
};

const emptyLicenseForm = {
  licenseType: '',
  licenseNumber: '',
  issuingAuthority: '',
  jurisdiction: '',
  effectiveDate: '',
  expiryDate: '',
  notes: '',
};

export default function COITracker() {
  const [tab, setTab] = useState<'coi' | 'licenses'>('coi');

  const [certs, setCerts] = useState<any[]>([]);
  const [certsLoading, setCertsLoading] = useState(true);
  const [showCertForm, setShowCertForm] = useState(false);
  const [editCert, setEditCert] = useState<any | null>(null);
  const [certForm, setCertForm] = useState({ ...emptyCertForm });
  const [certSubmitting, setCertSubmitting] = useState(false);

  const [licenses, setLicenses] = useState<any[]>([]);
  const [licensesLoading, setLicensesLoading] = useState(true);
  const [showLicenseForm, setShowLicenseForm] = useState(false);
  const [editLicense, setEditLicense] = useState<any | null>(null);
  const [licenseForm, setLicenseForm] = useState({ ...emptyLicenseForm });
  const [licenseSubmitting, setLicenseSubmitting] = useState(false);

  const [error, setError] = useState('');

  async function fetchCerts() {
    try {
      const res = await fetch('/api/coi');
      if (!res.ok) throw new Error('Failed to load certificates');
      const data = await res.json();
      setCerts(data.certificates ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Could not load certificates');
    } finally {
      setCertsLoading(false);
    }
  }

  async function fetchLicenses() {
    try {
      const res = await fetch('/api/licenses');
      if (!res.ok) throw new Error('Failed to load licenses');
      const data = await res.json();
      setLicenses(data.licenses ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Could not load licenses');
    } finally {
      setLicensesLoading(false);
    }
  }

  useEffect(() => { fetchCerts(); fetchLicenses(); }, []);

  function openAddCert() {
    setEditCert(null);
    setCertForm({ ...emptyCertForm });
    setShowCertForm(true);
  }

  function openEditCert(cert: any) {
    setEditCert(cert);
    setCertForm({
      certificateType: cert.certificate_type ?? 'general_liability',
      carrierName: cert.carrier_name ?? '',
      policyNumber: cert.policy_number ?? '',
      coverageAmountCents: cert.coverage_amount_cents != null ? String(Math.round(cert.coverage_amount_cents / 100)) : '',
      aggregateAmountCents: cert.aggregate_amount_cents != null ? String(Math.round(cert.aggregate_amount_cents / 100)) : '',
      effectiveDate: cert.effective_date ? cert.effective_date.slice(0, 10) : '',
      expiryDate: cert.expiry_date ? cert.expiry_date.slice(0, 10) : '',
      notes: cert.notes ?? '',
    });
    setShowCertForm(true);
  }

  function cancelCertForm() {
    setShowCertForm(false);
    setEditCert(null);
    setCertForm({ ...emptyCertForm });
    setError('');
  }

  function certField(key: keyof typeof certForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setCertForm(f => ({ ...f, [key]: e.target.value }));
    };
  }

  async function handleCertSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCertSubmitting(true);
    setError('');
    try {
      const dollarsToInt = (s: string) => s === '' ? undefined : Math.round(Number(s) * 100);
      const payload: Record<string, unknown> = {
        certificateType: certForm.certificateType,
        carrierName: certForm.carrierName || undefined,
        policyNumber: certForm.policyNumber || undefined,
        coverageAmountCents: dollarsToInt(certForm.coverageAmountCents),
        aggregateAmountCents: dollarsToInt(certForm.aggregateAmountCents),
        effectiveDate: certForm.effectiveDate || undefined,
        expiryDate: certForm.expiryDate,
        notes: certForm.notes || undefined,
      };

      const res = editCert
        ? await fetch(`/api/coi/${editCert.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/coi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? 'Save failed');
      }

      setCertsLoading(true);
      await fetchCerts();
      cancelCertForm();
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setCertSubmitting(false);
    }
  }

  function openAddLicense() {
    setEditLicense(null);
    setLicenseForm({ ...emptyLicenseForm });
    setShowLicenseForm(true);
  }

  function openEditLicense(license: any) {
    setEditLicense(license);
    setLicenseForm({
      licenseType: license.license_type ?? '',
      licenseNumber: license.license_number ?? '',
      issuingAuthority: license.issuing_authority ?? '',
      jurisdiction: license.jurisdiction ?? '',
      effectiveDate: license.effective_date ? license.effective_date.slice(0, 10) : '',
      expiryDate: license.expiry_date ? license.expiry_date.slice(0, 10) : '',
      notes: license.notes ?? '',
    });
    setShowLicenseForm(true);
  }

  function cancelLicenseForm() {
    setShowLicenseForm(false);
    setEditLicense(null);
    setLicenseForm({ ...emptyLicenseForm });
    setError('');
  }

  function licenseField(key: keyof typeof licenseForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLicenseForm(f => ({ ...f, [key]: e.target.value }));
    };
  }

  async function handleLicenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLicenseSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        licenseType: licenseForm.licenseType,
        licenseNumber: licenseForm.licenseNumber || undefined,
        issuingAuthority: licenseForm.issuingAuthority || undefined,
        jurisdiction: licenseForm.jurisdiction || undefined,
        effectiveDate: licenseForm.effectiveDate || undefined,
        expiryDate: licenseForm.expiryDate,
        notes: licenseForm.notes || undefined,
      };

      const res = editLicense
        ? await fetch(`/api/licenses/${editLicense.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/licenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? 'Save failed');
      }

      setLicensesLoading(true);
      await fetchLicenses();
      cancelLicenseForm();
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setLicenseSubmitting(false);
    }
  }

  async function deleteLicense(id: string) {
    try {
      const res = await fetch(`/api/licenses/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? 'Delete failed');
      }
      await fetchLicenses();
    } catch (e: any) {
      setError(e.message ?? 'Delete failed');
    }
  }

  const computedCerts = certs.map(c => ({ ...c, _status: c.computed_status ?? c.status }));
  const certActiveCount = computedCerts.filter(c => c._status === 'active').length;
  const certExpiringSoonCount = computedCerts.filter(c => c._status === 'expiring_soon').length;
  const certExpiredCount = computedCerts.filter(c => c._status === 'expired').length;

  const computedLicenses = licenses.map(l => ({ ...l, _status: l.computed_status ?? l.status }));
  const licenseActiveCount = computedLicenses.filter(l => l._status === 'active').length;
  const licenseExpiringSoonCount = computedLicenses.filter(l => l._status === 'expiring_soon').length;
  const licenseExpiredCount = computedLicenses.filter(l => l._status === 'expired').length;

  const loading = tab === 'coi' ? certsLoading : licensesLoading;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Compliance &amp; Prequalification</h1>
          <div className="sub">Insurance certificates and trade/business licenses on file - what a developer sees before considering your bid.</div>
        </div>
        <button className="btn primary" onClick={tab === 'coi' ? openAddCert : openAddLicense}>
          {tab === 'coi' ? '+ Add Certificate' : '+ Add License'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--line)' }}>
        {(['coi', 'licenses'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="btn"
            style={{
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--emerald)' : '2px solid transparent',
              borderRadius: 0,
              background: 'transparent',
              color: tab === t ? 'var(--emerald-deep)' : 'var(--muted)',
            }}
          >
            {t === 'coi' ? 'Insurance (COI)' : 'Licenses'}
          </button>
        ))}
      </div>

      {!loading && tab === 'coi' && (
        <div className="grid cards3" style={{ marginBottom: 18 }}>
          <div className="card metric"><div className="k">Active</div><div className="v">{certActiveCount}</div></div>
          <div className="card metric"><div className="k">Expiring Soon</div><div className="v">{certExpiringSoonCount}</div></div>
          <div className="card metric"><div className="k">Expired</div><div className="v">{certExpiredCount}</div></div>
        </div>
      )}
      {!loading && tab === 'licenses' && (
        <div className="grid cards3" style={{ marginBottom: 18 }}>
          <div className="card metric"><div className="k">Active</div><div className="v">{licenseActiveCount}</div></div>
          <div className="card metric"><div className="k">Expiring Soon</div><div className="v">{licenseExpiringSoonCount}</div></div>
          <div className="card metric"><div className="k">Expired</div><div className="v">{licenseExpiredCount}</div></div>
        </div>
      )}

      {!loading && tab === 'coi' && certExpiringSoonCount > 0 && (
        <div className="badge b-amber" style={{ display: 'block', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {certExpiringSoonCount} certificate{certExpiringSoonCount !== 1 ? 's' : ''} expiring within 30 days
        </div>
      )}
      {!loading && tab === 'licenses' && licenseExpiringSoonCount > 0 && (
        <div className="badge b-amber" style={{ display: 'block', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {licenseExpiringSoonCount} license{licenseExpiringSoonCount !== 1 ? 's' : ''} expiring within 30 days
        </div>
      )}

      {error && !showCertForm && !showLicenseForm && <div className="err">{error}</div>}

      {loading && <div className="note">Loading…</div>}

      {tab === 'coi' && !certsLoading && certs.length === 0 && !showCertForm && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="note" style={{ marginBottom: 14 }}>
            No insurance certificates on file. Add your first certificate to stay compliant.
          </p>
          <button className="btn primary" onClick={openAddCert}>Add Certificate</button>
        </div>
      )}

      {tab === 'coi' && !certsLoading && certs.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Type</th><th>Carrier</th><th>Policy #</th><th>Coverage</th><th>Expiry Date</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {computedCerts.map(cert => (
                <tr key={cert.id}>
                  <td>{formatType(cert.certificate_type)}</td>
                  <td>{cert.carrier_name ?? <span className="note">—</span>}</td>
                  <td>{cert.policy_number ?? <span className="note">—</span>}</td>
                  <td>{formatMoney(cert.coverage_amount_cents)}</td>
                  <td>{formatDate(cert.expiry_date)}</td>
                  <td><StatusBadge status={cert._status} /></td>
                  <td><button className="btn" onClick={() => openEditCert(cert)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'licenses' && !licensesLoading && licenses.length === 0 && !showLicenseForm && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="note" style={{ marginBottom: 14 }}>
            No trade or business licenses on file. Add your first license so developers can prequalify you.
          </p>
          <button className="btn primary" onClick={openAddLicense}>Add License</button>
        </div>
      )}

      {tab === 'licenses' && !licensesLoading && licenses.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Type</th><th>License #</th><th>Issuing Authority</th><th>Jurisdiction</th><th>Expiry Date</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {computedLicenses.map(license => (
                <tr key={license.id}>
                  <td>{license.license_type}</td>
                  <td>{license.license_number ?? <span className="note">—</span>}</td>
                  <td>{license.issuing_authority ?? <span className="note">—</span>}</td>
                  <td>{license.jurisdiction ?? <span className="note">—</span>}</td>
                  <td>{formatDate(license.expiry_date)}</td>
                  <td><StatusBadge status={license._status} /></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => openEditLicense(license)}>Edit</button>
                    <button className="btn" onClick={() => deleteLicense(license.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCertForm && (
        <div className="card">
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>{editCert ? 'Edit Certificate' : 'Add Certificate'}</h2>
          {error && <div className="err">{error}</div>}
          <form onSubmit={handleCertSubmit}>
            <div className="field">
              <label>Type *</label>
              <select value={certForm.certificateType} onChange={certField('certificateType')} required>
                {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="two">
              <div className="field">
                <label>Carrier Name</label>
                <input type="text" value={certForm.carrierName} onChange={certField('carrierName')} placeholder="e.g. Travelers" />
              </div>
              <div className="field">
                <label>Policy Number</label>
                <input type="text" value={certForm.policyNumber} onChange={certField('policyNumber')} placeholder="e.g. GL-123456" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Coverage Amount ($)</label>
                <input type="number" min="0" step="1" value={certForm.coverageAmountCents} onChange={certField('coverageAmountCents')} placeholder="e.g. 1000000" />
              </div>
              <div className="field">
                <label>Aggregate Amount ($)</label>
                <input type="number" min="0" step="1" value={certForm.aggregateAmountCents} onChange={certField('aggregateAmountCents')} placeholder="e.g. 2000000" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Effective Date</label>
                <input type="date" value={certForm.effectiveDate} onChange={certField('effectiveDate')} />
              </div>
              <div className="field">
                <label>Expiry Date *</label>
                <input type="date" value={certForm.expiryDate} onChange={certField('expiryDate')} required />
              </div>
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea value={certForm.notes} onChange={certField('notes')} rows={3} placeholder="Additional notes..." />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn primary" disabled={certSubmitting}>
                {certSubmitting ? 'Saving...' : editCert ? 'Save Changes' : 'Add Certificate'}
              </button>
              <button type="button" className="btn" onClick={cancelCertForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showLicenseForm && (
        <div className="card">
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>{editLicense ? 'Edit License' : 'Add License'}</h2>
          {error && <div className="err">{error}</div>}
          <form onSubmit={handleLicenseSubmit}>
            <div className="field">
              <label>License Type *</label>
              <input
                type="text"
                value={licenseForm.licenseType}
                onChange={licenseField('licenseType')}
                placeholder="e.g. General Contractor License"
                required
              />
            </div>
            <div className="two">
              <div className="field">
                <label>License Number</label>
                <input type="text" value={licenseForm.licenseNumber} onChange={licenseField('licenseNumber')} placeholder="e.g. GC-123456" />
              </div>
              <div className="field">
                <label>Issuing Authority</label>
                <input type="text" value={licenseForm.issuingAuthority} onChange={licenseField('issuingAuthority')} placeholder="e.g. California CSLB" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Jurisdiction</label>
                <input type="text" value={licenseForm.jurisdiction} onChange={licenseField('jurisdiction')} placeholder="e.g. CA" />
              </div>
              <div className="field">
                <label>Expiry Date *</label>
                <input type="date" value={licenseForm.expiryDate} onChange={licenseField('expiryDate')} required />
              </div>
            </div>
            <div className="field">
              <label>Effective Date</label>
              <input type="date" value={licenseForm.effectiveDate} onChange={licenseField('effectiveDate')} />
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea value={licenseForm.notes} onChange={licenseField('notes')} rows={3} placeholder="Additional notes..." />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn primary" disabled={licenseSubmitting}>
                {licenseSubmitting ? 'Saving...' : editLicense ? 'Save Changes' : 'Add License'}
              </button>
              <button type="button" className="btn" onClick={cancelLicenseForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
