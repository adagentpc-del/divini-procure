/**
 * Developer (buyer) view of Change Orders.
 *
 * A developer picks a project (building), sees its change orders, raises a new
 * one (title, description, cost impact in dollars, schedule impact in days, an
 * investor-approval-required toggle, and an optional document URL), and opens
 * one to advance its status. Cost and schedule impact and the investor approval
 * state are shown throughout, with status badges. Money is stored as integer
 * cents on the server; this page converts dollars <-> cents at the edges.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';
import { getBuildings, getPackages } from '../lib/db';

type ChangeOrder = {
  id: string;
  building_id: string;
  package_id: string | null;
  vendor_company_id: string | null;
  vendor_name?: string | null;
  developer_company_id: string | null;
  co_number: string | null;
  title: string;
  description: string | null;
  cost_impact_cents: number;
  schedule_impact_days: number;
  status: string;
  investor_approval_required: boolean;
  investor_approval_status: string;
  document_url: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  detail: any;
  created_at: string;
};

const STATUS_CLS: Record<string, string> = {
  draft: 'badge b-neutral',
  submitted: 'badge b-amber',
  under_review: 'badge b-amber',
  approved: 'badge b-green',
  rejected: 'badge b-red',
  cancelled: 'badge b-red',
};
const statusCls = (s: string) => STATUS_CLS[s] ?? 'badge b-neutral';

const INVESTOR_CLS: Record<string, string> = {
  not_required: 'badge b-neutral',
  pending: 'badge b-amber',
  approved: 'badge b-green',
  rejected: 'badge b-red',
};
const investorCls = (s: string) => INVESTOR_CLS[s] ?? 'badge b-neutral';

const money = (cents?: number | null) =>
  cents == null
    ? '$0'
    : (Number(cents) / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });

export default function ChangeOrders() {
  const { company } = useAuth();
  const [buildings, setBuildings] = useState<any[]>([]);
  const [buildingId, setBuildingId] = useState<string>('');
  const [packages, setPackages] = useState<any[]>([]);
  const [rows, setRows] = useState<ChangeOrder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ changeOrder: ChangeOrder; audit: AuditRow[]; allowedNext: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  // create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [costDollars, setCostDollars] = useState('');
  const [scheduleDays, setScheduleDays] = useState('');
  const [investorReq, setInvestorReq] = useState(false);
  const [documentUrl, setDocumentUrl] = useState('');
  const [packageId, setPackageId] = useState('');

  // load projects for this developer
  useEffect(() => {
    (async () => {
      if (!company) return;
      try {
        const bs = await getBuildings(company.id);
        setBuildings(bs ?? []);
        if (!buildingId && bs && bs.length) setBuildingId(bs[0].id);
      } catch (e: any) { setErr(e.message ?? 'Could not load projects.'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  // load change orders + packages for the selected project
  async function load() {
    if (!buildingId) { setRows([]); return; }
    try {
      const d = await apiGet<{ changeOrders: ChangeOrder[] }>(`/change-orders?buildingId=${encodeURIComponent(buildingId)}`);
      setRows(d.changeOrders ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load change orders.'); }
    try {
      const pk = await getPackages(buildingId);
      setPackages(pk ?? []);
    } catch { setPackages([]); }
  }
  useEffect(() => { load(); setOpenId(null); setDetail(null); /* eslint-disable-next-line */ }, [buildingId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!buildingId) { setErr('Pick a project first.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      const costCents = costDollars.trim() ? Math.round(parseFloat(costDollars) * 100) : 0;
      const days = scheduleDays.trim() ? parseInt(scheduleDays, 10) : 0;
      await apiSend('POST', '/change-orders', {
        buildingId,
        packageId: packageId || undefined,
        title,
        description,
        costImpactCents: Number.isFinite(costCents) ? costCents : 0,
        scheduleImpactDays: Number.isFinite(days) ? days : 0,
        investorApprovalRequired: investorReq,
        documentUrl: documentUrl || undefined,
      });
      setOk('Change order created.');
      setTitle(''); setDescription(''); setCostDollars(''); setScheduleDays('');
      setInvestorReq(false); setDocumentUrl(''); setPackageId(''); setAdding(false);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create change order.'); }
    finally { setBusy(false); }
  }

  async function openDetail(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setErr(''); setOk('');
    try {
      const d = await apiGet<{ changeOrder: ChangeOrder; audit: AuditRow[]; allowedNext: string[] }>(`/change-orders/${id}`);
      setDetail(d);
    } catch (e: any) { setErr(e.message ?? 'Could not load change order.'); }
  }

  async function advance(id: string, status: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      const d = await apiSend<{ changeOrder: ChangeOrder; investorApprovalPending?: boolean }>('PATCH', `/change-orders/${id}`, { status });
      if (d.investorApprovalPending) {
        setOk('Approved, but investor sign-off is still pending.');
      } else {
        setOk(`Status set to ${status}.`);
      }
      const fresh = await apiGet<{ changeOrder: ChangeOrder; audit: AuditRow[]; allowedNext: string[] }>(`/change-orders/${id}`);
      setDetail(fresh);
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not update status.'); }
    finally { setBusy(false); }
  }

  if (!company) return <div className="note">Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>Change Orders</h1>
        <div className="sub">Raise and track change orders on your projects, with cost and schedule impact and investor approval.</div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card">
        <div className="two">
          <div className="field">
            <label>Project</label>
            <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
              <option value="">Select a project</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!buildingId} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Close' : 'New change order'}
            </button>
          </div>
        </div>

        {adding && (
          <form onSubmit={create} style={{ marginTop: 12 }}>
            <div className="field">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" required />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is changing and why" rows={3} />
            </div>
            <div className="two">
              <div className="field">
                <label>Cost impact ($)</label>
                <input value={costDollars} onChange={(e) => setCostDollars(e.target.value)} type="number" step="0.01" placeholder="0" />
              </div>
              <div className="field">
                <label>Schedule impact (days)</label>
                <input value={scheduleDays} onChange={(e) => setScheduleDays(e.target.value)} type="number" step="1" placeholder="0" />
              </div>
            </div>
            <div className="field">
              <label>Package (optional)</label>
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">None</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.title ?? p.name ?? p.id}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Document URL (optional)</label>
              <input value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://…" />
            </div>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={investorReq} onChange={(e) => setInvestorReq(e.target.checked)} />
              <span>Investor approval required</span>
            </label>
            <button className="btn primary" disabled={busy || !title.trim()} type="submit">Create change order</button>
          </form>
        )}
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Title</th><th>Vendor</th><th>Cost impact</th><th>Schedule</th><th>Status</th><th>Investor</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{c.vendor_name ?? '-'}</td>
                <td>{money(c.cost_impact_cents)}</td>
                <td>{c.schedule_impact_days} d</td>
                <td><span className={statusCls(c.status)}>{c.status}</span></td>
                <td>
                  {c.investor_approval_required
                    ? <span className={investorCls(c.investor_approval_status)}>{c.investor_approval_status}</span>
                    : <span className="note">n/a</span>}
                </td>
                <td><button className="btn" onClick={() => openDetail(c.id)}>{openId === c.id ? 'Close' : 'Open'}</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7}><span className="note">No change orders for this project yet.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {openId && detail && (
        <div className="card">
          <div className="page-head">
            <h1 style={{ fontSize: 20 }}>{detail.changeOrder.title}</h1>
            <div className="sub">
              <span className={statusCls(detail.changeOrder.status)}>{detail.changeOrder.status}</span>
              {detail.changeOrder.investor_approval_required && (
                <> &nbsp;Investor: <span className={investorCls(detail.changeOrder.investor_approval_status)}>{detail.changeOrder.investor_approval_status}</span></>
              )}
            </div>
          </div>

          {detail.changeOrder.description && (
            <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{detail.changeOrder.description}</p>
          )}
          <div className="two">
            <div className="note">Cost impact: <strong>{money(detail.changeOrder.cost_impact_cents)}</strong></div>
            <div className="note">Schedule impact: <strong>{detail.changeOrder.schedule_impact_days} days</strong></div>
          </div>
          {detail.changeOrder.document_url && (
            <p className="note"><a href={detail.changeOrder.document_url} target="_blank" rel="noreferrer">View attached document</a></p>
          )}

          {detail.allowedNext.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3>Advance status</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.allowedNext.map((s) => (
                  <button key={s} className="btn" disabled={busy} onClick={() => advance(openId, s)}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <h3>Activity</h3>
            <table className="table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead>
              <tbody>
                {detail.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.actor_email ?? '-'}</td>
                    <td>{a.action.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
                {detail.audit.length === 0 && (
                  <tr><td colSpan={3}><span className="note">No activity yet.</span></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
