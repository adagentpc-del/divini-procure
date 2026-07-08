/**
 * RetainageDashboard -- retainage tracking and lien waiver management page.
 * Vendors see what's being held from them; developers see what they owe and can approve releases.
 */
import { useEffect, useState } from 'react';

interface RetainageSummary {
  asVendor: { heldCents: number; releasedCents: number; pendingReleaseCount: number };
  asDeveloper: { heldCents: number; releasedCents: number; totalVendors: number };
}

interface RetainageRecord {
  id: string;
  building_id: string;
  package_id: string | null;
  vendor_company_id: string;
  developer_company_id: string;
  vendor_name: string;
  developer_name: string;
  contract_amount_cents: number;
  retainage_pct: string;
  retainage_held_cents: number;
  retainage_released_cents: number;
  status: 'holding' | 'partial_release' | 'fully_released' | 'disputed';
  release_trigger: string | null;
  milestone_required: string | null;
  release_requested_at: string | null;
  release_approved_at: string | null;
  notes: string | null;
  created_at: string;
}

interface LienWaiver {
  id: string;
  retainage_id: string | null;
  building_id: string;
  vendor_company_id: string;
  developer_company_id: string;
  vendor_name: string;
  developer_name: string;
  waiver_type: string;
  through_date: string | null;
  payment_amount_cents: number | null;
  status: 'requested' | 'submitted' | 'accepted' | 'rejected';
  requested_by: string | null;
  notes: string | null;
  created_at: string;
}

interface MeResponse {
  companyId: string;
  email: string;
}

