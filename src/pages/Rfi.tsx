import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { apiGet, apiSend } from '../lib/api';
import { getBuildings, getPackages } from '../lib/db';

/**
 * RFI (Request for Information) workflow (fresh competitive scan,
 * 2026-08-17 - docs/competitive-analysis-2026-08.md: a tracked, assignable
 * RFI log is baseline project-communication infrastructure across every
 * general-purpose competitor and was entirely absent from this codebase).
 * Talks to server/src/routes/rfi.ts. Bidirectional: a vendor with an active
 * award asks a question and may close it; a developer answers it. One page
 * adapts by company.kind, same shape as DeliveryTracking.tsx's dual-role UI.
 */

type Site = { id: string; name: string; location: string | null };
type PackageRow = { id: string; category?: string | null; name?: string | null };
type Rfi = {
  id: string; building_id: string; package_id: string | null;
  vendor_company_id: string; developer_company_id: string | null;
  rfi_number: string | null; subject: string; question: string;
  status: 'open' | 'answered' | 'closed';
  answer: string | null; answered_by_email: string | null; answered_at: string | null;
  due_date: string | null; asked_by_email: string | null; created_at: string;
};

const STATUS_CLS: Record<string, string> = {
  open: 'badge b-amber',
  answered: 'badge b-green',
  closed: 'badge b-neutral',
};
const statusCls = (s: string) => STATUS_CLS[s] ?? 'badge b-neutral';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function RfiPage() {
  const { company } = useAuth();
  const { toast } = useToast();
  const isVendor = company?.kind === 'vendor';

  const [buildings, setBuildings] = useState<Site[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [rows, setRows] = useState<Rfi[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [err, setErr] = useState('');

  // vendor: ask-a-question form
  const [showAskForm, setShowAskForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [packageId, setPackageId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [asking, setAsking] = useState(false);

  // developer: per-row answer draft
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    setBuildingsLoading(true);
    const load = isVendor
      ? apiGet<{ sites: Site[] }>(`/field-log/my-sites?companyId=${encodeURIComponent(company.id)}`).then((d) => d.sites ?? [])
      : getBuildings(company.id).then((bs: any) => bs ?? []);
    load
      .then((bs) => {
        setBuildings(bs);
        if (bs.length === 1) setBuildingId(bs[0].id);
        else if (!buildingId && bs.length) setBuildingId(bs[0].id);
      })
      .catch((e: any) => setErr(e.message ?? 'Could not load projects.'))
      .finally(() => setBuildingsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  async function load() {
    if (!buildingId) { setRows([]); return; }
    setRowsLoading(true); setErr('');
    try {
      const d = await apiGet<{ rfis: Rfi[] }>(`/rfis?buildingId=${encodeURIComponent(buildingId)}`);
      setRows(d.rfis ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load RFIs.'); }
    finally { setRowsLoading(false); }
    if (isVendor) {
      try { setPackages((await getPackages(buildingId)) ?? []); } catch { setPackages([]); }
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [buildingId]);

  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!company || !buildingId || !subject.trim() || !question.trim()) return;
    setAsking(true); setErr('');
    try {
      await apiSend('POST', '/rfis', {
        buildingId, vendorCompanyId: company.id,
        packageId: packageId || undefined,
        subject: subject.trim(), question: question.trim(),
        dueDate: dueDate || undefined,
      });
      toast('RFI submitted.', 'success');
      setSubject(''); setQuestion(''); setPackageId(''); setDueDate(''); setShowAskForm(false);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not submit the RFI.');
    } finally {
      setAsking(false);
    }
  }

  async function saveAnswer(id: string) {
    const answer = (answerDraft[id] || '').trim();
    if (!answer) return;
    setBusyId(id); setErr('');
    try {
      await apiSend('PATCH', `/rfis/${id}`, { answer });
      toast('Answer sent.', 'success');
      setAnswerDraft((d) => ({ ...d, [id]: '' }));
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save the answer.');
    } finally {
      setBusyId(null);
    }
  }

  async function closeRfi(id: string) {
    setBusyId(id); setErr('');
    try {
      await apiSend('PATCH', `/rfis/${id}`, { status: 'closed' });
      toast('RFI closed.', 'success');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not close the RFI.');
    } finally {
      setBusyId(null);
    }
  }

  if (!company) return null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>RFIs</h1>
          <div className="sub">
            {isVendor
              ? 'Ask the developer a question about a project you hold an active award on.'
              : 'Questions raised by your vendors, tracked to a close.'}
          </div>
        </div>
        {isVendor && buildingId && (
          <button className="btn primary" onClick={() => setShowAskForm(!showAskForm)}>
            {showAskForm ? 'Cancel' : '+ New RFI'}
          </button>
        )}
      </div>

      {buildingsLoading && <div className="note">Loading projects…</div>}
      {!buildingsLoading && buildings.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="note">
            {isVendor ? 'No active job sites yet. This appears once a developer awards you a package.' : 'No projects yet.'}
          </p>
        </div>
      )}

      {!buildingsLoading && buildings.length > 1 && (
        <div className="field" style={{ maxWidth: 340 }}>
          <label>Project</label>
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Select a project…</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.location ? ` - ${b.location}` : ''}</option>
            ))}
          </select>
        </div>
      )}

      {err && <div className="err">{err}</div>}

      {buildingId && showAskForm && (
        <div className="card">
          <form onSubmit={submitAsk}>
            <div className="field">
              <label>Subject *</label>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required placeholder="e.g. Conflicting dimensions on sheet A-201" />
            </div>
            <div className="field">
              <label>Question *</label>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} required placeholder="Describe the question in full." />
            </div>
            <div className="two">
              {packages.length > 0 && (
                <div className="field">
                  <label>Package (optional)</label>
                  <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                    <option value="">General - not package-specific</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>{p.category || p.name || p.id}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Response needed by (optional)</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn primary" disabled={asking}>
              {asking ? 'Submitting…' : 'Submit RFI'}
            </button>
          </form>
        </div>
      )}

      {buildingId && (
        <>
          {rowsLoading && <div className="note">Loading…</div>}
          {!rowsLoading && rows.length === 0 && <div className="note">No RFIs yet for this project.</div>}
          {!rowsLoading && rows.map((r) => (
            <div key={r.id} className="card" style={{ marginBottom: 12 }}>
              <div className="page-head" style={{ marginBottom: 8 }}>
                <div>
                  <strong>{r.rfi_number ? `${r.rfi_number} - ` : ''}{r.subject}</strong>
                  <div className="note">
                    Asked {fmtDate(r.created_at)}{r.asked_by_email ? ` by ${r.asked_by_email}` : ''}
                    {r.due_date ? ` · due ${fmtDate(r.due_date)}` : ''}
                  </div>
                </div>
                <span className={statusCls(r.status)}>{r.status}</span>
              </div>
              <p>{r.question}</p>

              {r.answer && (
                <div className="note card" style={{ marginTop: 8 }}>
                  <strong>Answer</strong>{r.answered_by_email ? ` (${r.answered_by_email})` : ''}
                  {r.answered_at ? ` - ${fmtDate(r.answered_at)}` : ''}
                  <p style={{ margin: '6px 0 0' }}>{r.answer}</p>
                </div>
              )}

              {!isVendor && r.status !== 'closed' && (
                <div style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>{r.answer ? 'Update answer' : 'Answer'}</label>
                    <textarea
                      rows={2}
                      value={answerDraft[r.id] ?? ''}
                      onChange={(e) => setAnswerDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="Write a response…"
                    />
                  </div>
                  <button className="btn primary" disabled={busyId === r.id || !(answerDraft[r.id] || '').trim()} onClick={() => saveAnswer(r.id)}>
                    {busyId === r.id ? 'Saving…' : 'Send answer'}
                  </button>
                  {' '}
                  <button className="btn" disabled={busyId === r.id} onClick={() => closeRfi(r.id)}>
                    Close without answering
                  </button>
                </div>
              )}

              {isVendor && r.status !== 'closed' && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn" disabled={busyId === r.id} onClick={() => closeRfi(r.id)}>
                    {busyId === r.id ? 'Closing…' : 'Close RFI'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
