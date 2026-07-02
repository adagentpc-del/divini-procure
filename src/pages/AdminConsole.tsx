import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatures } from '../lib/features';
import { apiGet } from '../lib/api';

type Counts = {
  companies: number; buyers: number; vendors: number; buildings: number;
  packages: number; open_packages: number; awards: number; bids: number;
};
type Company = { id: string; kind: string; name: string; city?: string; region?: string; created_at: string };
type Pkg = { id: string; category: string; status: string; deadline?: string; building: string; bid_count: number };
type Bid = { id: string; price: number; days: number; status: string; vendor: string; category: string; building: string; created_at: string };
type Overview = { counts: Counts; companies: Company[]; packages: Pkg[]; bids: Bid[] };

// Read-only monetization rollup for the admin console (V2). Tolerant of a
// missing endpoint: when absent the tiles simply do not render.
type MonetizationSummary = {
  successFeeTotalCents?: number;
  proMrrCents?: number;
  proSubscribers?: number;
  verificationQueueCount?: number;
};

const money = (n?: number) => (n == null ? '-' : '$' + Number(n).toLocaleString());
const moneyCents = (cents?: number) =>
  cents == null ? '$0' : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const date = (s?: string) => (s ? new Date(s).toLocaleDateString() : '-');

export default function AdminConsole() {
  const { isAdmin } = useFeatures();
  const nav = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [mon, setMon] = useState<MonetizationSummary | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Overview>('/admin/overview')
      .then(setData)
      .catch((e) => setErr(e.message ?? 'Could not load admin data.'))
      .finally(() => setLoading(false));
    // Monetization rollup (V2). Best-effort; absence is fine.
    apiGet<MonetizationSummary>('/admin/monetization-summary')
      .then((m) => {
        if (m && (m.successFeeTotalCents != null || m.proMrrCents != null || m.verificationQueueCount != null)) {
          setMon(m);
        }
      })
      .catch(() => { /* endpoint may not exist yet */ });
  }, []);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  const c = data?.counts;
  const cards: [string, number | undefined][] = [
    ['Companies', c?.companies],
    ['Developers', c?.buyers],
    ['Vendors', c?.vendors],
    ['Buildings', c?.buildings],
    ['Packages', c?.packages],
    ['Open RFQs', c?.open_packages],
    ['Bids', c?.bids],
    ['Awarded', c?.awards],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin Console</h1>
          <div className="sub">Platform-wide view of every company, RFQ, and bid on Divini Procure.</div>
        </div>
        <button className="btn primary" onClick={() => nav('/admin/features')}>Feature Flags ✦</button>
      </div>

      {err && <div className="err">{err}</div>}
      {loading && <div className="note">Loading…</div>}

      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 20 }}>
        {cards.map(([label, n]) => (
          <div className="card" key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{n ?? '-'}</div>
            <div className="note">{label}</div>
          </div>
        ))}
      </div>

      {mon && (
        <>
          <div className="sectitle">Monetization</div>
          <div className="grid cards3 kpi" style={{ marginBottom: 20 }}>
            <div className="card metric">
              <div className="k">Success-fee ledger</div>
              <div className="v" style={{ fontSize: 24 }}>{moneyCents(mon.successFeeTotalCents)}</div>
              <div className="d">total accrued (2% capped $2,500)</div>
            </div>
            <div className="card metric">
              <div className="k">Vendor Pro MRR</div>
              <div className="v" style={{ fontSize: 24 }}>{moneyCents(mon.proMrrCents)}</div>
              <div className="d">{mon.proSubscribers ?? 0} subscribers</div>
            </div>
            <div className="card metric">
              <div className="k">Verification queue</div>
              <div className="v">{mon.verificationQueueCount ?? 0}</div>
              <div className="d">
                <a style={{ cursor: 'pointer', color: 'var(--emerald)', fontWeight: 600 }} onClick={() => nav('/admin/verification')}>
                  Open queue →
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="sectitle">Companies</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Joined</th></tr></thead>
          <tbody>
            {(data?.companies ?? []).map((co) => (
              <tr key={co.id}>
                <td><strong>{co.name}</strong></td>
                <td>{co.kind === 'buyer' ? 'Developer' : 'Vendor'}</td>
                <td>{[co.city, co.region].filter(Boolean).join(', ') || '-'}</td>
                <td>{date(co.created_at)}</td>
              </tr>
            ))}
            {!loading && (data?.companies ?? []).length === 0 && (
              <tr><td colSpan={4} className="note">No companies yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sectitle">Packages / RFQs</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Building</th><th>Category</th><th>Status</th><th>Bids</th><th>Deadline</th></tr></thead>
          <tbody>
            {(data?.packages ?? []).map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/package/${p.id}`)}>
                <td>{p.building}</td>
                <td>{p.category}</td>
                <td><span className="chip">{p.status}</span></td>
                <td>{p.bid_count}</td>
                <td>{date(p.deadline)}</td>
              </tr>
            ))}
            {!loading && (data?.packages ?? []).length === 0 && (
              <tr><td colSpan={5} className="note">No packages yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sectitle">Recent Bids</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Vendor</th><th>Package</th><th>Price</th><th>Days</th><th>Status</th><th>Submitted</th></tr></thead>
          <tbody>
            {(data?.bids ?? []).map((b) => (
              <tr key={b.id}>
                <td><strong>{b.vendor}</strong></td>
                <td>{b.category} · {b.building}</td>
                <td>{money(b.price)}</td>
                <td>{b.days}</td>
                <td><span className="chip">{b.status}</span></td>
                <td>{date(b.created_at)}</td>
              </tr>
            ))}
            {!loading && (data?.bids ?? []).length === 0 && (
              <tr><td colSpan={6} className="note">No bids yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
