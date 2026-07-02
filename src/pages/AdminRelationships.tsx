/**
 * Admin review queue for grandfathered existing-relationship fees.
 *
 * Lists developer-vendor relationships with full context: developer, vendor,
 * fee rule, confirmation type, supporting doc, who/when confirmed, risk flags,
 * and the audit trail. Admin can approve (grandfather at 2%), reject (standard
 * fee), request more info, override the fee %, dispute, or deactivate.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';
import FeeBadge, { type FeeInfo } from '../components/FeeBadge';

type Rel = {
  id: string;
  developer_company_id: string;
  vendor_company_id: string;
  developer_name?: string;
  vendor_name?: string;
  relationship_status: string;
  admin_review_status: string;
  existing_relationship_type: string | null;
  existing_relationship_confirmed: boolean;
  existing_relationship_confirmed_by: string | null;
  existing_relationship_confirmed_at: string | null;
  existing_relationship_notes: string | null;
  supporting_document_url: string | null;
  grandfathered_fee_percentage: number | string;
  fee_rule_source: string | null;
  admin_notes: string | null;
  updated_at: string;
  fee: FeeInfo;
  risk: { level: 'low' | 'medium' | 'high'; flags: string[] };
};

const FILTERS = ['pending_review', 'needs_more_info', 'approved', 'rejected', ''] as const;
const FILTER_LABEL: Record<string, string> = {
  pending_review: 'Pending review',
  needs_more_info: 'Needs info',
  approved: 'Approved',
  rejected: 'Rejected',
  '': 'All',
};

const riskCls = (l: string) => (l === 'high' ? 'badge b-red' : l === 'medium' ? 'badge b-amber' : 'badge b-neutral');

export default function AdminRelationships() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Rel[]>([]);
  const [filter, setFilter] = useState<string>('pending_review');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const qs = filter ? `?status=${filter}` : '';
      const d = await apiGet<{ relationships: Rel[] }>(`/admin/relationships${qs}`);
      setRows(d.relationships ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load relationships.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, filter]);

  async function openDetail(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    try {
      const d = await apiGet<any>(`/admin/relationships/${id}`);
      setDetail((m) => ({ ...m, [id]: d }));
    } catch (e: any) { setErr(e.message ?? 'Could not load detail.'); }
  }

  async function act(id: string, path: string, body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/admin/relationships/${id}/${path}`, body);
      await load();
      if (openId === id) { const d = await apiGet<any>(`/admin/relationships/${id}`); setDetail((m) => ({ ...m, [id]: d })); }
    } catch (e: any) { setErr(e.message ?? 'Action failed.'); }
    finally { setBusy(false); }
  }

  if (!isAdmin) return <div className="card">Admins only.</div>;

  return (
    <>
      <div className="page-head"><div>
        <h1>Existing-Relationship Fees</h1>
        <div className="sub">Review developer attestations that a vendor relationship pre-existed Divini Procure. Approving grandfathers that specific developer-vendor pair at 2% forever. The 2% is never applied automatically.</div>
      </div></div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f || 'all'} className={`btn${filter === f ? ' primary' : ''}`} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th></th><th>Developer</th><th>Vendor</th><th>Type</th><th>Fee rule</th><th>Risk</th><th>Review</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="note" style={{ padding: 14 }}>Nothing here.</td></tr>
              : rows.map((r) => (
                <>
                  <tr key={r.id}>
                    <td><button className="btn" onClick={() => openDetail(r.id)}>{openId === r.id ? '▾' : '▸'}</button></td>
                    <td><strong>{r.developer_name}</strong></td>
                    <td>{r.vendor_name}</td>
                    <td className="note">{r.existing_relationship_type ?? '-'}</td>
                    <td><FeeBadge fee={r.fee} relationship={r} audience="admin" /></td>
                    <td><span className={riskCls(r.risk?.level)}>{r.risk?.level ?? 'low'}</span></td>
                    <td className="note">{r.admin_review_status}</td>
                  </tr>
                  {openId === r.id && (
                    <tr key={r.id + '-d'}>
                      <td></td>
                      <td colSpan={6}>
                        <RelDetail rel={r} d={detail[r.id]} busy={busy} act={act} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RelDetail({ rel, d, busy, act }: {
  rel: Rel;
  d: any;
  busy: boolean;
  act: (id: string, path: string, body: Record<string, unknown>) => void;
}) {
  const [notes, setNotes] = useState('');
  const [overridePct, setOverridePct] = useState('2');
  const audit: any[] = d?.audit ?? [];

  return (
    <div style={{ padding: '10px 4px 16px' }}>
      {rel.risk?.flags?.length > 0 && (
        <div className="err" style={{ marginBottom: 10 }}>
          {rel.risk.flags.map((f, i) => <div key={i}>• {f}</div>)}
        </div>
      )}

      <div className="two" style={{ gap: 14 }}>
        <div>
          <div className="note">Confirmation type</div>
          <div>{rel.existing_relationship_type ?? '-'}</div>
          <div className="note" style={{ marginTop: 8 }}>Notes</div>
          <div>{rel.existing_relationship_notes || '-'}</div>
          <div className="note" style={{ marginTop: 8 }}>Supporting document</div>
          <div>{rel.supporting_document_url ? <a href={rel.supporting_document_url} target="_blank" rel="noreferrer">View document</a> : 'None uploaded'}</div>
        </div>
        <div>
          <div className="note">Confirmed by</div>
          <div>{rel.existing_relationship_confirmed_by ?? '-'}</div>
          <div className="note" style={{ marginTop: 8 }}>Confirmed at</div>
          <div>{rel.existing_relationship_confirmed_at ? new Date(rel.existing_relationship_confirmed_at).toLocaleString() : '-'}</div>
          <div className="note" style={{ marginTop: 8 }}>Fee rule source</div>
          <div>{rel.fee_rule_source ?? '-'}</div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Admin notes (saved with your decision)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason / context" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn primary" disabled={busy} onClick={() => act(rel.id, 'review', { decision: 'approve', notes })}>Approve (grandfather 2%)</button>
        <button className="btn" disabled={busy} onClick={() => act(rel.id, 'review', { decision: 'reject', notes })}>Reject (standard fee)</button>
        <button className="btn" disabled={busy} onClick={() => act(rel.id, 'review', { decision: 'needs_more_info', notes })}>Needs more info</button>
        <button className="btn" disabled={busy} onClick={() => act(rel.id, 'dispute', { notes })}>Mark disputed</button>
        <button className="btn" disabled={busy} onClick={() => act(rel.id, 'deactivate', { notes })}>Deactivate</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
        <div className="field" style={{ maxWidth: 120 }}>
          <label>Override fee %</label>
          <input value={overridePct} onChange={(e) => setOverridePct(e.target.value)} type="number" />
        </div>
        <button className="btn" disabled={busy} onClick={() => act(rel.id, 'override', { feePercentage: Number(overridePct), reason: notes })}>Apply override</button>
      </div>

      {audit.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="note" style={{ marginBottom: 6 }}>Audit history</div>
          {audit.map((a) => (
            <div key={a.id} className="note" style={{ fontSize: 12, padding: '3px 0', borderTop: '1px solid var(--line)' }}>
              {new Date(a.created_at).toLocaleString()} · <strong>{a.action}</strong>
              {a.actor_email ? ` · ${a.actor_email}` : ''}
              {a.detail ? ` · ${typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail)}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
