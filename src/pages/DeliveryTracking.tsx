import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiSend } from '../lib/api';

// ---- shapes returned by the /deliveries API --------------------------------
type Delivery = {
  id: string;
  package_id: string;
  vendor_company_id: string | null;
  vendor_company?: string | null;
  submittal_id: string | null;
  production_status: string | null;
  shipping_status: string | null;
  ship_date: string | null;
  expected_delivery: string | null;
  delivery_date: string | null;
  install_date: string | null;
  completion_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  punch_total?: number;
  punch_open?: number;
};
type PunchItem = { id: string; delivery_id: string; description: string; resolved: boolean; created_at: string };
type DeliveryEvent = { id: string; delivery_id: string; label: string | null; actor: string | null; created_at: string };
type ItemResp = { delivery: Delivery; punch_items: PunchItem[]; events: DeliveryEvent[] };

// The lifecycle, in order. Each stage maps to the status that marks it reached
// and (where relevant) the editable date field for that milestone.
const STAGES: { key: string; label: string; dateField?: keyof Delivery; dateLabel?: string }[] = [
  { key: 'in_production', label: 'Production' },
  { key: 'shipped', label: 'Shipped', dateField: 'ship_date', dateLabel: 'Ship date' },
  { key: 'delivered', label: 'Delivered', dateField: 'delivery_date', dateLabel: 'Delivery date' },
  { key: 'installing', label: 'Installing', dateField: 'install_date', dateLabel: 'Install date' },
  { key: 'installed', label: 'Installed' },
  { key: 'complete', label: 'Complete', dateField: 'completion_date', dateLabel: 'Completion date' },
];
const STAGE_ORDER = STAGES.map((s) => s.key);

const STATUS_OPTIONS = [
  'in_production', 'shipped', 'delivered', 'installing', 'installed', 'complete', 'delayed',
];

const prettyStatus = (s: string | null) => (s || '').replace(/_/g, ' ');

