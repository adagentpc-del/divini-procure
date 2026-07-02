/**
 * Vendor Pricing Tiers - role-aware single page.
 *
 * Vendor (companies.kind='vendor'): manage MY pricing. List my rows + a create
 * form with pricing_type / product / sku / unit / price ($) / min qty /
 * visibility, and optional developer/project ids for developer_specific /
 * project_specific tiers. Edit (price + visibility + active) and deactivate.
 *
 * Developer / buyer (companies.kind='buyer'): read-only. Enter a vendor company
 * id to see exactly the pricing that vendor has made visible to me (the call
 * passes developerCompanyId = my company so developer-scoped rows resolve).
 *
 * Money is integer cents over the API; the UI shows dollars.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type PricingRow = {
  id: string;
  vendor_company_id: string;
  developer_company_id: string | null;
  project_id: string | null;
  pricing_type: string;
  product_label: string | null;
  sku: string | null;
  unit: string | null;
  price_cents: number | string | null;
  min_qty: number | null;
  currency: string | null;
  visibility: string;
  notes: string | null;
  active: boolean;
  vendor_name?: string;
  developer_name?: string;
};

const PRICING_TYPES = [
  'retail',
  'trade',
  'developer_specific',
  'project_specific',
  'contract',
  'volume',
  'preferred',
  'grandfathered',
  'private_admin',
];

const VISIBILITIES = ['public', 'trade', 'developer', 'project', 'admin_only'];

const TYPE_LABEL: Record<string, string> = {
  retail: 'Retail',
  trade: 'Trade',
  developer_specific: 'Developer specific',
  project_specific: 'Project specific',
  contract: 'Contract',
  volume: 'Volume',
  preferred: 'Preferred',
  grandfathered: 'Grandfathered',
  private_admin: 'Private (admin)',
};

const VIS_BADGE: Record<string, string> = {
  public: 'b-green',
  trade: 'b-neutral',
  developer: 'b-amber',
  project: 'b-amber',
  admin_only: 'b-red',
};

function dollars(cents: number | string | null): string {
  if (cents === null || cents === undefined || cents === '') return '-';
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(n)) return '-';
  return '$' + (n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VendorPricing() {
  const { company } = useAuth();
  if (!company) return <div className="note">Loading…</div>;
  return company.kind === 'vendor' ? <VendorManage companyId={company.id} /> : <DeveloperView companyId={company.id} />;
}

// ---------------------------------------------------------------------------
// VENDOR: manage my pricing
// ---------------------------------------------------------------------------
function VendorManage({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // create form state
  const [pricingType, setPricingType] = useState('trade');
  const [productLabel, setProductLabel] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [minQty, setMinQty] = useState('1');
  const [visibility, setVisibility] = useState('trade');
  const [developerCompanyId, setDeveloperCompanyId] = useState('');
  const [projectId, setProjectId] = useState('');

  async function load() {
    setErr('');
    try {
      const d = await apiGet<{ pricing: PricingRow[] }>(`/vendor-pricing?vendorCompanyId=${companyId}`);
      setRows(d.pricing ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load pricing.');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function resetForm() {
    setPricingType('trade');
    setProductLabel('');
    setSku('');
    setUnit('');
    setPrice('');
    setMinQty('1');
    setVisibility('trade');
    setDeveloperCompanyId('');
    setProjectId('');
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const priceCents = price.trim() === '' ? null : Math.round(parseFloat(price) * 100);
      await apiSend('POST', '/vendor-pricing', {
        vendorCompanyId: companyId,
        pricingType,
        productLabel: productLabel || null,
        sku: sku || null,
        unit: unit || null,
        priceCents,
        minQty: minQty ? Number(minQty) : 1,
        visibility,
        developerCompanyId: developerCompanyId || null,
        projectId: projectId || null,
      });
      setOk('Pricing added.');
      resetForm();
      setAdding(false);
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save pricing.');
    } finally {
      setBusy(false);
    }
  }

  async function updateRow(id: string, patch: Record<string, unknown>) {
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/vendor-pricing/${id}`, patch);
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update pricing.');
    }
  }

  async function deactivate(id: string) {
    setErr('');
    try {
      await apiSend('DELETE', `/vendor-pricing/${id}`);
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not deactivate pricing.');
    }
  }

  const needsScope = pricingType === 'developer_specific' || pricingType === 'project_specific';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pricing</h1>
          <div className="sub">
            Publish price tiers for your products and services and control who can see each one.
          </div>
        </div>
        <button className="btn primary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : '+ New price'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          <form onSubmit={create}>
            <div className="two">
              <div className="field">
                <label>Pricing tier</label>
                <select value={pricingType} onChange={(e) => setPricingType(e.target.value)}>
                  {PRICING_TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Visibility</label>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Product / service</label>
                <input value={productLabel} onChange={(e) => setProductLabel(e.target.value)} placeholder="e.g. Quartz countertop, installed" />
              </div>
              <div className="field">
                <label>SKU</label>
                <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Unit price (USD)</label>
                <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div className="field">
                <label>Unit</label>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. sq ft, each" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Minimum quantity</label>
                <input type="number" min="1" step="1" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
              </div>
              <div className="field" />
            </div>
            {needsScope && (
              <div className="two">
                <div className="field">
                  <label>Developer company id {pricingType === 'developer_specific' ? '(required)' : '(optional)'}</label>
                  <input value={developerCompanyId} onChange={(e) => setDeveloperCompanyId(e.target.value)} placeholder="developer company UUID" />
                </div>
                <div className="field">
                  <label>Project id {pricingType === 'project_specific' ? '(required)' : '(optional)'}</label>
                  <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="project (building) UUID" />
                </div>
              </div>
            )}
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Add price'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Tier</th>
              <th>Price</th>
              <th>Min qty</th>
              <th>Visibility</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="note" style={{ padding: 14 }}>No pricing yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>
                    <strong>{r.product_label ?? '-'}</strong>
                    {r.sku && <div className="note">{r.sku}</div>}
                  </td>
                  <td><span className="badge b-neutral">{TYPE_LABEL[r.pricing_type] ?? r.pricing_type}</span></td>
                  <td>
                    {dollars(r.price_cents)}
                    {r.unit && <span className="note"> / {r.unit}</span>}
                  </td>
                  <td>{r.min_qty ?? 1}</td>
                  <td>
                    <select
                      value={r.visibility}
                      onChange={(e) => updateRow(r.id, { visibility: e.target.value })}
                    >
                      {VISIBILITIES.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${r.active ? 'b-green' : 'b-red'}`}>{r.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.active ? (
                      <button className="btn" onClick={() => deactivate(r.id)}>Deactivate</button>
                    ) : (
                      <button className="btn" onClick={() => updateRow(r.id, { active: true })}>Reactivate</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        Visibility controls who sees a price: public (any user), trade (any developer), developer (only the named
        developer company), project (only the owning company of that project), admin only.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DEVELOPER / BUYER: read-only view of a vendor's pricing visible to me
// ---------------------------------------------------------------------------
function DeveloperView({ companyId }: { companyId: string }) {
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<PricingRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId.trim()) return;
    setBusy(true);
    setErr('');
    setRows(null);
    try {
      const d = await apiGet<{ pricing: PricingRow[] }>(
        `/vendor-pricing?vendorCompanyId=${encodeURIComponent(vendorId.trim())}&developerCompanyId=${companyId}`,
      );
      setRows(d.pricing ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load vendor pricing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vendor pricing</h1>
          <div className="sub">Look up a vendor to see the pricing they have made visible to you.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <form onSubmit={load}>
          <div className="field">
            <label>Vendor company id</label>
            <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="vendor company UUID" />
          </div>
          <button className="btn primary" disabled={busy || !vendorId.trim()}>
            {busy ? 'Loading…' : 'View pricing'}
          </button>
        </form>
      </div>

      {err && <div className="err">{err}</div>}

      {rows !== null && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Tier</th>
                <th>Price</th>
                <th>Min qty</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="note" style={{ padding: 14 }}>This vendor has not made any pricing visible to you.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.product_label ?? '-'}</strong>
                      {r.sku && <div className="note">{r.sku}</div>}
                    </td>
                    <td><span className="badge b-neutral">{TYPE_LABEL[r.pricing_type] ?? r.pricing_type}</span></td>
                    <td>
                      {dollars(r.price_cents)}
                      {r.unit && <span className="note"> / {r.unit}</span>}
                    </td>
                    <td>{r.min_qty ?? 1}</td>
                    <td><span className={`badge ${VIS_BADGE[r.visibility] ?? 'b-neutral'}`}>{r.visibility}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="note" style={{ marginTop: 12 }}>
        You only see prices the vendor has published to public or trade visibility, plus prices scoped specifically to
        your company or your projects.
      </div>
    </>
  );
}
