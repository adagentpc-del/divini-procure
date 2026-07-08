/**
 * Developer (buyer) investment programs. List + create programs, then open one to
 * edit, submit for review, upload offering documents, review matched investors
 * (with intro decisions), and watch the capital-raise pipeline. Money fields are
 * shown in dollars and sent as integer cents.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';
import { InvestorMatchCard, type InvestorMatch } from '../components/MatchCard';

const PROGRAM_TYPES = [
  'Single Project Investment', 'Development Fund', 'Hotel / Hospitality Investment',
  'Multifamily Investment', 'Mixed-Use Development', 'Ground-Up Development',
  'Value-Add Opportunity', 'Preferred Equity', 'Common Equity', 'Debt Investment',
  'JV / Strategic Partnership', 'Family Office Opportunity', 'Accredited Investor Offering',
  'Non-Accredited Investor Program', 'Real Estate Education / Entry Program',
  'Sponsorship / Capital Partner Opportunity',
];

const VISIBILITY = [
  'public_teaser', 'approved_investor_preview', 'nda_required', 'accredited_only',
  'non_accredited_program', 'family_office_only', 'admin_approved_only',
  'private_invite_only', 'closed',
];

type Program = Record<string, any> & { id: string; name?: string; status?: string; admin_review_status?: string };
type Doc = { id: string; doc_type?: string; docType?: string; title?: string; url?: string };
type Pipeline = { targetRaiseCents?: number; committedCents?: number; counts?: Record<string, number>; investors?: any[] };

const d2c = (s: string) => (s === '' || s == null ? undefined : Math.round(Number(s) * 100));
const c2d = (c?: number) => (c == null ? '' : String(Number(c) / 100));
const dollars = (c?: number) =>
  c == null ? '-' : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const FIELD_DEFAULTS: Record<string, any> = {
  name: '', program_type: '', asset_class: '', location: '', project_stage: '',
  offering_type: '', investment_vehicle: '', projected_return: '', preferred_return: '',
  equity_multiple: '', irr_target: '', hold_period: '', distribution_schedule: '',
  use_of_funds: '', capital_stack: '', risk_level: '', exit_strategy: '',
  qualification_requirements: '', visibility: 'public_teaser',
  accredited_only: false, non_accredited_accepted: false, nda_required: false,
  kyc_required: false, proof_of_funds_required: false, investor_type_accepted: '',
};

export default function InvestmentPrograms() {
  const { company } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // create form
  const [form, setForm] = useState<Record<string, any>>({ ...FIELD_DEFAULTS });
  const [targetRaise, setTargetRaise] = useState('');
  const [minInv, setMinInv] = useState('');
  const [maxInv, setMaxInv] = useState('');

  async function load() {
    if (!company) return;
    try {
      const r = await apiGet<{ programs: Program[] }>(`/investment/programs?companyId=${company.id}`);
      setPrograms(r.programs ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load programs.'); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [company]);

  if (!company) return <div className="note">Loading…</div>;
  if (company.kind !== 'buyer') return <div className="card">This page is for developer accounts.</div>;

  const setF = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  async function create() {
    if (!company) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/investment/programs', {
        companyId: company.id,
        ...form,
        target_raise_cents: d2c(targetRaise),
        min_investment_cents: d2c(minInv),
        max_investment_cents: d2c(maxInv),
      });
      setForm({ ...FIELD_DEFAULTS }); setTargetRaise(''); setMinInv(''); setMaxInv('');
      setOk('Program created.');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create program.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Investment programs</h1>
          <div className="sub">Create capital-raise programs, submit them for review, share offering materials, and review matched investors.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>New program</div>
        <div className="two">
          <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setF('name', e.target.value)} /></div>
          <div className="field"><label>Program type</label>
            <select value={form.program_type} onChange={(e) => setF('program_type', e.target.value)}>
              <option value="">Select…</option>
              {PROGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Asset class</label><input value={form.asset_class} onChange={(e) => setF('asset_class', e.target.value)} /></div>
          <div className="field"><label>Location / market</label><input value={form.location} onChange={(e) => setF('location', e.target.value)} /></div>
          <div className="field"><label>Project stage</label><input value={form.project_stage} onChange={(e) => setF('project_stage', e.target.value)} /></div>
          <div className="field"><label>Visibility</label>
            <select value={form.visibility} onChange={(e) => setF('visibility', e.target.value)}>
              {VISIBILITY.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="field"><label>Target raise ($)</label><input type="number" value={targetRaise} onChange={(e) => setTargetRaise(e.target.value)} /></div>
          <div className="field"><label>Investor type accepted</label><input value={form.investor_type_accepted} onChange={(e) => setF('investor_type_accepted', e.target.value)} /></div>
          <div className="field"><label>Minimum investment ($)</label><input type="number" value={minInv} onChange={(e) => setMinInv(e.target.value)} /></div>
          <div className="field"><label>Maximum investment ($)</label><input type="number" value={maxInv} onChange={(e) => setMaxInv(e.target.value)} /></div>
          <div className="field"><label>Offering type</label><input value={form.offering_type} onChange={(e) => setF('offering_type', e.target.value)} /></div>
          <div className="field"><label>Investment vehicle</label><input value={form.investment_vehicle} onChange={(e) => setF('investment_vehicle', e.target.value)} /></div>
          <div className="field"><label>Projected return</label><input value={form.projected_return} onChange={(e) => setF('projected_return', e.target.value)} /></div>
          <div className="field"><label>Preferred return</label><input value={form.preferred_return} onChange={(e) => setF('preferred_return', e.target.value)} /></div>
          <div className="field"><label>Equity multiple</label><input value={form.equity_multiple} onChange={(e) => setF('equity_multiple', e.target.value)} /></div>
          <div className="field"><label>IRR target</label><input value={form.irr_target} onChange={(e) => setF('irr_target', e.target.value)} /></div>
          <div className="field"><label>Hold period</label><input value={form.hold_period} onChange={(e) => setF('hold_period', e.target.value)} /></div>
          <div className="field"><label>Distribution schedule</label><input value={form.distribution_schedule} onChange={(e) => setF('distribution_schedule', e.target.value)} /></div>
          <div className="field"><label>Risk level</label>
            <select value={form.risk_level} onChange={(e) => setF('risk_level', e.target.value)}>
              <option value="">Select…</option>
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div className="field"><label>Exit strategy</label><input value={form.exit_strategy} onChange={(e) => setF('exit_strategy', e.target.value)} /></div>
        </div>
        <div className="field"><label>Use of funds</label><textarea rows={2} value={form.use_of_funds} onChange={(e) => setF('use_of_funds', e.target.value)} /></div>
        <div className="field"><label>Capital stack</label><textarea rows={2} value={form.capital_stack} onChange={(e) => setF('capital_stack', e.target.value)} /></div>
        <div className="field"><label>Qualification requirements</label><textarea rows={2} value={form.qualification_requirements} onChange={(e) => setF('qualification_requirements', e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="note"><input type="checkbox" checked={form.accredited_only} onChange={(e) => setF('accredited_only', e.target.checked)} /> Accredited only</label>
          <label className="note"><input type="checkbox" checked={form.non_accredited_accepted} onChange={(e) => setF('non_accredited_accepted', e.target.checked)} /> Non-accredited accepted</label>
          <label className="note"><input type="checkbox" checked={form.nda_required} onChange={(e) => setF('nda_required', e.target.checked)} /> NDA required</label>
          <label className="note"><input type="checkbox" checked={form.kyc_required} onChange={(e) => setF('kyc_required', e.target.checked)} /> KYC required</label>
          <label className="note"><input type="checkbox" checked={form.proof_of_funds_required} onChange={(e) => setF('proof_of_funds_required', e.target.checked)} /> Proof of funds required</label>
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>Create program</button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Target raise</th><th>Status</th><th>Review</th><th></th></tr></thead>
          <tbody>
            {programs.length === 0 ? (
              <tr><td colSpan={6} className="note" style={{ padding: 14 }}>No programs yet.</td></tr>
            ) : programs.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td className="note">{p.program_type}</td>
                <td>{dollars(p.target_raise_cents)}</td>
                <td><span className="badge b-neutral">{(p.status ?? '').replace(/_/g, ' ')}</span></td>
                <td className="note">{(p.admin_review_status ?? '').replace(/_/g, ' ')}</td>
                <td><button className="btn" onClick={() => setOpenId(openId === p.id ? null : p.id)}>{openId === p.id ? 'Close' : 'Open'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && <ProgramDetail key={openId} programId={openId} onChanged={load} />}

      <ComplianceDisclaimer />
    </>
  );
}

// ---- per-program detail panel ----------------------------------------------

function ProgramDetail({ programId, onChanged }: { programId: string; onChanged: () => void }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [tab, setTab] = useState<'edit' | 'documents' | 'matches' | 'pipeline'>('edit');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // documents
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docType, setDocType] = useState('deck');
  const [docTitle, setDocTitle] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [ndaGated, setNdaGated] = useState(false);
  const [accreditedOnly, setAccreditedOnly] = useState(false);

  const [matches, setMatches] = useState<InvestorMatch[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [views, setViews] = useState<{ views: number; uniqueViewers: number; unlocked: boolean; recent?: { viewed_at: string }[] } | null>(null);

  async function loadProgram() {
    try {
      const r = await apiGet<{ program: Program }>(`/investment/programs/${programId}`);
      setProgram(r.program);
    } catch (e: any) { setErr(e.message ?? 'Could not load program.'); }
  }
  async function loadDocs() {
    try { const r = await apiGet<{ documents: Doc[] }>(`/investment/programs/${programId}/documents`); setDocs(r.documents ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load documents.'); }
  }
  async function loadMatches() {
    try { const r = await apiGet<{ matches: InvestorMatch[] }>(`/investment/programs/${programId}/matches`); setMatches(r.matches ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load matches.'); }
  }
  async function loadPipeline() {
    try { const r = await apiGet<Pipeline>(`/investment/programs/${programId}/pipeline`); setPipeline(r); }
    catch (e: any) { setErr(e.message ?? 'Could not load pipeline.'); }
  }

  useEffect(() => { void loadProgram(); void loadViews(); /* eslint-disable-next-line */ }, [programId]);
  async function loadViews() {
    try {
      const r = await apiGet<{ views: number; uniqueViewers: number; unlocked: boolean; recent?: { viewed_at: string }[] }>(`/investment/programs/${programId}/views`);
      setViews(r);
    } catch { /* optional */ }
  }
  useEffect(() => {
    if (tab === 'documents') void loadDocs();
    if (tab === 'matches') void loadMatches();
    if (tab === 'pipeline') void loadPipeline();
    /* eslint-disable-next-line */
  }, [tab, programId]);

  if (!program) return <div className="card"><div className="note">Loading program…</div></div>;

  const setP = (k: string, v: any) => setProgram((p) => (p ? { ...p, [k]: v } : p));

  async function saveEdit() {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ program: Program }>('PATCH', `/investment/programs/${programId}`, { ...program });
      setProgram(r.program); setOk('Saved.'); onChanged();
    } catch (e: any) { setErr(e.message ?? 'Could not save.'); }
    finally { setBusy(false); }
  }
  async function submitProgram() {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ program: Program }>('POST', `/investment/programs/${programId}/submit`);
      setProgram(r.program); setOk('Submitted for review.'); onChanged();
    } catch (e: any) { setErr(e.message ?? 'Could not submit.'); }
    finally { setBusy(false); }
  }
  async function uploadDoc() {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/investment/programs/${programId}/documents`, {
        docType, url: docUrl, title: docTitle, ndaGated, accreditedOnly,
      });
      setDocTitle(''); setDocUrl(''); setNdaGated(false); setAccreditedOnly(false);
      setOk('Document added.'); await loadDocs();
    } catch (e: any) { setErr(e.message ?? 'Could not add document.'); }
    finally { setBusy(false); }
  }
  async function decide(m: InvestorMatch, decision: 'approve' | 'decline' | 'request_info' | 'require_nda') {
    if (!m.introductionRequestId) { setErr('No introduction request to act on yet.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/investment/introductions/${m.introductionRequestId}`, { decision });
      setOk('Decision recorded.'); await loadMatches();
    } catch (e: any) { setErr(e.message ?? 'Could not record decision.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['edit', 'documents', 'matches', 'pipeline'] as const).map((t) => (
          <button key={t} className={'btn' + (tab === t ? ' primary' : '')} onClick={() => setTab(t)}>
            {t === 'edit' ? 'Edit' : t === 'documents' ? 'Offering documents' : t === 'matches' ? 'Investor matches' : 'Capital pipeline'}
          </button>
        ))}
      </div>

      {views && (
        <div className="card" style={{ marginBottom: 14, background: 'var(--ivory)' }}>
          <div className="note" style={{ fontWeight: 700, marginBottom: 4 }}>Who viewed this raise</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div><span style={{ fontSize: 26, fontWeight: 800, color: 'var(--emerald)' }}>{views.uniqueViewers}</span> <span className="note">investors viewed</span></div>
            <div><span style={{ fontSize: 18, fontWeight: 700 }}>{views.views}</span> <span className="note">total views</span></div>
          </div>
          {views.unlocked ? (
            <div className="note" style={{ marginTop: 6 }}>
              {(views.recent?.length ?? 0) > 0
                ? `Most recent view: ${new Date(views.recent![0].viewed_at).toLocaleString()}.`
                : 'No views yet.'} Investor identities stay private — you see interest, not names, and reach them through an approved introduction.
            </div>
          ) : (
            <div className="note" style={{ marginTop: 6 }}>
              Upgrade to <strong>Developer Pro</strong> to see the view trend and recent activity. Investor identities always stay private.
            </div>
          )}
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {tab === 'edit' && (
        <>
          <div className="two">
            <div className="field"><label>Name</label><input value={program.name ?? ''} onChange={(e) => setP('name', e.target.value)} /></div>
            <div className="field"><label>Asset class</label><input value={program.asset_class ?? ''} onChange={(e) => setP('asset_class', e.target.value)} /></div>
            <div className="field"><label>Location / market</label><input value={program.location ?? ''} onChange={(e) => setP('location', e.target.value)} /></div>
            <div className="field"><label>Project stage</label><input value={program.project_stage ?? ''} onChange={(e) => setP('project_stage', e.target.value)} /></div>
            <div className="field"><label>Target raise ($)</label><input type="number" value={c2d(program.target_raise_cents)} onChange={(e) => setP('target_raise_cents', d2c(e.target.value))} /></div>
            <div className="field"><label>Minimum investment ($)</label><input type="number" value={c2d(program.min_investment_cents)} onChange={(e) => setP('min_investment_cents', d2c(e.target.value))} /></div>
            <div className="field"><label>Maximum investment ($)</label><input type="number" value={c2d(program.max_investment_cents)} onChange={(e) => setP('max_investment_cents', d2c(e.target.value))} /></div>
            <div className="field"><label>Projected return</label><input value={program.projected_return ?? ''} onChange={(e) => setP('projected_return', e.target.value)} /></div>
            <div className="field"><label>Hold period</label><input value={program.hold_period ?? ''} onChange={(e) => setP('hold_period', e.target.value)} /></div>
            <div className="field"><label>Visibility</label>
              <select value={program.visibility ?? 'public_teaser'} onChange={(e) => setP('visibility', e.target.value)}>
                {VISIBILITY.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button className="btn primary" disabled={busy} onClick={saveEdit}>Save changes</button>
            <button className="btn" disabled={busy} onClick={submitProgram}>Submit for review</button>
          </div>
        </>
      )}

      {tab === 'documents' && (
        <>
          <div className="two">
            <div className="field"><label>Document type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="deck">Deck</option>
                <option value="offering_memo">Offering memo</option>
                <option value="track_record">Track record</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field"><label>Title</label><input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} /></div>
            <div className="field"><label>URL</label><input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" /></div>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="note"><input type="checkbox" checked={ndaGated} onChange={(e) => setNdaGated(e.target.checked)} /> NDA gated</label>
            <label className="note"><input type="checkbox" checked={accreditedOnly} onChange={(e) => setAccreditedOnly(e.target.checked)} /> Accredited only</label>
          </div>
          <button className="btn primary" disabled={busy} onClick={uploadDoc}>Add document</button>
          <div className="card" style={{ padding: 0, marginTop: 14 }}>
            <table>
              <thead><tr><th>Title</th><th>Type</th><th>Link</th></tr></thead>
              <tbody>
                {docs.length === 0 ? (
                  <tr><td colSpan={3} className="note" style={{ padding: 12 }}>No documents yet.</td></tr>
                ) : docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title ?? '-'}</td>
                    <td className="note">{(d.doc_type ?? d.docType ?? '').replace(/_/g, ' ')}</td>
                    <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">Open</a> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'matches' && (
        <>
          {matches.length === 0 ? <div className="note">No investor matches yet.</div> :
            matches.map((m, i) => (
              <InvestorMatchCard
                key={m.introductionRequestId ?? m.investor?.id ?? i}
                match={m}
                busy={busy}
                onApprove={(x) => decide(x, 'approve')}
                onRequestInfo={(x) => decide(x, 'request_info')}
                onRequireNda={(x) => decide(x, 'require_nda')}
                onDecline={(x) => decide(x, 'decline')}
              />
            ))}
        </>
      )}

      {tab === 'pipeline' && pipeline && (
        <>
          <div className="two" style={{ marginBottom: 12 }}>
            <div><span className="note">Target raise</span><div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(pipeline.targetRaiseCents)}</div></div>
            <div><span className="note">Committed</span><div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(pipeline.committedCents)}</div></div>
          </div>
          <div className="card" style={{ padding: 0, marginBottom: 12 }}>
            <table>
              <thead><tr><th>Pipeline status</th><th>Count</th></tr></thead>
              <tbody>
                {Object.entries(pipeline.counts ?? {}).length === 0 ? (
                  <tr><td colSpan={2} className="note" style={{ padding: 12 }}>No pipeline activity yet.</td></tr>
                ) : Object.entries(pipeline.counts ?? {}).map(([k, v]) => (
                  <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {(pipeline.investors ?? []).length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Investor</th><th>Status</th><th>Committed</th></tr></thead>
                <tbody>
                  {(pipeline.investors ?? []).map((iv: any, i: number) => (
                    <tr key={iv.id ?? i}>
                      <td>{iv.entity_name || iv.full_name || iv.name || '-'}</td>
                      <td className="note">{(iv.pipeline_status ?? iv.status ?? '').replace(/_/g, ' ')}</td>
                      <td>{dollars(iv.committed_cents ?? iv.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
