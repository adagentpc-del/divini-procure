/**
 * COITracker -- Insurance certificate tracking page for Divini Procure.
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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active' ? 'bg-green-100 text-green-800' :
    status === 'expiring_soon' ? 'bg-amber-100 text-amber-800' :
    status === 'expired' ? 'bg-red-100 text-red-800' :
    'bg-gray-100 text-gray-600';
  const label =
    status === 'active' ? 'Active' :
    status === 'expiring_soon' ? 'Expiring Soon' :
    status === 'expired' ? 'Expired' :
    'Suspended';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
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
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <span className="mr-2">🛡️</span>Insurance Tracker
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage and track certificates of insurance
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          + Add Certificate
        </button>
      </div>

      {/* Stat cards */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700 font-medium">Active</p>
            <p className="text-3xl font-bold text-green-800">{activeCount}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-700 font-medium">Expiring Soon</p>
            <p className="text-3xl font-bold text-amber-800">{expiringSoonCount}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700 font-medium">Expired</p>
            <p className="text-3xl font-bold text-red-800">{expiredCount}</p>
          </div>
        </div>
      )}

      {/* Expiry warning banner */}
      {!loading && expiringSoonCount > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-center gap-2">
          <span className="text-amber-500">⚠️</span>
          <span className="text-sm text-amber-800 font-medium">
            {expiringSoonCount} certificate{expiringSoonCount !== 1 ? 's' : ''} expiring within 30 days
          </span>
        </div>
      )}

      {/* Error */}
      {error && !showForm && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && certs.length === 0 && !showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-500 mb-4">
            No insurance certificates on file. Add your first certificate to stay compliant.
          </p>
          <button
            onClick={openAdd}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Add Certificate
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && certs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Type', 'Carrier', 'Policy #', 'Coverage', 'Expiry Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {computed.map(cert => (
                <tr key={cert.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {formatType(cert.certificate_type)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {cert.carrier_name ?? <span className="text-gray-400">&mdash;</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                    {cert.policy_number ?? <span className="text-gray-400">&mdash;</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatMoney(cert.coverage_amount_cents)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {cert.expiry_date
                      ? new Date(cert.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : <span className="text-gray-400">&mdash;</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={cert._status} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(cert)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editCert ? 'Edit Certificate' : 'Add Certificate'}
          </h2>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Type */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                value={form.certificateType}
                onChange={field('certificateType')}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CERT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Carrier */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Carrier Name</label>
              <input
                type="text"
                value={form.carrierName}
                onChange={field('carrierName')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Travelers"
              />
            </div>

            {/* Policy # */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number</label>
              <input
                type="text"
                value={form.policyNumber}
                onChange={field('policyNumber')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. GL-123456"
              />
            </div>

            {/* Coverage */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Coverage Amount ($)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.coverageAmountCents}
                onChange={field('coverageAmountCents')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 1000000"
              />
            </div>

            {/* Aggregate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aggregate Amount ($)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.aggregateAmountCents}
                onChange={field('aggregateAmountCents')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 2000000"
              />
            </div>

            {/* Effective Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
              <input
                type="date"
                value={form.effectiveDate}
                onChange={field('effectiveDate')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Expiry Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date *</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={field('expiryDate')}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Notes */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={field('notes')}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes..."
              />
            </div>

            {/* Actions */}
            <div className="sm:col-span-2 flex gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Saving...' : editCert ? 'Save Changes' : 'Add Certificate'}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
