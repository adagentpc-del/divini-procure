import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFeatures } from '../lib/features';

type TimelinePhase = { phase?: string; weeks?: number };

type Template = {
  id: string;
  key: string;
  name: string;
  asset_type: string | null;
  description: string | null;
  suggested_bid_packages: string[];
  suggested_documents: string[];
  vendor_categories: string[];
  timeline: TimelinePhase[] | unknown;
  risk_flags: string[];
  investor_report_sections: string[];
  builtin: boolean;
};

type Building = { id: string; name: string; location?: string | null };

type ApplyResult = {
  applied: { buildingId: string; templateName: string };
  createdPackages: { id: string; category: string }[];
};

function phases(t: Template): TimelinePhase[] {
  return Array.isArray(t.timeline) ? (t.timeline as TimelinePhase[]) : [];
}

export default function ProjectTemplates() {
  const { company } = useAuth();
  const { isAdmin } = useFeatures();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [open, setOpen] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Apply state
  const [buildingId, setBuildingId] = useState('');
  const [createPackages, setCreatePackages] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  // Admin custom-template state
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const t = await apiGet<{ templates: Template[] }>('/project-templates');
      setTemplates(t.templates ?? []);
      if (company) {
        const b = await apiGet<Building[]>(
          `/buildings?companyId=${encodeURIComponent(company.id)}`,
        );
        setBuildings(b ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  function openTemplate(t: Template) {
    setOpen(t);
    setResult(null);
    setBuildingId(buildings[0]?.id ?? '');
    setCreatePackages(false);
  }

  async function apply() {
    if (!open || !buildingId) return;
    setApplying(true);
    setErr('');
    setResult(null);
    try {
      const res = await apiSend<ApplyResult>('POST', `/project-templates/${open.key}/apply`, {
        buildingId,
        createPackages,
      });
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to apply template');
    } finally {
      setApplying(false);
    }
  }

  // Group templates by asset_type for the browse grid
  const groups = templates.reduce<Record<string, Template[]>>((acc, t) => {
    const key = t.asset_type || 'Other';
    (acc[key] ||= []).push(t);
    return acc;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Project Templates</h1>
          <div className="sub">Asset-type procurement blueprints. Apply one to a project to seed bid packages, documents, and vendor categories.</div>
        </div>
        {isAdmin && (
          <button className="btn" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? 'Cancel' : '+ Custom template'}
          </button>
        )}
      </div>

      {err && <div className="note err" style={{ marginBottom: 12 }}>{err}</div>}

      {isAdmin && showAdd && (
        <AddTemplate
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
          onError={(m) => setErr(m)}
        />
      )}

      {/* ---- Detail view ---- */}
      {open && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>{open.name}</h2>
              <div className="sub">
                <span className="badge">{open.asset_type || 'Other'}</span>{' '}
                {!open.builtin && <span className="badge">Custom</span>}
              </div>
            </div>
            <button className="btn" onClick={() => setOpen(null)}>Close</button>
          </div>
          {open.description && <p className="note">{open.description}</p>}

          <div className="two">
            <div>
              <h3>Suggested bid packages</h3>
              <div>
                {open.suggested_bid_packages.map((c) => (
                  <span key={c} className="badge" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>{c}</span>
                ))}
              </div>

              <h3 style={{ marginTop: 14 }}>Suggested documents</h3>
              <ul>
                {open.suggested_documents.map((d) => <li key={d}>{d}</li>)}
              </ul>

              <h3 style={{ marginTop: 14 }}>Vendor categories</h3>
              <div>
                {open.vendor_categories.map((v) => (
                  <span key={v} className="badge" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>{v}</span>
                ))}
              </div>
            </div>

            <div>
              <h3>Timeline</h3>
              <table>
                <thead><tr><th>Phase</th><th>Weeks</th></tr></thead>
                <tbody>
                  {phases(open).map((p, i) => (
                    <tr key={i}><td>{p.phase}</td><td>{p.weeks}</td></tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ marginTop: 14 }}>Risk flags</h3>
              <ul>
                {open.risk_flags.map((r) => <li key={r}>{r}</li>)}
              </ul>

              <h3 style={{ marginTop: 14 }}>Investor report sections</h3>
              <div>
                {open.investor_report_sections.map((s) => (
                  <span key={s} className="badge ok" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>{s}</span>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Apply ---- */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Apply to one of my projects</h3>
            {buildings.length === 0 ? (
              <div className="note">No projects yet. Create a project first, then apply a template.</div>
            ) : (
              <>
                <div className="two">
                  <div className="field">
                    <label>Project</label>
                    <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                      {buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}{b.location ? ` - ${b.location}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>
                      <input
                        type="checkbox"
                        checked={createPackages}
                        onChange={(e) => setCreatePackages(e.target.checked)}
                      />{' '}
                      Create draft bid packages ({open.suggested_bid_packages.length})
                    </label>
                  </div>
                </div>
                <button className="btn primary" disabled={applying || !buildingId} onClick={apply}>
                  {applying ? 'Applying...' : 'Apply template'}
                </button>
              </>
            )}

            {result && (
              <div className="note ok" style={{ marginTop: 12 }}>
                Applied <strong>{result.applied.templateName}</strong>.{' '}
                {result.createdPackages.length > 0
                  ? `Created ${result.createdPackages.length} draft bid package(s): ${result.createdPackages.map((p) => p.category).join(', ')}.`
                  : 'No packages created (toggle was off). Suggestions returned above.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Browse grid ---- */}
      {loading ? (
        <div className="note">Loading...</div>
      ) : (
        Object.keys(groups).sort().map((assetType) => (
          <div key={assetType} style={{ marginBottom: 18 }}>
            <h2>{assetType}</h2>
            <div className="two">
              {groups[assetType].map((t) => (
                <div
                  key={t.id}
                  className="card row-click"
                  onClick={() => openTemplate(t)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{t.name}</strong>
                    {!t.builtin && <span className="badge">Custom</span>}
                  </div>
                  {t.description && <div className="note" style={{ marginTop: 6 }}>{t.description}</div>}
                  <div className="note" style={{ marginTop: 8 }}>
                    {t.suggested_bid_packages.length} bid packages &middot; {t.vendor_categories.length} vendor categories
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin: add a custom template
// ---------------------------------------------------------------------------
function AddTemplate({
  onSaved,
  onError,
}: {
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState('');
  const [description, setDescription] = useState('');
  const [bidPackages, setBidPackages] = useState('');
  const [documents, setDocuments] = useState('');
  const [vendorCategories, setVendorCategories] = useState('');
  const [riskFlags, setRiskFlags] = useState('');
  const [investorSections, setInvestorSections] = useState('Budget, Savings, Vendor Awards, Risk, Timeline');
  const [timeline, setTimeline] = useState('');
  const [busy, setBusy] = useState(false);

  function lines(v: string): string[] {
    return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }

  function parseTimeline(v: string): { phase: string; weeks: number }[] {
    // "Design:8, Bid:4" or one per line
    return v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [p, w] = s.split(':');
        return { phase: (p || '').trim(), weeks: Number((w || '0').trim()) || 0 };
      });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiSend('POST', '/admin/project-templates', {
        key,
        name,
        asset_type: assetType,
        description,
        suggested_bid_packages: lines(bidPackages),
        suggested_documents: lines(documents),
        vendor_categories: lines(vendorCategories),
        risk_flags: lines(riskFlags),
        investor_report_sections: lines(investorSections),
        timeline: parseTimeline(timeline),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Custom template</h3>
      <form onSubmit={save}>
        <div className="two">
          <div className="field"><label>Key (unique slug)</label>
            <input value={key} onChange={(e) => setKey(e.target.value)} required placeholder="boutique_hotel" /></div>
          <div className="field"><label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Boutique Hotel" /></div>
        </div>
        <div className="two">
          <div className="field"><label>Asset type</label>
            <input value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="Hospitality" /></div>
          <div className="field"><label>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" /></div>
        </div>
        <div className="field"><label>Suggested bid packages (comma or newline separated)</label>
          <textarea value={bidPackages} onChange={(e) => setBidPackages(e.target.value)} placeholder="Cabinetry, Lighting, Flooring, FF&E" /></div>
        <div className="field"><label>Suggested documents</label>
          <textarea value={documents} onChange={(e) => setDocuments(e.target.value)} placeholder="Plans, Finish Schedule, FF&E Schedule, Budget" /></div>
        <div className="field"><label>Vendor categories</label>
          <textarea value={vendorCategories} onChange={(e) => setVendorCategories(e.target.value)} placeholder="Cabinet Manufacturer, Lighting Supplier" /></div>
        <div className="field"><label>Timeline (phase:weeks per line, e.g. Design:8)</label>
          <textarea value={timeline} onChange={(e) => setTimeline(e.target.value)} placeholder="Design & Spec:8&#10;Bid & Award:4&#10;Procurement:12&#10;Install:8" /></div>
        <div className="field"><label>Risk flags</label>
          <textarea value={riskFlags} onChange={(e) => setRiskFlags(e.target.value)} placeholder="Long lead times, Single-source vendors" /></div>
        <div className="field"><label>Investor report sections</label>
          <textarea value={investorSections} onChange={(e) => setInvestorSections(e.target.value)} /></div>
        <button className="btn primary" disabled={busy || !key || !name}>{busy ? 'Saving...' : 'Save template'}</button>
      </form>
    </div>
  );
}
