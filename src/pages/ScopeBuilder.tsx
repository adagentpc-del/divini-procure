/**
 * Divini Scope Builder - structured procurement requirement definitions for a
 * bid package. Trade-specific fields come from a template (typed, not free
 * text); standard narrative sections (site conditions, access, delivery/
 * install, exclusions, acceptance criteria, change-order rules) apply to
 * every scope. Completeness is a deterministic score, always shown with its
 * factor breakdown, never a gate on publishing.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Template = { id: string; organization_id: string | null; category: string; name: string };
type TemplateField = {
  id: string; field_key: string; label: string; field_type: string;
  unit: string | null; options: string[] | null; required: boolean; section: string | null;
};
type Instance = {
  id: string; organization_id: string; package_id: string | null; template_id: string | null;
  category: string; title: string; status: 'draft' | 'published' | 'archived'; current_version: number;
  site_conditions: string | null; access_restrictions: string | null;
  delivery_requirements: string | null; install_requirements: string | null;
  exclusions: string[]; acceptance_criteria: string[]; change_order_rules: string | null;
  updated_at: string;
};
type ScopeResponse = { field_key: string; value_text: string | null; value_number: number | null; value_bool: boolean | null; value_date: string | null; value_json: unknown };
type Completeness = { score: number; positives: string[]; missing: string[] };
type Version = { id: string; version_number: number; change_summary: string | null; created_at: string };
type ChangeEvent = { id: string; event_type: string; created_at: string };

function responseValue(r: ScopeResponse | undefined): string {
  if (!r) return '';
  if (r.value_text != null) return r.value_text;
  if (r.value_number != null) return String(r.value_number);
  if (r.value_bool != null) return r.value_bool ? 'true' : 'false';
  if (r.value_date != null) return r.value_date;
  if (r.value_json != null) return typeof r.value_json === 'string' ? r.value_json : JSON.stringify(r.value_json);
  return '';
}

export default function ScopeBuilder() {
  const { company } = useAuth();
  const companyId = company?.id;

  const [instances, setInstances] = useState<Instance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newPackageId, setNewPackageId] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    instance: Instance; fields: TemplateField[]; responses: ScopeResponse[];
    completeness: Completeness; versions: Version[]; changeEvents: ChangeEvent[];
  } | null>(null);
  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({});
  const [exclusionDraft, setExclusionDraft] = useState('');
  const [criteriaDraft, setCriteriaDraft] = useState('');

  async function loadList() {
    if (!companyId) return;
    setErr('');
    try {
      const [i, t] = await Promise.all([
        apiGet<{ instances: Instance[] }>(`/scope/instances?companyId=${companyId}`),
        apiGet<{ templates: Template[] }>(`/scope/templates?companyId=${companyId}`),
      ]);
      setInstances(i.instances);
      setTemplates(t.templates);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load scopes.');
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadDetail(id: string) {
    setErr('');
    try {
      const d = await apiGet<{
        instance: Instance; fields: TemplateField[]; responses: ScopeResponse[];
        completeness: Completeness; versions: Version[]; changeEvents: ChangeEvent[];
      }>(`/scope/instances/${id}`);
      setDetail(d);
      setSelectedId(id);
      const draft: Record<string, string> = {};
      for (const f of d.fields) draft[f.field_key] = responseValue(d.responses.find((r) => r.field_key === f.field_key));
      setResponseDraft(draft);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load scope.');
    }
  }

  async function createInstance() {
    if (!companyId || !newTitle.trim() || !newCategory.trim()) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const created = await apiSend<{ instance: Instance }>('POST', '/scope/instances', {
        companyId,
        category: newCategory.trim(),
        title: newTitle.trim(),
        templateId: newTemplateId || undefined,
        packageId: newPackageId || undefined,
      });
      setNewTitle(''); setNewCategory(''); setNewTemplateId(''); setNewPackageId('');
      setShowNew(false);
      setOk('Scope created.');
      await loadList();
      await loadDetail(created.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not create scope.');
    } finally {
      setBusy(false);
    }
  }

  async function saveStandardFields() {
    if (!detail) return;
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/scope/instances/${detail.instance.id}`, {
        siteConditions: detail.instance.site_conditions,
        accessRestrictions: detail.instance.access_restrictions,
        deliveryRequirements: detail.instance.delivery_requirements,
        installRequirements: detail.instance.install_requirements,
        changeOrderRules: detail.instance.change_order_rules,
      });
      setOk('Saved.');
      await loadDetail(detail.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function saveResponses() {
    if (!detail) return;
    setBusy(true); setErr('');
    try {
      const responses = detail.fields.map((f) => ({ fieldKey: f.field_key, value: responseDraft[f.field_key] ?? '' }));
      await apiSend('PUT', `/scope/instances/${detail.instance.id}/responses`, { responses });
      setOk('Field answers saved.');
      await loadDetail(detail.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not save field answers.');
    } finally {
      setBusy(false);
    }
  }

  async function addExclusion() {
    if (!detail || !exclusionDraft.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/scope/instances/${detail.instance.id}`, {
        exclusions: [...detail.instance.exclusions, exclusionDraft.trim()],
      });
      setExclusionDraft('');
      await loadDetail(detail.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not add exclusion.');
    } finally {
      setBusy(false);
    }
  }

  async function addCriteria() {
    if (!detail || !criteriaDraft.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend('PATCH', `/scope/instances/${detail.instance.id}`, {
        acceptanceCriteria: [...detail.instance.acceptance_criteria, criteriaDraft.trim()],
      });
      setCriteriaDraft('');
      await loadDetail(detail.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not add acceptance criteria.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!detail) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const path = detail.instance.status === 'published' ? 'republish' : 'publish';
      await apiSend('POST', `/scope/instances/${detail.instance.id}/${path}`, {});
      setOk(path === 'publish' ? 'Scope published.' : 'Scope republished with a new version.');
      await loadList();
      await loadDetail(detail.instance.id);
    } catch (e: any) {
      setErr(e.message ?? 'Could not publish.');
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return <div className="card">Sign in to use Divini Scope Builder.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Divini Scope Builder</h1>
          <div className="sub">Define exactly what is being purchased, delivered, and installed, before it goes out to vendors.</div>
        </div>
        <button className="btn primary" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Cancel' : '+ New scope'}</button>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="two">
            <div className="field"><label>Title</label><input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Electrical - Building A" /></div>
            <div className="field"><label>Category</label><input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. electrical" /></div>
            <div className="field"><label>Template (optional)</label>
              <select value={newTemplateId} onChange={(e) => setNewTemplateId(e.target.value)}>
                <option value="">No template - narrative only</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
              </select>
            </div>
            <div className="field"><label>Bid package ID (optional)</label><input value={newPackageId} onChange={(e) => setNewPackageId(e.target.value)} placeholder="link to an existing package" /></div>
          </div>
          <button className="btn primary" disabled={busy || !newTitle.trim() || !newCategory.trim()} onClick={createInstance}>Create</button>
        </div>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Version</th><th></th></tr></thead>
          <tbody>
            {instances.length === 0 ? (
              <tr><td colSpan={5} className="note" style={{ padding: 12 }}>No scopes yet.</td></tr>
            ) : instances.map((i) => (
              <tr key={i.id}>
                <td>{i.title}</td>
                <td className="note">{i.category}</td>
                <td><span className={`badge ${i.status === 'published' ? 'b-green' : i.status === 'archived' ? 'b-neutral' : 'b-amber'}`}>{i.status}</span></td>
                <td className="note">{i.current_version || '-'}</td>
                <td><button className="btn" onClick={() => void loadDetail(i.id)}>{selectedId === i.id ? 'Selected' : 'Open'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card">
          <div className="page-head" style={{ marginTop: 0 }}>
            <div>
              <h3 style={{ margin: 0 }}>{detail.instance.title}</h3>
              <div className="sub">{detail.instance.category} · v{detail.instance.current_version || 0} · {detail.instance.status}</div>
            </div>
            <button className="btn primary" disabled={busy} onClick={publish}>
              {detail.instance.status === 'published' ? 'Republish (new version)' : 'Publish'}
            </button>
          </div>

          <div className="card" style={{ background: 'var(--ivory)', marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700 }}>Completeness: {detail.completeness.score}/100</div>
            <div className="note" style={{ fontSize: 12.5, marginTop: 4 }}>
              {detail.completeness.positives.map((p) => <div key={p}>+ {p}</div>)}
              {detail.completeness.missing.map((m) => <div key={m} style={{ color: 'var(--amber, #9a6a00)' }}>- {m}</div>)}
            </div>
          </div>

          {detail.fields.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Trade requirements</div>
              <div className="two">
                {detail.fields.map((f) => (
                  <div className="field" key={f.field_key}>
                    <label>{f.label}{f.required && ' *'}{f.unit && ` (${f.unit})`}</label>
                    {f.field_type === 'boolean' ? (
                      <select value={responseDraft[f.field_key] ?? ''} onChange={(e) => setResponseDraft((d) => ({ ...d, [f.field_key]: e.target.value }))}>
                        <option value="">Select…</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : f.field_type === 'select' || f.field_type === 'multiselect' ? (
                      <select value={responseDraft[f.field_key] ?? ''} onChange={(e) => setResponseDraft((d) => ({ ...d, [f.field_key]: e.target.value }))}>
                        <option value="">Select…</option>
                        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.field_type === 'number' || f.field_type === 'quantity' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                        value={responseDraft[f.field_key] ?? ''}
                        onChange={(e) => setResponseDraft((d) => ({ ...d, [f.field_key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
              <button className="btn" disabled={busy} onClick={saveResponses} style={{ marginTop: 8 }}>Save requirements</button>
            </div>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Site, access, delivery &amp; install</div>
            <div className="two">
              <div className="field"><label>Site conditions</label>
                <textarea rows={2} value={detail.instance.site_conditions ?? ''} onChange={(e) => setDetail({ ...detail, instance: { ...detail.instance, site_conditions: e.target.value } })} /></div>
              <div className="field"><label>Access restrictions</label>
                <textarea rows={2} value={detail.instance.access_restrictions ?? ''} onChange={(e) => setDetail({ ...detail, instance: { ...detail.instance, access_restrictions: e.target.value } })} /></div>
              <div className="field"><label>Delivery requirements</label>
                <textarea rows={2} value={detail.instance.delivery_requirements ?? ''} onChange={(e) => setDetail({ ...detail, instance: { ...detail.instance, delivery_requirements: e.target.value } })} /></div>
              <div className="field"><label>Install requirements</label>
                <textarea rows={2} value={detail.instance.install_requirements ?? ''} onChange={(e) => setDetail({ ...detail, instance: { ...detail.instance, install_requirements: e.target.value } })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Change-order rules</label>
                <textarea rows={2} value={detail.instance.change_order_rules ?? ''} onChange={(e) => setDetail({ ...detail, instance: { ...detail.instance, change_order_rules: e.target.value } })} /></div>
            </div>
            <button className="btn" disabled={busy} onClick={saveStandardFields} style={{ marginTop: 8 }}>Save</button>
          </div>

          <div className="two" style={{ marginBottom: 14 }}>
            <div className="card">
              <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Exclusions</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {detail.instance.exclusions.map((ex, idx) => <li key={idx} className="note">{ex}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={exclusionDraft} onChange={(e) => setExclusionDraft(e.target.value)} placeholder="e.g. Permits by developer" style={{ flex: 1 }} />
                <button className="btn" disabled={busy || !exclusionDraft.trim()} onClick={addExclusion}>Add</button>
              </div>
            </div>
            <div className="card">
              <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Acceptance criteria</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {detail.instance.acceptance_criteria.map((ac, idx) => <li key={idx} className="note">{ac}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={criteriaDraft} onChange={(e) => setCriteriaDraft(e.target.value)} placeholder="e.g. Passes final inspection" style={{ flex: 1 }} />
                <button className="btn" disabled={busy || !criteriaDraft.trim()} onClick={addCriteria}>Add</button>
              </div>
            </div>
          </div>

          {detail.versions.length > 0 && (
            <div className="card">
              <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Version history</div>
              {detail.versions.map((v) => (
                <div key={v.id} className="note" style={{ fontSize: 12.5 }}>
                  v{v.version_number} · {new Date(v.created_at).toLocaleString()}{v.change_summary && ` · ${v.change_summary}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
