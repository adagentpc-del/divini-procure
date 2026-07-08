/**
 * Procurement Intelligence dashboard.
 *
 * Given a package (chosen from a picker, or passed as :id on the route), shows:
 *   - vendor-match results (ranked vendors with reasons),
 *   - quote-analysis flags + savings opportunity + recommended bid,
 *   - alternative vendors (when one is unavailable).
 *
 * All scoring is DETERMINISTIC on the backend. The optional LLM only adds a
 * short narrative to the quote analysis; when AI is off we show a clear
 * "deterministic analysis" note. Matches procure card/table styling.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';
import { getBuildings, getPackages } from '../lib/db';

type RankedVendor = { vendor_company_id: string; name: string; score: number; reasons: string[] };
type VendorMatch = { packageId: string | null; category: string; territory: string; results: RankedVendor[]; ai_enabled: boolean };
type Flag = { type: string; label: string; bid_id?: string; value?: number };
type QuoteAnalysis = {
  packageId: string;
  bid_count: number;
  priced_count: number;
  stats?: { lowest: number; highest: number; average: number; spread_pct: number };
  flags: Flag[];
  savings_opportunity: number;
  recommended_bid_id: string | null;
  recommended_reasons: string[];
  budget: { min: number | null; max: number | null };
  narrative: string | null;
  ai_enabled: boolean;
};
type Alternatives = { category: string; results: RankedVendor[]; ai_enabled: boolean };

function flagColor(type: string): string {
  if (type === 'lowest_total' || type === 'within_budget') return 'b-good';
  if (type === 'highest_total' || type === 'over_budget' || type === 'outlier' || type === 'missing_scope') return 'b-warn';
  return 'b-neutral';
}

export default function IntelDashboard() {
  const { id: routePackageId } = useParams();
  const { company } = useAuth();

  const [buildings, setBuildings] = useState<any[]>([]);
  const [packagesByBuilding, setPackagesByBuilding] = useState<Record<string, any[]>>({});
  const [packageId, setPackageId] = useState<string>(routePackageId || '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [match, setMatch] = useState<VendorMatch | null>(null);
  const [quote, setQuote] = useState<QuoteAnalysis | null>(null);
  const [alts, setAlts] = useState<Alternatives | null>(null);
  const [excludeVendorId, setExcludeVendorId] = useState<string>('');

  // Per-vendor invite handoff state, keyed by vendor company id.
  const [invited, setInvited] = useState<Record<string, 'sending' | 'done' | 'error'>>({});

  // Load the buyer's buildings + their packages for the picker.
  useEffect(() => {
    (async () => {
      if (!company || routePackageId) return;
      try {
        const bs = await getBuildings(company.id);
        setBuildings(bs);
        const map: Record<string, any[]> = {};
        for (const b of bs) map[b.id] = await getPackages(b.id);
        setPackagesByBuilding(map);
      } catch {
        /* picker is best-effort */
      }
    })();
  }, [company, routePackageId]);

  async function analyze(pkgId: string) {
    if (!pkgId) return;
    setLoading(true);
    setErr('');
    setMatch(null);
    setQuote(null);
    setAlts(null);
    setInvited({});
    try {
      const m = await apiGet<VendorMatch>(`/intel/vendor-match?packageId=${encodeURIComponent(pkgId)}`);
      setMatch(m);
      const qa = await apiGet<QuoteAnalysis>(`/intel/quote-analysis/${encodeURIComponent(pkgId)}`);
      setQuote(qa);
      // Mark vendors already invited to this package so the button reflects state.
      try {
        const inv = await apiGet<{ invites: { vendor_company_id: string }[] }>(
          `/intel/invites?packageId=${encodeURIComponent(pkgId)}`,
        );
        const seen: Record<string, 'done'> = {};
        for (const i of inv.invites) seen[i.vendor_company_id] = 'done';
        setInvited(seen);
      } catch {
        /* invite list is best-effort */
      }
    } catch (e: any) {
      setErr(e?.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  // One-click invite-matched-vendor handoff: POST the vendor + captured score.
  async function inviteVendor(v: RankedVendor) {
    if (!packageId) return;
    setInvited((s) => ({ ...s, [v.vendor_company_id]: 'sending' }));
    try {
      await apiSend('POST', '/intel/invite-vendor', {
        packageId,
        vendorCompanyId: v.vendor_company_id,
        matchScore: v.score,
      });
      setInvited((s) => ({ ...s, [v.vendor_company_id]: 'done' }));
    } catch {
      setInvited((s) => ({ ...s, [v.vendor_company_id]: 'error' }));
    }
  }

  // Auto-run when a route package id is present.
  useEffect(() => {
    if (routePackageId) {
      setPackageId(routePackageId);
      analyze(routePackageId);
    }
  }, [routePackageId]);

  async function showAlternatives(vendorId: string) {
    if (!match) return;
    setExcludeVendorId(vendorId);
    try {
      const a = await apiGet<Alternatives>(
        `/intel/alternatives?category=${encodeURIComponent(match.category)}` +
          (match.territory ? `&territory=${encodeURIComponent(match.territory)}` : '') +
          `&excludeVendorId=${encodeURIComponent(vendorId)}`,
      );
      setAlts(a);
    } catch (e: any) {
      setErr(e?.message || 'Alternatives failed');
    }
  }

  const aiOff = match ? !match.ai_enabled : quote ? !quote.ai_enabled : true;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Procurement Intelligence</h1>
          <div className="sub">Deterministic vendor matching, quote analysis, and alternatives.</div>
        </div>
      </div>

      {/* AI status note */}
      <div className="note" style={{ marginBottom: 12 }}>
        {aiOff
          ? 'AI summary off — deterministic analysis. Set LLM_PROVIDER (ollama or openai-compat) to enable an optional narrative.'
          : 'AI narrative enabled — deterministic scoring with an optional LLM summary.'}
      </div>

      {/* Package picker (hidden when a package is fixed by the route) */}
      {!routePackageId && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="sectitle" style={{ marginTop: 0 }}>Choose a package</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 280 }}>
              <label>Package</label>
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">Select a package…</option>
                {buildings.map((b) => (
                  <optgroup key={b.id} label={b.name}>
                    {(packagesByBuilding[b.id] || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.category} · {p.status}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button className="btn primary" onClick={() => analyze(packageId)} disabled={!packageId || loading}>
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          {buildings.length === 0 && <div className="note" style={{ marginTop: 8 }}>No projects found for your account yet.</div>}
        </div>
      )}

      {err && <div className="card" style={{ color: 'var(--red)' }}>{err}</div>}

      {/* Quote analysis */}
      {quote && (
        <>
          <div className="sectitle">Quote analysis</div>
          <div className="card">
            {quote.priced_count === 0 ? (
              <div className="note">No priced bids on this package yet.</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div><div className="note">Lowest</div><strong>${quote.stats?.lowest.toLocaleString()}</strong></div>
                  <div><div className="note">Average</div><strong>${quote.stats?.average.toLocaleString()}</strong></div>
                  <div><div className="note">Highest</div><strong>${quote.stats?.highest.toLocaleString()}</strong></div>
                  <div><div className="note">Spread</div><strong>{quote.stats?.spread_pct}%</strong></div>
                  <div><div className="note">Savings opportunity</div><strong style={{ color: 'var(--emerald)' }}>${quote.savings_opportunity.toLocaleString()}</strong></div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {quote.flags.map((f, i) => (
                    <span key={i} className={`badge ${flagColor(f.type)}`}>{f.label}</span>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Recommended bid</div>
                  {quote.recommended_bid_id ? (
                    <ul className="note" style={{ margin: '4px 0 0 16px' }}>
                      {quote.recommended_reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  ) : (
                    <div className="note">{quote.recommended_reasons[0] || 'No recommendation available.'}</div>
                  )}
                </div>
                {quote.narrative ? (
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>AI summary</div>
                    <div className="note">{quote.narrative}</div>
                  </div>
                ) : (
                  <div className="note" style={{ marginTop: 10 }}>AI summary off — deterministic analysis.</div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Vendor match */}
      {match && (
        <>
          <div className="sectitle">Matched vendors {match.category ? `· ${match.category}` : ''}</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Vendor</th><th>Score</th><th>Why</th><th></th></tr></thead>
              <tbody>
                {match.results.length === 0 ? (
                  <tr><td colSpan={4} className="note" style={{ padding: 14 }}>No matching vendors found.</td></tr>
                ) : (
                  match.results.map((v) => {
                    const inv = invited[v.vendor_company_id];
                    return (
                    <tr key={v.vendor_company_id}>
                      <td><strong>{v.name}</strong></td>
                      <td><span className="badge b-neutral">{v.score}</span></td>
                      <td className="note">{v.reasons.join(' · ')}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {packageId && (
                          inv === 'done' ? (
                            <span className="badge b-good">Invited</span>
                          ) : (
                            <button
                              className="btn"
                              style={{ marginRight: 8 }}
                              disabled={inv === 'sending'}
                              onClick={() => inviteVendor(v)}
                            >
                              {inv === 'sending' ? 'Inviting…' : inv === 'error' ? 'Retry invite' : 'Invite to bid'}
                            </button>
                          )
                        )}
                        <a className="note" style={{ cursor: 'pointer', color: 'var(--emerald)' }} onClick={() => showAlternatives(v.vendor_company_id)}>
                          Alternatives
                        </a>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Alternatives */}
      {alts && (
        <>
          <div className="sectitle">Alternative vendors (excluding selected)</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Vendor</th><th>Score</th><th>Why</th></tr></thead>
              <tbody>
                {alts.results.filter((v) => v.vendor_company_id !== excludeVendorId).length === 0 ? (
                  <tr><td colSpan={3} className="note" style={{ padding: 14 }}>No alternatives found.</td></tr>
                ) : (
                  alts.results
                    .filter((v) => v.vendor_company_id !== excludeVendorId)
                    .map((v) => (
                      <tr key={v.vendor_company_id}>
                        <td><strong>{v.name}</strong></td>
                        <td><span className="badge b-neutral">{v.score}</span></td>
                        <td className="note">{v.reasons.join(' · ')}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
