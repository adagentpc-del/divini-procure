/**
 * Divini Blueprint - upload plans, CAD files, specs, budgets, and photos for
 * a project; the platform classifies what was uploaded (by filename/
 * extension, not file content - this codebase has no CAD/OCR parser),
 * suggests likely trade bid packages, and drafts an editable preliminary
 * project summary. Every suggestion requires review before it becomes a
 * real Divini Scope Builder scope, Divini Pipeline opportunity, or bid
 * package. Nothing here publishes automatically.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend, apiUpload } from '../lib/api';

type Project = { id: string; name?: string };
type Doc = {
  id: string; name: string; document_category: string | null; discipline: string | null;
  classification_confidence: string | null; processing_status: string; created_at: string;
};
type SummaryField = {
  id: string; field_key: string; field_label: string; suggested_value: string | null;
  source_note: string | null; confidence: string; user_confirmed: boolean; user_edited_value: string | null;
};
type TradeSuggestion = {
  id: string; trade_category: string; package_title: string; rationale: string | null;
  confidence: string; supporting_document_count: number; status: string;
  created_package_id: string | null; created_scope_instance_id: string | null;
};
type Run = { id: string; status: string; used_ai: boolean; created_at: string };

const DISCLAIMER = 'AI-generated preliminary project information. Review and approval by the project owner and appropriate licensed professionals are required before use.';

export default function Blueprint() {
  const { company } = useAuth();
  const companyId = company?.id;

  const [projects, setProjects] = useState<Project[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [currentRun, setCurrentRun] = useState<{ run: Run; summaryFields: SummaryField[]; tradeSuggestions: TradeSuggestion[] } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [projectDescription, setProjectDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!companyId) return;
    apiGet<Project[]>(`/buildings?companyId=${companyId}`).then(setProjects).catch(() => {});
  }, [companyId]);

  async function loadDocuments() {
    if (!buildingId) return;
    setErr('');
    try {
      const [d, r] = await Promise.all([
        apiGet<{ documents: Doc[] }>(`/blueprint/documents?buildingId=${buildingId}`),
        apiGet<{ runs: Run[] }>(`/blueprint/runs?buildingId=${buildingId}`),
      ]);
      setDocuments(d.documents);
      setRuns(r.runs);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load documents.');
    }
  }

  useEffect(() => {
    void loadDocuments();
    setCurrentRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  async function upload() {
    if (!companyId || !buildingId || !file) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('companyId', companyId);
      form.append('buildingId', buildingId);
      const doc = await apiUpload<{ id: string }>('/documents', form);
      await apiSend('POST', `/blueprint/documents/${doc.id}/classify`, {});
      setFile(null);
      setOk('Uploaded and classified.');
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not upload.');
    } finally {
      setBusy(false);
    }
  }

  async function overrideCategory(docId: string, documentCategory: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/documents/${docId}`, { documentCategory });
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis() {
    if (!buildingId) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const result = await apiSend<{ run: Run; summaryFields: SummaryField[]; tradeSuggestions: TradeSuggestion[] }>(
        'POST', '/blueprint/analyze', { buildingId, projectDescription: projectDescription || undefined },
      );
      setCurrentRun(result);
      setOk('Analysis complete. Review every field below before creating anything from it.');
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not run analysis.');
    } finally {
      setBusy(false);
    }
  }

  async function loadRun(id: string) {
    setErr('');
    try {
      const result = await apiGet<{ run: Run; summaryFields: SummaryField[]; tradeSuggestions: TradeSuggestion[] }>(`/blueprint/runs/${id}`);
      setCurrentRun(result);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load run.');
    }
  }

  async function confirmField(id: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/summary-fields/${id}`, { userConfirmed: true });
      if (currentRun) await loadRun(currentRun.run.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not confirm.');
    } finally {
      setBusy(false);
    }
  }

  async function setSuggestionStatus(id: string, status: 'accepted' | 'rejected') {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/trade-suggestions/${id}`, { status });
      if (currentRun) await loadRun(currentRun.run.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not update suggestion.');
    } finally {
      setBusy(false);
    }
  }

  async function createFrom(id: string, kind: 'package' | 'scope') {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/blueprint/trade-suggestions/${id}/create-${kind}`, {});
      setOk(`Created a ${kind === 'package' ? 'bid package' : 'Divini Scope Builder scope'}.`);
      if (currentRun) await loadRun(currentRun.run.id);
    } catch (e: any) {
      setErr(e.message ?? `Could not create ${kind}.`);
    } finally {
      setBusy(false);
    }
  }

  async function createOpportunity() {
    if (!currentRun) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/blueprint/runs/${currentRun.run.id}/create-opportunity`, {});
      setOk('Created a Divini Pipeline opportunity for this project.');
    } catch (e: any) {
      setErr(e.message ?? 'Could not create opportunity.');
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return <div className="card">Sign in to use Divini Blueprint.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Blueprint</h1>
          <div className="sub">Upload plans, CAD files, specs, and budgets. Review what's identified before publishing anything.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field"><label>Project</label>
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
        </div>
      </div>

      {buildingId && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Upload a file</div>
            <div className="two">
              <div className="field"><label>File</label><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn primary" disabled={busy || !file} onClick={upload}>Upload &amp; classify</button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <table>
              <thead><tr><th>File</th><th>Category</th><th>Discipline</th><th>Confidence</th><th></th></tr></thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr><td colSpan={5} className="note" style={{ padding: 12 }}>No documents uploaded yet.</td></tr>
                ) : documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>
                      <select value={d.document_category ?? ''} onChange={(e) => overrideCategory(d.id, e.target.value)}>
                        {['drawing', 'specification', 'schedule', 'budget', 'estimate', 'survey', 'geotechnical_report',
                          'environmental_report', 'permit', 'contract', 'photo', 'rendering', 'addendum', 'other'].map((c) => (
                          <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </td>
                    <td className="note">{d.discipline?.replace(/_/g, ' ') ?? '-'}</td>
                    <td><span className={`badge ${d.classification_confidence === 'medium' ? 'b-amber' : 'b-neutral'}`}>{d.classification_confidence ?? '-'}</span></td>
                    <td className="note">{d.processing_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Run analysis</div>
            <div className="field"><label>Project description (optional - helps the AI draft, if configured)</label>
              <textarea rows={2} value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} />
            </div>
            <button className="btn primary" disabled={busy || documents.length === 0} onClick={runAnalysis}>Run analysis</button>
            {runs.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span className="note">Previous runs: </span>
                {runs.map((r) => (
                  <button key={r.id} className="btn" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 4 }} onClick={() => void loadRun(r.id)}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {currentRun && (
            <>
              <div className="card" style={{ marginBottom: 16, background: 'var(--ivory)', borderStyle: 'dashed' }}>
                <strong>{DISCLAIMER}</strong>
              </div>

              <div className="sectitle">Project summary (editable)</div>
              <div className="card" style={{ padding: 0, marginBottom: 16 }}>
                <table>
                  <thead><tr><th>Field</th><th>Value</th><th>Confidence</th><th>Source</th><th></th></tr></thead>
                  <tbody>
                    {currentRun.summaryFields.map((f) => (
                      <tr key={f.id}>
                        <td>{f.field_label}</td>
                        <td>{f.user_edited_value ?? f.suggested_value}</td>
                        <td><span className={`badge ${f.confidence === 'high' ? 'b-green' : f.confidence === 'medium' ? 'b-amber' : 'b-neutral'}`}>{f.confidence.replace(/_/g, ' ')}</span></td>
                        <td className="note" style={{ fontSize: 11 }}>{f.source_note}</td>
                        <td>
                          {f.user_confirmed ? <span className="badge b-green">Confirmed</span> : (
                            <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => confirmField(f.id)}>Confirm</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sectitle">Suggested trade packages</div>
              <div className="card" style={{ padding: 0, marginBottom: 16 }}>
                <table>
                  <thead><tr><th>Package</th><th>Rationale</th><th>Confidence</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {currentRun.tradeSuggestions.length === 0 ? (
                      <tr><td colSpan={5} className="note" style={{ padding: 12 }}>No trade packages could be inferred from the disciplines uploaded.</td></tr>
                    ) : currentRun.tradeSuggestions.map((t) => (
                      <tr key={t.id}>
                        <td>{t.package_title}</td>
                        <td className="note" style={{ fontSize: 12 }}>{t.rationale}</td>
                        <td><span className={`badge ${t.confidence === 'medium' ? 'b-amber' : 'b-neutral'}`}>{t.confidence}</span></td>
                        <td><span className="badge b-neutral">{t.status}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {t.status === 'suggested' && (
                              <>
                                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSuggestionStatus(t.id, 'accepted')}>Accept</button>
                                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSuggestionStatus(t.id, 'rejected')}>Reject</button>
                              </>
                            )}
                            {t.status === 'accepted' && !t.created_package_id && (
                              <button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => createFrom(t.id, 'package')}>Create package</button>
                            )}
                            {t.status === 'accepted' && !t.created_scope_instance_id && (
                              <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => createFrom(t.id, 'scope')}>Create scope</button>
                            )}
                            {t.created_package_id && <span className="badge b-green">Package created</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn" disabled={busy} onClick={createOpportunity}>Create a Divini Pipeline opportunity for this project</button>
            </>
          )}
        </>
      )}
    </>
  );
}
