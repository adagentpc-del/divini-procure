/**
 * Product Catalog / SKU Management - role-aware single page.
 *
 * Vendor (companies.kind='vendor'): manage MY products. List my catalog + a
 * create/edit form (name, sku, category, subcategory, description, image URLs,
 * spec URL, dimensions, finishes, materials, lead time, price $, price
 * visibility, commercial / hospitality rating, warranty, file URLs). Edit and
 * discontinue (soft delete -> status='discontinued').
 *
 * Buyer / developer (companies.kind='buyer'): browse. Search by category +
 * keyword + optional vendor company id, see product cards. Price is shown when
 * the vendor has made it visible to me, otherwise "Price on request".
 *
 * Money is integer cents over the API; the UI shows dollars.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';

type Product = {
  id: string;
  vendor_company_id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  image_urls: string[] | null;
  spec_url: string | null;
  dimensions: string | null;
  finishes: string[] | null;
  materials: string[] | null;
  lead_time_days: number | null;
  price_cents: number | string | null;
  price_visibility: string;
  commercial_rating: number | null;
  hospitality_rating: number | null;
  warranty: string | null;
  file_urls: string[] | null;
  status: string;
  priceHidden?: boolean;
};

// CSI-style categories used elsewhere in the app.
const CATEGORIES = [
  'Cabinetry',
  'Millwork',
  'Lighting',
  'Flooring',
  'Tile',
  'Doors',
  'Hardware',
  'Furniture',
  'Electrical',
  'Plumbing',
  'Stone',
  'Appliances',
  'Drapery',
  'Specialty',
];

const PRICE_VISIBILITIES = ['public', 'trade', 'developer', 'admin_only'];

const VIS_LABEL: Record<string, string> = {
  public: 'Public (any user)',
  trade: 'Trade (any company)',
  developer: 'Developer only',
  admin_only: 'Admin only',
};

const VIS_BADGE: Record<string, string> = {
  public: 'b-green',
  trade: 'b-neutral',
  developer: 'b-amber',
  admin_only: 'b-red',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'b-green',
  draft: 'b-amber',
  discontinued: 'b-red',
};

function dollars(cents: number | string | null): string {
  if (cents === null || cents === undefined || cents === '') return '-';
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(n)) return '-';
  return '$' + (n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function priceLabel(p: Product): string {
  if (p.priceHidden || p.price_cents === null || p.price_cents === undefined) return 'Price on request';
  return dollars(p.price_cents);
}

function csv(arr: string[] | null | undefined): string {
  return (arr ?? []).join(', ');
}

function ratingLabel(n: number | null): string {
  if (!n) return '-';
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

export default function ProductCatalog() {
  const { company } = useAuth();
  if (!company) return <div className="note">Loading…</div>;
  return company.kind === 'vendor' ? <VendorManage companyId={company.id} /> : <BuyerBrowse />;
}

// ---------------------------------------------------------------------------
// VENDOR: manage my catalog
// ---------------------------------------------------------------------------
type FormState = {
  name: string;
  sku: string;
  category: string;
  subcategory: string;
  description: string;
  imageUrls: string;
  specUrl: string;
  dimensions: string;
  finishes: string;
  materials: string;
  leadTimeDays: string;
  price: string;
  priceVisibility: string;
  commercialRating: string;
  hospitalityRating: string;
  warranty: string;
  fileUrls: string;
  status: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  category: CATEGORIES[0],
  subcategory: '',
  description: '',
  imageUrls: '',
  specUrl: '',
  dimensions: '',
  finishes: '',
  materials: '',
  leadTimeDays: '',
  price: '',
  priceVisibility: 'trade',
  commercialRating: '',
  hospitalityRating: '',
  warranty: '',
  fileUrls: '',
  status: 'active',
};

function VendorManage({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  async function load() {
    setErr('');
    try {
      const d = await apiGet<{ products: Product[] }>(`/products?vendorCompanyId=${companyId}`);
      setRows(d.products ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load catalog.');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setEditing(true);
    setOk('');
    setErr('');
  }

  function startEdit(p: Product) {
    setEditId(p.id);
    setForm({
      name: p.name ?? '',
      sku: p.sku ?? '',
      category: p.category ?? CATEGORIES[0],
      subcategory: p.subcategory ?? '',
      description: p.description ?? '',
      imageUrls: csv(p.image_urls),
      specUrl: p.spec_url ?? '',
      dimensions: p.dimensions ?? '',
      finishes: csv(p.finishes),
      materials: csv(p.materials),
      leadTimeDays: p.lead_time_days != null ? String(p.lead_time_days) : '',
      price:
        p.price_cents != null && p.price_cents !== '' && !p.priceHidden
          ? String(Number(p.price_cents) / 100)
          : '',
      priceVisibility: p.price_visibility ?? 'trade',
      commercialRating: p.commercial_rating != null ? String(p.commercial_rating) : '',
      hospitalityRating: p.hospitality_rating != null ? String(p.hospitality_rating) : '',
      warranty: p.warranty ?? '',
      fileUrls: csv(p.file_urls),
      status: p.status ?? 'active',
    });
    setEditing(true);
    setOk('');
    setErr('');
  }

  function cancel() {
    setEditing(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  }

  function payload() {
    const priceCents = form.price.trim() === '' ? null : Math.round(parseFloat(form.price) * 100);
    return {
      name: form.name || null,
      sku: form.sku || null,
      category: form.category || null,
      subcategory: form.subcategory || null,
      description: form.description || null,
      imageUrls: form.imageUrls,
      specUrl: form.specUrl || null,
      dimensions: form.dimensions || null,
      finishes: form.finishes,
      materials: form.materials,
      leadTimeDays: form.leadTimeDays === '' ? null : Number(form.leadTimeDays),
      priceCents,
      priceVisibility: form.priceVisibility,
      commercialRating: form.commercialRating === '' ? null : Number(form.commercialRating),
      hospitalityRating: form.hospitalityRating === '' ? null : Number(form.hospitalityRating),
      warranty: form.warranty || null,
      fileUrls: form.fileUrls,
      status: form.status,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOk('');
    try {
      if (editId) {
        await apiSend('PATCH', `/products/${editId}`, payload());
        setOk('Product updated.');
      } else {
        await apiSend('POST', '/products', { vendorCompanyId: companyId, ...payload() });
        setOk('Product added.');
      }
      cancel();
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not save product.');
    } finally {
      setBusy(false);
    }
  }

  async function discontinue(id: string) {
    setErr('');
    setOk('');
    try {
      await apiSend('DELETE', `/products/${id}`);
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not discontinue product.');
    }
  }

  async function reactivate(id: string) {
    setErr('');
    try {
      await apiSend('PATCH', `/products/${id}`, { status: 'active' });
      load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not reactivate product.');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <div className="sub">
            Publish your products and SKUs with specs, finishes, lead times and pricing. Control who sees each price.
          </div>
        </div>
        <button className="btn primary" onClick={() => (editing ? cancel() : startCreate())}>
          {editing ? 'Cancel' : '+ New product'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {editing && (
        <div className="card" style={{ marginBottom: 14 }}>
          <form onSubmit={save}>
            <div className="two">
              <div className="field">
                <label>Name</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Shaker base cabinet, 36in" />
              </div>
              <div className="field">
                <label>SKU</label>
                <input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Subcategory</label>
                <input value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="optional" />
            </div>
            <div className="two">
              <div className="field">
                <label>Image URLs (comma separated)</label>
                <input value={form.imageUrls} onChange={(e) => set('imageUrls', e.target.value)} placeholder="https://..., https://..." />
              </div>
              <div className="field">
                <label>Spec sheet URL</label>
                <input value={form.specUrl} onChange={(e) => set('specUrl', e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Dimensions</label>
                <input value={form.dimensions} onChange={(e) => set('dimensions', e.target.value)} placeholder='e.g. 36" W x 24" D x 34.5" H' />
              </div>
              <div className="field">
                <label>Lead time (days)</label>
                <input type="number" min="0" step="1" value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} placeholder="e.g. 28" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Finishes (comma separated)</label>
                <input value={form.finishes} onChange={(e) => set('finishes', e.target.value)} placeholder="e.g. White, Walnut, Matte Black" />
              </div>
              <div className="field">
                <label>Materials (comma separated)</label>
                <input value={form.materials} onChange={(e) => set('materials', e.target.value)} placeholder="e.g. Solid maple, MDF" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Unit price (USD)</label>
                <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" />
              </div>
              <div className="field">
                <label>Price visibility</label>
                <select value={form.priceVisibility} onChange={(e) => set('priceVisibility', e.target.value)}>
                  {PRICE_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>{VIS_LABEL[v] ?? v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Commercial rating (1-5)</label>
                <input type="number" min="1" max="5" step="1" value={form.commercialRating} onChange={(e) => set('commercialRating', e.target.value)} placeholder="optional" />
              </div>
              <div className="field">
                <label>Hospitality rating (1-5)</label>
                <input type="number" min="1" max="5" step="1" value={form.hospitalityRating} onChange={(e) => set('hospitalityRating', e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Warranty</label>
                <input value={form.warranty} onChange={(e) => set('warranty', e.target.value)} placeholder="e.g. 5 year limited" />
              </div>
              <div className="field">
                <label>File URLs (comma separated)</label>
                <input value={form.fileUrls} onChange={(e) => set('fileUrls', e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="discontinued">Discontinued</option>
                </select>
              </div>
              <div className="field" />
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : editId ? 'Save changes' : 'Add product'}
            </button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Lead time</th>
              <th>Visibility</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="note" style={{ padding: 14 }}>No products yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.status === 'discontinued' ? 0.5 : 1 }}>
                  <td>
                    <strong>{r.name ?? '-'}</strong>
                    {r.sku && <div className="note">{r.sku}</div>}
                  </td>
                  <td>
                    {r.category ?? '-'}
                    {r.subcategory && <div className="note">{r.subcategory}</div>}
                  </td>
                  <td>{dollars(r.price_cents)}</td>
                  <td>{r.lead_time_days != null ? `${r.lead_time_days} d` : '-'}</td>
                  <td><span className={`badge ${VIS_BADGE[r.price_visibility] ?? 'b-neutral'}`}>{r.price_visibility}</span></td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] ?? 'b-neutral'}`}>{r.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" onClick={() => startEdit(r)}>Edit</button>{' '}
                    {r.status === 'discontinued' ? (
                      <button className="btn" onClick={() => reactivate(r.id)}>Reactivate</button>
                    ) : (
                      <button className="btn" onClick={() => discontinue(r.id)}>Discontinue</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        Price visibility controls who sees a price: public (any user), trade (any signed-in company), developer (only
        developer/buyer companies), admin only. Non-price details are always visible to buyers browsing your catalog.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// BUYER / DEVELOPER: browse catalog
// ---------------------------------------------------------------------------
function BuyerBrowse() {
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<Product[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setRows(null);
    try {
      const qs: string[] = [];
      if (vendorId.trim()) qs.push(`vendorCompanyId=${encodeURIComponent(vendorId.trim())}`);
      if (category) qs.push(`category=${encodeURIComponent(category)}`);
      if (keyword.trim()) qs.push(`q=${encodeURIComponent(keyword.trim())}`);
      const d = await apiGet<{ products: Product[] }>(`/products${qs.length ? `?${qs.join('&')}` : ''}`);
      setRows(d.products ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load products.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <div className="sub">Browse vendor catalogs by category and keyword. Pricing shows when the vendor has shared it with you.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <form onSubmit={search}>
          <div className="two">
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Keyword</label>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="name, sku, description…" />
            </div>
          </div>
          <div className="field">
            <label>Vendor company id (optional)</label>
            <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="limit to one vendor (UUID)" />
          </div>
          <button className="btn primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
      </div>

      {err && <div className="err">{err}</div>}

      {rows !== null && (
        rows.length === 0 ? (
          <div className="card"><div className="note">No products match your search.</div></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {rows.map((p) => (
              <div className="card" key={p.id}>
                {p.image_urls && p.image_urls.length > 0 ? (
                  <img
                    src={p.image_urls[0]}
                    alt={p.name ?? 'product'}
                    style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }}
                  />
                ) : (
                  <div
                    className="note"
                    style={{ width: '100%', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 10 }}
                  >
                    No image
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong>{p.name ?? '-'}</strong>
                  <span style={{ whiteSpace: 'nowrap' }}>{priceLabel(p)}</span>
                </div>
                {p.sku && <div className="note">{p.sku}</div>}
                <div style={{ marginTop: 6 }}>
                  {p.category && <span className="badge b-neutral">{p.category}</span>}
                  {p.subcategory && <span className="note"> {p.subcategory}</span>}
                </div>
                {p.description && (
                  <div className="note" style={{ marginTop: 6 }}>
                    {p.description.length > 120 ? p.description.slice(0, 120) + '…' : p.description}
                  </div>
                )}
                <div className="note" style={{ marginTop: 8 }}>
                  Lead time: {p.lead_time_days != null ? `${p.lead_time_days} days` : '-'}
                </div>
                <div className="note">Commercial: {ratingLabel(p.commercial_rating)}</div>
                <div className="note">Hospitality: {ratingLabel(p.hospitality_rating)}</div>
                {p.spec_url && (
                  <div style={{ marginTop: 8 }}>
                    <a className="btn" href={p.spec_url} target="_blank" rel="noreferrer">Spec sheet</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <div className="note" style={{ marginTop: 12 }}>
        You see every product detail vendors publish. Prices appear when a vendor has set them to public, trade, or
        developer visibility; otherwise the product shows "Price on request."
      </div>
    </>
  );
}
