/**
 * RetainageDashboard -- retainage tracking and lien waiver management page.
 * Vendors see what's being held from them; developers see what they owe and
 * can approve releases. Talks to /api/retainage + /api/lien-waivers
 * (server/src/routes/retainage.ts). Styling matches the rest of Procure
 * (card / table / btn / badge / field / two) - see theme.css.
 * Zero em dashes by convention.
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
  invoice_id: string | null;
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
  invoice_status: string | null;
  invoice_number: string | null;
  paymentConfirmed: boolean;
  signature_signer_name: string | null;
  signature_signed_at: string | null;
}

interface MeResponse {
  company: { id: string } | null;
}

const dollars = (cents: number | null | undefined) =>
  cents == null
    ? '$0'
    : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_BADGE: Record<string, string> = {
  holding: 'badge b-amber',
  partial_release: 'badge b-amber',
  fully_released: 'badge b-green',
  disputed: 'badge b-red',
  requested: 'badge b-neutral',
  submitted: 'badge b-amber',
  accepted: 'badge b-green',
  rejected: 'badge b-red',
};

const STATUS_LABELS: Record<string, string> = {
  holding: 'Holding',
  partial_release: 'Partial Release',
  fully_released: 'Fully Released',
  disputed: 'Disputed',
  requested: 'Requested',
  submitted: 'Submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={STATUS_BADGE[status] ?? 'badge b-neutral'}>{STATUS_LABELS[status] ?? status}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card metric" style={{ flex: 1, minWidth: 0 }}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="d">{sub}</div>}
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

  // Lien waiver e-signature
  const [signForm, setSignForm] = useState<Record<string, { signerName: string; signatureText: string; affirm: boolean } | null>>({});
  const [signLoading, setSignLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then((d: MeResponse) => setMyCompanyId(d.company?.id ?? ''))
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

  async function signWaiver(waiverId: string) {
    const form = signForm[waiverId];
    if (!form || !form.signerName.trim() || !form.signatureText.trim() || !form.affirm) {
      setErr('Enter your name, type your signature, and check the affirmation box.');
      return;
    }
    setSignLoading(prev => ({ ...prev, [waiverId]: true }));
    try {
      const res = await fetch(`/api/lien-waivers/${waiverId}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: form.signerName.trim(), signatureText: form.signatureText.trim(), affirm: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to sign');
      setVendorWaivers(prev => prev.map(w => w.id === waiverId ? { ...w, ...d.waiver, signature_signer_name: d.signature.signer_name, signature_signed_at: d.signature.signed_at } : w));
      setSignForm(prev => { const n = { ...prev }; delete n[waiverId]; return n; });
      setActionMsg('Lien waiver signed.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSignLoading(prev => ({ ...prev, [waiverId]: false }));
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
    <div>
      <div className="page-head">
        <div>
          <h1>Retainage &amp; Lien Waivers</h1>
          <div className="sub">Track contract retainage held and lien waiver workflows.</div>
        </div>
      </div>

      {err && (
        <div className="err" style={{ display: 'flex', justifyContent: 'space-between' }}>
          {err}
          <button onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>×</button>
        </div>
      )}
      {actionMsg && (
        <div className="ok" style={{ display: 'flex', justifyContent: 'space-between' }}>
          {actionMsg}
          <button onClick={() => setActionMsg('')} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>×</button>
        </div>
      )}

      <div className="grid cards3" style={{ marginBottom: 18 }}>
        <StatCard label="Total Held" value={dollars(totalHeld)} sub="across all records" />
        <StatCard label="Total Released" value={dollars(totalReleased)} sub="approved releases" />
        <StatCard label="Pending Releases" value={String(pendingCount)} sub="awaiting approval" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--line)' }}>
        {(['receivables', 'payables'] as const).map(t => (
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
              textTransform: 'capitalize',
            }}
          >
            {t === 'receivables' ? 'My Receivables' : 'My Payables'}
          </button>
        ))}
      </div>

      {/* MY RECEIVABLES TAB */}
      {tab === 'receivables' && (
        <div>
          {vendorLoading && <div className="note">Loading...</div>}
          {!vendorLoading && vendorRecords.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <p className="note">No retainage records found where you are the vendor.</p>
            </div>
          )}
          {vendorRecords.map(record => (
            <div key={record.id} className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>Building: {record.building_id}</div>
                  <div className="note">Developer: {record.developer_name ?? record.developer_company_id}</div>
                  {record.package_id && <div className="note">Package: {record.package_id}</div>}
                </div>
                <StatusBadge status={record.status} />
              </div>
              <div className="grid cards3" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 10, gap: 10 }}>
                <div>
                  <div className="note">Contract</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{dollars(record.contract_amount_cents)}</div>
                </div>
                <div>
                  <div className="note">Retainage %</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{record.retainage_pct}%</div>
                </div>
                <div>
                  <div className="note">Held</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--amber)' }}>{dollars(record.retainage_held_cents)}</div>
                </div>
                <div>
                  <div className="note">Released</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--green)' }}>{dollars(record.retainage_released_cents)}</div>
                </div>
              </div>
              {record.milestone_required && (
                <div className="note" style={{ marginBottom: 8 }}>Milestone: {record.milestone_required}</div>
              )}
              {record.release_requested_at && !record.release_approved_at && (
                <div className="note" style={{ marginBottom: 8 }}>Release requested {fmtDate(record.release_requested_at)}, awaiting approval.</div>
              )}
              {record.release_approved_at && (
                <div className="note" style={{ marginBottom: 8, color: 'var(--green)' }}>Release approved {fmtDate(record.release_approved_at)}.</div>
              )}
              {!record.release_requested_at && record.status !== 'fully_released' && (
                <button onClick={() => requestRelease(record.id)} className="btn primary">Request Release</button>
              )}
              <div className="note" style={{ marginTop: 8 }}>Created {fmtDate(record.created_at)}</div>
            </div>
          ))}

          {/* Lien Waivers sub-section */}
          <div className="sectitle" style={{ marginTop: 30 }}>My Lien Waivers</div>
          {vendorWaivers.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 24 }}>
              <p className="note">No lien waivers found.</p>
            </div>
          )}
          {vendorWaivers.map(w => (
            <div key={w.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, textTransform: 'capitalize' }}>{w.waiver_type.replace(/_/g, ' ')}</div>
                  <div className="note">Building: {w.building_id}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {w.invoice_id && (
                    <span className={w.paymentConfirmed ? 'badge b-green' : 'badge b-neutral'}>
                      {w.paymentConfirmed ? 'Payment confirmed' : 'Payment not yet confirmed'}
                    </span>
                  )}
                  <StatusBadge status={w.status} />
                </div>
              </div>
              <div className="note" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {w.through_date && <span>Through: {w.through_date}</span>}
                {w.payment_amount_cents != null && <span>Amount: {dollars(w.payment_amount_cents)}</span>}
                {w.invoice_number && <span>Invoice: {w.invoice_number}</span>}
              </div>
              <div className="note" style={{ marginTop: 4 }}>Requested {fmtDate(w.created_at)}</div>

              {w.status === 'submitted' || w.status === 'accepted' ? (
                w.signature_signer_name && (
                  <div className="note" style={{ marginTop: 8, color: 'var(--green)' }}>
                    Signed by {w.signature_signer_name}{w.signature_signed_at ? ` on ${fmtDate(w.signature_signed_at)}` : ''}.
                  </div>
                )
              ) : w.status === 'requested' ? (
                signForm[w.id] ? (
                  <div className="card" style={{ background: 'var(--ivory)', marginTop: 10 }}>
                    <div className="note" style={{ marginBottom: 8, fontWeight: 600 }}>Sign Lien Waiver</div>
                    <div className="two">
                      <div className="field">
                        <label>Your Full Name</label>
                        <input
                          type="text"
                          value={signForm[w.id]?.signerName ?? ''}
                          onChange={e => setSignForm(prev => ({ ...prev, [w.id]: { ...prev[w.id]!, signerName: e.target.value } }))}
                        />
                      </div>
                      <div className="field">
                        <label>Type Your Signature</label>
                        <input
                          type="text"
                          value={signForm[w.id]?.signatureText ?? ''}
                          onChange={e => setSignForm(prev => ({ ...prev, [w.id]: { ...prev[w.id]!, signatureText: e.target.value } }))}
                        />
                      </div>
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={signForm[w.id]?.affirm ?? false}
                        onChange={e => setSignForm(prev => ({ ...prev, [w.id]: { ...prev[w.id]!, affirm: e.target.checked } }))}
                      />
                      I affirm this signature is legally binding and this waiver is accurate.
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => signWaiver(w.id)} disabled={!!signLoading[w.id]} className="btn primary">
                        {signLoading[w.id] ? 'Signing...' : 'Sign & Submit'}
                      </button>
                      <button
                        onClick={() => setSignForm(prev => { const n = { ...prev }; delete n[w.id]; return n; })}
                        className="btn"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setSignForm(prev => ({ ...prev, [w.id]: { signerName: '', signatureText: '', affirm: false } }))}
                    className="btn primary"
                    style={{ marginTop: 8 }}
                  >
                    Sign Waiver
                  </button>
                )
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* MY PAYABLES TAB */}
      {tab === 'payables' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button onClick={() => setShowAddForm(!showAddForm)} className="btn primary">
              {showAddForm ? 'Cancel' : '+ Add Retainage Record'}
            </button>
          </div>

          {showAddForm && (
            <div className="card" style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>New Retainage Record</h3>
              <div className="two">
                {[
                  { label: 'Building ID', key: 'buildingId', placeholder: 'UUID' },
                  { label: 'Vendor Company ID', key: 'vendorCompanyId', placeholder: 'UUID' },
                  { label: 'Contract Amount ($)', key: 'contractAmountCents', placeholder: '100000' },
                  { label: 'Retainage %', key: 'retainagePct', placeholder: '10' },
                  { label: 'Release Trigger', key: 'releaseTrigger', placeholder: 'e.g. Substantial completion' },
                  { label: 'Notes', key: 'notes', placeholder: 'Optional notes' },
                ].map(({ label, key, placeholder }) => (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <input
                      placeholder={placeholder}
                      value={(addForm as any)[key]}
                      onChange={e => setAddForm(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <button onClick={submitAddForm} disabled={addLoading} className="btn primary">
                {addLoading ? 'Saving...' : 'Create Record'}
              </button>
            </div>
          )}

          {devLoading && <div className="note">Loading...</div>}
          {!devLoading && devRecords.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <p className="note">No retainage records found where you are the developer.</p>
            </div>
          )}
          {devRecords.map(record => (
            <div key={record.id} className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>Building: {record.building_id}</div>
                  <div className="note">Vendor: {record.vendor_name ?? record.vendor_company_id}</div>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <div className="grid cards3" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 10, gap: 10 }}>
                <div>
                  <div className="note">Contract</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{dollars(record.contract_amount_cents)}</div>
                </div>
                <div>
                  <div className="note">Retainage %</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{record.retainage_pct}%</div>
                </div>
                <div>
                  <div className="note">Held</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--amber)' }}>{dollars(record.retainage_held_cents)}</div>
                </div>
                <div>
                  <div className="note">Released</div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--green)' }}>{dollars(record.retainage_released_cents)}</div>
                </div>
              </div>

              {/* Approve release */}
              {record.release_requested_at && !record.release_approved_at && (
                <div className="card" style={{ background: 'var(--ivory)', marginBottom: 10 }}>
                  <div className="note" style={{ marginBottom: 8, fontWeight: 600 }}>
                    Release requested {fmtDate(record.release_requested_at)}. Held: {dollars(record.retainage_held_cents)}.
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      placeholder="Release amount ($)"
                      style={{ width: 160 }}
                      value={approveState[record.id] ?? ''}
                      onChange={e => setApproveState(prev => ({ ...prev, [record.id]: e.target.value }))}
                    />
                    <button onClick={() => approveRelease(record.id, record.retainage_held_cents)} className="btn primary">
                      Approve Release
                    </button>
                  </div>
                </div>
              )}

              {/* Request lien waiver */}
              {waiverForm[record.id] ? (
                <div className="card" style={{ background: 'var(--ivory)', marginBottom: 8 }}>
                  <div className="note" style={{ marginBottom: 8, fontWeight: 600 }}>Request Lien Waiver</div>
                  <div className="two">
                    <div className="field">
                      <label>Waiver Type</label>
                      <select
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
                    <div className="field">
                      <label>Through Date</label>
                      <input
                        type="date"
                        value={waiverForm[record.id]?.throughDate ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, throughDate: e.target.value } }))}
                      />
                    </div>
                    <div className="field">
                      <label>Payment Amount ($)</label>
                      <input
                        type="number"
                        value={waiverForm[record.id]?.paymentAmount ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, paymentAmount: e.target.value } }))}
                      />
                    </div>
                    <div className="field">
                      <label>Notes</label>
                      <input
                        type="text"
                        value={waiverForm[record.id]?.notes ?? ''}
                        onChange={e => setWaiverForm(prev => ({ ...prev, [record.id]: { ...prev[record.id]!, notes: e.target.value } }))}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => requestLienWaiver(record)} className="btn primary">Submit Request</button>
                    <button
                      onClick={() => setWaiverForm(prev => { const n = { ...prev }; delete n[record.id]; return n; })}
                      className="btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setWaiverForm(prev => ({ ...prev, [record.id]: { waiverType: '', throughDate: '', paymentAmount: '', notes: '' } }))}
                  className="btn"
                >
                  Request Lien Waiver
                </button>
              )}

              <div className="note" style={{ marginTop: 8 }}>Created {fmtDate(record.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
