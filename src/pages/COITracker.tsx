/**
 * COITracker -- Insurance certificate tracking page for Divini Procure.
 * Talks to /api/coi (server/src/routes/coi.ts). Styling matches the rest of
 * Procure (card / table / btn / badge / field / two) - see theme.css.
 * Zero em dashes by convention.
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

const emptyForm = {
  certificateType: 'general_liability',
  carrierName: '',
  policyNumber: '',
  coverageAmountCents: '',
  aggregateAmountCents: '',
  effectiveDate: '',
  expiryDate: '',
  notes: '',
};

export default function COITracker() {
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCert, setEditCert] = useState<any | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);
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
      setLoading(false);
    }
  }

  useEffect(() => { fetchCerts(); }, []);

  function openAdd() {
    setEditCert(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function openEdit(cert: any) {
    setEditCert(cert);
    setForm({
      certificateType: cert.certificate_type ?? 'general_liability',
      carrierName: cert.carrier_name ?? '',
      policyNumber: cert.policy_number ?? '',
      coverageAmountCents: cert.coverage_amount_cents != null ? String(Math.round(cert.coverage_amount_cents / 100)) : '',
      aggregateAmountCents: cert.aggregate_amount_cents != null ? String(Math.round(cert.aggregate_amount_cents / 100)) : '',
      effectiveDate: cert.effective_date ? cert.effective_date.slice(0, 10) : '',
      expiryDate: cert.expiry_date ? cert.expiry_date.slice(0, 10) : '',
      notes: cert.notes ?? '',
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditCert(null);
    setForm({ ...emptyForm });
    setError('');
  }

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(f => ({ ...f, [key]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const dollarsToInt = (s: string) => s === '' ? undefined : Math.round(Number(s) * 100);
      const payload: Record<string, unknown> = {
        certificateType: form.certificateType,
        carrierName: form.carrierName || undefined,
        policyNumber: form.policyNumber || undefined,
        coverageAmountCents: dollarsToInt(form.coverageAmountCents),
        aggregateAmountCents: dollarsToInt(form.aggregateAmountCents),
        effectiveDate: form.effectiveDate || undefined,
        expiryDate: form.expiryDate,
        notes: form.notes || undefined,
      };

      let res: Response;
      if (editCert) {
        res = await fetch(`/api/coi/${editCert.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/coi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error ?? 'Save failed');
      }

      setLoading(true);
      await fetchCerts();
      cancelForm();
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  const computed = certs.map(c => ({
    ...c,
    _status: c.computed_status ?? c.status,
  }));

  const activeCount = computed.filter(c => c._status === 'active').length;
  const expiringSoonCount = computed.filter(c => c._status === 'expiring_soon').length;
  const expiredCount = computed.filter(c => c._status === 'expired').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Insurance Tracker</h1>
          <div className="sub">Manage and track certificates of insurance</div>
        </div>
        <button className="btn primary" onClick={openAdd}>+ Add Certificate</button>
      </div>

      {!loading && (
        <div className="grid cards3" style={{ marginBottom: 18 }}>
          <div className="card metric">
            <div className="k">Active</div>
            <div className="v">{activeCount}</div>
          </div>
          <div className="card metric">
            <div className="k">Expiring Soon</div>
            <div className="v">{expiringSoonCount}</div>
          </div>
          <div className="card metric">
            <div className="k">Expired</div>
            <div className="v">{expiredCount}</div>
          </div>
        </div>
      )}

      {!loading && expiringSoonCount > 0 && (
        <div className="badge b-amber" style={{ display: 'block', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          {expiringSoonCount} certificate{expiringSoonCount !== 1 ? 's' : ''} expiring within 30 days
        </div>
      )}

      {error && !showForm && <div className="err">{error}</div>}

      {loading && <div className="note">Loading…</div>}

      {!loading && certs.length === 0 && !showForm && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="note" style={{ marginBottom: 14 }}>
            No insurance certificates on file. Add your first certificate to stay compliant.
          </p>
          <button className="btn primary" onClick={openAdd}>Add Certificate</button>
        </div>
      )}

      {!loading && certs.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Carrier</th>
                <th>Policy #</th>
                <th>Coverage</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {computed.map(cert => (
                <tr key={cert.id}>
                  <td>{formatType(cert.certificate_type)}</td>
                  <td>{cert.carrier_name ?? <span className="note">—</span>}</td>
                  <td>{cert.policy_number ?? <span className="note">—</span>}</td>
                  <td>{formatMoney(cert.coverage_amount_cents)}</td>
                  <td>
                    {cert.expiry_date
                      ? new Date(cert.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : <span className="note">—</span>}
                  </td>
                  <td><StatusBadge status={cert._status} /></td>
                  <td>
                    <button className="btn" onClick={() => openEdit(cert)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>
            {editCert ? 'Edit Certificate' : 'Add Certificate'}
          </h2>

          {error && <div className="err">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Type *</label>
              <select value={form.certificateType} onChange={field('certificateType')} required>
                {CERT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="two">
              <div className="field">
                <label>Carrier Name</label>
                <input
                  type="text"
                  value={form.carrierName}
                  onChange={field('carrierName')}
                  placeholder="e.g. Travelers"
                />
              </div>
              <div className="field">
                <label>Policy Number</label>
                <input
                  type="text"
                  value={form.policyNumber}
                  onChange={field('policyNumber')}
                  placeholder="e.g. GL-123456"
                />
              </div>
            </div>

            <div className="two">
              <div className="field">
                <label>Coverage Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.coverageAmountCents}
                  onChange={field('coverageAmountCents')}
                  placeholder="e.g. 1000000"
                />
              </div>
              <div className="field">
                <label>Aggregate Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.aggregateAmountCents}
                  onChange={field('aggregateAmountCents')}
                  placeholder="e.g. 2000000"
                />
              </div>
            </div>

            <div className="two">
              <div className="field">
                <label>Effective Date</label>
                <input type="date" value={form.effectiveDate} onChange={field('effectiveDate')} />
              </div>
              <div className="field">
                <label>Expiry Date *</label>
                <input type="date" value={form.expiryDate} onChange={field('expiryDate')} required />
              </div>
            </div>

            <div className="field">
              <label>Notes</label>
              <textarea
                value={form.notes}
                onChange={field('notes')}
                rows={3}
                placeholder="Additional notes..."
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn primary" disabled={submitting}>
                {submitting ? 'Saving...' : editCert ? 'Save Changes' : 'Add Certificate'}
              </button>
              <button type="button" className="btn" onClick={cancelForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
