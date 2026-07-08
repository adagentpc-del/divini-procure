import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getMyBids } from '../lib/db';

const badge: Record<string, string> = {
  draft: 'b-neutral', submitted: 'b-green', shortlisted: 'b-neutral',
  rebid: 'b-amber', awarded: 'b-green', revision: 'b-amber',
};

export default function MyBids() {
  const { company } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    getMyBids(company.id).then(r => { setRows(r); setLoading(false); });
  }, [company]);

  return (
    <>
      <div className="page-head"><div><h1>My Bids</h1><div className="sub">Every proposal you’ve submitted</div></div></div>
      <div className="card">
        <table>
          <thead><tr><th>Building</th><th>Category</th><th>Price</th><th>Timeline</th><th>Status</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="note">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="note">No bids yet - submit one from Search Bids.</td></tr>
              : rows.map(b => (
                <tr key={b.id} className="row-click">
                  <td><strong>{b.package?.building?.name ?? '-'}</strong></td>
                  <td>{b.package?.category ?? '-'}</td>
                  <td>{b.price != null ? `$${Number(b.price).toLocaleString()}` : '-'}</td>
                  <td>{b.days ? `${b.days} days` : '-'}</td>
                  <td><span className={'badge ' + (badge[b.status] ?? 'b-neutral')}>{b.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
