/**
 * Invited opportunities (vendor-facing).
 *
 * Lists bid invites addressed to the signed-in vendor's company. Each invite is
 * a one-click handoff from a developer who matched this vendor in the
 * Procurement Intelligence view, carrying the blended Divini Score + relationship
 * match score at invite time. Vendors can jump straight to the package to bid.
 *
 * Read-only here: it surfaces the opportunity. Bidding happens on the package
 * page. Matches procure card/table styling. Zero em dashes by convention.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';

type Invite = {
  id: string;
  package_id: string;
  package_category: string | null;
  package_status: string | null;
  project_name: string | null;
  status: string;
  match_score: number | null;
  message: string | null;
  created_at: string;
};

function statusBadge(status: string): string {
  if (status === 'bid_submitted') return 'b-good';
  if (status === 'declined' || status === 'expired') return 'b-warn';
  return 'b-neutral';
}

export default function MyInvites() {
  const { company } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      if (!company) return;
      setLoading(true);
      setErr('');
      try {
        const r = await apiGet<{ invites: Invite[] }>(
          `/intel/my-invites?companyId=${encodeURIComponent(company.id)}`,
        );
        setInvites(r.invites);
      } catch (e: any) {
        setErr(e?.message || 'Could not load invites');
      } finally {
        setLoading(false);
      }
    })();
  }, [company]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invited opportunities</h1>
          <div className="sub">Packages where a developer has invited your company to bid.</div>
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--red)' }}>{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Project</th><th>Package</th><th>Match</th><th>Status</th><th>Message</th><th></th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="note" style={{ padding: 14 }}>Loading…</td></tr>
            ) : invites.length === 0 ? (
              <tr><td colSpan={6} className="note" style={{ padding: 14 }}>No invitations yet.</td></tr>
            ) : (
              invites.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.project_name || 'Project'}</strong></td>
                  <td className="note">{i.package_category || '—'}{i.package_status ? ` · ${i.package_status}` : ''}</td>
                  <td>{i.match_score != null ? <span className="badge b-neutral">{i.match_score}</span> : <span className="note">—</span>}</td>
                  <td><span className={`badge ${statusBadge(i.status)}`}>{i.status}</span></td>
                  <td className="note">{i.message || '—'}</td>
                  <td><Link className="btn" to={`/package/${i.package_id}`}>View package</Link></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
