import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getBuildings, getOpenPackages, getMyBids, getVendorProfile } from '../lib/db';

export default function Dashboard() {
  const { company } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    (async () => {
      if (company.kind === 'buyer') {
        const b = await getBuildings(company.id);
        setStats({ projects: b.length });
      } else {
        const prof = await getVendorProfile(company.id);
        const open = await getOpenPackages({ categories: prof?.services ?? [] });
        const bids = await getMyBids(company.id);
        setStats({ matched: open.length, bids: bids.length });
      }
      setLoading(false);
    })();
  }, [company]);

  if (!company) return null;
  const isBuyer = company.kind === 'buyer';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {company.name}</h1>
          <div className="sub">{isBuyer ? 'Your procurement command center' : 'Your vendor workspace'}</div>
        </div>
        {isBuyer
          ? <button className="btn primary" onClick={() => nav('/projects')}>+ Post a Project</button>
          : <button className="btn primary" onClick={() => nav('/search')}>Find bids</button>}
      </div>

      <div className="grid cards3 kpi">
        {isBuyer ? (
          <>
            <div className="card metric"><div className="k">Active projects</div><div className="v">{loading ? '—' : stats.projects ?? 0}</div><div className="d">buildings</div></div>
            <div className="card metric"><div className="k">Open packages</div><div className="v">—</div><div className="d">across projects</div></div>
            <div className="card metric"><div className="k">Plan</div><div className="v" style={{ fontSize: 20 }}>Free</div><div className="d">beta</div></div>
          </>
        ) : (
          <>
            <div className="card metric"><div className="k">Bids matched to you</div><div className="v">{loading ? '—' : stats.matched ?? 0}</div><div className="d">open packages</div></div>
            <div className="card metric"><div className="k">My bids</div><div className="v">{loading ? '—' : stats.bids ?? 0}</div><div className="d">submitted</div></div>
            <div className="card metric"><div className="k">Plan</div><div className="v" style={{ fontSize: 20 }}>$100/mo</div><div className="d">first 2 mo 50% off</div></div>
          </>
        )}
      </div>

      <div className="sectitle">Getting started</div>
      <div className="card">
        <p className="note" style={{ margin: 0, lineHeight: 1.6 }}>
          {isBuyer
            ? 'Post a project to start receiving bids from verified vendors. Compare side by side, award, and pay by ACH or wire.'
            : 'Search open bids matched to your services, submit a proposal with your documents, and get paid through Divini.'}
        </p>
      </div>
    </>
  );
}