const dollars = (cents: number | null | undefined) =>
  cents == null
    ? '$0'
    : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    holding: 'bg-amber-100 text-amber-800',
    partial_release: 'bg-blue-100 text-blue-800',
    fully_released: 'bg-green-100 text-green-800',
    disputed: 'bg-red-100 text-red-800',
    requested: 'bg-slate-100 text-slate-700',
    submitted: 'bg-blue-100 text-blue-800',
    accepted: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = {
    holding: 'Holding',
    partial_release: 'Partial Release',
    fully_released: 'Fully Released',
    disputed: 'Disputed',
    requested: 'Requested',
    submitted: 'Submitted',
    accepted: 'Accepted',
    rejected: 'Rejected',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-0">
      <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function RetainageDashboard() {
  const [myCompanyId, setMyCompanyId] = useState('');
  const [summary, setSummary] = useState<RetainageSummary | null>(null);
  const [tab, setTab] = useState<'receivables' | 'payables'>('receivables');

  // Receivables (vendor view)
  const [vendorRecords, setVendorRecords] = useState<RetainageRecord[]>([]);
  const [vendorWaivers, setVendorWaivers] = useState<LienWaiver[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);

  // Payables (developer view)
  const [devRecords, setDevRecords] = useState<RetainageRecord[]>([]);
  const [devLoading, setDevLoading] = useState(false);

  // UI state
  const [approveState, setApproveState] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // Add retainage form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    buildingId: '', vendorCompanyId: '', contractAmountCents: '', retainagePct: '10',
    releaseTrigger: '', notes: '',
  });
  const [addLoading, setAddLoading] = useState(false);

  // Lien waiver form
  const [waiverForm, setWaiverForm] = useState<Record<string, { waiverType: string; throughDate: string; paymentAmount: string; notes: string } | null>>({});

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then((d: MeResponse) => setMyCompanyId(d.companyId ?? ''))
      .catch(() => {});

    fetch('/api/me/retainage-summary', { credentials: 'include' })
      .then(r => r.json())
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!myCompanyId) return;
    setVendorLoading(true);
    Promise.all([
      fetch(`/api/retainage?vendorCompanyId=${myCompanyId}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/lien-waivers?vendorCompanyId=${myCompanyId}`, { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([rd, wd]) => {
        setVendorRecords(rd.records ?? []);
        setVendorWaivers(wd.waivers ?? []);
      })
      .catch(e => setErr(e.message))
      .finally(() => setVendorLoading(false));
  }, [myCompanyId]);

  useEffect(() => {
    if (!myCompanyId || tab !== 'payables') return;
    setDevLoading(true);
    fetch(`/api/retainage?developerCompanyId=${myCompanyId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setDevRecords(d.records ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setDevLoading(false));
  }, [myCompanyId, tab]);

  async function requestRelease(id: string) {
    try {
      const res = await fetch(`/api/retainage/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_release' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setVendorRecords(prev => prev.map(r => r.id === id ? { ...r, ...d.record } : r));
      setActionMsg('Release requested.');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function approveRelease(id: string, heldCents: number) {
    const raw = approveState[id] ?? '';
    const cents = Math.round(parseFloat(raw) * 100);
    if (!cents || cents <= 0) { setErr('Enter a valid release amount.'); return; }
    try {
      const res = await fetch(`/api/retainage/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_release', releasedCents: cents }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setDevRecords(prev => prev.map(r => r.id === id ? { ...r, ...d.record } : r));
      setApproveState(prev => { const n = { ...prev }; delete n[id]; return n; });
      setActionMsg('Release approved.');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function requestLienWaiver(record: RetainageRecord) {
    const form = waiverForm[record.id];
    if (!form || !form.waiverType) { setErr('Select a waiver type.'); return; }
    try {
      const res = await fetch('/api/lien-waivers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildingId: record.building_id,
          retainageId: record.id,
          vendorCompanyId: record.vendor_company_id,
          developerCompanyId: record.developer_company_id,
          waiverType: form.waiverType,
          throughDate: form.throughDate || undefined,
          paymentAmountCents: form.paymentAmount ? Math.round(parseFloat(form.paymentAmount) * 100) : undefined,
          notes: form.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setWaiverForm(prev => { const n = { ...prev }; delete n[record.id]; return n; });
      setActionMsg('Lien waiver requested.');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function submitAddForm() {
    if (!addForm.buildingId || !addForm.vendorCompanyId) { setErr('Building ID and Vendor Company ID are required.'); return; }
    setAddLoading(true);
    try {
      const res = await fetch('/api/retainage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildingId: addForm.buildingId,
          vendorCompanyId: addForm.vendorCompanyId,
          developerCompanyId: myCompanyId,
          contractAmountCents: Math.round(parseFloat(addForm.contractAmountCents) * 100),
          retainagePct: parseFloat(addForm.retainagePct),
          releaseTrigger: addForm.releaseTrigger || undefined,
          notes: addForm.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setDevRecords(prev => [d.record, ...prev]);
      setShowAddForm(false);
      setAddForm({ buildingId: '', vendorCompanyId: '', contractAmountCents: '', retainagePct: '10', releaseTrigger: '', notes: '' });
      setActionMsg('Retainage record created.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAddLoading(false);
    }
  }

  const totalHeld = summary
    ? summary.asVendor.heldCents + summary.asDeveloper.heldCents
    : 0;
  const totalReleased = summary
    ? summary.asVendor.releasedCents + summary.asDeveloper.releasedCents
    : 0;
  const pendingCount = summary?.asVendor.pendingReleaseCount ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Retainage &amp; Lien Waivers 💰</h1>
        <p className="text-slate-500 text-sm">Track contract retainage held and lien waiver workflows.</p>
      </div>

      {/* Alerts */}
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm flex justify-between">
          {err}
          <button onClick={() => setErr('')} className="ml-4 font-bold">x</button>
        </div>
      )}
      {actionMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm flex justify-between">
          {actionMsg}
          <button onClick={() => setActionMsg('')} className="ml-4 font-bold">x</button>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <StatCard label="Total Held" value={dollars(totalHeld)} sub="across all records" />
        <StatCard label="Total Released" value={dollars(totalReleased)} sub="approved releases" />
        <StatCard label="Pending Releases" value={String(pendingCount)} sub="awaiting approval" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(['receivables', 'payables'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-emerald-500 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'receivables' ? 'My Receivables' : 'My Payables'}
          </button>
        ))}
      </div>

      {/* MY RECEIVABLES TAB */}
      {tab === 'receivables' && (
        <div>
          {vendorLoading && <p className="text-slate-400 text-sm">Loading...</p>}
          {!vendorLoading && vendorRecords.length === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-slate-500">No retainage records found where you are the vendor.</p>
            </div>
          )}
          {vendorRecords.map(record => (
            <div key={record.id} className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
              <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Building: {record.building_id}</p>
                  <p className="text-xs text-slate-500">Developer: {record.developer_name ?? record.developer_company_id}</p>
                  {record.package_id && <p className="text-xs text-slate-400">Package: {record.package_id}</p>}
                </div>
                <StatusBadge status={record.status} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Contract</p>
                  <p className="font-medium text-slate-700">{dollars(record.contract_amount_cents)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Retainage %</p>
                  <p className="font-medium text-slate-700">{record.retainage_pct}%</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Held</p>
                  <p className="font-medium text-amber-700">{dollars(record.retainage_held_cents)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Released</p>
                  <p className="font-medium text-green-700">{dollars(record.retainage_released_cents)}</p>
                </div>
              </div>
              {record.milestone_required && (
                <p className="text-xs text-slate-500 mb-2">Milestone: {record.milestone_required}</p>
              )}
              {record.release_requested_at && !record.release_approved_at && (
                <p className="text-xs text-blue-600 mb-2">Release requested {fmtDate(record.release_requested_at)} -- awaiting approval.</p>
              )}
              {record.release_approved_at && (
                <p className="text-xs text-green-600 mb-2">Release approved {fmtDate(record.release_approved_at)}.</p>
              )}
              {!record.release_requested_at && record.status !== 'fully_released' && (
                <button
                  onClick={() => requestRelease(record.id)}
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  Request Release
                </button>
              )}
              <p className="text-xs text-slate-400 mt-2">Created {fmtDate(record.created_at)}</p>
            </div>
          ))}

          {/* Lien Waivers sub-section */}
          <h2 className="text-base font-semibold text-slate-700 mt-8 mb-3">My Lien Waivers</h2>
          {vendorWaivers.length === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
              <p className="text-slate-500 text-sm">No lien waivers found.</p>
            </div>
          )}
          {vendorWaivers.map(w => (
            <div key={w.id} className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
              <div className="flex justify-between items-start flex-wrap gap-2 mb-2">
                <div>
                  <p className="text-sm font-medium text-slate-700 capitalize">{w.waiver_type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-400">Building: {w.building_id}</p>
                </div>
                <StatusBadge status={w.status} />
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                {w.through_date && <span>Through: {w.through_date}</span>}
                {w.payment_amount_cents != null && <span>Amount: {dollars(w.payment_amount_cents)}</span>}
              </div>
              <p className="text-xs text-slate-400 mt-1">Requested {fmtDate(w.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {/* MY PAYABLES TAB */}
      {tab === 'payables' && (
        <div>
          {/* Add retainage button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {showAddForm ? 'Cancel' : '+ Add Retainage Record'}
            </button>
          </div>

          {/* Add retainage form */}
          {showAddForm && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-5">
              <h3 className="font-semibold text-slate-700 mb-3 text-sm">New Retainage Record</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {[
                  { label: 'Building ID', key: 'buildingId', placeholder: 'UUID' },
                  { label: 'Vendor Company ID', key: 'vendorCompanyId', placeholder: 'UUID' },
                  { label: 'Contract Amount ($)', key: 'contractAmountCents', placeholder: '100000' },
                  { label: 'Retainage %', key: 'retainagePct', placeholder: '10' },
                  { label: 'Release Trigger', key: 'releaseTrigger', placeholder: 'e.g. Substantial completion' },
                  { label: 'Notes', key: 'notes', placeholder: 'Optional notes' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      placeholder={placeholder}
                      value={(addForm as any)[key]}
                      onChange={e => setAddForm(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={submitAddForm}
                disabled={addLoading}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {addLoading ? 'Saving...' : 'Create Record'}
              </button>
            </div>
          )}

          {devLoading && <p className="text-slate-400 text-sm">Loading...</p>}
          {!devLoading && devRecords.length === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-slate-500">No retainage records found where you are the developer.</p>
            </div>
          )}
          {devRecords.map(record => (
            <div key={record.id} className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
              <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Building: {record.building_id}</p>
                  <p className="text-xs text-slate-500">Vendor: {record.vendor_name ?? record.vendor_company_id}</p>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Contract</p>
                  <p className="font-medium text-slate-700">{dollars(record.contract_amount_cents)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Retainage %</p>
                  <p className="font-medium text-slate-700">{record.retainage_pct}%</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Held</p>
                  <p className="font-medium text-amber-700">{dollars(record.retainage_held_cents)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Released</p>
                  <p className="font-medium text-green-700">{dollars(record.retainage_released_cents)}</p>
                </div>
              </div>

              {/* Approve release */}
              {record.release_requested_at && !record.release_approved_at && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                  <p className="text-xs text-blue-700 mb-2 font-medium">
                    Release requested {fmtDate(record.release_requested_at)}. Held: {dollars(record.retainage_held_cents)}.
                  </p>
                  <div className="flex gap-2 items-center flex-wrap">
                    <input
                      type="number"
                      placeholder="Release amount ($)"
                      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-40"
                      value={approveState[record.id] ?? ''}
                      onChange={e => setApproveState(prev => ({ ...prev, [record.id]: e.target.value }))}
                    />
                    <button
                      onClick={() => approveRelease(record.id, record.retainage_held_cents)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Approve Release
                    </button>
                  </div>
                </div>
              )}

              {/* Request lien waiver */}
              {waiverForm[record.id] ? (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
                  <p className="text-xs font-medium text-slate-600 mb-2">Request Lien Waiver</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Waiver Type</label>
                      <select
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        value={waiverForm[record.id]?.waiverType ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, waiverType: e.target.value } }))}
                      >
                        <option value="">Select type</option>
                        <option value="conditional_progress">Conditional Progress</option>
                        <option value="unconditional_progress">Unconditional Progress</option>
                        <option value="conditional_final">Conditional Final</option>
                        <option value="unconditional_final">Unconditional Final</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Through Date</label>
                      <input
                        type="date"
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        value={waiverForm[record.id]?.throughDate ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, throughDate: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Payment Amount ($)</label>
                      <input
                        type="number"
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        value={waiverForm[record.id]?.paymentAmount ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, paymentAmount: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Notes</label>
                      <input
                        type="text"
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        value={waiverForm[record.id]?.notes ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, notes: e.target.value } }))}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => requestLienWaiver(record)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Submit Request
                    </button>
                    <button
                      onClick={() => setWaiverForm(prev => { const n = { ...prev }; delete n[record.id]; return n; })}
                      className="text-slate-500 hover:text-slate-700 px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setWaiverForm(prev => ({ ...prev, [record.id]: { waiverType: '', throughDate: '', paymentAmount: '', notes: '' } }))}
                  className="text-xs text-emerald-700 hover:text-emerald-900 underline"
                >
                  Request Lien Waiver
                </button>
              )}

              <p className="text-xs text-slate-400 mt-2">Created {fmtDate(record.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
