/**
 * LenderPortal -- developer-facing page for managing draw requests and lender access.
 * Tabs: Draw Requests | Lender Access | History
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Building {
  id: string;
  name: string;
}

interface DrawRequest {
  id: string;
  draw_number: number;
  period_start?: string;
  period_end?: string;
  status: string;
  total_contract_value_cents: number;
  this_draw_cents: number;
  net_draw_cents: number;
  percent_complete?: number;
  submitted_at?: string;
  building_name?: string;
  created_at: string;
}

interface LenderGrant {
  id: string;
  lender_email: string;
  lender_company_name?: string;
  lender_contact_name?: string;
  access_token: string;
  status: string;
  granted_at: string;
  notes?: string;
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';

const STATUS_BADGE: Record<string, string> = {
  draft: 'b-neutral',
  submitted: 'b-blue',
  under_review: 'b-amber',
  approved: 'b-green',
  rejected: 'b-red',
  funded: 'b-emerald',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  funded: 'Funded',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_BADGE[status] ?? 'b-neutral'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function LenderPortal() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'draws' | 'access' | 'history'>('draws');
  const [companyId, setCompanyId] = useState('');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState('');
  const [drawRequests, setDrawRequests] = useState<DrawRequest[]>([]);
  const [grants, setGrants] = useState<LenderGrant[]>([]);
  const [allDraws, setAllDraws] = useState<DrawRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showNewDraw, setShowNewDraw] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState('');

  // New draw form state
  const [newDraw, setNewDraw] = useState({
    periodStart: '', periodEnd: '',
    totalContractValueCents: '', previousDrawsCents: '', thisDrawCents: '',
    retainageHeldCents: '', percentComplete: '', notes: '',
  });
  const [lineItems, setLineItems] = useState<Array<{
    description: string; scheduledValueCents: string; previousBilledCents: string;
    thisPeriodCents: string; completedPct: string;
  }>>([]);

  // Grant form state
  const [newGrant, setNewGrant] = useState({
    lenderEmail: '', lenderCompanyName: '', lenderContactName: '', notes: '',
  });

  const netDraw = (Number(newDraw.thisDrawCents || 0) - Number(newDraw.retainageHeldCents || 0));

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => {
        setCompanyId(d.companyId ?? '');
        return fetch(`/api/buildings?companyId=${d.companyId ?? ''}`);
      })
      .then(r => r.json())
      .then(d => setBuildings(d.buildings ?? []))
      .catch(e => setErr(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedBuilding) return;
    fetch(`/api/draw-requests?buildingId=${selectedBuilding}`)
      .then(r => r.json())
      .then(d => setDrawRequests(d.drawRequests ?? []))
      .catch(() => {});
    fetch(`/api/lender/access?buildingId=${selectedBuilding}`)
      .then(r => r.json())
      .then(d => setGrants(d.grants ?? []))
      .catch(() => {});
  }, [selectedBuilding]);

  useEffect(() => {
    if (tab === 'history' && companyId) {
      fetch(`/api/draw-requests`)
        .then(r => r.json())
        .then(d => setAllDraws(d.drawRequests ?? []))
        .catch(() => {});
    }
  }, [tab, companyId]);

  async function submitDraw(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        buildingId: selectedBuilding,
        periodStart: newDraw.periodStart || undefined,
        periodEnd: newDraw.periodEnd || undefined,
        totalContractValueCents: Math.round(Number(newDraw.totalContractValueCents) * 100),
        previousDrawsCents: Math.round(Number(newDraw.previousDrawsCents) * 100),
        thisDrawCents: Math.round(Number(newDraw.thisDrawCents) * 100),
        retainageHeldCents: Math.round(Number(newDraw.retainageHeldCents) * 100),
        percentComplete: newDraw.percentComplete ? Number(newDraw.percentComplete) : undefined,
        notes: newDraw.notes || undefined,
        lineItems: lineItems.map(li => ({
          description: li.description,
          scheduledValueCents: Math.round(Number(li.scheduledValueCents) * 100),
          previousBilledCents: Math.round(Number(li.previousBilledCents) * 100),
          thisPeriodCents: Math.round(Number(li.thisPeriodCents) * 100),
          storedMaterialsCents: 0,
          completedPct: Number(li.completedPct) || 0,
          retainagePct: 10,
        })),
      };
      const r = await fetch('/api/draw-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Failed to create draw request');
      setDrawRequests(prev => [d.drawRequest, ...prev]);
      setShowNewDraw(false);
      setNewDraw({ periodStart: '', periodEnd: '', totalContractValueCents: '', previousDrawsCents: '', thisDrawCents: '', retainageHeldCents: '', percentComplete: '', notes: '' });
      setLineItems([]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDraw_submit(id: string) {
    const r = await fetch(`/api/draw-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit' }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? 'Failed to submit'); return; }
    setDrawRequests(prev => prev.map(dr => dr.id === id ? d.drawRequest : dr));
  }

  async function grantAccess(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/lender/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId: selectedBuilding, ...newGrant }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Failed to grant access');
      setGrants(prev => [d.grant, ...prev]);
      setShowGrantForm(false);
      setNewGrant({ lenderEmail: '', lenderCompanyName: '', lenderContactName: '', notes: '' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeGrant(id: string) {
    const r = await fetch(`/api/lender/access/${id}`, { method: 'DELETE' });
    if (r.ok) setGrants(prev => prev.map(g => g.id === id ? { ...g, status: 'revoked' } : g));
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/lender-view/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--ink)', opacity: 0.5 }}>Loading...</div>;

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: '0.5rem 1.25rem',
    border: 'none',
    borderBottom: tab === t ? '2px solid var(--emerald)' : '2px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    fontWeight: tab === t ? 700 : 400,
    color: tab === t ? 'var(--emerald)' : 'var(--ink)',
    fontSize: '0.95rem',
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '0.4rem' }}>
          Lender Portal
        </h1>
        <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>
          Manage draw requests and lender access for your projects.
        </p>
      </div>

      {err && (
        <div className="badge b-red" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', display: 'block' }}>
          {err}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', gap: '0.25rem' }}>
        <button style={tabStyle('draws')} onClick={() => setTab('draws')}>Draw Requests</button>
        <button style={tabStyle('access')} onClick={() => setTab('access')}>Lender Access</button>
        <button style={tabStyle('history')} onClick={() => setTab('history')}>History</button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Draw Requests Tab */}
      {/* ------------------------------------------------------------------ */}
      {tab === 'draws' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <select
              value={selectedBuilding}
              onChange={e => setSelectedBuilding(e.target.value)}
              style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.9rem', minWidth: 200 }}
            >
              <option value="">Select a building...</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {selectedBuilding && (
              <button className="btn" onClick={() => setShowNewDraw(!showNewDraw)} style={{ fontSize: '0.875rem' }}>
                {showNewDraw ? 'Cancel' : 'New Draw Request'}
              </button>
            )}
          </div>

          {/* New draw form */}
          {showNewDraw && (
            <div className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem' }}>New Draw Request</h3>
              <form onSubmit={submitDraw}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                  {([
                    ['periodStart', 'Period Start', 'date'],
                    ['periodEnd', 'Period End', 'date'],
                    ['totalContractValueCents', 'Total Contract Value ($)', 'number'],
                    ['previousDrawsCents', 'Previous Draws ($)', 'number'],
                    ['thisDrawCents', 'This Draw ($)', 'number'],
                    ['retainageHeldCents', 'Retainage Held ($)', 'number'],
                    ['percentComplete', '% Complete', 'number'],
                  ] as [keyof typeof newDraw, string, string][]).map(([field, label, type]) => (
                    <label key={field} style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
                      {label}
                      <input
                        type={type}
                        value={newDraw[field]}
                        onChange={e => setNewDraw(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', fontSize: '0.875rem' }}
                        step={type === 'number' ? 'any' : undefined}
                        min={type === 'number' ? '0' : undefined}
                      />
                    </label>
                  ))}
                </div>

                {/* Net draw computed */}
                <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'var(--surface)', borderRadius: 6, fontSize: '0.875rem', color: 'var(--ink)' }}>
                  Net Draw (after retainage): <strong>{dollars(Math.max(0, netDraw * 100))}</strong>
                </div>

                <label style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginBottom: '1rem' }}>
                  Notes
                  <textarea
                    value={newDraw.notes}
                    onChange={e => setNewDraw(prev => ({ ...prev, notes: e.target.value }))}
                    rows={2}
                    style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', fontSize: '0.875rem', resize: 'vertical' }}
                  />
                </label>

                {/* Line items */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>Line Items</h4>
                    <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                      onClick={() => setLineItems(prev => [...prev, { description: '', scheduledValueCents: '', previousBilledCents: '', thisPeriodCents: '', completedPct: '' }])}>
                      Add Row
                    </button>
                  </div>
                  {lineItems.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Description', 'Sched. Value', 'Prev Billed', 'This Period', '% Complete', ''].map(h => (
                              <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: 'var(--ink)', opacity: 0.6, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((li, i) => (
                            <tr key={i}>
                              {(['description', 'scheduledValueCents', 'previousBilledCents', 'thisPeriodCents', 'completedPct'] as const).map(f => (
                                <td key={f} style={{ padding: '0.3rem 0.4rem' }}>
                                  <input
                                    value={li[f]}
                                    onChange={e => setLineItems(prev => prev.map((x, j) => j === i ? { ...x, [f]: e.target.value } : x))}
                                    style={{ width: '100%', padding: '0.3rem', borderRadius: 4, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                                    type={f === 'description' ? 'text' : 'number'}
                                    min={f !== 'description' ? '0' : undefined}
                                    step={f !== 'description' ? 'any' : undefined}
                                  />
                                </td>
                              ))}
                              <td style={{ padding: '0.3rem 0.4rem' }}>
                                <button type="button" onClick={() => setLineItems(prev => prev.filter((_, j) => j !== i))}
                                  style={{ background: 'none', border: 'none', color: 'var(--red, #dc2626)', cursor: 'pointer', fontSize: '0.9rem' }}>
                                  x
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <button type="submit" className="btn" disabled={submitting} style={{ fontSize: '0.875rem' }}>
                  {submitting ? 'Saving...' : 'Create Draw Request'}
                </button>
              </form>
            </div>
          )}

          {/* Draw request cards */}
          {selectedBuilding && drawRequests.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>No draw requests yet for this building.</p>
            </div>
          )}

          {drawRequests.map(dr => (
            <div key={dr.id} className="card" style={{ marginBottom: '1.25rem', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', margin: '0 0 0.2rem' }}>
                    Draw #{dr.draw_number}
                  </h2>
                  {(dr.period_start || dr.period_end) && (
                    <span style={{ fontSize: '0.85rem', color: 'var(--ink)', opacity: 0.55 }}>
                      {fmtDate(dr.period_start)} -- {fmtDate(dr.period_end)}
                    </span>
                  )}
                </div>
                <StatusBadge status={dr.status} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem 1.5rem', marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--ink)' }}>
                <span>Total Contract: <strong>{dollars(dr.total_contract_value_cents)}</strong></span>
                <span>This Draw: <strong>{dollars(dr.this_draw_cents)}</strong></span>
                <span>Net Draw: <strong>{dollars(dr.net_draw_cents)}</strong></span>
                {dr.percent_complete != null && <span>% Complete: <strong>{dr.percent_complete}%</strong></span>}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {dr.submitted_at && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--ink)', opacity: 0.55 }}>
                    Submitted {fmtDate(dr.submitted_at)}
                  </span>
                )}
                {dr.status === 'draft' && (
                  <button className="btn" style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem' }}
                    onClick={() => submitDraw_submit(dr.id)}>
                    Submit
                  </button>
                )}
                <button className="btn" style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  onClick={() => nav(`/lender-portal?drawId=${dr.id}`)}>
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Lender Access Tab */}
      {/* ------------------------------------------------------------------ */}
      {tab === 'access' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <select
              value={selectedBuilding}
              onChange={e => setSelectedBuilding(e.target.value)}
              style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.9rem', minWidth: 200 }}
            >
              <option value="">Select a building...</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {selectedBuilding && (
              <button className="btn" onClick={() => setShowGrantForm(!showGrantForm)} style={{ fontSize: '0.875rem' }}>
                {showGrantForm ? 'Cancel' : 'Grant Access'}
              </button>
            )}
          </div>

          {/* Grant form */}
          {showGrantForm && (
            <div className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem' }}>Grant Lender Access</h3>
              <form onSubmit={grantAccess}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                  {([
                    ['lenderEmail', 'Lender Email *', 'email'],
                    ['lenderCompanyName', 'Company Name', 'text'],
                    ['lenderContactName', 'Contact Name', 'text'],
                  ] as [keyof typeof newGrant, string, string][]).map(([field, label, type]) => (
                    <label key={field} style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
                      {label}
                      <input
                        type={type}
                        value={newGrant[field]}
                        onChange={e => setNewGrant(prev => ({ ...prev, [field]: e.target.value }))}
                        required={field === 'lenderEmail'}
                        style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', fontSize: '0.875rem' }}
                      />
                    </label>
                  ))}
                </div>
                <label style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginBottom: '1rem' }}>
                  Notes
                  <textarea
                    value={newGrant.notes}
                    onChange={e => setNewGrant(prev => ({ ...prev, notes: e.target.value }))}
                    rows={2}
                    style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.35rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', fontSize: '0.875rem', resize: 'vertical' }}
                  />
                </label>
                <button type="submit" className="btn" disabled={submitting} style={{ fontSize: '0.875rem' }}>
                  {submitting ? 'Granting...' : 'Grant Access'}
                </button>
              </form>
            </div>
          )}

          {selectedBuilding && grants.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <p style={{ color: 'var(--ink)', opacity: 0.6, margin: 0 }}>No lender access grants for this building.</p>
            </div>
          )}

          {grants.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                      {['Contact', 'Company', 'Email', 'Granted', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--ink)', opacity: 0.65, fontWeight: 600, fontSize: '0.8rem' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map(g => (
                      <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>{g.lender_contact_name ?? '--'}</td>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>{g.lender_company_name ?? '--'}</td>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>{g.lender_email}</td>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)', opacity: 0.65 }}>{fmtDate(g.granted_at)}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span className={`badge ${g.status === 'active' ? 'b-green' : 'b-neutral'}`}>{g.status}</span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {g.status === 'active' && (
                              <>
                                <button className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                                  onClick={() => copyLink(g.access_token)}>
                                  {copied === g.access_token ? 'Copied!' : 'Copy Link'}
                                </button>
                                <button
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--ink)' }}
                                  onClick={() => revokeGrant(g.id)}>
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* History Tab */}
      {/* ------------------------------------------------------------------ */}
      {tab === 'history' && (
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                    {['Building', 'Draw #', 'Amount', 'Status', 'Date'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--ink)', opacity: 0.65, fontWeight: 600, fontSize: '0.8rem' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allDraws.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--ink)', opacity: 0.5 }}>No draw requests found.</td>
                    </tr>
                  )}
                  {allDraws.map(dr => (
                    <tr key={dr.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>{dr.building_name ?? '--'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>#{dr.draw_number}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>{dollars(dr.this_draw_cents)}</td>
                      <td style={{ padding: '0.75rem 1rem' }}><StatusBadge status={dr.status} /></td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--ink)', opacity: 0.65 }}>{fmtDate(dr.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
