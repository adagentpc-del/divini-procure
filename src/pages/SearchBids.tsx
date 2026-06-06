import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getOpenPackages, getVendorProfile } from '../lib/db';

export default function SearchBids() {
  const { company } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    (async () => {
      const prof = await getVendorProfile(company.id);
      const svc = prof?.services ?? [];
      setServices(svc); setActive(svc);
      const pkgs = await getOpenPackages({ categories: svc });
      setRows(pkgs);
      setLoading(false);
    })();
  }, [company]);

  function toggle(s: string) {
    setActive(a => a.includes(s) ? a.filter(x => x !== s) : [...a, s]);
  }

  const filtered = rows.filter(r =>
    (active.length === 0 || active.includes(r.category)) &&
    (!q || (`${r.building?.name} ${r.category} ${r.building?.developer} ${r.building?.location}`).toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <>
      <div className="page-head"><div><h1>Search Bids</h1><div className="sub">Open packages matched to your services</div></div></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 10 }}><label>Search</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Building, developer, trade…" /></div>
        <div>{services.map(s => (
          <span key={s} className={'chip' + (active.includes(s) ? ' on' : '')} onClick={() => toggle(s)}>{s}</span>
        ))}</div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Building</th><th>Category</th><th>Developer</th><th>Location</th><th>Deadline</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="note">Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} className="note">No open bids match yet. Buyers post projects here.</td></tr>
              : filtered.map(r => (
                <tr key={r.id} className="row-click">
                  <td><strong>{r.building?.name}</strong></td>
                  <td>{r.category}</td>
                  <td>{r.building?.developer ?? '—'}</td>
                  <td>{r.building?.location ?? '—'}</td>
                  <td>{r.deadline ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 8 }}>{filtered.length} matching bid{filtered.length !== 1 ? 's' : ''}.</div>
    </>
  );
}
