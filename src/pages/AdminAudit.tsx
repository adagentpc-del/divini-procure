/**
 * Unified admin audit feed. Pulls every existing audit table into a single
 * normalized stream (source, action, actor, subject, when, detail), newest
 * first. Filter by action; refresh on demand.
 *
 * Admin-only surface.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet } from '../lib/api';

type Entry = {
  source: string;
  action: string | null;
  actor_email: string | null;
  subject: string | null;
  detail: string | null;
  created_at: string;
};

type Feed = { entries: Entry[]; sources: string[]; present: string[] };

const SOURCE_LABEL: Record<string, string> = {
  dvr_audit_log: 'Relationship fee',
  change_order_audit: 'Change order',
  fee_rule_audit: 'Fee rule',
  investment_audit_log: 'Investment',
};

export default function AdminAudit() {
  const { isAdmin } = useFeatures();
  const [feed, setFeed] = useState<Feed>({ entries: [], sources: [], present: [] });
  const [action, setAction] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setErr('');
    try {
      const qs = appliedAction ? `?action=${encodeURIComponent(appliedAction)}` : '';
      const d = await apiGet<Feed>(`/admin/audit${qs}`);
      setFeed(d);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load audit feed.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, appliedAction]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit Feed</h1>
          <div className="sub">Unified, newest-first activity across every audit trail on the platform. Tables that do not exist yet are skipped.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
          <label>Filter by action</label>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="exact action, e.g. approved"
            onKeyDown={(e) => { if (e.key === 'Enter') setAppliedAction(action.trim()); }}
          />
        </div>
        <button className="btn primary" disabled={busy} onClick={() => setAppliedAction(action.trim())}>Apply filter</button>
        {appliedAction && (
          <button className="btn" disabled={busy} onClick={() => { setAction(''); setAppliedAction(''); }}>Clear</button>
        )}
        <button className="btn" disabled={busy} onClick={load}>Refresh</button>
        <span className="note" style={{ marginLeft: 'auto' }}>
          {feed.present.length} of {feed.sources.length} trails present · {feed.entries.length} entries
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Source</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Subject</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {feed.entries.length === 0 ? (
              <tr><td colSpan={6} className="note" style={{ padding: 14 }}>No audit entries.</td></tr>
            ) : (
              feed.entries.map((e, i) => (
                <tr key={`${e.source}-${e.created_at}-${i}`}>
                  <td className="note" style={{ whiteSpace: 'nowrap' }}>{e.created_at ? new Date(e.created_at).toLocaleString() : '-'}</td>
                  <td><span className="badge">{SOURCE_LABEL[e.source] ?? e.source}</span></td>
                  <td><strong>{e.action ?? '-'}</strong></td>
                  <td className="note">{e.actor_email ?? '-'}</td>
                  <td className="note">{e.subject ? e.subject.slice(0, 28) : '-'}</td>
                  <td className="note" style={{ fontSize: 12, maxWidth: 320, overflowWrap: 'anywhere' }}>{e.detail ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
