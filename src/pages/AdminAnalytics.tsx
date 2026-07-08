/**
 * Admin KPI Analytics dashboard.
 *
 * Pulls the flat metric rollup from GET /admin/analytics and renders it as
 * grouped metric cards (Marketplace, Procurement, Fees, Investment, Capital).
 * Money metrics arrive as integer cents and are shown as dollars. A refresh
 * button re-pulls the rollup.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet } from '../lib/api';

type Metrics = Record<string, number>;

const money = (cents: number) =>
  `$${(Number(cents || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (n: number) => Number(n || 0).toLocaleString();

type Tile = { key: string; label: string; kind: 'count' | 'money' };
type Group = { title: string; tiles: Tile[] };

const GROUPS: Group[] = [
  {
    title: 'Marketplace',
    tiles: [
      { key: 'activeDevelopers', label: 'Active developers', kind: 'count' },
      { key: 'activeVendors', label: 'Active vendors', kind: 'count' },
      { key: 'claimedProfiles', label: 'Claimed profiles', kind: 'count' },
      { key: 'approvedVendors', label: 'Approved vendors', kind: 'count' },
    ],
  },
  {
    title: 'Procurement',
    tiles: [
      { key: 'openBidPackages', label: 'Open bid packages', kind: 'count' },
      { key: 'awardedBids', label: 'Awarded bids', kind: 'count' },
      { key: 'procurementVolumeCents', label: 'Procurement volume', kind: 'money' },
    ],
  },
  {
    title: 'Fees',
    tiles: [
      { key: 'feesEarnedCents', label: 'Fees earned', kind: 'money' },
      { key: 'grandfatheredVolume', label: 'Grandfathered pairs', kind: 'count' },
      { key: 'standardFeeVolume', label: 'Standard-fee pairs', kind: 'count' },
    ],
  },
  {
    title: 'Investment',
    tiles: [
      { key: 'activeInvestmentPrograms', label: 'Active programs', kind: 'count' },
      { key: 'qualifiedInvestors', label: 'Qualified investors', kind: 'count' },
      { key: 'investorMatches', label: 'Investor matches', kind: 'count' },
      { key: 'introductionsMade', label: 'Introductions made', kind: 'count' },
      { key: 'softCommitments', label: 'Soft commitments', kind: 'count' },
    ],
  },
  {
    title: 'Capital',
    tiles: [
      { key: 'capitalCommittedCents', label: 'Capital committed', kind: 'money' },
      { key: 'capitalClosedCents', label: 'Capital closed', kind: 'money' },
    ],
  },
];

export default function AdminAnalytics() {
  const { isAdmin } = useFeatures();
  const [m, setM] = useState<Metrics>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setErr('');
    try {
      const d = await apiGet<Metrics>('/admin/analytics');
      setM(d ?? {});
    } catch (e: any) {
      setErr(e.message ?? 'Could not load analytics.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>KPI Analytics</h1>
          <div className="sub">
            Platform health across the marketplace, procurement, fees, investment, and capital.
            Every metric is computed defensively and defaults to zero when a source is not yet
            populated.
          </div>
        </div>
        <button className="btn primary" disabled={busy} onClick={load}>
          {busy ? 'Refreshing.' : 'Refresh'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}

      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginBottom: 18 }}>
          <div className="nav-label" style={{ margin: '4px 0 8px' }}>{g.title}</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            {g.tiles.map((t) => (
              <div key={t.key} className="card">
                <div className="note">{t.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
                  {t.kind === 'money' ? money(m[t.key]) : num(m[t.key])}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
