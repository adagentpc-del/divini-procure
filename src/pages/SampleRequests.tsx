/**
 * Material Sample Requests, role-aware.
 *
 * DEVELOPER (company.kind === 'buyer'): create a sample request (vendor company
 * id, material type, product label, quantity, ship-to address, optional
 * project), track the requests they have raised, and approve / reject a sample
 * once it has been delivered. The developer can also mark a shipped sample as
 * delivered.
 *
 * VENDOR (company.kind === 'vendor'): see the requests addressed to them and
 * advance them (vendor_review / shipped) with a tracking number and a written
 * response.
 *
 * Status is shown throughout with badges. The server enforces who may set what;
 * this page just offers the role-appropriate actions.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet, apiSend } from '../lib/api';
import { getBuildings } from '../lib/db';

type SampleRequest = {
  id: string;
  project_id: string | null;
  project_name?: string | null;
  developer_company_id: string | null;
  developer_name?: string | null;
  vendor_company_id: string | null;
  vendor_name?: string | null;
  material_type: string;
  product_label: string | null;
  quantity: number;
  ship_to_address: string | null;
  status: string;
  tracking_number: string | null;
  vendor_response: string | null;
  approval_notes: string | null;
  created_at: string;
};

const MATERIAL_TYPES = [
  'tile', 'flooring', 'fabric', 'drapery', 'stone', 'paint', 'hardware', 'finish', 'other',
];

const STATUS_CLS: Record<string, string> = {
  requested: 'badge b-neutral',
  vendor_review: 'badge b-amber',
  shipped: 'badge b-amber',
  delivered: 'badge b-amber',
  approved: 'badge b-green',
  rejected: 'badge b-red',
};
const statusCls = (s: string) => STATUS_CLS[s] ?? 'badge b-neutral';
const statusLabel = (s: string) => s.replace(/_/g, ' ');

export default function SampleRequests() {
  const { company } = useAuth();
  const role = company?.kind ?? 'buyer';
  const isVendor = role === 'vendor';

  const [rows, setRows] = useState<SampleRequest[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // developer create-form state
  const [vendorCompanyId, setVendorCompanyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [materialType, setMaterialType] = useState('tile');
  const [productLabel, setProductLabel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [shipToAddress, setShipToAddress] = useState('');

  // per-row edit state (vendor: tracking/response; developer: approval notes)
  const [edit, setEdit] = useState<Record<string, { tracking?: string; response?: string; notes?: string }>>({});

  async function load() {
    if (!company) return;
    setErr('');
    try {
      const key = isVendor ? 'vendorCompanyId' : 'developerCompanyId';
      const d = await apiGet<{ sampleRequests: SampleRequest[] }>(
        `/sample-requests?${key}=${encodeURIComponent(company.id)}`,
      );
      setRows(d.sampleRequests ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load sample requests.');
    }
  }

  useEffect(() => {
    if (!company) return;
    load();
    if (!isVendor) {
      getBuildings(company.id)
        .then((bs) => setBuildings(bs ?? []))
        .catch(() => setBuildings([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setErr(''); setOk(''); setBusy(true);
    try {
      await apiSend('POST', '/sample-requests', {
        developerCompanyId: company.id,
        vendorCompanyId: vendorCompanyId.trim() || undefined,
        projectId: projectId || undefined,
        materialType,
        productLabel: productLabel.trim(),
        quantity: Number(quantity) || 1,
        shipToAddress: shipToAddress.trim() || undefined,
      });
      setOk('Sample request created.');
      setProductLabel(''); setQuantity('1'); setShipToAddress(''); setVendorCompanyId('');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not create the sample request.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    setErr(''); setOk(''); setBusy(true);
    try {
      await apiSend('PATCH', `/sample-requests/${encodeURIComponent(id)}`, body);
      setOk(msg);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!company) return <div className="note">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Material Samples</h1>
        <p className="note">
          {isVendor
            ? 'Sample requests addressed to your company. Move each through review and shipping with a tracking number.'
            : 'Request physical material samples from a vendor, track them, and approve or reject once delivered.'}
        </p>
      </div>

      {err && <div className="note err">{err}</div>}
      {ok && <div className="note ok">{ok}</div>}

      {/* ---- developer: create a sample request ---- */}
      {!isVendor && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>Request a sample</h3>
          <form onSubmit={create}>
            <div className="two">
              <div className="field">
                <label>Vendor company id</label>
                <input
                  value={vendorCompanyId}
                  onChange={(e) => setVendorCompanyId(e.target.value)}
                  placeholder="Vendor company UUID"
                />
              </div>
              <div className="field">
                <label>Project (optional)</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">No project</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="two">
              <div className="field">
                <label>Material type</label>
                <select value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
                  {MATERIAL_TYPES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Product label</label>
              <input
                value={productLabel}
                onChange={(e) => setProductLabel(e.target.value)}
                placeholder="e.g. Calacatta Gold 12x24 polished"
                required
              />
            </div>
            <div className="field">
              <label>Ship-to address</label>
              <input
                value={shipToAddress}
                onChange={(e) => setShipToAddress(e.target.value)}
                placeholder="Where the sample should be sent"
              />
            </div>
            <button className="btn" disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Create request'}
            </button>
          </form>
        </div>
      )}

      {/* ---- list ---- */}
      <div className="card">
        <h3>{isVendor ? 'Incoming requests' : 'My requests'}</h3>
        {rows.length === 0 ? (
          <p className="note">No sample requests yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Product</th>
                <th>Qty</th>
                <th>{isVendor ? 'Developer' : 'Vendor'}</th>
                <th>Project</th>
                <th>Status</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = edit[r.id] ?? {};
                const setE = (patchE: Partial<typeof e>) =>
                  setEdit((m) => ({ ...m, [r.id]: { ...m[r.id], ...patchE } }));
                return (
                  <tr key={r.id}>
                    <td>{r.material_type}</td>
                    <td>{r.product_label}</td>
                    <td>{r.quantity}</td>
                    <td>{isVendor ? (r.developer_name ?? '—') : (r.vendor_name ?? '—')}</td>
                    <td>{r.project_name ?? '—'}</td>
                    <td><span className={statusCls(r.status)}>{statusLabel(r.status)}</span></td>
                    <td>
                      {r.tracking_number && <div className="note">Tracking: {r.tracking_number}</div>}
                      {r.vendor_response && <div className="note">Vendor: {r.vendor_response}</div>}
                      {r.approval_notes && <div className="note">Notes: {r.approval_notes}</div>}
                      {r.ship_to_address && <div className="note">Ship to: {r.ship_to_address}</div>}
                    </td>
                    <td>
                      {/* ---- vendor actions ---- */}
                      {isVendor && r.status !== 'approved' && r.status !== 'rejected' && (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <input
                            placeholder="Tracking number"
                            value={e.tracking ?? r.tracking_number ?? ''}
                            onChange={(ev) => setE({ tracking: ev.target.value })}
                          />
                          <input
                            placeholder="Response to developer"
                            value={e.response ?? r.vendor_response ?? ''}
                            onChange={(ev) => setE({ response: ev.target.value })}
                          />
                          {r.status === 'requested' && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                patch(
                                  r.id,
                                  { status: 'vendor_review', vendorResponse: e.response ?? r.vendor_response ?? undefined },
                                  'Moved to vendor review.',
                                )
                              }
                            >
                              Start review
                            </button>
                          )}
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              patch(
                                r.id,
                                {
                                  status: 'shipped',
                                  trackingNumber: e.tracking ?? r.tracking_number ?? undefined,
                                  vendorResponse: e.response ?? r.vendor_response ?? undefined,
                                },
                                'Marked shipped.',
                              )
                            }
                          >
                            Mark shipped
                          </button>
                        </div>
                      )}

                      {/* ---- developer actions ---- */}
                      {!isVendor && (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {r.status === 'shipped' && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => patch(r.id, { status: 'delivered' }, 'Marked delivered.')}
                            >
                              Mark delivered
                            </button>
                          )}
                          {(r.status === 'delivered' || r.status === 'shipped') && (
                            <>
                              <input
                                placeholder="Approval / rejection notes"
                                value={e.notes ?? r.approval_notes ?? ''}
                                onChange={(ev) => setE({ notes: ev.target.value })}
                              />
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() =>
                                  patch(
                                    r.id,
                                    { status: 'approved', approvalNotes: e.notes ?? r.approval_notes ?? undefined },
                                    'Sample approved.',
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() =>
                                  patch(
                                    r.id,
                                    { status: 'rejected', approvalNotes: e.notes ?? r.approval_notes ?? undefined },
                                    'Sample rejected.',
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
