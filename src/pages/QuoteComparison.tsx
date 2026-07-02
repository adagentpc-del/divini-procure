import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiSend } from '../lib/api';

// ---- shapes returned by GET /quotes/compare/:packageId ----------------------
type LineItem = { id: string; name: string; qty: number; unit_price_cents: number; amount_cents: number };
type CompareBid = {
  id: string;
  vendor_company: string;
  total_cents: number;
  lead_time_days: number | null;
  freight_cents: number | null;
  warranty_text: string | null;
  install_cents: number | null;
  scope_notes: string | null;
  notes: string | null;
  line_items: LineItem[];
};
type RankRow = { bid_id: string; score: number; rank: number; dimensions: { price: number; speed: number; scope: number } };
type Bests = {
  lowest_total_bid_id: string | null;
  lowest_all_in_bid_id: string | null;
  fastest_bid_id: string | null;
  lowest_freight_bid_id: string | null;
  lowest_install_bid_id: string | null;
  most_scope_bid_id: string | null;
  top_ranked_bid_id: string | null;
};
type CompareResp = {
  package: { id: string; category: string; status: string; building?: { id: string; name: string; location?: string } };
  bids: CompareBid[];
  ranking: RankRow[];
  bests: Bests;
  scoring: { weights: { price: number; speed: number; scope: number }; dimensions: Record<string, string> };
};
type Recommendation = { id: string; package_id: string; selected_bid_id: string | null; notes: string | null; status: string } | null;

