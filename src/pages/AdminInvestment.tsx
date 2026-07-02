/**
 * Admin review console for the Investment + Investor Matching system. Shows
 * overview counts and review queues, lets the admin approve/reject/needs-edits
 * programs and approve/restrict/require-nda/require-kyc investor profiles.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Overview = {
  counts?: Record<string, number>;
  programsForReview?: any[];
  profilesForReview?: any[];
  investorsForReview?: any[];
  flags?: any[];
};

export default function AdminInvestment() {
  const { isAdmin } = useFeatures();
  const [data, setData] = useState<Overview | null>(null);
  const [investors, setInvestors] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadOverview() {
    try { const r = await apiGet<Overview>('/admin/investment/overview'); setData(r); }
    catch (e: any) { setErr(e.message ?? 'Could not load overview.'); }
  }
  async function loadInvestors() {
    try { const r = await apiGet<{ profiles: any[] }>('/admin/investor/profiles?status=pending'); setInvestors(r.profiles ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load investor profiles.'); }
  }
  useEffect(() => { if (isAdmin) { void loadOverview(); void loadInvestors(); } }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function reviewProgram(id: string, decision: 'approve' | 'reject' | 'needs_edits') {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/admin/investment/programs/${id}/review`, { decision });
      setOk(`Program ${decision.replace(/_/g, ' ')}.`); await loadOverview();
    } catch (e: any) { setErr(e.message ?? 'Could not review program.'); }
    finally { setBusy(false); }
  }
  async function reviewInvestor(id: string, decision: 'approve' | 'restrict' | 'require_nda' | 'require_kyc') {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/admin/investor/${id}`, { decision });
      setOk(`Investor ${decision.replace(/_/g, ' ')}.`); await loadInvestors(); await loadOverview();
    } catch (e: any) { setErr(e.message ?? 'Could not review investor.'); }
    finally { setBusy(false); }
  }

  const counts = data?.counts ?? {};
  const programs = data?.programsForReview ?? [];
  const profilesForReview = (data?.profilesForReview ?? []);

  return (
    <>
      <div className="page-head"><div>
        <h1>Investment review</h1>
        <div className="sub">Review developer profiles, investment programs, and investor qualifications before matching.</div>
      </div></div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginBottom: 16 }}>
        {Object.entries(counts).length === 0 ? (
          <div className="card note">No counts.</div>
        ) : Object.entries(counts).map(([k, v]) => (
          <div className="card" key={k}>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{v as any}</div>
            <div className="note">{k.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', fontWeight: 700 }}>Programs for review</div>
        <table>
          <thead><tr><th>Program</th><th>Developer</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {programs.length === 0 ? (
              <tr><td colSpan={5} className="note" style={{ padding: 12 }}>Nothing to review.</td></tr>
            ) : programs.map((p: any) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td className="note">{p.developer_name ?? p.org_name ?? '-'}</td>
                <td className="note">{p.program_type ?? '-'}</td>
                <td><span className="badge b-amber">{(p.admin_review_status ?? p.status ?? '').replace(/_/g, ' ')}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn primary" disabled={busy} onClick={() => reviewProgram(p.id, 'approve')}>Approve</button>
                    <button className="btn" disabled={busy} onClick={() => reviewProgram(p.id, 'needs_edits')}>Needs edits</button>
                    <button className="btn" disabled={busy} onClick={() => reviewProgram(p.id, 'reject')}>Reject</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', fontWeight: 700 }}>Investor profiles for review</div>
        <table>
          <thead><tr><th>Investor</th><th>Type</th><th>Accreditation</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {([...investors, ...profilesForReview]).length === 0 ? (
              <tr><td colSpan={5} className="note" style={{ padding: 12 }}>Nothing to review.</td></tr>
            ) : dedupe([...investors, ...profilesForReview]).map((p: any) => (
              <tr key={p.id}>
                <td><strong>{p.entity_name || p.full_name || '-'}</strong></td>
                <td className="note">{(p.investor_type ?? '-').replace?.(/_/g, ' ') ?? '-'}</td>
                <td className="note">{(p.accreditation_status ?? '-').replace?.(/_/g, ' ') ?? '-'}</td>
                <td><span className="badge b-amber">{(p.status ?? p.review_status ?? 'pending').replace(/_/g, ' ')}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn primary" disabled={busy} onClick={() => reviewInvestor(p.id, 'approve')}>Approve</button>
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(p.id, 'require_nda')}>Require NDA</button>
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(p.id, 'require_kyc')}>Require KYC</button>
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(p.id, 'restrict')}>Restrict</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function dedupe(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows) {
    const id = String(r?.id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(r);
  }
  return out;
}
