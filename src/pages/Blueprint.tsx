/**
 * Divini Blueprint - upload plans, CAD files, specs, budgets, and photos for
 * a project. The platform classifies every document from its filename by
 * default, and can go further on request: reading a PDF's real text layer,
 * OCRing a scanned page or image, or reading a DXF's real text/layers
 * ("Extract content" per document) - never for binary CAD formats like
 * DWG/RVT/IFC, which still have no reader in this build. The platform then
 * suggests likely trade bid packages and drafts an editable preliminary
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
  extracted_text: string | null; extraction_method: string | null; extraction_error: string | null;
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
type Addendum = {
  id: string; title: string; description: string | null; status: string;
  affected_document_ids: string[]; affected_package_ids: string[];
  bid_deadline_extended_to: string | null; published_at: string | null;
  notified_at?: string | null; acknowledged_at?: string | null;
};
type RevisionMatch = { documentId: string; name: string; confidence: 'medium' | 'low' };

const DISCLAIMER = 'AI-generated preliminary project information. Review and approval by the project owner and appropriate licensed professionals are required before use.';

export default function Blueprint() {
  const { company } = useAuth();
  const companyId = company?.id;
  const isVendor = company?.kind === 'vendor';

  const [projects, setProjects] = useState<Project[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [currentRun, setCurrentRun] = useState<{ run: Run; summaryFields: SummaryField[]; tradeSuggestions: TradeSuggestion[] } | null>(null);
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [vendorAddenda, setVendorAddenda] = useState<Addendum[]>([]);
  const [revisionSuggestions, setRevisionSuggestions] = useState<Record<string, RevisionMatch[]>>({});
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [addendumTitle, setAddendumTitle] = useState('');
  const [addendumDescription, setAddendumDescription] = useState('');

  // Phase 2: CSI divisions, budget import/reconciliation, quantity observations.
  const [packages, setPackages] = useState<{ id: string; category: string }[]>([]);
  const [specIndex, setSpecIndex] = useState<{ specifications: any[]; missingDivisions: { code: string; name: string }[] } | null>(null);
  const [budgetImports, setBudgetImports] = useState<any[]>([]);
  const [currentBudgetImport, setCurrentBudgetImport] = useState<{ import: any; lines: any[] } | null>(null);
  const [reconciliation, setReconciliation] = useState<any | null>(null);
  const [quantities, setQuantities] = useState<any[]>([]);
  const [qDesc, setQDesc] = useState(''); const [qQty, setQQty] = useState(''); const [qUnit, setQUnit] = useState(''); const [qPackageId, setQPackageId] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [projectDescription, setProjectDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!isVendor || !companyId) return;
    apiGet<{ addenda: Addendum[] }>(`/blueprint/addenda/for-vendor?companyId=${companyId}`)
      .then((r) => setVendorAddenda(r.addenda))
      .catch(() => {});
  }, [isVendor, companyId]);

  async function acknowledgeAddendum(id: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/blueprint/addenda/${id}/acknowledge`, {});
      setOk('Acknowledged.');
      if (companyId) {
        const r = await apiGet<{ addenda: Addendum[] }>(`/blueprint/addenda/for-vendor?companyId=${companyId}`);
        setVendorAddenda(r.addenda);
      }
    } catch (e: any) {
      setErr(e.message ?? 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!companyId) return;
    apiGet<Project[]>(`/buildings?companyId=${companyId}`).then(setProjects).catch(() => {});
  }, [companyId]);

  async function loadDocuments() {
    if (!buildingId) return;
    setErr('');
    try {
      const [d, r, a] = await Promise.all([
        apiGet<{ documents: Doc[] }>(`/blueprint/documents?buildingId=${buildingId}`),
        apiGet<{ runs: Run[] }>(`/blueprint/runs?buildingId=${buildingId}`),
        apiGet<{ addenda: Addendum[] }>(`/blueprint/addenda?buildingId=${buildingId}`),
      ]);
      setDocuments(d.documents);
      setRuns(r.runs);
      setAddenda(a.addenda);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load documents.');
    }
  }

  useEffect(() => {
    void loadDocuments();
    void loadPhase2();
    setCurrentRun(null);
    setRevisionSuggestions({});
    setSelectedDocIds(new Set());
    setCurrentBudgetImport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  async function loadPhase2() {
    if (!buildingId) return;
    try {
      const [pkgs, spec, imports, recon, qty] = await Promise.all([
        apiGet<{ id: string; category: string }[]>(`/buildings/${buildingId}/packages`),
        apiGet<{ specifications: any[]; missingDivisions: { code: string; name: string }[] }>(`/blueprint/specification-index?buildingId=${buildingId}`),
        apiGet<{ imports: any[] }>(`/blueprint/budget-imports?buildingId=${buildingId}`),
        apiGet<any>(`/blueprint/budget-reconciliation?buildingId=${buildingId}`),
        apiGet<{ observations: any[] }>(`/blueprint/quantity-observations?buildingId=${buildingId}`),
      ]);
      setPackages(pkgs);
      setSpecIndex(spec);
      setBudgetImports(imports.imports);
      setReconciliation(recon);
      setQuantities(qty.observations);
    } catch { /* non-fatal */ }
  }

  async function extractContentFor(docId: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ document: Doc; extraction: { method: string; error?: string } }>(
        'POST', `/blueprint/documents/${docId}/extract-content`, {},
      );
      setOk(
        r.extraction.method === 'none' || r.extraction.method === 'failed'
          ? (r.extraction.error ?? 'Could not extract content from this file.')
          : `Extracted content via ${r.extraction.method.replace(/_/g, ' ')}. Reclassified if a match was found.`,
      );
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not extract content.');
    } finally {
      setBusy(false);
    }
  }

  async function guessCsiDivisionFor(docId: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('POST', `/blueprint/documents/${docId}/guess-csi-division`, {});
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not guess division.');
    } finally {
      setBusy(false);
    }
  }

  async function setCsiDivisionFor(docId: string, code: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/documents/${docId}/csi-division`, { csiDivisionCode: code || null });
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not set division.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadBudgetFile(f: File) {
    if (!companyId || !buildingId) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const isXlsx = /\.xlsx$/i.test(f.name);
      let result: { import: any; lines: any[] };
      if (isXlsx) {
        // XLSX is binary - upload it through the existing document endpoint
        // first, then have the server read it by documentId.
        const form = new FormData();
        form.append('file', f);
        form.append('companyId', companyId);
        form.append('buildingId', buildingId);
        const doc = await apiUpload<{ id: string }>('/documents', form);
        result = await apiSend('POST', '/blueprint/budget-imports', { buildingId, documentId: doc.id, filename: f.name });
      } else {
        const text = await f.text();
        result = await apiSend('POST', '/blueprint/budget-imports', { buildingId, csvText: text, filename: f.name });
      }
      setCurrentBudgetImport(result);
      setOk(`Imported ${result.lines.length} budget line${result.lines.length === 1 ? '' : 's'}.`);
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not import budget.');
    } finally {
      setBusy(false);
    }
  }

  async function loadBudgetImport(id: string) {
    setErr('');
    try {
      const r = await apiGet<{ import: any; lines: any[] }>(`/blueprint/budget-imports/${id}`);
      setCurrentBudgetImport(r);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load import.');
    }
  }

  async function reassignBudgetLine(lineId: string, packageId: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/budget-import-lines/${lineId}`, { matchedPackageId: packageId || null });
      if (currentBudgetImport) await loadBudgetImport(currentBudgetImport.import.id);
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not reassign.');
    } finally {
      setBusy(false);
    }
  }

  async function addQuantity() {
    if (!buildingId || !qDesc.trim() || !qQty) return;
    setBusy(true); setErr('');
    try {
      await apiSend('POST', '/blueprint/quantity-observations', {
        buildingId, description: qDesc.trim(), quantity: Number(qQty),
        unit: qUnit || undefined, packageId: qPackageId || undefined,
      });
      setQDesc(''); setQQty(''); setQUnit(''); setQPackageId('');
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not add quantity.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyQuantity(id: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/quantity-observations/${id}`, { verificationStatus: 'verified' });
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not verify.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuantity(id: string) {
    setBusy(true); setErr('');
    try {
      await apiSend('DELETE', `/blueprint/quantity-observations/${id}`, undefined);
      await loadPhase2();
    } catch (e: any) {
      setErr(e.message ?? 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  async function checkRevisionSuggestions(docId: string) {
    setErr('');
    try {
      const r = await apiGet<{ matches: RevisionMatch[] }>(`/blueprint/documents/${docId}/suggest-revision-of`);
      setRevisionSuggestions((prev) => ({ ...prev, [docId]: r.matches }));
    } catch (e: any) {
      setErr(e.message ?? 'Could not check for revisions.');
    }
  }

  async function linkRevision(docId: string, parentDocumentId: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/blueprint/documents/${docId}/link-revision`, { parentDocumentId });
      setOk('Linked as a revision.');
      setRevisionSuggestions((prev) => { const next = { ...prev }; delete next[docId]; return next; });
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not link revision.');
    } finally {
      setBusy(false);
    }
  }

  function toggleDocSelected(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createAddendum() {
    if (!buildingId || !addendumTitle.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/blueprint/addenda', {
        buildingId, title: addendumTitle.trim(),
        description: addendumDescription || undefined,
        documentIds: [...selectedDocIds],
      });
      setAddendumTitle(''); setAddendumDescription(''); setSelectedDocIds(new Set());
      setOk('Addendum created as a draft. Review it, then move it to review and publish when ready.');
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create addendum.');
    } finally {
      setBusy(false);
    }
  }

  async function setAddendumStatus(id: string, status: 'draft' | 'review') {
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/blueprint/addenda/${id}`, { status });
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update addendum.');
    } finally {
      setBusy(false);
    }
  }

  async function publishAddendum(id: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ notifiedVendorCompanies: number }>('POST', `/blueprint/addenda/${id}/publish`, {});
      setOk(`Published. Notified ${r.notifiedVendorCompanies} vendor compan${r.notifiedVendorCompanies === 1 ? 'y' : 'ies'} with an invite or bid on an affected package.`);
      await loadDocuments();
    } catch (e: any) {
      setErr(e.message ?? 'Could not publish addendum.');
    } finally {
      setBusy(false);
    }
  }

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

  if (isVendor) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Divini Blueprint - Addenda</h1>
            <div className="sub">Addenda published on projects you have been invited to bid on or have submitted a bid for.</div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok">{ok}</div>}
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Addendum</th><th>Description</th><th>Published</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {vendorAddenda.length === 0 ? (
                <tr><td colSpan={5} className="note" style={{ padding: 12 }}>No addenda have been published to you yet.</td></tr>
              ) : vendorAddenda.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td className="note" style={{ fontSize: 12 }}>{a.description}</td>
                  <td className="note">{a.published_at ? new Date(a.published_at).toLocaleDateString() : '-'}</td>
                  <td>{a.acknowledged_at ? <span className="badge b-green">Acknowledged</span> : <span className="badge b-amber">Needs acknowledgment</span>}</td>
                  <td>
                    {!a.acknowledged_at && (
                      <button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => acknowledgeAddendum(a.id)}>Acknowledge</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

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
              <thead><tr><th></th><th>File</th><th>Category</th><th>Discipline</th><th>Confidence</th><th></th><th>Content</th><th>Revision</th></tr></thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr><td colSpan={8} className="note" style={{ padding: 12 }}>No documents uploaded yet.</td></tr>
                ) : documents.map((d) => (
                  <tr key={d.id}>
                    <td><input type="checkbox" checked={selectedDocIds.has(d.id)} onChange={() => toggleDocSelected(d.id)} title="Select for a new addendum" /></td>
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
                    <td><span className={`badge ${d.classification_confidence === 'high' ? 'b-green' : d.classification_confidence === 'medium' ? 'b-amber' : 'b-neutral'}`}>{d.classification_confidence ?? '-'}</span></td>
                    <td className="note">{d.processing_status}</td>
                    <td>
                      {d.extraction_method && d.extraction_method !== 'none' && d.extraction_method !== 'failed' ? (
                        <span className="badge b-green" title={d.extracted_text ?? ''}>{d.extraction_method.replace(/_/g, ' ')}</span>
                      ) : (
                        <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => extractContentFor(d.id)} title={d.extraction_error ?? ''}>
                          Extract content
                        </button>
                      )}
                    </td>
                    <td>
                      {revisionSuggestions[d.id] === undefined ? (
                        <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => checkRevisionSuggestions(d.id)}>Check for revision of…</button>
                      ) : revisionSuggestions[d.id].length === 0 ? (
                        <span className="note" style={{ fontSize: 11 }}>No filename match found</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {revisionSuggestions[d.id].map((m) => (
                            <button key={m.documentId} className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => linkRevision(d.id, m.documentId)}>
                              Revision of "{m.name}" ({m.confidence})
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Addenda</div>
            <div className="note" style={{ fontSize: 12, marginBottom: 8 }}>
              Select revised or new documents above with the checkboxes, then draft an addendum. Nothing is sent to
              vendors until you move it to review and click Publish - publishing notifies every vendor company
              invited to or already bidding on an affected package.
            </div>
            <div className="two">
              <div className="field"><label>Title</label>
                <input value={addendumTitle} onChange={(e) => setAddendumTitle(e.target.value)} placeholder="e.g. Addendum 1 - revised electrical plan" />
              </div>
              <div className="field"><label>Description</label>
                <input value={addendumDescription} onChange={(e) => setAddendumDescription(e.target.value)} placeholder="What changed and why" />
              </div>
            </div>
            <button className="btn primary" disabled={busy || !addendumTitle.trim()} onClick={createAddendum}>
              Create draft addendum from {selectedDocIds.size} selected document{selectedDocIds.size === 1 ? '' : 's'}
            </button>

            {addenda.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Title</th><th>Documents</th><th>Packages</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {addenda.map((a) => (
                    <tr key={a.id}>
                      <td>{a.title}</td>
                      <td className="note">{a.affected_document_ids.length}</td>
                      <td className="note">{a.affected_package_ids.length}</td>
                      <td>
                        <span className={`badge ${a.status === 'published' ? 'b-green' : a.status === 'review' ? 'b-amber' : 'b-neutral'}`}>{a.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {a.status === 'draft' && (
                            <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => setAddendumStatus(a.id, 'review')}>Move to review</button>
                          )}
                          {a.status === 'review' && (
                            <>
                              <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => setAddendumStatus(a.id, 'draft')}>Back to draft</button>
                              <button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => publishAddendum(a.id)}>Publish</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Specification index / CSI divisions */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Specification index (CSI divisions)</div>
            <div className="note" style={{ fontSize: 12, marginBottom: 8 }}>
              Division guesses come from each document's already-classified discipline, not from reading the
              specification text - always low confidence, always correctable.
            </div>
            {specIndex && specIndex.missingDivisions.length > 0 && (
              <div className="note" style={{ marginBottom: 10 }}>
                <strong>Possibly missing specification sections:</strong>{' '}
                {specIndex.missingDivisions.map((d) => `Division ${d.code} (${d.name})`).join(', ')}
              </div>
            )}
            {(!specIndex || specIndex.specifications.length === 0) ? (
              <div className="note">No documents classified as "specification" yet.</div>
            ) : (
              <table>
                <thead><tr><th>Document</th><th>Discipline</th><th>CSI Division</th><th></th></tr></thead>
                <tbody>
                  {specIndex.specifications.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="note">{s.discipline?.replace(/_/g, ' ') ?? '-'}</td>
                      <td>
                        <select value={s.csi_division_code ?? ''} onChange={(e) => setCsiDivisionFor(s.id, e.target.value)}>
                          <option value="">Not set</option>
                          {['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14',
                            '21', '22', '23', '25', '26', '27', '28', '31', '32', '33'].map((c) => (
                            <option key={c} value={c}>Division {c}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {!s.csi_division_overridden_by_user && (
                          <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => guessCsiDivisionFor(s.id)}>Guess</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Budget import (CSV or XLSX) and reconciliation */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Budget import (CSV or XLSX)</div>
            <div className="note" style={{ fontSize: 12, marginBottom: 8 }}>
              The legacy .xls format is not supported - re-save as .xlsx or .csv. Each row is matched to an existing
              package by keyword overlap; nothing is applied without you being able to see and change the match.
            </div>
            <input type="file" accept=".csv,text/csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBudgetFile(f); e.target.value = ''; }} disabled={busy} />
            {budgetImports.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span className="note">Previous imports: </span>
                {budgetImports.map((im: any) => (
                  <button key={im.id} className="btn" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 4 }} onClick={() => loadBudgetImport(im.id)}>
                    {im.filename ?? new Date(im.created_at).toLocaleDateString()} ({im.row_count})
                  </button>
                ))}
              </div>
            )}
            {currentBudgetImport && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th>Matched package</th><th>Status</th></tr></thead>
                <tbody>
                  {currentBudgetImport.lines.map((l: any) => (
                    <tr key={l.id}>
                      <td className="note">{l.raw_category || '-'}</td>
                      <td className="note">{l.raw_description || '-'}</td>
                      <td>${(l.amount_cents / 100).toLocaleString()}</td>
                      <td>
                        <select value={l.matched_package_id ?? ''} onChange={(e) => reassignBudgetLine(l.id, e.target.value)}>
                          <option value="">Unmapped</option>
                          {packages.map((p) => <option key={p.id} value={p.id}>{p.category}</option>)}
                        </select>
                      </td>
                      <td><span className={`badge ${l.status === 'mapped' ? 'b-green' : l.status === 'ignored' ? 'b-neutral' : 'b-amber'}`}>{l.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reconciliation && (
              <div className="note" style={{ marginTop: 12, fontSize: 12 }}>
                {reconciliation.packagesMissingBudget.length > 0 && (
                  <div><strong>Packages with no imported budget:</strong> {reconciliation.packagesMissingBudget.map((p: any) => p.category).join(', ')}</div>
                )}
                {reconciliation.unmappedLines.length > 0 && (
                  <div style={{ marginTop: 4 }}><strong>{reconciliation.unmappedLines.length}</strong> budget line(s) across all imports are still unmapped to any package.</div>
                )}
              </div>
            )}
          </div>

          {/* Quantity observations - manual only, never AI-generated */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Quantity observations</div>
            <div className="note" style={{ fontSize: 12, marginBottom: 8 }}>
              Manual entry only - this build cannot read drawing content, so it never estimates a quantity for you.
              Use this to record and share preliminary counts you have measured or been given.
            </div>
            <div className="two">
              <div className="field"><label>Description</label><input value={qDesc} onChange={(e) => setQDesc(e.target.value)} placeholder="e.g. Exterior doors" /></div>
              <div className="field"><label>Package (optional)</label>
                <select value={qPackageId} onChange={(e) => setQPackageId(e.target.value)}>
                  <option value="">None</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.category}</option>)}
                </select>
              </div>
            </div>
            <div className="two">
              <div className="field"><label>Quantity</label><input value={qQty} onChange={(e) => setQQty(e.target.value)} placeholder="0" /></div>
              <div className="field"><label>Unit</label><input value={qUnit} onChange={(e) => setQUnit(e.target.value)} placeholder="ea / sf / lf" /></div>
            </div>
            <button className="btn primary" disabled={busy || !qDesc.trim() || !qQty} onClick={addQuantity}>+ Add observation</button>

            {quantities.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Description</th><th>Quantity</th><th>Package</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {quantities.map((q: any) => (
                    <tr key={q.id}>
                      <td>{q.description}</td>
                      <td>{q.quantity} {q.unit || ''}</td>
                      <td className="note">{packages.find((p) => p.id === q.package_id)?.category ?? '-'}</td>
                      <td><span className={`badge ${q.verification_status === 'verified' ? 'b-green' : 'b-neutral'}`}>{q.verification_status}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {q.verification_status !== 'verified' && (
                            <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => verifyQuantity(q.id)}>Verify</button>
                          )}
                          <button className="btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--red)' }} disabled={busy} onClick={() => deleteQuantity(q.id)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