const money = (cents: number | null | undefined) =>
  cents == null ? '-' : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function QuoteComparison() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<CompareResp | null>(null);
  const [rec, setRec] = useState<Recommendation>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // recommendation form
  const [selected, setSelected] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!id) return;
    setErr(''); setLoading(true);
    try {
      const d = await apiGet<CompareResp>(`/quotes/compare/${encodeURIComponent(id)}`);
      setData(d);
      const r = await apiGet<Recommendation>(`/quotes/compare/${encodeURIComponent(id)}/recommendation`);
      setRec(r);
      if (r) { setSelected(r.selected_bid_id ?? ''); setNotes(r.notes ?? ''); setStatus(r.status ?? 'draft'); }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load comparison.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveRec() {
    if (!id) return;
    setSaving(true); setSavedMsg('');
    try {
      const r = await apiSend<Recommendation>('PATCH', `/quotes/compare/${encodeURIComponent(id)}/recommend`, {
        selectedBidId: selected || null, notes: notes || null, status,
      });
      setRec(r);
      setSavedMsg('Recommendation saved.');
    } catch (e: any) {
      setSavedMsg(e?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="note">Loading comparison…</div>;
  if (err) return (
    <>
      <div className="page-head"><div><h1>Quote comparison</h1></div></div>
      <div className="card"><div className="note" style={{ color: 'var(--red)' }}>{err}</div></div>
    </>
  );
  if (!data) return <div className="note">No data.</div>;

  const { package: pkg, bids, ranking, bests } = data;
  const rankOf = (bidId: string) => ranking.find(r => r.bid_id === bidId);
  const isBest = (bidId: string, key: keyof Bests) => bests[key] === bidId;

  // A cell wrapper that highlights the winner of its row.
  const cell = (bidId: string, key: keyof Bests, content: React.ReactNode) => (
    <td style={isBest(bidId, key) ? { background: 'rgba(16,124,90,0.10)', fontWeight: 700 } : undefined}>
      {content} {isBest(bidId, key) && <span className="badge b-green" style={{ marginLeft: 6 }}>best</span>}
    </td>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/package/' + pkg.id)}>← Back to package</a>
          <h1>Quote comparison</h1>
          <div className="sub">
            {pkg.category} · {pkg.building?.name ?? ''} {pkg.building?.location ? `· ${pkg.building.location}` : ''} ·{' '}
            <span className="badge b-neutral">{pkg.status}</span> · {bids.length} bid{bids.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {bids.length === 0 ? (
        <div className="card"><div className="note">No bids to compare yet.</div></div>
      ) : (
        <>
          {/* ---- deterministic ranking ---- */}
          <div className="sectitle">Ranking (deterministic score)</div>
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <table>
              <thead>
                <tr><th>Rank</th><th>Vendor</th><th>Score</th><th>Price</th><th>Speed</th><th>Scope</th></tr>
              </thead>
              <tbody>
                {ranking.map(r => {
                  const b = bids.find(x => x.id === r.bid_id);
                  return (
                    <tr key={r.bid_id}>
                      <td><strong>#{r.rank}</strong>{r.rank === 1 && <span className="badge b-green" style={{ marginLeft: 6 }}>top</span>}</td>
                      <td><strong>{b?.vendor_company ?? '-'}</strong></td>
                      <td>{(r.score * 100).toFixed(0)}</td>
                      <td>{(r.dimensions.price * 100).toFixed(0)}</td>
                      <td>{(r.dimensions.speed * 100).toFixed(0)}</td>
                      <td>{(r.dimensions.scope * 100).toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="note" style={{ marginBottom: 18 }}>
            Score weights price 40% (lower all-in cost = better), speed 30% (faster lead time = better),
            scope 30% (more priced line items / scope notes / warranty = better). Dimension columns shown 0-100.
          </div>

          {/* ---- side-by-side matrix (columns = vendors, rows = dimensions) ---- */}
          <div className="sectitle">Side-by-side</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Dimension</th>
                  {bids.map(b => (
                    <th key={b.id}>
                      {b.vendor_company}
                      {rankOf(b.id) && <span className="note" style={{ display: 'block', fontWeight: 400 }}>#{rankOf(b.id)!.rank} · {(rankOf(b.id)!.score * 100).toFixed(0)} pts</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Total price</strong></td>
                  {bids.map(b => cell(b.id, 'lowest_total_bid_id', money(b.total_cents)))}
                </tr>
                <tr>
                  <td><strong>Lead time</strong></td>
                  {bids.map(b => cell(b.id, 'fastest_bid_id', b.lead_time_days != null ? `${b.lead_time_days} days` : '-'))}
                </tr>
                <tr>
                  <td><strong>Freight</strong></td>
                  {bids.map(b => cell(b.id, 'lowest_freight_bid_id', money(b.freight_cents)))}
                </tr>
                <tr>
                  <td><strong>Install</strong></td>
                  {bids.map(b => cell(b.id, 'lowest_install_bid_id', money(b.install_cents)))}
                </tr>
                <tr>
                  <td><strong>Warranty</strong></td>
                  {bids.map(b => <td key={b.id}>{b.warranty_text || '-'}</td>)}
                </tr>
                <tr>
                  <td><strong>Scope coverage</strong></td>
                  {bids.map(b => cell(b.id, 'most_scope_bid_id', `${b.line_items.length} line item${b.line_items.length === 1 ? '' : 's'}`))}
                </tr>
                <tr>
                  <td><strong>Scope notes</strong></td>
                  {bids.map(b => <td key={b.id}>{b.scope_notes || '-'}</td>)}
                </tr>
                <tr>
                  <td><strong>Notes</strong></td>
                  {bids.map(b => <td key={b.id}>{b.notes || '-'}</td>)}
                </tr>
              </tbody>
            </table>
          </div>

          {/* ---- recommendation box ---- */}
          <div className="sectitle">Recommendation</div>
          <div className="card">
            {rec?.selected_bid_id && (
              <div className="ok" style={{ marginBottom: 12 }}>
                Current pick: <strong>{bids.find(b => b.id === rec.selected_bid_id)?.vendor_company ?? rec.selected_bid_id}</strong> · status {rec.status}
              </div>
            )}
            <div className="two">
              <div className="field">
                <label>Recommended bid</label>
                <select value={selected} onChange={e => setSelected(e.target.value)}>
                  <option value="">— none —</option>
                  {bids.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.vendor_company} · {money(b.total_cents)}{rankOf(b.id) ? ` · #${rankOf(b.id)!.rank}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="recommended">Recommended</option>
                  <option value="final">Final</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Notes / rationale</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Why this bid? Caveats, negotiation points, conditions…" />
            </div>
            {savedMsg && <div className="ok" style={{ marginBottom: 10 }}>{savedMsg}</div>}
            <button className="btn primary" onClick={saveRec} disabled={saving}>{saving ? 'Saving…' : 'Save recommendation'}</button>
          </div>
        </>
      )}
    </>
  );
}
