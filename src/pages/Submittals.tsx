/**
 * Submittal & Approval management for a procurement package. Route:
 *   /package/:id/submittals
 *
 * Lists the package's submittals (title, type, status badge), offers a create
 * form, and per submittal a transition control (dropdown of the next valid
 * statuses + optional comments) alongside a vertical history timeline (status,
 * actor, date, comments). Talks to /api/submittals* (server/src/routes/
 * submittals.ts). Styling matches the rest of Procure (card / table / btn /
 * badge / field). Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getPackage } from '../lib/db';
import { apiGet, apiSend } from '../lib/api';

type Submittal = {
  id: string;
  package_id: string;
  line_item_id: string | null;
  vendor_company_id: string | null;
  vendor_name?: string | null;
  title: string;
  type: string | null;
  current_status: string;
  history_count?: number;
  created_at: string;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  submittal_id: string;
  status: string | null;
  actor: string | null;
  comments: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  review: 'In review',
  revision_required: 'Revision required',
  approved: 'Approved',
  ordered: 'Ordered',
  delivered: 'Delivered',
  installed: 'Installed',
  closed: 'Closed',
};

// Map a status to a Procure badge tone (uses the same badge classes as the app).
function badgeClass(status: string): string {
  switch (status) {
    case 'approved':
    case 'installed':
    case 'closed':
      return 'badge b-green';
    case 'revision_required':
      return 'badge b-red';
    case 'review':
    case 'submitted':
      return 'badge b-amber';
    default:
      return 'badge b-neutral';
  }
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function Submittals() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company } = useAuth();

  const [p, setP] = useState<any>(null);
  const [rows, setRows] = useState<Submittal[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // Create form state.
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);

  // Per submittal expansion: id -> { history, allowedNext, toStatus, comments }.
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [allowedNext, setAllowedNext] = useState<string[]>([]);
  const [toStatus, setToStatus] = useState('');
  const [comments, setComments] = useState('');
  const [moving, setMoving] = useState(false);

  const isOwner = company && p && p.building?.company_id === company.id;

  async function loadList() {
    if (!id) return;
    const { submittals } = await apiGet<{ submittals: Submittal[] }>(
      `/submittals/${encodeURIComponent(id)}`,
    );
    setRows(submittals);
  }

  async function load() {
    if (!id) return;
    try {
      const pk = await getPackage(id);
      setP(pk);
      await loadList();
    } catch (e: any) {
      setErr(e.message ?? 'Could not load submittals.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function createSubmittal(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    setCreating(true);
    setErr('');
    setMsg('');
    try {
      await apiSend('POST', '/submittals', {
        packageId: id,
        title: title.trim(),
        type: type.trim() || undefined,
        // When the current user is a vendor (not the owner), assign the
        // submittal to their company so they retain access to it.
        vendorCompanyId: !isOwner && company ? company.id : undefined,
      });
      setTitle('');
      setType('');
      setMsg('Submittal created.');
      await loadList();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create submittal.');
    } finally {
      setCreating(false);
    }
  }

  async function openSubmittal(sid: string) {
    if (openId === sid) {
      setOpenId(null);
      return;
    }
    setErr('');
    setMsg('');
    try {
      const data = await apiGet<{
        submittal: Submittal;
        history: HistoryRow[];
        allowedNext: string[];
      }>(`/submittals/item/${encodeURIComponent(sid)}`);
      setOpenId(sid);
      setHistory(data.history);
      setAllowedNext(data.allowedNext);
      setToStatus(data.allowedNext[0] ?? '');
      setComments('');
    } catch (e: any) {
      setErr(e.message ?? 'Could not load submittal.');
    }
  }

  async function transition(sid: string) {
    if (!toStatus) return;
    setMoving(true);
    setErr('');
    setMsg('');
    try {
      await apiSend('POST', `/submittals/${encodeURIComponent(sid)}/transition`, {
        toStatus,
        comments: comments.trim() || undefined,
      });
      setMsg('Status updated.');
      // Refresh both the timeline and the list status badge.
      const data = await apiGet<{
        submittal: Submittal;
        history: HistoryRow[];
        allowedNext: string[];
      }>(`/submittals/item/${encodeURIComponent(sid)}`);
      setHistory(data.history);
      setAllowedNext(data.allowedNext);
      setToStatus(data.allowedNext[0] ?? '');
      setComments('');
      await loadList();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update status.');
    } finally {
      setMoving(false);
    }
  }

  if (!p) return <div className="note">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <a
            className="note"
            style={{ cursor: 'pointer' }}
            onClick={() => nav('/package/' + p.id)}
          >
            ← Back to package
          </a>
          <h1>Submittals &amp; approvals</h1>
          <div className="sub">
            {p.category} · {p.building?.name} · {p.building?.location ?? ''}
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {/* Create a submittal */}
      <div className="sectitle">Create a submittal</div>
      <form onSubmit={createSubmittal} className="card">
        <div className="two">
          <div className="field">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lobby millwork shop drawings"
            />
          </div>
          <div className="field">
            <label>Type (optional)</label>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. shop drawing, product data, sample"
            />
          </div>
        </div>
        <button className="btn primary" disabled={creating}>
          {creating ? 'Creating…' : '+ Create submittal'}
        </button>
        <span className="note" style={{ marginLeft: 10 }}>
          New submittals start in Draft and move through the approval lifecycle.
        </span>
      </form>

      {/* Submittal list */}
      <div className="sectitle">Submittals ({rows.length})</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="note" style={{ padding: 14 }}>
                  No submittals yet.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td>{s.type || '-'}</td>
                  <td>{s.vendor_name || '-'}</td>
                  <td>
                    <span className={badgeClass(s.current_status)}>
                      {STATUS_LABEL[s.current_status] ?? s.current_status}
                    </span>
                  </td>
                  <td className="note">{fmt(s.updated_at)}</td>
                  <td>
                    <button className="btn" onClick={() => openSubmittal(s.id)}>
                      {openId === s.id ? 'Hide' : 'Manage'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded: transition control + history timeline */}
      {openId && (
        <>
          <div className="sectitle">Manage submittal</div>
          <div className="card">
            <div className="two">
              <div className="field">
                <label>Move to status</label>
                {allowedNext.length === 0 ? (
                  <div className="note">No further transitions available.</div>
                ) : (
                  <select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                    {allowedNext.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABEL[st] ?? st}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="field">
                <label>Comments (optional)</label>
                <input
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Reason for the status change"
                />
              </div>
            </div>
            <button
              className="btn primary"
              disabled={moving || allowedNext.length === 0 || !toStatus}
              onClick={() => transition(openId)}
            >
              {moving ? 'Updating…' : 'Apply status change'}
            </button>
          </div>

          <div className="sectitle">History</div>
          <div className="card">
            {history.length === 0 ? (
              <div className="note">No history yet.</div>
            ) : (
              <div>
                {history.map((row, i) => (
                  <div
                    key={row.id}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '12px 0',
                      borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <div style={{ minWidth: 150 }}>
                      <span className={badgeClass(row.status ?? '')}>
                        {STATUS_LABEL[row.status ?? ''] ?? row.status}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {row.actor || 'system'}
                      </div>
                      <div className="note">{fmt(row.created_at)}</div>
                      {row.comments && (
                        <div style={{ marginTop: 4, fontSize: 13.5 }}>{row.comments}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
