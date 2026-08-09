import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { searchMarketplace, getVendorProfile } from '../lib/db';

// Phase 0 item 21: this used to fetch every open package matching the
// vendor's own service categories, then filter client-side on every
// keystroke. Search (text + category chips) now runs server-side
// (GET /marketplace/search, pg_trgm-backed - see
// db/schema-marketplace-search.sql), debounced, with real pagination.
export default function SearchBids() {
  const { company } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [services, setServices] = useState<string[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    if (!company) return;
    (async () => {
      const prof = await getVendorProfile(company.id);
      const svc = prof?.services ?? [];
      setServices(svc);
      setActive(svc);
    })();
  }, [company]);

  useEffect(() => {
    if (!company) return;
    setLoading(true);
    const t = setTimeout(async () => {
      const { results, total: t2 } = await searchMarketplace({
        q,
        categories: active,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(results);
      setTotal(t2);
      setLoading(false);
    }, 250); // debounce so a fast typist does not fire a query per keystroke
    return () => clearTimeout(t);
  }, [company, q, active, page]);

  function toggle(s: string) {
    setPage(0);
    setActive(a => a.includes(s) ? a.filter(x => x !== s) : [...a, s]);
  }

  return (
    <>
      <div className="page-head"><div><h1>Search Bids</h1><div className="sub">Open packages matched to your services</div></div></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 10 }}><label>Search</label>
          <input value={q} onChange={e => { setPage(0); setQ(e.target.value); }} placeholder="Building, developer, trade…" /></div>
        <div>{services.map(s => (
          <span key={s} className={'chip' + (active.includes(s) ? ' on' : '')} onClick={() => toggle(s)}>{s}</span>
        ))}</div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Building</th><th>Category</th><th>Developer</th><th>Location</th><th>Deadline</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="note">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="note">No open bids match yet. Buyers post projects here.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="row-click" onClick={() => nav('/package/' + r.id)}>
                  <td><strong>{r.building?.name}</strong></td>
                  <td>{r.category}</td>
                  <td>{r.building?.developer ?? '-'}</td>
                  <td>{r.building?.location ?? '-'}</td>
                  <td>{r.deadline ? new Date(r.deadline).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{total} matching bid{total !== 1 ? 's' : ''}.</span>
        {total > PAGE_SIZE && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
            <span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
            <button className="btn" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </span>
        )}
      </div>
    </>
  );
}
