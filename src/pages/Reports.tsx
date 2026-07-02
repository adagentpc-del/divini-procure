import { useState } from 'react';
import { apiGet, getSessionToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';

// ---- shapes returned by the /reports/* JSON endpoints -----------------------
type BudgetResp = {
  projects: { name: string; packages: number; awardedTotalCents: number }[];
  totals: { projects: number; packages: number; awardedTotalCents: number };
};
type SavingsResp = {
  projects: { name: string; lowestBidCents: number; awardedBidCents: number; savingsCents: number }[];
};
type PipelineResp = {
  programs: { name: string; targetRaiseCents: number; pipelineCounts: Record<string, number> }[];
};
type InvestorResp = {
  company: { name: string };
  projectCount: number;
  budgetCents: number;
  committedCents: number;
  savingsCents: number;
  vendorAwardsCount: number;
  riskCount: number;
  generatedAt: string;
};

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

const money = (cents: number | null | undefined) =>
  cents == null
    ? '-'
    : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Raw CSV download: the JSON api client cannot stream text, so we fetch with the
// same credentials + bearer fallback the api client uses, then trigger a blob
// download. Returns an error string or null.
async function downloadCsv(path: string, filename: string): Promise<string | null> {
  try {
    const token = getSessionToken();
    const res = await fetch(`${BASE}/api${path}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error || '';
      } catch {
        detail = res.statusText;
      }
      return detail || `Download failed (${res.status})`;
    }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return null;
  } catch (e: any) {
    return e?.message || 'Download failed.';
  }
}

export default function Reports() {
  const { company } = useAuth();
  const { isAdmin } = useFeatures();

  const [pkgId, setPkgId] = useState('');
  const [csvErr, setCsvErr] = useState('');
  const [busy, setBusy] = useState('');

  // printable report state
  const [budget, setBudget] = useState<BudgetResp | null>(null);
  const [savings, setSavings] = useState<SavingsResp | null>(null);
  const [pipeline, setPipeline] = useState<PipelineResp | null>(null);
  const [investor, setInvestor] = useState<InvestorResp | null>(null);
  const [loadErr, setLoadErr] = useState('');

  const companyId = company?.id;

  async function dlBidComparison() {
    setCsvErr('');
    if (!pkgId.trim()) {
      setCsvErr('Enter a package id first.');
      return;
    }
    setBusy('bid');
    const err = await downloadCsv(
      `/reports/bid-comparison/${encodeURIComponent(pkgId.trim())}.csv`,
      `bid-comparison-${pkgId.trim()}.csv`,
    );
    setBusy('');
    if (err) setCsvErr(err);
  }

  async function dlVendors() {
    setCsvErr('');
    setBusy('vendors');
    const err = await downloadCsv('/reports/vendors.csv', 'vendors.csv');
    setBusy('');
    if (err) setCsvErr(err);
  }

  async function loadBudget() {
    if (!companyId) return;
    setLoadErr('');
    try {
      setBudget(await apiGet<BudgetResp>(`/reports/procurement-budget?companyId=${companyId}`));
    } catch (e: any) {
      setLoadErr(e?.message || 'Failed to load budget report.');
    }
  }
  async function loadSavings() {
    if (!companyId) return;
    setLoadErr('');
    try {
      setSavings(await apiGet<SavingsResp>(`/reports/savings?companyId=${companyId}`));
    } catch (e: any) {
      setLoadErr(e?.message || 'Failed to load savings report.');
    }
  }
  async function loadPipeline() {
    if (!companyId) return;
    setLoadErr('');
    try {
      setPipeline(await apiGet<PipelineResp>(`/reports/capital-pipeline?companyId=${companyId}`));
    } catch (e: any) {
      setLoadErr(e?.message || 'Failed to load capital pipeline.');
    }
  }
  async function loadInvestor() {
    if (!companyId) return;
    setLoadErr('');
    try {
      setInvestor(await apiGet<InvestorResp>(`/reports/investor-report?companyId=${companyId}`));
    } catch (e: any) {
      setLoadErr(e?.message || 'Failed to load investor report.');
    }
  }

  if (!company) return <div className="note">Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reporting &amp; Exports</h1>
          <div className="note">
            Download CSVs for spreadsheets, or build a printable report and use Print / Save as PDF.
          </div>
        </div>
      </div>

      {/* ---- CSV downloads ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>CSV downloads</h3>
        {csvErr && <div className="note" style={{ color: '#b00' }}>{csvErr}</div>}
        <div className="two" style={{ gap: 12, alignItems: 'end' }}>
          <div>
            <label className="note">Bid comparison (by package id)</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                value={pkgId}
                onChange={(e) => setPkgId(e.target.value)}
                placeholder="package id (uuid)"
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={dlBidComparison} disabled={busy === 'bid'}>
                {busy === 'bid' ? 'Preparing…' : 'Download CSV'}
              </button>
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="note">Vendor directory (admin)</label>
              <div style={{ marginTop: 4 }}>
                <button className="btn" onClick={dlVendors} disabled={busy === 'vendors'}>
                  {busy === 'vendors' ? 'Preparing…' : 'Download vendors.csv'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {loadErr && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="note" style={{ color: '#b00' }}>{loadErr}</div>
        </div>
      )}

      {/* ---- Procurement budget ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>Procurement budget</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={loadBudget}>Build report</button>
            {budget && <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>}
          </div>
        </div>
        {budget && (
          <div className="report-print">
            <h2>Procurement Budget — {company.name}</h2>
            <table>
              <thead>
                <tr><th>Project</th><th>Packages</th><th>Awarded total</th></tr>
              </thead>
              <tbody>
                {budget.projects.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td>{p.packages}</td>
                    <td>{money(p.awardedTotalCents)}</td>
                  </tr>
                ))}
                {budget.projects.length === 0 && (
                  <tr><td colSpan={3} className="note">No projects.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total ({budget.totals.projects} projects)</strong></td>
                  <td><strong>{budget.totals.packages}</strong></td>
                  <td><strong>{money(budget.totals.awardedTotalCents)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ---- Savings ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>Savings (lowest vs awarded)</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={loadSavings}>Build report</button>
            {savings && <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>}
          </div>
        </div>
        {savings && (
          <div className="report-print">
            <h2>Savings Report — {company.name}</h2>
            <table>
              <thead>
                <tr><th>Project</th><th>Lowest bids</th><th>Awarded</th><th>Savings vs lowest</th></tr>
              </thead>
              <tbody>
                {savings.projects.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td>{money(p.lowestBidCents)}</td>
                    <td>{money(p.awardedBidCents)}</td>
                    <td>{money(p.savingsCents)}</td>
                  </tr>
                ))}
                {savings.projects.length === 0 && (
                  <tr><td colSpan={4} className="note">No awarded packages yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Capital pipeline ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>Capital pipeline</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={loadPipeline}>Build report</button>
            {pipeline && <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>}
          </div>
        </div>
        {pipeline && (
          <div className="report-print">
            <h2>Capital Pipeline — {company.name}</h2>
            {pipeline.programs.length === 0 && <div className="note">No investment programs.</div>}
            {pipeline.programs.map((p, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <h3 style={{ marginBottom: 4 }}>{p.name || 'Untitled program'}</h3>
                <div className="note">Target raise: {money(p.targetRaiseCents)}</div>
                <table>
                  <thead><tr><th>Pipeline status</th><th>Count</th></tr></thead>
                  <tbody>
                    {Object.entries(p.pipelineCounts).map(([k, v]) => (
                      <tr key={k}><td>{k}</td><td>{v}</td></tr>
                    ))}
                    {Object.keys(p.pipelineCounts).length === 0 && (
                      <tr><td colSpan={2} className="note">No introductions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Investor report ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>Investor report</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={loadInvestor}>Build report</button>
            {investor && <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>}
          </div>
        </div>
        {investor && (
          <div className="report-print">
            <h2>Investor Report — {investor.company.name}</h2>
            <div className="note">Generated {new Date(investor.generatedAt).toLocaleString()}</div>
            <table>
              <tbody>
                <tr><td>Projects</td><td>{investor.projectCount}</td></tr>
                <tr><td>Procurement budget (awarded)</td><td>{money(investor.budgetCents)}</td></tr>
                <tr><td>Capital committed (target)</td><td>{money(investor.committedCents)}</td></tr>
                <tr><td>Savings achieved</td><td>{money(investor.savingsCents)}</td></tr>
                <tr><td>Vendor awards</td><td>{investor.vendorAwardsCount}</td></tr>
                <tr><td>Open risks</td><td>{investor.riskCount}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="note" style={{ fontSize: 12 }}>
        Tip: in the browser print dialog choose "Save as PDF" as the destination.
      </div>
    </div>
  );
}