export default function DeliveryTracking() {
  const { id } = useParams(); // package id
  const nav = useNavigate();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [active, setActive] = useState<ItemResp | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [punchText, setPunchText] = useState('');
  const [draftDates, setDraftDates] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState('');

  async function loadList() {
    if (!id) return;
    setErr(''); setLoading(true);
    try {
      const list = await apiGet<Delivery[]>(`/deliveries/${encodeURIComponent(id)}`);
      setDeliveries(list);
      if (list.length > 0) await openItem(list[0].id);
      else setActive(null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load deliveries.');
    } finally {
      setLoading(false);
    }
  }

  async function openItem(deliveryId: string) {
    try {
      const r = await apiGet<ItemResp>(`/deliveries/item/${encodeURIComponent(deliveryId)}`);
      setActive(r);
      const d = r.delivery;
      setDraftDates({
        ship_date: d.ship_date ?? '',
        expected_delivery: d.expected_delivery ?? '',
        delivery_date: d.delivery_date ?? '',
        install_date: d.install_date ?? '',
        completion_date: d.completion_date ?? '',
      });
      setDraftNotes(d.notes ?? '');
    } catch (e: any) {
      setErr(e?.message || 'Failed to load delivery.');
    }
  }

  useEffect(() => { loadList(); }, [id]);

  async function createDelivery() {
    if (!id) return;
    setBusy(true); setErr('');
    try {
      await apiSend<Delivery>('POST', '/deliveries', { packageId: id });
      await loadList();
    } catch (e: any) {
      setErr(e?.message || 'Failed to create delivery.');
    } finally {
      setBusy(false);
    }
  }

  async function patchDelivery(patch: Record<string, unknown>) {
    if (!active) return;
    setBusy(true); setErr('');
    try {
      await apiSend<Delivery>('PATCH', `/deliveries/${encodeURIComponent(active.delivery.id)}`, patch);
      await openItem(active.delivery.id);
      // refresh list counts/labels too
      if (id) setDeliveries(await apiGet<Delivery[]>(`/deliveries/${encodeURIComponent(id)}`));
    } catch (e: any) {
      setErr(e?.message || 'Failed to update.');
    } finally {
      setBusy(false);
    }
  }

  async function addPunch() {
    if (!active || !punchText.trim()) return;
    setBusy(true); setErr('');
    try {
      await apiSend<PunchItem>('POST', `/deliveries/${encodeURIComponent(active.delivery.id)}/punch`, { description: punchText });
      setPunchText('');
      await openItem(active.delivery.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to add punch item.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePunch(item: PunchItem) {
    setBusy(true); setErr('');
    try {
      await apiSend<PunchItem>('PATCH', `/deliveries/punch/${encodeURIComponent(item.id)}`, { resolved: !item.resolved });
      if (active) await openItem(active.delivery.id);
    } catch (e: any) {
      setErr(e?.message || 'Failed to update punch item.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="note">Loading delivery tracking…</div>;

  const d = active?.delivery ?? null;
  const currentIdx = d ? STAGE_ORDER.indexOf(d.status) : -1;
  const isDelayed = d?.status === 'delayed';

  return (
    <>
      <div className="page-head">
        <div>
          <a className="note" style={{ cursor: 'pointer' }} onClick={() => nav('/package/' + id)}>← Back to package</a>
          <h1>Delivery &amp; installation</h1>
          <div className="sub">
            Track production through install and completion.
            {deliveries.length > 0 && ` · ${deliveries.length} record${deliveries.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={createDelivery} disabled={busy}>+ New delivery record</button>
        </div>
      </div>

      {err && <div className="card"><div className="note" style={{ color: 'var(--red)' }}>{err}</div></div>}

      {deliveries.length === 0 ? (
        <div className="card"><div className="note">No delivery records yet. Create one to start tracking production, shipping, and installation.</div></div>
      ) : (
        <>
          {/* record selector when more than one */}
          {deliveries.length > 1 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="field">
                <label>Delivery record</label>
                <select value={d?.id ?? ''} onChange={(e) => openItem(e.target.value)}>
                  {deliveries.map((rec) => (
                    <option key={rec.id} value={rec.id}>
                      {(rec.vendor_company || 'Vendor')} · {prettyStatus(rec.status)} · {rec.punch_open ?? 0} open punch
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {d && (
            <>
              {/* ---- visual timeline ---- */}
              <div className="sectitle">Lifecycle</div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 0 }}>
                  {STAGES.map((stage, si) => {
                    const reached = currentIdx >= si && !isDelayed;
                    const isCurrent = d.status === stage.key;
                    const dotColor = isCurrent
                      ? 'var(--emerald, #107c5a)'
                      : reached
                        ? 'var(--emerald, #107c5a)'
                        : 'var(--line, #d8dde3)';
                    const dateVal = stage.dateField ? (d[stage.dateField] as string | null) : null;
                    return (
                      <div key={stage.key} style={{ flex: '1 1 110px', minWidth: 110, textAlign: 'center', position: 'relative' }}>
                        {si < STAGES.length - 1 && (
                          <div style={{
                            position: 'absolute', top: 11, left: '50%', right: '-50%', height: 3,
                            background: currentIdx > si && !isDelayed ? 'var(--emerald, #107c5a)' : 'var(--line, #d8dde3)',
                          }} />
                        )}
                        <div style={{
                          position: 'relative', zIndex: 1, width: 24, height: 24, borderRadius: '50%',
                          background: dotColor, margin: '0 auto 8px',
                          boxShadow: isCurrent ? '0 0 0 4px rgba(16,124,90,0.18)' : undefined,
                        }} />
                        <div style={{ fontWeight: isCurrent ? 700 : 600, fontSize: 13 }}>{stage.label}</div>
                        {stage.dateField && (
                          <div className="note" style={{ fontSize: 11.5 }}>{dateVal || '—'}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isDelayed && (
                  <div className="note" style={{ marginTop: 12, color: 'var(--red)' }}>
                    This delivery is flagged <strong>delayed</strong>.
                  </div>
                )}
              </div>

              {/* ---- status + production/shipping controls ---- */}
              <div className="sectitle">Status</div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="two">
                  <div className="field">
                    <label>Lifecycle status</label>
                    <select
                      value={d.status}
                      onChange={(e) => patchDelivery({ status: e.target.value })}
                      disabled={busy}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{prettyStatus(s)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Vendor</label>
                    <input value={d.vendor_company || 'Not assigned'} readOnly />
                  </div>
                </div>
                <div className="two">
                  <div className="field">
                    <label>Production status</label>
                    <input
                      defaultValue={d.production_status ?? ''}
                      placeholder="e.g. not_started / in_progress / done"
                      onBlur={(e) => { if (e.target.value !== (d.production_status ?? '')) patchDelivery({ production_status: e.target.value }); }}
                    />
                  </div>
                  <div className="field">
                    <label>Shipping status</label>
                    <input
                      defaultValue={d.shipping_status ?? ''}
                      placeholder="e.g. not_shipped / in_transit / arrived"
                      onBlur={(e) => { if (e.target.value !== (d.shipping_status ?? '')) patchDelivery({ shipping_status: e.target.value }); }}
                    />
                  </div>
                </div>
              </div>

              {/* ---- editable milestone dates ---- */}
              <div className="sectitle">Dates</div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="two">
                  <div className="field">
                    <label>Ship date</label>
                    <input type="date" value={draftDates.ship_date || ''} onChange={(e) => setDraftDates({ ...draftDates, ship_date: e.target.value })} onBlur={(e) => patchDelivery({ ship_date: e.target.value || null })} />
                  </div>
                  <div className="field">
                    <label>Expected delivery</label>
                    <input type="date" value={draftDates.expected_delivery || ''} onChange={(e) => setDraftDates({ ...draftDates, expected_delivery: e.target.value })} onBlur={(e) => patchDelivery({ expected_delivery: e.target.value || null })} />
                  </div>
                </div>
                <div className="two">
                  <div className="field">
                    <label>Delivery date</label>
                    <input type="date" value={draftDates.delivery_date || ''} onChange={(e) => setDraftDates({ ...draftDates, delivery_date: e.target.value })} onBlur={(e) => patchDelivery({ delivery_date: e.target.value || null })} />
                  </div>
                  <div className="field">
                    <label>Install date</label>
                    <input type="date" value={draftDates.install_date || ''} onChange={(e) => setDraftDates({ ...draftDates, install_date: e.target.value })} onBlur={(e) => patchDelivery({ install_date: e.target.value || null })} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: 320 }}>
                  <label>Completion date</label>
                  <input type="date" value={draftDates.completion_date || ''} onChange={(e) => setDraftDates({ ...draftDates, completion_date: e.target.value })} onBlur={(e) => patchDelivery({ completion_date: e.target.value || null })} />
                </div>
                <div className="field">
                  <label>Notes</label>
                  <textarea rows={2} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} onBlur={() => { if (draftNotes !== (d.notes ?? '')) patchDelivery({ notes: draftNotes }); }} placeholder="Logistics notes, access details, site contact…" />
                </div>
              </div>

              {/* ---- punch list ---- */}
              <div className="sectitle">Punch list ({active?.punch_items.filter((p) => !p.resolved).length ?? 0} open)</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {(active?.punch_items.length ?? 0) === 0 && (
                  <div className="note" style={{ marginBottom: 10 }}>No punch items.</div>
                )}
                {active?.punch_items.map((pi) => (
                  <div key={pi.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <input type="checkbox" checked={pi.resolved} onChange={() => togglePunch(pi)} disabled={busy} style={{ width: 'auto' }} />
                    <span style={{ flex: 1, textDecoration: pi.resolved ? 'line-through' : 'none', opacity: pi.resolved ? 0.6 : 1 }}>
                      {pi.description}
                    </span>
                    <span className={`badge ${pi.resolved ? 'b-green' : 'b-neutral'}`}>{pi.resolved ? 'resolved' : 'open'}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input value={punchText} onChange={(e) => setPunchText(e.target.value)} placeholder="Add a punch item…" />
                  <button className="btn" onClick={addPunch} disabled={busy || !punchText.trim()}>Add</button>
                </div>
              </div>

              {/* ---- events log ---- */}
              <div className="sectitle">Activity log</div>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>When</th><th>Activity</th><th>By</th></tr></thead>
                  <tbody>
                    {(active?.events.length ?? 0) === 0 ? (
                      <tr><td colSpan={3} className="note" style={{ padding: 14 }}>No activity yet.</td></tr>
                    ) : active?.events.map((ev) => (
                      <tr key={ev.id}>
                        <td className="note">{new Date(ev.created_at).toLocaleString()}</td>
                        <td>{ev.label}</td>
                        <td className="note">{ev.actor || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
